'use strict';
// Ashen Tide militia AI (patrol / suspicious / search / alert / alarm-run / sniper), wildlife and villagers.
const TIDE = { Green: 0x4a1c1c, LightGreen: 0x8c1f1f, Brown: 0x2a2a2e, Brown2: 0x1d1d21, Backpack: 0x2a2a2e };
FC.ENEMY_TYPES = {
  grunt: { hp: 100, speed: 1.6, run: 4.6, dmg: 7, acc: 0.5, range: 85, burst: [3, 5], rof: 0.13, sound: 'rifle', rig: 'rebel1', tint: TIDE, xp: 10, cash: [8, 20] },
  heavy: { hp: 260, speed: 1.3, run: 3.6, dmg: 15, acc: 0.45, range: 38, burst: [1, 2], rof: 0.5, sound: 'heavy', armorFront: true, scale: 1.16, rig: 'rebel1', tint: { Green: 0x262629, LightGreen: 0x591010, Brown: 0x151517, Brown2: 0x101012 }, xp: 25, cash: [20, 40] },
  sniper: { hp: 90, speed: 1.4, run: 4.0, dmg: 34, acc: 0.55, range: 260, burst: [1, 1], rof: 2.8, sound: 'sniper', rig: 'rebel2', tint: { LightBrown: 0x6e1414, DarkBrown: 0x2a0c0c, Brown2: 0x241414 }, sniper: true, xp: 20, cash: [15, 30] },
  boss: { hp: 900, speed: 1.6, run: 4.2, dmg: 10, acc: 0.6, range: 95, burst: [5, 8], rof: 0.09, sound: 'rifle', armorFront: true, scale: 1.12, rig: 'rebel1', tint: { Green: 0x111114, LightGreen: 0xb08d2e, Brown: 0x111114, Brown2: 0x0b0b0d }, xp: 300, cash: [300, 300] },
};
const BARKS = {
  suspicious: ["Hm? Who's there?", 'Did you hear that?', 'Something moved…', 'Check the treeline.'],
  alert: ['Contact! Rebels!', 'Over there!', 'Open fire!', 'Light them up!'],
  alarm: ['Sound the alarm!', 'Hit the siren!'],
  search: ['Spread out, find them!', "They're close. Keep looking."],
  calm: ['Must have been a wolf.', 'Back to posts.'],
  body: ['Man down! We have a body!', 'Someone got Rask!'],
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
    this.detect = [0, 0]; this.los = [false, false]; this.losT = [0, 0]; this.sees = [false, false];
    this.target = null; this.lastKnown = null; this.lostT = 0;
    this.moveTo = null; this.idleT = FC.rand(0, 3);
    this.burst = 0; this.fireT = 1; this.aimT = 0;
    this.tagged = false; this.burning = 0; this.flash = 0;
    this.pendingAlert = -1; this.pendingPos = null;
    this.speedNow = 0; this.stuckT = 0; this.lastPos = this.pos.clone(); this.sideT = 0;
    this.barkT = 0; this.route = null; this.dormant = false; this.firedT = 0;
    const s = this.def.scale || 1;
    this.rig = new FC.Rig(this.def.rig, { height: 1.8 * s, tint: this.def.tint, hide: ['Sword'] });
    this.gun = FC.GunProps.rifle();
    if (this.def.sniper) this.gun.scale.set(1, 1, 1.4);
    this.rig.root.add(this.gun);
    scene.add(this.rig.root);
    this.rig.play('Idle_Gun');
  }

  get headPos() { const s = this.def.scale || 1; return new THREE.Vector3(this.pos.x, this.pos.y + 1.68 * s, this.pos.z); }
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
      this.state = 'alert'; this.stateT = 0; this.aimT = this.def.sniper ? 1.6 : 0.7; this.lostT = 0;
      this.bark(G, 'alert');
      if (this.outpost) G.alertOutpost(this.outpost, this.lastKnown, this);
      if (this.convoy) this.convoy.onAlert(G, this.lastKnown);
    }
  }

  damage(G, amount, attacker, headshot) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash = 0.12;
    if (this.hp <= 0) { this.die(G, attacker, headshot); return; }
    if (attacker) { this.detect[attacker.index] = 1; this.target = attacker; this.setAlert(G, attacker.pos); }
  }

  die(G, attacker, headshot, takedown) {
    this.alive = false; this.deadT = 0; this.hp = 0;
    this.tagged = false; this.burning = 0;
    this.rig.play('Death', { once: true, fade: 0.1 });
    this.gun.visible = false;
    if (this.onTower) this.fallFrom = this.pos.y;
    G.onEnemyKilled(this, attacker, headshot, takedown);
  }

  canSeePlayer(G, p) {
    const eyeH = (this.def.scale || 1) * 1.65;
    const ty = p.vehicle ? p.cam.position.y - 0.3 : p.pos.y + p.eyeH * 0.85;
    const tx = p.vehicle ? p.cam.position.x : p.pos.x, tz = p.vehicle ? p.cam.position.z : p.pos.z;
    return FC.World.los(this.pos.x, this.pos.y + eyeH, this.pos.z, tx, ty, tz);
  }

  perceive(dt, G) {
    const night = FC.Env.night;
    for (const p of G.players) {
      const i = p.index;
      if (!p.alive) { this.detect[i] = Math.max(0, this.detect[i] - dt); this.los[i] = false; this.sees[i] = false; continue; }
      this.losT[i] -= dt;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      const maxRange = this.def.sniper ? 300 : 140;
      if (this.losT[i] <= 0) {
        this.losT[i] = FC.rand(0.12, 0.25);
        this.los[i] = d < maxRange && this.canSeePlayer(G, p);
      }
      const alerted = this.alerted;
      let vd = (alerted ? 95 : 55) * (this.def.sniper ? 2.6 : 1);
      vd *= (p.crouch ? 0.7 : 1) * (p.inBush && p.crouch ? 0.45 : p.inBush ? 0.7 : 1) * (p.sprint ? 1.25 : 1);
      vd *= 1 - night * 0.4 * (alerted ? 0.5 : 1);
      vd *= 1 - FC.Env.rain * 0.25;
      if (p.vehicle) vd *= 1.4;
      const ang = Math.abs(FC.wrapAngle(FC.yawTo(dx, dz) - this.yaw));
      const fov = alerted ? 1.6 : this.def.sniper ? 0.6 : 1.0;
      const seen = this.los[i] && d < vd && (ang < fov || d < 4.5);
      if (seen) {
        let rate = (0.25 + 2.3 * Math.pow(1 - d / vd, 2)) * (p.crouch ? 0.6 : 1) * (p.inBush && p.crouch ? 0.45 : 1);
        if (this.state === 'search' || this.state === 'suspicious') rate *= 1.8;
        if (p.has('ghost')) rate *= 0.75;
        if (d < 6) rate = Math.max(rate, 3);
        this.detect[i] = Math.min(1, this.detect[i] + rate * dt * G.detectMul);
        if (this.detect[i] > 0.3) this.lastKnown = p.pos.clone();
      } else {
        this.detect[i] = Math.max(0, this.detect[i] - (alerted ? 0.05 : 0.25) * dt);
      }
      this.sees[i] = seen;
    }
  }

  bestTarget(G) {
    let best = null, bd = 1e9;
    for (const p of G.players) {
      if (!p.alive || !this.sees[p.index]) continue;
      const d = this.pos.distanceTo(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  walk(dt, tx, tz, speed, face) {
    if (this.onTower) { this.speedNow = 0; return true; }
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.4) { this.speedNow = 0; return true; }
    const step = Math.min(d, speed * dt);
    const nx = this.pos.x + (dx / d) * step, nz = this.pos.z + (dz / d) * step;
    if (FC.World.heightAt(nx, nz) < 0.2) { this.speedNow = 0; return true; }
    // the rebel camp is a safe zone the militia will not enter
    const S = FC.World.start;
    if (Math.hypot(nx - S.x, nz - S.z) < 55 && Math.hypot(nx - S.x, nz - S.z) < Math.hypot(this.pos.x - S.x, this.pos.z - S.z)) { this.speedNow = 0; return true; }
    this.pos.x = nx; this.pos.z = nz;
    FC.World.collide(this.pos, 0.42, this.pos.y, 1.8);
    if (face !== false) this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 6);
    this.speedNow = speed;
    return false;
  }

  update(dt, G, nearest) {
    if (!this.alive) {
      this.deadT += dt;
      if (this.fallFrom !== undefined && this.pos.y > FC.World.heightAt(this.pos.x, this.pos.z)) {
        this.pos.y = Math.max(FC.World.heightAt(this.pos.x, this.pos.z), this.pos.y - dt * 12);
      }
      this.rig.root.position.copy(this.pos);
      this.rig.update(dt, nearest);
      return;
    }
    // far-away militia sleep (cheap) unless engaged
    this.dormant = nearest > 260 && !this.alerted && !this.convoy;
    if (this.dormant) { this.rig.root.visible = nearest < 600; return; }
    this.rig.root.visible = true;
    this.stateT += dt; this.flash = Math.max(0, this.flash - dt);
    this.perceive(dt, G);
    if (this.burning > 0) {
      this.burning -= dt;
      this.damage(G, 22 * dt, null);
      if (!this.alive) return;
      if (!this.onTower) {
        if (!this.panicTo || Math.random() < dt) this.panicTo = { x: this.pos.x + FC.rand(-10, 10), z: this.pos.z + FC.rand(-10, 10) };
        this.walk(dt, this.panicTo.x, this.panicTo.z, this.def.run);
      }
      if (Math.random() < dt * 30) FC.FX.fire(this.pos.x, this.pos.y + 1, this.pos.z, 0.6);
      this.pose(dt, nearest); return;
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
      case 'ride': this.speedNow = 0; break;
    }
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (this.speedNow > 0 && this.pos.distanceTo(this.lastPos) < 0.3) this.sideT = 1.0;
      this.lastPos.copy(this.pos); this.stuckT = 0;
    }
    if (!this.onTower && this.state !== 'ride') this.pos.y = FC.World.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.42);
    this.pose(dt, nearest);
  }

  pose(dt, nearest) {
    const r = this.rig;
    r.root.position.copy(this.pos);
    r.root.rotation.set(0, this.yaw, 0);
    this.firedT = Math.max(0, this.firedT - dt);
    const sp = this.speedNow;
    if (this.state === 'ride') r.play('Idle_Neutral');
    else if (sp < 0.3) r.play(this.firedT > 0 ? 'Idle_Gun_Shoot' : this.alerted ? 'Idle_Gun_Pointing' : 'Idle_Gun');
    else if (sp < 2.5) r.play('Walk', { speed: sp / 1.6 });
    else r.play(this.firedT > 0 ? 'Run_Shoot' : 'Run', { speed: sp / 5 });
    r.update(dt, nearest);
    const f = this.flash > 0 ? 0.6 : 0;
    for (const m of r.meshes) {
      const mat = m.material;
      if (mat && mat.emissive && f) { mat.emissive.setRGB(f, f * 0.25, f * 0.2); this._flashing = true; }
      else if (this._flashing && mat && mat.emissive) mat.emissive.setRGB(0, 0, 0);
    }
    if (!f) this._flashing = false;
    if (r.hand && nearest < 120) {
      r.root.updateMatrixWorld(true);
      const hp = r.hand.getWorldPosition(new THREE.Vector3());
      r.root.worldToLocal(hp);
      this.gun.position.copy(hp);
    } else this.gun.position.set(0.2, 1.15, -0.3);
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
    if (!this.corpseCheckT || G.time > this.corpseCheckT) {
      this.corpseCheckT = G.time + 0.6;
      for (const c of G.enemies) {
        if (c.alive || c.discovered || c.deadT < 1.5) continue;
        const d = this.pos.distanceTo(c.pos);
        if (d > 16) continue;
        const ang = Math.abs(FC.wrapAngle(FC.yawTo(c.pos.x - this.pos.x, c.pos.z - this.pos.z) - this.yaw));
        if (ang < 1.1 && FC.World.los(this.pos.x, this.pos.y + 1.6, this.pos.z, c.pos.x, c.pos.y + 0.4, c.pos.z)) {
          c.discovered = true;
          this.lastKnown = c.pos.clone();
          this.bark(G, 'body');
          if (this.outpost) for (const o of G.enemies) if (o.alive && o.outpost === this.outpost && o.state === 'patrol') { o.state = 'search'; o.stateT = 0; o.lastKnown = c.pos.clone(); }
          this.state = 'search'; this.stateT = 0;
          return;
        }
      }
    }
    if (this.onTower) { this.speedNow = 0; this.yaw += Math.sin(G.time * 0.3 + this.pos.x) * dt * 0.5; return; }
    if (this.goSidestep(dt)) return;
    if (this.idleT > 0) {
      this.idleT -= dt; this.speedNow = 0;
      this.yaw += Math.sin(G.time * 0.7 + this.pos.x) * dt * 0.4;
      return;
    }
    if (!this.moveTo) {
      if (this.route) { this.routeIdx = (this.routeIdx + 1) % this.route.length; this.moveTo = this.route[this.routeIdx]; }
      else if (this.outpost && this.outpost.patrol.length) this.moveTo = FC.pick(this.outpost.patrol);
      else if (this.guardOf) this.moveTo = { x: this.guardOf.x + FC.rand(-9, 9), z: this.guardOf.z + FC.rand(-9, 9) };
      else this.moveTo = { x: this.pos.x + FC.rand(-10, 10), z: this.pos.z + FC.rand(-10, 10) };
    }
    if (this.walk(dt, this.moveTo.x, this.moveTo.z, this.def.speed)) { this.moveTo = null; this.idleT = this.route ? 0.5 : FC.rand(2, 6); }
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
    if (!op || !op.alarm || op.alarmSabotaged || op.alarmTriggered || this.onTower) { this.state = 'alert'; this.stateT = 0; return; }
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
      if (!this.onTower) {
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
      }
      this.aimT -= dt;
      this.fireT -= dt;
      if (def.sniper) this.glint = this.aimT < 1.2 ? 1 : 0;
      if (this.aimT <= 0 && this.fireT <= 0 && d < def.range * 1.3) {
        if (this.burst <= 0) this.burst = Math.round(FC.rand(def.burst[0], def.burst[1]));
        this.shoot(G, t, d);
        this.burst--;
        this.fireT = this.burst > 0 ? def.rof : FC.rand(0.9, 1.9) * (def.sniper ? 2 : 1);
        if (def.sniper) this.aimT = 1.2;
      }
    } else {
      this.glint = 0;
      this.lostT += dt;
      if (this.lastKnown && !this.goSidestep(dt)) this.walk(dt, this.lastKnown.x, this.lastKnown.z, def.run * 0.8);
      if (this.lostT > 9) { this.state = 'search'; this.stateT = 0; this.detect = [0.25, 0.25]; this.bark(G, 'search'); }
    }
  }

  shoot(G, p, d) {
    const def = this.def;
    const muzzle = this.gun.localToWorld(new THREE.Vector3(0, 0.02, -0.7));
    FC.FX.muzzle(muzzle.x, muzzle.y, muzzle.z);
    FC.Audio.shot(def.sound, G.volumeAt(this.pos, def.sniper ? 450 : 200) * 0.8, this.pos);
    this.firedT = 0.4;
    let chance = def.acc * FC.clamp(1 - d / def.range, 0.08, 1) + 0.06;
    if (def.sniper) chance = 0.55 * (p.speed > 4 ? 0.5 : 1);
    if (p.crouch) chance *= 0.75;
    if (p.speed > 7) chance *= 0.6;
    if (p.inBush) chance *= 0.8;
    if (p.vehicle) chance *= 0.7;
    chance *= G.enemyAccMul;
    const tgt = p.vehicle ? p.cam.position.clone() : new THREE.Vector3(p.pos.x, p.pos.y + p.eyeH * 0.7, p.pos.z);
    const hit = Math.random() < chance;
    if (!hit) { tgt.x += FC.rand(-1.5, 1.5); tgt.y += FC.rand(-0.5, 1.2); tgt.z += FC.rand(-1.5, 1.5); }
    FC.FX.tracer(muzzle, tgt);
    if (hit) {
      if (p.vehicle && Math.random() < 0.5) p.vehicle.damage(G, def.dmg * 2, null);
      else p.damage(def.dmg * G.enemyDmgMul, this.pos.x, this.pos.z, G);
    }
  }
};

