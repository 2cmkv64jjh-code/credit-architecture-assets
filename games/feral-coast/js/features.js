'use strict';
// Gameplay systems layered on the core: bow arrows, rebel garrisons, Tide counter-attacks, enemy grenades.
FC.Features = (function () {
  let scene = null;
  const arrowGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.75, 5); arrowGeo.rotateX(Math.PI / 2);
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7 });
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

  function init(sc) { scene = sc; }

  // ---------------------------------------------------------------- arrows (silent, ballistic)
  function fireArrow(G, p, draw) {
    const o = p.cam.getWorldPosition(new THREE.Vector3());
    const d = p.forward();
    const spread = FC.lerp(0.012, 0.002, p.aimT) * (1.2 - draw);
    d.x += FC.rand(-spread, spread); d.y += FC.rand(-spread, spread); d.normalize();
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    mesh.position.copy(o);
    scene.add(mesh);
    G.arrows.push({ pos: o.clone().addScaledVector(d, 0.5), vel: d.multiplyScalar(38 + 62 * draw), owner: p, draw, mesh, t: 0, stuck: false });
  }
  function updateArrows(dt, G) {
    for (let i = G.arrows.length - 1; i >= 0; i--) {
      const a = G.arrows[i];
      a.t += dt;
      if (a.stuck) { if (a.t > 25) { scene.remove(a.mesh); G.arrows.splice(i, 1); } continue; }
      a.vel.y -= 9.8 * dt;
      const step = a.vel.length() * dt;
      const dir = v1.copy(a.vel).normalize();
      // entities along this step
      let best = step, hit = null, head = false;
      for (const e of G.enemies) {
        if (!e.alive || e.dormant) continue;
        if (Math.abs(e.pos.x - a.pos.x) > step + 3 || Math.abs(e.pos.z - a.pos.z) > step + 3) continue;
        const sc = e.def.scale || 1, hp = e.headPos;
        let t = FC.raySphere(a.pos.x, a.pos.y, a.pos.z, dir.x, dir.y, dir.z, hp.x, hp.y, hp.z, 0.26 * sc);
        if (t < best) { best = t; hit = e; head = true; }
        t = FC.rayCyl(a.pos.x, a.pos.y, a.pos.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.z, 0.38 * sc, e.pos.y, e.pos.y + 1.5 * sc);
        if (t < best) { best = t; hit = e; head = false; }
      }
      for (const an of G.animals) {
        if (!an.alive || Math.abs(an.pos.x - a.pos.x) > step + 3 || Math.abs(an.pos.z - a.pos.z) > step + 3) continue;
        const t = FC.raySphere(a.pos.x, a.pos.y, a.pos.z, dir.x, dir.y, dir.z, an.pos.x, an.pos.y + an.rig.size.h * 0.55, an.pos.z, Math.max(0.45, an.rig.size.len * 0.35));
        if (t < best) { best = t; hit = an; head = false; }
      }
      const world = FC.World.raycast(a.pos.x, a.pos.y, a.pos.z, dir.x, dir.y, dir.z, step);
      if (hit && best <= world.t) {
        const dmg = (55 + 95 * a.draw) * (head ? 3 : 1);
        const was = hit.alive;
        hit.damage(G, dmg, a.owner, head);
        FC.FX.impact(a.pos.x + dir.x * best, a.pos.y + dir.y * best, a.pos.z + dir.z * best, 'blood');
        a.owner.hitmarker = 0.15;
        if (was && !hit.alive) { a.owner.killmarker = 0.3; FC.Audio.kill(); if (head && hit instanceof FC.Enemy) a.owner.msg('Silent headshot', '#ffd166', 1.2); }
        else FC.Audio.hit();
        // the victim notices (if alive), nobody else hears the bow
        scene.remove(a.mesh); G.arrows.splice(i, 1);
        if (Math.random() < 0.5) dropArrow(G, hit.pos);
        continue;
      }
      if (world.t <= step || a.t > 6) {
        const tt = Math.min(world.t, step);
        a.pos.addScaledVector(dir, tt);
        a.stuck = true; a.t = 0;
        a.mesh.position.copy(a.pos);
        FC.Audio.impact(a.pos);
        G.noise(a.pos, 7, a.owner); // a thunk nearby makes guards curious, not alarmed
        continue;
      }
      a.pos.addScaledVector(dir, step);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(v2.copy(a.pos).add(dir));
    }
  }
  function dropArrow(G, pos) {
    const m = new THREE.Mesh(arrowGeo, arrowMat);
    m.position.set(pos.x + FC.rand(-0.5, 0.5), pos.y + 0.2, pos.z + FC.rand(-0.5, 0.5));
    m.rotation.y = Math.random() * 6;
    scene.add(m);
    G.pickups.push({ kind: 'arrow', mesh: m, pos: m.position, t: 120, value: 0 });
  }

  // ---------------------------------------------------------------- rebel garrison
  const ALLY_TINT = { Green: 0x2f5b3c, LightGreen: 0x23b38a, Brown: 0x3b3326, Brown2: 0x2b251c };
  class Ally {
    constructor(op, x, z) {
      this.op = op; this.isAlly = true;
      this.pos = new THREE.Vector3(x, FC.World.heightAt(x, z), z);
      this.home = { x, z };
      this.yaw = Math.random() * 6; this.hp = 160; this.alive = true; this.deadT = 0;
      this.eyeH = 1.6; this.crouch = false; this.inBush = false; this.vehicle = null; this.index = undefined;
      this.target = null; this.losT = 0; this.fireT = FC.rand(0.5, 1.5); this.moveTo = null; this.idleT = FC.rand(2, 6); this.speedNow = 0;
      this.rig = new FC.Rig('rebel1', { height: FC.rand(1.74, 1.86), tint: ALLY_TINT });
      this.gun = FC.GunProps.rifle(); this.rig.root.add(this.gun);
      scene.add(this.rig.root);
      this.rig.play('Idle_Gun');
    }
    get speed() { return this.speedNow; }
    has() { return false; }
    damage(amount) {
      if (!this.alive) return;
      this.hp -= amount;
      if (this.hp <= 0) { this.alive = false; this.deadT = 0; this.rig.play('Death', { once: true, fade: 0.1 }); this.gun.visible = false; }
    }
    update(dt, G, nearest) {
      const r = this.rig;
      if (!this.alive) { this.deadT += dt; r.update(dt, nearest); return; }
      if (nearest > 300) { r.root.visible = false; return; }
      r.root.visible = true;
      if (this.hp < 160) this.hp = Math.min(160, this.hp + 3 * dt);
      // pick a target: nearest visible militia within 70 m
      this.losT -= dt;
      if (this.losT <= 0) {
        this.losT = FC.rand(0.3, 0.5);
        let best = null, bd = 70;
        for (const e of G.enemies) {
          if (!e.alive || e.dormant || e.state === 'ride') continue;
          const d = e.pos.distanceTo(this.pos);
          if (d < bd && FC.World.los(this.pos.x, this.pos.y + 1.6, this.pos.z, e.pos.x, e.pos.y + 1.4, e.pos.z)) { bd = d; best = e; }
        }
        this.target = best;
      }
      let speed = 0;
      if (this.target && this.target.alive) {
        const t = this.target, d = t.pos.distanceTo(this.pos);
        this.yaw = FC.turnTowards(this.yaw, FC.yawTo(t.pos.x - this.pos.x, t.pos.z - this.pos.z), dt * 5);
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = FC.rand(0.45, 1.1);
          const muzzle = this.gun.localToWorld(new THREE.Vector3(0, 0.02, -0.7));
          const aim = t.chest;
          const hit = Math.random() < FC.clamp(0.55 - d / 160, 0.12, 0.5);
          if (!hit) { aim.x += FC.rand(-1.2, 1.2); aim.y += FC.rand(-0.4, 1); aim.z += FC.rand(-1.2, 1.2); }
          FC.FX.muzzle(muzzle.x, muzzle.y, muzzle.z); FC.FX.tracer(muzzle, aim);
          FC.Audio.shot('rifle', G.volumeAt(this.pos, 200) * 0.7, this.pos);
          this.firedT = 0.4;
          if (hit) t.damage(G, 22, null, false);
          else if (t.state === 'patrol' || t.state === 'suspicious') t.setAlert(G, this.pos);
        }
      } else {
        // idle about the outpost
        if (this.idleT > 0) this.idleT -= dt;
        else {
          if (!this.moveTo) { const pt = this.op.patrol.length ? FC.pick(this.op.patrol) : this.home; this.moveTo = { x: pt.x, z: pt.z }; }
          const dx = this.moveTo.x - this.pos.x, dz = this.moveTo.z - this.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.6) { this.moveTo = null; this.idleT = FC.rand(4, 12); }
          else {
            speed = 1.5;
            this.pos.x += (dx / d) * speed * dt; this.pos.z += (dz / d) * speed * dt;
            FC.World.collide(this.pos, 0.42, this.pos.y, 1.8);
            this.yaw = FC.turnTowards(this.yaw, FC.yawTo(dx, dz), dt * 5);
          }
        }
      }
      this.speedNow = speed;
      this.pos.y = FC.World.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.42);
      r.root.position.copy(this.pos); r.root.rotation.set(0, this.yaw, 0);
      this.firedT = Math.max(0, (this.firedT || 0) - dt);
      if (speed > 0) r.play('Walk', { speed: speed / 1.6 }); else r.play(this.firedT > 0 ? 'Idle_Gun_Shoot' : this.target ? 'Idle_Gun_Pointing' : 'Idle_Gun');
      r.update(dt, nearest);
      if (r.hand && nearest < 120) { r.root.updateMatrixWorld(true); const hp = r.hand.getWorldPosition(new THREE.Vector3()); r.root.worldToLocal(hp); this.gun.position.copy(hp); }
    }
  }
  function garrison(G, op, n) {
    for (let i = 0; i < (n || 3); i++) {
      const p = FC.World.landPoint(op.x, op.z, 3, op.r * 0.6);
      G.allies.push(new Ally(op, p.x, p.z));
    }
  }

  // ---------------------------------------------------------------- counter-attacks
  function updateDefense(dt, G) {
    const lib = FC.World.outposts.filter((o) => o.liberated && !o.boss);
    if (!G.defend) {
      if (!lib.length) return;
      G.counterT = (G.counterT === undefined ? 300 : G.counterT) - dt;
      if (G.counterT > 0) return;
      G.counterT = FC.rand(360, 540);
      const near = lib.filter((o) => G.players.some((p) => Math.hypot(p.pos.x - o.x, p.pos.z - o.z) < 450));
      if (!near.length) return;
      const op = FC.pick(near);
      const attackers = [];
      const dir = Math.random() * Math.PI * 2;
      const n = 4 + Math.min(3, Math.floor(lib.length / 2));
      for (let i = 0; i < n; i++) {
        const sp = FC.World.landPoint(op.x + Math.cos(dir) * 75, op.z + Math.sin(dir) * 75, 0, 14);
        const e = new FC.Enemy(i === 0 && lib.length > 3 ? 'heavy' : 'grunt', sp.x, sp.z, null, scene);
        e.state = 'alert'; e.lastKnown = new THREE.Vector3(op.x, op.y, op.z); e.aimT = 1; e.attacker = true;
        G.enemies.push(e); attackers.push(e);
      }
      G.defend = { op, attackers, t: 0 };
      G.announce(`COUNTER-ATTACK — the Tide is moving on ${op.name}! Defend it`, '#ff9f43', 6);
      FC.Missions.say('Ama Reyes', `They're hitting ${op.name}. Get there and help our people hold it!`);
      FC.Audio.siren(0.4);
      return;
    }
    const D = G.defend;
    D.t += dt;
    // attackers who have lost interest keep pushing toward the outpost
    for (const e of D.attackers) if (e.alive && e.state !== 'alert' && e.state !== 'alarm') { e.state = 'alert'; e.lastKnown = new THREE.Vector3(D.op.x, D.op.y, D.op.z); e.lostT = 0; }
    if (D.attackers.every((e) => !e.alive)) {
      G.announce(`${D.op.name} held!`, '#3fd0c9', 5);
      for (const p of G.players) { FC.Progression.xp(p, 150, 'Outpost defended', G); FC.Progression.cash(p, 120, 'Defense bounty', G); }
      FC.Audio.liberate();
      // reinforce the garrison
      const alive = G.allies.filter((a) => a.op === D.op && a.alive).length;
      if (alive < 3) garrison(G, D.op, 3 - alive);
      G.defend = null;
    } else if (D.t > 240 && G.players.every((p) => Math.hypot(p.pos.x - D.op.x, p.pos.z - D.op.z) > 500)) {
      for (const e of D.attackers) if (e.alive) { e.alive = false; e.rig.root.visible = false; e.deadT = 999; }
      G.announce(`The garrison drove the Tide back from ${D.op.name}`, '#9be7a1', 4);
      G.defend = null;
    }
  }

  // ---------------------------------------------------------------- enemy grenades
  function enemyGrenade(G, e, target) {
    const from = new THREE.Vector3(e.pos.x, e.pos.y + 1.7, e.pos.z);
    const dx = target.x - from.x, dz = target.z - from.z, dy = target.y - from.y;
    const D = Math.hypot(dx, dz), T = 1.0 + D / 28;
    const vel = new THREE.Vector3(dx / T, (dy + 0.5 * 16 * T * T) / T, dz / T);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3e4a2a }));
    mesh.position.copy(from); scene.add(mesh);
    G.projectiles.push({ kind: 'grenade', pos: from, vel, mesh, owner: e, t: 0, fuse: T + 1.2, enemy: true });
    G.subtitle(e, FC.pick(['Grenade out!', 'Flush them out!', 'Frag!']));
    FC.Audio.whoosh(G.volumeAt(e.pos, 60));
  }

  function update(dt, G) {
    updateArrows(dt, G);
    for (const a of G.allies) a.update(dt, G, G.nearestPlayerDist(a.pos));
    for (let i = G.allies.length - 1; i >= 0; i--) {
      const a = G.allies[i];
      if (!a.alive && a.deadT > 90) {
        scene.remove(a.rig.root); G.allies.splice(i, 1);
        if (a.op.liberated && !(G.defend && G.defend.op === a.op)) garrison(G, a.op, 1);
      }
    }
    updateDefense(dt, G);
  }

  return { init, update, fireArrow, garrison, enemyGrenade, Ally };
})();
