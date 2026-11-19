# Feral Coast

A split-screen, local co-op, open-world shooter for the browser. Two rebels, **Rook** and **Wren**, land on Isla Brava. Their job is to free it from the **Ashen Tide** militia and its leader, Commander Vael.

It's an original game built on the open-world FPS formula: outposts, stealth, alarms, radio towers, fire, wildlife, convoys and progression. The setting, story, characters and code are new. The 3D models and textures are free CC0 art packs (see [Credits](#credits)). Sound effects are synthesized in code.

## Run it

Open `index.html` in a desktop browser (Chrome, Edge or Firefox). It works straight from disk, with no build step or server, because everything is bundled in `vendor/` and `assets/`. A dedicated GPU is recommended. Use **Graphics: Medium / Low** on the title or pause screen on laptops, or for split screen on modest hardware.

Progress autosaves in the browser (localStorage), so **Continue** picks up where you left off.

**Difficulty** (title or pause screen):

| Preset | Health | Enemy damage | Regeneration |
|---|---|---|---|
| Story | 200 HP | about 35% | fast, full |
| Normal (default) | 150 HP | about 60% | full |
| Hard | 100 HP | full | partial |

When you're downed, you can hold the interact key to patch yourself up with a medkit, even in solo play. The rebel camp is a safe zone the militia won't enter.

## Joining

| Slot | How to join |
|---|---|
| Player 1 | Click (keyboard + mouse) **or** press **A** on a gamepad |
| Player 2 | Press **Enter** (right side of the keyboard) **or** press **A** on another gamepad |

Choose **New Game** or **Continue**. One player gets a full-screen game; two players get a split screen (side-by-side or top/bottom).

## Controls

| Action | Keyboard + Mouse | Keyboard (P2, right side) | Gamepad |
|---|---|---|---|
| Move / look | WASD / Mouse | IJKL / Arrows | L-Stick / R-Stick |
| Fire / aim | LMB / RMB | Enter / Right Shift | RT / LT |
| Sprint / crouch / jump | Shift / C / Space | M / N / H | L3 / B / A |
| Weapons / reload | 1–8, wheel / R | P / O | Y / X |
| Hang glider (while falling) / release | Space / Space or C | H / H or N | A / A or B |
| Takedown · revive · use · drive | E | U | RB |
| Tag enemy / ping spot (horn while driving) | Q | Y | LB |
| Medkit | F | 9 | D-pad Up |
| Map & skills (tab switches) | M | . | Back |
| Pause | Esc | Backspace | Start |

Driving: forward/back is throttle, left/right steers, jump is the handbrake and sprint boosts. In the map, move the cursor and confirm to set a waypoint. Confirming on a liberated outpost, a freed village or the camp fast-travels there.

## What's in it

- **Open island, about 1.6 × 1.6 km.**
  - Procedural terrain with beaches, jungle, a central mountain ridge and a road network.
  - 10 outposts, including Vael's walled fortress.
  - 4 villages, 3 climbable radio relays, the rebel camp and 14 hidden Tide Ledgers.
- **Living world.**
  - Militia patrols walk the roads.
  - Supply convoy trucks carry guards.
  - Deer and stags graze and flee.
  - Wolf packs hunt anyone, militia included.
  - Villagers flee gunfire and cheer when their outpost falls.
- **Stealth and AI.**
  - Each guard has a view cone and line of sight.
  - Detection meters show who is noticing you.
  - Crouching in bushes hides you, and night and rain cut how far guards see.
  - Guards who find bodies start searching.
  - Alarm runners call reinforcements unless you cut the box first.
  - Snipers on watchtowers give away their position with a red glint.
- **Combat.**
  - Real weapon models: militia carry rifles, shotguns (heavies) or marksman rifles (snipers).
  - Weapons: suppressed pistol, silent recurve bow, carbine, shotgun, scoped marksman rifle, molotovs and frag grenades.
  - The bow: hold fire to draw and release to shoot. Arrows drop with distance, kill silently and can be picked up again.
  - Militia grunts lob grenades to flush you out of cover. A warning marker shows where they land.
- **Water:** six speedboats docked around the coast (camp, Saltmarsh Dock, Old Cannery, Black Pier, Palmhaven, Tidewater).
  - The driver steers and the passenger shoots.
  - A militia gunboat patrols the coast with two gunners.