// ------------------------------------------------------------------------------------------- wildlife
FC.Animal = class {
  constructor(kind, x, z, scene) {
    this.kind = kind; // 'deer' | 'stag' | 'wolf'
    this.pos = new THREE.Vector3(x, FC.World.heightAt(x, z), z);
    this.home = { x, z };
    this.yaw = Math.random() * 6; this.alive = true; this.deadT = 0;
    this.hp = kind === 'wolf' ? 70 : kind === 'stag' ? 90 : 60;
    this.state = 'roam'; this.cool = 0; this.moveTo = null; this.target = null; this.speedNow = 0; this.stateT = 0;
    this.rig = new FC.Rig(kind, { height: kind === 'wolf' ? 1.0 : kind === 'stag' ? 2.0 : 1.6 });
    this.radius = Math.max(0.4, this.rig.size.wid * 0.5);
    scene.add(this.rig.root);
    this.rig.play('Idle');
  }
  get hostile() { return this.kind === 'wolf'; }
  damage(G, amount, attacker) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false; this.rig.play('Death', { once: true, fade: 0.1 });
      FC.Audio.creatureDie(this.pos);
      if (attacker && attacker.index !== undefined) G.onAnimalKilled(this, attacker);
      return;
    }
    this.rig.play(Math.random() < 0.5 ? 'Idle_HitReact_Left' : 'Idle_HitReact_Right', { fade: 0.05 });
    this.hurtT = 0.35;
    if (this.hostile && attacker) { this.state = 'charge'; this.target = attacker; this.stateT = 0; }
    else if (!this.hostile) this.flee(attacker ? attacker.pos : this.pos);
  }
  flee(from) {
    this.state = 'flee'; this.stateT = 0;
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    this.fleeTo = { x: this.pos.x + (dx / d) * 60, z: this.pos.z + (dz / d) * 60 };
  }
  update(dt, G, nearest) {
    const r = this.rig;
    if (!this.alive) { this.deadT += dt; r.update(dt, nearest); return; }
    if (nearest > 320) { r.root.visible = false; return; }
    r.root.visible = true;
    this.cool -= dt; this.stateT += dt;
    let speed = 0, tx = null, tz = null;
    if (this.state === 'roam') {
      if (this.cool <= 0) {
        let best = null, bd = this.hostile ? 16 : 22;
        for (const p of G.players) if (p.alive && !p.vehicle) {
          const d = p.pos.distanceTo(this.pos);
          const noticed = d < bd * (p.crouch ? 0.5 : 1) * (p.inBush ? 0.6 : 1);
          if (noticed && d < bd) { bd = d; best = p; }
        }
        if (this.hostile) for (const e of G.enemies) if (e.alive && !e.dormant) { const d = e.pos.distanceTo(this.pos); if (d < bd) { bd = d; best = e; } }
        if (best) { if (this.hostile) { this.state = 'charge'; this.target = best; this.stateT = 0; FC.Audio.growl(1, this.pos); } else this.flee(best.pos); }
      }
      if (!this.moveTo || Math.hypot(this.moveTo.x - this.pos.x, this.moveTo.z - this.pos.z) < 1) {
        this.idleT = FC.rand(2, 7);
        this.moveTo = { x: this.home.x + FC.rand(-30, 30), z: this.home.z + FC.rand(-30, 30) };
      }
      if (this.idleT > 0) { this.idleT -= dt; } else { tx = this.moveTo.x; tz = this.moveTo.z; speed = 1.4; }
    } else if (this.state === 'charge') {
      const t = this.target;
      if (!t || !(t.alive === true) || this.stateT > 10) { this.state = 'roam'; this.cool = 4; }
      else {
        tx = t.pos.x; tz = t.pos.z; speed = 8.5;
        if (t.pos.distanceTo(this.pos) < 1.6) {
          if (t instanceof FC.Player) t.damage(12 * G.enemyDmgMul, this.pos.x, this.pos.z, G);
          else t.damage(G, 30, null);
          this.state = 'flee'; this.stateT = 0; this.cool = 3;
          this.fleeTo = { x: this.pos.x + (this.pos.x - t.pos.x) * 4, z: this.pos.z + (this.pos.z - t.pos.z) * 4 };
          this.attackT = 0.5;
        }
      }
    } else if (this.state === 'flee') {
      tx = this.fleeTo.x; tz = this.fleeTo.z; speed = this.hostile ? 6 : 10;
      if (this.stateT > (this.hostile ? 1.5 : 6)) { this.state = this.hostile && this.target && this.target.alive ? 'charge' : 'roam'; this.stateT = 0; }
    }
    if (tx !== null) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const nx = this.pos.x + (dx / d) * speed * dt, nz = this.pos.z + (dz / d) * speed * dt;
        if (FC.World.heightAt(nx, nz) > 0.3) { this.pos.x = nx; this.pos.z = nz; } else { this.moveTo = null; if (this.state === 'flee') this.state = 'roam'; }
        FC.World.collide(this.pos, this.radius, this.pos.y, 1);
        this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 5);
      } else speed = 0;
    }
    this.speedNow = speed;
    this.pos.y = FC.World.heightAt(this.pos.x, this.pos.z);
    r.root.position.copy(this.pos);
    r.root.rotation.set(0, this.yaw, 0);
    this.attackT = Math.max(0, (this.attackT || 0) - dt);
    this.hurtT = Math.max(0, (this.hurtT || 0) - dt);
    if (this.hurtT > 0) { /* hit-react clip playing */ }
    else if (this.attackT > 0) r.play(this.hostile ? 'Attack' : 'Attack_Kick', { fade: 0.1 });
    else if (speed < 0.2) r.play(this.idlePick || (this.idlePick = Math.random() < 0.5 ? 'Idle' : 'Eating'));
    else if (speed < 3) r.play('Walk', { speed: speed / 1.4 });
    else r.play('Gallop', { speed: speed / 8 });
    r.update(dt, nearest);
  }
};

