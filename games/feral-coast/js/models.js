'use strict';
// Low-poly character, animal and weapon models built from primitives.
FC.Models = (function () {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const L = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const gunMat = L(0x262626), gunMat2 = L(0x4a3a2a);

  function part(parent, w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(box, mat);
    m.scale.set(w, h, d); m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  function humanoid(o) {
    const g = new THREE.Group();
    const mShirt = L(o.shirt), mPants = L(o.pants), mSkin = L(o.skin || 0xc89a74), mGear = L(o.gear);
    const s = o.scale || 1;
    g.scale.setScalar(s);
    const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips);
    const torso = new THREE.Group(); hips.add(torso);
    part(torso, 0.5, 0.62, 0.28, 0, 0.32, 0, mShirt);
    part(torso, 0.54, 0.36, 0.33, 0, 0.36, 0, mGear);
    const head = new THREE.Group(); head.position.y = 0.8; torso.add(head);
    part(head, 0.26, 0.28, 0.27, 0, 0, 0, mSkin);
    part(head, 0.31, 0.11, 0.31, 0, 0.13, 0, mGear);
    if (o.mask) part(head, 0.27, 0.12, 0.05, 0, -0.04, -0.14, L(o.mask));
    const arm = (side) => {
      const a = new THREE.Group(); a.position.set(0.33 * side, 0.6, 0); torso.add(a);
      part(a, 0.13, 0.55, 0.13, 0, -0.25, 0, mShirt);
      part(a, 0.11, 0.11, 0.11, 0, -0.55, 0, mSkin);
      return a;
    };
    const armL = arm(-1), armR = arm(1);
    armR.rotation.x = 1.35; armL.rotation.x = 1.2; armL.rotation.z = -0.5;
    const gun = new THREE.Group(); gun.position.set(0.12, 0.42, -0.35); torso.add(gun);
    part(gun, 0.08, 0.13, 0.75, 0, 0, -0.2, gunMat);
    part(gun, 0.06, 0.18, 0.08, 0, -0.12, -0.15, gunMat2);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.65); gun.add(muzzle);
    const leg = (side) => {
      const l = new THREE.Group(); l.position.set(0.13 * side, 0, 0); hips.add(l);
      part(l, 0.18, 0.86, 0.2, 0, -0.45, 0, mPants);
      part(l, 0.2, 0.12, 0.28, 0, -0.88, -0.04, L(0x2b2118));
      return l;
    };
    const legL = leg(-1), legR = leg(1);
    return { group: g, hips, torso, head, armL, armR, legL, legR, gun, muzzle, mats: [mShirt, mGear] };
  }

  function animate(m, phase, amount, crouch) {
    const sw = Math.sin(phase) * 0.7 * amount;
    m.legL.rotation.x = sw - crouch * 0.9;
    m.legR.rotation.x = -sw - crouch * 0.9;
    m.hips.position.y = 0.92 - crouch * 0.38 + Math.abs(Math.cos(phase)) * 0.04 * amount;
    m.torso.rotation.x = -crouch * 0.25;
    m.legL.children[0].position.z = 0; // keep tidy
  }

  function boar() {
    const g = new THREE.Group();
    const fur = L(0x4a3426), dark = L(0x2e2018), tusk = L(0xeeeadc);
    part(g, 0.6, 0.55, 1.15, 0, 0.62, 0, fur);
    part(g, 0.5, 0.25, 0.9, 0, 0.95, 0.05, dark);
    const head = new THREE.Group(); head.position.set(0, 0.62, -0.62); g.add(head);
    part(head, 0.42, 0.4, 0.45, 0, 0, -0.1, fur);
    part(head, 0.22, 0.2, 0.18, 0, -0.06, -0.4, L(0x6b4a3a));
    part(head, 0.05, 0.05, 0.16, 0.13, -0.08, -0.4, tusk);
    part(head, 0.05, 0.05, 0.16, -0.13, -0.08, -0.4, tusk);
    const legs = [];
    for (const [x, z] of [[-0.2, -0.38], [0.2, -0.38], [-0.2, 0.4], [0.2, 0.4]]) {
      const l = new THREE.Group(); l.position.set(x, 0.42, z); g.add(l);
      part(l, 0.13, 0.42, 0.13, 0, -0.21, 0, dark);
      legs.push(l);
    }
    return { group: g, head, legs };
  }

  // ---- first-person viewmodels ----
  function flameSprite(color) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.35, color); gr.addColorStop(1, 'rgba(255,80,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    return new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  }
  const flashMat = flameSprite('rgba(255,190,80,0.9)');

  function viewmodels(skinColor, sleeveColor) {
    const skin = L(skinColor), sleeve = L(sleeveColor);
    const arms = (g, rx, ry, rz) => {
      part(g, 0.08, 0.08, 0.32, 0.05, -0.1, 0.12, sleeve);
      part(g, 0.07, 0.07, 0.1, 0.03, -0.08, -0.06, skin);
      if (rx !== undefined) part(g, 0.08, 0.08, 0.36, rx, ry, rz, sleeve);
    };
    const rifle = new THREE.Group();
    part(rifle, 0.06, 0.09, 0.48, 0, 0, -0.1, gunMat);
    part(rifle, 0.028, 0.028, 0.32, 0, 0.015, -0.48, gunMat);
    part(rifle, 0.045, 0.14, 0.07, 0, -0.1, -0.18, gunMat2);
    part(rifle, 0.05, 0.08, 0.2, 0, -0.02, 0.2, gunMat2);
    part(rifle, 0.02, 0.04, 0.05, 0, 0.065, -0.05, L(0x111111));
    part(rifle, 0.05, 0.05, 0.16, 0, -0.045, -0.36, gunMat2);
    arms(rifle, -0.06, -0.08, -0.32);
    const rifleMuzzle = new THREE.Object3D(); rifleMuzzle.position.set(0, 0.015, -0.66); rifle.add(rifleMuzzle);

    const pistol = new THREE.Group();
    part(pistol, 0.045, 0.07, 0.2, 0, 0, -0.05, gunMat);
    part(pistol, 0.04, 0.12, 0.06, 0, -0.08, 0.02, gunMat2);
    const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), L(0x3a3a3a));
    sup.rotation.x = Math.PI / 2; sup.position.set(0, 0.01, -0.25); pistol.add(sup);
    arms(pistol);
    const pistolMuzzle = new THREE.Object3D(); pistolMuzzle.position.set(0, 0.01, -0.36); pistol.add(pistolMuzzle);

    const molotov = new THREE.Group();
    const glass = new THREE.MeshLambertMaterial({ color: 0x5b7a32, transparent: true, opacity: 0.8 });
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.17, 8), glass);
    bottle.position.set(0, 0, -0.05); molotov.add(bottle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.08, 8), glass);
    neck.position.set(0, 0.12, -0.05); molotov.add(neck);
    part(molotov, 0.03, 0.06, 0.03, 0, 0.18, -0.05, L(0xd8d0b0));
    const fl = new THREE.Sprite(flameSprite('rgba(255,140,30,0.9)')); fl.scale.set(0.09, 0.12, 1); fl.position.set(0, 0.24, -0.05);
    molotov.add(fl);
    arms(molotov);

    const flash = new THREE.Sprite(flashMat); flash.scale.set(0.22, 0.22, 1); flash.visible = false;
    return { list: [rifle, pistol, molotov], muzzles: [rifleMuzzle, pistolMuzzle, null], flash, molotovFlame: fl };
  }

  function setLayer(obj, layer) { obj.traverse((o) => o.layers.set(layer)); }

  return { humanoid, animate, boar, viewmodels, setLayer, flameSprite };
})();
