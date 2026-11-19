'use strict';
// Drivable jeeps (driver + passenger who can shoot) and Ashen Tide supply convoys that follow the roads.
FC.Vehicle = class {
  constructor(kind, x, z, yaw, scene) {
    this.kind = kind; // 'jeep' | 'truck' | 'boat'
    this.boat = kind === 'boat' || kind === 'tideboat';
    this.pos = new THREE.Vector3(x, this.boat ? 0 : FC.World.heightAt(x, z) + 0.2, z);
    this.yaw = yaw || 0; this.pitch = 0; this.roll = 0;
    this.speed = 0; this.vy = 0; this.steer = 0;
    this.hp = kind === 'truck' ? 700 : this.boat ? 380 : 450; this.maxHp = this.hp; this.dead = false;
    this.seats = [null, null];
    this.len = kind === 'truck' ? 6.2 : this.boat ? 5.2 : 4.4; this.wid = kind === 'truck' ? 2.4 : 2.0;
    this.group = new THREE.Group();
    let mesh;
    if (this.boat) mesh = FC.Vehicle.boatMesh(kind === 'tideboat');
    else {
      mesh = FC.Assets.propMesh(kind === 'truck' ? 'truck' : 'suv', { length: this.len });
      mesh.rotation.y = Math.PI; // model faces +z
      if (kind === 'truck') mesh.material = mesh.material.map((m) => { const c = m.clone(); c.color.multiplyScalar(0.55); c.color.r *= 1.3; return c; });
    }
    this.mesh = mesh;
    this.group.add(mesh);
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff1c2, emissive: 0xfff1c2, emissiveIntensity: 0 });
    this.lights = [];
    for (const sx of [-0.6, 0.6]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lightMat);
      l.position.set(sx * this.wid / 2, 0.85, -this.len / 2 + 0.05);
      this.group.add(l); this.lights.push(l);
    }
    this.lightMat = lightMat;
    scene.add(this.group);
    this.smokeT = 0; this.engine = 0;
  }
  get driver() { return this.seats[0]; }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  seatWorld(i) {
    const off = i === 0 ? new THREE.Vector3(-0.42, 1.55, -0.1) : new THREE.Vector3(0.42, 1.55, -0.1);
    return off.applyEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ')).add(this.pos);
  }
  enter(p) {
    if (this.dead) return;
    const seat = this.seats[0] ? (this.seats[1] ? -1 : 1) : 0;
    if (seat < 0) return;
    this.seats[seat] = p; p.vehicle = this; p.seat = seat;
    p.crouch = false; p.climbing = null; p.vel.set(0, 0, 0);
    if (seat === 1 && p.weapon && FC.WEAPONS[p.weapon].throwable) p.weapon = 'rifle';
    p.msg(seat === 0 ? 'Driving — ' + (p.ctrl.usesMouse ? 'W/S throttle, A/D steer, Space handbrake' : 'move stick to drive, A handbrake') : 'Passenger — you can shoot', '#ddd', 3);
    FC.Audio.click();
  }
  exit(p) {
    const i = this.seats.indexOf(p);
    if (i < 0) return;
    this.seats[i] = null; p.vehicle = null; p.seat = -1;
    const side = new THREE.Vector3(i === 0 ? -1 : 1, 0, 0).applyEuler(new THREE.Euler(0, this.yaw, 0)).multiplyScalar(this.wid / 2 + 0.9);
    p.pos.copy(this.pos).add(side);
    p.pos.y = FC.World.groundAt(p.pos.x, p.pos.z, this.pos.y + 1, 0.4);
    if (FC.World.pointBlocked(p.pos.x, p.pos.z, 0.4)) p.pos.addScaledVector(this.forward(), -this.len * 0.7);
    p.vel.set(0, 0, 0);
  }
  // Driver input (called from Player.update)
  control(p, c, dt) {
    if (p.seat !== 0) { this.passengerLook(p, c); return; }
    this.throttle = c.my; this.steerIn = -c.mx; this.brake = !!c.jump; this.boost = !!c.sprint;
    // driver freely looks around (camera orbit)
    p.camYaw = (p.camYaw || 0) - c.lx * 0.8;
    p.camPitch = FC.clamp((p.camPitch || -0.18) - c.ly * 0.6, -0.8, 0.4);
    if (Math.abs(c.lx) < 1e-4) p.camYaw *= Math.max(0, 1 - dt * 1.5);
    if (c.pressed.tag) FC.Audio.horn();
  }
  passengerLook() { /* player's own yaw/pitch drive the camera; handled in Player */ }
  driverCamera(p, dt) {
    const yaw = this.yaw + (p.camYaw || 0), pitch = p.camPitch || -0.18;
    const dist = this.kind === 'truck' ? 11 : 8.5;
    const back = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    const target = this.pos.clone().add(new THREE.Vector3(0, 1.8, 0));
    const want = target.clone().add(back);
    want.y = Math.max(want.y, FC.World.heightAt(want.x, want.z) + 1);
    p.cam.position.lerp(want, Math.min(1, dt * 8));
    if (p.cam.position.distanceTo(want) > 20) p.cam.position.copy(want);
    p.cam.lookAt(target);
    p.yaw = this.yaw; p.pitch = 0;
    p.setFov(95 + Math.min(15, Math.abs(this.speed) * 0.5));
    for (const k in p.vm) p.vm[k].visible = false;
  }
  damage(G, amount, attacker) {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) this.explode(G, attacker);
  }
  explode(G, attacker) {
    this.dead = true; this.hp = 0;
    for (const p of this.seats.slice()) if (p) { this.exit(p); p.damage(60, this.pos.x, this.pos.z, G, 'explosion'); }
    G.explosion(this.pos.x, this.pos.y + 0.5, this.pos.z, 8, 180, attacker);
    const burnt = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 });
    this.mesh.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(() => burnt) : burnt; });
    if (this.boat) this.sinking = true;
    this.speed = 0;
    if (this.onDestroyed) this.onDestroyed(G, attacker);
  }
  update(dt, G) {
    if (this.dead) {
      this.smokeT -= dt;
      if (this.smokeT <= 0 && this.deadT === undefined) this.deadT = 0;
      this.deadT += dt;
      if (this.boat) { this.pos.y = Math.max(-3, this.pos.y - dt * 0.35); this.group.position.copy(this.pos); this.group.rotation.x += dt * 0.05; }
      if (this.deadT < 25 && Math.random() < dt * 6) FC.FX.smoke(this.pos.x, this.pos.y + 1.5, this.pos.z, 1.4);
      if (this.deadT < 10 && Math.random() < dt * 20) FC.FX.fire(this.pos.x, this.pos.y + 1, this.pos.z, 0.7);
      return;
    }
    const W = FC.World;
    const driver = this.seats[0];
    let throttle = 0, steerIn = 0, brake = false, boost = false;
    if (driver) { throttle = this.throttle || 0; steerIn = this.steerIn || 0; brake = this.brake; boost = this.boost; }
    else if (this.ai) { const a = this.ai(dt, G); throttle = a.throttle; steerIn = a.steer; brake = a.brake; }
    if (this.boat) { this.updateBoat(dt, G, driver, throttle, steerIn, brake, boost); return; }
    const ground = W.heightAt(this.pos.x, this.pos.z);
    const inWater = ground < -0.8;
    const offroad = W.roadAt(this.pos.x, this.pos.z) < 0.3;
    const maxF = (this.kind === 'truck' ? 20 : 30) * (boost ? 1.15 : 1) * (offroad ? 0.8 : 1) * (inWater ? 0.25 : 1);
    const accel = this.kind === 'truck' ? 9 : 14;
    if (throttle > 0.05) this.speed += throttle * accel * dt * (this.speed < 0 ? 2.5 : 1);
    else if (throttle < -0.05) this.speed += throttle * accel * dt * (this.speed > 0 ? 2.5 : 0.6);
    else this.speed *= Math.max(0, 1 - dt * 0.8);
    if (brake) this.speed *= Math.max(0, 1 - dt * 3);
    this.speed = FC.clamp(this.speed, -9, maxF);
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 6);
    if (driver && Math.abs(this.steer) > 0.7 && Math.abs(this.speed) > 16) FC.Audio.screech(0.35);
    const turn = this.steer * FC.clamp(Math.abs(this.speed) / 6, 0, 1) * (this.kind === 'truck' ? 0.8 : 1.25) * (brake ? 1.5 : 1);
    this.yaw += turn * dt * Math.sign(this.speed || 1);
    const f = this.forward();
    const prev = this.pos.clone();
    this.pos.addScaledVector(f, this.speed * dt);
    // collisions: obstacles stop the vehicle and damage it
    const hit = W.collide(this.pos, this.wid * 0.55, this.pos.y, 1.6);
    if (hit || this.pos.distanceTo(prev) < Math.abs(this.speed * dt) * 0.5) {
      if (Math.abs(this.speed) > 9) { this.damage(G, Math.abs(this.speed) * 3, null); FC.Audio.crash(G.volumeAt(this.pos, 80)); for (const p of this.seats) if (p) p.shake = 0.5; }
      this.speed *= -0.25;
    }
    // ground following with pitch/roll from 4 samples
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), hl = this.len * 0.42, hw = this.wid * 0.45;
    const sample = (fx, sx) => { const x = this.pos.x - s * fx + c * sx, z = this.pos.z - c * fx - s * sx; return Math.max(W.heightAt(x, z), -1.2); };
    const fl = sample(hl, -hw), fr = sample(hl, hw), bl = sample(-hl, -hw), br = sample(-hl, hw);
    const gy = (fl + fr + bl + br) / 4;
    const tp = Math.atan2(((fl + fr) - (bl + br)) / 2, hl * 2), tr = Math.atan2(((fr + br) - (fl + bl)) / 2, hw * 2);
    if (this.pos.y > gy + 0.3) { this.vy -= 20 * dt; this.pos.y += this.vy * dt; }
    if (this.pos.y <= gy + 0.05) { this.pos.y = gy; this.vy = 0; this.pitch += (tp - this.pitch) * Math.min(1, dt * 10); this.roll += (-tr - this.roll) * Math.min(1, dt * 10); }
    else if (this.vy === 0 && this.pos.y - gy < 0.6) this.pos.y = gy;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 760) { this.pos.x *= 760 / r; this.pos.z *= 760 / r; this.speed = 0; }
    // run-overs
    if (Math.abs(this.speed) > 6) {
      const victims = G.enemies.concat(G.animals, G.civilians);
      for (const e of victims) {
        if (!e.alive || e.state === 'ride') continue;
        if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < this.wid * 0.7 + 0.4) {
          e.damage(G, 400, driver || null, false);
          FC.FX.impact(e.pos.x, e.pos.y + 1, e.pos.z, 'blood');
          this.speed *= 0.85;
        }
      }
    }
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.lightMat.emissiveIntensity = FC.Env.night > 0.5 ? 4 : 0;
    if (this.hp < this.maxHp * 0.35 && Math.random() < dt * 8) FC.FX.smoke(this.pos.x, this.pos.y + 1.4, this.pos.z, 0.8);
    this.engine = Math.abs(this.speed);
  }

  // Speedboat: rides the water surface, beaches in the shallows, banks into turns and throws spray.
  updateBoat(dt, G, driver, throttle, steerIn, brake, boost) {
    const W = FC.World;
    const maxF = 26 * (boost ? 1.2 : 1);
    if (throttle > 0.05) this.speed += throttle * 11 * dt * (this.speed < 0 ? 2.5 : 1);
    else if (throttle < -0.05) this.speed += throttle * 11 * dt * (this.speed > 0 ? 2 : 0.5);
    else this.speed *= Math.max(0, 1 - dt * 0.5);
    if (brake) this.speed *= Math.max(0, 1 - dt * 2);
    this.speed = FC.clamp(this.speed, -6, maxF);
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 4);
    this.yaw += this.steer * FC.clamp(Math.abs(this.speed) / 5, 0, 1) * 0.9 * dt * Math.sign(this.speed || 1);
    const f = this.forward();
    const nx = this.pos.x + f.x * this.speed * dt, nz = this.pos.z + f.z * this.speed * dt;
    const bowX = nx + f.x * this.len * 0.5, bowZ = nz + f.z * this.len * 0.5;
    if (W.heightAt(bowX, bowZ) > -0.55) {               // run aground
      if (Math.abs(this.speed) > 10) { this.damage(G, Math.abs(this.speed) * 2, null); FC.Audio.crash(G.volumeAt(this.pos, 80) * 0.6); }
      this.speed *= -0.2;
    } else { this.pos.x = nx; this.pos.z = nz; }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 790) { this.pos.x *= 790 / r; this.pos.z *= 790 / r; this.speed *= 0.5; }
    const t = (FC.Env.time || 0) + this.pos.x * 0.05;
    const swell = Math.sin(this.pos.x * 0.03 + G.time * 0.8) * 0.18 + Math.sin(this.pos.z * 0.045 - G.time * 1.1) * 0.14;
    const target = this.sinking ? Math.max(-2.5, this.pos.y - dt * 0.4) : swell + 0.05;
    this.pos.y += (target - this.pos.y) * Math.min(1, dt * 6);
    this.pitch += ((-Math.min(0.14, Math.abs(this.speed) * 0.006) + Math.sin(G.time * 1.7 + t) * 0.02) - this.pitch) * Math.min(1, dt * 4);
    this.roll += ((this.steer * Math.min(1, Math.abs(this.speed) / 15) * 0.18 + Math.sin(G.time * 1.3) * 0.02) - this.roll) * Math.min(1, dt * 4);
    if (Math.abs(this.speed) > 4 && G.nearestPlayerDist(this.pos) < 200 && Math.random() < dt * Math.abs(this.speed)) {
      const back = this.pos.clone().addScaledVector(f, -this.len * 0.5);
      FC.FX.splash(back.x + FC.rand(-0.6, 0.6), 0.1, back.z + FC.rand(-0.6, 0.6));
    }
    // swimmers and anything in the way get hit
    if (Math.abs(this.speed) > 6) for (const e of G.enemies) if (e.alive && e.state !== 'ride' && !e.onBoat && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < 1.8) e.damage(G, 400, driver || null, false);
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.lightMat.emissiveIntensity = FC.Env.night > 0.5 ? 4 : 0;
    if (this.hp < this.maxHp * 0.35 && !this.sinking && Math.random() < dt * 8) FC.FX.smoke(this.pos.x, this.pos.y + 1.2, this.pos.z, 0.8);
    this.engine = Math.abs(this.speed);
  }
};

