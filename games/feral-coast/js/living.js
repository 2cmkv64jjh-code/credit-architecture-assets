'use strict';
// A living island: crocodiles & sharks, lightning storms that start wildfires, random roadside events,
// named bounty targets, ledger-revealed treasure, and village side quests.
FC.Living = (function () {
  let scene = null;
  const L = { treasures: [], quests: [], bounties: [], event: null, eventT: 200, lightningT: 8 };
  const S = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8 }, o || {}));

  // ============================================================ water predators (procedural)
  function crocMesh() {
    const g = new THREE.Group(), skin = S(0x3e4a2c), belly = S(0x6b6a45), dark = S(0x222418);
    const part = (w, h, d, x, y, z, m, parent) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; (parent || g).add(b); return b; };
    part(0.75, 0.38, 1.6, 0, 0.25, 0, skin); part(0.65, 0.1, 1.5, 0, 0.06, 0, belly);
    for (let i = 0; i < 6; i++) part(0.1, 0.08, 0.12, (i % 2 ? 0.18 : -0.18), 0.48, -0.6 + i * 0.25, dark);
    const head = new THREE.Group(); head.position.set(0, 0.25, -0.85); g.add(head);
    part(0.5, 0.22, 0.6, 0, 0.04, -0.25, skin, head);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.06, -0.05); head.add(jaw);
    part(0.42, 0.08, 0.55, 0, 0, -0.25, belly, jaw);
    part(0.08, 0.06, 0.06, 0.15, 0.17, -0.1, S(0xd8c040, { emissive: 0x302800 }), head);
    part(0.08, 0.06, 0.06, -0.15, 0.17, -0.1, S(0xd8c040, { emissive: 0x302800 }), head);
    const tail = [];
    let parent = g, z = 0.8;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group(); seg.position.set(0, i ? 0 : 0.22, i ? 0.42 : z); parent.add(seg);
      part(0.55 - i * 0.12, 0.28 - i * 0.05, 0.45, 0, 0, 0.2, skin, seg);
      tail.push(seg); parent = seg;
    }
    const legs = [];
    for (const [x, zz] of [[-0.42, -0.5], [0.42, -0.5], [-0.42, 0.5], [0.42, 0.5]]) { const l = part(0.16, 0.16, 0.36, x, 0.1, zz, skin); legs.push(l); }
    return { g, head, jaw, tail, legs };
  }
  function sharkMesh() {
    const g = new THREE.Group(), skin = S(0x5b6b78, { roughness: 0.5 }), belly = S(0xc8cfd4);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), skin); body.scale.set(0.8, 0.75, 3.6); g.add(body);
    const under = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 6), belly); under.scale.set(0.7, 0.45, 3.2); under.position.y = -0.15; g.add(under);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 4), skin); fin.position.set(0, 0.7, -0.1); fin.scale.z = 0.25; g.add(fin);
    const tail = new THREE.Group(); tail.position.z = 1.7; g.add(tail);
    const tf = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 4), skin); tf.rotation.x = Math.PI / 2; tf.scale.x = 0.2; tf.position.z = 0.35; tail.add(tf);
    for (const s of [-1, 1]) { const pf = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.35), skin); pf.position.set(s * 0.5, -0.15, -0.6); pf.rotation.z = s * -0.3; g.add(pf); }
    return { g, tail, fin };
  }
  class Predator {
    constructor(kind, x, z) {
      this.kind = kind; this.hostile = true; this.alive = true; this.deadT = 0;
      this.land = kind === 'bear' || kind === 'jaguar';
      this.hp = kind === 'croc' ? 180 : kind === 'jaguar' ? 160 : this.land ? 320 : 150;
      this.pos = new THREE.Vector3(x, 0, z); this.home = { x, z }; this.yaw = Math.random() * 6; this.state = 'lurk'; this.t = 0; this.biteT = 0;
      if (kind === 'shark' && FC.Assets.gltf.shark) {
        // animated CC0 shark (Quaternius Pirate Kit), scaled to ~3.4 m long
        const mm = FC.Rig.measure('shark');
        this.realRig = new FC.Rig('shark', { height: 3.4 * mm.h / mm.len });
        this.realRig.play('Swim');
        this.m = { g: this.realRig.root };
        this.rig = this.realRig;
      } else if ((kind === 'croc' && FC.Assets.gltf.croc) || kind === 'bear' || kind === 'jaguar') {
        // CC BY Poly Pizza models (crocodile by jeremy, black bear by Poly by Google), moved procedurally
        const g = kind === 'croc' ? FC.Assets.orientedProp('croc', { len: 3.3, faceFix: -Math.PI / 2 }) : FC.Assets.orientedProp(kind, { len: kind === 'jaguar' ? 1.9 : 2.1, faceFix: Math.PI });
        this.m = { g, model: g.children[0] };
        this.rig = { size: g.userData.size, root: g };
      } else {
        this.m = kind === 'croc' ? crocMesh() : sharkMesh();
        this.rig = { size: kind === 'croc' ? { h: 0.6, len: 3.2, wid: 0.8 } : { h: 0.9, len: 3.6, wid: 0.9 }, root: this.m.g };
      }
      scene.add(this.m.g);
    }
    damage(G, amount, attacker) {
      if (!this.alive) return;
      this.hp -= amount;
      if (this.hp <= 0) {
        this.alive = false; FC.Audio.creatureDie(this.pos);
        if (attacker && attacker.index !== undefined) { FC.Progression.xp(attacker, this.land ? 45 : 30, this.kind === 'croc' ? 'Crocodile' : this.kind === 'jaguar' ? 'Jaguar' : this.land ? 'Black bear' : 'Shark', G); FC.Progression.cash(attacker, this.land ? 90 : 60, 'Hide', G);
          attacker.prog.pelts = attacker.prog.pelts || {}; attacker.prog.pelts[this.kind] = (attacker.prog.pelts[this.kind] || 0) + 1; }
        return;
      }
      if (attacker && attacker.pos) { if (this.land && this.state !== 'attack') FC.Audio.snarl(this.pos); this.state = 'attack'; this.target = attacker; }
    }
    update(dt, G, nearest) {
      const W = FC.World, m = this.m;
      if (!this.alive) { this.deadT += dt; m.g.rotation.z = Math.min(this.land ? Math.PI / 2 : Math.PI, this.deadT * 2); m.g.position.y = this.kind === 'shark' ? -0.2 : this.pos.y + (this.land ? this.rig.size.wid * 0.4 : 0); return; }
      if (nearest > 260) { m.g.visible = false; return; }
      m.g.visible = true;
      this.t += dt; this.biteT -= dt;
      // prey: anyone in or at the edge of the water nearby (boats are safe from crocs, not from shark bumps)
      if (this.state !== 'attack' || !this.target || !this.target.alive) {
        this.state = 'lurk'; this.target = null;
        const range = this.kind === 'croc' ? 9 : this.land ? 17 : 16;
        for (const p of G.players) {
          if (!p.alive || p.vehicle) continue;
          const wet = this.land ? true : W.heightAt(p.pos.x, p.pos.z) < (this.kind === 'croc' ? 1.0 : -1.4);
          const sneaky = this.land && p.crouch && p.pos.distanceTo(this.pos) > (this.kind === 'jaguar' ? 5 : 8);
          if (wet && !sneaky && p.pos.distanceTo(this.pos) < range) { this.state = 'attack'; this.target = p; if (this.land) FC.Audio.snarl(this.pos); else FC.Audio.growl(0.8, this.pos); break; }
        }
      }
      let tx, tz, speed;
      if (this.state === 'attack') {
        tx = this.target.pos.x; tz = this.target.pos.z; speed = this.kind === 'croc' ? 7 : this.kind === 'jaguar' ? 9.5 : this.land ? 7.5 : 9;
        if (this.land && Math.hypot(tx - this.home.x, tz - this.home.z) > 90) this.state = 'lurk'; // gives up the chase
      } else if (this.land) {
        const a = this.t * 0.05; tx = this.home.x + Math.cos(a) * 25; tz = this.home.z + Math.sin(a * 1.3) * 25; speed = 1.4;
      } else {
        const a = this.t * (this.kind === 'shark' ? 0.25 : 0.08);
        tx = this.home.x + Math.cos(a) * (this.kind === 'shark' ? 22 : 6); tz = this.home.z + Math.sin(a) * (this.kind === 'shark' ? 22 : 6);
        speed = this.kind === 'shark' ? 3.5 : 0.8;
      }
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.5) {
        const nx = this.pos.x + (dx / d) * speed * dt, nz = this.pos.z + (dz / d) * speed * dt;
        const h = W.heightAt(nx, nz);
        const ok = this.kind === 'croc' ? h < 1.4 : this.land ? h > 1.5 && !W.pointBlocked(nx, nz, 0.8) : h < -2.5;
        if (ok) { this.pos.x = nx; this.pos.z = nz; } else if (this.state === 'attack' && this.kind === 'shark') this.state = 'lurk';
        this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 3);
      }
      if (this.state === 'attack' && this.target && d < (this.kind === 'croc' ? 1.9 : this.land ? 2.3 : 2.2) && this.biteT <= 0) {
        this.biteT = this.land ? 1.1 : 1.4;
        if (this.land) FC.Audio.snarl(this.pos);
        this.target.damage((this.kind === 'croc' ? 26 : this.land ? 30 : 32) * G.enemyDmgMul + 6, this.pos.x, this.pos.z, G);
        FC.FX.impact(this.target.pos.x, this.target.pos.y + 0.6, this.target.pos.z, 'blood');
        FC.Audio.splash(this.pos);
      }
      const h = W.heightAt(this.pos.x, this.pos.z);
      this.pos.y = this.kind === 'croc' ? Math.max(h, -0.32) : this.land ? h : (this.state === 'attack' ? -0.35 : -0.55);
      m.g.position.copy(this.pos); m.g.rotation.set(0, this.yaw, 0);
      const wig = Math.sin(this.t * (speed > 3 ? 9 : 3));
      if (m.model) {
        // procedural motion for the static models: body sway / waddle, lunge when biting
        const moving = d > 0.5, sp = moving ? speed : 0;
        if (this.kind === 'croc') { m.model.rotation.z = 0; m.g.rotation.y = this.yaw + wig * (sp > 2 ? 0.12 : 0.03); m.model.position.z = this.state === 'attack' && d < 4 ? -Math.max(0, Math.sin(this.t * 7)) * 0.4 : 0; }
        else { const ph = this.t * (sp > 3 ? 11 : 5); m.model.rotation.z = moving ? Math.sin(ph) * (sp > 3 ? 0.07 : 0.05) : 0; m.model.position.y = moving ? Math.abs(Math.sin(ph)) * (sp > 3 ? 0.12 : 0.04) : Math.sin(this.t * 1.5) * 0.01;
          m.model.rotation.x = this.state === 'attack' && d < 3 && this.biteT > 0.7 ? -0.25 : 0; }
      } else if (this.kind === 'croc') {
        m.tail.forEach((s, i) => { s.rotation.y = wig * 0.25 * (i + 1) * 0.5; });
        m.jaw.rotation.x = this.state === 'attack' && d < 4 ? 0.5 + Math.sin(this.t * 14) * 0.2 : 0.05;
        m.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.t * 8 + i * 1.6) * (speed > 2 ? 0.5 : 0.05); });
      } else if (this.realRig) {
        this.realRig.play(this.state === 'attack' ? (d < 5 ? 'Swim_Bite' : 'Swim_Fast') : 'Swim');
        this.realRig.update(dt, nearest);
      } else m.tail.rotation.y = wig * 0.5;
    }
    flee() {}
  }
  function spawnPredators(G) {
    const W = FC.World;
    const find = (test, tries) => { for (let t = 0; t < tries; t++) { const x = FC.rand(-720, 720), z = FC.rand(-720, 720); if (test(W.heightAt(x, z), x, z)) return { x, z }; } return null; };
    for (const site of [W.outposts[2], W.outposts[6], W.villages[0], W.villages[2]]) {
      for (let i = 0; i < 2; i++) {
        for (let t = 0; t < 200; t++) {
          const a = Math.random() * 6.28, r = FC.rand(40, 160), x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r, h = W.heightAt(x, z);
          if (h < -0.3 && h > -1.3) { G.animals.push(new Predator('croc', x, z)); break; }
        }
      }
    }
    for (let i = 0; i < 6; i++) { const p = find((h) => h < -6 && h > -16, 400); if (p) G.animals.push(new Predator('shark', p.x, p.z)); }
    // black bears roam the high forest (never near camps, outposts or villages)
    // jaguars stalk the lowland jungle
    if (FC.Assets.gltf.jaguar) for (let i = 0; i < 5; i++) { const p = find((h, x, z) => h > 5 && h < 25 && !W.isReserved(x, z, 80), 600); if (p) G.animals.push(new Predator('jaguar', p.x, p.z)); }
    if (FC.Assets.gltf.bear) for (let i = 0; i < 6; i++) { const p = find((h, x, z) => h > 22 && h < 90 && W.slopeAt(x, z) < 0.6 && !W.isReserved(x, z, 90), 600); if (p) G.animals.push(new Predator('bear', p.x, p.z)); }
  }

  // ============================================================ storms & lightning
  function updateStorm(dt, G) {
    if (FC.Env.rain < 0.8) return;
    L.lightningT -= dt;
    if (L.lightningT > 0) return;
    L.lightningT = FC.rand(5, 14);
    FC.Render.fade = Math.max(FC.Render.fade || 0, 0.55);
    const strike = Math.random() < 0.35 && G.players.length;
    const p = strike ? FC.pick(G.players) : null;
    const pt = strike ? FC.World.landPoint(p.pos.x, p.pos.z, 60, 220) : null;
    FC.Audio.thunder(pt ? Math.hypot(pt.x - p.pos.x, pt.z - p.pos.z) : FC.rand(350, 900));
    if (strike) {
      if (FC.World.heightAt(pt.x, pt.z) > 2) {
        G.ignite(pt.x, pt.z, 4, 14, null);
        FC.FX.explosion(pt.x, FC.World.heightAt(pt.x, pt.z), pt.z);
        G.announce('Lightning strike — the brush is burning!', '#ffb35c', 2.5);
      }
    }
  }

  // ============================================================ random events
  function startEvent(G) {
    const W = FC.World, p = FC.pick(G.players.filter((q) => q.alive) || G.players);
    if (!p) return;
    const near = W.nearestRoadPoint(p.pos.x, p.pos.z);
    if (!near) return;
    // a spot 60-110 m further along a road from the player
    const pts = near.road.pts, dir = Math.random() < 0.5 ? 1 : -1;
    let k = near.k, acc = 0;
    while (k + dir >= 0 && k + dir < pts.length && acc < 85) { acc += Math.hypot(pts[k + dir].x - pts[k].x, pts[k + dir].z - pts[k].z); k += dir; }
    const spot = pts[k];
    if (Math.hypot(spot.x - p.pos.x, spot.z - p.pos.z) < 40 || W.isReserved(spot.x, spot.z, 10)) return;
    const kind = FC.pick(['execution', 'execution', 'ambush', 'drop', 'vip']);
    const ev = { kind, x: spot.x, z: spot.z, t: 0, enemies: [], done: false };
    const add = (type, dx, dz) => { const e = new FC.Enemy(type, spot.x + dx, spot.z + dz, null, scene); G.enemies.push(e); ev.enemies.push(e); return e; };
    if (kind === 'execution') {
      const village = { x: spot.x, z: spot.z, wander: [{ x: spot.x, z: spot.z }] };
      const c = new FC.Civilian(village, scene); c.captive = true; c.pos.set(spot.x, W.heightAt(spot.x, spot.z), spot.z);
      G.civilians.push(c); ev.victim = c;
      const g1 = add('grunt', 2, 1), g2 = add('grunt', -2, 1.5);
      g1.idleT = g2.idleT = 999; g1.yaw = FC.yawTo(-2, -1); g2.yaw = FC.yawTo(2, -1.5);
      ev.limit = 50;
      G.announce('Militia are about to execute a villager on the road — stop them!', '#ff9f43', 5);
    } else if (kind === 'ambush') {
      for (let i = 0; i < 4; i++) { const e = add('grunt', FC.rand(-14, 14), FC.rand(-14, 14)); e.idleT = 999; }
      ev.silent = true;
    } else if (kind === 'drop') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), S(0x2f7d4f, { map: FC.Assets.tex.wood }));
      const chute = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), S(0xd9822b, { side: THREE.DoubleSide }));
      chute.position.y = 4; box.add(chute);
      box.position.set(spot.x, W.heightAt(spot.x, spot.z) + 80, spot.z); scene.add(box); ev.box = box; ev.chute = chute;
      for (let i = 0; i < 3; i++) add('grunt', FC.rand(-40, 40), FC.rand(30, 45)).moveTo = { x: spot.x, z: spot.z };
      G.announce('Supply drop spotted nearby — beat the Tide to it!', '#9be7a1', 4);
    } else if (kind === 'vip') {
      const roads = W.roads.filter((r) => r.len > 250 && r.a !== W.start && r.b !== W.start);
      const cv = new FC.Convoy(G, FC.pick(roads), scene);
      const officer = new FC.Enemy('heavy', cv.truck.pos.x, cv.truck.pos.z, null, scene);
      officer.state = 'ride'; officer.convoy = cv; officer.seatIdx = 0; officer.hp = officer.maxHp = 320; officer.bounty = 'Tide Paymaster';
      cv.guards.push(officer); G.enemies.push(officer); G.convoys.push(cv);
      ev.enemies.push(officer); ev.vip = officer;
      G.announce('A Tide paymaster is travelling by convoy — $400 if he dies', '#ffd166', 5);
    }
    L.event = ev;
  }
  function updateEvent(dt, G) {
    if (G.mode && G.mode !== 'campaign') return;
    if (!L.event) {
      L.eventT -= dt;
      if (L.eventT <= 0 && G.players.length) { L.eventT = FC.rand(180, 300); startEvent(G); }
      return;
    }
    const ev = L.event;
    ev.t += dt;
    const alive = ev.enemies.filter((e) => e.alive);
    if (ev.kind === 'execution') {
      if (!alive.length && ev.victim.alive) {
        ev.victim.captive = false; ev.victim.scare(new THREE.Vector3(ev.x, 0, ev.z));
        G.announce('Villager saved!', '#7bed9f', 3);
        for (const p of G.players) { FC.Progression.xp(p, 80, 'Rescue', G); FC.Progression.cash(p, 100, 'Grateful villager', G); }
        L.event = null;
      } else if (ev.t > ev.limit && ev.victim.alive && alive.length) {
        alive[0].shoot(G, { pos: ev.victim.pos, eyeH: 1, crouch: false, speed: 0, inBush: false, vehicle: null, damage: () => {} }, 2);
        ev.victim.damage(G, 999, null);
        G.announce('Too late — they shot him.', '#ff6b6b', 3);
        L.event = null;
      }
    } else if (ev.kind === 'drop') {
      const box = ev.box, gy = FC.World.heightAt(box.position.x, box.position.z);
      if (box.position.y > gy + 0.6) { box.position.y -= dt * 4.5; box.rotation.y += dt * 0.5; if (Math.random() < dt * 8) FC.FX.smoke(box.position.x, box.position.y, box.position.z, 0.8); }
      else {
        if (ev.chute.visible) { ev.chute.visible = false; FC.Audio.impact(box.position); }
        for (const p of G.players) if (p.alive && p.pos.distanceTo(box.position) < 2.5) {
          scene.remove(box);
          for (const q of G.players) { FC.Progression.cash(q, 200, 'Supply drop', G); q.medkits = Math.min(FC.Progression.medCap(q), q.medkits + 1); for (const k of ['pistol', 'bow', 'rifle', 'shotgun', 'sniper']) q.ammo[k].reserve = FC.Progression.maxReserve(q, k); }
          G.announce('Supply drop secured: ammo, medkits and cash', '#7bed9f', 3);
          L.event = null; break;
        }
      }
      if (L.event && ev.t > 240) { scene.remove(box); L.event = null; }
    } else if (ev.kind === 'vip') {
      if (!ev.vip.alive) { for (const p of G.players) FC.Progression.cash(p, 400, 'Paymaster bounty', G); G.announce('Paymaster eliminated!', '#ffd166', 3); L.event = null; }
      else if (ev.t > 420) L.event = null;
    } else if (!alive.length || ev.t > 300) L.event = null;
  }

  // ============================================================ bounties
  const NAMES = ['Captain Rask', 'Lieutenant Mora', 'Sergeant Okafor', 'The Butcher of Gullet'];
  function setupBounties(G) {
    [4, 5, 7, 8].forEach((oi, i) => {
      const e = G.enemies.find((x) => x.outpost === FC.World.outposts[oi] && x.type === 'heavy' && !x.bounty);
      if (e) { e.bounty = NAMES[i]; e.hp = e.maxHp = 420; L.bounties.push(e); }
    });
  }

  // ============================================================ treasure (revealed by Tide Ledgers)
  function setupTreasure() {
    const W = FC.World, rng = FC.mulberry32(31337);
    const chestMat = S(0x7a5a2a, { map: FC.Assets.tex.wood });
    for (let i = 0; i < 5; i++) {
      for (let t = 0; t < 300; t++) {
        const x = (rng() * 2 - 1) * 650, z = (rng() * 2 - 1) * 650, h = W.heightAt(x, z);
        if (h < 6 || W.slopeAt(x, z) > 0.5 || W.isReserved(x, z, 30) || W.roadAt(x, z) > 0.1) continue;
        const m = FC.Assets.propMesh(FC.Assets.gltf.chestGold ? 'chestGold' : 'chest', { length: 1.1 });
        m.position.set(x, h, z); m.rotation.y = rng() * 6; scene.add(m);
        L.treasures.push({ x, z, y: h, mesh: m, revealed: false, taken: false });
        break;
      }
    }
    void chestMat;
  }
  const LOOT = ['rifle_sight', 'pistol_mag', 'rifle_mag', 'sniper_sup', 'rifle_sup'];
  function onLedger(G) {
    const next = L.treasures.find((t) => !t.revealed);
    if (next) { next.revealed = true; G.revealAround(next.x, next.z, 40); G.announce('The ledger mentions a hidden Tide stash — marked on your map', '#ffd166', 4); }
  }

  // ============================================================ village side quests
  function setupQuests() {
    const V = FC.World.villages;
    L.quests = [
      { village: V[0], title: 'Venison for Palmhaven', text: 'Hunt 3 deer and bring the pelts back', kind: 'hunt', animal: 'deer', need: 3, count: 0, state: 'open', reward: 200 },
      { village: V[1], title: 'Wolves at Tidewater', text: 'Kill 4 wolves', kind: 'hunt', animal: 'wolf', need: 4, count: 0, state: 'open', reward: 220 },
      { village: V[2], title: 'Cloudrest Medicine', text: 'Recover a medicine crate from the hills', kind: 'fetch', state: 'open', reward: 250 },
      { village: V[3], title: 'Silence the Jammer', text: "Destroy the Tide radio jammer near Ironbark", kind: 'destroy', state: 'open', reward: 250 },
    ];
    for (const q of L.quests) {
      const v = q.village;
      q.giver = { x: v.x + 3, z: v.z + 3 };
      if (q.kind === 'fetch') {
        const p = FC.World.landPoint(v.x, v.z, 140, 220);
        q.target = { x: p.x, z: p.z };
        q.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), S(0xeeeeee, { emissive: 0x330000 }));
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.62), S(0xc0392b)); q.mesh.add(cross);
        q.mesh.position.set(p.x, FC.World.heightAt(p.x, p.z) + 0.3, p.z); q.mesh.visible = false; scene.add(q.mesh);
      }
      if (q.kind === 'destroy') {
        const p = FC.World.landPoint(v.x, v.z, 120, 200);
        q.target = { x: p.x, z: p.z };
        const y = FC.World.heightAt(p.x, p.z);
        const m = FC.Assets.propMesh('dish', { height: 2.6 }); m.position.set(p.x, y, p.z); scene.add(m);
        const b = { x: p.x + 1, y, z: p.z, hp: 60, exploded: false, mesh: FC.Assets.propMesh('generator', { length: 1.6 }), questJammer: q };
        b.mesh.position.set(p.x + 1, y, p.z); scene.add(b.mesh); FC.World.barrels.push(b);
        q.jammer = b; q.dish = m;
      }
    }
  }
  function questInteract(p, c, G) {
    const lab = p.ctrl.labels;
    for (const q of L.quests) {
      if (Math.hypot(q.giver.x - p.pos.x, q.giver.z - p.pos.z) < 3) {
        if (q.state === 'open') { p.prompt = `[${lab.interact}] Side quest: ${q.title}`; if (c.pressed.interact) { q.state = 'active'; if (q.mesh) q.mesh.visible = true; G.announce(`Side quest accepted — ${q.text}`, '#9be7e1', 4); FC.Audio.quest(); } return true; }
        if (q.state === 'ready') { p.prompt = `[${lab.interact}] Hand in: ${q.title}`; if (c.pressed.interact) { q.state = 'done'; for (const pl of G.players) { FC.Progression.cash(pl, q.reward, q.title, G); FC.Progression.xp(pl, 120, 'Side quest', G); } G.announce(`${q.title} complete!`, '#7bed9f', 3); FC.Audio.liberate(); } return true; }
      }
      if (q.kind === 'fetch' && q.state === 'active' && !q.carried && q.mesh && p.pos.distanceTo(q.mesh.position) < 2.2) {
        p.prompt = `[${lab.interact}] Pick up the medicine crate`;
        if (c.pressed.interact) { q.carried = p; q.mesh.visible = false; q.state = 'ready'; p.msg('Medicine crate picked up — return to Cloudrest', '#9be7e1', 3); }
        return true;
      }
    }
    for (const t of L.treasures) {
      if (!t.taken && Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < 2.2) {
        p.prompt = `[${lab.interact}] Open the Tide stash`;
        if (c.pressed.interact) {
          t.taken = true; t.mesh.rotation.x = -0.5;
          const mod = LOOT.find((m) => !(p.prog.mods || []).includes(m));
          FC.Progression.cash(p, 300, 'Stash', G);
          if (mod) { p.prog.mods = p.prog.mods || []; p.prog.mods.push(mod); p.msg(`Found an attachment: ${FC.SHOP.find((s) => s.id === mod).name}`, '#ffd166', 4); }
          FC.Audio.liberate();
        }
        return true;
      }
    }
    return false;
  }
  function onAnimalKilled(a, p, G) {
    p.prog.pelts = p.prog.pelts || {};
    if (a.kind) p.prog.pelts[a.kind] = (p.prog.pelts[a.kind] || 0) + 1;
    for (const q of L.quests) if (q.state === 'active' && q.kind === 'hunt' && q.animal === a.kind) { q.count++; p.msg(`${q.title}: ${q.count}/${q.need}`, '#9be7e1', 2); if (q.count >= q.need) { q.state = 'ready'; G.announce(`${q.title}: return to ${q.village.name}`, '#9be7e1', 3); } }
  }
  function update(dt, G) {
    updateStorm(dt, G);
    updateEvent(dt, G);
    for (const q of L.quests) if (q.kind === 'destroy' && q.state === 'active' && q.jammer.exploded) { q.state = 'ready'; if (q.dish) q.dish.visible = false; G.announce(`${q.title}: jammer destroyed — return to ${q.village.name}`, '#9be7e1', 3); }
  }
  function init(sc, G) {
    scene = sc;
    spawnPredators(G);
    setupBounties(G);
    setupTreasure();
    setupQuests();
  }
  function applyCamp(G, id) {
    const W = FC.World;
    W.start.patrol = W.start.patrol || [];
    if (id === 'camp_sentries') FC.Features.garrison(G, W.start, 3);
    if (id === 'camp_garage') {
      const a = W.landPoint(W.start.x, W.start.z, 22, 34), b = W.landPoint(W.start.x, W.start.z, 10, 18);
      G.vehicles.push(new FC.Vehicle('gyro', a.x, a.z, 0, scene)); G.vehicles.push(new FC.Vehicle('quad', b.x, b.z, 0, scene));
    }
  }
  return Object.assign(L, { init, update, questInteract, onLedger, onAnimalKilled, applyCamp, Predator });
})();
