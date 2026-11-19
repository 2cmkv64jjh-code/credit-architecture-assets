'use strict';
// XP / levels / skills / cash, the trader, the full-screen map (fog of war, waypoints, fast travel) and save games.
FC.SKILLS = [
  { id: 'tough1', name: 'Thick Skin', desc: '+25 max health', cost: 1 },
  { id: 'ghost', name: 'Ghost', desc: 'Guards notice you 25% slower', cost: 1 },
  { id: 'steady', name: 'Steady Hands', desc: '35% less recoil', cost: 1 },
  { id: 'fasthands', name: 'Fast Hands', desc: 'Reload 30% faster', cost: 1 },
  { id: 'medic', name: 'Field Medic', desc: 'Revive twice as fast, partner gets up at 75 HP', cost: 1 },
  { id: 'chain', name: 'Chain Takedown', desc: 'After a takedown, a second one within 3 s is instant from any angle', cost: 2 },
  { id: 'heavyhitter', name: 'Heavy Hitter', desc: 'Take down heavies from the front', cost: 2 },
  { id: 'pockets', name: 'Deep Pockets', desc: '+50% ammo reserves, +1 throwable', cost: 1 },
  { id: 'firewalker', name: 'Fire Walker', desc: 'Take 70% less fire damage', cost: 1 },
  { id: 'hunter', name: 'Hunter', desc: 'Pelts sell for double, wildlife on minimap', cost: 1 },
  { id: 'tough2', name: 'Iron Skin', desc: '+25 more max health', cost: 2, req: 'tough1' },
];
FC.SHOP = [
  { id: 'shotgun', name: 'Breaker 12 shotgun', price: 450, kind: 'weapon' },
  { id: 'sniper', name: 'Longtide .308 marksman rifle', price: 800, kind: 'weapon' },
  { id: 'grenade', name: 'Frag grenades (unlock + 2)', price: 150, kind: 'weapon' },
  { id: 'ammo', name: 'Full ammo refill', price: 40, kind: 'ammo' },
  { id: 'throw', name: '+2 molotovs / grenades', price: 90, kind: 'throw' },
  { id: 'med', name: 'Medkit', price: 60, kind: 'med' },
  { id: 'companion', name: 'Wolf companion (Fang)', price: 350, kind: 'companion' },
  { id: 'knives', name: 'Throwing knives (silent, retrievable)', price: 200, kind: 'weapon' },
  { id: 'rifle_sup', name: 'Carbine suppressor', price: 400, kind: 'mod' },
  { id: 'rifle_sight', name: 'Carbine holo-sight (2.4x)', price: 300, kind: 'mod' },
  { id: 'rifle_mag', name: 'Carbine extended mag (45)', price: 250, kind: 'mod' },
  { id: 'sniper_sup', name: 'Marksman suppressor', price: 500, kind: 'mod' },
  { id: 'pistol_mag', name: 'Pistol extended mag (18)', price: 150, kind: 'mod' },
];