- **Ziplines:** cables run from every relay tower down to nearby outposts and villages. Interact at the platform edge to ride, shoot while sliding, and jump off mid-ride to open the glider.
- **Tide gunship:** an alarm at any of the bigger outposts (and Vael's last stand) calls in a helicopter gunship 15 seconds later. It circles you while a door gunner fires bursts. Get under cover or shoot it down for 250 XP.
- **Alarm reinforcements:** a tripped alarm sends militia trucks racing in along the roads. The soldiers jump out when they arrive or spot you, and you can ambush the trucks on the way.
- **Wolf companion:** Fang (Ash for player 2) comes from the "Wolf at the Door" mission or the trader for $350.
  - Tagging an enemy sends the wolf after them, and unaware guards die silently.
  - It defends you when you're shot at, and recovers 30 seconds after being downed.
- **Set pieces:** the black alpha wolf, a prisoner rescue at Sulfur Springs, the sea raid, the Black Pier fuel-depot inferno (with slow motion) and Vael's last stand (radio taunts, trucks, and a slow-motion finale).
- **Traversal:** a hang glider. Jump again while falling from a relay tower, ridge or cliff, then look to steer.
- **Rebel garrisons:** three resistance fighters hold every outpost you free and fight any militia they see.
- **Counter-attacks:** every 6–9 minutes the Tide may try to retake a freed outpost near you. Defend it for XP and cash.
  - Silent takedowns, including chain takedowns.
  - Exploding barrels.
  - Fire that spreads through brush.
- **Co-op.**
  - Split screen with independent HUDs and menus.
  - Shared tags and pings.
  - A downed state with hold-to-revive.
  - Driver plus a passenger who can shoot.
  - Squad redeploy.
- **Progression.**
  - XP and levels.
  - An 11-skill tree: health, stealth, recoil, reload, medic, chain takedown, heavy hitter, ammo capacity, fire resistance, hunting.
  - Cash from loot, pelts, ledgers and bounties.
  - Traders at the camp, liberated outposts and freed villages.
- **Story missions** with radio dialogue from the resistance, leading up to the assault on Vael's Roost.
- **Audio:** [plinkfx](https://github.com/maximilianfeix/plinkfx) CC0 sound effects, with positional gunfire, explosions and ricochets.
  - Footsteps change by surface: grass, sand, gravel, wood, water and stone.
  - Looping sounds: vehicle engines that rev with speed, rain and wind.
  - Ambient sounds: surf, birds, frogs and thunder.
  - Combat music, plus a heartbeat when your health is low.
- **Game modes** (title screen):
  - **Campaign:** the story, with saves and New Game+ (harder militia, your gear kept).
  - **Survival:** hold the rebel camp against endless, growing waves.
  - **Versus:** split-screen deathmatch in the Old Cannery, first to 10.
  - **Ghost run:** clear Saltmarsh Dock unseen against the clock for gold, silver or bronze.
- **Difficulty:** Story, Normal and Hard change health, enemy damage and how fast guards spot you.
- **More vehicles:** a gyrocopter (camp, Tidewater, Ironbark), quad bikes, and a jeep-mounted machine gun with overheating for the passenger.
- **More combat:**
  - Throwing knives.
  - Death-from-above takedowns.
  - Binoculars (hold tag) that mark everyone you look at.
  - Weapon attachments from the trader: suppressors, a rifle sight and extended magazines.
  - Trees and rocks stop bullets and block line of sight.
- **Smarter militia:**
  - Soldiers run to cover, crouch behind low walls and peek out to shoot.
  - Some deliberately flank you.
  - They move using [Yuka](https://github.com/Mugen87/yuka) steering, so squads spread out and steer around buildings.
- **Physics** ([Rapier](https://rapier.rs)): explosions and vehicle hits throw bodies, debris flies, and destroyed vehicles flip and tumble.
- **Wild island:**
  - Crocodiles in the rivers and shoreline, and animated sharks in deeper water.
  - Foxes in the woods (pelts sell to the trader).
  - Black bears in the high forest: they charge if you get close (crouch to sneak past) and give up after a while.
  - Flocks of parrots circle the jungle and scatter when shooting starts.
  - Wolves howl at night.
  - Shipwrecks on the reefs, piers out to every boat mooring, beached skiffs by the villages and shore cannons at the coastal forts.
  - Thunderstorms whose lightning can start bush fires.
  - Random encounters: executions to stop, ambushes, supply drops and a paymaster convoy.
- **Side content:**
  - 4 named bounty targets.
  - 5 buried treasures revealed by ledgers.
  - 4 village side quests.
  - Crafting from pelts: ammo, a bigger bag, medkits.
  - Camp upgrades: sentries, a garage and an infirmary.
- **Settings:** field of view, mouse and gamepad sensitivity, invert Y, volume, subtitle size, colorblind-friendly markers, an FPS counter and gamepad rumble.
- **Rendering** (three.js):
  - A physical sky with a full day/night cycle (about 20 minutes per day), stars and weather.
  - Real-time sun shadows.
  - A shoreline-aware ocean shader with foam and depth tint.
  - Splat-textured terrain.
  - Wind-animated trees, bushes and grass.
  - Animated skinned characters and animals.
  - Bloom, color grading and damage effects (per viewport).
  - On High: [N8AO](https://github.com/N8python/n8ao) ambient occlusion and SMAA anti-aliasing.
  - Quality presets.
  - Characters are culled by distance and view per split-screen view, which keeps frame times low with 100+ actors.

## Code map

| File | Purpose |
|---|---|
| `js/world.js` | Heightfield, roads, terrain chunks and their splat shader, outposts, villages, relays, colliders, spatially hashed raycasts, map image |
| `js/env.js` | Sky, sun and moon, shadows, day/night, fog, weather, ocean shader |
| `js/foliage.js` | Instanced vegetation in streaming super-chunks, wind shader, recycled grass patches |
| `js/assets.js` | Decodes the embedded GLB/PNG assets; character rigs with animation crossfades |
| `js/player.js` | Movement, ladders, vehicles, weapons, viewmodels, interactions |
| `js/enemies.js` | Militia AI, wildlife, villagers |
| `js/vehicles.js` | Drivable jeeps, AI convoys |
| `js/progression.js` | XP, skills, cash, trader, map/skills menus, save games |
| `js/missions.js` | Story missions and radio dialogue |
| `js/sfx.js` | Sound facade over plinkfx: positional one-shots, loops, ambience (synth fallback in `js/audio.js`) |
| `js/features.js` | Bow arrows, rebel garrisons, counter-attacks, enemy grenades |
| `js/expansion.js` | Ziplines, boats, patrol boat, reinforcement trucks, wolf companion, story set pieces |
| `js/settings.js` | Player settings (FOV, sensitivity, audio, accessibility) and the settings panel |
| `js/modes.js` | Survival, versus and ghost-run modes |
| `js/living.js` | Crocodiles and sharks, storms, random events, bounties, treasure, village quests, crafting hooks |
| `js/physics.js` | Rapier world: terrain heightfield, building colliders, thrown bodies, debris, wrecks |
| `js/ai.js` | Cover points, cover and flank selection, peek cycle, Yuka steering |
| `js/hud.js` | Per-viewport HUD, compass, minimap, menus |
| `js/render.js` | Post-processing per viewport, quality presets |
| `js/main.js` | Game rules, combat, world systems, flow, render loop |
| `tools/` | Scripts to rebuild `vendor/three.bundle.js` and `assets/assets.js` |

## Credits

- 3D models and textures: **Quaternius**, **Kenney** and **Screaming Brain Studios**, all CC0 1.0 (public domain). They come via the `@netforge/asset-library-files` npm package; see `assets/NOTICE-asset-library.txt` and `assets/CC0-1.0.txt`.
- More CC0 models by **Quaternius**, from the Toon Shooter Game Kit (guns, knife, grenades), the Pirate Kit (animated shark, shipwrecks, piers, cannons, anchor, gold chest) and Ultimate Animated Animals (fox). They were downloaded from the creator's public Google Drive folders, converted with `tools/gltf-to-glb.mjs`, meshopt-compressed with [glTF-Transform](https://gltf-transform.dev) and stored in `assets/models/`.
- Models from Poly Pizza, credited to their authors (CC BY): "Crocodile" by jeremy, "Helicopter" by Zsky, and "Black bear", "Parrot" and "Radio tower" by Poly by Google. They were converted from OBJ with `tools/obj-to-glb.py` and stored in `assets/models/`.
- Combat music: `assets/audio/combat.mp3`, from the same CC0 library.
- Engine: [three.js](https://threejs.org) r160 (MIT, see `vendor/THREE_LICENSE`).
- Sound effects: [plinkfx](https://github.com/maximilianfeix/plinkfx) by Maximilian Feix. The sounds are CC0 and the player code is MIT.
- Ambient occlusion: [N8AO](https://github.com/N8python/n8ao) (ISC), together with [postprocessing](https://github.com/pmndrs/postprocessing) (Zlib).
- Physics: [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`, Apache-2.0). Steering: [Yuka](https://github.com/Mugen87/yuka) (MIT). Both are bundled into `vendor/physics.bundle.js`.
- Recorded gun sounds: CC0 packs from OpenGameArt. Footsteps, rain and thunder: Freesound recordings by artem_zaitsev, nox_sound, bevangoldswain, cdrk and InspectorJ (CC BY 4.0). See `assets/sounds/CREDITS.md`.
- three.js, plinkfx, N8AO and postprocessing are bundled into `vendor/three.bundle.js` by `tools/build-vendor.sh`.
