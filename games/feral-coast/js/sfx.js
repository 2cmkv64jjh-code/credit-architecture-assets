'use strict';
// Sound facade. Uses plinkfx (CC0 game sound effects rendered from code, https://github.com/maximilianfeix/plinkfx)
// for nearly everything, with positional volume/pan, surface footsteps, engine/rain/wind loops and ambience.
// Falls back to FC.Synth (our own synthesizer) if plinkfx is missing.
FC.Audio = (function () {
  const P = window.PLINK || null;
  const S = FC.Synth;
  let ready = false;
  const loops = {};

  function play(name, o) {
    if (!P || !ready) return null;
    try { return P.play(name, o); } catch (e) { return null; }
  }
  function init() {
    S.init();
    if (P && !ready) {
      try {
        P.unlockAudio();
        P.volume(0.8);
        ready = true;
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
    reload() { if (!ready) return S.click(); play('reload', { volume: 0.55 }); },
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
      play('step-' + surface, { volume: 0.18 * vol, cooldown: 0.12, voices: 2, rate: FC.rand(0.92, 1.08) });
    },
    // looping beds: started/stopped by intensity; engines retune with speed
    loop(key, name, on, vol, rate) {
      if (!ready) return;
      const v = loops[key];
      if (on && !v) loops[key] = play(name, { volume: vol, loop: true, rate: rate || 1 });
      else if (!on && v) { v.stop(0.8); delete loops[key]; }
      else if (on && v && rate) v.rate(rate);
    },
    stopLoops() { for (const k in loops) { loops[k].stop(0.3); delete loops[k]; } },
    ambient(name, vol) { if (ready) play(name, { volume: vol, cooldown: 0.5, rate: FC.rand(0.9, 1.1) }); },
    music(i) { S.music(i); },
    birds(v) { if (ready) play('bird-chirp', { volume: 0.25 * v, rate: FC.rand(0.85, 1.25), pan: FC.rand(-0.8, 0.8), cooldown: 0.3 }); else S.birds(v); },
    crickets(v) { if (ready) play('frog-croak', { volume: 0.12 * v, rate: FC.rand(0.8, 1.2), pan: FC.rand(-0.8, 0.8), cooldown: 0.3 }); else S.crickets(v); },
  };
  return A;
})();
