'use strict';
// Fallback synthesized sound effects (used when plinkfx is unavailable) + streamed music.
FC.Synth = (function () {
  let ctx = null, out = null, noise = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    out = ctx.createDynamicsCompressor();
    out.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ambient();
  }

  function burst(o) {
    if (!ctx || !(o.vol > 0.004)) return;
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    f.Q.value = o.q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.dur + 0.05);
  }

  function tone(o) {
    if (!ctx || !(o.vol > 0.004)) return;
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  function ambient() {
    // surf / wind bed
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(); lfo.start();
  }

  return {
    init,
    get ready() { return !!ctx; },
    shot(kind, vol) {
      vol = vol === undefined ? 1 : vol;
      if (kind === 'pistol') {
        burst({ type: 'bandpass', freq: 1400, freqEnd: 350, q: 1.4, dur: 0.1, vol: 0.45 * vol });
        tone({ type: 'triangle', freq: 220, freqEnd: 90, dur: 0.08, vol: 0.15 * vol });
      } else if (kind === 'sniper') {
        burst({ freq: 4500, freqEnd: 150, dur: 0.7, vol: 1.0 * vol });
        burst({ freq: 140, dur: 0.35, vol: 0.9 * vol });
        burst({ type: 'bandpass', freq: 700, freqEnd: 200, dur: 1.4, vol: 0.25 * vol, delay: 0.12 });
      } else if (kind === 'heavy') {
        burst({ freq: 2200, freqEnd: 200, dur: 0.4, vol: 0.9 * vol });
        burst({ freq: 160, dur: 0.25, vol: 0.9 * vol });
      } else {
        burst({ freq: 3800, freqEnd: 300, dur: 0.24, vol: 0.75 * vol });
        burst({ freq: 200, dur: 0.16, vol: 0.7 * vol });
      }
    },
    explosion(vol) {
      vol = vol === undefined ? 1 : vol;
      burst({ freq: 1100, freqEnd: 50, dur: 1.6, vol: 1.0 * vol, attack: 0.01 });
      burst({ freq: 120, dur: 0.9, vol: 1.0 * vol });
    },
    glass(vol) {
      burst({ type: 'highpass', freq: 3500, dur: 0.18, vol: 0.5 * vol });
      burst({ type: 'bandpass', freq: 400, freqEnd: 1800, dur: 0.7, vol: 0.4 * vol, delay: 0.05 });
    },
    whoosh(vol) { burst({ type: 'bandpass', freq: 300, freqEnd: 1200, dur: 0.35, vol: 0.25 * vol }); },
    hit() { tone({ type: 'square', freq: 1900, dur: 0.04, vol: 0.07 }); },
    kill() {
      tone({ type: 'square', freq: 1500, dur: 0.06, vol: 0.08 });
      tone({ type: 'square', freq: 2300, dur: 0.08, vol: 0.08, delay: 0.06 });
    },
    takedown() { burst({ freq: 380, dur: 0.18, vol: 0.7 }); tone({ freq: 90, dur: 0.15, vol: 0.3 }); },
    hurt() { burst({ freq: 260, dur: 0.16, vol: 0.4 }); },
    click() { tone({ type: 'square', freq: 800, dur: 0.03, vol: 0.06 }); },
    pickup() { tone({ freq: 660, freqEnd: 990, dur: 0.14, vol: 0.15 }); },
    ui() { tone({ type: 'triangle', freq: 520, freqEnd: 780, dur: 0.12, vol: 0.15 }); },
    victory() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.5, vol: 0.18, delay: i * 0.16 }));
    },
    liberate() {
      [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.4, vol: 0.16, delay: i * 0.12 }));
    },
    growl(vol) { if (vol > 0.02) { tone({ type: 'sawtooth', freq: 110, freqEnd: 70, dur: 0.6, vol: 0.12 * vol }); burst({ freq: 300, dur: 0.6, vol: 0.2 * vol }); } },
    horn() { tone({ type: 'square', freq: 392, dur: 0.35, vol: 0.12 }); tone({ type: 'square', freq: 494, dur: 0.35, vol: 0.1 }); },
    crash(vol) { burst({ freq: 900, freqEnd: 120, dur: 0.5, vol: 0.8 * vol }); },
    radio() { burst({ type: 'bandpass', freq: 2500, q: 3, dur: 0.12, vol: 0.12 }); tone({ type: 'square', freq: 1200, dur: 0.05, vol: 0.04 }); },
    levelUp() { [523, 784, 1046, 1318].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.25, vol: 0.12, delay: i * 0.08 })); },
    step(vol) { burst({ freq: 500, dur: 0.06, vol: 0.05 * vol }); },
    // combat music: streamed mp3 (works from file:// and http)
    music(intensity) {
      if (!ctx) return;
      if (!this._music) {
        const a = new Audio('assets/audio/combat.mp3'); a.loop = true; a.volume = 0;
        this._music = a; this._musicVol = 0;
      }
      const target = intensity * 0.32;
      this._musicVol += (target - this._musicVol) * 0.02;
      if (this._musicVol > 0.005 && this._music.paused) this._music.play().catch(() => {});
      if (this._musicVol < 0.004 && !this._music.paused) this._music.pause();
      this._music.volume = Math.max(0, Math.min(1, this._musicVol));
    },
    birds(vol) { if (vol > 0.02) { const f = 2400 + Math.random() * 1600; tone({ freq: f, freqEnd: f * 1.3, dur: 0.09, vol: 0.03 * vol }); tone({ freq: f * 1.1, freqEnd: f * 0.9, dur: 0.08, vol: 0.025 * vol, delay: 0.12 }); } },
    crickets(vol) { if (vol > 0.02) for (let i = 0; i < 3; i++) tone({ type: 'square', freq: 4200, dur: 0.02, vol: 0.006 * vol, delay: i * 0.05 }); },
    siren(vol) {
      if (!ctx || vol < 0.01) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12 * vol, t + 0.1);
      g.gain.setValueAtTime(0.12 * vol, t + 4.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
      osc.frequency.setValueAtTime(520, t);
      for (let k = 0; k < 6; k++) {
        osc.frequency.linearRampToValueAtTime(880, t + k * 0.8 + 0.4);
        osc.frequency.linearRampToValueAtTime(520, t + k * 0.8 + 0.8);
      }
      osc.connect(f); f.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + 5.1);
    },
  };
})();
