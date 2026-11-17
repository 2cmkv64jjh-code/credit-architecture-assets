# Feral Coast

A split-screen, local co-op, open-island shooter for the browser. Two rebels, **Rook** and **Wren**, land on Isla Brava. Their job is to free it from the **Ashen Tide** militia and its leader, Commander Vael, one outpost at a time.

It's an original game built on the open-world FPS formula: outposts, stealth, alarms, fire, wildlife. All names, characters, art and audio are new. Everything is procedural or synthesized, and there are no third-party game assets.

## Run it

Open `index.html` in a desktop browser (Chrome, Edge or Firefox). No build step and no server are needed, because three.js is vendored in `vendor/`.

If you'd rather serve it locally: `npx serve games/feral-coast` or `python3 -m http.server -d games/feral-coast`.

## Joining (title screen)

| Slot | How to join |
|---|---|
| Player 1 | Click (keyboard + mouse) **or** press **A** on a gamepad |
| Player 2 | Press **Enter** (right side of the keyboard) **or** press **A** on another gamepad |

Press **Space** / **Start** to deploy. With one player joined you get a full-screen solo game; with two you get a split screen. You can choose side-by-side or top/bottom on the title screen or in the pause menu.

Two gamepads work best. One keyboard + mouse player and one gamepad is next best. Two players on a single keyboard works, but it's cramped.

## Controls

| Action | Keyboard + Mouse | Keyboard (P2, right side) | Gamepad |
|---|---|---|---|
| Move / look | WASD / Mouse | IJKL / Arrows | L-Stick / R-Stick |
| Fire / aim | LMB / RMB | Enter / Right Shift | RT / LT |
| Sprint / crouch / jump | Shift / C / Space | M / N / H | L3 / B / A |
| Weapons / reload | 1 2 3, wheel / R | P / O | Y / X |
| Takedown · revive · use | E | U | RB |
| Tag enemy / ping spot | Q | Y | LB |
| Medkit | F | 9 | D-pad Up |
| Pause | Esc | Backspace | Start |

## How the formula was broken down and rebuilt

| Pillar of the genre | How Feral Coast does it |
|---|---|
| **Outpost liberation** as the core loop | 5 outposts held by the militia. Clear every guard (including reinforcements) and the flag turns rebel green. The outpost then becomes a respawn point and a resupply crate. |
| **Stealth with readable detection** | Each guard has a view cone and line of sight against terrain and buildings. A per-player detection meter around your crosshair goes white, then amber, then red. Crouching and bushes slow it down; sprinting speeds it up. |
| **Alarms and escalation** | When a guard spots you, a runner heads for the yellow alarm box. If it goes off, a siren plays and reinforcements arrive. You can sabotage the box first to keep the outpost isolated. |
| **Tagging / recon** | Tag guards to keep them marked through walls and on the minimap. Tags are shared, so your partner sees them too. Tag the ground to drop a ping. |
| **Silent takedowns** | Get close to an unaware guard, or behind an alert one, for a one-button silent kill. Heavies can only be taken from behind. Guards that find bodies start searching. |
| **Loud vs. quiet loadout** | AR-7 rifle (loud, alerts everything within ~75 m), Whisper suppressed pistol (headshots kill in one hit), and molotovs. |
| **Systemic fire** | Molotovs and exploding barrels start fires. Fire spreads from bush to bush, sets guards burning and cooks off nearby barrels. |
| **Hostile wildlife** | Boars roam the island and charge whoever is closest, militia included. |
| **Enemy chatter** | Guard barks ("Did you hear that?", "Sound the alarm!") tell you their state. |
| **Co-op specific** | Downed state with a 30-second bleed-out and hold-to-revive. A squad wipe redeploys both players at the nearest safe point. Tags, pings and partner markers are shared. |
| **Boss stronghold** | Vael's Roost is a walled fortress with towers, two heavies and Commander Vael. Vael has frontal armour, so flank him. |

A run ends when all five outposts are free. The victory screen shows each player's stats: kills, headshots, takedowns, tags and revives.

## Code map

| File | Purpose |
|---|---|
| `js/world.js` | Island heightmap, foliage instancing, outpost and fortress layout, colliders, raycasts, minimap texture |
| `js/player.js` | Movement, stances, weapons, viewmodels, revive/downed, interactions |
| `js/enemies.js` | Militia AI state machine (patrol, suspicious, search, alert, alarm-run), boars |
| `js/main.js` | Game rules, combat, fire, alarms, pickups, split-screen rendering, title/pause/victory |
| `js/hud.js` | Per-viewport HUD: detection meters, markers, minimap, prompts |
| `js/input.js` | Keyboard, mouse (pointer lock) and Gamepad API, with per-player devices |
| `js/fx.js`, `js/audio.js` | GPU point-sprite particles and tracers, and WebAudio-synthesized sound |