// Procedural speedboat (no boat model in the CC0 packs): hull, bow wedge, windscreen, seats, outboard.
FC.Vehicle.boatMesh = function (tide) {
  const g = new THREE.Group();
  const S = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6 }, o || {}));
  const hullC = tide ? 0x2a2a2e : 0xe8e4da, stripe = tide ? 0x8c1f1f : 0x23b38a;
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
  box(1.9, 0.55, 3.8, 0, 0.25, 0.5, S(hullC));
  box(1.95, 0.12, 3.8, 0, 0.45, 0.5, S(stripe));
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.6, 4, 1), S(hullC));
  bow.rotation.set(-Math.PI / 2, Math.PI / 4, 0); bow.scale.set(1, 1, 0.42); bow.position.set(0, 0.32, -2.1); bow.castShadow = true; g.add(bow);
  box(1.7, 0.08, 3.5, 0, 0.56, 0.5, S(0x8f6f52, { map: FC.Assets.tex.wood }));
  const glass = box(1.6, 0.45, 0.06, 0, 0.85, -0.6, S(0x88aabb, { transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.3 }));
  glass.rotation.x = -0.4;
  box(0.6, 0.35, 0.6, -0.42, 0.75, 0.3, S(0x333333));
  box(0.6, 0.35, 0.6, 0.42, 0.75, 0.3, S(0x333333));
  box(0.5, 0.8, 0.45, 0, 0.7, 2.55, S(0x222222, { metalness: 0.4 }));
  box(0.12, 0.6, 0.12, 0, 0.15, 2.7, S(0x111111));
  return g;
};

