'use strict';
// Rapier physics (https://rapier.rs): terrain heightfield + static building colliders, used for
// bodies thrown by explosions / vehicles (the death animation plays while the physics body tumbles),
// explosion debris, and vehicle wrecks flipping through the air.
FC.Physics = (function () {
  const P = { ready: false, world: null, items: [] };
  let R = null, acc = 0;
  const STEP = 1 / 60;
  const q = new THREE.Quaternion(), v = new THREE.Vector3(), off = new THREE.Vector3();

  async function init() {
    if (!window.RAPIER) return;
    try {
      R = window.RAPIER;
      await R.init();
      P.world = new R.World({ x: 0, y: -9.81, z: 0 });
      const W = FC.World, n = 256, size = W.SIZE;
      const heights = new Float32Array((n + 1) * (n + 1));
      for (let col = 0; col <= n; col++) {
        for (let row = 0; row <= n; row++) {
          const x = -size / 2 + (col / n) * size, z = -size / 2 + (row / n) * size;
          heights[col * (n + 1) + row] = W.heightAt(x, z);
        }
      }
      P.world.createCollider(R.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setFriction(0.9));
      for (const b of W.boxes) {
        const hx = (b.maxX - b.minX) / 2, hy = (b.maxY - b.minY) / 2, hz = (b.maxZ - b.minZ) / 2;
        if (hx <= 0 || hy <= 0 || hz <= 0) continue;
        P.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(b.minX + hx, b.minY + hy, b.minZ + hz));
      }
      P.ready = true;
    } catch (e) { console.warn('Physics unavailable', e); P.ready = false; }
  }

  // obj = THREE.Object3D whose origin is at the feet; shape = capsule (radius r, total height h)
  function throwBody(obj, pos, impulse, r, h, life) {
    if (!P.ready) return null;
    const half = Math.max(0.05, h / 2 - r);
    const oq = obj.quaternion;
    const body = P.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + h / 2 + 0.05, pos.z).setRotation({ x: oq.x, y: oq.y, z: oq.z, w: oq.w }).setLinearDamping(0.25).setAngularDamping(0.8).setCcdEnabled(true));
    P.world.createCollider(R.ColliderDesc.capsule(half, r).setDensity(1.2).setFriction(0.8).setRestitution(0.1), body);
    // 'impulse' is a launch velocity (m/s); spin scales with it
    body.setLinvel(impulse, true);
    const sp = Math.min(6, Math.hypot(impulse.x, impulse.y, impulse.z) * 0.5);
    body.setAngvel({ x: FC.rand(-1, 1) * sp, y: FC.rand(-1, 1) * 1.5, z: FC.rand(-1, 1) * sp }, true);
    const it = { body, obj, half: h / 2, life: life || 5, t: 0 };
    P.items.push(it);
    return it;
  }
  const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  function debris(pos, n, mat, force) {
    if (!P.ready) return;
    for (let i = 0; i < n; i++) {
      const s = FC.rand(0.15, 0.45);
      const m = new THREE.Mesh(debrisGeo, mat); m.scale.set(s, s * FC.rand(0.4, 1), s * FC.rand(0.6, 1.4)); m.castShadow = true;
      FC.Physics.scene.add(m);
      const body = P.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x + FC.rand(-0.5, 0.5), pos.y + 1 + FC.rand(0, 0.8), pos.z + FC.rand(-0.5, 0.5)).setAngularDamping(0.3));
      P.world.createCollider(R.ColliderDesc.cuboid(s / 2, s * 0.35, s / 2).setDensity(0.6).setRestitution(0.3), body);
      const f = force || 6;
      body.setLinvel({ x: FC.rand(-1, 1) * f, y: FC.rand(0.8, 1.6) * f, z: FC.rand(-1, 1) * f }, true);
      body.setAngvel({ x: FC.rand(-8, 8), y: FC.rand(-8, 8), z: FC.rand(-8, 8) }, true);
      P.items.push({ body, obj: m, half: 0, life: FC.rand(6, 10), t: 0, temp: true });
    }
  }
  function wreck(vehicle, impulseY) {
    if (!P.ready) return;
    const body = P.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(vehicle.pos.x, vehicle.pos.y + 1, vehicle.pos.z)
      .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(vehicle.pitch, vehicle.yaw, vehicle.roll, 'YXZ'))).setAngularDamping(0.4));
    P.world.createCollider(R.ColliderDesc.cuboid(vehicle.wid / 2, 0.7, vehicle.len / 2).setDensity(0.5).setFriction(0.7), body);
    const f = impulseY || 9;
    body.setLinvel({ x: FC.rand(-1, 1) * 2 + vehicle.forward().x * vehicle.speed * 0.6, y: f, z: FC.rand(-1, 1) * 2 + vehicle.forward().z * vehicle.speed * 0.6 }, true);
    body.setAngvel({ x: FC.rand(-1, 1) * 2.5, y: FC.rand(-1, 1) * 1, z: FC.rand(-1, 1) * 2.5 }, true);
    P.items.push({ body, obj: vehicle.group, half: 1, life: 7, t: 0, vehicle });
  }

  function update(dt) {
    if (!P.ready || !P.items.length) { acc = 0; return; }
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 3) { P.world.step(); acc -= STEP; steps++; }
    if (steps === 3) acc = 0;
    for (let i = P.items.length - 1; i >= 0; i--) {
      const it = P.items[i];
      it.t += dt;
      const t = it.body.translation(), r = it.body.rotation();
      q.set(r.x, r.y, r.z, r.w);
      off.set(0, -it.half, 0).applyQuaternion(q);
      it.obj.position.set(t.x + off.x, t.y + off.y, t.z + off.z);
      if (!it.temp) it.obj.quaternion.copy(q);
      else it.obj.quaternion.copy(q);
      if (it.vehicle) { it.vehicle.pos.set(t.x, t.y - 1, t.z); }
      if (it.t > it.life || (it.t > 1.5 && it.body.isSleeping())) {
        if (it.temp) FC.Physics.scene.remove(it.obj);
        if (it.onDone) it.onDone(it.obj.position);
        P.world.removeRigidBody(it.body);
        P.items.splice(i, 1);
      }
    }
  }
  return Object.assign(P, { init, throwBody, debris, wreck, update });
})();
