'use strict';
// Story missions with radio dialogue from the resistance.
FC.Missions = (function () {
  const AMA = 'Ama Reyes', TEO = 'Teo (radio)';
  const LIST = [
    {
      id: 'landfall', title: 'Landfall', text: 'Grab supplies at the Driftwood Camp trader',
      start: [[AMA, 'Rook, Wren — welcome to Isla Brava. Or what the Ashen Tide left of it.'], [AMA, 'Stock up at the camp chest before you move. Vael pays his men in bullets; we pay in courage, and a little cash.']],
      target: (G) => G.startPoi(), done: (G) => G.flags.shopped,
    },
    {
      id: 'spark', title: 'First Spark', text: 'Liberate Saltmarsh Dock',
      start: [[AMA, 'Saltmarsh Dock is choking Palmhaven. Take it back.'], [TEO, 'Tip: tag the guards first, then cut the yellow alarm box before anyone sees you.']],
      target: (G) => FC.World.outposts[0], done: () => FC.World.outposts[0].liberated,
    },
    {
      id: 'eyes', title: 'Eyes in the Sky', text: 'Climb and hack the Spire Delta relay',
      start: [[TEO, 'The Tide reads the island through those radio spires. Climb Spire Delta and patch me in.'], [TEO, 'Hacking a spire maps the whole region for us — outposts, ledgers, the lot.']],
      target: () => FC.World.towers[0], done: () => FC.World.towers[0].hacked,
    },
    {
      id: 'supply', title: 'Cut the Supply Line', text: 'Destroy an Ashen Tide supply convoy',
      start: [[AMA, 'Vael moves fuel and ammo by truck along the island roads. Burn one.'], [TEO, 'Trucks show up red on your map. A molotov or a grenade does wonders.']],
      target: (G) => G.nearestConvoy(), done: (G) => G.flags.convoys > 0,
    },
    {
      id: 'spread', title: 'Spread the Fire', text: 'Liberate 4 outposts',
      start: [[AMA, 'Every flag you raise brings more people to our side. Keep going.']],
      target: (G) => G.nearestHeld(), done: () => FC.World.outposts.filter((o) => o.liberated).length >= 4,
    },
    {
      id: 'ridge', title: 'Break the Ridge', text: 'Liberate Ridge Battery',
      start: [[AMA, 'Ridge Battery guards the road north. Its guns have shelled Cloudrest for a year.']],
      target: () => FC.World.outposts[5], done: () => FC.World.outposts[5].liberated,
    },
    {
      id: 'pass', title: 'Gullet Pass', text: 'Liberate Gullet Pass',
      start: [[TEO, "Gullet Pass is the only way into Vael's valley. Take it and the Roost is exposed."]],
      target: () => FC.World.outposts[8], done: () => FC.World.outposts[8].liberated,
    },
    {
      id: 'roost', title: "Vael's Roost", text: 'Storm the fortress and kill Commander Vael',
      start: [[AMA, 'This is it. Vael is holed up in the Roost with his best men.'], [AMA, 'His coat is armoured — hit him from the side or behind. Come home, both of you.']],
      target: () => FC.World.outposts[9], done: () => FC.World.outposts[9].liberated,
    },
    {
      id: 'sweep', title: 'Free Isla Brava', text: 'Liberate every remaining outpost',
      start: [[AMA, "Vael's gone, but his dogs still hold ground. Finish it."]],
      target: (G) => G.nearestHeld(), done: () => FC.World.outposts.every((o) => o.liberated),
    },
  ];
  const M = { index: 0, queue: [], current: null, line: null, lineT: 0, list: LIST };

  function start(G, idx) {
    M.index = idx;
    M.current = LIST[idx] || null;
    if (M.current) {
      G.announce(`NEW MISSION — ${M.current.title}`, '#ffd166', 4);
      FC.Audio.quest();
      for (const l of M.current.start) M.queue.push(l);
    }
  }
  function update(dt, G) {
    if (M.line) { M.lineT -= dt; if (M.lineT <= 0) M.line = null; }
    if (!M.line && M.queue.length) { M.line = M.queue.shift(); M.lineT = 2.2 + M.line[1].length * 0.045; FC.Audio.radio(); }
    if (!M.current) return;
    if (M.current.done(G)) {
      G.announce(`MISSION COMPLETE — ${M.current.title}`, '#7bed9f', 4);
      for (const p of G.players) { FC.Progression.xp(p, 150, 'Mission', G); FC.Progression.cash(p, 150, 'Mission', G); }
      FC.Audio.liberate();
      start(G, M.index + 1);
      FC.Progression.save(G);
      if (!M.current) G.victoryT = 5;
    }
  }
  function say(who, text) { M.queue.push([who, text]); }
  function target(G) { return M.current ? M.current.target(G) : null; }
  return Object.assign(M, { start, update, say, target });
})();
