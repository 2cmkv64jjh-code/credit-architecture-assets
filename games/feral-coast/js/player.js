'use strict';
// Player: movement, weapons, interactions, downed/revive state.
FC.WEAPONS = [
  { name: 'AR-7 Rifle', dmg: 24, head: 2.3, rate: 0.1, mag: 30, reserve: 150, maxReserve: 240, spread: 0.014, ads: 0.003, range: 220, noise: 75, auto: true, reload: 1.8, recoil: 0.013, sound: 'rifle', zoom: 1.55 },
  { name: 'Whisper Pistol', dmg: 34, head: 3.1, rate: 0.26, mag: 12, reserve: 48, maxReserve: 96, spread: 0.01, ads: 0.002, range: 110, noise: 7, auto: false, reload: 1.3, recoil: 0.025, sound: 'pistol', zoom: 1.25 },
  { name: 'Molotov', throwable: true, mag: 3, reserve: 0, maxCount: 5, rate: 0.8, zoom: 1 },
];

FC.Player = class {
  constructor(index, device, scene) {
    this.index = index;
    this.name = index === 0 ? 'Rook' : 'Wren';
    this.color = index === 0 ? '#3fd0c9' : '#ff9f43';
    this.ctrl = new FC.Input.Controller(device);
    this.device = device;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.hp = 100; this.medkits = 2; this.lastHurt = -99;
    this.state = 'alive'; // alive | downed | dead
    this.downTimer = 0; this.respawnTimer = 0; this.reviveProgress = 0;
    this.crouch = false; this.sprint = false; this.onGround = true; this.swimming = false; this.inBush = false;
    this.eyeH = 1.65;
    this.weapon = 0;
    this.ammo = FC.WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));
    this.fireCd = 0; this.reloadT = 0; this.healT = 0; this.aimT = 0; this.recoil = 0; this.kick = 0;
    this.bob = 0; this.shake = 0; this.switchT = 0;
    this.hitmarker = 0; this.killmarker = 0; this.damageDirs = []; this.messages = [];
    this.prompt = ''; this.stats = { kills: 0, headshots: 0, takedowns: 0, revives: 0, tags: 0 };
    this.lunge = 0;

    this.cam = new THREE.PerspectiveCamera(70, 1, 0.05, 2200);
    this.cam.rotation.order = 'YXZ';
    scene.add(this.cam);
    // body visible to partner only (layer 1 + index), viewmodel only to self (layer 3 + index)
    const colors = index === 0
      ? { shirt: 0x2e8f86, pants: 0x3b4a3a, gear: 0x1f5e58, mask: 0x111111 }
      : { shirt: 0xd9822b, pants: 0x4b3f33, gear: 0x7a4a1f, mask: 0x111111 };
    this.model = FC.Models.humanoid(colors);
    FC.Models.setLayer(this.model.group, 1 + index);
    scene.add(this.model.group);
    this.vm = FC.Models.viewmodels(0xc89a74, colors.shirt);
    this.vmRoot = new THREE.Group();
    this.vmRoot.scale.setScalar(0.72);
    this.cam.add(this.vmRoot);
    this.vm.list.forEach((g) => this.vmRoot.add(g));
    this.vmRoot.add(this.vm.flash);
    FC.Models.setLayer(this.vmRoot, 3 + index);
    this.cam.layers.enable(0);
    this.cam.layers.enable(index === 0 ? 2 : 1);
    this.cam.layers.enable(3 + index);
    this.cam.layers.disable(1 + index);
    this.walkPhase = 0;
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }
  get alive() { return this.state === 'alive'; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  forward() {
    const v = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return v;
  }
  msg(text, color, dur) { this.messages.push({ text, color: color || '#fff', t: dur || 3.5 }); if (this.messages.length > 5) this.messages.shift(); }

  spawnAt(x, z) {
    this.pos.set(x, FC.World.heightAt(x, z) + 0.1, z);
    this.vel.set(0, 0, 0);
    this.hp = 100; this.state = 'alive'; this.crouch = false; this.reviveProgress = 0;
  }

  damage(amount, fromX, fromZ, G) {
    if (this.state !== 'alive' || G.godMode) return;
    this.hp -= amount;
    this.lastHurt = G.time;
    this.shake = Math.max(this.shake, 0.25);
    if (fromX !== undefined) this.damageDirs.push({ a: FC.yawTo(fromX - this.pos.x, fromZ - this.pos.z), t: 1.2 });
    if (this.damageDirs.length > 6) this.damageDirs.shift();
    FC.Audio.hurt();
    if (this.hp <= 0) {
      this.hp = 0;
      const partner = G.players.find((p) => p !== this);
      if (partner && partner.alive) {
        this.state = 'downed'; this.downTimer = 30; this.reviveProgress = 0;
        partner.msg(`${this.name} is down! Revive them!`, '#ff6b6b', 4);
        this.msg('You are down. Hang on for your partner.', '#ff6b6b', 4);
      } else {
        this.state = 'dead'; this.respawnTimer = 5;
        this.msg(G.players.length > 1 ? 'Squad down. Regrouping…' : 'You were killed.', '#ff6b6b', 5);
        if (partner && partner.state === 'downed') { partner.state = 'dead'; partner.respawnTimer = 5; }
      }
    }
  }

  update(dt, G) {
    const c = this.ctrl.poll(dt);
    this.input = c;
    const pr = c.pressed;
    if (pr.pause) G.togglePause();
    // timers
    this.hitmarker = Math.max(0, this.hitmarker - dt);
    this.killmarker = Math.max(0, this.killmarker - dt);
    this.shake = Math.max(0, this.shake - dt);
    for (const d of this.damageDirs) d.t -= dt;
    this.damageDirs = this.damageDirs.filter((d) => d.t > 0);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);

    // look
    const sensMul = this.aimT > 0.5 ? 0.6 : 1;
    this.yaw -= c.lx * sensMul;
    this.pitch = FC.clamp(this.pitch - c.ly * sensMul, -1.45, 1.45);

    if (this.state === 'dead') {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) G.respawn(this);
      this.updateCamera(dt, G); this.updateModel(dt);
      return;
    }
    if (this.state === 'downed') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) { this.state = 'dead'; this.respawnTimer = 4; this.msg('You bled out.', '#ff6b6b'); }
      this.vel.set(0, 0, 0);
      this.updateCamera(dt, G); this.updateModel(dt);
      return;
    }

    // stance
    if (pr.crouch) this.crouch = !this.crouch;
    const moving = Math.hypot(c.mx, c.my) > 0.1;
    if (c.sprint && c.my > 0.3) { this.sprint = true; this.crouch = false; }
    if (this.ctrl.padIndex >= 0) { if (pr.sprint) this.sprintToggle = true; if (!moving) this.sprintToggle = false; if (this.sprintToggle && c.my > 0.3) { this.sprint = true; this.crouch = false; } }
    if (!(c.sprint || this.sprintToggle) || c.my <= 0.3 || c.aim) this.sprint = false;

    this.updateWeapons(dt, c, G);
    this.updateInteract(dt, c, G);
    if (pr.tag) G.tag(this);
    if (pr.heal && this.medkits > 0 && this.hp < 100 && this.healT <= 0) { this.healT = 0.9; }
    if (this.healT > 0) {
      this.healT -= dt;
      if (this.healT <= 0) { this.medkits--; this.hp = 100; this.msg('Patched up', '#7bed9f', 1.5); FC.Audio.pickup(); }
    }
    // regen to next 25-hp segment
    if (G.time - this.lastHurt > 4 && this.hp < 100) {
      const cap = Math.ceil(this.hp / 25) * 25;
      this.hp = Math.min(cap, this.hp + 10 * dt);
    }

    // movement
    const W = FC.World;
    let spd = this.crouch ? 3.0 : this.sprint ? 9.5 : 5.6;
    if (this.aimT > 0.5) spd *= 0.6;
    const ground = W.heightAt(this.pos.x, this.pos.z);
    this.swimming = ground < -1.3;
    if (this.swimming) spd = 3.6; else if (ground < 0) spd *= 0.75;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = cy * c.mx - sy * c.my, wz = -sy * c.mx - cy * c.my;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const accel = this.onGround || this.swimming ? 45 : 8;
    const tx = wx * spd, tz = wz * spd;
    const k = Math.min(1, accel * dt / Math.max(0.001, spd));
    this.vel.x += (tx - this.vel.x) * Math.min(1, k * 2.5);
    this.vel.z += (tz - this.vel.z) * Math.min(1, k * 2.5);
    if (pr.jump && this.onGround && !this.swimming) { this.vel.y = 7; this.onGround = false; this.crouch = false; }
    this.vel.y -= 20 * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 340) { this.pos.x *= 340 / r; this.pos.z *= 340 / r; }
    W.collide(this.pos, 0.4, this.pos.y, this.crouch ? 1.2 : 1.8);
    let g = W.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.4);
    if (this.swimming) g = Math.max(g, -1.35);
    if (this.pos.y <= g) {
      // step up gently
      this.pos.y = g; this.vel.y = 0; this.onGround = true;
    } else if (this.pos.y - g < 0.35 && this.vel.y <= 0) {
      this.pos.y = g; this.vel.y = 0; this.onGround = true;
    } else this.onGround = false;

    this.inBush = W.inBush(this.pos.x, this.pos.z);
    if (moving && this.onGround) this.walkPhase += dt * (this.sprint ? 13 : this.crouch ? 6 : 9);
    this.updateCamera(dt, G);
    this.updateModel(dt);
  }

  updateWeapons(dt, c, G) {
    const pr = c.pressed;
    let want = -1;
    if (pr.slot0) want = 0; if (pr.slot1) want = 1; if (pr.slot2) want = 2;
    if (pr.next) want = (this.weapon + 1) % 3;
    if (pr.prev) want = (this.weapon + 2) % 3;
    if (want >= 0 && want !== this.weapon) { this.weapon = want; this.reloadT = 0; this.switchT = 0.35; FC.Audio.click(); }
    this.switchT = Math.max(0, this.switchT - dt);
    const w = FC.WEAPONS[this.weapon], a = this.ammo[this.weapon];
    const canUse = !this.swimming && !this.sprint && this.switchT <= 0 && this.healT <= 0;
    this.aimT = FC.clamp(this.aimT + (c.aim && canUse && !w.throwable ? 1 : -1) * dt * 7, 0, 1);
    this.fireCd -= dt;
    this.recoil *= Math.max(0, 1 - dt * 8);
    this.kick *= Math.max(0, 1 - dt * 12);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = w.mag - a.mag, got = Math.min(need, a.reserve);
        a.mag += got; a.reserve -= got;
      }
      return;
    }
    if (!w.throwable && (pr.reload || (a.mag === 0 && (c.fire || pr.fire))) && a.mag < w.mag && a.reserve > 0) {
      this.reloadT = w.reload; FC.Audio.click(); return;
    }
    const trigger = w.auto ? c.fire : pr.fire;
    if (trigger && canUse && this.fireCd <= 0) {
      if (a.mag <= 0) { if (pr.fire) FC.Audio.click(); return; }
      this.fireCd = w.rate;
      a.mag--;
      if (w.throwable) { G.throwMolotov(this); this.kick = 0.4; }
      else {
        G.playerShoot(this, w);
        this.recoil += w.recoil; this.kick = 1;
        this.pitch = Math.min(1.45, this.pitch + w.recoil * (this.aimT > 0.5 ? 0.5 : 1));
        this.yaw += (Math.random() - 0.5) * w.recoil * 0.6;
        this.vm.flash.visible = true; this.flashT = 0.05;
      }
    }
  }

  updateInteract(dt, c, G) {
    const L = this.ctrl.labels;
    this.prompt = '';
    const partner = G.players.find((p) => p !== this);
    if (partner && partner.state === 'downed' && partner.pos.distanceTo(this.pos) < 2.6) {
      this.prompt = `Hold [${L.interact}] Revive ${partner.name}`;
      if (c.interact) {
        partner.reviveProgress += dt / 2.2;
        if (partner.reviveProgress >= 1) {
          partner.state = 'alive'; partner.hp = 50; partner.reviveProgress = 0;
          partner.msg(`${this.name} got you back up!`, '#7bed9f'); this.msg(`Revived ${partner.name}`, '#7bed9f');
          this.stats.revives++; FC.Audio.pickup();
        }
      } else partner.reviveProgress = Math.max(0, partner.reviveProgress - dt);
      return;
    }
    const e = G.takedownTarget(this);
    if (e) {
      this.prompt = `[${L.interact}] Takedown`;
      if (c.pressed.interact) G.takedown(this, e);
      return;
    }
    for (const op of FC.World.outposts) {
      if (!op.liberated && op.alarm && !op.alarmSabotaged && !op.alarmTriggered && Math.hypot(op.alarm.x - this.pos.x, op.alarm.z - this.pos.z) < 2.4) {
        this.prompt = `[${L.interact}] Sabotage alarm`;
        if (c.pressed.interact) {
          op.alarmSabotaged = true;
          op.alarm.bulb.material.color.set(0x222222);
          G.announce(`Alarm at ${op.name} sabotaged`, '#7bed9f');
          FC.Audio.click();
        }
        return;
      }
    }
    for (const s of G.supplyPoints()) {
      if (Math.hypot(s.x - this.pos.x, s.z - this.pos.z) < 2.6) {
        this.prompt = `[${L.interact}] Resupply`;
        if (c.pressed.interact) {
          FC.WEAPONS.forEach((w, i) => {
            if (w.throwable) this.ammo[i].mag = Math.max(this.ammo[i].mag, 3);
            else this.ammo[i].reserve = w.maxReserve;
          });
          this.medkits = Math.max(this.medkits, 3);
          this.msg('Resupplied: ammo, molotovs, medkits', '#7bed9f'); FC.Audio.pickup();
        }
        return;
      }
    }
  }

  updateCamera(dt, G) {
    const target = this.state === 'downed' ? 0.4 : this.state === 'dead' ? 0.3 : this.swimming ? 1.45 : this.crouch ? 1.05 : 1.65;
    this.eyeH += (target - this.eyeH) * Math.min(1, dt * 10);
    const bobA = this.onGround && this.speed > 0.5 ? (this.sprint ? 0.07 : 0.035) : 0;
    const bob = Math.sin(this.walkPhase) * bobA;
    const sh = this.shake * 0.25;
    this.cam.position.set(this.pos.x + (Math.random() - 0.5) * sh, this.pos.y + this.eyeH + bob + (Math.random() - 0.5) * sh, this.pos.z);
    this.cam.rotation.set(this.pitch - this.lunge * 0.3, this.yaw, this.state === 'downed' ? 0.3 : 0);
    this.lunge = Math.max(0, this.lunge - dt * 3);
    // field of view adapts to viewport aspect
    const w = FC.WEAPONS[this.weapon];
    const hfov = 92 / (1 + (w.zoom - 1) * this.aimT);
    const vfov = FC.clamp((2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / this.cam.aspect) * 180) / Math.PI, 40, 82);
    if (Math.abs(this.cam.fov - vfov) > 0.01) { this.cam.fov = vfov; this.cam.updateProjectionMatrix(); }
    // viewmodel
    const showVm = this.state === 'alive';
    this.vm.list.forEach((g, i) => { g.visible = showVm && i === this.weapon && (!w.throwable || this.ammo[2].mag > 0); });
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.vm.flash.visible = false; }
    const a = this.aimT;
    const swayX = Math.cos(this.walkPhase * 0.5) * bobA * 0.5, swayY = Math.abs(Math.sin(this.walkPhase)) * bobA * 0.4;
    const lower = (this.sprint ? 0.12 : 0) + (this.swimming ? 0.35 : 0) + (this.reloadT > 0 ? 0.12 : 0) + this.switchT * 0.5 + (this.healT > 0 ? 0.3 : 0);
    const g = this.vm.list[this.weapon];
    g.position.set(FC.lerp(0.24, 0, a) + swayX, FC.lerp(-0.24, -0.118, a) - swayY - lower, FC.lerp(-0.4, -0.3, a) + this.kick * 0.05);
    g.rotation.set(this.kick * 0.08 + (this.reloadT > 0 ? 0.5 : 0), this.sprint ? 0.5 : 0, this.reloadT > 0 ? 0.4 : 0);
    const m = this.vm.muzzles[this.weapon];
    if (m) { m.getWorldPosition(this.vm.flash.position); this.vmRoot.worldToLocal(this.vm.flash.position); }
  }

  updateModel(dt) {
    const m = this.model;
    m.group.position.copy(this.pos);
    m.group.rotation.set(0, this.yaw, 0);
    if (this.state !== 'alive') {
      m.group.rotation.x = -Math.PI / 2 * 0.9; m.group.position.y += 0.25;
      FC.Models.animate(m, 0, 0, 0);
    } else {
      FC.Models.animate(m, this.walkPhase, Math.min(1, this.speed / 5), this.crouch ? 1 : 0);
      m.torso.rotation.x += -this.pitch * 0.3;
    }
  }
};
