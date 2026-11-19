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
      b.home = s; G.vehicles.push(b); X.docks.push(s);
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
  function init(sc, Gm) {
    scene = sc;
    buildZiplines();
    placeBoats(Gm);
    placeLandVehicles(Gm);
    setupStory(Gm);
  }
  function update(dt, Gm) {
    updatePatrolBoat();
    for (const t of X.trucks) t.update(dt, Gm);
    for (const c of X.companions) c.update(dt, Gm);
    updateStory(dt, Gm);
  }
  return Object.assign(X, { init, update, interact, rideZip, reinforce, giveCompanion, Companion });
})();
