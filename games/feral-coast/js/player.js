'use strict';
// Player: movement, stances, ladders, vehicles, weapons, interactions, downed/revive state.
FC.WEAPONS = {
  pistol: { name: 'Whisper .45', dmg: 36, head: 3.1, rate: 0.24, mag: 12, reserve: 48, maxReserve: 96, spread: 0.01, ads: 0.002, range: 120, noise: 7, auto: false, reload: 1.3, recoil: 0.025, sound: 'pistol', zoom: 1.25 },
  rifle: { name: 'AR-7 Carbine', dmg: 25, head: 2.3, rate: 0.1, mag: 30, reserve: 150, maxReserve: 240, spread: 0.014, ads: 0.003, range: 230, noise: 75, auto: true, reload: 1.8, recoil: 0.013, sound: 'rifle', zoom: 1.6 },
  shotgun: { name: 'Breaker 12', pellets: 9, dmg: 15, head: 1.6, rate: 0.75, mag: 6, reserve: 30, maxReserve: 48, spread: 0.065, ads: 0.045, range: 50, noise: 85, auto: false, reload: 2.4, recoil: 0.07, sound: 'heavy', zoom: 1.2, price: 450 },
  sniper: { name: 'Longtide .308', dmg: 115, head: 3, rate: 1.15, mag: 5, reserve: 20, maxReserve: 40, spread: 0.03, ads: 0.0002, range: 520, noise: 110, auto: false, reload: 2.6, recoil: 0.09, sound: 'sniper', zoom: 4.5, scope: true, price: 800 },
  molotov: { name: 'Molotov', throwable: 'molotov', mag: 3, maxCount: 5, rate: 0.8, zoom: 1, price: 120 },
  grenade: { name: 'Frag Grenade', throwable: 'grenade', mag: 2, maxCount: 4, rate: 0.8, zoom: 1, price: 150 },
};
FC.WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'sniper', 'molotov', 'grenade'];

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
    this.maxHp = FC.G.diff.hp; this.hp = this.maxHp; this.medkits = 2; this.lastHurt = -99;
    this.state = 'alive';
    this.downTimer = 0; this.respawnTimer = 0; this.reviveProgress = 0;
    this.crouch = false; this.sprint = false; this.onGround = true; this.swimming = false; this.inBush = false;
    this.eyeH = 1.65; this.climbing = null; this.vehicle = null; this.seat = -1;
    this.owned = new Set(['pistol', 'rifle', 'molotov']);
    this.weapon = 'rifle';
    this.ammo = {}; for (const k in FC.WEAPONS) this.ammo[k] = { mag: FC.WEAPONS[k].mag, reserve: FC.WEAPONS[k].reserve || 0 };
    this.fireCd = 0; this.reloadT = 0; this.healT = 0; this.aimT = 0; this.recoil = 0; this.kick = 0;
    this.shake = 0; this.switchT = 0; this.flashT = 0; this.lunge = 0;
    this.hitmarker = 0; this.killmarker = 0; this.damageDirs = []; this.messages = []; this.prompt = '';
    this.stats = { kills: 0, headshots: 0, takedowns: 0, revives: 0, tags: 0 };
    this.prog = FC.Progression.newProfile();
    this.menu = null; // 'map' | 'skills' | 'shop'
    this.chainT = 0;

    this.cam = new THREE.PerspectiveCamera(70, 1, 0.05, 6000);
    this.cam.rotation.order = 'YXZ';
    scene.add(this.cam);
    this.rig = new FC.Rig(index === 0 ? 'rebel1' : 'rebel2', { height: 1.8, hide: ['Sword'] });
    this.gun = FC.GunProps.rifle();
    this.rig.root.add(this.gun);
    this.rig.root.traverse((o) => o.layers.set(1 + index));
    scene.add(this.rig.root);
    this.rig.play('Idle_Gun');
    this.buildViewmodels();
    this.cam.layers.enable(0);
    this.cam.layers.enable(index === 0 ? 2 : 1);
    this.cam.layers.enable(3 + index);
    this.cam.layers.disable(1 + index);
    this.walkPhase = 0;
  }

  buildViewmodels() {
    const P = FC.GunProps, d = P.dark, w = P.wood;
    const skin = new THREE.MeshStandardMaterial({ color: 0xb98a66, roughness: 0.7 });
    const sleeve = new THREE.MeshStandardMaterial({ color: this.index === 0 ? 0x4b5a32 : 0x3b2a22, roughness: 0.9 });
    const arms = (g) => { P.part(g, 0.085, 0.085, 0.34, 0.05, -0.1, 0.14, sleeve); P.part(g, 0.075, 0.075, 0.1, 0.03, -0.08, -0.05, skin); P.part(g, 0.085, 0.085, 0.36, -0.07, -0.09, -0.3, sleeve); P.part(g, 0.07, 0.07, 0.09, -0.04, -0.06, -0.42, skin); };
    const vm = {};
    vm.rifle = P.rifle(); arms(vm.rifle);
    vm.pistol = new THREE.Group();
    P.part(vm.pistol, 0.045, 0.07, 0.2, 0, 0, -0.05, d); P.part(vm.pistol, 0.04, 0.12, 0.06, 0, -0.08, 0.02, d);
    const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10), d); sup.rotation.x = Math.PI / 2; sup.position.set(0, 0.01, -0.25); vm.pistol.add(sup);
    P.part(vm.pistol, 0.085, 0.085, 0.34, 0.05, -0.1, 0.18, sleeve); P.part(vm.pistol, 0.07, 0.07, 0.09, 0.02, -0.08, 0.02, skin);
    vm.shotgun = new THREE.Group();
    P.part(vm.shotgun, 0.07, 0.1, 0.42, 0, 0, -0.05, d); P.part(vm.shotgun, 0.045, 0.045, 0.5, 0, 0.02, -0.5, d);
    P.part(vm.shotgun, 0.06, 0.06, 0.24, 0, -0.04, -0.42, w); P.part(vm.shotgun, 0.06, 0.1, 0.26, 0, -0.03, 0.26, w); arms(vm.shotgun);
    vm.sniper = new THREE.Group();
    P.part(vm.sniper, 0.06, 0.09, 0.6, 0, 0, -0.12, w); P.part(vm.sniper, 0.03, 0.03, 0.5, 0, 0.012, -0.62, d);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 12), d); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.085, -0.12); vm.sniper.add(scope);
    P.part(vm.sniper, 0.04, 0.05, 0.05, 0, 0.05, -0.12, d); arms(vm.sniper);
    vm.molotov = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0x5b7a32, transparent: true, opacity: 0.85, roughness: 0.2 });
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.17, 10), glass); bottle.position.set(0, 0, -0.05); vm.molotov.add(bottle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.08, 8), glass); neck.position.set(0, 0.12, -0.05); vm.molotov.add(neck);
    P.part(vm.molotov, 0.03, 0.06, 0.03, 0, 0.18, -0.05, new THREE.MeshStandardMaterial({ color: 0xd8d0b0 }));
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 6 }));
    fl.position.set(0, 0.23, -0.05); vm.molotov.add(fl);
    P.part(vm.molotov, 0.085, 0.085, 0.34, 0.05, -0.1, 0.14, sleeve); P.part(vm.molotov, 0.075, 0.075, 0.1, 0.03, -0.06, -0.03, skin);
    vm.grenade = new THREE.Group();
    const gr = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3e4a2a, roughness: 0.6 })); gr.position.set(0, 0.02, -0.05); vm.grenade.add(gr);
    P.part(vm.grenade, 0.02, 0.03, 0.03, 0, 0.07, -0.05, d);
    P.part(vm.grenade, 0.085, 0.085, 0.34, 0.05, -0.1, 0.14, sleeve); P.part(vm.grenade, 0.075, 0.075, 0.1, 0.03, -0.06, -0.03, skin);
    this.vm = vm;
    this.muzzle = { rifle: [0, 0.012, -0.7], pistol: [0, 0.01, -0.36], shotgun: [0, 0.02, -0.76], sniper: [0, 0.012, -0.88] };
    this.vmRoot = new THREE.Group();
    this.vmRoot.scale.setScalar(0.6);
    this.cam.add(this.vmRoot);
    for (const k in vm) { vm[k].traverse((o) => { if (o.isMesh) o.castShadow = false; }); this.vmRoot.add(vm[k]); }
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), flashMat);
    this.flash.scale.set(1, 1, 2.2); this.flash.visible = false;
    this.vmRoot.add(this.flash);
    this.vmRoot.traverse((o) => o.layers.set(3 + this.index));
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }
  get alive() { return this.state === 'alive'; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  has(skill) { return this.prog.skills.includes(skill); }
  forward() { return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); }
  msg(text, color, dur) { this.messages.push({ text, color: color || '#fff', t: dur || 3.5 }); if (this.messages.length > 5) this.messages.shift(); }

  spawnAt(x, z) {
    this.pos.set(x, FC.World.heightAt(x, z) + 0.1, z);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp; this.state = 'alive'; this.crouch = false; this.reviveProgress = 0; this.climbing = null; this.protectT = 3;
    if (this.vehicle) this.vehicle.exit(this);
  }

  damage(amount, fromX, fromZ, G, kind) {
    if (this.state !== 'alive' || G.godMode || this.protectT > 0) return;
    if (kind === 'fire' && this.has('firewalker')) amount *= 0.3;
    if (this.vehicle && kind !== 'explosion') amount *= 0.5;
    this.hp -= amount;
    this.lastHurt = G.time;
    this.shake = Math.max(this.shake, 0.25);
    if (fromX !== undefined) this.damageDirs.push({ a: FC.yawTo(fromX - this.pos.x, fromZ - this.pos.z), t: 1.2 });
    if (this.damageDirs.length > 6) this.damageDirs.shift();
    if (kind !== 'fire' || Math.random() < 0.1) FC.Audio.hurt();
    if (this.hp <= 0) {
      this.hp = 0;
      if (this.vehicle) this.vehicle.exit(this);
      this.climbing = null;
      const partner = G.players.find((p) => p !== this);
      if ((partner && partner.alive) || this.medkits > 0) {
        this.state = 'downed'; this.downTimer = partner && partner.alive ? 30 : 15; this.reviveProgress = 0; this.selfRevive = 0;
        if (partner && partner.alive) partner.msg(`${this.name} is down! Revive them!`, '#ff6b6b', 4);
        this.msg(this.medkits > 0 ? `Down! Hold [${this.ctrl.labels.interact}] to patch yourself up with a medkit` : 'You are down. Hang on for your partner.', '#ff6b6b', 5);
        this.rig.play('Death', { once: true });
      } else {
        this.state = 'dead'; this.respawnTimer = 5;
        this.rig.play('Death', { once: true });
        this.msg(G.players.length > 1 ? 'Squad down. Regrouping…' : 'You were killed.', '#ff6b6b', 5);
        if (partner && partner.state === 'downed') { partner.state = 'dead'; partner.respawnTimer = 5; }
      }
    }
  }

  update(dt, G) {
    const c = this.ctrl.poll(dt);
    this.input = c;
    const pr = c.pressed;
    if (this.menu && pr.back) { this.menu = null; FC.Audio.ui(); pr.pause = false; pr.map = false; }
    if (pr.pause) G.togglePause();
    this.hitmarker = Math.max(0, this.hitmarker - dt);
    this.killmarker = Math.max(0, this.killmarker - dt);
    this.shake = Math.max(0, this.shake - dt);
    this.chainT = Math.max(0, this.chainT - dt);
    for (const d of this.damageDirs) d.t -= dt;
    this.damageDirs = this.damageDirs.filter((d) => d.t > 0);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
    this.maxHp = G.diff.hp + (this.has('tough1') ? 25 : 0) + (this.has('tough2') ? 25 : 0);
    this.protectT = Math.max(0, (this.protectT || 0) - dt);

    if (pr.map) { this.menu = this.menu ? null : 'map'; FC.Audio.ui(); FC.Menus.open(this); }
    if (this.menu) {
      FC.Menus.update(this, c, dt, G);
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      this.updateCamera(dt, G); this.updateBody(dt, G);
      return;
    }

    const sensMul = this.aimT > 0.5 ? (FC.WEAPONS[this.weapon].scope ? 0.25 : 0.6) : 1;
    this.yaw -= c.lx * sensMul;
    this.pitch = FC.clamp(this.pitch - c.ly * sensMul, -1.45, 1.45);

    if (this.state === 'dead') {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) G.respawn(this);
      this.updateCamera(dt, G); this.updateBody(dt, G);
      return;
    }
    if (this.state === 'downed') {
      this.downTimer -= dt;
      if (c.interact && this.medkits > 0) {
        this.selfRevive = (this.selfRevive || 0) + dt / 1.6;
        if (this.selfRevive >= 1) {
          this.medkits--; this.state = 'alive'; this.hp = this.maxHp * 0.5; this.protectT = 3; this.selfRevive = 0;
          this.rig.play('Idle_Gun', { fade: 0.4 }); this.msg('Back on your feet', '#7bed9f'); FC.Audio.pickup();
          return;
        }
      } else this.selfRevive = Math.max(0, (this.selfRevive || 0) - dt);
      if (this.downTimer <= 0) { this.state = 'dead'; this.respawnTimer = 4; this.msg('You bled out.', '#ff6b6b'); }
      this.vel.set(0, 0, 0);
      this.updateCamera(dt, G); this.updateBody(dt, G);
      return;
    }

    if (this.vehicle) {
      this.vehicle.control(this, c, dt, G);
      if (this.seat > 0) this.updateWeapons(dt, c, G);
      if (pr.interact) { this.vehicle.exit(this); }
      this.updateCamera(dt, G); this.updateBody(dt, G);
      return;
    }

    if (pr.crouch) this.crouch = !this.crouch;
    const moving = Math.hypot(c.mx, c.my) > 0.1;
    if (c.sprint && c.my > 0.3) { this.sprint = true; this.crouch = false; }
    if (this.ctrl.padIndex >= 0) { if (pr.sprint) this.sprintToggle = true; if (!moving) this.sprintToggle = false; if (this.sprintToggle && c.my > 0.3) { this.sprint = true; this.crouch = false; } }
    if (!(c.sprint || this.sprintToggle) || c.my <= 0.3 || c.aim) this.sprint = false;

    if (this.climbing) { this.updateClimb(dt, c); this.updateCamera(dt, G); this.updateBody(dt, G); return; }

    this.updateWeapons(dt, c, G);
    this.updateInteract(dt, c, G);
    if (pr.tag) G.tag(this);
    if (pr.heal && this.medkits > 0 && this.hp < this.maxHp && this.healT <= 0) this.healT = 0.9;
    if (this.healT > 0) {
      this.healT -= dt;
      if (this.healT <= 0) { this.medkits--; this.hp = this.maxHp; this.msg('Patched up', '#7bed9f', 1.5); FC.Audio.pickup(); }
    }
    if (G.time - this.lastHurt > G.diff.regenDelay && this.hp < this.maxHp) {
      const cap = G.diff.fullRegen ? this.maxHp : Math.min(this.maxHp, Math.ceil(this.hp / 25) * 25);
      this.hp = Math.min(cap, this.hp + G.diff.regen * dt);
    }
    if (this.hp < this.maxHp * 0.3 && Math.random() < dt * 1.2) FC.Audio.heartbeat();

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
    const k = this.onGround || this.swimming ? Math.min(1, dt * 12) : Math.min(1, dt * 2);
    this.vel.x += (wx * spd - this.vel.x) * k;
    this.vel.z += (wz * spd - this.vel.z) * k;
    if (pr.jump && this.onGround && !this.swimming) { this.vel.y = 7; this.onGround = false; this.crouch = false; }
    this.vel.y -= 20 * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 760) { this.pos.x *= 760 / r; this.pos.z *= 760 / r; }
    W.collide(this.pos, 0.4, this.pos.y, this.crouch ? 1.2 : 1.8);
    let g = W.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.4);
    if (this.swimming) g = Math.max(g, -1.35);
    if (this.pos.y <= g) { this.pos.y = g; this.vel.y = 0; this.onGround = true; }
    else if (this.pos.y - g < 0.35 && this.vel.y <= 0) { this.pos.y = g; this.vel.y = 0; this.onGround = true; }
    else this.onGround = false;

    // ladder grab
    for (const L of W.ladders) {
      if (Math.hypot(L.x - this.pos.x, L.z - this.pos.z) < 0.9 && this.pos.y < L.y1 - 1 && c.my > 0.5) {
        this.climbing = L; this.vel.set(0, 0, 0); this.pos.x = L.x; this.pos.z = L.z; this.crouch = false;
        this.yaw = Math.PI; // face the ladder (towards -z)
        if (L.face === 0) this.yaw = 0;
        break;
      }
    }

    this.inBush = FC.Foliage.inBush(this.pos.x, this.pos.z);
    if (moving && this.onGround) {
      const before = Math.floor(this.walkPhase / Math.PI);
      this.walkPhase += dt * (this.sprint ? 13 : this.crouch ? 6 : 9);
      if (Math.floor(this.walkPhase / Math.PI) !== before) {
        const h = W.heightAt(this.pos.x, this.pos.z);
        const surf = h < 0.1 ? 'water' : this.pos.y > h + 0.3 ? 'wood' : h < 2.4 ? 'sand' : W.roadAt(this.pos.x, this.pos.z) > 0.4 || W.groundMaskAt(this.pos.x, this.pos.z) > 0.5 ? 'gravel' : W.slopeAt(this.pos.x, this.pos.z) > 0.7 ? 'stone' : 'grass';
        FC.Audio.step(surf, this.crouch ? 0.35 : this.sprint ? 1.2 : 0.8);
      }
    }
    this.updateCamera(dt, G);
    this.updateBody(dt, G);
  }

  updateClimb(dt, c) {
    const L = this.climbing;
    this.pos.y += c.my * 3.2 * dt;
    this.walkPhase += Math.abs(c.my) * dt * 8;
    if (this.pos.y <= L.y0) { this.pos.y = L.y0; if (c.my < 0) { this.climbing = null; this.pos.z += 0.8; } }
    if (this.pos.y >= L.y1 - 0.2) {
      this.pos.set(L.exit.x, L.y1, L.exit.z);
      this.climbing = null; this.vel.set(0, 0, 0);
    }
    if (c.pressed.jump) { this.climbing = null; this.pos.z += 0.8; }
  }

  updateWeapons(dt, c, G) {
    const pr = c.pressed;
    const owned = FC.WEAPON_ORDER.filter((k) => this.owned.has(k));
    let want = null;
    for (let i = 0; i < 6; i++) if (pr['slot' + i] && this.owned.has(FC.WEAPON_ORDER[i])) want = FC.WEAPON_ORDER[i];
    const cur = owned.indexOf(this.weapon);
    if (pr.next) want = owned[(cur + 1) % owned.length];
    if (pr.prev) want = owned[(cur - 1 + owned.length) % owned.length];
    if (want && want !== this.weapon) { this.weapon = want; this.reloadT = 0; this.switchT = 0.35; FC.Audio.click(); }
    this.switchT = Math.max(0, this.switchT - dt);
    const w = FC.WEAPONS[this.weapon], a = this.ammo[this.weapon];
    const canUse = !this.swimming && !this.sprint && this.switchT <= 0 && this.healT <= 0 && !(this.vehicle && this.seat === 0);
    this.aimT = FC.clamp(this.aimT + (c.aim && canUse && !w.throwable ? 1 : -1) * dt * (w.scope ? 5 : 7), 0, 1);
    this.fireCd -= dt;
    const steady = this.has('steady') ? 0.65 : 1;
    this.recoil *= Math.max(0, 1 - dt * 8);
    this.kick *= Math.max(0, 1 - dt * 12);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const got = Math.min(w.mag - a.mag, a.reserve); a.mag += got; a.reserve -= got; }
      return;
    }
    if (!w.throwable && (pr.reload || (a.mag === 0 && (c.fire || pr.fire))) && a.mag < w.mag && a.reserve > 0) {
      this.reloadT = w.reload * (this.has('fasthands') ? 0.7 : 1); FC.Audio.reload(); return;
    }
    const trigger = w.auto ? c.fire : pr.fire;
    if (trigger && canUse && this.fireCd <= 0) {
      if (a.mag <= 0) { if (pr.fire) FC.Audio.dry(); return; }
      this.fireCd = w.rate;
      a.mag--;
      if (w.throwable) { G.throwProjectile(this, w.throwable); this.kick = 0.4; }
      else {
        G.playerShoot(this, w);
        this.recoil += w.recoil * steady; this.kick = 1;
        this.pitch = Math.min(1.45, this.pitch + w.recoil * steady * (this.aimT > 0.5 ? 0.5 : 1));
        this.yaw += (Math.random() - 0.5) * w.recoil * steady * 0.6;
        this.flash.visible = true; this.flashT = 0.05;
        this.firedT = 0.25;
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
        partner.reviveProgress += dt / (this.has('medic') ? 1.1 : 2.2);
        if (partner.reviveProgress >= 1) {
          partner.state = 'alive'; partner.hp = this.has('medic') ? 75 : 50; partner.reviveProgress = 0;
          partner.rig.play('Idle_Gun', { fade: 0.5 });
          partner.msg(`${this.name} got you back up!`, '#7bed9f'); this.msg(`Revived ${partner.name}`, '#7bed9f');
          this.stats.revives++; FC.Progression.xp(this, 20, 'Revive', G); FC.Audio.pickup();
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
    const v = G.vehicleNear(this);
    if (v) {
      this.prompt = `[${L.interact}] ${v.seats[0] ? 'Ride shotgun' : 'Drive'}`;
      if (c.pressed.interact) v.enter(this);
      return;
    }
    for (const op of FC.World.outposts) {
      if (!op.liberated && op.alarm && !op.alarmSabotaged && !op.alarmTriggered && Math.hypot(op.alarm.x - this.pos.x, op.alarm.z - this.pos.z) < 2.4) {
        this.prompt = `[${L.interact}] Sabotage alarm`;
        if (c.pressed.interact) {
          op.alarmSabotaged = true;
          op.alarm.bulb.material.emissive.set(0x000000);
          G.announce(`Alarm at ${op.name} sabotaged`, '#7bed9f');
          FC.Progression.xp(this, 30, 'Sabotage', G);
          FC.Audio.click();
        }
        return;
      }
    }
    for (const t of FC.World.towers) {
      if (!t.hacked && Math.hypot(t.console.x - this.pos.x, t.console.z - this.pos.z) < 2.2 && Math.abs(this.pos.y - t.console.y) < 1.5) {
        this.prompt = `Hold [${L.interact}] Hack relay`;
        if (c.interact) { t.hackT = (t.hackT || 0) + dt; if (t.hackT > 2) G.hackTower(t, this); }
        else t.hackT = 0;
        return;
      }
    }
    for (const col of G.collectibles) {
      if (!col.taken && Math.hypot(col.x - this.pos.x, col.z - this.pos.z) < 2 && Math.abs(col.y - this.pos.y) < 2) {
        this.prompt = `[${L.interact}] Take Tide Ledger`;
        if (c.pressed.interact) G.takeCollectible(col, this);
        return;
      }
    }
    for (const s of G.shopPoints()) {
      if (Math.hypot(s.x - this.pos.x, s.z - this.pos.z) < 2.6) {
        this.prompt = `[${L.interact}] Trade & resupply`;
        if (c.pressed.interact) { this.menu = 'shop'; G.flags.shopped = true; FC.Menus.open(this); FC.Audio.ui(); }
        return;
      }
    }
  }

  updateCamera(dt, G) {
    if (this.vehicle && this.seat === 0) { this.vehicle.driverCamera(this, dt); return; }
    const target = this.state === 'downed' ? 0.4 : this.state === 'dead' ? 0.3 : this.vehicle ? 1.9 : this.swimming ? 1.45 : this.crouch ? 1.05 : 1.65;
    this.eyeH += (target - this.eyeH) * Math.min(1, dt * 10);
    const bobA = this.onGround && this.speed > 0.5 && !this.vehicle ? (this.sprint ? 0.07 : 0.035) : 0;
    const bob = Math.sin(this.walkPhase) * bobA;
    const sh = this.shake * 0.25;
    let px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    if (this.vehicle) { const s = this.vehicle.seatWorld(this.seat); px = s.x; py = s.y - 1.1; pz = s.z; }
    this.cam.position.set(px + (Math.random() - 0.5) * sh, py + this.eyeH + bob + (Math.random() - 0.5) * sh, pz);
    this.cam.rotation.set(this.pitch - this.lunge * 0.3, this.yaw, this.state === 'downed' ? 0.3 : 0);
    this.lunge = Math.max(0, this.lunge - dt * 3);
    const w = FC.WEAPONS[this.weapon];
    const hfov = 92 / (1 + (w.zoom - 1) * this.aimT);
    this.setFov(hfov);
    const showVm = this.state === 'alive' && !this.climbing && !this.menu;
    for (const k in this.vm) this.vm[k].visible = showVm && k === this.weapon && (!w.throwable || this.ammo[k].mag > 0) && !(w.scope && this.aimT > 0.85);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    const a = this.aimT;
    const swayX = Math.cos(this.walkPhase * 0.5) * bobA * 0.5, swayY = Math.abs(Math.sin(this.walkPhase)) * bobA * 0.4;
    const lower = (this.sprint ? 0.12 : 0) + (this.swimming ? 0.35 : 0) + (this.reloadT > 0 ? 0.12 : 0) + this.switchT * 0.5 + (this.healT > 0 ? 0.3 : 0);
    const g = this.vm[this.weapon];
    g.position.set(FC.lerp(0.3, 0, a) + swayX, FC.lerp(-0.3, w.scope ? -0.2 : -0.13, a) - swayY - lower, FC.lerp(-0.42, -0.32, a) + this.kick * 0.05);
    g.rotation.set(this.kick * 0.08 + (this.reloadT > 0 ? 0.5 : 0), this.sprint ? 0.5 : 0, this.reloadT > 0 ? 0.4 : 0);
    const m = this.muzzle[this.weapon];
    if (m) { this.flash.position.set(m[0], m[1], m[2]).applyEuler(g.rotation).add(g.position); }
  }
  setFov(hfov) {
    const vfov = FC.clamp((2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / this.cam.aspect) * 180) / Math.PI, 12, 82);
    if (Math.abs(this.cam.fov - vfov) > 0.01) { this.cam.fov = vfov; this.cam.updateProjectionMatrix(); }
  }

  // third-person body seen by the partner (and shadows)
  updateBody(dt, G) {
    const r = this.rig;
    r.root.visible = !(this.vehicle && this.seat === 0 && false);
    if (this.vehicle) {
      const s = this.vehicle.seatWorld(this.seat);
      r.root.position.set(s.x, s.y - 0.95, s.z);
      r.root.rotation.set(0, this.vehicle.yaw, 0);
      r.play('Idle_Neutral');
    } else {
      r.root.position.copy(this.pos);
      r.root.rotation.set(0, this.yaw, 0);
      if (this.state !== 'alive') { /* death clip already playing */ }
      else if (this.climbing) r.play('Run', { speed: 0.5 });
      else if (this.swimming) r.play('Run', { speed: 0.4 });
      else {
        const sp = this.speed, shooting = (this.firedT || 0) > 0;
        this.firedT = Math.max(0, (this.firedT || 0) - dt);
        if (sp < 0.5) r.play(shooting || this.aimT > 0.3 ? 'Idle_Gun_Shoot' : 'Idle_Gun');
        else if (sp < 6.5) r.play(shooting ? 'Run_Shoot' : 'Walk', { speed: sp / 3.2 });
        else r.play('Run', { speed: sp / 7 });
      }
      r.model.position.y = this.crouch && this.alive ? -0.35 : 0;
    }
    r.update(dt, 0);
    // weapon in hand
    if (r.hand && this.alive) {
      r.root.updateMatrixWorld(true);
      const hp = r.hand.getWorldPosition(new THREE.Vector3());
      r.root.worldToLocal(hp);
      this.gun.position.copy(hp);
      this.gun.rotation.set(-this.pitch * 0.6, 0, 0);
      this.gun.visible = true;
    } else this.gun.visible = false;
  }
};
