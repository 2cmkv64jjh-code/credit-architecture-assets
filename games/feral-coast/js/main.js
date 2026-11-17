'use strict';
// Game manager: setup, join flow, combat rules, split-screen rendering.
(function () {
  const $ = (id) => document.getElementById(id);
  const glCanvas = $('gl'), hudCanvas = $('hud');

  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe8cfa6, 70, 560);
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x4a5a2a, 0.75));
  const sun = new THREE.DirectionalLight(0xffdcae, 1.25);
  sun.position.set(-300, 220, 200);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));

  FC.World.build(scene);
  FC.FX.init(scene);
  FC.HUD.init(hudCanvas);
  FC.Input.init(glCanvas);

  const G = FC.G = {
    state: 'title', time: 0, players: [], enemies: [], boars: [], pickups: [], projectiles: [], fires: [],
    pings: [], subtitles: [], split: 'vertical', godMode: false,
    detectMul: 1, enemyAccMul: 1, enemyDmgMul: 1,
    stats: { start: 0 },
  };

  // ---------------- population ----------------
  function spawnEnemies() {
    for (const op of FC.World.outposts) {
      const pts = op.patrol.slice();
      const add = (type) => {
        const p = pts.length ? pts.splice(Math.floor(Math.random() * pts.length), 1)[0] : FC.World.landPoint(op.x, op.z, 4, op.r * 0.7);
        const e = new FC.Enemy(type, p.x, p.z, op, scene);
        G.enemies.push(e);
        return e;
      };
      for (let i = 0; i < op.grunts; i++) add('grunt');
      for (let i = 0; i < op.heavies; i++) add('heavy');
      if (op.boss) { const b = add('boss'); b.name = 'Commander Vael'; G.boss = b; }
    }
  }
  function spawnPatrol() {
    const held = FC.World.outposts.filter((o) => !o.liberated);
    if (held.length < 2) return;
    const a = FC.pick(held); let b = FC.pick(held); if (a === b) b = held[(held.indexOf(a) + 1) % held.length];
    const route = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = FC.lerp(a.x, b.x, t), z = FC.lerp(a.z, b.z, t);
      if (FC.World.heightAt(x, z) > 1) route.push({ x, z });
    }
    if (route.length < 2) return;
    const back = route.slice(1, -1).reverse();
    const full = route.concat(back);
    for (let k = 0; k < 2; k++) {
      const e = new FC.Enemy('grunt', full[0].x + k * 2, full[0].z + k * 2, null, scene);
      e.route = full; e.routeIdx = 0; e.patroller = true;
      G.enemies.push(e);
    }
  }
  function spawnBoars() {
    for (let i = 0; i < 12; i++) {
      for (let t = 0; t < 50; t++) {
        const x = FC.rand(-280, 280), z = FC.rand(-280, 280);
        if (FC.World.heightAt(x, z) < 2) continue;
        if (FC.World.outposts.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 30)) continue;
        if (Math.hypot(FC.World.start.x - x, FC.World.start.z - z) < 50) continue;
        G.boars.push(new FC.Boar(x, z, scene));
        break;
      }
    }
  }
  spawnEnemies(); spawnPatrol(); spawnPatrol(); spawnBoars();
  G.patrolT = 120;

  // ---------------- helpers used by entities ----------------
  G.volumeAt = (pos, maxD) => {
    let d = 1e9;
    for (const p of G.players) d = Math.min(d, p.pos.distanceTo(pos));
    if (!G.players.length) return 0;
    return Math.pow(FC.clamp(1 - d / maxD, 0, 1), 1.6);
  };
  G.announce = (text, color, dur) => { for (const p of G.players) p.msg(text, color, dur); };
  G.subtitle = (who, text) => {
    G.subtitles.unshift({ who, text, t: 3 });
    if (G.subtitles.length > 3) G.subtitles.pop();
  };
  G.supplyPoints = () => {
    const pts = [FC.World.start.supply];
    for (const op of FC.World.outposts) if (op.liberated) pts.push(op.supply);
    return pts;
  };
  G.togglePause = () => {
    if (G.state === 'playing') setPaused(true);
    else if (G.state === 'paused') setPaused(false);
  };

  G.alertOutpost = (op, pos, source) => {
    if (op.liberated) return;
    if (!op.alerted) {
      op.alerted = true;
    }
    for (const e of G.enemies) {
      if (!e.alive || e.outpost !== op || e === source || e.alerted) continue;
      if (e.pendingAlert > 0) continue;
      e.pendingAlert = FC.rand(0.5, 1.6); e.pendingPos = pos.clone();
    }
    // somebody runs for the alarm
    if (op.alarm && !op.alarmSabotaged && !op.alarmTriggered && !G.enemies.some((e) => e.alive && e.state === 'alarm' && e.outpost === op)) {
      let best = null, bd = 1e9;
      for (const e of G.enemies) {
        if (!e.alive || e.outpost !== op || e.type === 'boss') continue;
        const d = Math.hypot(e.pos.x - op.alarm.x, e.pos.z - op.alarm.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) { best.state = 'alarm'; best.stateT = 0; best.alarmT = 0; best.bark(G, 'alarm'); best.barkT = 0; }
    }
  };
  G.triggerAlarm = (op) => {
    if (op.alarmTriggered || op.alarmSabotaged) return;
    op.alarmTriggered = true;
    FC.Audio.siren(Math.max(0.25, G.volumeAt(new THREE.Vector3(op.x, op.y, op.z), 300)));
    G.announce(`ALARM at ${op.name}! Reinforcements inbound`, '#ff6b6b', 5);
    setTimeout(() => {
      if (op.liberated) return;
      const n = op.boss ? 6 : 4;
      const lk = G.players.length ? G.players[0].pos.clone() : new THREE.Vector3(op.x, 0, op.z);
      for (let i = 0; i < n; i++) {
        const p = FC.World.landPoint(op.x, op.z, op.r + 25, op.r + 45);
        const e = new FC.Enemy(i === 0 && op.r > 28 ? 'heavy' : 'grunt', p.x, p.z, op, scene);
        G.enemies.push(e);
        e.state = 'alert'; e.lastKnown = lk.clone(); e.aimT = 1;
      }
      G.announce(`Reinforcements arrived at ${op.name}`, '#ff9f43');
    }, 8000);
  };
  // sounds draw attention
  G.noise = (pos, radius, src) => {
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d > radius) continue;
      if (radius > 20) { e.target = src; e.setAlert(G, pos.clone().add(new THREE.Vector3(FC.rand(-6, 6), 0, FC.rand(-6, 6)))); }
      else if (e.state === 'patrol') { e.state = 'suspicious'; e.stateT = 0; e.lastKnown = pos.clone(); e.bark(G, 'suspicious'); }
    }
  };

  // ---------------- player combat ----------------
  const tmpV = new THREE.Vector3();
  function aimAssist(p, o, d) {
    if (p.ctrl.usesMouse) return;
    let best = null, ba = 0.045;
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const c = e.chest; tmpV.subVectors(c, o);
      const dist = tmpV.length(); if (dist > 120) continue;
      const ang = tmpV.normalize().angleTo(d);
      if (ang < ba) { ba = ang; best = tmpV.clone(); }
    }
    if (best) d.lerp(best, 0.7).normalize();
  }

  G.playerShoot = (p, w) => {
    const o = p.cam.getWorldPosition(new THREE.Vector3());
    const d = p.forward();
    aimAssist(p, o, d);
    const spread = FC.lerp(w.spread, w.ads, p.aimT) * (p.crouch ? 0.7 : 1) * (p.speed > 6 ? 1.8 : 1) + p.recoil * 0.4;
    d.x += FC.rand(-spread, spread); d.y += FC.rand(-spread, spread); d.z += FC.rand(-spread, spread); d.normalize();
    const world = FC.World.raycast(o.x, o.y, o.z, d.x, d.y, d.z, w.range);
    let best = world.t, hit = null, head = false;
    for (const e of G.enemies) {
      if (!e.alive) continue;
      if (e.pos.distanceTo(o) > w.range + 5) continue;
      const sc = e.def.scale || 1;
      const hp = e.headPos;
      let t = FC.raySphere(o.x, o.y, o.z, d.x, d.y, d.z, hp.x, hp.y, hp.z, 0.24 * sc);
      if (t < best) { best = t; hit = e; head = true; }
      t = FC.rayCyl(o.x, o.y, o.z, d.x, d.y, d.z, e.pos.x, e.pos.z, 0.36 * sc, e.pos.y, e.pos.y + 1.55 * sc);
      if (t < best) { best = t; hit = e; head = false; }
    }
    for (const b of G.boars) {
      if (!b.alive) continue;
      const t = FC.raySphere(o.x, o.y, o.z, d.x, d.y, d.z, b.pos.x, b.pos.y + 0.65, b.pos.z, 0.65);
      if (t < best) { best = t; hit = b; head = false; }
    }
    for (const b of FC.World.barrels) {
      if (b.exploded) continue;
      const t = FC.rayCyl(o.x, o.y, o.z, d.x, d.y, d.z, b.x, b.z, 0.45, b.y, b.y + 1.1);
      if (t < best) { best = t; hit = b; head = false; }
    }
    FC.Audio.shot(w.sound, 1);
    G.noise(p.pos, w.noise, p);
    const end = best < Infinity ? o.clone().addScaledVector(d, best) : o.clone().addScaledVector(d, w.range);
    const mz = new THREE.Vector3(); p.vm.flash.getWorldPosition(mz);
    FC.FX.tracer(mz, end);
    if (hit instanceof FC.Enemy) {
      let dmg = w.dmg * (head ? w.head : 1);
      // heavies/boss take less from the front
      if (!head && hit.def.armorFront) {
        const facing = Math.abs(FC.wrapAngle(FC.yawTo(p.pos.x - hit.pos.x, p.pos.z - hit.pos.z) - hit.yaw));
        if (facing < 1.2) dmg *= 0.5;
      }
      const wasAlive = hit.alive;
      hit.damage(G, dmg, p, head);
      FC.FX.impact(end.x, end.y, end.z, 'blood');
      p.hitmarker = 0.15;
      if (wasAlive && !hit.alive) { p.killmarker = 0.3; FC.Audio.kill(); } else FC.Audio.hit();
    } else if (hit instanceof FC.Boar) {
      hit.damage(G, w.dmg, p); FC.FX.impact(end.x, end.y, end.z, 'blood'); p.hitmarker = 0.15; FC.Audio.hit();
    } else if (hit) {
      hit.hp -= w.dmg; FC.FX.impact(end.x, end.y, end.z, 'spark');
      if (hit.hp <= 0) explodeBarrel(hit, p);
    } else if (best < Infinity) {
      FC.FX.impact(end.x, end.y, end.z, world.kind === 'box' ? 'spark' : 'dust');
    }
  };

  G.throwMolotov = (p) => {
    const o = p.cam.getWorldPosition(new THREE.Vector3());
    const d = p.forward();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.25, 6), new THREE.MeshLambertMaterial({ color: 0x5b7a32 }));
    mesh.position.copy(o); scene.add(mesh);
    G.projectiles.push({ pos: o.clone().addScaledVector(d, 0.6), vel: d.clone().multiplyScalar(21).add(new THREE.Vector3(0, 4, 0)).add(p.vel.clone().multiplyScalar(0.5)), mesh, owner: p, t: 0 });
    FC.Audio.whoosh(1);
  };

  function igniteAt(x, z, r, life, owner) {
    if (G.fires.length >= 30) return;
    const y = Math.max(FC.World.heightAt(x, z), 0.05);
    if (FC.World.heightAt(x, z) < 0) return;
    G.fires.push({ x, y, z, r, life, t: 0, spreadT: 1, owner });
  }

  function explodeBarrel(b, owner) {
    if (b.exploded) return;
    b.exploded = true;
    b.mesh.visible = false; b.band.visible = false;
    explosion(b.x, b.y, b.z, 7.5, 160, owner);
    igniteAt(b.x, b.z, 4, 10, owner);
  }
  function explosion(x, y, z, radius, dmg, owner) {
    FC.FX.explosion(x, y, z);
    FC.Audio.explosion(Math.max(0.15, G.volumeAt(new THREE.Vector3(x, y, z), 250)));
    const pos = new THREE.Vector3(x, y, z);
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius) { const was = e.alive; e.damage(G, dmg * (1 - d / radius) + 20, owner, false); if (was && !e.alive && owner) { owner.hitmarker = 0.2; owner.killmarker = 0.3; } }
    }
    for (const b of G.boars) if (b.alive && b.pos.distanceTo(pos) < radius) b.damage(G, 200, owner);
    for (const p of G.players) {
      const d = p.pos.distanceTo(pos);
      if (d < radius) p.damage(70 * (1 - d / radius), x, z, G);
      if (d < 60) p.shake = Math.max(p.shake, 0.6 * (1 - d / 60));
    }
    for (const b of FC.World.barrels) if (!b.exploded && Math.hypot(b.x - x, b.z - z) < radius * 0.8) setTimeout(() => explodeBarrel(b, owner), 150 + Math.random() * 250);
    G.noise(pos, 90, owner);
  }

  G.tag = (p) => {
    const o = p.cam.getWorldPosition(new THREE.Vector3());
    const d = p.forward();
    let best = null, ba = 0.06;
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const v = e.chest.sub(o); const dist = v.length();
      if (dist > 160) continue;
      const ang = v.normalize().angleTo(d);
      if (ang < ba && FC.World.los(o.x, o.y, o.z, e.chest.x, e.chest.y, e.chest.z)) { ba = ang; best = e; }
    }
    if (best) {
      if (!best.tagged) { best.tagged = true; p.stats.tags++; }
      // tag nearby squadmates in view too (binocular sweep feel)
      FC.Audio.ui();
      p.msg(`Tagged ${best.type === 'boss' ? 'Commander Vael' : best.type}`, '#ffd166', 1.5);
      return;
    }
    const r = FC.World.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 300);
    if (r.t < Infinity) {
      G.pings = G.pings.filter((q) => q.owner !== p);
      G.pings.push({ pos: o.clone().addScaledVector(d, r.t), owner: p, color: p.color, t: 25 });
      FC.Audio.click();
      const partner = G.players.find((q) => q !== p);
      if (partner) partner.msg(`${p.name} marked a spot`, p.color, 2);
    }
  };

  G.takedownTarget = (p) => {
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d > 2.3 || Math.abs(e.pos.y - p.pos.y) > 1.2) continue;
      const toE = FC.yawTo(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (Math.abs(FC.wrapAngle(toE - p.yaw)) > 0.9) continue;
      const behind = Math.abs(FC.wrapAngle(FC.yawTo(p.pos.x - e.pos.x, p.pos.z - e.pos.z) - e.yaw)) > 1.9;
      if (e.type === 'boss') continue;
      if (e.type === 'heavy' && !behind) continue;
      if (e.alerted && !behind) continue;
      return e;
    }
    return null;
  };
  G.takedown = (p, e) => {
    p.lunge = 1;
    e.die(G, p, false, true);
    FC.Audio.takedown();
    FC.FX.impact(e.pos.x, e.pos.y + 1.2, e.pos.z, 'blood');
    // anybody watching up close notices
    for (const o of G.enemies) if (o.alive && o !== e && o.pos.distanceTo(e.pos) < 7 && FC.World.los(o.pos.x, o.pos.y + 1.6, o.pos.z, e.pos.x, e.pos.y + 1, e.pos.z)) { o.target = p; o.setAlert(G, p.pos); }
  };

  G.onEnemyKilled = (e, attacker, headshot, takedown) => {
    if (attacker) {
      attacker.stats.kills++;
      if (headshot) attacker.stats.headshots++;
      if (takedown) attacker.stats.takedowns++;
    }
    if (Math.random() < 0.55 || e.type !== 'grunt') {
      const kind = Math.random() < 0.18 ? 'med' : Math.random() < 0.25 ? 'molotov' : 'ammo';
      const col = kind === 'med' ? 0xe8e8e8 : kind === 'molotov' ? 0xff8c2a : 0x4f7a3a;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.25 }));
      m.position.set(e.pos.x + 0.6, e.pos.y + 0.3, e.pos.z);
      scene.add(m);
      G.pickups.push({ kind, mesh: m, pos: m.position, t: 90 });
    }
    if (e === G.boss) G.announce('Commander Vael is dead!', '#ffd166', 5);
    checkLiberation();
  };

  function checkLiberation() {
    for (const op of FC.World.outposts) {
      if (op.liberated) continue;
      if (G.enemies.some((e) => e.alive && e.outpost === op)) continue;
      op.liberated = true;
      op.flag.material.color.set(0x23b38a);
      if (op.alarm) op.alarm.bulb.material.color.set(0x23b38a);
      const bonus = !op.alarmTriggered ? ' — undetected bonus!' : '';
      G.announce(`OUTPOST LIBERATED: ${op.name}${op.alerted ? '' : bonus}`, '#3fd0c9', 5);
      FC.Audio.liberate();
      for (const p of G.players) { p.medkits = Math.min(5, p.medkits + 1); }
      if (FC.World.outposts.every((o) => o.liberated)) {
        G.victoryT = 4;
      }
    }
  }

  G.respawn = (p) => {
    // spawn at safe point nearest to partner (or nearest to self)
    const partner = G.players.find((q) => q !== p && q.alive);
    const ref = partner ? partner.pos : p.pos;
    const pts = [{ x: FC.World.start.x, z: FC.World.start.z + 4 }].concat(FC.World.outposts.filter((o) => o.liberated).map((o) => ({ x: o.x + 3, z: o.z + 3 })));
    pts.sort((a, b) => Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z));
    p.spawnAt(pts[0].x, pts[0].z);
    p.ammo.forEach((a, i) => { const w = FC.WEAPONS[i]; if (!w.throwable) a.reserve = Math.max(a.reserve, w.reserve * 0.5); });
    p.msg('Redeployed', p.color);
    // other downed player also comes back
    for (const q of G.players) if (q !== p && q.state === 'dead') { q.spawnAt(pts[0].x + 2, pts[0].z); }
    for (const e of G.enemies) if (e.alive && e.alerted) { e.detect = [0, 0]; }
  };

  // ---------------- per-frame world systems ----------------
  function updateWorld(dt) {
    // projectiles
    for (let i = G.projectiles.length - 1; i >= 0; i--) {
      const pr = G.projectiles[i];
      pr.t += dt;
      pr.vel.y -= 16 * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos); pr.mesh.rotation.x += dt * 12;
      if (Math.random() < 0.6) FC.FX.fire(pr.pos.x, pr.pos.y, pr.pos.z, 0.15);
      let hit = pr.pos.y <= FC.World.heightAt(pr.pos.x, pr.pos.z) || pr.t > 6;
      if (!hit) for (const b of FC.World.boxes) if (pr.pos.x > b.minX && pr.pos.x < b.maxX && pr.pos.y > b.minY && pr.pos.y < b.maxY && pr.pos.z > b.minZ && pr.pos.z < b.maxZ) { hit = true; break; }
      if (!hit) for (const e of G.enemies) if (e.alive && e.chest.distanceTo(pr.pos) < 0.9) { hit = true; break; }
      if (hit) {
        scene.remove(pr.mesh);
        G.projectiles.splice(i, 1);
        FC.Audio.glass(Math.max(0.2, G.volumeAt(pr.pos, 120)));
        igniteAt(pr.pos.x, pr.pos.z, 4.5, 9, pr.owner);
        G.noise(pr.pos, 18, pr.owner);
      }
    }
    // fire zones: damage, spread through bushes, cook barrels
    for (let i = G.fires.length - 1; i >= 0; i--) {
      const f = G.fires[i];
      f.t += dt;
      const fade = FC.clamp((f.life - f.t) / 2, 0, 1);
      const n = Math.round(f.r * 9 * dt * 10 * fade) / 10;
      for (let k = 0; k < Math.ceil(n * 3); k++) FC.FX.fire(f.x + FC.rand(-f.r, f.r) * 0.6, f.y, f.z + FC.rand(-f.r, f.r) * 0.6, 1);
      if (Math.random() < dt * 6) FC.FX.smoke(f.x, f.y + 2, f.z, 1.2);
      if (f.t > f.life) { G.fires.splice(i, 1); continue; }
      const fp = new THREE.Vector3(f.x, f.y, f.z);
      for (const e of G.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.pos.x - f.x, e.pos.z - f.z) < f.r) {
          if (e.burning <= 0) { e.burning = 5; e.setAlert(G, fp); if (f.owner) e.lastAttacker = f.owner; }
        }
      }
      for (const b of G.boars) if (b.alive && Math.hypot(b.pos.x - f.x, b.pos.z - f.z) < f.r) b.damage(G, 40 * dt, null);
      for (const p of G.players) if (p.alive && Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < f.r * 0.8 && p.pos.y - f.y < 1.5) p.damage(16 * dt, undefined, undefined, G);
      for (const b of FC.World.barrels) if (!b.exploded && Math.hypot(b.x - f.x, b.z - f.z) < f.r + 0.5) { b.hp -= 12 * dt; if (b.hp <= 0) explodeBarrel(b, f.owner); }
      f.spreadT -= dt;
      if (f.spreadT <= 0) {
        f.spreadT = 1.2;
        FC.World.bushesNear(f.x, f.z, f.r + 3.5, (b) => {
          if (Math.random() < 0.55) { FC.World.burnBush(b); igniteAt(b.x, b.z, 3, 7, f.owner); }
        });
      }
    }
    // burning kills credit the thrower
    for (const e of G.enemies) if (!e.alive && e.lastAttacker && !e.credited) { e.credited = true; }
    // pickups
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const pk = G.pickups[i];
      pk.t -= dt; pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = FC.World.heightAt(pk.pos.x, pk.pos.z) + 0.35 + Math.sin(G.time * 3) * 0.08;
      let taken = pk.t <= 0;
      for (const p of G.players) {
        if (taken || !p.alive || p.pos.distanceTo(pk.pos) > 1.6) continue;
        if (pk.kind === 'med') { if (p.medkits >= 5) continue; p.medkits++; p.msg('+1 Medkit', '#7bed9f', 1.5); }
        else if (pk.kind === 'molotov') { if (p.ammo[2].mag >= FC.WEAPONS[2].maxCount) continue; p.ammo[2].mag++; p.msg('+1 Molotov', '#ffb35c', 1.5); }
        else { p.ammo[0].reserve = Math.min(FC.WEAPONS[0].maxReserve, p.ammo[0].reserve + 30); p.ammo[1].reserve = Math.min(FC.WEAPONS[1].maxReserve, p.ammo[1].reserve + 12); p.msg('+Ammo', '#ffd166', 1.5); }
        FC.Audio.pickup(); taken = true;
      }
      if (taken) { scene.remove(pk.mesh); G.pickups.splice(i, 1); }
    }
    // pings & subtitles
    for (const q of G.pings) q.t -= dt;
    G.pings = G.pings.filter((q) => q.t > 0);
    for (const s of G.subtitles) s.t -= dt;
    G.subtitles = G.subtitles.filter((s) => s.t > 0);
    // alarm bulbs blink, flags wave, campfire
    for (const op of FC.World.outposts) {
      if (op.alarmTriggered && !op.liberated) op.alarm.bulb.material.color.set(Math.sin(G.time * 10) > 0 ? 0xff2020 : 0x441111);
      op.flag.rotation.y = Math.sin(G.time * 2 + op.x) * 0.25;
    }
    const cf = FC.World.start.fire;
    if (Math.random() < dt * 25) FC.FX.fire(cf.x, cf.y, cf.z, 0.35);
    FC.World.water.position.y = Math.sin(G.time * 0.6) * 0.08;
    // roaming patrols refresh
    G.patrolT -= dt;
    if (G.patrolT <= 0) {
      G.patrolT = 150;
      if (G.enemies.filter((e) => e.patroller && e.alive).length < 4) spawnPatrol();
    }
    // clean up long-dead bodies
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (!e.alive && e.deadT > 120) { scene.remove(e.model.group); G.enemies.splice(i, 1); }
    }
    if (G.victoryT !== undefined) { G.victoryT -= dt; if (G.victoryT <= 0) { G.victoryT = undefined; victory(); } }
  }

  // ---------------- rendering ----------------
  let W = 0, H = 0;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H, false);
    glCanvas.style.width = W + 'px'; glCanvas.style.height = H + 'px';
    FC.HUD.resize(W, H, Math.min(2, window.devicePixelRatio || 1));
  }
  window.addEventListener('resize', resize);
  resize();

  function rects() {
    const n = G.players.length;
    if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
    if (G.split === 'vertical') return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
    return [{ x: 0, y: 0, w: W, h: H / 2 }, { x: 0, y: H / 2, w: W, h: H / 2 }];
  }

  const titleCam = new THREE.PerspectiveCamera(55, 1, 0.5, 2200);
  function render() {
    renderer.setScissorTest(true);
    FC.HUD.clear();
    if (G.state === 'title') {
      const t = G.time * 0.03;
      titleCam.position.set(Math.sin(t) * 330, 120, Math.cos(t) * 330);
      titleCam.lookAt(0, 10, 0);
      titleCam.aspect = W / H; titleCam.updateProjectionMatrix();
      renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
      FC.FX.setView(H, titleCam.fov);
      renderer.render(scene, titleCam);
      return;
    }
    const rs = rects();
    G.players.forEach((p, i) => {
      const r = rs[i];
      if (Math.abs(p.cam.aspect - r.w / r.h) > 0.001) { p.cam.aspect = r.w / r.h; p.cam.updateProjectionMatrix(); }
      const y = H - r.y - r.h;
      renderer.setViewport(r.x, y, r.w, r.h); renderer.setScissor(r.x, y, r.w, r.h);
      FC.FX.setView(r.h * renderer.getPixelRatio(), p.cam.fov);
      renderer.render(scene, p.cam);
      FC.HUD.draw(G, p, r);
    });
    if (G.players.length > 1) FC.HUD.divider(W, H, G.split === 'vertical');
  }

  // ---------------- flow: title / join / pause / victory ----------------
  const slots = [];
  function deviceLabel(d) {
    if (d === 'kbm') return 'Keyboard + Mouse';
    if (d === 'kb2') return 'Keyboard (right side)';
    const gp = FC.Input.pads()[parseInt(d.slice(3), 10)];
    return 'Gamepad' + (gp ? ` — ${gp.id.split('(')[0].trim().slice(0, 28)}` : '');
  }
  function refreshSlots() {
    for (let i = 0; i < 2; i++) {
      const el = $('slot' + i);
      const d = slots[i];
      el.classList.toggle('joined', !!d);
      el.querySelector('.dev').textContent = d ? deviceLabel(d) : (i === 0 ? 'Click, or press Ⓐ on a gamepad' : 'Press ENTER, or Ⓐ on another gamepad');
    }
    $('deploy').textContent = slots.length === 2 ? 'DEPLOY — CO-OP' : slots.length === 1 ? 'DEPLOY SOLO (or add Player 2)' : 'DEPLOY';
  }
  function join(dev) {
    if (G.state !== 'title' || slots.includes(dev) || slots.length >= 2) return;
    slots.push(dev); refreshSlots(); FC.Audio.init(); FC.Audio.ui();
  }
  $('title').addEventListener('mousedown', (e) => {
    if (e.target.id === 'deploy' || e.target.closest('.split-toggle')) return;
    join('kbm');
  });
  $('deploy').addEventListener('click', () => { if (!slots.length) join('kbm'); startGame(); });
  $('resetSlots').addEventListener('click', (e) => { e.stopPropagation(); slots.length = 0; refreshSlots(); });
  document.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); G.split = b.dataset.split;
    document.querySelectorAll('[data-split]').forEach((x) => x.classList.toggle('on', x.dataset.split === G.split));
  }));
  FC.Input.onKey((code) => {
    if (G.state === 'title') {
      if (code === 'Enter' || code === 'NumpadEnter') join('kb2');
      else if (code === 'Space') { if (!slots.length) join('kbm'); startGame(); }
      else if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) join('kbm');
    } else if (G.state === 'paused' && (code === 'Space' || code === 'Backspace')) setPaused(false);
    else if (G.state === 'victory' && code === 'Space') location.reload();
  });
  FC.Input.onLockChange((locked) => {
    if (!locked && G.state === 'playing' && G.players.some((p) => p.ctrl.usesMouse)) setPaused(true);
  });
  glCanvas.addEventListener('click', () => {
    if (G.state === 'playing' && G.players.some((p) => p.ctrl.usesMouse) && !FC.Input.locked) FC.Input.lock();
  });
  $('resume').addEventListener('click', () => setPaused(false));
  $('splitBtn').addEventListener('click', () => { G.split = G.split === 'vertical' ? 'horizontal' : 'vertical'; $('splitBtn').textContent = `Split: ${G.split}`; });
  $('again').addEventListener('click', () => location.reload());

  function startGame() {
    if (G.state !== 'title' || !slots.length) return;
    FC.Audio.init();
    G.state = 'playing';
    $('title').classList.add('hidden');
    slots.forEach((dev, i) => {
      const p = new FC.Player(i, dev, scene);
      p.spawnAt(FC.World.start.x + (i ? 2 : -2), FC.World.start.z + 6);
      p.yaw = 0;
      G.players.push(p);
    });
    G.stats.start = G.time;
    G.announce('Liberate the 5 outposts held by the Ashen Tide', '#ffd9a0', 7);
    G.players.forEach((p) => p.msg(`Tag [${p.ctrl.labels.tag}] · Takedown [${p.ctrl.labels.interact}] · Cut the alarm`, '#ddd', 9));
    if (G.players.some((p) => p.ctrl.usesMouse)) FC.Input.lock();
  }
  function setPaused(on) {
    if (on && G.state === 'playing') { G.state = 'paused'; $('pause').classList.remove('hidden'); $('splitBtn').textContent = `Split: ${G.split}`; }
    else if (!on && G.state === 'paused') {
      G.state = 'playing'; $('pause').classList.add('hidden');
      if (G.players.some((p) => p.ctrl.usesMouse)) FC.Input.lock();
    }
  }
  function victory() {
    G.state = 'victory';
    FC.Input.unlock();
    FC.Audio.victory();
    const secs = Math.round(G.time - G.stats.start);
    $('vtime').textContent = `${Math.floor(secs / 60)}m ${secs % 60}s`;
    $('vstats').innerHTML = G.players.map((p) => `<div class="stat" style="border-color:${p.color}"><h3 style="color:${p.color}">${p.name}</h3>
      <p>Kills <b>${p.stats.kills}</b></p><p>Headshots <b>${p.stats.headshots}</b></p><p>Takedowns <b>${p.stats.takedowns}</b></p>
      <p>Tags <b>${p.stats.tags}</b></p><p>Revives <b>${p.stats.revives}</b></p></div>`).join('');
    $('victory').classList.remove('hidden');
  }

  // ---------------- main loop ----------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    FC.Input.update();
    if (G.state === 'title') {
      G.time += dt;
      const pads = FC.Input.pads();
      for (let i = 0; i < pads.length; i++) {
        if (!pads[i]) continue;
        if (FC.Input.padJust(i, 0)) join('pad' + i);
        if (FC.Input.padJust(i, 9)) { if (!slots.length) join('pad' + i); startGame(); }
      }
      FC.FX.update(dt);
    } else if (G.state === 'playing') {
      G.time += dt;
      for (const p of G.players) p.update(dt, G);
      if (G.state === 'playing') {
        for (const e of G.enemies) e.update(dt, G);
        for (const b of G.boars) b.update(dt, G);
        updateWorld(dt);
        FC.FX.update(dt);
      }
    } else if (G.state === 'paused') {
      for (const p of G.players) {
        if (p.ctrl.padIndex >= 0 && FC.Input.padJust(p.ctrl.padIndex, 9)) setPaused(false);
      }
    } else if (G.state === 'victory') {
      for (const p of G.players) if (p.ctrl.padIndex >= 0 && FC.Input.padJust(p.ctrl.padIndex, 0)) location.reload();
    }
    render();
    FC.Input.endFrame();
    requestAnimationFrame(frame);
  }
  refreshSlots();
  requestAnimationFrame(frame);
})();
