'use strict';
// Input devices: 'kbm' (keyboard left side + mouse), 'kb2' (keyboard right side), 'padN' (gamepad N).
FC.Input = (function () {
  const keys = new Set();
  const mbtn = new Set();
  let mdx = 0, mdy = 0, wheel = 0, locked = false, canvasEl = null;
  const keyListeners = [];
  let lockListener = null;
  const padPrev = {}; // idx -> array of bools
  const padNow = {};

  const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter',
    'Backspace', 'ShiftRight', 'ControlLeft', 'KeyQ', 'KeyF', 'Period', 'KeyM']);

  function init(canvas) {
    canvasEl = canvas;
    addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys.add(e.code);
      keyListeners.forEach((f) => f(e.code));
    });
    addEventListener('keyup', (e) => keys.delete(e.code));
    addEventListener('blur', () => { keys.clear(); mbtn.clear(); });
    addEventListener('mousemove', (e) => {
      if (locked) { mdx += e.movementX; mdy += e.movementY; }
    });
    addEventListener('mousedown', (e) => mbtn.add(e.button));
    addEventListener('mouseup', (e) => mbtn.delete(e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvasEl;
      if (lockListener) lockListener(locked);
    });
  }

  function pads() {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  }

  function update() {
    const list = pads();
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      padPrev[i] = padNow[i] || [];
      padNow[i] = gp ? gp.buttons.map((b) => b.pressed || b.value > 0.4) : [];
    }
  }
  function padJust(idx, btn) {
    return !!(padNow[idx] && padNow[idx][btn] && !(padPrev[idx] && padPrev[idx][btn]));
  }
  function endFrame() { mdx = 0; mdy = 0; wheel = 0; }

  const LABELS = {
    kbm: { interact: 'E', tag: 'Q', heal: 'F', reload: 'R', fire: 'LMB', next: 'Wheel', map: 'M', back: 'Esc/M', confirm: 'LMB/Space', tab: 'Q' },
    kb2: { interact: 'U', tag: 'Y', heal: '9', reload: 'O', fire: 'Enter', next: 'P', map: '.', back: 'Backspace', confirm: 'Enter', tab: 'Y' },
    pad: { interact: 'RB', tag: 'LB', heal: 'D-Up', reload: 'X', fire: 'RT', next: 'Y', map: 'Back', back: 'B', confirm: 'A', tab: 'LB' },
  };

  class Controller {
    constructor(device) {
      this.device = device;
      this.padIndex = device.startsWith('pad') ? parseInt(device.slice(3), 10) : -1;
      this.prev = {};
      this.sens = 0.0022;
      this.labels = LABELS[this.padIndex >= 0 ? 'pad' : device];
      this.usesMouse = device === 'kbm';
    }
    poll(dt) {
      const s = { mx: 0, my: 0, lx: 0, ly: 0 };
      const k = (c) => keys.has(c);
      if (this.device === 'kbm') {
        s.mx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
        s.my = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
        s.lx = mdx * this.sens; s.ly = mdy * this.sens;
        s.fire = locked && mbtn.has(0); s.aim = locked && mbtn.has(2);
        s.reload = k('KeyR'); s.jump = k('Space'); s.crouch = k('KeyC') || k('ControlLeft');
        s.sprint = k('ShiftLeft'); s.interact = k('KeyE'); s.tag = k('KeyQ'); s.heal = k('KeyF');
        s.slot0 = k('Digit1'); s.slot1 = k('Digit2'); s.slot2 = k('Digit3'); s.slot3 = k('Digit4'); s.slot4 = k('Digit5'); s.slot5 = k('Digit6');
        s.map = k('KeyM') || k('Tab'); s.back = k('Escape');
        s.wheelNext = wheel > 0; s.wheelPrev = wheel < 0;
        s.pause = false; // Escape is handled through pointer-lock loss
      } else if (this.device === 'kb2') {
        s.mx = (k('KeyL') ? 1 : 0) - (k('KeyJ') ? 1 : 0);
        s.my = (k('KeyI') ? 1 : 0) - (k('KeyK') ? 1 : 0);
        s.lx = ((k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0)) * 2.4 * dt;
        s.ly = ((k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0)) * 1.7 * dt;
        s.fire = k('Enter') || k('NumpadEnter'); s.aim = k('ShiftRight');
        s.reload = k('KeyO'); s.jump = k('KeyH'); s.crouch = k('KeyN'); s.sprint = k('KeyM');
        s.interact = k('KeyU'); s.tag = k('KeyY'); s.next = k('KeyP'); s.heal = k('Digit9'); s.map = k('Period'); s.back = k('Backspace');
        s.pause = k('Backspace');
      } else {
        const gp = pads()[this.padIndex];
        if (gp) {
          const ax = gp.axes;
          let mx = ax[0] || 0, my = -(ax[1] || 0);
          const m = Math.hypot(mx, my);
          if (m < 0.18) { mx = 0; my = 0; } else {
            const sc = Math.min(1, (m - 0.18) / 0.8) / m; mx *= sc; my *= sc;
          }
          s.mx = mx; s.my = my;
          let lx = ax[2] || 0, ly = ax[3] || 0;
          const lm = Math.hypot(lx, ly);
          if (lm < 0.15) { lx = 0; ly = 0; } else {
            const c = Math.min(1, (lm - 0.15) / 0.85); const sc = (c * c) / lm; lx *= sc; ly *= sc;
          }
          s.lx = lx * 3.3 * dt; s.ly = ly * 2.3 * dt;
          const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.35));
          s.jump = b(0); s.crouch = b(1); s.reload = b(2); s.next = b(3); s.tag = b(4); s.interact = b(5);
          s.aim = b(6); s.fire = b(7); s.pause = b(9); s.sprint = b(10); s.heal = b(12);
          s.prevW = b(14); s.nextD = b(15); s.map = b(8); s.back = b(1); s.dDown = b(13);
        }
      }
      const edges = {};
      for (const n of ['fire', 'reload', 'jump', 'crouch', 'interact', 'tag', 'heal', 'pause', 'next',
        'slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'sprint', 'prevW', 'nextD', 'map', 'back', 'aim']) {
        edges[n] = !!s[n] && !this.prev[n];
      }
      edges.next = edges.next || !!s.wheelNext || edges.nextD;
      edges.prev = !!s.wheelPrev || edges.prevW;
      this.prev = s;
      s.pressed = edges;
      return s;
    }
  }

  return {
    init, update, endFrame, pads, padJust, Controller,
    onKey(f) { keyListeners.push(f); },
    onLockChange(f) { lockListener = f; },
    get locked() { return locked; },
    lock() { if (canvasEl && canvasEl.requestPointerLock) { try { canvasEl.requestPointerLock(); } catch (e) { /* ignore */ } } },
    unlock() { if (document.exitPointerLock) document.exitPointerLock(); },
  };
})();
