'use strict';
// 2D overlay drawn per split-screen viewport.
FC.HUD = (function () {
  let cv, ctx, dpr = 1;
  const FONT = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  const v3 = new THREE.Vector3();

  function init(canvas) { cv = canvas; ctx = cv.getContext('2d'); }
  function resize(w, h, ratio) {
    dpr = ratio; cv.width = Math.round(w * ratio); cv.height = Math.round(h * ratio);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
  }
  function clear() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }

  function project(p, pos, rect) {
    v3.copy(pos).project(p.cam);
    if (v3.z > 1 || v3.z < -1) return null;
    return { x: rect.x + (v3.x * 0.5 + 0.5) * rect.w, y: rect.y + (1 - (v3.y * 0.5 + 0.5)) * rect.h };
  }
  function text(s, x, y, size, color, align, weight) {
    ctx.font = `${weight || 700} ${size}px ${FONT}`;
    ctx.textAlign = align || 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(s, x + 1.5, y + 1.5);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(s, x, y);
  }
  function diamond(x, y, r, fill) {
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function draw(G, p, rect) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const s = Math.min(1.25, Math.max(0.7, Math.min(rect.w, rect.h) / 620));
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;

    // world markers ---------------------------------------------------
    for (const op of FC.World.outposts) {
      const d = Math.hypot(op.x - p.pos.x, op.z - p.pos.z);
      if (d < op.r * 0.8) continue;
      const sp = project(p, v3.set(op.x, op.y + 12, op.z).clone(), rect);
      if (!sp) continue;
      const col = op.liberated ? '#3fd0c9' : '#ff5a4f';
      ctx.fillStyle = col;
      ctx.fillRect(sp.x - 1, sp.y - 14 * s, 2, 16 * s);
      ctx.beginPath(); ctx.moveTo(sp.x + 1, sp.y - 14 * s); ctx.lineTo(sp.x + 12 * s, sp.y - 10 * s); ctx.lineTo(sp.x + 1, sp.y - 6 * s); ctx.fill();
      text(`${op.name} ${Math.round(d)}m`, sp.x, sp.y + 14 * s, 11 * s, col, 'center', 600);
    }
    for (const e of G.enemies) {
      if (!e.alive || !e.tagged) continue;
      const sp = project(p, e.headPos.add(v3.set(0, 0.5, 0)), rect);
      if (!sp) continue;
      const col = e.alerted ? '#ff3b30' : e.state === 'patrol' ? '#ffd166' : '#ff9f43';
      diamond(sp.x, sp.y, 6 * s, col);
      const d = e.pos.distanceTo(p.pos);
      if (d > 15) text(`${Math.round(d)}`, sp.x, sp.y - 9 * s, 10 * s, col, 'center', 600);
      if (e.type !== 'grunt') text(e.type === 'boss' ? 'VAEL' : 'HEAVY', sp.x, sp.y + 18 * s, 9 * s, col, 'center');
    }
    for (const ping of G.pings) {
      const sp = project(p, ping.pos, rect);
      if (!sp) continue;
      ctx.strokeStyle = ping.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 7 * s, 0, Math.PI * 2); ctx.stroke();
      text(`${Math.round(ping.pos.distanceTo(p.pos))}m`, sp.x, sp.y - 11 * s, 10 * s, ping.color, 'center');
    }
    const partner = G.players.find((q) => q !== p);
    if (partner) {
      const sp = project(p, v3.set(partner.pos.x, partner.pos.y + 2.3, partner.pos.z).clone(), rect);
      if (sp) {
        const down = partner.state === 'downed';
        text(down ? `✚ ${partner.name} DOWN ${Math.ceil(partner.downTimer)}s` : partner.name, sp.x, sp.y, (down ? 13 : 11) * s, down ? '#ff6b6b' : partner.color, 'center');
        if (down && partner.reviveProgress > 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sp.x - 30, sp.y + 6, 60, 5);
          ctx.fillStyle = '#7bed9f'; ctx.fillRect(sp.x - 30, sp.y + 6, 60 * partner.reviveProgress, 5);
        }
      }
    }

    // detection meters around crosshair --------------------------------
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const dv = e.detect[p.index];
      if (dv < 0.03 && !(e.alerted && e.sees && e.sees[p.index])) continue;
      const a = -FC.wrapAngle(FC.yawTo(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - p.yaw);
      const R = 60 * s;
      const x = cx + Math.sin(a) * R, y = cy - Math.cos(a) * R;
      const alerted = e.alerted && e.sees && e.sees[p.index];
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, -9 * s); ctx.lineTo(7 * s, 4 * s); ctx.lineTo(-7 * s, 4 * s); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = alerted ? '#ff3b30' : dv > 0.3 ? '#ffb020' : '#ffffff';
      const fh = 13 * s * (alerted ? 1 : dv);
      ctx.fillRect(-8 * s, 4 * s - fh, 16 * s, fh);
      ctx.restore(); ctx.restore();
    }

    // damage direction
    for (const d of p.damageDirs) {
      const a = -FC.wrapAngle(d.a - p.yaw);
      ctx.strokeStyle = `rgba(255,40,30,${Math.min(1, d.t) * 0.8})`;
      ctx.lineWidth = 6 * s;
      ctx.beginPath(); ctx.arc(cx, cy, 95 * s, -Math.PI / 2 + a - 0.3, -Math.PI / 2 + a + 0.3); ctx.stroke();
    }

    // crosshair / markers ---------------------------------------------
    const w = FC.WEAPONS[p.weapon];
    if (p.alive) {
      if (!w.throwable && p.aimT < 0.9) {
        const gap = (6 + (w.spread || 0) * 400 * (1 - p.aimT) + p.recoil * 300) * s;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - gap - 7 * s, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + 7 * s, cy);
        ctx.moveTo(cx, cy - gap - 7 * s); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + 7 * s);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
      if (w.throwable) { ctx.strokeStyle = 'rgba(255,170,60,0.8)'; ctx.beginPath(); ctx.arc(cx, cy, 10 * s, 0, Math.PI * 2); ctx.stroke(); }
      if (p.hitmarker > 0) {
        ctx.strokeStyle = p.killmarker > 0 ? '#ff3b30' : '#fff'; ctx.lineWidth = 2.5;
        const k = 6 * s, g = 4 * s;
        ctx.beginPath();
        ctx.moveTo(cx - g - k, cy - g - k); ctx.lineTo(cx - g, cy - g); ctx.moveTo(cx + g + k, cy - g - k); ctx.lineTo(cx + g, cy - g);
        ctx.moveTo(cx - g - k, cy + g + k); ctx.lineTo(cx - g, cy + g); ctx.moveTo(cx + g + k, cy + g + k); ctx.lineTo(cx + g, cy + g);
        ctx.stroke();
      }
    }

    // health / ammo -----------------------------------------------------
    const pad = 16 * s, bx = rect.x + pad, by = rect.y + rect.h - pad;
    text(p.name.toUpperCase(), bx, by - 30 * s, 13 * s, p.color);
    for (let i = 0; i < 4; i++) {
      const segW = 34 * s, x = bx + i * (segW + 3);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, by - 20 * s, segW, 10 * s);
      const fill = FC.clamp((p.hp - i * 25) / 25, 0, 1);
      ctx.fillStyle = p.hp < 30 ? '#ff5a4f' : '#e9f5ec';
      ctx.fillRect(x, by - 20 * s, segW * fill, 10 * s);
    }
    text(`✚ ${p.medkits}  [${p.ctrl.labels.heal}]`, bx, by + 2 * s - 6 * s, 11 * s, '#7bed9f', 'left', 600);
    if (p.inBush && p.alive) text(p.crouch ? 'HIDDEN' : 'IN COVER', bx + 150 * s, by - 10 * s, 11 * s, '#9be7a1');
    const ax = rect.x + rect.w - pad;
    const am = p.ammo[p.weapon];
    text(w.name.toUpperCase(), ax, by - 30 * s, 12 * s, '#ddd', 'right', 600);
    if (w.throwable) text(`${am.mag}`, ax, by - 4 * s, 24 * s, '#ffb35c', 'right');
    else {
      text(`${am.mag}`, ax - 46 * s, by - 4 * s, 24 * s, am.mag === 0 ? '#ff5a4f' : '#fff', 'right');
      text(`/ ${am.reserve}`, ax, by - 4 * s, 14 * s, '#bbb', 'right', 600);
    }
    if (p.reloadT > 0) text('RELOADING', cx, cy + 46 * s, 12 * s, '#ffd166', 'center');
    else if (!w.throwable && am.mag === 0 && am.reserve === 0) text('OUT OF AMMO — find a supply crate', cx, cy + 46 * s, 12 * s, '#ff9f43', 'center');
    if (p.healT > 0) text('HEALING…', cx, cy + 46 * s, 12 * s, '#7bed9f', 'center');

    // prompt
    if (p.prompt && p.alive) {
      ctx.font = `700 ${14 * s}px ${FONT}`;
      const tw = ctx.measureText(p.prompt).width + 20;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(cx - tw / 2, cy + 64 * s, tw, 26 * s);
      text(p.prompt, cx, cy + 82 * s, 14 * s, '#fff', 'center');
    }

    // objective + messages
    const lib = FC.World.outposts.filter((o) => o.liberated).length;
    text(`LIBERATE ISLA BRAVA  ${lib}/${FC.World.outposts.length}`, rect.x + pad, rect.y + 24 * s, 13 * s, '#fff');
    let near = null, nd = 1e9;
    for (const op of FC.World.outposts) if (!op.liberated) { const d = Math.hypot(op.x - p.pos.x, op.z - p.pos.z); if (d < nd) { nd = d; near = op; } }
    if (near) {
      const st = near.alarmTriggered ? ' · ALARM RAISED' : near.alarmSabotaged ? ' · alarm cut' : '';
      text(`▸ ${near.name} (${Math.round(nd)}m)${st}`, rect.x + pad, rect.y + 42 * s, 11 * s, '#ffd9a0', 'left', 600);
    }
    p.messages.forEach((m, i) => {
      ctx.globalAlpha = Math.min(1, m.t);
      text(m.text, cx, rect.y + 80 * s + i * 20 * s, 14 * s, m.color, 'center');
      ctx.globalAlpha = 1;
    });
    G.subtitles.forEach((sub, i) => {
      if (sub.who.pos.distanceTo(p.pos) > 45) return;
      ctx.globalAlpha = Math.min(1, sub.t);
      text(`Ashen Tide: “${sub.text}”`, cx, rect.y + rect.h - 70 * s - i * 18 * s, 12 * s, '#ffb4a8', 'center', 600);
      ctx.globalAlpha = 1;
    });

    drawMinimap(G, p, rect, s);

    // screen states
    if (p.hp < 35 && p.alive) {
      const g = ctx.createRadialGradient(cx, cy, Math.min(rect.w, rect.h) * 0.3, cx, cy, Math.max(rect.w, rect.h) * 0.7);
      g.addColorStop(0, 'rgba(120,0,0,0)'); g.addColorStop(1, `rgba(140,0,0,${0.55 * (1 - p.hp / 35)})`);
      ctx.fillStyle = g; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    if (p.state === 'downed') {
      ctx.fillStyle = 'rgba(60,0,0,0.45)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      text('DOWNED', cx, cy - 20 * s, 30 * s, '#ff6b6b', 'center');
      text(`${partner ? partner.name + ' can revive you' : ''} — bleeding out in ${Math.ceil(p.downTimer)}s`, cx, cy + 10 * s, 14 * s, '#fff', 'center', 600);
      if (p.reviveProgress > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cx - 80, cy + 24 * s, 160, 8);
        ctx.fillStyle = '#7bed9f'; ctx.fillRect(cx - 80, cy + 24 * s, 160 * p.reviveProgress, 8);
      }
    } else if (p.state === 'dead') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      text('WASHED OUT', cx, cy - 10 * s, 30 * s, '#ff6b6b', 'center');
      text(`Redeploying in ${Math.ceil(p.respawnTimer)}…`, cx, cy + 20 * s, 14 * s, '#fff', 'center', 600);
    }
    if (p.ctrl.usesMouse && !FC.Input.locked && G.state === 'playing') {
      text('Click to capture the mouse', cx, cy - 40 * s, 14 * s, '#ffd166', 'center');
    }
    ctx.restore();
  }

  function drawMinimap(G, p, rect, s) {
    const R = 66 * s, mx = rect.x + rect.w - R - 16 * s, my = rect.y + R + 16 * s, k = 0.55 * s;
    ctx.save();
    ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,60,80,0.8)'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.translate(mx, my); ctx.rotate(p.yaw); ctx.scale(k, k); ctx.translate(-p.pos.x, -p.pos.z);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(FC.World.mapCanvas, -FC.World.HALF, -FC.World.HALF, FC.World.SIZE, FC.World.SIZE);
    ctx.globalAlpha = 1;
    ctx.restore();
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    const toMini = (x, z, clampEdge) => {
      const dx = (x - p.pos.x) * k, dz = (z - p.pos.z) * k;
      let sx = dx * cs - dz * sn, sy = dx * sn + dz * cs;
      const l = Math.hypot(sx, sy);
      if (l > R - 6) { if (!clampEdge) return null; sx *= (R - 6) / l; sy *= (R - 6) / l; }
      return { x: mx + sx, y: my + sy };
    };
    for (const op of FC.World.outposts) {
      const q = toMini(op.x, op.z, true);
      ctx.fillStyle = op.liberated ? '#3fd0c9' : '#ff4d4d';
      ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
    }
    for (const e of G.enemies) {
      if (!e.alive || !(e.tagged || (e.alerted && e.sees && e.sees[p.index]))) continue;
      const q = toMini(e.pos.x, e.pos.z, false);
      if (q) { ctx.fillStyle = e.alerted ? '#ff3b30' : '#ffd166'; ctx.beginPath(); ctx.arc(q.x, q.y, 2.6, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const ping of G.pings) {
      const q = toMini(ping.pos.x, ping.pos.z, true);
      ctx.strokeStyle = ping.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.stroke();
    }
    const partner = G.players.find((q) => q !== p);
    if (partner) {
      const q = toMini(partner.pos.x, partner.pos.z, true);
      ctx.fillStyle = partner.state === 'downed' ? '#ff6b6b' : partner.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.moveTo(mx, my - 7); ctx.lineTo(mx + 5, my + 5); ctx.lineTo(mx - 5, my + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2); ctx.stroke();
    const nx = mx + sn * (R - 2), ny = my - cs * (R - 2);
    text('N', nx, ny + 4, 11 * s, '#ffd166', 'center');
    ctx.restore();
  }

  function divider(w, h, vertical) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111';
    if (vertical) ctx.fillRect(w / 2 - 2, 0, 4, h); else ctx.fillRect(0, h / 2 - 2, w, 4);
  }

  return { init, resize, clear, draw, divider };
})();
