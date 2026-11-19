'use strict';
// Sound facade. Uses plinkfx (CC0 game sound effects rendered from code, https://github.com/maximilianfeix/plinkfx)
// for nearly everything, with positional volume/pan, surface footsteps, engine/rain/wind loops and ambience.
// Falls back to FC.Synth (our own synthesizer) if plinkfx is missing.
FC.Audio = (function () {
  const P = window.PLINK || null;
  const S = FC.Synth;
  let ready = false;
  const loops = {};
  // recorded CC0 weapon samples (decoded once into the plinkfx AudioContext)
  const REC = {};
  async function loadRecordings() {
    if (!window.FC_SOUNDS || !P) return;
    const ctx = P.context();
    for (const [k, b64] of Object.entries(window.FC_SOUNDS)) {
      try {
        const bin = atob(b64), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        REC[k] = await ctx.decodeAudioData(u.buffer);
      } catch (e) { /* keep synth fallback */ }
    }
  }
  function rec(name, vol, pan, rate, delay) {
    if (!ready || !REC[name] || !(vol > 0.004)) return false;
    const ctx = P.context(), t = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource(); src.buffer = REC[name]; src.playbackRate.value = rate || 1;
    const g = ctx.createGain(); g.gain.value = Math.min(1.2, vol) * (FC.Settings.get().master ?? 1);
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(g); if (pn) { pn.pan.value = FC.clamp(pan || 0, -1, 1); g.connect(pn); pn.connect(ctx.destination); } else g.connect(ctx.destination);
    src.start(t);
    return true;
  }

  // looping recorded bed (rain): mp3 padding is skipped with loopStart/loopEnd
  const recLoops = {};
  function recLoop(key, name, on, vol) {
    if (!ready || !REC[name]) return false;
    const ctx = P.context(), cur = recLoops[key], m = FC.Settings.get().master ?? 1;
    if (on && !cur) {
      const src = ctx.createBufferSource(); src.buffer = REC[name]; src.loop = true;
      src.loopStart = 0.06; src.loopEnd = REC[name].duration - 0.06;
      const g = ctx.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(vol * m, ctx.currentTime + 2);
      src.connect(g); g.connect(ctx.destination); src.start(0, 0.06);
      recLoops[key] = { src, g };
    } else if (!on && cur) {
      cur.g.gain.cancelScheduledValues(ctx.currentTime); cur.g.gain.setValueAtTime(cur.g.gain.value, ctx.currentTime);
      cur.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5); cur.src.stop(ctx.currentTime + 1.6); delete recLoops[key];
    } else if (on && cur) cur.g.gain.value = vol * m;
    return true;
  }
  // recorded footsteps (Freesound): surface -> sample prefix
  const STEP_REC = { wood: 'step_wood', sand: 'step_sand', grass: 'step_leaf', water: null, gravel: null, stone: null };
  let stepCool = 0;

  function play(name, o) {
    if (!P || !ready) return null;
    try { return P.play(name, o); } catch (e) { return null; }
  }
  function init() {
    S.init();
    if (P && !ready) {
      try {
        P.unlockAudio();
        P.volume(FC.Settings.get().master);
        FC.Settings.onChange((st) => { try { P.volume(st.master); } catch (e) { /* ignore */ } });
        ready = true;
        loadRecordings();
        P.preload(['gunshot', 'shotgun', 'machine-gun', 'reload', 'dry-fire', 'shell-casing', 'ricochet', 'explosion', 'explosion-big',
          'enemy-hit', 'body-fall', 'hurt', 'step-grass', 'step-sand', 'step-stone', 'pickup', 'coin', 'glass-break', 'ignite', 'toss'], 2);
      } catch (e) { ready = false; }
    }
  }
  // positional helper: o = { pos, maxD } -> { volume, pan }
  function where(pos, maxD) {
    const G = FC.G;
    if (!pos || !G || !G.players.length) return { volume: 1, pan: 0 };
    let best = null, bd = 1e9;
    for (const p of G.players) { const d = p.pos.distanceTo(pos); if (d < bd) { bd = d; best = p; } }
    const vol = Math.pow(FC.clamp(1 - bd / maxD, 0, 1), 1.5);
    let pan = 0;
    if (G.players.length === 1 && bd > 1) pan = Math.sin(-FC.wrapAngle(FC.yawTo(pos.x - best.pos.x, pos.z - best.pos.z) - best.yaw)) * 0.75;
    return { volume: vol, pan };
  }

  const A = {
    init,
    get ready() { return ready || S.ready; },
    where,
    shot(kind, vol, pos) {
      vol = vol === undefined ? 1 : vol;
      if (!ready) return S.shot(kind, vol);
      const pan = pos ? where(pos, 400).pan : 0;
      const rr = FC.rand(0.94, 1.06);
      const dist = pos ? 1 - Math.min(1, vol) : 0; // far shots lose their top end via a lower rate
      const recName = { pistol: 'silenced', sniper: 'sniper', heavy: 'shotgun', rifle_sup: 'silenced', sniper_sup: 'silenced' }[kind] || 'rifle';
      const recRate = kind === 'rifle_sup' ? 0.85 : kind === 'sniper_sup' ? 0.7 : 1;
      if (rec(recName, (kind === 'pistol' || kind === 'rifle_sup' ? 0.45 : kind === 'sniper_sup' ? 0.6 : 0.85) * vol, pan, rr * recRate * (1 - dist * 0.12))) {
        if (kind === 'sniper') play('explosion-distant', { volume: 0.3 * vol, delay: 0.08, pan });
        if (kind !== 'heavy' && Math.random() < 0.4) play('shell-casing', { volume: 0.1 * vol, delay: 0.3, pan });
        return;
      }
      if (kind === 'pistol') { play('gunshot', { volume: 0.28 * vol, rate: 1.75, pan, cooldown: 0 }); play('shell-casing', { volume: 0.12 * vol, delay: 0.25, pan }); }
      else if (kind === 'sniper') { play('gunshot', { volume: 1.0 * vol, rate: 0.72, pan, cooldown: 0 }); play('explosion-distant', { volume: 0.35 * vol, delay: 0.05, pan }); play('shell-casing', { volume: 0.15 * vol, delay: 0.6, pan }); }
      else if (kind === 'heavy') { play('shotgun', { volume: 0.9 * vol, pan, cooldown: 0 }); }
      else { play('gunshot', { volume: 0.75 * vol, rate: FC.rand(0.95, 1.05), pan, cooldown: 0, voices: 8 }); if (Math.random() < 0.35) play('shell-casing', { volume: 0.08 * vol, delay: 0.3, pan }); }
    },
    explosion(vol, pos) {
      if (!ready) return S.explosion(vol);
      const pan = pos ? where(pos, 500).pan : 0;
      play(vol > 0.5 ? 'explosion-big' : 'explosion', { volume: Math.min(1, vol * 1.1), pan, voices: 3 });
      play('debris', { volume: vol * 0.5, delay: 0.35, pan });
    },
    glass(vol) { if (!ready) return S.glass(vol); play('glass-break', { volume: 0.6 * vol }); play('ignite', { volume: 0.6 * vol, delay: 0.08 }); },
    whoosh(vol) { if (!ready) return S.whoosh(vol); play('toss', { volume: 0.5 * vol }); },
    hit() { if (!ready) return S.hit(); play('enemy-hit', { volume: 0.35 }); },
    kill() { if (!ready) return S.kill(); play('hit-heavy', { volume: 0.3 }); play('body-fall', { volume: 0.4, delay: 0.35 }); },
    takedown() { if (!ready) return S.takedown(); play('stab', { volume: 0.7 }); play('body-fall', { volume: 0.6, delay: 0.4 }); },
    hurt() { if (!ready) return S.hurt(); play('hurt', { volume: 0.55, cooldown: 0.25 }); },
    click() { if (!ready) return S.click(); play('click-soft', { volume: 0.4 }); },
    dry() { if (!ready) return S.click(); play('dry-fire', { volume: 0.6 }); },
    reload(weapon) {
      if (!ready) return S.click();
      const name = weapon === 'pistol' ? 'reload_pistol' : weapon === 'shotgun' ? 'pump' : weapon === 'bow' ? null : 'reload_rifle';
      if (name && rec(name, 0.5, 0, weapon === 'sniper' ? 0.85 : 1.15)) return;
      play('reload', { volume: 0.55 });
    },
    pickup() { if (!ready) return S.pickup(); play('pickup', { volume: 0.5 }); },
    coin() { if (!ready) return S.pickup(); play('coin', { volume: 0.4 }); },
    ui() { if (!ready) return S.ui(); play('select-soft', { volume: 0.5 }); },
    victory() { if (!ready) return S.victory(); play('victory', { volume: 0.8 }); },
    liberate() { if (!ready) return S.liberate(); play('achievement', { volume: 0.7 }); },
    levelUp() { if (!ready) return S.levelUp(); play('level-up', { volume: 0.6 }); },
    radio() { if (!ready) return S.radio(); play('static-burst', { volume: 0.18 }); },
    bow() { if (!ready) return S.whoosh(0.6); play('bow-twang', { volume: 0.5 }); },
    quest() { play('quest-new', { volume: 0.55 }); },
    siren(vol) { if (!ready) return S.siren(vol); play('siren', { volume: Math.min(1, vol), voices: 1 }); setTimeout(() => play('alarm', { volume: vol * 0.7 }), 800); },
    growl(vol, pos) { if (!ready) return S.growl(vol); const w = pos ? where(pos, 70) : { volume: vol, pan: 0 }; play(Math.random() < 0.5 ? 'growl-small' : 'dog-bark', { volume: w.volume * 0.9, rate: 0.7, pan: w.pan, cooldown: 0.5 }); },
    creatureDie(pos) { const w = where(pos, 80); play('creature-die', { volume: w.volume * 0.7, rate: 0.8, pan: w.pan }); },
    horn() { if (!ready) return S.horn(); play('car-horn', { volume: 0.6, cooldown: 0.4 }); },
    crash(vol) { if (!ready) return S.crash(vol); play('car-crash', { volume: vol }); },
    screech(vol) { play('tire-screech', { volume: vol, cooldown: 1.2, voices: 1 }); },
    ricochet(pos) { const w = where(pos, 60); if (Math.random() < 0.4) play('ricochet', { volume: w.volume * 0.35, pan: w.pan, cooldown: 0.15 }); },
    impact(pos) { const w = where(pos, 50); play('thud', { volume: w.volume * 0.25, pan: w.pan, cooldown: 0.05 }); },
    splash(pos) { const w = where(pos, 60); play('splash', { volume: w.volume * 0.6, pan: w.pan }); },
    heartbeat() { play('heartbeat', { volume: 0.35, cooldown: 0.9, voices: 1 }); },
    step(surface, vol) {
      if (!ready) return S.step(vol);
      const pre = STEP_REC[surface], now = performance.now();
      if (pre && REC[pre + '0'] && now > stepCool) {
        stepCool = now + 110;
        if (rec(pre + Math.floor(Math.random() * 6), (surface === 'sand' ? 0.5 : 0.32) * vol, FC.rand(-0.08, 0.08), FC.rand(0.92, 1.08))) return;
      }
      play('step-' + surface, { volume: 0.18 * vol, cooldown: 0.12, voices: 2, rate: FC.rand(0.92, 1.08) });
    },
    // looping beds: started/stopped by intensity; engines retune with speed
    loop(key, name, on, vol, rate) {
      if (!ready) return;
      if (key === 'rain' && REC.rain_loop) { recLoop('rain', 'rain_loop', on, vol * 1.4); return; }
      const v = loops[key];
      if (on && !v) loops[key] = play(name, { volume: vol, loop: true, rate: rate || 1 });
      else if (!on && v) { v.stop(0.8); delete loops[key]; }
      else if (on && v && rate) v.rate(rate);
    },
    stopLoops() { for (const k in loops) { loops[k].stop(0.3); delete loops[k]; } for (const k in recLoops) recLoop(k, null, false); },
    // close lightning strike: recorded thunder clap (InspectorJ, CC BY 4.0) delayed by distance
    thunder(dist) {
      const d = dist || 300;
      if (rec('thunder_close', FC.clamp(1.1 - d / 900, 0.25, 1), 0, d > 400 ? 0.85 : 1, Math.min(3, d / 340))) return;
      play(d < 400 ? 'thunder-crack' : 'thunder-far', { volume: 0.7 });
    },
    ambient(name, vol) { if (ready) play(name, { volume: vol, cooldown: 0.5, rate: FC.rand(0.9, 1.1) }); },
    music(i) { S.music(i); },
    birds(v) { if (ready) play('bird-chirp', { volume: 0.25 * v, rate: FC.rand(0.85, 1.25), pan: FC.rand(-0.8, 0.8), cooldown: 0.3 }); else S.birds(v); },
    crickets(v) { if (ready) play('frog-croak', { volume: 0.12 * v, rate: FC.rand(0.8, 1.2), pan: FC.rand(-0.8, 0.8), cooldown: 0.3 }); else S.crickets(v); },
  };
  return A;
})();