FC.Progression = (function () {
  function newProfile() { return { xp: 0, level: 1, points: 1, skills: [], cash: 120 }; }
  function needFor(level) { return Math.round(350 * Math.pow(1.22, level - 1)); }
  function xp(p, amount, why, G) {
    const pr = p.prog;
    pr.xp += amount;
    if (G && why) G.floaters.push({ p, text: `+${amount} XP  ${why}`, t: 1.6 });
    while (pr.xp >= needFor(pr.level)) {
      pr.xp -= needFor(pr.level); pr.level++; pr.points++;
      p.msg(`LEVEL ${pr.level} — skill point earned (${p.ctrl.labels.map} → Skills)`, '#ffd166', 4);
      FC.Audio.levelUp();
    }
  }
  function cash(p, amount, why, G) {
    p.prog.cash = Math.max(0, p.prog.cash + amount);
    if (G && why) G.floaters.push({ p, text: `${amount >= 0 ? '+' : ''}$${amount}  ${why}`, t: 1.6, color: amount >= 0 ? '#9be7a1' : '#ff8a80' });
  }
  function applyPockets(p) {
    if (!p.has('pockets')) return;
    for (const k of ['pistol', 'rifle', 'shotgun', 'sniper']) FC.WEAPONS[k]['maxReserve_' + p.index] = Math.round(FC.WEAPONS[k].maxReserve * 1.5);
  }
  function maxReserve(p, k) { const w = FC.WEAPONS[k]; return Math.round(w.maxReserve * (p.has('pockets') ? 1.5 : 1)); }
  function maxThrow(p, k) { return FC.WEAPONS[k].maxCount + (p.has('pockets') ? 1 : 0); }

  // ---------------------------------------------------------------- save / load
  const KEY = 'feralcoast_save_v2';
  function save(G) {
    if (G.mode && G.mode !== 'campaign') return;
    try {
      const data = {
        v: 2, time: G.time, hour: FC.Env.hour,
        outposts: FC.World.outposts.map((o) => o.liberated), towers: FC.World.towers.map((t) => t.hacked),
        collectibles: G.collectibles.map((c) => c.taken), reveal: Array.from(G.reveal),
        mission: FC.Missions.current ? FC.Missions.current.id : 'done', flags: G.flags,
        players: G.players.map((p) => ({ prog: p.prog, owned: Array.from(p.owned), ammo: p.ammo, medkits: p.medkits, stats: p.stats })),
      };
      localStorage.setItem(KEY, JSON.stringify(data));
      G.saveFlash = 2;
    } catch (e) { /* storage unavailable */ }
  }
  function load() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  return { newProfile, needFor, xp, cash, save, load, clear, maxReserve, maxThrow, applyPockets };
})();