// ------------------------------------------------------------------------------------------- villagers
const SHIRTS = [0x6d8fa8, 0xc9b27c, 0x8c5a3c, 0xd4d0c4, 0x557a55, 0xa14f3c, 0x3f5873];
FC.Civilian = class {
  constructor(village, scene) {
    this.village = village;
    const p = FC.pick(village.wander.length ? village.wander : [{ x: village.x, z: village.z }]);
    this.pos = new THREE.Vector3(p.x, FC.World.heightAt(p.x, p.z), p.z);
    this.yaw = Math.random() * 6; this.alive = true; this.state = 'wander'; this.idleT = FC.rand(1, 5); this.moveTo = null; this.stateT = 0;
    this.rig = new FC.Rig('worker', { height: FC.rand(1.68, 1.86), tint: { Shirt: FC.pick(SHIRTS), Pants: FC.pick([0x2b2f3a, 0x3d3127, 0x4a4a40]) } });
    scene.add(this.rig.root);
    this.rig.play('Man_Idle');
  }
  scare(from) {
    if (!this.alive) return;
    this.state = 'flee'; this.stateT = 0;
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    this.moveTo = { x: this.pos.x + (dx / d) * 25, z: this.pos.z + (dz / d) * 25 };
  }
  damage(G, amount, attacker) {
    if (!this.alive) return;
    this.alive = false; this.rig.play('Man_Death', { once: true, fade: 0.1 });
    if (attacker && attacker.index !== undefined) G.onCivilianKilled(this, attacker);
  }
  update(dt, G, nearest) {
    const r = this.rig;
    if (!this.alive) { r.update(dt, nearest); return; }
    if (nearest > 220) { r.root.visible = false; return; }
    r.root.visible = true;
    this.stateT += dt;
    let speed = 0;
    if (this.state === 'cheer') { r.play('Man_Clapping'); if (this.stateT > 6) this.state = 'wander'; }
    else {
      if (this.state === 'flee' && this.stateT > 8) this.state = 'wander';
      if (this.idleT > 0 && this.state === 'wander') { this.idleT -= dt; }
      else {
        if (!this.moveTo) this.moveTo = FC.pick(this.village.wander.length ? this.village.wander : [{ x: this.village.x, z: this.village.z }]);
        speed = this.state === 'flee' ? 5 : 1.3;
        const dx = this.moveTo.x - this.pos.x, dz = this.moveTo.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.5) { this.moveTo = null; this.idleT = FC.rand(3, 9); speed = 0; }
        else {
          this.pos.x += (dx / d) * speed * dt; this.pos.z += (dz / d) * speed * dt;
          FC.World.collide(this.pos, 0.35, this.pos.y, 1.8);
          this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 5);
        }
      }
      r.play(speed === 0 ? (this.sitting ? 'Man_Sitting' : 'Man_Idle') : speed > 3 ? 'Man_Run' : 'Man_Walk', { speed: speed > 3 ? 1 : 0.9 });
    }
    this.pos.y = FC.World.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.35);
    r.root.position.copy(this.pos);
    r.root.rotation.set(0, this.yaw, 0);
    r.update(dt, nearest);
  }
};
