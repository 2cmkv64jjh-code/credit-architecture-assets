'use strict';
// Ashen Tide militia AI and island wildlife.
FC.ENEMY_TYPES = {
  grunt: { hp: 100, speed: 1.7, run: 4.6, dmg: 7, acc: 0.5, range: 85, burst: [3, 5], rof: 0.13, sound: 'rifle', colors: { shirt: 0x5b4b3a, pants: 0x3a3530, gear: 0x7a1e1e, mask: 0x1a1a1a } },
  heavy: { hp: 260, speed: 1.4, run: 3.6, dmg: 15, acc: 0.45, range: 38, burst: [1, 2], rof: 0.5, sound: 'heavy', armorFront: true, scale: 1.18, colors: { shirt: 0x3d3d3d, pants: 0x2b2b2b, gear: 0x5a1010, mask: 0x111111 } },
  boss: { hp: 750, speed: 1.6, run: 4.2, dmg: 9, acc: 0.6, range: 95, burst: [5, 8], rof: 0.09, sound: 'rifle', armorFront: true, scale: 1.12, colors: { shirt: 0x1c1c22, pants: 0x1c1c22, gear: 0xb08d2e, mask: 0x8b0000 } },
};
const BARKS = {
  suspicious: ['Hm? Who\'s there?', 'Did you hear that?', 'Something moved…', 'Check the treeline.'],
  alert: ['Contact! Rebels!', 'Over there!', 'Open fire!', 'Light them up!'],
  alarm: ['Sound the alarm!', 'Hit the siren!'],
  search: ['Spread out, find them!', 'They\'re close. Keep looking.'],
  calm: ['Must have been a boar.', 'Back to posts.'],
  body: ['Man down! We have a body!', 'Someone killed Rask!'],
};

