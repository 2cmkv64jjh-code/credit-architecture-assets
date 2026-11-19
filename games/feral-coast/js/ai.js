'use strict';
// Combat AI: cover points generated around every structure, cover selection (protected from the target,
// able to peek over low cover, some soldiers deliberately flank), a peek-and-shoot cycle, and Yuka
// (https://github.com/Mugen87/yuka) steering — arrive + separation + obstacle avoidance — for moving under fire.
FC.AI = (function () {
  const CG = 16, grid = new Map();
  let built = false;
  const obstaclesByCell = new Map();

  function build() {
    if (built) return;
    built = true;
    const W = FC.World;
    for (const b of W.boxes) {
      const h = b.maxY - b.minY, w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      if (h < 0.8 || w > 30 || d > 30) continue;
      const pts = [];
      for (let x = b.minX + 0.4; x <= b.maxX - 0.4; x += 1.4) { pts.push([x, b.minZ - 0.7, 0, -1]); pts.push([x, b.maxZ + 0.7, 0, 1]); }
      for (let z = b.minZ + 0.4; z <= b.maxZ - 0.4; z += 1.4) { pts.push([b.minX - 0.7, z, -1, 0]); pts.push([b.maxX + 0.7, z, 1, 0]); }
      for (const [x, z, nx, nz] of pts) {
        if (W.pointBlocked(x, z, 0.25)) continue;
        const y = W.heightAt(x, z);
        if (Math.abs(y - b.minY) > 1.2) continue;
        const k = Math.floor(x / CG) * 8192 + Math.floor(z / CG);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push({ x, z, y, h, nx, nz, low: h < 1.6, taken: null });
      }
      // Yuka obstacle per structure
      if (window.YUKA) {
        const ob = new YUKA.GameEntity();
        ob.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
        ob.boundingRadius = Math.hypot(w, d) / 2;
        const k = Math.floor(ob.position.x / CG) * 8192 + Math.floor(ob.position.z / CG);
        if (!obstaclesByCell.has(k)) obstaclesByCell.set(k, []);
        obstaclesByCell.get(k).push(ob);
      }
    }
  }
  function near(map, x, z, r, cb) {
    for (let i = Math.floor((x - r) / CG); i <= Math.floor((x + r) / CG); i++) {
      for (let j = Math.floor((z - r) / CG); j <= Math.floor((z + r) / CG); j++) {
        const arr = map.get(i * 8192 + j);
        if (arr) for (const o of arr) cb(o);
      }
    }
  }

  function pickCover(e, t) {
    const W = FC.World;
    const tEye = { x: t.pos.x, y: t.pos.y + (t.eyeH || 1.6), z: t.pos.z };
    const toT = FC.yawTo(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    let best = null, bs = 1e9, checks = 0;
    near(grid, e.pos.x, e.pos.z, 22, (c) => {
      if (checks > 40) return;
      if (c.taken && c.taken !== e && c.taken.alive) return;
      const de = Math.hypot(c.x - e.pos.x, c.z - e.pos.z);
      if (de > 22) return;
      const dt = Math.hypot(c.x - tEye.x, c.z - tEye.z);
      if (dt < 7 || dt > 55) return;
      // the box must sit between the point and the target
      const facing = (c.nx * (c.x - tEye.x) + c.nz * (c.z - tEye.z)) / dt;
      if (facing < 0.35) return;
      checks++;
      if (W.los(c.x, c.y + 0.95, c.z, tEye.x, tEye.y, tEye.z)) return;            // crouched: hidden
      if (c.low && !W.los(c.x, c.y + 1.65, c.z, tEye.x, tEye.y, tEye.z)) return;  // standing: can shoot over
      let score = de + Math.abs(dt - 22) * 0.4;
      if (e.flanker) { const ang = Math.abs(FC.wrapAngle(FC.yawTo(c.x - tEye.x, c.z - tEye.z) - (toT + Math.PI))); score -= Math.min(ang, 1.6) * 10; }
      if (!c.low) score += 6;
      if (score < bs) { bs = score; best = c; }
    });
    if (best) { if (e.cover && e.cover.taken === e) e.cover.taken = null; best.taken = e; }
    return best;
  }

  // Yuka steering towards (tx, tz): arrive + separation from squadmates + avoidance of buildings
  function steer(e, tx, tz, speed, dt, G) {
    if (!window.YUKA) return e.walk(dt, tx, tz, speed);
    let yv = e.yv;
    if (!yv) {
      yv = e.yv = new YUKA.Vehicle();
      yv.boundingRadius = 0.5; yv.mass = 1; yv.maxForce = 30;
      yv._target = new YUKA.Vector3();
      yv._arrive = new YUKA.ArriveBehavior(yv._target, 2.2, 0.6);
      yv._sep = new YUKA.SeparationBehavior(); yv._sep.weight = 1.6;
      yv._obs = new YUKA.ObstacleAvoidanceBehavior([]); yv._obs.weight = 3; yv._obs.dBoxMinLength = 3;
      yv.steering.add(yv._arrive); yv.steering.add(yv._sep); yv.steering.add(yv._obs);
    }
    yv.maxSpeed = speed;
    yv.position.set(e.pos.x, 0, e.pos.z);
    yv._target.set(tx, 0, tz);
    yv.neighbors.length = 0;
    for (const o of G.enemies) if (o !== e && o.alive && o.yv && Math.abs(o.pos.x - e.pos.x) < 4 && Math.abs(o.pos.z - e.pos.z) < 4) yv.neighbors.push(o.yv);
    const obs = []; near(obstaclesByCell, e.pos.x, e.pos.z, 12, (o) => obs.push(o)); yv._obs.obstacles = obs;
    yv.update(dt);
    const nx = yv.position.x, nz = yv.position.z;
    if (FC.World.heightAt(nx, nz) < 0.2) { e.speedNow = 0; return true; }
    const moved = Math.hypot(nx - e.pos.x, nz - e.pos.z);
    e.pos.x = nx; e.pos.z = nz;
    FC.World.collide(e.pos, 0.42, e.pos.y, 1.8);
    yv.position.set(e.pos.x, 0, e.pos.z);
    e.speedNow = moved / Math.max(dt, 1e-4);
    if (moved > 0.01) e.yaw = FC.turnTowards(e.yaw, FC.yawTo(yv.velocity.x, yv.velocity.z), dt * 6);
    return Math.hypot(tx - e.pos.x, tz - e.pos.z) < 0.7;
  }

  // Called while an alerted soldier can see its target. Returns true when the AI handled movement.
  function combatMove(e, t, dt, G) {
    if (e.type === 'boss' || e.def.sniper) return false;
    build();
    if (e.flanker === undefined) e.flanker = Math.random() < 0.3;
    e.coverT = (e.coverT || 0) - dt;
    const tMoved = e.coverFor && Math.hypot(e.coverFor.x - t.pos.x, e.coverFor.z - t.pos.z) > 10;
    if (!e.cover || e.coverT <= 0 || tMoved) {
      e.cover = pickCover(e, t);
      e.coverT = FC.rand(4, 7);
      e.coverFor = { x: t.pos.x, z: t.pos.z };
      e.crouched = false;
    }
    if (!e.cover) { e.inCover = false; e.crouched = false; return false; }
    const c = e.cover;
    const dc = Math.hypot(c.x - e.pos.x, c.z - e.pos.z);
    if (dc > 1.8) { e.inCover = false; e.crouched = false; steer(e, c.x, c.z, e.def.run, dt, G); return true; }
    if (dc > 0.35) { e.walk(dt, c.x, c.z, 2.8, false); }
    e.inCover = true; e.speedNow = 0;
    e.yaw = FC.turnTowards(e.yaw, FC.yawTo(t.pos.x - e.pos.x, t.pos.z - e.pos.z), dt * 5);
    e.peekT = (e.peekT || 0) - dt;
    if (e.peekT <= 0) {
      e.crouched = c.low ? !e.crouched : false;
      e.peekT = e.crouched ? FC.rand(1.2, 2.6) : FC.rand(1.3, 2.4);
      if (!e.crouched) e.aimT = Math.max(e.aimT, 0.3);
    }
    return true;
  }
  function release(e) { if (e.cover && e.cover.taken === e) e.cover.taken = null; e.cover = null; e.inCover = false; e.crouched = false; }
  return { build, combatMove, steer, release };
})();
