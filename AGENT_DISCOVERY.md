# AGENT DISCOVERY REPORT (`AGENT_DISCOVERY.md`)

**Date:** 2026-10-15  
**Repository:** `AtesiT/3D-Zombie-Game-Agent`  
**Branch:** `arena/5df2ff9a-3d-zombie-game-agent`

---

## 1. Existing Codebase Audit

### 1.1 Repository Structure Found
An audit of `/home/user/3D-Zombie-Game-Agent` revealed the following existing files:
- `README.md` — Minimal repository title stub (`# 3D-Zombie-Game-Agent`).
- `ARCHITECTURE.md` — Architectural specification describing the five core survival systems (Map Selection, Terminal Transit Drivable Bus, Neon Night Market & Blackwood Logging Camp Mechanics, Dynamic Weather FSM, and Day/Night Cycle Director).
- `Assets/Scripts/Core/Events/EnvironmentModifiers.cs` — Unity C# reference implementation defining `WeatherType`, `TimeOfDayPhase`, `EnvironmentGameplaySnapshot`, `IDamageable`, `IZombieAgent`, and `SurvivalEventBus`.
- `Assets/Scripts/Systems/MapSelection/MapDefinitionSO.cs` — Unity C# ScriptableObject definitions and JSON DTO structures for maps and polymorphic map mechanics.
- `Assets/Scripts/Systems/MapSelection/MapSelectionAndStreamingManager.cs` — Unity C# scene streaming and map selection state machine.
- `Assets/Scripts/Systems/Vehicles/TopDownBusController.cs` — Unity C# top-down armored bus physics (anisotropic lateral grip/drift, fuel management, velocity-gated NavMesh obstacle carving, front-plow zombie crushing, roof turret).
- `Assets/Scripts/Systems/Environment/EnvironmentDirector.cs` — Unity C# weather state machine, lightning strike hazard coroutine, day/night cycle progression, and snapshot broadcaster.
- `Assets/Scripts/Systems/Maps/MapUniqueMechanics.cs` — Unity C# implementations for `DestructibleNeonSignHazard`, `DestructibleFallingTree`, `TacticalEscapeZipline`, and `MudSlowdownZone`.

### 1.2 Identification of Required Web Stack Components
1. **Rendering Technology:**
   - Currently **none** in the web layer (only Unity C# scripts exist).
   - **Target Web Implementation:** High-performance **HTML5 Canvas 2D with multi-layer compositing** (World Base Layer, Dynamic Shadows & Decal Layer, Entities/Vehicles Layer, Weather Particle Layer, and Offscreen Lighting/Fog-of-War Mask Layer with radial & cone cutouts for Night/Fog/Flashlight/Headlights). Canvas 2D has zero external GPU asset loading bottlenecks, deterministic 60 FPS performance with 150+ pooled entities, crisp top-down tactical visuals, and immediate compatibility across Chrome, Firefox, Edge, and Safari.
2. **Module System:**
   - **Native ES Modules (`import` / `export`)** bundled and served via **Vite** (`vite.config.js` + `package.json`).
3. **Current Zombie Spawning / Wave System:**
   - Not yet implemented in JS. Will be built as an integrated `WaveManager` + `ObjectPool`-backed `Zombie` entity manager supporting round progression, window/barrier spawns, subway tunnel spawns, weather distance modifiers (`DenseFog` 30% closer spawns), Day/Dusk/Night spawn rate multipliers (`+10%` Dusk, `+50%` Night), and Night-exclusive `NightStalkerAI` variants.
4. **Current Player Controller & Camera Setup:**
   - Not yet implemented in JS. Will be built in `src/entities/Player.js` + smooth top-down `Camera` controller supporting WASD movement, mouse aim, weapon switching/upgrading (Pack-a-Punch), door/wall-weapon purchasing, flashlight control (`L`), vehicle entry/exit (`E`), fire-escape elevation bonuses, mud/snow speed modifiers, and velocity-lead camera tracking when driving the bus.
5. **Current Pathfinding Implementation:**
   - Referenced in C# via `NavMeshObstacle` hybrid carving; not yet implemented in JS.
   - **Target Web Implementation:** `src/systems/pathfinding/PathfindingManager.js` and `src/systems/pathfinding/DynamicObstacle.js` implementing a **2D Navigation Grid with Incremental Local Obstacle Patching + Flow-Field / Cached A* Hybrid**. When a dynamic obstacle (such as the moving Armored Bus or a felled tree in Blackwood Logging Camp) moves or triggers, only the grid cells in its previous and new oriented bounding box (OBB) are patched, and only paths intersecting invalidated cells are recomputed.
6. **Current Scene / Level Management Approach:**
   - Referenced in C# via `MapSelectionAndStreamingManager`.
   - **Target Web Implementation:** `src/systems/map/MapManager.js` and `src/systems/map/MapSelectionUI.js` loading pure JSON map definitions from `/assets/maps/<map-id>/map.json` (listed via `/assets/maps/registry.json`).
7. **Build / Run Pipeline:**
   - Will be initialized with `package.json` and `vite.config.js` configured to bind to `0.0.0.0` with `allowedHosts: true` so the live browser preview works out-of-the-box.

---

## 2. Preservation of Existing Files
Per the technical constraint *"DO NOT rewrite existing working systems unless absolutely necessary"*, all existing C# files under `Assets/Scripts/` and `ARCHITECTURE.md` will be preserved untouched, while the complete browser-based ES module game architecture is added under `/src/`, `/assets/`, `/public/`, `index.html`, `package.json`, and `vite.config.js`.
