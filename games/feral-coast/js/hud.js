'use strict';
// 2D overlay drawn per split-screen viewport: combat HUD, compass, minimap, missions, menus (map / skills / shop).
FC.HUD = (function () {
  let cv, ctx, dpr = 1, fogC = null;
  const FONT = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  const v3 = new THREE.Vector3();

  function init(canvas) { cv = canvas; ctx = cv.getContext('2d'); }
  function resize(w, h, ratio) { dpr = ratio; cv.width = Math.round(w * ratio); cv.height = Math.round(h * ratio); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  function clear() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
  function project(p, pos, rect) {
    v3.copy(pos).project(p.cam);
    if (v3.z > 1 || v3.z < -1) return null;
    return { x: rect.x + (v3.x * 0.5 + 0.5) * rect.w, y: rect.y + (1 - (v3.y * 0.5 + 0.5)) * rect.h };
  }
  function text(s, x, y, size, color, align, weight) {
    ctx.font = `${weight || 700} ${size}px ${FONT}`;
    ctx.textAlign = align || 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(s, x + 1.5, y + 1.5);
    ctx.fillStyle = color || '#fff'; ctx.fillText(s, x, y);
  }
  function panel(x, y, w, h, a) { ctx.fillStyle = `rgba(8,12,14,${a || 0.55})`; ctx.fillRect(x, y, w, h); }
  function diamond(x, y, r, fill) {
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  const relAngle = (p, x, z) => -FC.wrapAngle(FC.yawTo(x - p.pos.x, z - p.pos.z) - p.yaw); // + = right
  const poiColor = (poi) => poi.kind === 'camp' ? '#3fd0c9' : poi.kind === 'tower' ? (poi.hacked ? '#3fd0c9' : '#ffb35c') : poi.kind === 'village' ? (poi.fast ? '#9be7a1' : '#d8c8a0') : poi.kind === 'ledger' ? '#ffd166' : poi.liberated ? '#3fd0c9' : '#ff5a4f';

  function draw(G, p, rect) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const s = Math.min(1.25, Math.max(0.7, Math.min(rect.w, rect.h) / 620)) * FC.Settings.get().subs;
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    if (p.menu) { drawMenu(G, p, rect, s); ctx.restore(); return; }
    const w = FC.WEAPONS[p.weapon];
    const scoped = w.scope && p.aimT > 0.85 && p.alive;

    // ---------------- world markers
    const mt = FC.Missions.target(G);
    if (mt) {
      const sp = project(p, v3.set(mt.x, (mt.y || FC.World.heightAt(mt.x, mt.z)) + 6, mt.z).clone(), rect);
      if (sp) { diamond(sp.x, sp.y, 7 * s, '#ffd166'); text(`${Math.round(Math.hypot(mt.x - p.pos.x, mt.z - p.pos.z))}m`, sp.x, sp.y - 11 * s, 11 * s, '#ffd166', 'center'); }
    }
    const wp = G.waypoints[p.index];
    if (wp) {
      const sp = project(p, v3.set(wp.x, FC.World.heightAt(wp.x, wp.z) + 3, wp.z).clone(), rect);
      if (sp) { ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sp.x, sp.y, 7 * s, 0, 7); ctx.stroke(); text(`${Math.round(Math.hypot(wp.x - p.pos.x, wp.z - p.pos.z))}m`, sp.x, sp.y - 11 * s, 10 * s, p.color, 'center'); }
    }
    for (const op of FC.World.outposts) {
      const d = Math.hypot(op.x - p.pos.x, op.z - p.pos.z);
      if (d < op.r * 0.8 || d > 300 || !G.isRevealed(op.x, op.z)) continue;
      const sp = project(p, v3.set(op.x, op.y + 13, op.z).clone(), rect);
      if (!sp) continue;
      const col = op.liberated ? '#3fd0c9' : '#ff5a4f';
      ctx.fillStyle = col; ctx.fillRect(sp.x - 1, sp.y - 14 * s, 2, 16 * s);
      ctx.beginPath(); ctx.moveTo(sp.x + 1, sp.y - 14 * s); ctx.lineTo(sp.x + 12 * s, sp.y - 10 * s); ctx.lineTo(sp.x + 1, sp.y - 6 * s); ctx.fill();
      text(`${op.name} ${Math.round(d)}m`, sp.x, sp.y + 14 * s, 11 * s, col, 'center', 600);
    }
    for (const e of G.enemies) {
      if (!e.alive || e.dormant) continue;
      if (e.glint && e.sees[p.index]) {
        const sp = project(p, e.headPos, rect);
        if (sp && Math.sin(G.time * 18) > -0.2) { ctx.fillStyle = 'rgba(255,60,40,0.9)'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 4 * s, 0, 7); ctx.fill(); }
      }
      if (!e.tagged) continue;
      const sp = project(p, e.headPos.add(v3.set(0, 0.5, 0)), rect);
      if (!sp) continue;
      const col = e.alerted ? FC.Settings.enemyColor(true) : e.state === 'patrol' ? '#ffd166' : '#ff9f43';
      diamond(sp.x, sp.y, 6 * s, col);
      const d = e.pos.distanceTo(p.pos);
      if (d > 15) text(`${Math.round(d)}`, sp.x, sp.y - 9 * s, 10 * s, col, 'center', 600);
      if (e.type !== 'grunt') text(e.type === 'boss' ? 'VAEL' : e.type.toUpperCase(), sp.x, sp.y + 18 * s, 9 * s, col, 'center');
    }
    for (const ping of G.pings) {
      const sp = project(p, ping.pos, rect);
      if (!sp) continue;
      ctx.strokeStyle = ping.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp.x, sp.y, 7 * s, 0, 7); ctx.stroke();
      text(`${Math.round(ping.pos.distanceTo(p.pos))}m`, sp.x, sp.y - 11 * s, 10 * s, ping.color, 'center');
    }
    for (const z of FC.Expansion.ziplines) {
      const d = Math.hypot(z.A.x - p.pos.x, z.A.z - p.pos.z);
      if (d > 45 || p.zip) continue;
      const sp = project(p, z.A, rect);
      if (sp) text('⇘ zipline', sp.x, sp.y - 4, 10 * s, '#9be7e1', 'center', 600);
    }
    for (const q of G.players) {
      const cp = q.companion;
      if (!cp || cp.pos.distanceTo(p.pos) > 120) continue;
      const sp = project(p, v3.set(cp.pos.x, cp.pos.y + 1.6, cp.pos.z).clone(), rect);
      if (sp) text(cp.alive ? cp.name : `${cp.name} (hurt)`, sp.x, sp.y, 10 * s, cp.alive ? '#d8c8a0' : '#ff8a80', 'center', 600);
    }
    for (const pr of FC.Expansion.prisoners) {
      if (!pr.alive || !pr.captive || pr.pos.distanceTo(p.pos) > 80) continue;
      const sp = project(p, v3.set(pr.pos.x, pr.pos.y + 1.8, pr.pos.z).clone(), rect);
      if (sp) text('✋ prisoner', sp.x, sp.y, 10 * s, '#ffd166', 'center', 600);
    }
    for (const c of G.collectibles) {
      if (c.taken || Math.hypot(c.x - p.pos.x, c.z - p.pos.z) > 40) continue;
      const sp = project(p, v3.set(c.x, c.y + 1.4, c.z).clone(), rect);
      if (sp) text('◆ Ledger', sp.x, sp.y, 10 * s, '#ffd166', 'center');
    }
    const partner = G.players.find((q) => q !== p);
    if (partner) {
      const pp = partner.vehicle ? partner.vehicle.pos : partner.pos;
      const sp = project(p, v3.set(pp.x, pp.y + 2.4, pp.z).clone(), rect);
      if (sp) {
        const down = partner.state === 'downed';
        text(down ? `✚ ${partner.name} DOWN ${Math.ceil(partner.downTimer)}s` : partner.name, sp.x, sp.y, (down ? 13 : 11) * s, down ? '#ff6b6b' : partner.color, 'center');
        if (down && partner.reviveProgress > 0) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sp.x - 30, sp.y + 6, 60, 5); ctx.fillStyle = '#7bed9f'; ctx.fillRect(sp.x - 30, sp.y + 6, 60 * partner.reviveProgress, 5); }
      }
    }

    if (scoped) drawScope(rect, cx, cy, s);
    if (p.binocs) {
      const r2 = Math.min(rect.w, rect.h) * 0.3;
      ctx.save(); ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.moveTo(cx - r2 * 0.55 + r2, cy); ctx.arc(cx - r2 * 0.55, cy, r2, 0, Math.PI * 2, true);
      ctx.moveTo(cx + r2 * 0.55 + r2, cy); ctx.arc(cx + r2 * 0.55, cy, r2, 0, Math.PI * 2, true);
      ctx.fill('evenodd'); ctx.restore();
      text('BINOCULARS — hold to scan, enemies under the reticle get tagged', cx, rect.y + rect.h - 40 * s, 12 * s, '#ddd', 'center', 600);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
    }

    // ---------------- detection meters
    for (const e of G.enemies) {
      if (!e.alive || e.dormant) continue;
      const dv = e.detect[p.index];
      const alerted = e.alerted && e.sees[p.index];
      if (dv < 0.03 && !alerted) continue;
      const a = relAngle(p, e.pos.x, e.pos.z), R = 62 * s;
      ctx.save(); ctx.translate(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, -9 * s); ctx.lineTo(7 * s, 4 * s); ctx.lineTo(-7 * s, 4 * s); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = alerted ? '#ff3b30' : dv > 0.3 ? '#ffb020' : '#ffffff';
      const fh = 13 * s * (alerted ? 1 : dv);
      ctx.fillRect(-8 * s, 4 * s - fh, 16 * s, fh);
      ctx.restore(); ctx.restore();
    }
    for (const d of p.damageDirs) {
      const a = -FC.wrapAngle(d.a - p.yaw);
      ctx.strokeStyle = `rgba(255,40,30,${Math.min(1, d.t) * 0.8})`; ctx.lineWidth = 6 * s;
      ctx.beginPath(); ctx.arc(cx, cy, 95 * s, -Math.PI / 2 + a - 0.3, -Math.PI / 2 + a + 0.3); ctx.stroke();
    }

    // ---------------- crosshair
    if (p.alive && !(p.vehicle && p.seat === 0) && !scoped) {
      if (!w.throwable && p.aimT < 0.9) {
        const gap = (6 + (w.spread || 0) * 400 * (1 - p.aimT) + p.recoil * 300) * s;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - gap - 7 * s, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + 7 * s, cy);
        ctx.moveTo(cx, cy - gap - 7 * s); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + 7 * s);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
      if (w.throwable) { ctx.strokeStyle = 'rgba(255,170,60,0.8)'; ctx.beginPath(); ctx.arc(cx, cy, 10 * s, 0, 7); ctx.stroke(); }
    }
    if (p.hitmarker > 0) {
      ctx.strokeStyle = p.killmarker > 0 ? '#ff3b30' : '#fff'; ctx.lineWidth = 2.5;
      const k = 6 * s, g = 4 * s;
      ctx.beginPath();
      ctx.moveTo(cx - g - k, cy - g - k); ctx.lineTo(cx - g, cy - g); ctx.moveTo(cx + g + k, cy - g - k); ctx.lineTo(cx + g, cy - g);
      ctx.moveTo(cx - g - k, cy + g + k); ctx.lineTo(cx - g, cy + g); ctx.moveTo(cx + g + k, cy + g + k); ctx.lineTo(cx + g, cy + g);
      ctx.stroke();
    }
    // bow draw meter
    if (p.weapon === 'bow' && p.drawT > 0) {
      ctx.strokeStyle = p.drawT >= 1 ? '#ffd166' : 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 16 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.drawT); ctx.stroke();
    }
    if (p.reloadT > 0) {
      const w2 = FC.WEAPONS[p.weapon], tot = (w2.reload || 1) * (p.has('fasthands') ? 0.7 : 1);
      ctx.strokeStyle = 'rgba(255,209,102,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 22 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.reloadT / tot)); ctx.stroke();
    }
    // incoming enemy grenades
    for (const q of G.projectiles) {
      if (!q.enemy) continue;
      const d = q.pos.distanceTo(p.pos);
      if (d > 12) continue;
      const a = relAngle(p, q.pos.x, q.pos.z), R = 110 * s;
      const gx = cx + Math.sin(a) * R, gy = cy - Math.cos(a) * R;
      ctx.fillStyle = d < 6 ? '#ff3b30' : '#ffb020';
      ctx.beginPath(); ctx.arc(gx, gy, 12 * s, 0, 7); ctx.fill();
      text('!', gx, gy + 5 * s, 14 * s, '#000', 'center');
    }
    if (p.gliding) text(`GLIDING · ${Math.max(0, Math.round(p.pos.y - FC.World.heightAt(p.pos.x, p.pos.z)))} m · [jump] release`, cx, cy + 46 * s, 12 * s, '#9be7e1', 'center');
    G.floaters.filter((f) => f.p === p).slice(-4).forEach((f, i) => {
      ctx.globalAlpha = Math.min(1, f.t);
      text(f.text, cx + 30 * s, cy + 30 * s + i * 15 * s - (1.6 - f.t) * 10, 11 * s, f.color || '#ffd166', 'left', 600);
      ctx.globalAlpha = 1;
    });

    // ---------------- bottom-left: vitals
    const pad = 16 * s, bx = rect.x + pad, by = rect.y + rect.h - pad;
    text(`${p.name.toUpperCase()}`, bx, by - 44 * s, 13 * s, p.color);
    text(`LV ${p.prog.level}${p.prog.points ? `  ·  ${p.prog.points} SKILL PT` : ''}`, bx + 58 * s, by - 44 * s, 10 * s, p.prog.points ? '#ffd166' : '#bbb', 'left', 600);
    const segs = Math.round(p.maxHp / 25), segW = 32 * s;
    for (let i = 0; i < segs; i++) {
      const x = bx + i * (segW + 3);
      panel(x, by - 34 * s, segW, 10 * s, 0.5);
      ctx.fillStyle = p.hp < 30 ? '#ff5a4f' : '#e9f5ec';
      ctx.fillRect(x, by - 34 * s, segW * FC.clamp((p.hp - i * 25) / 25, 0, 1), 10 * s);
    }
    const need = FC.Progression.needFor(p.prog.level);
    panel(bx, by - 21 * s, segs * (segW + 3) - 3, 3 * s, 0.5);
    ctx.fillStyle = '#ffd166'; ctx.fillRect(bx, by - 21 * s, (segs * (segW + 3) - 3) * (p.prog.xp / need), 3 * s);
    text(`✚ ${p.medkits} [${p.ctrl.labels.heal}]    $${p.prog.cash}`, bx, by - 3 * s, 11 * s, '#9be7a1', 'left', 600);
    if (p.inBush && p.alive && !p.vehicle) text(p.crouch ? 'HIDDEN' : 'IN COVER', bx + 160 * s, by - 3 * s, 11 * s, '#9be7a1');

    // ---------------- bottom-right: weapon / vehicle
    const ax = rect.x + rect.w - pad;
    if (p.vehicle && p.seat === 0) {
      const v = p.vehicle;
      text(`${Math.round(Math.abs(v.speed) * 3.6)} km/h`, ax, by - 10 * s, 24 * s, '#fff', 'right');
      if (v.air) text(`ALT ${Math.round(v.pos.y - Math.max(0, FC.World.heightAt(v.pos.x, v.pos.z)))} m · [jump] climb · [crouch] descend`, ax, by - 70 * s, 10 * s, '#9be7e1', 'right', 600);
      panel(ax - 140 * s, by - 46 * s, 140 * s, 8 * s, 0.5);
      ctx.fillStyle = v.hp < v.maxHp * 0.35 ? '#ff5a4f' : '#ffd166'; ctx.fillRect(ax - 140 * s, by - 46 * s, 140 * s * (v.hp / v.maxHp), 8 * s);
      text(`[${p.ctrl.labels.interact}] exit · [${p.ctrl.labels.tag}] horn`, ax, by - 56 * s, 10 * s, '#bbb', 'right', 600);
    } else if (p.vehicle && p.seat === 1 && p.vehicle.turret) {
      const v = p.vehicle;
      text('MOUNTED LMG', ax, by - 30 * s, 12 * s, '#ddd', 'right', 600);
      panel(ax - 140 * s, by - 18 * s, 140 * s, 8 * s, 0.5);
      ctx.fillStyle = v.overheated ? '#ff3b30' : '#ffb35c'; ctx.fillRect(ax - 140 * s, by - 18 * s, 140 * s * Math.min(1, v.heat), 8 * s);
      if (v.overheated) text('OVERHEATED', ax, by - 40 * s, 11 * s, '#ff3b30', 'right');
    } else {
      const am = p.ammo[p.weapon];
      text(w.name.toUpperCase(), ax, by - 30 * s, 12 * s, '#ddd', 'right', 600);
      if (w.throwable) text(`${am.mag}`, ax, by - 4 * s, 24 * s, '#ffb35c', 'right');
      else {
        text(`${am.mag}`, ax - 46 * s, by - 4 * s, 24 * s, am.mag === 0 ? '#ff5a4f' : '#fff', 'right');
        text(`/ ${am.reserve}`, ax, by - 4 * s, 14 * s, '#bbb', 'right', 600);
      }
      let ox = ax;
      for (let i = FC.WEAPON_ORDER.length - 1; i >= 0; i--) {
        const k = FC.WEAPON_ORDER[i];
        if (!p.owned.has(k)) continue;
        const sel = k === p.weapon;
        ox -= 22 * s;
        panel(ox, by - 60 * s, 19 * s, 14 * s, sel ? 0.8 : 0.4);
        text(String(i + 1), ox + 9.5 * s, by - 49 * s, 10 * s, sel ? '#ffd166' : '#999', 'center');
      }
    }
    if (p.reloadT > 0) text('RELOADING', cx, cy + 46 * s, 12 * s, '#ffd166', 'center');
    else if (!w.throwable && p.ammo[p.weapon].mag === 0 && p.ammo[p.weapon].reserve === 0) text('OUT OF AMMO — buy more at a trader', cx, cy + 46 * s, 12 * s, '#ff9f43', 'center');
    if (p.healT > 0) text('HEALING…', cx, cy + 46 * s, 12 * s, '#7bed9f', 'center');
    if (p.climbing) text('Climbing — move forward/back', cx, cy + 46 * s, 12 * s, '#ddd', 'center');
    if (p.prompt && p.alive && !p.vehicle) {
      ctx.font = `700 ${14 * s}px ${FONT}`;
      const tw = ctx.measureText(p.prompt).width + 20;
      panel(cx - tw / 2, cy + 64 * s, tw, 26 * s);
      text(p.prompt, cx, cy + 82 * s, 14 * s, '#fff', 'center');
    }

    // ---------------- top: compass, mission, clock
    drawCompass(G, p, rect, s);
    FC.Modes.hud(G, p, rect, s, text);
    const M = FC.Missions;
    if (M.current && (!G.mode || G.mode === 'campaign')) {
      const mx = rect.x + pad, my = rect.y + 46 * s;
      const tgt = M.target(G);
      const dist = tgt ? ` · ${Math.round(Math.hypot(tgt.x - p.pos.x, tgt.z - p.pos.z))}m` : '';
      panel(mx - 6, my - 14 * s, Math.min(rect.w * 0.42, 300 * s), 34 * s, 0.45);
      text(M.current.title.toUpperCase(), mx, my, 11 * s, '#ffd166');
      text(M.current.text + dist, mx, my + 14 * s, 10.5 * s, '#eee', 'left', 600);
    }
    if (G.defend) {
      const D = G.defend, left = D.attackers.filter((e) => e.alive).length;
      text(`DEFEND ${D.op.name.toUpperCase()} — ${left} attackers · ${Math.round(Math.hypot(D.op.x - p.pos.x, D.op.z - p.pos.z))}m`, rect.x + pad, rect.y + 112 * s, 11 * s, '#ff9f43');
    }
    const lib = FC.World.outposts.filter((o) => o.liberated).length;
    text(`${FC.Env.clock()}${FC.Env.rain > 0.4 ? '  ☂' : FC.Env.night > 0.6 ? '  ☾' : '  ☀'}   ·   outposts ${lib}/10`, rect.x + pad, rect.y + 96 * s, 10.5 * s, '#ddd', 'left', 600);
    if (G.saveFlash > 0) text('● saving', rect.x + rect.w - pad, rect.y + rect.h - 80 * s, 10 * s, '#9be7a1', 'right', 600);

    p.messages.forEach((m, i) => {
      ctx.globalAlpha = Math.min(1, m.t);
      text(m.text, cx, rect.y + Math.max(165 * s, rect.h * 0.25) + i * 20 * s, 14 * s, m.color, 'center');
      ctx.globalAlpha = 1;
    });
    // radio + barks
    if (M.line) {
      ctx.globalAlpha = Math.min(1, M.lineT * 2);
      const t = `${M.line[0]}: ${M.line[1]}`;
      ctx.font = `600 ${13 * s}px ${FONT}`;
      const tw = Math.min(rect.w - 40, ctx.measureText(t).width + 24);
      panel(cx - tw / 2, rect.y + rect.h - 110 * s, tw, 24 * s, 0.6);
      text(t, cx, rect.y + rect.h - 93 * s, 13 * s, '#9be7e1', 'center', 600);
      ctx.globalAlpha = 1;
    }
    G.subtitles.forEach((sub, i) => {
      if (sub.who.pos.distanceTo(p.pos) > 45) return;
      ctx.globalAlpha = Math.min(1, sub.t);
      text(`Ashen Tide: “${sub.text}”`, cx, rect.y + rect.h - 125 * s - i * 18 * s, 12 * s, '#ffb4a8', 'center', 600);
      ctx.globalAlpha = 1;
    });

    drawMinimap(G, p, rect, s);
    if (FC.Settings.get().showFps && G.fps) text(`${Math.round(G.fps)} fps`, rect.x + rect.w - 16 * s, rect.y + rect.h - 100 * s, 11 * s, '#9be7a1', 'right', 600);

    if (p.state === 'downed') {
      text('DOWNED', cx, cy - 20 * s, 30 * s, '#ff6b6b', 'center');
      text(`${partner && partner.alive ? partner.name + ' can revive you — ' : ''}bleeding out in ${Math.ceil(p.downTimer)}s`, cx, cy + 10 * s, 14 * s, '#fff', 'center', 600);
      const prog = Math.max(p.reviveProgress, p.selfRevive || 0);
      if (prog > 0) { panel(cx - 80, cy + 24 * s, 160, 8); ctx.fillStyle = '#7bed9f'; ctx.fillRect(cx - 80, cy + 24 * s, 160 * prog, 8); }
      if (p.medkits > 0) text(`Hold [${p.ctrl.labels.interact}] to use a medkit and get up (${p.medkits} left)`, cx, cy + 50 * s, 13 * s, '#7bed9f', 'center', 600);
    } else if (p.state === 'dead') {
      panel(rect.x, rect.y, rect.w, rect.h, 0.5);
      text('WASHED OUT', cx, cy - 10 * s, 30 * s, '#ff6b6b', 'center');
      text(`Redeploying in ${Math.ceil(p.respawnTimer)}…`, cx, cy + 20 * s, 14 * s, '#fff', 'center', 600);
    }
    if (p.ctrl.usesMouse && !FC.Input.locked && G.state === 'playing') text('Click to capture the mouse', cx, cy - 40 * s, 14 * s, '#ffd166', 'center');
    ctx.restore();
  }

  function drawScope(rect, cx, cy, s) {
    const r = Math.min(rect.w, rect.h) * 0.42;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.closePath(); ctx.fill('evenodd');
    // lens edge vignette
    const lg = ctx.createRadialGradient(cx, cy, r * 0.82, cx, cy, r); lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.12, cy); ctx.moveTo(cx + r * 0.12, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy + r * 0.12); ctx.lineTo(cx, cy + r); ctx.stroke();
    for (let k = 1; k <= 4; k++) { ctx.fillStyle = '#000'; ctx.fillRect(cx - 4, cy + r * 0.12 * k, 8, 1.5); }
    ctx.fillStyle = 'rgba(255,60,40,0.9)'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    ctx.restore();
  }

  function drawCompass(G, p, rect, s) {
    const w = Math.min(rect.w * 0.45, 420 * s), x0 = rect.x + rect.w / 2 - w / 2, y = rect.y + 16 * s, h = 22 * s;
    panel(x0, y, w, h, 0.4);
    const fov = Math.PI * 0.9;
    const toX = (a) => x0 + w / 2 + (a / (fov / 2)) * (w / 2);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y, w, h); ctx.clip();
    for (let k = 0; k < 24; k++) {
      const worldYaw = (k / 24) * Math.PI * 2; // 0 = north (-z)
      const a = -FC.wrapAngle(worldYaw - p.yaw) * -1;
      const rel = FC.wrapAngle(p.yaw - worldYaw) * -1;
      void a;
      const xx = toX(-rel);
      if (Math.abs(rel) > fov / 2) continue;
      const label = ['N', '', '', 'NW', '', '', 'W', '', '', 'SW', '', '', 'S', '', '', 'SE', '', '', 'E', '', '', 'NE', '', ''][k];
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(xx, y + h - 6 * s, 1, 6 * s);
      if (label) text(label, xx, y + 14 * s, (label.length === 1 ? 12 : 9) * s, label === 'N' ? '#ffd166' : '#fff', 'center');
    }
    const mark = (wx, wz, col, shape) => {
      const a = relAngle(p, wx, wz);
      if (Math.abs(a) > fov / 2) return;
      const xx = toX(a);
      if (shape === 'diamond') diamond(xx, y + h + 6 * s, 5 * s, col);
      else { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(xx, y + h + 6 * s, 4 * s, 0, 7); ctx.fill(); }
    };
    ctx.restore();
    for (const poi of G.pois()) {
      if (poi.kind === 'ledger' || !G.isRevealed(poi.x, poi.z) || Math.hypot(poi.x - p.pos.x, poi.z - p.pos.z) > 450) continue;
      mark(poi.x, poi.z, poiColor(poi));
    }
    const mt = FC.Missions.target(G);
    if (mt) mark(mt.x, mt.z, '#ffd166', 'diamond');
    const wp = G.waypoints[p.index];
    if (wp) mark(wp.x, wp.z, p.color, 'diamond');
    if (G.defend) mark(G.defend.op.x, G.defend.op.z, '#ff9f43', 'diamond');
    const partner = G.players.find((q) => q !== p);
    if (partner) mark(partner.pos.x, partner.pos.z, partner.color);
  }

  function drawMinimap(G, p, rect, s) {
    const R = 64 * s, mx = rect.x + rect.w - R - 16 * s, my = rect.y + R + 48 * s, k = 0.42 * s;
    ctx.save();
    ctx.beginPath(); ctx.arc(mx, my, R, 0, 7); ctx.fillStyle = 'rgba(20,60,80,0.85)'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.translate(mx, my); ctx.rotate(p.yaw); ctx.scale(k, k); ctx.translate(-p.pos.x, -p.pos.z);
    ctx.drawImage(FC.World.mapCanvas, -FC.World.HALF, -FC.World.HALF, FC.World.SIZE, FC.World.SIZE);
    ctx.restore();
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    const toMini = (x, z, clampEdge) => {
      const dx = (x - p.pos.x) * k, dz = (z - p.pos.z) * k;
      let sx = dx * cs - dz * sn, sy = dx * sn + dz * cs;
      const l = Math.hypot(sx, sy);
      if (l > R - 6) { if (!clampEdge) return null; sx *= (R - 6) / l; sy *= (R - 6) / l; }
      return { x: mx + sx, y: my + sy };
    };
    for (const poi of G.pois()) {
      if (!G.isRevealed(poi.x, poi.z) && !poi.always) continue;
      const q = toMini(poi.x, poi.z, poi.kind !== 'ledger');
      if (!q) continue;
      ctx.fillStyle = poiColor(poi);
      if (poi.kind === 'tower') { ctx.beginPath(); ctx.moveTo(q.x, q.y - 5); ctx.lineTo(q.x + 4, q.y + 4); ctx.lineTo(q.x - 4, q.y + 4); ctx.fill(); }
      else if (poi.kind === 'ledger') ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      else ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
    }
    for (const c of G.convoys) if (!c.truck.dead && !c.done) { const q = toMini(c.truck.pos.x, c.truck.pos.z, false); if (q) { ctx.fillStyle = '#ff3b30'; ctx.fillRect(q.x - 4, q.y - 2.5, 8, 5); } }
    for (const v of G.vehicles) if (!v.dead && !v.convoy) { const q = toMini(v.pos.x, v.pos.z, false); if (q) { ctx.fillStyle = '#cfe'; ctx.fillRect(q.x - 3, q.y - 2, 6, 4); } }
    for (const e of G.enemies) {
      if (!e.alive || e.dormant || !(e.tagged || (e.alerted && e.sees[p.index]))) continue;
      const q = toMini(e.pos.x, e.pos.z, false);
      if (q) { ctx.fillStyle = e.alerted ? '#ff3b30' : '#ffd166'; ctx.beginPath(); ctx.arc(q.x, q.y, 2.6, 0, 7); ctx.fill(); }
    }
    if (p.has('hunter')) for (const a of G.animals) { if (!a.alive) continue; const q = toMini(a.pos.x, a.pos.z, false); if (q) { ctx.fillStyle = a.hostile ? '#ff9f43' : '#d8c8a0'; ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, 7); ctx.fill(); } }
    const mt = FC.Missions.target(G);
    if (mt) { const q = toMini(mt.x, mt.z, true); diamond(q.x, q.y, 5, '#ffd166'); }
    const wp = G.waypoints[p.index];
    if (wp) { const q = toMini(wp.x, wp.z, true); ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.stroke(); }
    const partner = G.players.find((q) => q !== p);
    if (partner) { const q = toMini(partner.pos.x, partner.pos.z, true); ctx.fillStyle = partner.state === 'downed' ? '#ff6b6b' : partner.color; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.fill(); }
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.moveTo(mx, my - 7); ctx.lineTo(mx + 5, my + 5); ctx.lineTo(mx - 5, my + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, R, 0, 7); ctx.stroke();
    text('N', mx + sn * (R - 2), my - cs * (R - 2) + 4, 11 * s, '#ffd166', 'center');
    ctx.restore();
  }

  // ---------------- full-viewport menus
  function drawMenu(G, p, rect, s) {
    panel(rect.x, rect.y, rect.w, rect.h, 0.82);
    const L = p.ctrl.labels;
    const tabs = ['map', 'skills'];
    if (p.menu !== 'shop') tabs.forEach((t, i) => text(t.toUpperCase(), rect.x + 24 * s + i * 90 * s, rect.y + 30 * s, 15 * s, p.menu === t ? '#ffd166' : '#777'));
    if (p.menu !== 'shop') text(`[${L.tab}] switch tab · [${L.back}] close`, rect.x + rect.w - 20 * s, rect.y + 30 * s, 11 * s, '#aaa', 'right', 600);
    if (p.menu === 'map') return drawMap(G, p, rect, s);
    if (p.menu === 'skills') return drawList(p, rect, s, `SKILL POINTS: ${p.prog.points}   ·   LEVEL ${p.prog.level}`, FC.SKILLS.map((k) => ({
      name: k.name + (k.cost > 1 ? ` (${k.cost} pts)` : ''), desc: k.desc, state: p.has(k.id) ? 'LEARNED' : k.req && !p.has(k.req) ? 'LOCKED' : '', ok: !p.has(k.id),
    })), `[${L.confirm}] learn`);
    if (p.menu === 'shop') return drawList(p, rect, s, `TRADER   ·   CASH $${p.prog.cash}`, FC.SHOP.map((it) => ({
      name: it.name, desc: `$${it.price}`, state: (it.kind === 'weapon' && it.id !== 'grenade' && p.owned.has(it.id)) || (it.kind === 'companion' && p.companion) || (it.kind === 'mod' && (p.prog.mods || []).includes(it.id)) ? 'OWNED' : '', ok: p.prog.cash >= it.price,
    })), `[${L.confirm}] buy · [${L.back}] leave`);
  }
  function drawList(p, rect, s, header, rows, hint) {
    const x = rect.x + Math.max(24 * s, rect.w / 2 - 260 * s), w = Math.min(rect.w - 48 * s, 520 * s);
    text(header, x, rect.y + 70 * s, 14 * s, '#ffd166');
    const rowH = 38 * s;
    rows.forEach((r, i) => {
      const y = rect.y + 90 * s + i * rowH;
      if (y + rowH > rect.y + rect.h - 30 * s) return;
      const sel = i === p.menuSel;
      panel(x, y, w, rowH - 4 * s, sel ? 0.9 : 0.45);
      if (sel) { ctx.fillStyle = p.color; ctx.fillRect(x, y, 4, rowH - 4 * s); }
      text(r.name, x + 14 * s, y + 15 * s, 13 * s, r.state === 'LEARNED' || r.state === 'OWNED' ? '#7bed9f' : r.ok ? '#fff' : '#999');
      text(r.desc, x + 14 * s, y + 29 * s, 10.5 * s, '#bbb', 'left', 600);
      if (r.state) text(r.state, x + w - 12 * s, y + 21 * s, 11 * s, r.state === 'LOCKED' ? '#ff8a80' : '#7bed9f', 'right');
    });
    text(hint, rect.x + rect.w / 2, rect.y + rect.h - 14 * s, 11 * s, '#aaa', 'center', 600);
  }
  function drawMap(G, p, rect, s) {
    const top = rect.y + 44 * s, avail = Math.min(rect.w - 20 * s, rect.h - 70 * s);
    const size = avail, ox = rect.x + (rect.w - size) / 2, oy = top;
    const k = size / FC.World.SIZE;
    const toS = (x, z) => ({ x: ox + (x + FC.World.HALF) * k, y: oy + (z + FC.World.HALF) * k });
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, size, size); ctx.clip();
    ctx.drawImage(FC.World.mapCanvas, ox, oy, size, size);
    // fog of war
    if (!fogC) { fogC = document.createElement('canvas'); fogC.width = fogC.height = 64; }
    const fctx = fogC.getContext('2d'), img = fctx.createImageData(64, 64);
    for (let i = 0; i < 4096; i++) { img.data[i * 4] = 10; img.data[i * 4 + 1] = 16; img.data[i * 4 + 2] = 22; img.data[i * 4 + 3] = G.reveal[i] ? 0 : 205; }
    fctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogC, ox, oy, size, size);
    for (const poi of G.pois()) {
      if (!G.isRevealed(poi.x, poi.z) && !poi.always) continue;
      const q = toS(poi.x, poi.z), col = poiColor(poi);
      if (poi.kind === 'ledger') { diamond(q.x, q.y, 3.5, col); continue; }
      ctx.fillStyle = col;
      if (poi.kind === 'tower') { ctx.beginPath(); ctx.moveTo(q.x, q.y - 7); ctx.lineTo(q.x + 6, q.y + 5); ctx.lineTo(q.x - 6, q.y + 5); ctx.fill(); }
      else if (poi.kind === 'village') { ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.fill(); }
      else { ctx.fillRect(q.x - 6, q.y - 6, 12, 12); if (poi.kind === 'fortress') { ctx.strokeStyle = '#fff'; ctx.strokeRect(q.x - 8, q.y - 8, 16, 16); } }
      if (size > 360) text(poi.name, q.x, q.y + 17, 9.5 * s, col, 'center', 600);
    }
    for (const c of G.convoys) if (!c.truck.dead && !c.done && G.isRevealed(c.truck.pos.x, c.truck.pos.z)) { const q = toS(c.truck.pos.x, c.truck.pos.z); ctx.fillStyle = '#ff3b30'; ctx.fillRect(q.x - 5, q.y - 3, 10, 6); }
    const mt = FC.Missions.target(G);
    if (mt) { const q = toS(mt.x, mt.z); diamond(q.x, q.y, 8, '#ffd166'); }
    for (const q2 of G.players) {
      const q = toS(q2.pos.x, q2.pos.z);
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(-q2.yaw);
      ctx.fillStyle = q2.color; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
      const wp = G.waypoints[q2.index];
      if (wp) { const w2 = toS(wp.x, wp.z); ctx.strokeStyle = q2.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(w2.x, w2.y, 6, 0, 7); ctx.stroke(); }
    }
    const cur = toS(p.mapCursor.x, p.mapCursor.z);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cur.x - 10, cur.y); ctx.lineTo(cur.x + 10, cur.y); ctx.moveTo(cur.x, cur.y - 10); ctx.lineTo(cur.x, cur.y + 10); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(ox, oy, size, size);
    const L = p.ctrl.labels, h = p.mapHover;
    const info = h ? `${h.name}${h.kind === 'outpost' || h.kind === 'fortress' ? (h.liberated ? ' — liberated' : ' — held by the Ashen Tide') : ''}${h.fast ? `   [${L.confirm}] fast travel` : `   [${L.confirm}] set waypoint`}` : `[${L.confirm}] set waypoint · [${L.reload}] clear`;
    text(info, rect.x + rect.w / 2, rect.y + rect.h - 12 * s, 12 * s, h ? '#ffd166' : '#ccc', 'center', 600);
    const ledgers = G.collectibles.filter((c) => c.taken).length;
    text(`Outposts ${FC.World.outposts.filter((o) => o.liberated).length}/10 · Relays ${FC.World.towers.filter((t) => t.hacked).length}/3 · Ledgers ${ledgers}/${G.collectibles.length}`, rect.x + 24 * s, rect.y + rect.h - 30 * s, 11 * s, '#ddd', 'left', 600);
  }

  function divider(w, h, vertical) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111';
    if (vertical) ctx.fillRect(w / 2 - 2, 0, 4, h); else ctx.fillRect(0, h / 2 - 2, w, 4);
  }

  return { init, resize, clear, draw, divider };
})();