// Convoy: an AI truck with guards that drives between Tide-held places along the road network.
FC.Convoy = class {
  constructor(G, road, scene) {
    this.road = road; this.k = 0; this.dir = 1;
    const p0 = road.pts[0], p1 = road.pts[1];
    this.truck = new FC.Vehicle('truck', p0.x, p0.z, FC.yawTo(p1.x - p0.x, p1.z - p0.z), scene);
    this.truck.convoy = this;
    this.truck.ai = (dt) => this.drive(dt);
    this.truck.onDestroyed = (G2, attacker) => G2.onConvoyDestroyed(this, attacker);
    this.guards = [];
    for (let i = 0; i < 2; i++) {
      const e = new FC.Enemy('grunt', p0.x, p0.z, null, scene);
      e.state = 'ride'; e.convoy = this; e.seatIdx = i;
      this.guards.push(e); G.enemies.push(e);
    }
    this.alerted = false; this.done = false;
    G.vehicles.push(this.truck);
  }
  onAlert(G, pos) {
    if (this.alerted) return;
    this.alerted = true;
    for (const e of this.guards) if (e.alive && e.state === 'ride') {
      const off = new THREE.Vector3(e.seatIdx ? 2 : -2, 0, 0).applyEuler(new THREE.Euler(0, this.truck.yaw, 0));
      e.pos.copy(this.truck.pos).add(off);
      e.state = 'patrol'; e.setAlert(G, pos);
    }
  }
  drive() {
    if (this.alerted || this.truck.dead) return { throttle: 0, steer: 0, brake: true };
    const P = this.road.pts;
    let tgt = P[this.k];
    const t = this.truck;
    if (Math.hypot(tgt.x - t.pos.x, tgt.z - t.pos.z) < 6) {
      this.k += this.dir;
      if (this.k >= P.length || this.k < 0) { this.dir *= -1; this.k = FC.clamp(this.k, 0, P.length - 1); }
      tgt = P[this.k];
    }
    const want = FC.yawTo(tgt.x - t.pos.x, tgt.z - t.pos.z);
    const d = FC.wrapAngle(want - t.yaw);
    return { throttle: Math.abs(d) > 1.2 ? 0.3 : 0.55, steer: FC.clamp(d * 2.2, -1, 1), brake: false };
  }
  update(dt, G) {
    if (this.alerted || this.truck.dead) return;
    // guards ride on the flatbed
    for (const e of this.guards) {
      if (!e.alive || e.state !== 'ride') continue;
      const off = new THREE.Vector3(e.seatIdx ? 0.55 : -0.55, 1.2, 1.4).applyEuler(new THREE.Euler(this.truck.pitch, this.truck.yaw, this.truck.roll, 'YXZ'));
      e.pos.copy(this.truck.pos).add(off);
      e.yaw = this.truck.yaw + (e.seatIdx ? -1.4 : 1.4);
      // guards on the truck still watch for rebels
      for (const p of G.players) if (p.alive && e.sees[p.index] && e.detect[p.index] > 0.6) { this.onAlert(G, p.pos); return; }
    }
  }
};