FC.Enemy = class {
  constructor(type, x, z, outpost, scene) {
    this.type = type;
    this.def = FC.ENEMY_TYPES[type];
    this.hp = this.def.hp; this.maxHp = this.def.hp;
    this.pos = new THREE.Vector3(x, FC.World.heightAt(x, z), z);
    this.yaw = Math.random() * Math.PI * 2;
    this.outpost = outpost;
    this.alive = true; this.deadT = 0;
    this.state = 'patrol'; this.stateT = 0;
    this.detect = [0, 0]; this.los = [false, false]; this.losT = [0, 0];
    this.target = null; this.lastKnown = null; this.lostT = 0;
    this.moveTo = null; this.idleT = FC.rand(0, 3);
    this.burst = 0; this.fireT = 1; this.aimT = 0;
    this.tagged = false; this.burning = 0; this.flash = 0;
    this.pendingAlert = -1; this.pendingPos = null;
    this.walkPhase = Math.random() * 6; this.speedNow = 0;
    this.stuckT = 0; this.lastPos = this.pos.clone(); this.sideT = 0;
    this.barkT = 0; this.corpseSeen = false;
    this.route = null;
    this.model = FC.Models.humanoid(Object.assign({ scale: this.def.scale }, this.def.colors));
    scene.add(this.model.group);
  }

  get headPos() { const s = this.def.scale || 1; return new THREE.Vector3(this.pos.x, this.pos.y + 1.72 * s, this.pos.z); }
  get chest() { const s = this.def.scale || 1; return new THREE.Vector3(this.pos.x, this.pos.y + 1.25 * s, this.pos.z); }
  get alerted() { return this.state === 'alert' || this.state === 'alarm'; }

  bark(G, kind) {
    if (G.time < this.barkT) return;
    this.barkT = G.time + 6;
    G.subtitle(this, FC.pick(BARKS[kind]));
  }

  setAlert(G, pos) {
    if (!this.alive) return;
    this.lastKnown = pos ? pos.clone() : this.lastKnown || this.pos.clone();
    if (this.state !== 'alert' && this.state !== 'alarm') {
      this.state = 'alert'; this.stateT = 0; this.aimT = 0.7; this.lostT = 0;
      this.bark(G, 'alert');
      if (this.outpost) G.alertOutpost(this.outpost, this.lastKnown, this);
    }
  }

  damage(G, amount, attacker, headshot, silent) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash = 0.12;
    if (this.hp <= 0) { this.die(G, attacker, headshot); return; }
    if (attacker) { this.detect[attacker.index] = 1; this.target = attacker; this.setAlert(G, attacker.pos); }
  }

  die(G, attacker, headshot, takedown) {
    this.alive = false; this.deadT = 0; this.hp = 0;
    this.tagged = false; this.burning = 0;
    G.onEnemyKilled(this, attacker, headshot, takedown);
  }

  canSeePlayer(G, p) {
    const d = this.pos.distanceTo(p.pos);
    if (d > 130) return false;
    const eyeH = (this.def.scale || 1) * 1.65;
    return FC.World.los(this.pos.x, this.pos.y + eyeH, this.pos.z, p.pos.x, p.pos.y + p.eyeH * 0.85, p.pos.z);
  }

  perceive(dt, G) {
    for (const p of G.players) {
      const i = p.index;
      if (!p.alive) { this.detect[i] = Math.max(0, this.detect[i] - dt); this.los[i] = false; continue; }
      this.losT[i] -= dt;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (this.losT[i] <= 0) {
        this.losT[i] = FC.rand(0.12, 0.25);
        this.los[i] = d < 130 && this.canSeePlayer(G, p);
      }
      const alerted = this.alerted;
      let vd = (alerted ? 95 : 55) * (p.crouch ? 0.7 : 1) * (p.inBush && p.crouch ? 0.45 : p.inBush ? 0.7 : 1) * (p.sprint ? 1.25 : 1);
      const ang = Math.abs(FC.wrapAngle(FC.yawTo(dx, dz) - this.yaw));
      const fov = alerted ? 1.6 : 1.0;
      const seen = this.los[i] && d < vd && (ang < fov || d < 4.5);
      if (seen) {
        let rate = (0.25 + 2.3 * Math.pow(1 - d / vd, 2)) * (p.crouch ? 0.6 : 1) * (p.inBush && p.crouch ? 0.45 : 1);
        if (this.state === 'search' || this.state === 'suspicious') rate *= 1.8;
        if (d < 6) rate = Math.max(rate, 3);
        this.detect[i] = Math.min(1, this.detect[i] + rate * dt * G.detectMul);
        if (this.detect[i] > 0.3) this.lastKnown = p.pos.clone();
      } else {
        this.detect[i] = Math.max(0, this.detect[i] - (alerted ? 0.05 : 0.25) * dt);
      }
      this.sees = this.sees || [false, false];
      this.sees[i] = seen;
    }
  }

  bestTarget(G) {
    let best = null, bd = 1e9;
    for (const p of G.players) {
      if (!p.alive || !this.sees || !this.sees[p.index]) continue;
      const d = this.pos.distanceTo(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  walk(dt, tx, tz, speed, face) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.4) { this.speedNow = 0; return true; }
    const step = Math.min(d, speed * dt);
    const nx = this.pos.x + (dx / d) * step, nz = this.pos.z + (dz / d) * step;
    if (FC.World.heightAt(nx, nz) < 0.2) { this.speedNow = 0; return true; }
    this.pos.x = nx; this.pos.z = nz;
    FC.World.collide(this.pos, 0.42, this.pos.y, 1.8);
    if (face !== false) this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 6);
    this.speedNow = speed;
    return false;
  }

  update(dt, G) {
    const m = this.model;
    if (!this.alive) {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.55);
      m.group.rotation.set(-Math.PI / 2 * t * t, this.yaw, 0);
      m.group.position.set(this.pos.x, this.pos.y + 0.2 * t, this.pos.z);
      return;
    }
    this.stateT += dt; this.flash = Math.max(0, this.flash - dt);
    this.perceive(dt, G);
    if (this.burning > 0) {
      this.burning -= dt;
      this.damage(G, 22 * dt, null);
      if (!this.alive) return;
      if (!this.panicTo || Math.random() < dt) this.panicTo = { x: this.pos.x + FC.rand(-10, 10), z: this.pos.z + FC.rand(-10, 10) };
      this.walk(dt, this.panicTo.x, this.panicTo.z, this.def.run);
      if (Math.random() < dt * 30) FC.FX.fire(this.pos.x, this.pos.y + 1, this.pos.z, 0.6);
      this.pose(dt); return;
    }
    if (this.pendingAlert > 0) {
      this.pendingAlert -= dt;
      if (this.pendingAlert <= 0) this.setAlert(G, this.pendingPos);
    }
    const maxDetect = Math.max(this.detect[0], this.detect[1]);
    if (maxDetect >= 1 && !this.alerted) {
      const p = G.players[this.detect[0] >= this.detect[1] ? 0 : 1] || G.players[0];
      this.target = p; this.setAlert(G, p.pos);
    }

    switch (this.state) {
      case 'patrol': this.updatePatrol(dt, G, maxDetect); break;
      case 'suspicious': this.updateSuspicious(dt, G, maxDetect); break;
      case 'search': this.updateSearch(dt, G); break;
      case 'alert': this.updateAlert(dt, G); break;
      case 'alarm': this.updateAlarm(dt, G); break;
    }
    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (this.speedNow > 0 && this.pos.distanceTo(this.lastPos) < 0.3) this.sideT = 1.0;
      this.lastPos.copy(this.pos); this.stuckT = 0;
    }
    this.pos.y = FC.World.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.42);
    this.pose(dt);
  }

  pose(dt) {
    const m = this.model;
    this.walkPhase += dt * this.speedNow * 2.2;
    m.group.position.copy(this.pos);
    m.group.rotation.set(0, this.yaw, 0);
    FC.Models.animate(m, this.walkPhase, Math.min(1, this.speedNow / 3), 0);
    const f = this.flash > 0 ? 0.6 : 0;
    m.mats[0].emissive.setRGB(f, f * 0.3, f * 0.3);
  }

  goSidestep(dt) {
    if (this.sideT > 0) {
      this.sideT -= dt;
      if (!this.sidePt) this.sidePt = { x: this.pos.x + FC.rand(-5, 5), z: this.pos.z + FC.rand(-5, 5) };
      this.walk(dt, this.sidePt.x, this.sidePt.z, this.def.run);
      return true;
    }
    this.sidePt = null;
    return false;
  }

  updatePatrol(dt, G, maxDetect) {
    if (maxDetect > 0.3) { this.state = 'suspicious'; this.stateT = 0; this.bark(G, 'suspicious'); return; }
    // corpse discovery
    if (!this.corpseCheckT || G.time > this.corpseCheckT) {
      this.corpseCheckT = G.time + 0.5;
      for (const c of G.enemies) {
        if (c.alive || c.discovered || c.deadT < 1.5) continue;
        const d = this.pos.distanceTo(c.pos);
        const ang = Math.abs(FC.wrapAngle(FC.yawTo(c.pos.x - this.pos.x, c.pos.z - this.pos.z) - this.yaw));
        if (d < 16 && ang < 1.1 && FC.World.los(this.pos.x, this.pos.y + 1.6, this.pos.z, c.pos.x, c.pos.y + 0.4, c.pos.z)) {
          c.discovered = true;
          this.lastKnown = c.pos.clone();
          this.bark(G, 'body');
          if (this.outpost) for (const o of G.enemies) if (o.alive && o.outpost === this.outpost && o.state === 'patrol') { o.state = 'search'; o.stateT = 0; o.lastKnown = c.pos.clone(); }
          this.state = 'search'; this.stateT = 0;
          return;
        }
      }
    }
    if (this.goSidestep(dt)) return;
    if (this.idleT > 0) {
      this.idleT -= dt; this.speedNow = 0;
      this.yaw += Math.sin(G.time * 0.7 + this.walkPhase) * dt * 0.4;
      return;
    }
    if (!this.moveTo) {
      if (this.route) {
        this.routeIdx = (this.routeIdx + 1) % this.route.length;
        this.moveTo = this.route[this.routeIdx];
      } else if (this.outpost) {
        this.moveTo = FC.pick(this.outpost.patrol);
      } else this.moveTo = { x: this.pos.x + FC.rand(-10, 10), z: this.pos.z + FC.rand(-10, 10) };
    }
    if (this.walk(dt, this.moveTo.x, this.moveTo.z, this.def.speed)) {
      this.moveTo = null; this.idleT = this.route ? 0.5 : FC.rand(2, 6);
    }
  }

  updateSuspicious(dt, G, maxDetect) {
    this.speedNow = 0;
    if (this.lastKnown) this.yaw = FC.turnTowards(this.yaw, FC.yawTo(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z), dt * 3);
    if (this.stateT > 1.4 && this.lastKnown) this.walk(dt, this.lastKnown.x, this.lastKnown.z, this.def.speed * 0.9);
    if (maxDetect < 0.05 && this.stateT > 4) { this.state = 'patrol'; this.stateT = 0; this.bark(G, 'calm'); }
  }

  updateSearch(dt, G) {
    if (this.goSidestep(dt)) return;
    if (!this.moveTo || this.walk(dt, this.moveTo.x, this.moveTo.z, this.def.speed * 1.6)) {
      const c = this.lastKnown || this.pos;
      this.moveTo = { x: c.x + FC.rand(-10, 10), z: c.z + FC.rand(-10, 10) };
      if (Math.random() < 0.3) this.bark(G, 'search');
    }
    if (this.stateT > 20) { this.state = 'patrol'; this.stateT = 0; this.moveTo = null; this.bark(G, 'calm'); }
  }

  updateAlarm(dt, G) {
    const op = this.outpost;
    if (!op || !op.alarm || op.alarmSabotaged || op.alarmTriggered) { this.state = 'alert'; this.stateT = 0; return; }
    if (this.goSidestep(dt)) return;
    if (this.walk(dt, op.alarm.x, op.alarm.z + 0.8, this.def.run)) {
      this.speedNow = 0;
      this.alarmT = (this.alarmT || 0) + dt;
      if (this.alarmT > 1.2) { G.triggerAlarm(op); this.state = 'alert'; this.stateT = 0; }
    } else this.alarmT = 0;
  }

  updateAlert(dt, G) {
    const t = this.bestTarget(G);
    const def = this.def;
    if (t) {
      this.target = t; this.lastKnown = t.pos.clone(); this.lostT = 0;
      const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 5);
      // positioning: keep a preferred engagement distance and strafe
      const pref = this.type === 'heavy' ? 10 : 22;
      this.strafeT = (this.strafeT || 0) - dt;
      if (this.strafeT <= 0 || !this.strafePt) {
        this.strafeT = FC.rand(1.5, 3);
        const side = Math.random() < 0.5 ? -1 : 1;
        const along = d > pref + 8 ? 6 : d < pref - 8 ? -5 : 0;
        const px = -dz / d, pz = dx / d;
        this.strafePt = { x: this.pos.x + (dx / d) * along + px * side * 4, z: this.pos.z + (dz / d) * along + pz * side * 4 };
      }
      if (!this.goSidestep(dt)) this.walk(dt, this.strafePt.x, this.strafePt.z, def.run * 0.6, false);
      this.aimT -= dt;
      this.fireT -= dt;
      if (this.aimT <= 0 && this.fireT <= 0 && d < def.range * 1.3) {
        if (this.burst <= 0) this.burst = Math.round(FC.rand(def.burst[0], def.burst[1]));
        this.shoot(G, t, d);
        this.burst--;
        this.fireT = this.burst > 0 ? def.rof : FC.rand(0.9, 1.9);
      }
    } else {
      this.lostT += dt;
      if (this.lastKnown && !this.goSidestep(dt)) this.walk(dt, this.lastKnown.x, this.lastKnown.z, def.run * 0.8);
      if (this.lostT > 9) { this.state = 'search'; this.stateT = 0; this.detect = [0.25, 0.25]; this.bark(G, 'search'); }
    }
  }

  shoot(G, p, d) {
    const def = this.def;
    const muzzle = new THREE.Vector3(); this.model.muzzle.getWorldPosition(muzzle);
    FC.FX.muzzle(muzzle.x, muzzle.y, muzzle.z);
    FC.Audio.shot(def.sound, G.volumeAt(this.pos, 160) * 0.8);
    let chance = def.acc * FC.clamp(1 - d / def.range, 0.08, 1) + 0.06;
    if (p.crouch) chance *= 0.75;
    if (p.speed > 7) chance *= 0.6;
    if (p.inBush) chance *= 0.8;
    chance *= G.enemyAccMul;
    const tgt = new THREE.Vector3(p.pos.x, p.pos.y + p.eyeH * 0.7, p.pos.z);
    const hit = Math.random() < chance;
    if (!hit) { tgt.x += FC.rand(-1.5, 1.5); tgt.y += FC.rand(-0.5, 1.2); tgt.z += FC.rand(-1.5, 1.5); }
    FC.FX.tracer(muzzle, tgt);
    if (hit) p.damage(def.dmg * G.enemyDmgMul, this.pos.x, this.pos.z, G);
  }
};

