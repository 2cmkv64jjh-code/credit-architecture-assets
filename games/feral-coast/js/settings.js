'use strict';
// Player settings (persisted per browser): field of view, sensitivity, invert-Y, audio, subtitles,
// colour-blind palette, FPS counter, rumble. Builds its own panel inside the pause and title menus.
FC.Settings = (function () {
  const KEY = 'feralcoast_settings_v1';
  const DEF = { fov: 92, sensMouse: 1, sensPad: 1, invertY: false, master: 0.8, music: 0.6, subs: 1, colorblind: false, showFps: false, rumble: true };
  let S = Object.assign({}, DEF);
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* defaults */ }
  const listeners = [];
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } listeners.forEach((f) => f(S)); }

  const ROWS = [
    ['fov', 'Field of view', 'range', 70, 110, 1, (v) => `${v}°`],
    ['sensMouse', 'Mouse sensitivity', 'range', 0.3, 2.5, 0.05, (v) => v.toFixed(2)],
    ['sensPad', 'Gamepad / keyboard look speed', 'range', 0.3, 2.5, 0.05, (v) => v.toFixed(2)],
    ['invertY', 'Invert look Y', 'check'],
    ['master', 'Master volume', 'range', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
    ['music', 'Music volume', 'range', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
    ['subs', 'Subtitle / HUD text size', 'range', 0.8, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`],
    ['colorblind', 'Colour-blind friendly markers', 'check'],
    ['showFps', 'Show FPS counter', 'check'],
    ['rumble', 'Gamepad rumble', 'check'],
  ];
  function buildPanel(host) {
    const wrap = document.createElement('div');
    wrap.className = 'settings';
    for (const [k, label, type, min, max, step, fmt] of ROWS) {
      const row = document.createElement('label');
      row.className = 'srow';
      const name = document.createElement('span'); name.textContent = label; row.appendChild(name);
      const input = document.createElement('input');
      input.type = type === 'check' ? 'checkbox' : 'range';
      const val = document.createElement('span'); val.className = 'sval';
      if (type === 'check') input.checked = !!S[k];
      else { input.min = min; input.max = max; input.step = step; input.value = S[k]; val.textContent = fmt(S[k]); }
      input.addEventListener('input', () => {
        S[k] = type === 'check' ? input.checked : parseFloat(input.value);
        if (fmt) val.textContent = fmt(S[k]);
        save();
      });
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      row.appendChild(input); row.appendChild(val);
      wrap.appendChild(row);
    }
    host.appendChild(wrap);
  }
  // colour helpers so HUD markers stay readable for red/green colour blindness
  function enemyColor(alerted) { return S.colorblind ? (alerted ? '#ff7a00' : '#ffd166') : (alerted ? '#ff3b30' : '#ffd166'); }
  function friendColor() { return S.colorblind ? '#3aa0ff' : '#3fd0c9'; }
  return { get: () => S, save, buildPanel, onChange: (f) => listeners.push(f), enemyColor, friendColor };
})();
