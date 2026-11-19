'use strict';
// Extra game modes: Survival (defend Driftwood Camp against waves), Versus (split-screen deathmatch)
// and Ghost Run (timed stealth challenge on Saltmarsh Dock). Campaign is the default.
FC.Modes = (function () {
  const M = { mode: 'campaign', wave: 0, breakT: 0, waveEnemies: [], over: false, score: [0, 0], timer: 0 };
  const best = (k) => { try { return JSON.parse(localStorage.getItem('feralcoast_best') || '{}')[k]; } catch (e) { return undefined; } };
  const setBest = (k, v) => { try { const b = JSON.parse(localStorage.getItem('feralcoast_best') || '{}'); b[k] = v; localStorage.setItem('feralcoast_best', JSON.stringify(b)); } catch (e) { /* ignore */ } };

  function clearAround(G, x, z, r) {
    for (const e of G.enemies) if (e.alive && Math.hypot(e.pos.x - x, e.pos.z - z) < r) { e.alive = false; e.rig.root.visible = false; e.deadT = 999; }
    for (const a of G.animals) if (a.alive && a.hostile && Math.hypot(a.pos.x - x, a.pos.z - z) < r + 80) { a.alive = false; a.rig.root.visible = false; }
  }

  function start(G, mode) {
    M.mode = mode; G.mode = mode;
    const W = FC.World;
    if (mode === 'survival') {
      W.start.patrol = W.start.patrol || [];
      clearAround(G, W.start.x, W.start.z, 250);
      FC.Features.garrison(G, W.start, 3);
      M.wave = 0; M.breakT = 12; M.over = false;
      G.announce('SURVIVAL — hold Driftwood Camp. Trade at the chest between waves.', '#ffd166', 6);
    } else if (mode === 'versus') {
      const op = W.outposts[3];
      M.arena = op; M.score = [0, 0]; M.timer = 8 * 60; M.over = false;
      clearAround(G, op.x, op.z, op.r + 60);
      G.players.forEach((p, i) => { versusSpawn(G, p, i); p.owned.add('shotgun'); p.owned.add('sniper'); p.prog.cash = 0; });
      G.announce(`VERSUS — first to 10 kills at ${op.name}`, '#ff9f43', 6);
    } else if (mode === 'ghost') {
      const op = W.outposts[0];
      M.target = op; M.timer = 0; M.over = false;
      G.players.forEach((p, i) => { const s = W.landPoint(op.x + 90, op.z + 40, 0, 8 + i * 3); p.spawnAt(s.x, s.z); p.yaw = FC.yawTo(op.x - s.x, op.z - s.z); p.owned.add('knives'); });
      const b = best('ghost');
      G.announce(`GHOST RUN — liberate ${op.name} without raising the alarm${b ? ` · best ${fmt(b)}` : ''}`, '#9be7e1', 6);
    }
  }
  function fmt(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }

  function versusSpawn(G, p, i) {
    const op = M.arena, a = (i === undefined ? Math.random() : i * 0.5) * Math.PI * 2 + Math.random() * 0.8;
    const s = FC.World.landPoint(op.x + Math.cos(a) * op.r * 0.8, op.z + Math.sin(a) * op.r * 0.8, 0, 6);
    p.spawnAt(s.x, s.z); p.yaw = FC.yawTo(op.x - s.x, op.z - s.z);
    for (const k of ['pistol', 'rifle', 'shotgun', 'sniper', 'bow']) { const w = FC.WEAPONS[k]; p.ammo[k].mag = w.mag; p.ammo[k].reserve = w.reserve; }
    p.ammo.grenade.mag = 1; p.owned.add('grenade');
  }

  function spawnWave(G) {
    const W = FC.World, S = W.start;
    M.wave++;
    const n = 4 + M.wave * 2, heavies = Math.floor(M.wave / 3);
    M.waveEnemies = [];
    const dir = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = dir + FC.rand(-0.9, 0.9);
      const p = W.landPoint(S.x + Math.cos(a) * 150, S.z + Math.sin(a) * 150, 0, 25);
      const e = new FC.Enemy(i < heavies ? 'heavy' : 'grunt', p.x, p.z, null, FC.Expansion.scene || null);
      e.state = 'alert'; e.lastKnown = new THREE.Vector3(S.x, S.y, S.z); e.aimT = 1.5; e.attacker = true;
      G.enemies.push(e); M.waveEnemies.push(e);
    }
    if (M.wave % 3 === 0) { FC.Expansion.reinforce(G, S); for (const t of FC.Expansion.trucks.slice(-2)) M.waveEnemies.push(...t.guards); }
    if (M.wave % 4 === 0) { const b = W.landPoint(S.x, S.z, 120, 160); for (let i = 0; i < 3; i++) G.animals.push(new FC.Animal('wolf', b.x + i, b.z, FC.Expansion.scene)); }
    G.announce(`WAVE ${M.wave} — ${M.waveEnemies.length} Ashen Tide incoming`, '#ff6b6b', 4);
    FC.Audio.siren(0.5);
  }

  function update(dt, G) {
    if (M.mode === 'survival' && !M.over) {
      const alive = M.waveEnemies.filter((e) => e.alive).length;
      if (alive === 0) {
        if (M.breakT <= 0 && M.wave > 0) {
          M.breakT = 25;
          G.announce(`Wave ${M.wave} cleared! 25 s to resupply`, '#7bed9f', 4);
          for (const p of G.players) { FC.Progression.cash(p, 100 + M.wave * 40, `Wave ${M.wave}`, G); FC.Progression.xp(p, 60 + M.wave * 20, 'Wave', G); if (p.state === 'dead') G.respawn(p); }
        }
        M.breakT -= dt;
        if (M.breakT <= 0) spawnWave(G);
      }
      if (G.players.every((p) => p.state !== 'alive')) end(G, `Driftwood Camp fell on wave ${M.wave}`, 'survival', M.wave, true);
    }
    if (M.mode === 'versus' && !M.over) {
      M.timer -= dt;
      const top = Math.max(...M.score);
      if (top >= 10 || M.timer <= 0) {
        const w = M.score[0] === M.score[1] ? 'Draw!' : `${G.players[M.score[0] > M.score[1] ? 0 : 1].name} wins ${Math.max(...M.score)}–${Math.min(...M.score)}`;
        end(G, w, null);
      }
    }
    if (M.mode === 'ghost' && !M.over) {
      M.timer += dt;
      if (M.target.alarmTriggered) end(G, 'Alarm raised — Ghost Run failed', null);
      else if (M.target.liberated) {
        const t = M.timer, medal = t < 180 ? 'GOLD' : t < 300 ? 'SILVER' : 'BRONZE';
        const prev = best('ghost');
        if (!prev || t < prev) setBest('ghost', t);
        end(G, `${medal} — Saltmarsh Dock taken in ${fmt(t)}${M.target.alerted ? '' : ', completely unseen'}`, null);
      }
    }
  }
  function onPlayerKilled(G, victim, killer) {
    if (M.mode !== 'versus' || M.over) return false;
    if (killer && killer !== victim) M.score[killer.index]++;
    else M.score[victim.index] = Math.max(0, M.score[victim.index] - 1);
    G.announce(`${killer && killer !== victim ? killer.name + ' fragged ' : ''}${victim.name}${killer && killer !== victim ? '' : ' self-destructed'}`, '#ff9f43', 2.5);
    victim.state = 'dead'; victim.respawnTimer = 3;
    victim.respawnHook = () => versusSpawn(G, victim);
    return true;
  }
  function end(G, msg, bestKey, val, higher) {
    M.over = true;
    if (bestKey) { const b = best(bestKey); if (b === undefined || (higher ? val > b : val < b)) setBest(bestKey, val); }
    G.modeResult = msg;
    G.victoryT = 2.5;
  }
  function hud(G, p, rect, s, text) {
    const cx = rect.x + rect.w / 2, y = rect.y + 64 * s;
    if (M.mode === 'survival') text(M.waveEnemies.filter((e) => e.alive).length ? `WAVE ${M.wave} · ${M.waveEnemies.filter((e) => e.alive).length} left` : `Next wave in ${Math.max(0, Math.ceil(M.breakT))} s`, cx, y, 14 * s, '#ffd166', 'center');
    if (M.mode === 'versus') text(`${G.players[0].name} ${M.score[0]}  —  ${M.score[1]} ${G.players[1] ? G.players[1].name : ''}   ·   ${fmt(Math.max(0, M.timer))}`, cx, y, 15 * s, '#ff9f43', 'center');
    if (M.mode === 'ghost') text(`GHOST RUN ${fmt(M.timer)}${M.target.alerted ? ' · spotted!' : ''}`, cx, y, 14 * s, M.target.alerted ? '#ff9f43' : '#9be7e1', 'center');
  }
  return Object.assign(M, { start, update, hud, onPlayerKilled, best, fmt });
})();