// ---------------------------------------------------------------------------------------------- menus
FC.Menus = (function () {
  function open(p) {
    p.menuSel = 0;
    if (p.menu === 'map') { p.mapCursor = { x: p.pos.x, z: p.pos.z }; p.mapZoom = 1; }
  }
  function navEdge(p, c) {
    // turn analog stick / keys into discrete up/down edges
    const y = c.my !== 0 ? c.my : (c.ly < -0.002 ? 1 : c.ly > 0.002 ? -1 : 0);
    const now = y > 0.5 ? 1 : y < -0.5 ? -1 : 0;
    let out = 0;
    if (now !== 0 && (p._navPrev !== now || (p._navHold = (p._navHold || 0) + 1) > 18)) { out = now; p._navHold = 0; }
    if (now === 0) p._navHold = 0;
    p._navPrev = now;
    return out;
  }
  function confirm(c) { return c.pressed.fire || c.pressed.jump; }

  function update(p, c, dt, G) {
    if (c.pressed.tag) { p.menu = p.menu === 'map' ? 'skills' : p.menu === 'skills' ? 'map' : p.menu; p.menuSel = 0; FC.Audio.ui(); }
    if (p.menu === 'map') return updateMap(p, c, dt, G);
    if (p.menu === 'skills') {
      const n = FC.SKILLS.length;
      p.menuSel = (p.menuSel - navEdge(p, c) + n) % n;
      if (confirm(c)) {
        const s = FC.SKILLS[p.menuSel];
        if (p.has(s.id)) return;
        if (s.req && !p.has(s.req)) { p.msg(`Requires ${FC.SKILLS.find((k) => k.id === s.req).name}`, '#ff8a80', 2); return; }
        if (p.prog.points < s.cost) { p.msg('Not enough skill points', '#ff8a80', 2); FC.Audio.click(); return; }
        p.prog.points -= s.cost; p.prog.skills.push(s.id);
        if (s.id.startsWith('tough')) p.hp += 25;
        p.msg(`Learned ${s.name}`, '#ffd166', 2.5); FC.Audio.levelUp();
        FC.Progression.save(G);
      }
      return;
    }
    if (p.menu === 'shop') {
      const n = FC.SHOP.length;
      p.menuSel = (p.menuSel - navEdge(p, c) + n) % n;
      if (confirm(c)) buy(p, FC.SHOP[p.menuSel], G);
    }
  }

  function buy(p, item, G) {
    if (item.kind === 'weapon' && p.owned.has(item.id) && item.id !== 'grenade') { p.msg('Already owned', '#aaa', 1.5); return; }
    if (p.prog.cash < item.price) { p.msg('Not enough cash', '#ff8a80', 2); FC.Audio.click(); return; }
    FC.Progression.cash(p, -item.price, item.name, G);
    if (item.kind === 'weapon') {
      p.owned.add(item.id);
      const w = FC.WEAPONS[item.id];
      if (w.throwable) p.ammo[item.id].mag = Math.min(FC.Progression.maxThrow(p, item.id), p.ammo[item.id].mag + 2);
      else { p.ammo[item.id].mag = w.mag; p.ammo[item.id].reserve = w.reserve; }
      p.weapon = item.id;
    } else if (item.kind === 'ammo') {
      for (const k of ['pistol', 'bow', 'rifle', 'shotgun', 'sniper']) p.ammo[k].reserve = FC.Progression.maxReserve(p, k);
    } else if (item.kind === 'throw') {
      for (const k of ['molotov', 'grenade']) if (p.owned.has(k)) p.ammo[k].mag = Math.min(FC.Progression.maxThrow(p, k), p.ammo[k].mag + 2);
    } else if (item.kind === 'med') p.medkits = Math.min(5, p.medkits + 1);
    else if (item.kind === 'mod') { p.prog.mods = p.prog.mods || []; if (p.prog.mods.includes(item.id)) { p.msg('Already fitted', '#aaa', 1.5); FC.Progression.cash(p, item.price, null, G); return; } p.prog.mods.push(item.id); p.msg(`Fitted: ${item.name}`, '#ffd166', 2); }
    else if (item.kind === 'companion') { if (p.companion) { p.msg('Already running with you', '#aaa', 1.5); FC.Progression.cash(p, item.price, null, G); return; } FC.Expansion.giveCompanion(p); }
    FC.Audio.pickup();
    FC.Progression.save(G);
  }

  function updateMap(p, c, dt, G) {
    const sp = 260 * dt * (p.mapZoom || 1);
    if (p.ctrl.usesMouse) { p.mapCursor.x += c.lx * 180; p.mapCursor.z += c.ly * 180; }
    else { p.mapCursor.x += c.lx * sp * 40; p.mapCursor.z += c.ly * sp * 40; }
    p.mapCursor.x += c.mx * sp * 1.5; p.mapCursor.z -= c.my * sp * 1.5;
    p.mapCursor.x = FC.clamp(p.mapCursor.x, -780, 780); p.mapCursor.z = FC.clamp(p.mapCursor.z, -780, 780);
    const hov = hovered(p, G);
    p.mapHover = hov;
    if (confirm(c)) {
      if (hov && hov.fast) {
        if (G.anyAlerted()) { p.msg("Can't fast travel while the Tide is hunting you", '#ff8a80', 2.5); return; }
        G.fastTravel(hov);
        p.menu = null;
      } else {
        G.setWaypoint(p, p.mapCursor.x, p.mapCursor.z);
        FC.Audio.click();
      }
    }
    if (c.pressed.reload) G.clearWaypoint(p);
  }
  function hovered(p, G) {
    let best = null, bd = 28;
    for (const poi of G.pois()) {
      if (!G.isRevealed(poi.x, poi.z) && !poi.always) continue;
      const d = Math.hypot(poi.x - p.mapCursor.x, poi.z - p.mapCursor.z);
      if (d < bd) { bd = d; best = poi; }
    }
    return best;
  }
  return { open, update };
})();
