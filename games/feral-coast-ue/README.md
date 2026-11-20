# Feral Coast — Unreal Engine 5 port

A port of the browser game in `../feral-coast` to **Unreal Engine 4.26.2**. It is the same island, built
from the game's own data, with a physical sky atmosphere, volumetric clouds and fog, real-time sky lighting,
distance-field shadows, and local split-screen co-op. It should also open in UE5: let it convert the project.

> Status: first pass, **not yet compiled or run**. It was written in a cloud session that could not reach
> the Windows PC. Expect to fix small things on the first build (see "If something goes wrong").

## What's in here

| Path | What it is |
|---|---|
| `FeralCoast.uproject` | The project (C++ module + Python and Editor Scripting plugins), engine 4.26 |
| `Source/FeralCoast/` | C++ gameplay: `FCCharacter` (player), `FCEnemy` (militia AI), `FCWorldBuilder` (island content), `FCHUD`, `FCGameMode` (split-screen co-op), `FCAssets` |
| `Data/heightmap_1009.png` | 16-bit island heightmap exported from the game (1009 × 1009 for 1.6 km) |
| `Data/world.json` | Outposts, villages, towers, roads, building blocks, 98 militia, wildlife, vehicles, piers |
| `Data/circles.json` | 6,879 tree and rock positions with sizes |
| `SourceAssets/` | All 66 models (FBX, characters/animals/arms with skeletons and animations), 54 sounds (WAV) and 9 textures, with their credits |
| `Scripts/1_import_assets.py` | Imports everything into `/Game/FeralCoast` |
| `Scripts/2_build_level.py` | Makes the materials and the `Island` map (sky, sun, clouds, fog, ocean, post-process, player start, world builder) |

## Setup on Windows (about 15 minutes, mostly waiting)

1. **Prerequisites:** Unreal Engine 4.26.2, plus **Visual Studio 2019** with the "Game development with C++"
   workload. Unreal needs it to compile C++, and 4.26 expects VS 2019.
2. **Open the project:** copy this `feral-coast-ue` folder somewhere local, then double-click
   `FeralCoast.uproject`. When it says the module is missing or out of date, click **Yes** to rebuild.
   If it can't, right-click the `.uproject` > *Generate Visual Studio project files*, open `FeralCoast.sln`
   and build **Development Editor / Win64**.
3. **Import assets:** in the editor, *Tools > Execute Python Script...* > `Scripts/1_import_assets.py`.
   It imports the FBX files with skeletons and animations, plus the WAV sounds. It takes several minutes.
4. **Build the map:** *Tools > Execute Python Script...* > `Scripts/2_build_level.py`.
   It creates and opens `/Game/FeralCoast/Maps/Island`.
5. **Import the island landscape** (the editor's Python API can't do this step):
   *Landscape mode (Shift+2) > Manage > New > Import from File*, choose `Data/heightmap_1009.png`, then set:
   - Section Size **63×63**, Sections per Component **2×2**, Number of Components **8×8**
     (= 1009 × 1009, it should show "Resolution 1009 x 1009")
   - Location **X −80000, Y −80000, Z 0**
   - Scale **X 158.73, Y 158.73, Z 100**
   - Material **`/Game/FeralCoast/Materials/M_Island`**
   - Click **Import**, then save.

   These numbers reproduce the game's heights exactly. Pixel value = height × 128 + 32768.
6. **Refresh the world builder:** select `FC_WorldBuilder` in the Outliner and tick **Rebuild**. The
   forest, rocks, outposts, radio masts, piers and vehicles are placed on the landscape.
7. **Play:** press **Play** (or *Play > Standalone Game*). Player 1 uses keyboard and mouse. Plug in a gamepad
   for player 2: the screen splits top/bottom. To play alone, untick *Local Coop* on the game mode.

## Controls

| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move / look | WASD / mouse | Left stick / right stick |
| Fire / aim | LMB / RMB | RT / LT |
| Sprint / crouch / jump | Shift / C / Space | L3 / B / A |
| Reload / switch weapon | R / wheel or 1–4 | X / Y |

## What carries over, and what's new

- **Carried over:**
  - The whole island layout: terrain, outposts, villages, relay towers, roads, forests, piers and vehicles.
  - All 98 militia with their types: grunt, heavy with front armour, tower sniper, and Vael.
  - The four main guns with the same damage, magazine and reload numbers.
  - The animated first-person arms for the carbine and pistol.
  - All recorded sounds.
- **New in Unreal:**
  - Real-time sky lighting and distance-field shadows (upgrade to UE5 later for Lumen and Nanite).
  - Physically based sky with volumetric clouds and height fog.
  - Instanced forest with collision (bullets and players).
  - A suspicion meter above each guard; alerts spread to squads; enemies strafe and chase.
  - Per-player HUD in split screen.

## Not ported yet (next steps)

- **Vehicles:** driving them (they are static set dressing for now). Next would be Chaos Vehicles for the jeep and truck, and a buoyancy boat.
- **Systems from the browser version:**
  - Missions and radio dialogue.
  - Liberating outposts.
  - Progression, the shop and saves.
  - Wildlife AI.
  - The glider, ziplines and grappling.
  - Companions, the gunship, weather and the day/night cycle.
- **Art:**
  - The Water plugin ocean, with waves and shoreline foam.
  - Foliage that sways in the wind.
  - Niagara muzzle flashes and impacts.

## If something goes wrong

- **Model sizes and facing:** the C++ code finds assets by folder and fits every model to a target size, so
  importer naming doesn't matter.
  - If the first-person arms sit wrong, select the player in a running game (or make a Blueprint child of
    `FCCharacter`) and adjust *Viewmodel > Arms Offset / Arms Rotation / Arms Gun Length Cm*.
  - If militia face the wrong way, change `FCEnemy` *Mesh Yaw Offset*.
- **Militia T-posing:** the animation names from the glTF importer didn't match the names the code looks
  for ("Idle", "Walk", "Run", "Death"). Check `/Game/FeralCoast/Models/rebel1/`.
- **Compile errors:** they will name a file and line. Most likely causes are UE version API differences
  (written against 4.26.2).
