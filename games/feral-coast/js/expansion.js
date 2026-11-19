'use strict';
// Expansion systems: ziplines, boats & the Tide patrol boat, alarm reinforcement trucks,
// the wolf companion "Fang", and story set-pieces (alpha wolf, prisoners, fuel depot, Vael's last stand).
FC.Expansion = (function () {
  let scene = null;
  const X = { ziplines: [], prisoners: [], depot: [], trucks: [], companions: [], patrolBoat: null, alpha: null };
  const tmp = new THREE.Vector3();

  // ================================================================ ziplines
  function buildZiplines() {
    const W = FC.World;
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5e4430, roughness: 0.9 });
    const targets = W.outposts.map((o) => ({ x: o.x, z: o.z, r: o.r, name: o.name })).concat(W.villages.map((v) => ({ x: v.x, z: v.z, r: v.r, name: v.name })), [{ x: W.start.x, z: W.start.z, r: W.start.r, name: W.start.name }]);
    for (const t of W.towers) {
      const top = t.y + t.h + 1.9;
      const cand = targets.map((g) => ({ g, d: Math.hypot(g.x - t.x, g.z - t.z) })).filter((c) => c.d > 110 && c.d < 360).sort((a, b) => a.d - b.d);
      let made = 0;
      for (const c of cand) {
        if (made >= 2) break;
        const dx = c.g.x - t.x, dz = c.g.z - t.z, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl;
        const ax = t.x + ux * 3.1, az = t.z + uz * 3.1;
        const bx = c.g.x - ux * (c.g.r + 12), bz = c.g.z - uz * (c.g.r + 12);
        const by = W.heightAt(bx, bz) + 3.2;
        if (by > top - 8) continue;
        // keep the cable clear of the terrain
        let clear = true;
        for (let k = 1; k < 30; k++) {
          const f = k / 30, x = FC.lerp(ax, bx, f), z = FC.lerp(az, bz, f), y = FC.lerp(top, by, f) - 2.4;
          if (y < W.heightAt(x, z) + 1.2 || W.pointBlocked(x, z, 0) && y < 12 + W.heightAt(x, z)) { clear = false; break; }
        }
        if (!clear) continue;
        const A = new THREE.Vector3(ax, top, az), B = new THREE.Vector3(bx, by, bz);
        const len = A.distanceTo(B);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 5), cableMat);
        cable.position.copy(A).add(B).multiplyScalar(0.5);
        cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
        scene.add(cable);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, by - W.heightAt(bx, bz) + 0.4, 0.3), postMat);
        post.position.set(bx, (by + W.heightAt(bx, bz)) / 2, bz); post.castShadow = true; scene.add(post);
        X.ziplines.push({ A, B, len, dir: B.clone().sub(A).normalize(), tower: t, to: c.g });
        made++;
      }
    }
  }
  function startZip(p, z) {
    p.zip = { line: z, s: 0, v: 5 };
    p.vel.set(0, 0, 0); p.crouch = false; p.gliding = false;
    FC.Audio.ambient('whoosh', 0.5);
    G().flags.ziplined = true;
  }
  function rideZip(p, c, dt) {
    const Z = p.zip, L = Z.line;
    const slope = -L.dir.y;
    Z.v = Math.min(24, Z.v + (2 + slope * 12) * dt);
    Z.s += Z.v * dt;
    const at = tmp.copy(L.A).addScaledVector(L.dir, Math.min(Z.s, L.len));
    p.pos.set(at.x, at.y - 2.05, at.z);
    if (c.pressed.jump || Z.s >= L.len - 1.2) {
      const end = Z.s >= L.len - 1.2;
      p.zip = null;
      if (end) { p.pos.y = FC.World.heightAt(p.pos.x, p.pos.z); p.vel.set(L.dir.x * 4, 0, L.dir.z * 4); }
      else { p.vel.set(L.dir.x * Z.v, L.dir.y * Z.v, L.dir.z * Z.v); p.onGround = false; }
    }
  }

  // ================================================================ boats
  function waterSpot(cx, cz, minR, maxR) {
    const W = FC.World;
    for (let t = 0; t < 120; t++) {
      const a = Math.random() * Math.PI * 2, r = FC.rand(minR, maxR);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = W.heightAt(x, z);
      if (h < -1.6 && h > -9) {
        // make sure it's open water, not a puddle
        let ok = true;
        for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) if (W.heightAt(x + dx, z + dz) > -1.0) ok = false;
        if (ok) return { x, z, yaw: FC.yawTo(x - cx, z - cz) };
      }
    }
    return null;
  }
  function placeBoats(G) {
    const W = FC.World;
    const docks = [W.start, W.outposts[0], W.outposts[3], W.outposts[7], W.villages[0], W.villages[1]];
    X.docks = [];
    for (const d of docks) {
      const s = waterSpot(d.x, d.z, 30, 140);
      if (!s) continue;
      const b = new FC.Vehicle('boat', s.x, s.z, s.yaw, scene);
      b.home = s; G.vehicles.push(b); s.site = d; X.docks.push(s);
    }
    // a ring of water waypoints around the island for the Tide patrol boat
    const ring = [];
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      let r = 450;
      while (r < 780 && W.heightAt(Math.cos(a) * r, Math.sin(a) * r) > -5) r += 8;
      if (r < 780) ring.push({ x: Math.cos(a) * (r + 25), z: Math.sin(a) * (r + 25) });
    }
    if (ring.length > 8) spawnPatrolBoat(G, ring);
  }
  function spawnPatrolBoat(G, ring) {
    const p0 = ring[0];
    const boat = new FC.Vehicle('tideboat', p0.x, p0.z, 0, scene);
    boat.patrol = true; boat.ring = ring; boat.k = 1;
    boat.maxHp = boat.hp = 500;
    boat.ai = () => {
      const tgt = boat.ring[boat.k];
      if (Math.hypot(tgt.x - boat.pos.x, tgt.z - boat.pos.z) < 18) boat.k = (boat.k + 1) % boat.ring.length;
      const want = FC.yawTo(tgt.x - boat.pos.x, tgt.z - boat.pos.z);
      const d = FC.wrapAngle(want - boat.yaw);
      const engaged = boat.gunners.some((e) => e.alive && e.alerted);
      return { throttle: engaged ? 0.35 : 0.6, steer: FC.clamp(d * 2, -1, 1), brake: false };
    };
    boat.gunners = [];
    for (let i = 0; i < 2; i++) {
      const e = new FC.Enemy('grunt', p0.x, p0.z, null, scene);
      e.onTower = true; e.onBoat = boat; e.seatIdx = i; e.convoy = { onAlert() {} }; // never dormant, never walks
      boat.gunners.push(e); G.enemies.push(e);
    }
    boat.onDestroyed = (G2, attacker) => {
      for (const e of boat.gunners) if (e.alive) e.die(G2, attacker && attacker.index !== undefined ? attacker : null, false);
      G2.flags.patrolBoat = true;
      G2.announce('Tide patrol boat sunk!', '#ffd166', 4);
      for (const p of G2.players) { FC.Progression.xp(p, 150, 'Patrol boat', G2); FC.Progression.cash(p, 150, 'Salvage', G2); }
    };
    G.vehicles.push(boat);
    X.patrolBoat = boat;
  }
  function updatePatrolBoat() {
    const b = X.patrolBoat;
    if (!b || b.dead) return;
    for (const e of b.gunners) {
      if (!e.alive) continue;
      const off = new THREE.Vector3(e.seatIdx ? 0.45 : -0.45, 0.55, e.seatIdx ? 1.2 : 0.2).applyEuler(new THREE.Euler(b.pitch, b.yaw, b.roll, 'YXZ'));
      e.pos.copy(b.pos).add(off);
      if (!e.alerted) e.yaw = b.yaw + (e.seatIdx ? -1.5 : 1.5);
    }
  }

  // ================================================================ alarm reinforcements by truck
  class ReinforceTruck {
    constructor(G, op, road) {
      this.op = op;
      let pts = road.pts.slice();
      if (road.a === op) pts.reverse();
      // start ~220 m out along the road
      let acc = 0, k0 = pts.length - 1;
      while (k0 > 0 && acc < 220) { acc += Math.hypot(pts[k0].x - pts[k0 - 1].x, pts[k0].z - pts[k0 - 1].z); k0--; }
      this.pts = pts; this.k = k0 + 1;
      const p0 = pts[k0], p1 = pts[Math.min(k0 + 1, pts.length - 1)];
      this.truck = new FC.Vehicle('truck', p0.x, p0.z, FC.yawTo(p1.x - p0.x, p1.z - p0.z), scene);
      this.truck.convoy = this;
      this.truck.ai = () => this.drive();
      this.truck.onDestroyed = (G2, attacker) => { for (const e of this.guards) if (e.alive && e.state === 'ride') e.die(G2, attacker, false); };
      this.guards = [];
      for (let i = 0; i < 4; i++) {
        const e = new FC.Enemy(i === 0 && op.r > 29 ? 'heavy' : 'grunt', p0.x, p0.z, op, scene);
        e.state = 'ride'; e.convoy = this; e.seatIdx = i;
        this.guards.push(e); G.enemies.push(e);
      }
      this.alerted = false;
      G.vehicles.push(this.truck);
    }
    onAlert(G, pos) {
      if (this.alerted) return;
      this.alerted = true;
      const lk = pos || new THREE.Vector3(this.op.x, this.op.y, this.op.z);
      for (const e of this.guards) if (e.alive && e.state === 'ride') {
        const side = e.seatIdx % 2 ? 2 : -2, back = e.seatIdx > 1 ? 2.2 : 0.4;
        e.pos.copy(this.truck.pos).add(new THREE.Vector3(side, 0, back).applyEuler(new THREE.Euler(0, this.truck.yaw, 0)));
        e.pos.y = FC.World.heightAt(e.pos.x, e.pos.z);
        e.state = 'patrol'; e.setAlert(G, lk);
      }
    }
    drive() {
      if (this.alerted || this.truck.dead) return { throttle: 0, steer: 0, brake: true };
      const t = this.truck;
      if (this.k >= this.pts.length) { this.onAlert(G(), null); return { throttle: 0, steer: 0, brake: true }; }
      let tgt = this.pts[this.k];
      if (Math.hypot(tgt.x - t.pos.x, tgt.z - t.pos.z) < 6) { this.k++; if (this.k >= this.pts.length || Math.hypot(this.op.x - t.pos.x, this.op.z - t.pos.z) < this.op.r) { this.onAlert(G(), null); return { throttle: 0, steer: 0, brake: true }; } tgt = this.pts[this.k]; }
      const d = FC.wrapAngle(FC.yawTo(tgt.x - t.pos.x, tgt.z - t.pos.z) - t.yaw);
      return { throttle: Math.abs(d) > 1.2 ? 0.4 : 0.8, steer: FC.clamp(d * 2.2, -1, 1), brake: false };
    }
    update(dt, Gm) {
      if (this.alerted || this.truck.dead) return;
      for (const e of this.guards) {
        if (!e.alive || e.state !== 'ride') continue;
        const off = new THREE.Vector3(e.seatIdx % 2 ? 0.55 : -0.55, 1.2, e.seatIdx > 1 ? 2.1 : 1.0).applyEuler(new THREE.Euler(this.truck.pitch, this.truck.yaw, this.truck.roll, 'YXZ'));
        e.pos.copy(this.truck.pos).add(off);
        e.yaw = this.truck.yaw;
        for (const p of Gm.players) if (p.alive && e.sees[p.index] && e.detect[p.index] > 0.5) { this.onAlert(Gm, p.pos); return; }
      }
    }
  }
  function reinforce(Gm, op) {
    const roads = FC.World.roads.filter((r) => (r.a === op || r.b === op) && r.len > 120);
    if (!roads.length) return false;
    const road = FC.pick(roads);
    X.trucks.push(new ReinforceTruck(Gm, op, road));
    if (op.boss || Math.random() < 0.35) X.trucks.push(new ReinforceTruck(Gm, op, FC.pick(roads)));
    Gm.announce(`Tide trucks are racing to ${op.name}!`, '#ff9f43', 4);
    return true;
  }

  // ================================================================ companion
  const FANG_TINT = { Main: 0xb39a76, Main_Light: 0xe8dcc4 };
  class Companion {
    constructor(owner) {
      this.owner = owner; this.isAlly = true; this.isCompanion = true;
      this.name = owner.index === 0 ? 'Fang' : 'Ash';
      const p = owner.pos;
      this.pos = new THREE.Vector3(p.x + 2, p.y, p.z + 2);
      this.yaw = owner.yaw; this.hp = 220; this.alive = true; this.down = 0;
      this.eyeH = 0.8; this.crouch = false; this.inBush = false; this.vehicle = null;
      this.target = null; this.biteT = 0; this.speedNow = 0;
      this.rig = new FC.Rig('wolf', { height: 1.05, tint: owner.index === 0 ? FANG_TINT : { Main: 0x3a3a3a, Main_Light: 0x6a6a6a } });
      scene.add(this.rig.root);
      this.rig.play('Idle');
    }
    get speed() { return this.speedNow; }
    has() { return false; }
    damage(amount) {
      if (!this.alive) return;
      this.hp -= amount;
      if (this.hp <= 0) { this.alive = false; this.down = 30; this.rig.play('Death', { once: true, fade: 0.1 }); this.owner.msg(`${this.name} is hurt — back in 30s`, '#ff8a80', 3); }
    }
    command(e) { if (!this.alive) return; this.target = e; FC.Audio.growl(1, this.pos); this.owner.msg(`${this.name}, get 'em!`, '#d8c8a0', 1.5); }
    update(dt, Gm) {
      const r = this.rig, o = this.owner;
      if (!this.alive) {
        this.down -= dt;
        if (this.down <= 0) { this.alive = true; this.hp = 220; this.pos.copy(o.pos).add(new THREE.Vector3(3, 0, 3)); r.play('Idle', { fade: 0.4 }); }
        r.update(dt, 0); return;
      }
      if (this.hp < 220) this.hp = Math.min(220, this.hp + 4 * dt);
      // auto-target: militia shooting at the owner nearby
      if (!this.target || !this.target.alive) {
        this.target = null;
        for (const e of Gm.enemies) {
          if (!e.alive || e.dormant || e.state === 'ride' || e.onTower) continue;
          if (e.alerted && e.pos.distanceTo(o.pos) < 30) { this.target = e; break; }
        }
      }
      let tx, tz, speed = 0;
      if (this.target) {
        const e = this.target;
        tx = e.pos.x; tz = e.pos.z; speed = 11;
        this.biteT -= dt;
        if (e.pos.distanceTo(this.pos) < 1.7 && this.biteT <= 0) {
          this.biteT = 1.1; this.attackT = 0.5;
          const silent = !e.alerted && e.type !== 'heavy' && e.type !== 'boss';
          e.damage(Gm, silent ? 999 : 55, null, false);
          if (!e.alive) { FC.Progression.xp(o, 15, `${this.name} kill`, Gm); o.stats.kills++; this.target = null; }
          FC.FX.impact(e.pos.x, e.pos.y + 1, e.pos.z, 'blood');
          FC.Audio.growl(0.8, this.pos);
        }
      } else {
        const d = Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
        if (d > 90 || o.vehicle || o.zip) { // keep up with fast travel / vehicles
          if (d > 90) this.pos.set(o.pos.x + 3, o.pos.y, o.pos.z + 3);
        }
        if (d > 4) { tx = o.pos.x + Math.sin(o.yaw) * 2; tz = o.pos.z + Math.cos(o.yaw) * 2; speed = d > 12 ? 10 : d > 6 ? 5.5 : 2.2; }
      }
      if (speed > 0) {
        const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
        if (d > 0.5) {
          const nx = this.pos.x + (dx / d) * speed * dt, nz = this.pos.z + (dz / d) * speed * dt;
          if (FC.World.heightAt(nx, nz) > -0.8) { this.pos.x = nx; this.pos.z = nz; }
          FC.World.collide(this.pos, 0.45, this.pos.y, 1);
          this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 7);
        } else speed = 0;
      }
      this.speedNow = speed;
      this.pos.y = Math.max(FC.World.heightAt(this.pos.x, this.pos.z), -0.6);
      r.root.position.copy(this.pos); r.root.rotation.set(0, this.yaw, 0);
      this.attackT = Math.max(0, (this.attackT || 0) - dt);
      if (this.attackT > 0) r.play('Attack', { fade: 0.08 });
      else if (speed < 0.2) r.play(o.crouch ? 'Idle_2_HeadLow' : 'Idle');
      else if (speed < 3) r.play('Walk', { speed: speed / 1.4 });
      else r.play('Gallop', { speed: speed / 8 });
      r.update(dt, 0);
    }
  }
  function giveCompanion(p) {
    if (p.companion) return;
    p.companion = new Companion(p);
    X.companions.push(p.companion);
    p.prog.companion = true;
    p.msg(`${p.companion.name} the wolf runs with you now. Tag an enemy to send ${p.companion.name} after them.`, '#d8c8a0', 6);
  }

  // ================================================================ set-pieces
  function setupStory(Gm) {
    const W = FC.World;
    // the alpha wolf of Cloudrest
    const cr = W.villages[2];
    const pt = W.landPoint(cr.x, cr.z, 60, 90);
    const alpha = new FC.Animal('wolf', pt.x, pt.z, scene);
    scene.remove(alpha.rig.root);
    alpha.rig = new FC.Rig('wolf', { height: 1.55, tint: { Main: 0x1c1c1c, Main_Light: 0x4a3a3a } });
    scene.add(alpha.rig.root);
    alpha.hp = 380; alpha.alpha = true; alpha.radius = 0.7;
    alpha.home = { x: pt.x, z: pt.z };
    Gm.animals.push(alpha);
    X.alpha = alpha;
    // prisoners at Sulfur Springs
    const ss = W.outposts[6];
    const pen = { x: ss.x + 6, z: ss.z - 6, wander: [] };
    pen.wander.push({ x: pen.x, z: pen.z });
    for (let i = 0; i < 3; i++) {
      const c = new FC.Civilian(pen, scene);
      c.pos.set(pen.x + (i - 1) * 1.6, W.heightAt(pen.x, pen.z), pen.z);
      c.state = 'captive'; c.captive = true; c.yaw = 0;
      Gm.civilians.push(c); X.prisoners.push(c);
    }
    // fence pen
    for (const [dx, dz, ry] of [[-3, 0, Math.PI / 2], [3, 0, Math.PI / 2], [0, -2.5, 0]]) {
      const f = FC.Assets.propMesh('fence', { length: 3.2 }); f.position.set(pen.x + dx, W.heightAt(pen.x + dx, pen.z + dz), pen.z + dz); f.rotation.y = ry; scene.add(f);
    }
    // fuel depot at Black Pier
    const bp = W.outposts[7];
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xc7c2b8, roughness: 0.5, metalness: 0.4, map: FC.Assets.tex.metal });
    for (let i = 0; i < 2; i++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5, 16), tankMat);
      const x = bp.x - 12 + i * 5.5, z = bp.z + 12;
      tank.position.set(x, bp.y + 2.5, z); tank.castShadow = true; tank.receiveShadow = true; scene.add(tank);
      X.depot.push({ tank, x, z, alive: true });
    }
    for (let i = 0; i < 8; i++) {
      const x = bp.x - 15 + (i % 4) * 2.4, z = bp.z + 16 + Math.floor(i / 4) * 1.6;
      const mesh = FC.Assets.propMesh('barrel', { height: 1.15, materials: W.barrelMat });
      mesh.position.set(x, bp.y, z); scene.add(mesh);
      const b = { x, y: bp.y, z, hp: 25, exploded: false, mesh, depot: true };
      W.barrels.push(b);
    }
  }
  function updateStory(dt, Gm) {
    // prisoners stay put until freed
    for (const c of X.prisoners) if (c.alive && c.captive) { c.rig.play('Man_Sitting'); c.state = 'captive'; }
    if (!Gm.flags.prisoners && X.prisoners.length && X.prisoners.every((c) => !c.captive || !c.alive)) Gm.flags.prisoners = true;
    // fuel tanks go up when the barrels around them do
    for (const t of X.depot) {
      if (!t.alive) continue;
      const near = FC.World.barrels.filter((b) => b.depot && Math.hypot(b.x - t.x, b.z - t.z) < 10);
      if (near.some((b) => b.exploded) && Math.random() < dt * 2) {
        t.alive = false; t.tank.visible = false;
        Gm.explosion(t.x, t.tank.position.y, t.z, 16, 260, Gm.players[0]);
        for (let k = 0; k < 6; k++) setTimeout(() => FC.FX.explosion(t.x + FC.rand(-6, 6), t.tank.position.y + FC.rand(0, 6), t.z + FC.rand(-6, 6)), 120 * k);
        slowmo(Gm, 1.8);
      }
    }
    if (!Gm.flags.depot && X.depot.length && X.depot.every((t) => !t.alive)) { Gm.flags.depot = true; Gm.announce('The Black Pier fuel depot is burning!', '#ffd166', 5); }
    if (!Gm.flags.alpha && X.alpha && !X.alpha.alive) {
      Gm.flags.alpha = true;
      Gm.announce('The alpha is dead. Cloudrest is safe.', '#ffd166', 4);
      FC.Missions.say('Ama Reyes', 'Cloudrest found a wolf pup in the alpha\'s den. Raised right, it\'ll fight for you.');
      for (const p of Gm.players) giveCompanion(p);
    }
    // Vael's last stand
    const roost = FC.World.outposts[9];
    if (!Gm.flags.vaelTaunt && Gm.players.some((p) => Math.hypot(p.pos.x - roost.x, p.pos.z - roost.z) < 170)) {
      Gm.flags.vaelTaunt = true;
      FC.Missions.say('Commander Vael', 'I can see you, little rebels. This island was mine before you were born.');
      FC.Missions.say('Commander Vael', 'Every gun in the Roost is pointed at that road. Come and die.');
      reinforce(Gm, roost);
      setTimeout(() => callGunship(Gm, roost, true), 20000);
    }
    if (Gm.boss && !Gm.boss.alive && !Gm.flags.vaelDead) {
      Gm.flags.vaelDead = true;
      slowmo(Gm, 3);
      const op = roost;
      for (let k = 0; k < 5; k++) setTimeout(() => Gm.explosion(op.x + FC.rand(-25, 25), op.y, op.z + FC.rand(-25, 15), 9, 120, Gm.players[0]), 600 + k * 450);
    }
  }
  function slowmo(Gm, secs) { Gm.slowT = Math.max(Gm.slowT || 0, secs); }

  // ================================================================ interactions (called from Player.updateInteract)
  function interact(p, c, Gm) {
    const L = p.ctrl.labels;
    for (const z of X.ziplines) {
      if (Math.hypot(z.A.x - p.pos.x, z.A.z - p.pos.z) < 2.6 && Math.abs(z.A.y - 2.05 - p.pos.y) < 2.2) {
        p.prompt = `[${L.interact}] Ride zipline to ${z.to.name || 'the valley'}`;
        if (c.pressed.interact) startZip(p, z);
        return true;
      }
    }
    for (const pr of X.prisoners) {
      if (pr.alive && pr.captive && pr.pos.distanceTo(p.pos) < 2.2) {
        p.prompt = `[${L.interact}] Free prisoner`;
        if (c.pressed.interact) {
          pr.captive = false; pr.state = 'flee'; pr.stateT = 0;
          const v = FC.World.villages[2];
          pr.village = v; pr.moveTo = { x: v.x, z: v.z };
          FC.Progression.xp(p, 40, 'Prisoner freed', Gm); FC.Audio.pickup();
          Gm.subtitle(pr, 'Thank you! I\'ll get to Cloudrest!');
        }
        return true;
      }
    }
    return false;
  }

  function G() { return FC.G; }
  function placeLandVehicles(Gm) {
    const W = FC.World;
    const flat = (cx, cz, minR, maxR) => {
      for (let t = 0; t < 80; t++) {
        const p = W.landPoint(cx, cz, minR, maxR);
        if (W.slopeAt(p.x, p.z) < 0.15 && W.heightAt(p.x, p.z) > 1.5) return p;
      }
      return null;
    };
    for (const site of [W.start, W.villages[1], W.villages[3]]) {
      const p = flat(site.x, site.z, site.r + 6, site.r + 30);
      if (p) Gm.vehicles.push(new FC.Vehicle('gyro', p.x, p.z, Math.random() * 6, scene));
    }
    for (const site of [W.start].concat(W.villages)) {
      const p = flat(site.x, site.z, 6, site.r + 10);
      if (p) Gm.vehicles.push(new FC.Vehicle('quad', p.x, p.z, Math.random() * 6, scene));
    }
  }
  // ================================================================ coastal dressing
  // CC0 Quaternius Pirate Kit props: wooden piers out to every boat mooring, shipwrecks on the
  // reefs, beached skiffs by the villages, anchors, and shore cannons at the coastal strongholds.
  function prop(key, k, x, y, z, yaw, tilt) {
    if (!FC.Assets.gltf[key]) return null;
    const s = FC.Assets.staticModel(key);
    const m = new THREE.Mesh(s.geometry, s.materials);
    m.scale.setScalar(k); m.position.set(x, y, z); m.rotation.set(tilt ? tilt[0] : 0, yaw, tilt ? tilt[1] : 0);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  function dressCoast() {
    const W = FC.World, rng = FC.mulberry32(4242);
    // piers: tiles from the shoreline out to each boat
    for (const d of X.docks || []) {
      const site = d.site, dx = site.x - d.x, dz = site.z - d.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      let shore = null;
      for (let t = 0; t < L; t += 1) { const x = d.x + ux * t, z = d.z + uz * t; if (W.heightAt(x, z) > -0.2) { shore = t; break; } }
      if (shore === null) continue;
      const yaw = Math.atan2(ux, uz), tile = 2.5;
      for (let t = shore + 1; t > 4; t -= tile) {
        const x = d.x + ux * t, z = d.z + uz * t;
        prop(rng() < 0.15 ? 'dockBroken' : 'dock', 1.0, x, 0.55 - 3, z, yaw);
      }
    }
    // wrecks on shallow reefs
    let wrecks = 0;
    for (let t = 0; t < 4000 && wrecks < 3; t++) {
      const a = rng() * Math.PI * 2, r = 560 + rng() * 180, x = Math.cos(a) * r, z = Math.sin(a) * r, h = W.heightAt(x, z);
      if (h > -1.2 || h < -3.5 || W.isReserved(x, z, 60)) continue;
      const m = prop('shipLarge', 1.5, x, h - 0.6, z, rng() * 6.28, [0.08, 0.32]);
      if (m) { W.addCircle(x, z, 6, 9); wrecks++; }
    }
    // beached skiffs + anchors by the villages
    for (const v of W.villages) {
      for (let t = 0; t < 400; t++) {
        const a = rng() * 6.28, r = 20 + rng() * 120, x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r, h = W.heightAt(x, z);
        if (h < 0.1 || h > 1.2 || W.isReserved(x, z, 8)) continue;
        prop('shipSmall', 0.9, x, h - 0.15, z, rng() * 6.28, [0, 0.35]);
        W.addCircle(x, z, 2.2, 2);
        prop('anchor', 1.4, x + 3, W.heightAt(x + 3, z + 1) + 0.02, z + 1, rng() * 6.28);
        break;
      }
    }
    // shore cannons: Black Pier, Old Cannery, Vael's Roost
    for (const op of [W.outposts[7], W.outposts[3], W.outposts[9]]) {
      for (let i = 0; i < (op === W.outposts[9] ? 4 : 2); i++) {
        for (let t = 0; t < 200; t++) {
          const a = rng() * 6.28, r = op.r * (0.75 + rng() * 0.35), x = op.x + Math.cos(a) * r, z = op.z + Math.sin(a) * r, h = W.heightAt(x, z);
          if (h < 1 || W.pointBlocked(x, z, 1.5)) continue;
          // barrel (-X in the model) points away from the outpost centre
          prop('cannon', 1.3, x, h, z, Math.atan2(z - op.z, -(x - op.x)));
          W.addCircle(x, z, 0.9, 1.1);
          break;
        }
      }
    }
  }

  // ================================================================ Tide gunship (helicopter by Zsky, CC BY)
  // Called in when a big outpost raises the alarm: flies in, circles the nearest player with a door
  // gunner, and can be shot down. One at a time, with a cooldown.
  X.gunship = null; X.gunshipCD = 0;
  function callGunship(Gm, op, force) {
    if (!FC.Assets.gltf.helicopter || (X.gunship && !X.gunship.dead) || (!force && X.gunshipCD > 0) || !Gm.players.length) return false;
    X.gunshipCD = 240;
    const a = Math.random() * Math.PI * 2, sx = op.x + Math.cos(a) * 520, sz = op.z + Math.sin(a) * 520;
    const v = new FC.Vehicle('gyro', sx, sz, 0, scene);
    v.group.remove(v.mesh); for (const l of v.lights) v.group.remove(l);
    const body = FC.Assets.orientedProp('helicopter', { len: 13, faceFix: Math.PI });
    const blades = new THREE.Group(); blades.position.set(0, body.userData.size.h * 0.95, 0.4);
    const bm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 12), bm); b.rotation.y = r; blades.add(b); }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; blades.add(disc);
    body.add(blades);
    v.mesh = body; v.group.add(body);
    v.len = 9; v.wid = 3; v.hp = v.maxHp = 950; v.patrol = true; v.gunship = true;
    v.pos.y = FC.World.heightAt(sx, sz) + 60; v.op = op; v.life = 150; v.burstT = 2; v.shotT = 0; v.orbitA = a;
    v.onDestroyed = (G2, attacker) => {
      G2.announce('Gunship down!', '#ffd166', 4);
      for (const p of G2.players) { FC.Progression.xp(p, 250, 'Gunship', G2); FC.Progression.cash(p, 200, 'Salvage', G2); }
    };
    v.custom = (dt, G2) => {
      blades.rotation.y += dt * 38;
      v.life -= dt;
      // target: nearest living player on foot or in a vehicle
      let tgt = null, bd = 1e9;
      for (const p of G2.players) { if (!p.alive) continue; const d = Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z); if (d < bd) { bd = d; tgt = p; } }
      const leaving = v.life <= 0 || !tgt || op.liberated && bd > 300;
      let gx, gz;
      if (leaving) { gx = v.pos.x + (v.pos.x - (tgt ? tgt.pos.x : op.x)); gz = v.pos.z + (v.pos.z - (tgt ? tgt.pos.z : op.z)); }
      else if (bd > 140) { gx = tgt.pos.x; gz = tgt.pos.z; }
      else { v.orbitA += dt * 0.22; gx = tgt.pos.x + Math.cos(v.orbitA) * 55; gz = tgt.pos.z + Math.sin(v.orbitA) * 55; }
      const dx = gx - v.pos.x, dz = gz - v.pos.z, dd = Math.hypot(dx, dz);
      const want = Math.min(32, dd * 0.4 + 6);
      v.speed += (want - v.speed) * Math.min(1, dt * 0.8);
      const head = FC.yawTo(dx, dz);
      v.yaw = FC.turnTowards(v.yaw, tgt && !leaving && bd < 140 ? FC.yawTo(tgt.pos.x - v.pos.x, tgt.pos.z - v.pos.z) + 1.2 : head, dt * 1.2);
      if (dd > 1) { v.pos.x += (dx / dd) * v.speed * dt; v.pos.z += (dz / dd) * v.speed * dt; }
      const gy = Math.max(0, FC.World.heightAt(v.pos.x, v.pos.z), FC.World.heightAt(v.pos.x + dx / Math.max(dd, 1) * 40, v.pos.z + dz / Math.max(dd, 1) * 40));
      v.pos.y += ((gy + (leaving ? 70 : 30)) - v.pos.y) * Math.min(1, dt * 0.7);
      v.pitch = FC.clamp(v.speed / 32, 0, 1) * 0.18; v.roll = Math.sin(v.orbitA * 3) * 0.06;
      v.group.position.copy(v.pos); v.group.rotation.set(v.pitch, v.yaw, v.roll, 'YXZ');
      if (leaving && bd > 600) { v.dead = true; scene.remove(v.group); const i = G2.vehicles.indexOf(v); if (i >= 0) G2.vehicles.splice(i, 1); X.gunship = null; return; }
      // door gunner: bursts at the target while it is in sight
      if (tgt && !leaving && bd < 160) {
        v.burstT -= dt;
        const eye = new THREE.Vector3(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z), muzzle = new THREE.Vector3(v.pos.x, v.pos.y - 0.5, v.pos.z);
        const sees = FC.World.los(muzzle.x, muzzle.y, muzzle.z, eye.x, eye.y, eye.z);
        if (v.burstT <= 0 && sees) {
          v.shotT -= dt;
          if (v.shotT <= 0) {
            v.shotT = 0.11;
            const miss = FC.clamp(bd / 60, 0.6, 3) * (tgt.vehicle ? 0.7 : 1) * (tgt.crouch ? 1.4 : 1);
            const hitPt = eye.clone().add(new THREE.Vector3(FC.rand(-1, 1) * miss, FC.rand(-0.6, 0.6) * miss, FC.rand(-1, 1) * miss));
            FC.FX.tracer(muzzle, hitPt);
            FC.Audio.shot('rifle', 0.9 * G2.volumeAt(v.pos, 400), v.pos);
            if (hitPt.distanceTo(eye) < 0.9) tgt.damage(9 * G2.enemyDmgMul, v.pos.x, v.pos.z, G2);
            else FC.FX.impact(hitPt.x, FC.World.heightAt(hitPt.x, hitPt.z) + 0.05, hitPt.z, 'dust');
            v.burstN = (v.burstN || 0) + 1;
            if (v.burstN > 14) { v.burstN = 0; v.burstT = FC.rand(1.8, 3.2); }
          }
        }
      }
    };
    X.gunship = v; Gm.vehicles.push(v);
    Gm.announce('Tide gunship inbound — take cover or shoot it down!', '#ff6b6b', 5);
    FC.Missions && FC.Missions.say && FC.Missions.say('Ama Reyes', 'Gunship! Get under cover or hit it with everything you have.');
    return true;
  }

  // ================================================================ parrots (Poly by Google, CC BY)
  X.flocks = [];
  function spawnParrots() {
    if (!FC.Assets.gltf.parrot) return;
    const W = FC.World, rng = FC.mulberry32(777);
    for (let f = 0; f < 9; f++) {
      for (let t = 0; t < 200; t++) {
        const x = (rng() * 2 - 1) * 620, z = (rng() * 2 - 1) * 620, h = W.heightAt(x, z);
        if (h < 4 || h > 70) continue;
        const fl = { x, z, birds: [], r: 14 + rng() * 14, h: h + 14 + rng() * 12, scared: 0 };
        for (let i = 0; i < 5; i++) {
          const b = FC.Assets.orientedProp('parrot', { len: 0.55, faceFix: Math.PI });
          b.userData.ph = rng() * 6.28; b.userData.off = rng() * 6.28; b.userData.sp = 0.5 + rng() * 0.3;
          scene.add(b); fl.birds.push(b);
        }
        X.flocks.push(fl);
        break;
      }
    }
  }
  function updateParrots(dt, Gm) {
    const T = Gm.time;
    for (const fl of X.flocks) {
      const near = Gm.nearestPlayerDist(new THREE.Vector3(fl.x, fl.h, fl.z));
      const show = near < 280;
      fl.scared = Math.max(0, fl.scared - dt);
      if (show && Gm.combatT > 7.9 && near < 120) fl.scared = 8;
      for (const b of fl.birds) {
        b.visible = show; if (!show) continue;
        const u = b.userData, sp = u.sp * (fl.scared > 0 ? 2.4 : 1);
        u.ph += dt * sp * (fl.scared > 0 ? 1 : 0.6);
        const r = fl.r * (fl.scared > 0 ? 2.2 : 1) + Math.sin(u.ph * 1.7 + u.off) * 3;
        const a = u.ph + u.off;
        const x = fl.x + Math.cos(a) * r, z = fl.z + Math.sin(a) * r, y = fl.h + (fl.scared > 0 ? 12 : 0) + Math.sin(u.ph * 2.3 + u.off) * 2;
        b.rotation.set(Math.sin(T * 14 + u.off) * 0.15, FC.yawTo(-Math.sin(a), Math.cos(a)), Math.cos(T * 18 + u.off) * 0.35);
        b.position.set(x, y, z);
      }
    }
  }

  // ================================================================ radio masts at the outposts (Poly by Google, CC BY)
  function placeMasts() {
    if (!FC.Assets.gltf.radioTower) return;
    const W = FC.World;
    for (const op of W.outposts) {
      for (let t = 0; t < 60; t++) {
        const a = Math.random() * 6.28, r = op.r * (0.55 + Math.random() * 0.4), x = op.x + Math.cos(a) * r, z = op.z + Math.sin(a) * r;
        if (W.pointBlocked(x, z, 2.5) || W.slopeAt(x, z) > 0.4) continue;
        const m = FC.Assets.orientedProp('radioTower', { h: op.boss ? 22 : 15 });
        m.position.set(x, W.heightAt(x, z) - 0.1, z); m.rotation.y = Math.random() * 6.28; scene.add(m);
        W.addCircle(x, z, 1.4, op.boss ? 22 : 15);
        break;
      }
    }
  }
  function init(sc, Gm) {
    scene = sc; X.scene = sc;
    buildZiplines();
    placeBoats(Gm);
    dressCoast();
    spawnParrots();
    placeMasts();
    placeLandVehicles(Gm);
    setupStory(Gm);
  }
  function update(dt, Gm) {
    updatePatrolBoat();
    X.gunshipCD = Math.max(0, X.gunshipCD - dt);
    updateParrots(dt, Gm);
    for (const t of X.trucks) t.update(dt, Gm);
    for (const c of X.companions) c.update(dt, Gm);
    updateStory(dt, Gm);
  }
  return Object.assign(X, { init, update, interact, rideZip, reinforce, giveCompanion, Companion, callGunship });
})();