FC.Boar = class {
  constructor(x, z, scene) {
    this.pos = new THREE.Vector3(x, FC.World.heightAt(x, z), z);
    this.home = { x, z };
    this.yaw = Math.random() * 6; this.hp = 70; this.alive = true; this.deadT = 0;
    this.state = 'roam'; this.cool = 0; this.moveTo = null; this.target = null; this.speedNow = 0; this.phase = 0;
    this.model = FC.Models.boar();
    scene.add(this.model.group);
  }
  damage(G, amount, attacker) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) { this.alive = false; return; }
    if (attacker && this.state !== 'charge') { this.state = 'charge'; this.target = attacker; this.stateT = 0; }
  }
  update(dt, G) {
    const m = this.model;
    if (!this.alive) {
      this.deadT += dt;
      m.group.rotation.set(0, this.yaw, Math.min(1, this.deadT * 3) * Math.PI / 2);
      m.group.position.copy(this.pos);
      return;
    }
    this.cool -= dt; this.stateT = (this.stateT || 0) + dt;
    let speed = 0, tx = null, tz = null;
    if (this.state === 'roam') {
      if (this.cool <= 0) {
        // look for something to charge
        let best = null, bd = 13;
        for (const p of G.players) if (p.alive) { const d = p.pos.distanceTo(this.pos); if (d < bd) { bd = d; best = p; } }
        for (const e of G.enemies) if (e.alive) { const d = e.pos.distanceTo(this.pos); if (d < bd) { bd = d; best = e; } }
        if (best) { this.state = 'charge'; this.target = best; this.stateT = 0; }
      }
      if (!this.moveTo || Math.hypot(this.moveTo.x - this.pos.x, this.moveTo.z - this.pos.z) < 1) {
        this.moveTo = { x: this.home.x + FC.rand(-25, 25), z: this.home.z + FC.rand(-25, 25) };
      }
      tx = this.moveTo.x; tz = this.moveTo.z; speed = 1.6;
    } else if (this.state === 'charge') {
      const t = this.target;
      if (!t || !(t.alive === true || t.state === 'alive') || this.stateT > 8) { this.state = 'roam'; this.cool = 4; }
      else {
        tx = t.pos.x; tz = t.pos.z; speed = 8.5;
        if (t.pos.distanceTo(this.pos) < 1.5) {
          if (t instanceof FC.Player) t.damage(18, this.pos.x, this.pos.z, G);
          else { t.damage(G, 30, null); if (t.alive) { t.lastKnown = this.pos.clone(); t.boarAttack = this; } }
          this.state = 'flee'; this.stateT = 0; this.cool = 6;
          this.fleeTo = { x: this.pos.x + (this.pos.x - t.pos.x) * 8, z: this.pos.z + (this.pos.z - t.pos.z) * 8 };
        }
      }
    } else if (this.state === 'flee') {
      tx = this.fleeTo.x; tz = this.fleeTo.z; speed = 6;
      if (this.stateT > 2.5) this.state = 'roam';
    }
    if (tx !== null) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const nx = this.pos.x + (dx / d) * speed * dt, nz = this.pos.z + (dz / d) * speed * dt;
        if (FC.World.heightAt(nx, nz) > 0.3) { this.pos.x = nx; this.pos.z = nz; }
        else this.moveTo = null;
        FC.World.collide(this.pos, 0.6, this.pos.y, 1);
        this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 6);
      }
    }
    this.pos.y = FC.World.heightAt(this.pos.x, this.pos.z);
    this.phase += dt * speed * 3;
    m.group.position.copy(this.pos);
    m.group.rotation.set(0, this.yaw, 0);
    m.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * Math.min(1, speed / 3); });
  }
};
