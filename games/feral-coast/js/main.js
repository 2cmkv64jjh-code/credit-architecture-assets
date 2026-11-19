'use strict';
// Game manager: loading, population, combat rules, open-world systems, split-screen rendering, flow.
(function () {
  const $ = (id) => document.getElementById(id);
  const glCanvas = $('gl'), hudCanvas = $('hud');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  FC.Render.init(renderer, scene);
  FC.HUD.init(hudCanvas);
  FC.Input.init(glCanvas);

  const G = FC.G = {
    state: 'loading', time: 0, players: [], enemies: [], animals: [], civilians: [], vehicles: [], convoys: [],
    pickups: [], projectiles: [], fires: [], pings: [], subtitles: [], floaters: [], collectibles: [],
    split: 'vertical', godMode: false, detectMul: 1, enemyAccMul: 1, enemyDmgMul: 1, diff: null,
    reveal: new Uint8Array(64 * 64), flags: { shopped: false, convoys: 0 }, waypoints: [null, null],
    stats: { start: 0 }, saveFlash: 0, quality: 'high',
  };
  const tmpV = new THREE.Vector3();
  const DIFFS = {
    story: { hp: 200, regen: 30, regenDelay: 3, fullRegen: true, dmg: 0.35, acc: 0.6, detect: 0.75 },
    normal: { hp: 150, regen: 18, regenDelay: 4.5, fullRegen: true, dmg: 0.6, acc: 0.8, detect: 1 },
    hard: { hp: 100, regen: 10, regenDelay: 5, fullRegen: false, dmg: 1, acc: 1, detect: 1.25 },
  };
  G.setDifficulty = (k) => {
    G.diffKey = DIFFS[k] ? k : 'normal'; G.diff = DIFFS[G.diffKey];
    G.enemyDmgMul = G.diff.dmg; G.enemyAccMul = G.diff.acc; G.detectMul = G.diff.detect;
    try { localStorage.setItem('feralcoast_diff', G.diffKey); } catch (e) { /* ignore */ }
  };
  let savedDiff = 'normal'; try { savedDiff = localStorage.getItem('feralcoast_diff') || 'normal'; } catch (e) { /* ignore */ }
  G.setDifficulty(savedDiff);

  // ===================================================================== loading
  async function boot() {
    const bar = $('loadbar'), txt = $('loadtxt');
    const step = async (label, f) => { txt.textContent = label; await new Promise((r) => setTimeout(r, 30)); await f(); };
    await step('Unpacking models…', () => FC.Assets.load((k) => { bar.style.width = Math.round(k * 55) + '%'; }));
    await step('Raising Isla Brava…', () => { FC.World.build(scene); bar.style.width = '75%'; });
    await step('Planting the jungle…', () => { FC.Env.init(scene, G.quality); FC.Foliage.build(scene); FC.FX.init(scene); bar.style.width = '90%'; });
    await step('Waking the island…', () => { populate(); bar.style.width = '100%'; });
    G.state = 'title';
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    const save = FC.Progression.load();
    $('continue').classList.toggle('hidden', !save);
    if (save) $('continue').textContent = `CONTINUE (${save.outposts.filter(Boolean).length}/10 outposts)`;
    refreshSlots();
  }

  // ===================================================================== population
  function populate() {
    const W = FC.World;
    for (const op of W.outposts) {
      const pts = op.patrol.slice();
      const add = (type) => {
        const p = pts.length ? pts.splice(Math.floor(Math.random() * pts.length), 1)[0] : W.landPoint(op.x, op.z, 4, op.r * 0.7);
        const e = new FC.Enemy(type, p.x, p.z, op, scene);
        G.enemies.push(e);
        return e;
      };
      for (let i = 0; i < op.grunts; i++) add('grunt');
      for (let i = 0; i < op.heavies; i++) add('heavy');
      for (let i = 0; i < op.snipers && i < op.lookouts.length; i++) {
        const l = op.lookouts[i];
        const e = new FC.Enemy('sniper', l.x, l.z, op, scene);
        e.pos.y = l.y; e.onTower = true;
        G.enemies.push(e);
      }
      if (op.boss) { const b = add('boss'); b.name = 'Commander Vael'; G.boss = b; }
    }
    for (const t of W.towers) {
      for (let i = 0; i < 3; i++) {
        const p = W.landPoint(t.x, t.z, 6, 14);
        const e = new FC.Enemy(i === 2 ? 'heavy' : 'grunt', p.x, p.z, null, scene);
        e.guardOf = t; G.enemies.push(e);
      }
    }
    for (let i = 0; i < 3; i++) spawnPatrol();
    for (let i = 0; i < 2; i++) spawnConvoy();
    // wildlife
    const herd = (kind, n, minD) => {
      for (let t = 0; t < 60; t++) {
        const x = FC.rand(-650, 650), z = FC.rand(-650, 650), h = W.heightAt(x, z);
        if (h < 3 || h > 80 || W.isReserved(x, z, minD)) continue;
        for (let i = 0; i < n; i++) G.animals.push(new FC.Animal(kind, x + FC.rand(-6, 6), z + FC.rand(-6, 6), scene));
        return;
      }
    };
    for (let i = 0; i < 10; i++) herd('deer', 3, 40);
    for (let i = 0; i < 5; i++) herd('stag', 1, 40);
    for (let i = 0; i < 7; i++) herd('wolf', 2 + (i % 2), 70);
    for (const v of W.villages) for (let i = 0; i < 4; i++) G.civilians.push(new FC.Civilian(v, scene));
    // resistance at camp
    const camp = { wander: [{ x: W.start.x - 3, z: W.start.z - 3 }, { x: W.start.x + 4, z: W.start.z - 2 }, { x: W.start.x - 1, z: W.start.z + 1 }], x: W.start.x, z: W.start.z };
    for (let i = 0; i < 3; i++) { const c = new FC.Civilian(camp, scene); c.friendly = true; G.civilians.push(c); }
    // vehicles
    const jeepAt = (x, z, yaw) => { const v = new FC.Vehicle('jeep', x, z, yaw, scene); G.vehicles.push(v); return v; };
    G.campJeep = jeepAt(W.start.x + 10, W.start.z - 8, 0.4);
    for (const v of W.villages) jeepAt(v.x + v.r * 0.6, v.z + 6, Math.random() * 6);
    // collectibles
    const rng = FC.mulberry32(999);
    const cm = new THREE.MeshStandardMaterial({ color: 0x5a2a1a, emissive: 0xffb84d, emissiveIntensity: 0.6, roughness: 0.6 });
    for (let i = 0; i < 14; i++) {
      for (let t = 0; t < 200; t++) {
        const x = (rng() * 2 - 1) * 640, z = (rng() * 2 - 1) * 640, h = W.heightAt(x, z);
        if (h < 2 || W.pointBlocked(x, z, 1) || W.isReserved(x, z, 8)) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.3), cm);
        m.position.set(x, h + 0.6, z); m.castShadow = true;
        scene.add(m);
        G.collectibles.push({ x, z, y: h, mesh: m, taken: false });
        break;
      }
    }
  }
  function spawnPatrol() {
    const W = FC.World;
    const roads = W.roads.filter((r) => r.len > 120 && r.a !== W.start && r.b !== W.start);
    const road = FC.pick(roads);
    const route = road.pts.filter((_, k) => k % 3 === 0);
    const full = route.concat(route.slice(1, -1).reverse());
    for (let k = 0; k < 2; k++) {
      const e = new FC.Enemy('grunt', full[0].x + k * 2, full[0].z, null, scene);
      e.route = full; e.routeIdx = 0; e.patroller = true;
      G.enemies.push(e);
    }
  }
  function spawnConvoy() {
    const roads = FC.World.roads.filter((r) => r.len > 250 && r.a !== FC.World.start && r.b !== FC.World.start);
    const c = new FC.Convoy(G, FC.pick(roads), scene);
    G.convoys.push(c);
  }

  // ===================================================================== helpers for entities
  G.nearestPlayerDist = (pos) => {
    let d = 1e9;
    for (const p of G.players) { const q = p.vehicle ? p.vehicle.pos : p.pos; d = Math.min(d, Math.hypot(q.x - pos.x, q.z - pos.z)); }
    if (!G.players.length) return Math.hypot(titleCam.position.x - pos.x, titleCam.position.z - pos.z);
    return d;
  };
  G.volumeAt = (pos, maxD) => Math.pow(FC.clamp(1 - G.nearestPlayerDist(pos) / maxD, 0, 1), 1.6);
  G.announce = (text, color, dur) => { for (const p of G.players) p.msg(text, color, dur); };
  G.subtitle = (who, text) => { G.subtitles.unshift({ who, text, t: 3 }); if (G.subtitles.length > 3) G.subtitles.pop(); };
  G.shopPoints = () => {
    const pts = [FC.World.start.supply];
    for (const op of FC.World.outposts) if (op.liberated) pts.push(op.supply);
    for (const v of FC.World.villages) if (FC.World.outposts[v.link].liberated) pts.push(v.shop);
    return pts;
  };
  G.togglePause = () => { if (G.state === 'playing') setPaused(true); else if (G.state === 'paused') setPaused(false); };
  G.anyAlerted = () => G.enemies.some((e) => e.alive && e.alerted && !e.dormant && G.nearestPlayerDist(e.pos) < 150);
  G.vehicleNear = (p) => {
    for (const v of G.vehicles) if (!v.dead && (v.seats[0] === null || v.seats[1] === null) && !v.convoy && p.pos.distanceTo(v.pos) < v.len * 0.5 + 1.6) return v;
    return null;
  };
  G.startPoi = () => FC.World.start;
  G.nearestHeld = () => {
    const ref = G.players[0] ? G.players[0].pos : { x: 0, z: 0 };
    let best = null, bd = 1e9;
    for (const op of FC.World.outposts) if (!op.liberated) { const d = Math.hypot(op.x - ref.x, op.z - ref.z); if (d < bd) { bd = d; best = op; } }
    return best;
  };
  G.nearestConvoy = () => {
    const c = G.convoys.find((k) => !k.truck.dead);
    return c ? c.truck.pos : null;
  };
  // fog of war: 64x64 cells of 25 m
  const revealCell = (x, z) => [Math.floor((x + 800) / 25), Math.floor((z + 800) / 25)];
  G.revealAround = (x, z, r) => {
    const [ci, cj] = revealCell(x, z), n = Math.ceil(r / 25);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= 64 || j >= 64) continue;
      if (Math.hypot((i - ci) * 25, (j - cj) * 25) <= r) G.reveal[j * 64 + i] = 1;
    }
  };
  G.isRevealed = (x, z) => { const [i, j] = revealCell(x, z); return i >= 0 && j >= 0 && i < 64 && j < 64 && G.reveal[j * 64 + i] === 1; };
  G.pois = () => {
    const W = FC.World, out = [];
    out.push({ x: W.start.x, z: W.start.z, name: W.start.name, kind: 'camp', fast: true, always: true });
    for (const op of W.outposts) out.push({ x: op.x, z: op.z, name: op.name, kind: op.boss ? 'fortress' : 'outpost', liberated: op.liberated, fast: op.liberated, ref: op });
    for (const v of W.villages) out.push({ x: v.x, z: v.z, name: v.name, kind: 'village', fast: W.outposts[v.link].liberated });
    for (const t of W.towers) out.push({ x: t.x, z: t.z, name: t.name, kind: 'tower', hacked: t.hacked });
    for (const c of G.collectibles) if (!c.taken) out.push({ x: c.x, z: c.z, name: 'Tide Ledger', kind: 'ledger' });
    return out;
  };
  G.fastTravel = (poi) => {
    G.announce(`Fast travel → ${poi.name}`, '#9be7a1', 3);
    G.players.forEach((p, i) => {
      if (p.vehicle) p.vehicle.exit(p);
      const pt = FC.World.landPoint(poi.x, poi.z, 3 + i * 2, 8 + i * 2);
      p.spawnAt(pt.x, pt.z);
      p.menu = null;
    });
    FC.Render.fade = 1;
  };
  G.setWaypoint = (p, x, z) => { G.waypoints[p.index] = { x, z }; p.msg('Waypoint set', p.color, 1.5); };
  G.clearWaypoint = (p) => { G.waypoints[p.index] = null; };

  G.alertOutpost = (op, pos, source) => {
    if (op.liberated) return;
    op.alerted = true;
    for (const e of G.enemies) {
      if (!e.alive || e.outpost !== op || e === source || e.alerted || e.pendingAlert > 0) continue;
      e.pendingAlert = FC.rand(0.5, 1.6); e.pendingPos = pos.clone();
    }
    if (op.alarm && !op.alarmSabotaged && !op.alarmTriggered && !G.enemies.some((e) => e.alive && e.state === 'alarm' && e.outpost === op)) {
      let best = null, bd = 1e9;
      for (const e of G.enemies) {
        if (!e.alive || e.outpost !== op || e.type === 'boss' || e.onTower) continue;
        const d = Math.hypot(e.pos.x - op.alarm.x, e.pos.z - op.alarm.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) { best.state = 'alarm'; best.stateT = 0; best.alarmT = 0; best.barkT = 0; best.bark(G, 'alarm'); }
    }
  };
  G.triggerAlarm = (op) => {
    if (op.alarmTriggered || op.alarmSabotaged) return;
    op.alarmTriggered = true;
    FC.Audio.siren(Math.max(0.25, G.volumeAt(new THREE.Vector3(op.x, op.y, op.z), 400)));
    G.announce(`ALARM at ${op.name}! Reinforcements inbound`, '#ff6b6b', 5);
    setTimeout(() => {
      if (op.liberated || G.state === 'title') return;
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
  G.noise = (pos, radius, src) => {
    for (const e of G.enemies) {
      if (!e.alive || e.state === 'ride' && radius < 30) continue;
      const d = e.pos.distanceTo(pos);
      if (d > radius) continue;
      if (radius > 20) { if (src && src.index !== undefined) e.target = src; e.setAlert(G, pos.clone().add(new THREE.Vector3(FC.rand(-6, 6), 0, FC.rand(-6, 6)))); }
      else if (e.state === 'patrol') { e.state = 'suspicious'; e.stateT = 0; e.lastKnown = pos.clone(); e.bark(G, 'suspicious'); }
    }
    if (radius > 20) {
      for (const c of G.civilians) if (c.alive && !c.friendly && c.pos.distanceTo(pos) < radius) c.scare(pos);
      for (const a of G.animals) if (a.alive && !a.hostile && a.pos.distanceTo(pos) < radius * 0.8) a.flee(pos);
    }
  };

  // ===================================================================== combat
  function aimAssist(p, o, d) {
    if (p.ctrl.usesMouse) return;
    let best = null, ba = 0.045;
    const consider = (c) => {
      tmpV.subVectors(c, o);
      if (tmpV.length() > 140) return;
      const ang = tmpV.normalize().angleTo(d);
      if (ang < ba) { ba = ang; best = tmpV.clone(); }
    };
    for (const e of G.enemies) if (e.alive && !e.dormant) consider(e.chest);
    for (const a of G.animals) if (a.alive && a.hostile && a.rig.root.visible) consider(new THREE.Vector3(a.pos.x, a.pos.y + a.rig.size.h * 0.55, a.pos.z));
    if (best) d.lerp(best, 0.7).normalize();
  }
  function hitscan(o, d, range, ignoreVehicle) {
    const world = FC.World.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range);
    let best = world.t, hit = null, head = false, kind = world.kind;
    for (const e of G.enemies) {
      if (!e.alive || e.dormant) continue;
      if (Math.abs(e.pos.x - o.x) > range + 5 || Math.abs(e.pos.z - o.z) > range + 5) continue;
      const sc = e.def.scale || 1, hp = e.headPos;
      let t = FC.raySphere(o.x, o.y, o.z, d.x, d.y, d.z, hp.x, hp.y, hp.z, 0.24 * sc);
      if (t < best) { best = t; hit = e; head = true; }
      t = FC.rayCyl(o.x, o.y, o.z, d.x, d.y, d.z, e.pos.x, e.pos.z, 0.36 * sc, e.pos.y, e.pos.y + 1.5 * sc);
      if (t < best) { best = t; hit = e; head = false; }
    }
    for (const a of G.animals) {
      if (!a.alive || !a.rig.root.visible) continue;
      // three spheres along the body (rump, chest, head) sized from the measured model
      const sz = a.rig.size, r = Math.max(0.35, sz.h * 0.3), fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      for (const k of [-0.3, 0, 0.32]) {
        const cy = a.pos.y + sz.h * (k > 0.2 ? 0.75 : 0.55);
        const t = FC.raySphere(o.x, o.y, o.z, d.x, d.y, d.z, a.pos.x + fx * sz.len * k, cy, a.pos.z + fz * sz.len * k, r);
        if (t < best) { best = t; hit = a; head = k > 0.2; }
      }
    }
    for (const c of G.civilians) {
      if (!c.alive) continue;
      const t = FC.rayCyl(o.x, o.y, o.z, d.x, d.y, d.z, c.pos.x, c.pos.z, 0.33, c.pos.y, c.pos.y + 1.75);
      if (t < best) { best = t; hit = c; head = false; }
    }
    for (const b of FC.World.barrels) {
      if (b.exploded) continue;
      const t = FC.rayCyl(o.x, o.y, o.z, d.x, d.y, d.z, b.x, b.z, 0.45, b.y, b.y + 1.1);
      if (t < best) { best = t; hit = b; head = false; }
    }
    for (const v of G.vehicles) {
      if (v === ignoreVehicle) continue;
      const t = FC.raySphere(o.x, o.y, o.z, d.x, d.y, d.z, v.pos.x, v.pos.y + 1, v.pos.z, v.len * 0.45);
      if (t < best) { best = t; hit = v; head = false; }
    }
    return { t: best, hit, head, kind };
  }
  G._hitscan = (o, d, range) => hitscan(o, d, range);
  G.playerShoot = (p, w) => {
    const o = p.cam.getWorldPosition(new THREE.Vector3());
    const base = p.forward();
    aimAssist(p, o, base);
    const pellets = w.pellets || 1;
    FC.Audio.shot(w.sound, 1);
    G.noise(p.pos, w.noise, p);
    const mz = p.flash.getWorldPosition(new THREE.Vector3());
    let anyHit = false, kill = false;
    for (let k = 0; k < pellets; k++) {
      const d = base.clone();
      const spread = FC.lerp(w.spread, w.ads, p.aimT) * (p.crouch ? 0.7 : 1) * (p.speed > 6 ? 1.8 : 1) + p.recoil * 0.4;
      d.x += FC.rand(-spread, spread); d.y += FC.rand(-spread, spread); d.z += FC.rand(-spread, spread); d.normalize();
      const r = hitscan(o, d, w.range, p.vehicle);
      const end = r.t < Infinity ? o.clone().addScaledVector(d, r.t) : o.clone().addScaledVector(d, w.range);
      if (k < 3) FC.FX.tracer(mz, end);
      const h = r.hit;
      if (h instanceof FC.Enemy) {
        let dmg = w.dmg * (r.head ? w.head : 1);
        if (!r.head && h.def.armorFront) {
          const facing = Math.abs(FC.wrapAngle(FC.yawTo(p.pos.x - h.pos.x, p.pos.z - h.pos.z) - h.yaw));
          if (facing < 1.2) dmg *= 0.5;
        }
        const was = h.alive;
        h.damage(G, dmg, p, r.head);
        FC.FX.impact(end.x, end.y, end.z, 'blood');
        anyHit = true; if (was && !h.alive) kill = true;
      } else if (h instanceof FC.Animal || h instanceof FC.Civilian) {
        const was = h.alive;
        h.damage(G, w.dmg * (r.head ? 2 : 1), p);
        if (was && !h.alive) kill = true; FC.FX.impact(end.x, end.y, end.z, 'blood'); anyHit = true;
      } else if (h instanceof FC.Vehicle) {
        h.damage(G, w.dmg * 0.6, p); FC.FX.impact(end.x, end.y, end.z, 'spark');
      } else if (h) {
        h.hp -= w.dmg; FC.FX.impact(end.x, end.y, end.z, 'spark');
        if (h.hp <= 0) explodeBarrel(h, p);
      } else if (r.t < Infinity) {
        if (end.y < 0.1 && FC.World.heightAt(end.x, end.z) < 0) { FC.FX.splash(end.x, 0, end.z); FC.Audio.splash(end); }
        else { FC.FX.impact(end.x, end.y, end.z, r.kind === 'box' ? 'spark' : 'dust'); if (r.kind === 'box') FC.Audio.ricochet(end); else FC.Audio.impact(end); }
      }
    }
    if (anyHit) { p.hitmarker = 0.15; if (kill) { p.killmarker = 0.3; FC.Audio.kill(); } else FC.Audio.hit(); }
  };

  G.throwProjectile = (p, kind) => {
    const o = p.cam.getWorldPosition(new THREE.Vector3());
    const d = p.forward();
    const mesh = kind === 'grenade'
      ? new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3e4a2a }))
      : new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.25, 6), new THREE.MeshStandardMaterial({ color: 0x5b7a32 }));
    mesh.position.copy(o); scene.add(mesh);
    const power = p.has('pockets') ? 24 : 21;
    G.projectiles.push({ kind, pos: o.clone().addScaledVector(d, 0.6), vel: d.clone().multiplyScalar(power).add(new THREE.Vector3(0, 4, 0)).add(p.vel.clone().multiplyScalar(0.5)), mesh, owner: p, t: 0, fuse: 2.2 });
    FC.Audio.whoosh(1);
  };

  function igniteAt(x, z, r, life, owner) {
    if (G.fires.length >= 34) return;
    const h = FC.World.heightAt(x, z);
    if (h < 0) return;
    G.fires.push({ x, y: h + 0.05, z, r, life, t: 0, spreadT: 1, owner });
  }
  function explodeBarrel(b, owner) {
    if (b.exploded) return;
    b.exploded = true;
    b.mesh.visible = false;
    G.explosion(b.x, b.y, b.z, 7.5, 160, owner);
    igniteAt(b.x, b.z, 4, 10, owner);
  }
  G.explosion = (x, y, z, radius, dmg, owner) => {
    FC.FX.explosion(x, y, z);
    FC.Audio.explosion(Math.max(0.15, G.volumeAt(new THREE.Vector3(x, y, z), 350)), new THREE.Vector3(x, y, z));
    const pos = new THREE.Vector3(x, y, z);
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius) { const was = e.alive; e.damage(G, dmg * (1 - d / radius) + 20, owner, false); if (was && !e.alive && owner && owner.index !== undefined) { owner.hitmarker = 0.2; owner.killmarker = 0.3; } }
    }
    for (const a of G.animals) if (a.alive && a.pos.distanceTo(pos) < radius) a.damage(G, 200, owner);
    for (const c of G.civilians) if (c.alive && c.pos.distanceTo(pos) < radius * 0.8) c.damage(G, 200, owner);
    for (const v of G.vehicles) if (!v.dead && v.pos.distanceTo(pos) < radius && v.pos.distanceTo(pos) > 0.1) v.damage(G, dmg * 1.5 * (1 - v.pos.distanceTo(pos) / radius), owner);
    for (const p of G.players) {
      const d = p.pos.distanceTo(pos);
      if (d < radius) p.damage(70 * (1 - d / radius), x, z, G, 'explosion');
      if (d < 60) p.shake = Math.max(p.shake, 0.6 * (1 - d / 60));
    }
    for (const b of FC.World.barrels) if (!b.exploded && Math.hypot(b.x - x, b.z - z) < radius * 0.8) setTimeout(() => explodeBarrel(b, owner), 150 + Math.random() * 250);
    G.noise(pos, 100, owner);
  };

  G.tag = (p) => {
    const o = p.cam.getWorldPosition(new THREE.Vector3());
    const d = p.forward();
    let best = null, ba = p.aimT > 0.5 ? 0.04 : 0.07;
    for (const e of G.enemies) {
      if (!e.alive || e.dormant) continue;
      const v = e.chest.sub(o), dist = v.length();
      if (dist > 220) continue;
      const ang = v.normalize().angleTo(d);
      if (ang < ba && FC.World.los(o.x, o.y, o.z, e.chest.x, e.chest.y, e.chest.z)) { ba = ang; best = e; }
    }
    if (best) {
      if (!best.tagged) { best.tagged = true; p.stats.tags++; FC.Progression.xp(p, 2, null, G); }
      FC.Audio.ui();
      p.msg(`Tagged ${best.type === 'boss' ? 'Commander Vael' : best.type}`, '#ffd166', 1.5);
      return;
    }
    const r = FC.World.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 400);
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
      if (!e.alive || e.dormant || e.state === 'ride') continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d > (p.chainT > 0 ? 4 : 2.3) || Math.abs(e.pos.y - p.pos.y) > 1.2) continue;
      const toE = FC.yawTo(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (Math.abs(FC.wrapAngle(toE - p.yaw)) > 0.9) continue;
      const behind = Math.abs(FC.wrapAngle(FC.yawTo(p.pos.x - e.pos.x, p.pos.z - e.pos.z) - e.yaw)) > 1.9;
      if (e.type === 'boss') continue;
      if (p.chainT > 0) return e;
      if (e.type === 'heavy' && !behind && !p.has('heavyhitter')) continue;
      if (e.alerted && !behind) continue;
      return e;
    }
    return null;
  };
  G.takedown = (p, e) => {
    p.lunge = 1;
    e.die(G, p, false, true);
    if (p.has('chain')) p.chainT = 3;
    FC.Audio.takedown();
    FC.FX.impact(e.pos.x, e.pos.y + 1.2, e.pos.z, 'blood');
    for (const o of G.enemies) if (o.alive && o !== e && o.pos.distanceTo(e.pos) < 7 && FC.World.los(o.pos.x, o.pos.y + 1.6, o.pos.z, e.pos.x, e.pos.y + 1, e.pos.z)) { o.target = p; o.setAlert(G, p.pos); }
  };

  function dropPickup(pos, kind) {
    const col = { med: 0xe8e8e8, molotov: 0xff8c2a, ammo: 0x4f7a3a, cash: 0x9be7a1, pelt: 0x8a5a3a }[kind];
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.3), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }));
    m.position.set(pos.x + FC.rand(-0.6, 0.6), pos.y + 0.3, pos.z + FC.rand(-0.6, 0.6));
    m.castShadow = true;
    scene.add(m);
    G.pickups.push({ kind, mesh: m, pos: m.position, t: 120, value: 0 });
    return G.pickups[G.pickups.length - 1];
  }
  G.onEnemyKilled = (e, attacker, headshot, takedown) => {
    if (attacker && attacker.index !== undefined) {
      attacker.stats.kills++;
      if (headshot) attacker.stats.headshots++;
      if (takedown) attacker.stats.takedowns++;
      FC.Progression.xp(attacker, e.def.xp + (headshot ? 5 : 0) + (takedown ? 15 : 0), takedown ? 'Takedown' : headshot ? 'Headshot' : 'Kill', G);
    }
    const c = dropPickup(e.pos, 'cash'); c.value = Math.round(FC.rand(e.def.cash[0], e.def.cash[1]));
    if (Math.random() < 0.6 || e.type !== 'grunt') dropPickup(e.pos, Math.random() < 0.2 ? 'med' : Math.random() < 0.25 ? 'molotov' : 'ammo');
    if (e === G.boss) { G.announce('Commander Vael is dead!', '#ffd166', 6); FC.Missions.say('Ama Reyes', 'Vael is down! Isla Brava breathes again.'); }
    checkLiberation();
  };
  G.onAnimalKilled = (a, p) => {
    FC.Progression.xp(p, 12, 'Hunt', G);
    const pk = dropPickup(a.pos, 'pelt'); pk.value = (a.kind === 'stag' ? 70 : a.kind === 'wolf' ? 45 : 35) * (p.has('hunter') ? 2 : 1);
  };
  G.onCivilianKilled = (c, p) => {
    FC.Progression.cash(p, -100, 'Civilian casualty', G);
    FC.Missions.say('Ama Reyes', c.friendly ? 'That was one of ours! Watch your fire!' : 'Those are the people we came to free. Watch your fire!');
  };
  G.onConvoyDestroyed = (cv, attacker) => {
    G.flags.convoys++;
    G.announce('Convoy destroyed — supplies scattered', '#ffd166', 4);
    for (const p of G.players) { FC.Progression.xp(p, 120, 'Convoy', G); FC.Progression.cash(p, 100, 'Convoy loot', G); }
    for (let i = 0; i < 3; i++) dropPickup(cv.truck.pos, i ? 'ammo' : 'molotov');
    cv.done = true;
    G.convoyRespawn = 120;
    FC.Progression.save(G);
  };
  G.hackTower = (t, p) => {
    t.hacked = true;
    t.screen.material.emissive.set(0x23e0a0);
    t.blink.material.emissive.set(0x23e0a0);
    G.revealAround(t.x, t.z, 470);
    G.announce(`${t.name} hacked — region revealed on your map`, '#3fd0c9', 5);
    for (const q of G.players) { FC.Progression.xp(q, 200, 'Relay hacked', G); FC.Progression.cash(q, 120, 'Relay bounty', G); }
    for (const e of G.enemies) if (e.alive && Math.hypot(e.pos.x - t.x, e.pos.z - t.z) < 470 && Math.random() < 0.5) e.tagged = true;
    FC.Audio.liberate();
    FC.Progression.save(G);
  };
  G.takeCollectible = (c, p) => {
    c.taken = true; c.mesh.visible = false;
    const n = G.collectibles.filter((k) => k.taken).length;
    G.announce(`Tide Ledger ${n}/${G.collectibles.length} recovered`, '#ffd166', 3);
    FC.Progression.xp(p, 40, 'Ledger', G); FC.Progression.cash(p, 100, 'Ledger', G);
    FC.Audio.pickup();
    FC.Progression.save(G);
  };

  function checkLiberation() {
    for (const op of FC.World.outposts) {
      if (op.liberated) continue;
      if (G.enemies.some((e) => e.alive && e.outpost === op)) continue;
      op.liberated = true;
      op.flag.material.color.set(0x23b38a);
      if (op.alarm) op.alarm.bulb.material.emissive.set(0x23b38a);
      const stealth = !op.alarmTriggered && !op.alerted;
      G.announce(`OUTPOST LIBERATED: ${op.name}${stealth ? ' — undetected!' : ''}`, '#3fd0c9', 5);
      FC.Audio.liberate();
      for (const p of G.players) {
        p.medkits = Math.min(5, p.medkits + 1);
        FC.Progression.xp(p, 250 + (stealth ? 150 : 0) + (op.alarmTriggered ? 0 : 50), stealth ? 'Undetected liberation' : 'Outpost liberated', G);
        FC.Progression.cash(p, op.boss ? 500 : 150, 'Outpost', G);
      }
      G.revealAround(op.x, op.z, 160);
      for (const c of G.civilians) if (c.alive && c.village && FC.World.villages.indexOf(c.village) >= 0 && FC.World.outposts[c.village.link] === op) { c.state = 'cheer'; c.stateT = 0; }
      FC.Progression.save(G);
    }
  }

  G.respawn = (p) => {
    const partner = G.players.find((q) => q !== p && q.alive);
    const ref = partner ? partner.pos : p.pos;
    const pts = [{ x: FC.World.start.x, z: FC.World.start.z + 4 }].concat(FC.World.outposts.filter((o) => o.liberated).map((o) => ({ x: o.x + 3, z: o.z + 3 })));
    pts.sort((a, b) => Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z));
    p.spawnAt(pts[0].x, pts[0].z);
    for (const k of ['pistol', 'rifle', 'shotgun', 'sniper']) p.ammo[k].reserve = Math.max(p.ammo[k].reserve, Math.round(FC.WEAPONS[k].reserve * 0.5));
    p.msg('Redeployed', p.color);
    p.rig.play('Idle_Gun', { fade: 0.4 });
    for (const q of G.players) if (q !== p && q.state === 'dead') { q.spawnAt(pts[0].x + 2, pts[0].z); q.rig.play('Idle_Gun', { fade: 0.4 }); }
    for (const e of G.enemies) if (e.alive && e.alerted) e.detect = [0, 0];
  };

  // ===================================================================== world tick
  function updateWorld(dt) {
    const W = FC.World;
    // projectiles
    for (let i = G.projectiles.length - 1; i >= 0; i--) {
      const pr = G.projectiles[i];
      pr.t += dt;
      pr.vel.y -= 16 * dt;
      const prev = pr.pos.clone();
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos); pr.mesh.rotation.x += dt * 12;
      if (pr.kind === 'molotov' && Math.random() < 0.6) FC.FX.fire(pr.pos.x, pr.pos.y, pr.pos.z, 0.15);
      const gy = W.heightAt(pr.pos.x, pr.pos.z);
      let hit = pr.pos.y <= gy;
      let boxHit = false;
      W.boxesIn(pr.pos.x - 1, pr.pos.z - 1, pr.pos.x + 1, pr.pos.z + 1, (b) => { if (pr.pos.x > b.minX && pr.pos.x < b.maxX && pr.pos.y > b.minY && pr.pos.y < b.maxY && pr.pos.z > b.minZ && pr.pos.z < b.maxZ) boxHit = true; });
      if (pr.kind === 'grenade') {
        if (hit || boxHit) { pr.pos.copy(prev); pr.vel.multiplyScalar(-0.35); pr.vel.y = Math.abs(pr.vel.y) * 0.5; if (hit) pr.pos.y = gy + 0.08; }
        if (pr.t > pr.fuse) {
          scene.remove(pr.mesh); G.projectiles.splice(i, 1);
          G.explosion(pr.pos.x, pr.pos.y, pr.pos.z, 9, 190, pr.owner);
        }
        continue;
      }
      if (!hit && !boxHit) for (const e of G.enemies) if (e.alive && !e.dormant && e.chest.distanceTo(pr.pos) < 0.9) { hit = true; break; }
      if (hit || boxHit || pr.t > 6) {
        scene.remove(pr.mesh); G.projectiles.splice(i, 1);
        if (pr.pos.y < 0.1 && gy < 0) { FC.FX.splash(pr.pos.x, 0, pr.pos.z); FC.Audio.splash(pr.pos); continue; }
        FC.Audio.glass(Math.max(0.2, G.volumeAt(pr.pos, 150)));
        igniteAt(pr.pos.x, pr.pos.z, 4.5, 9, pr.owner);
        G.noise(pr.pos, 18, pr.owner);
      }
    }
    // fire
    for (let i = G.fires.length - 1; i >= 0; i--) {
      const f = G.fires[i];
      f.t += dt;
      const fade = FC.clamp((f.life - f.t) / 2, 0, 1);
      const near = G.nearestPlayerDist(f) < 250;
      if (near) {
        const n = Math.ceil(f.r * 2.4 * fade * dt * 10);
        for (let k = 0; k < n; k++) FC.FX.fire(f.x + FC.rand(-f.r, f.r) * 0.6, f.y, f.z + FC.rand(-f.r, f.r) * 0.6, 1);
        if (Math.random() < dt * 6) FC.FX.smoke(f.x, f.y + 2, f.z, 1.3);
      }
      if (f.t > f.life) { G.fires.splice(i, 1); continue; }
      const fp = new THREE.Vector3(f.x, f.y, f.z);
      for (const e of G.enemies) if (e.alive && Math.hypot(e.pos.x - f.x, e.pos.z - f.z) < f.r && e.burning <= 0) { e.burning = 5; e.setAlert(G, fp); }
      for (const a of G.animals) if (a.alive && Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < f.r) a.damage(G, 40 * dt, null);
      for (const p of G.players) if (p.alive && !p.vehicle && Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < f.r * 0.8 && p.pos.y - f.y < 1.5) p.damage(16 * dt, undefined, undefined, G, 'fire');
      for (const b of W.barrels) if (!b.exploded && Math.hypot(b.x - f.x, b.z - f.z) < f.r + 0.5) { b.hp -= 12 * dt; if (b.hp <= 0) explodeBarrel(b, f.owner); }
      f.spreadT -= dt;
      if (f.spreadT <= 0) {
        f.spreadT = 1.2;
        FC.Foliage.bushesNear(f.x, f.z, f.r + 3.5, (b) => { if (Math.random() < (FC.Env.rain > 0.5 ? 0.15 : 0.55)) { FC.Foliage.burnBush(b); igniteAt(b.x, b.z, 3, 7, f.owner); } });
      }
    }
    // pickups
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const pk = G.pickups[i];
      pk.t -= dt; pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = W.heightAt(pk.pos.x, pk.pos.z) + 0.35 + Math.sin(G.time * 3 + i) * 0.08;
      let taken = pk.t <= 0;
      for (const p of G.players) {
        if (taken || !p.alive || p.vehicle || p.pos.distanceTo(pk.pos) > 1.7) continue;
        if (pk.kind === 'med') { if (p.medkits >= 5) continue; p.medkits++; p.msg('+1 Medkit', '#7bed9f', 1.5); }
        else if (pk.kind === 'molotov') { const k = p.owned.has('grenade') && Math.random() < 0.5 ? 'grenade' : 'molotov'; if (p.ammo[k].mag >= FC.Progression.maxThrow(p, k)) continue; p.ammo[k].mag++; p.msg(`+1 ${FC.WEAPONS[k].name}`, '#ffb35c', 1.5); }
        else if (pk.kind === 'cash' || pk.kind === 'pelt') { FC.Progression.cash(p, pk.value, pk.kind === 'pelt' ? 'Pelt' : 'Loot', G); FC.Audio.coin(); taken = true; continue; }
        else { for (const k of ['pistol', 'rifle', 'shotgun', 'sniper']) p.ammo[k].reserve = Math.min(FC.Progression.maxReserve(p, k), p.ammo[k].reserve + Math.ceil(FC.WEAPONS[k].mag * 0.8)); p.msg('+Ammo', '#ffd166', 1.2); }
        FC.Audio.pickup(); taken = true;
      }
      if (taken) { scene.remove(pk.mesh); G.pickups.splice(i, 1); }
    }
    for (const q of G.pings) q.t -= dt;
    G.pings = G.pings.filter((q) => q.t > 0);
    for (const s of G.subtitles) s.t -= dt;
    G.subtitles = G.subtitles.filter((s) => s.t > 0);
    for (const f of G.floaters) f.t -= dt;
    G.floaters = G.floaters.filter((f) => f.t > 0);
    G.saveFlash = Math.max(0, G.saveFlash - dt);
    // props animation
    for (const op of W.outposts) {
      if (op.alarmTriggered && !op.liberated) op.alarm.bulb.material.emissive.set(Math.sin(G.time * 10) > 0 ? 0xff2020 : 0x220000);
      op.flag.rotation.y = Math.sin(G.time * 2 + op.x) * 0.25;
    }
    for (const t of W.towers) if (!t.hacked) t.blink.visible = Math.sin(G.time * 3) > 0;
    for (const c of G.collectibles) if (!c.taken) { c.mesh.rotation.y += dt; c.mesh.position.y = c.y + 0.6 + Math.sin(G.time * 2 + c.x) * 0.1; }
    for (const L of W.lamps) L.material.emissiveIntensity = FC.Env.night > 0.3 ? 4 : 0.2;
    const fires = [W.start.fire].concat(W.villages.map((v) => v.fire));
    for (const cf of fires) if (Math.random() < dt * 25 && G.nearestPlayerDist(cf) < 150) FC.FX.fire(cf.x, cf.y, cf.z, 0.35);
    // convoys
    for (const c of G.convoys) c.update(dt, G);
    if (G.convoyRespawn !== undefined) { G.convoyRespawn -= dt; if (G.convoyRespawn <= 0) { G.convoyRespawn = undefined; if (G.convoys.filter((c) => !c.done).length < 2) spawnConvoy(); } }
    // rain around each camera
    // fog-of-war around players
    for (const p of G.players) G.revealAround(p.pos.x, p.pos.z, 90);
    // ambience
    G.ambT = (G.ambT || 0) - dt;
    const p0 = G.players[0];
    if (G.ambT <= 0 && p0) {
      G.ambT = FC.rand(0.8, 3);
      const h0 = W.heightAt(p0.pos.x, p0.pos.z);
      const coast = h0 < 5 && [[25, 0], [-25, 0], [0, 25], [0, -25]].some(([dx, dz]) => W.heightAt(p0.pos.x + dx, p0.pos.z + dz) < 0);
      if (coast) FC.Audio.ambient('ocean-wave', 0.35);
      if (FC.Env.night > 0.6) FC.Audio.crickets(1); else if (h0 > 3 && FC.Env.rain < 0.5) FC.Audio.birds(0.8);
      if (FC.Env.rain > 0.7 && Math.random() < 0.12) FC.Audio.ambient(Math.random() < 0.7 ? 'thunder-far' : 'thunder-crack', 0.5);
    }
    FC.Audio.loop('rain', 'rain-loop', FC.Env.rain > 0.35, 0.35);
    FC.Audio.loop('wind', 'wind-loop', true, 0.12);
    G.vehicles.forEach((v, i) => {
      const driven = !v.dead && (v.seats[0] || (v.convoy && !v.convoy.alerted && G.nearestPlayerDist(v.pos) < 90));
      FC.Audio.loop('eng' + i, 'engine-idle', !!driven, v.seats[0] ? 0.4 : 0.25 * G.volumeAt(v.pos, 90), 0.75 + Math.min(1.4, Math.abs(v.speed) / 18));
    });
    const combat = G.enemies.some((e) => e.alive && e.alerted && !e.dormant && G.nearestPlayerDist(e.pos) < 120 && (e.sees[0] || e.sees[1]));
    G.combatT = combat ? 8 : Math.max(0, (G.combatT || 0) - dt);
    FC.Audio.music(G.combatT > 0 ? 1 : 0);
    // patrol refresh
    G.patrolT = (G.patrolT === undefined ? 180 : G.patrolT) - dt;
    if (G.patrolT <= 0) { G.patrolT = 180; if (G.enemies.filter((e) => e.patroller && e.alive).length < 6) spawnPatrol(); }
    // corpse cleanup
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (!e.alive && e.deadT > 150) { scene.remove(e.rig.root); G.enemies.splice(i, 1); }
    }
    // jeep respawn at camp
    if (G.campJeep.dead) { G.jeepT = (G.jeepT || 60) - dt; if (G.jeepT <= 0) { G.jeepT = undefined; G.campJeep = new FC.Vehicle('jeep', W.start.x + 10, W.start.z - 8, 0.4, scene); G.vehicles.push(G.campJeep); } }
    G.autoSave = (G.autoSave || 60) - dt;
    if (G.autoSave <= 0) { G.autoSave = 60; FC.Progression.save(G); }
    if (G.victoryT !== undefined) { G.victoryT -= dt; if (G.victoryT <= 0) { G.victoryT = undefined; victory(); } }
  }

  function updateEntities(dt) {
    for (const p of G.players) p.update(dt, G);
    if (G.state !== 'playing') return;
    for (const v of G.vehicles) v.update(dt, G);
    for (const e of G.enemies) e.update(dt, G, G.nearestPlayerDist(e.pos));
    for (const a of G.animals) a.update(dt, G, G.nearestPlayerDist(a.pos));
    for (const c of G.civilians) c.update(dt, G, G.nearestPlayerDist(c.pos));
    FC.Missions.update(dt, G);
    updateWorld(dt);
  }

  // ===================================================================== rendering
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
  const titleCam = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
  scene.add(titleCam);
  function render() {
    FC.HUD.clear();
    if (G.state === 'loading') return;
    if (G.state === 'title' || !G.players.length) {
      const t = G.time * 0.02;
      const cx = Math.sin(t) * 140, cz = 420 + Math.cos(t) * 80;
      titleCam.position.set(cx, FC.World.heightAt(cx, cz) + 26, cz);
      titleCam.lookAt(cx * 0.2, 30, cz - 260);
      titleCam.aspect = W / H; titleCam.updateProjectionMatrix();
      FC.Foliage.updateStreaming([titleCam.position]);
      FC.Env.prepareView(titleCam); FC.Foliage.prepareView(titleCam);
      FC.FX.setView(H * renderer.getPixelRatio(), titleCam.fov);
      FC.Render.renderView(0, titleCam, { x: 0, y: 0, w: W, h: H }, H, null);
      return;
    }
    FC.Foliage.updateStreaming(G.players.map((p) => p.cam.position));
    const rs = rects();
    G.players.forEach((p, i) => {
      const r = rs[i];
      if (Math.abs(p.cam.aspect - r.w / r.h) > 0.001) { p.cam.aspect = r.w / r.h; p.cam.updateProjectionMatrix(); }
      FC.Env.prepareView(p.cam); FC.Foliage.prepareView(p.cam);
      FC.FX.setView(r.h * renderer.getPixelRatio(), p.cam.fov);
      const fx = { damage: p.alive ? FC.clamp(1 - p.hp / (p.maxHp * 0.4), 0, 1) : 0, down: p.state === 'downed' ? 1 : p.state === 'dead' ? 1 : 0, flash: (FC.Render.fade || 0) };
      FC.Render.renderView(i, p.cam, r, H, fx);
      FC.HUD.draw(G, p, r);
    });
    if (FC.Render.fade) FC.Render.fade = Math.max(0, FC.Render.fade - 0.03);
    if (G.players.length > 1) FC.HUD.divider(W, H, G.split === 'vertical');
  }

  // ===================================================================== flow
  const slots = [];
  function deviceLabel(d) {
    if (d === 'kbm') return 'Keyboard + Mouse';
    if (d === 'kb2') return 'Keyboard (right side)';
    const gp = FC.Input.pads()[parseInt(d.slice(3), 10)];
    return 'Gamepad' + (gp ? ` — ${gp.id.split('(')[0].trim().slice(0, 28)}` : '');
  }
  function refreshSlots() {
    for (let i = 0; i < 2; i++) {
      const el = $('slot' + i), d = slots[i];
      el.classList.toggle('joined', !!d);
      el.querySelector('.dev').textContent = d ? deviceLabel(d) : (i === 0 ? 'Click, or press Ⓐ on a gamepad' : 'Press ENTER, or Ⓐ on another gamepad');
    }
  }
  function join(dev) {
    if (G.state !== 'title' || slots.includes(dev) || slots.length >= 2) return;
    slots.push(dev); refreshSlots(); FC.Audio.init(); FC.Audio.ui();
  }
  $('title').addEventListener('mousedown', (e) => { if (e.target.closest('button') || e.target.closest('select')) return; join('kbm'); });
  $('newgame').addEventListener('click', () => { if (!slots.length) join('kbm'); startGame(false); });
  $('continue').addEventListener('click', () => { if (!slots.length) join('kbm'); startGame(true); });
  $('resetSlots').addEventListener('click', (e) => { e.stopPropagation(); slots.length = 0; refreshSlots(); });
  document.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); G.split = b.dataset.split;
    document.querySelectorAll('[data-split]').forEach((x) => x.classList.toggle('on', x.dataset.split === G.split));
  }));
  const diffSel = $('difficulty');
  diffSel.value = G.diffKey;
  diffSel.addEventListener('change', () => { G.setDifficulty(diffSel.value); $('difficultyP').value = G.diffKey; });
  $('difficultyP').value = G.diffKey;
  $('difficultyP').addEventListener('change', () => { G.setDifficulty($('difficultyP').value); diffSel.value = G.diffKey; });
  const qualitySel = $('quality');
  qualitySel.addEventListener('change', () => { G.quality = qualitySel.value; FC.Render.setQuality(G.quality); $('qualityP').value = G.quality; });
  $('qualityP').addEventListener('change', () => { G.quality = $('qualityP').value; FC.Render.setQuality(G.quality); qualitySel.value = G.quality; });
  FC.Input.onKey((code) => {
    if (G.state === 'title') {
      if (code === 'Enter' || code === 'NumpadEnter') join('kb2');
      else if (code === 'Space') { if (!slots.length) join('kbm'); startGame(!!FC.Progression.load()); }
      else if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) join('kbm');
    } else if (G.state === 'paused' && (code === 'Space' || code === 'Backspace')) setPaused(false);
    else if (G.state === 'victory' && code === 'Space') { $('victory').classList.add('hidden'); G.state = 'playing'; if (G.players.some((p) => p.ctrl.usesMouse)) FC.Input.lock(); }
  });
  FC.Input.onLockChange((locked) => { if (!locked && G.state === 'playing' && G.players.some((p) => p.ctrl.usesMouse)) setPaused(true); });
  glCanvas.addEventListener('click', () => { if (G.state === 'playing' && G.players.some((p) => p.ctrl.usesMouse) && !FC.Input.locked) FC.Input.lock(); });
  $('resume').addEventListener('click', () => setPaused(false));
  $('splitBtn').addEventListener('click', () => { G.split = G.split === 'vertical' ? 'horizontal' : 'vertical'; $('splitBtn').textContent = `Split: ${G.split}`; });
  $('saveQuit').addEventListener('click', () => { FC.Progression.save(G); location.reload(); });
  $('again').addEventListener('click', () => { $('victory').classList.add('hidden'); G.state = 'playing'; });

  function startGame(cont) {
    if (G.state !== 'title' || !slots.length) return;
    FC.Audio.init();
    const save = cont ? FC.Progression.load() : null;
    if (!cont) FC.Progression.clear();
    G.state = 'playing';
    $('title').classList.add('hidden');
    slots.forEach((dev, i) => {
      const p = new FC.Player(i, dev, scene);
      p.spawnAt(FC.World.start.x + (i ? 2 : -2), FC.World.start.z + 6);
      G.players.push(p);
    });
    G.stats.start = G.time;
    if (save) applySave(save);
    else {
      FC.Env.hour = 7.2;
      G.revealAround(FC.World.start.x, FC.World.start.z, 200);
      FC.Missions.start(G, 0);
    }
    G.players.forEach((p) => p.msg(`Map [${p.ctrl.labels.map}] · Tag [${p.ctrl.labels.tag}] · Takedown [${p.ctrl.labels.interact}]`, '#ddd', 8));
    if (G.players.some((p) => p.ctrl.usesMouse)) FC.Input.lock();
  }
  function applySave(s) {
    const W = FC.World;
    FC.Env.hour = s.hour || 8;
    s.outposts.forEach((lib, i) => {
      if (!lib) return;
      const op = W.outposts[i];
      op.liberated = true; op.flag.material.color.set(0x23b38a);
      for (const e of G.enemies) if (e.outpost === op && e.alive) { e.alive = false; e.rig.root.visible = false; e.deadT = 999; }
    });
    s.towers.forEach((h, i) => { if (h) { const t = W.towers[i]; t.hacked = true; t.screen.material.emissive.set(0x23e0a0); t.blink.material.emissive.set(0x23e0a0); } });
    (s.collectibles || []).forEach((tk, i) => { if (tk && G.collectibles[i]) { G.collectibles[i].taken = true; G.collectibles[i].mesh.visible = false; } });
    if (s.reveal) G.reveal.set(s.reveal);
    G.players.forEach((p, i) => {
      const d = s.players[i] || s.players[0];
      if (!d) return;
      p.prog = d.prog; p.owned = new Set(d.owned); p.medkits = d.medkits;
      for (const k in d.ammo) if (p.ammo[k]) Object.assign(p.ammo[k], d.ammo[k]);
      if (d.stats) p.stats = d.stats;
      p.maxHp = 100 + (p.has('tough1') ? 25 : 0) + (p.has('tough2') ? 25 : 0); p.hp = p.maxHp;
    });
    FC.Missions.index = s.mission || 0;
    FC.Missions.current = FC.Missions.list[FC.Missions.index] || null;
    G.announce('Welcome back to Isla Brava', '#ffd9a0', 4);
  }
  function setPaused(on) {
    if (on && G.state === 'playing') { FC.Audio.stopLoops(); G.state = 'paused'; $('pause').classList.remove('hidden'); $('splitBtn').textContent = `Split: ${G.split}`; }
    else if (!on && G.state === 'paused') { G.state = 'playing'; $('pause').classList.add('hidden'); if (G.players.some((p) => p.ctrl.usesMouse)) FC.Input.lock(); }
  }
  function victory() {
    G.state = 'victory';
    FC.Input.unlock();
    FC.Audio.victory();
    const secs = Math.round(G.time - G.stats.start);
    $('vtime').textContent = `${Math.floor(secs / 3600)}h ${Math.floor(secs / 60) % 60}m`;
    $('vstats').innerHTML = G.players.map((p) => `<div class="stat" style="border-color:${p.color}"><h3 style="color:${p.color}">${p.name} · Lv ${p.prog.level}</h3>
      <p>Kills <b>${p.stats.kills}</b></p><p>Headshots <b>${p.stats.headshots}</b></p><p>Takedowns <b>${p.stats.takedowns}</b></p>
      <p>Tags <b>${p.stats.tags}</b></p><p>Revives <b>${p.stats.revives}</b></p></div>`).join('');
    $('victory').classList.remove('hidden');
    FC.Progression.save(G);
  }

  // ===================================================================== main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    FC.Input.update();
    if (G.state === 'title') {
      G.time += dt;
      FC.Env.update(dt * 0.5, G);
      const pads = FC.Input.pads();
      for (let i = 0; i < pads.length; i++) {
        if (!pads[i]) continue;
        if (FC.Input.padJust(i, 0)) join('pad' + i);
        if (FC.Input.padJust(i, 9)) { if (!slots.length) join('pad' + i); startGame(!!FC.Progression.load()); }
      }
      for (const a of G.animals) a.update(dt, G, G.nearestPlayerDist(a.pos));
      FC.FX.update(dt);
    } else if (G.state === 'playing') {
      G.time += dt;
      FC.Env.update(dt, G);
      updateEntities(dt);
      FC.FX.update(dt);
    } else if (G.state === 'paused') {
      for (const p of G.players) if (p.ctrl.padIndex >= 0 && FC.Input.padJust(p.ctrl.padIndex, 9)) setPaused(false);
    } else if (G.state === 'victory') {
      for (const p of G.players) if (p.ctrl.padIndex >= 0 && FC.Input.padJust(p.ctrl.padIndex, 0)) { $('victory').classList.add('hidden'); G.state = 'playing'; }
    }
    render();
    FC.Input.endFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  boot().catch((e) => { $('loadtxt').textContent = 'Failed to load: ' + e.message; console.error(e); });
})();
