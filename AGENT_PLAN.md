# AGENT IMPLEMENTATION PLAN (`AGENT_PLAN.md`)

**Date:** 2026-10-15  
**Project:** Top-Down 3D/2.5D Browser Zombie Survival Game — Map System, Drivable Bus, Weather & Day/Night Update

---

## 1. Architectural Overview & Tech Decisions

| Subsystem | Technology / Pattern Decision | Rationale |
|-----------|-------------------------------|-----------|
| **Build & Dev Server** | **Vite** + Native ES Modules (`type: "module"`) | Instant HMR, clean ES module imports, static asset serving for `/assets/maps/*.json`, zero-config bundling. |
| **Rendering Engine** | **HTML5 Canvas 2D Multi-Pass Renderer** (with 2.5D top-down perspective shadows, offscreen lighting/darkness compositing, and particle layers) | Guarantees 60 FPS with 100+ active zombies, supports dynamic cone flashlights/headlights via `destination-out` / radial gradients, handles DPI scaling (`devicePixelRatio`) and resize cleanly. |
| **System Decoupling** | **`EventBus.js`** (Pub/Sub pattern) | Zero tight coupling between `MapManager`, `WeatherManager`, `TimeOfDayManager`, `PathfindingManager`, `Bus`, `Player`, and UI. |
| **Memory Management** | **`ObjectPool.js`** | Pre-allocated pools for `Zombie` instances, bullets/projectiles, weather particles (rain, snow, sparks), and ground decals (footprints, tire tracks, blood splatters) to prevent GC pauses. |
| **Pathfinding & Dynamic Obstacles** | **`PathfindingManager.js` + `DynamicObstacle.js`** (Incremental OBB Grid Patching + Multi-Goal Dijkstra Flow Field & Local A*) | Updating only the ~12–24 cells covered by the Bus's OBB diff takes `< 0.08ms` per move step, avoiding brute-force full-grid recomputation while ensuring 100+ zombies smoothly route around the moving or parked bus and fallen logs. |
| **Vehicle Physics** | **`VehicleController.js` + `BusController.js` + `VehicleInput.js` + `Bus.js`** | Top-down rigid-body-style inertia with longitudinal acceleration/braking, speed-proportional steering torque, and anisotropic lateral grip (producing realistic drift in corners and extra slip in Heavy Rain / Snow). |
| **Audio Engine** | **Web Audio API Procedural Sound Engine (`SoundManager.js`)** | Synthesizes continuous pitch-modulated bus engine audio, zombie crush impacts, gunfire, thunderclaps, neon electrical buzz, and links directly to a master `BiquadFilterNode` low-pass filter controlled by `WeatherManager` (muffling audio cues in Heavy Rain). |

---

## 2. Ordered List of Files to Create / Modify

### Phase 1: Project Scaffolding, Core Utilities & Data-Driven Map Selection System
1. `package.json` — Project metadata, Vite dev/build/preview scripts.
2. `vite.config.js` — Server bound to `0.0.0.0`, `allowedHosts: true`, public/assets serving.
3. `index.html` & `public/index.html` — Responsive game viewport, Map Selection UI overlay, HUD overlay, and Debug/Telemetry panel.
4. `public/favicon.ico` — Game icon asset.
5. `src/utils/EventBus.js` — Pub/Sub event emitter singleton and class with JSDoc comments.
6. `src/utils/ObjectPool.js` — Generic high-performance object pool with `acquire()`, `release()`, `releaseAll()`, and active iteration.
7. `src/utils/MathUtils.js` — Vector2D math, OBB (Oriented Bounding Box) collision/point tests, angle lerp, clamp, seeded/weighted random helpers.
8. `src/utils/SoundManager.js` — Web Audio API synthesizer with engine pitch oscillator, crush SFX, weapon SFX, thunder SFX, and weather low-pass filter (`setLowPassCutoff`).
9. `assets/maps/registry.json` — Master data-driven registry listing available maps (`terminal-transit`, `neon-night-market`, `blackwood-logging-camp`).
10. `assets/maps/terminal-transit/map.json` (+ `tileset.png`, `layout.png`, `thumbnail.png`) — Data-driven configuration for **Terminal Transit**.
11. `assets/maps/neon-night-market/map.json` (+ `tileset.png`, `layout.png`, `thumbnail.png`) — Data-driven configuration for **Neon Night Market**.
12. `assets/maps/blackwood-logging-camp/map.json` (+ `tileset.png`, `layout.png`, `thumbnail.png`) — Data-driven configuration for **Blackwood Logging Camp**.
13. `src/systems/map/MapManager.js` — Fetches map JSONs, validates schema, instantiates map geometry/zones/interactables, and broadcasts `map:loaded` / `map:unloaded` via `EventBus`.
14. `src/systems/map/MapSelectionUI.js` — Interactive Map Selection modal/screen with map cards, difficulty ratings, mechanics breakdown, custom JSON map registration support, and launch trigger.

### Phase 2: Pathfinding, Entities, "Terminal Transit" & Drivable Armored Bus
15. `src/systems/pathfinding/DynamicObstacle.js` — Tracks an entity's oriented bounding box (`x, y, width, height, angle`) and computes dirty cell diffs when moved beyond threshold.
16. `src/systems/pathfinding/PathfindingManager.js` — Grid representation, static wall rasterization, incremental `DynamicObstacle` cell patching, flow-field / A* queries with local obstacle avoidance.
17. `src/entities/Bus.js` — Bus entity state (HP/durability, fuel, position, velocity, heading, angular velocity, headlights, plow hitbox, passenger/driver state, repair/refuel interaction).
18. `src/systems/vehicle/VehicleInput.js` — Captures throttle (`W/S`), steering (`A/D`), handbrake drift (`Space`), horn (`H`), and exit (`E`) inputs when driving.
19. `src/systems/vehicle/VehicleController.js` — Reusable top-down inertia & anisotropic drift physics solver with weather surface friction and drift slip modifiers.
20. `src/systems/vehicle/BusController.js` — Orchestrates `Bus` entity, `VehicleController`, `DynamicObstacle` incremental pathfinding updates, speed-based zombie crushing/knockback, durability damage from zombies, fuel consumption, station repair/refuel, camera lead, and engine audio pitch.
21. `src/entities/Player.js` — Top-down player controller (movement, aiming, shooting, weapon inventory, Pack-a-Punch upgrades, points economy, interactables `F`, bus entry/exit `E`, elevation state, trap root state).
22. `src/entities/Zombie.js` — Pooled zombie entity with variants (`walker`, `runner`, `brute`, `small`, `night_stalker`), barrier teardown, pathfinding steering around the bus, climb behavior for fire escapes, and crush/ragdoll knockback.

### Phase 3: Additional Maps ("Neon Night Market" & "Blackwood Logging Camp") Environmental Mechanics
23. `src/systems/map/MapMechanicsController.js` — Data-driven processor that activates map-specific environmental objects defined in each map's `map.json`:
    - **Neon Night Market:** Destructible neon signs (shootable HP -> falls -> crushes -> creates timed electrical hazard zone that expands in rain), Elevated Fire Escapes (stairs/ladders -> +25% player accuracy & +20% damage bonus, slow zombie climb), and the 3-node Cyber Shrine Easter Egg interactable.
    - **Blackwood Logging Camp:** Bear traps (damage + 3.5s root for zombies and players, re-armable), Shootable Support Beams / Falling Trees (directional crush sweep + spawns dynamic pathfinding obstacle for cover/blocking), Mud Patches (-40% movement speed for players and zombies + footprints), and Elevated Escape Zipline (fast traversal between sawmill platforms).

### Phase 4: Dynamic Weather System
24. `src/systems/weather/WeatherState.js` — Defines baseline & modifier profiles for `clear`, `rain` (Heavy Rain), `fog` (Dense Fog), `thunderstorm`, and `snow`, plus smooth lerp interpolation and JSON serialization.
25. `src/systems/weather/effects/RainEffect.js` — Pooled rain streaks, ground splash rings, screen wetness vignette, and `-15%` player accuracy / `+10%` vehicle drift / muffled audio modifiers.
26. `src/systems/weather/effects/FogEffect.js` — Rolling fog clouds, camera visibility radius reduction to `40%`, and `30%` closer undetected zombie spawning.
27. `src/systems/weather/effects/StormEffect.js` — Rain + screen lightning flashes + open-sky lightning strike scheduler (every 10–20s, 1.5s ground warning telegraph, `150` damage AoE in non-roofed areas).
28. `src/systems/weather/effects/SnowEffect.js` — Pooled drifting snowflakes, frost tint overlay, `-25%` movement speed modifier for all entities, and persistent ground footprints/tire tracks.
29. `src/systems/weather/WeatherManager.js` — Weather FSM with timer & wave-threshold transitions, 5–10s smooth blending, `EventBus` broadcasts, serialization, URL param (`?weather=`) and console/UI debug hooks.

### Phase 5: Day/Night Cycle, Flashlight, Night Stalker AI & Final Verification
30. `src/systems/time/FlashlightController.js` — Toggleable (`L`) directional light cone at night/fog with battery drain, low-battery flicker, recharge when off, and battery pickups.
31. `src/systems/time/NightStalkerAI.js` — Night-exclusive zombie variant (`19:00–06:00`) with high speed (`1.55x`), enhanced damage (`1.6x`), tactical flank/leap behavior, and glowing crimson visual signature.
32. `src/systems/time/TimeOfDayManager.js` — Continuous and wave-based clock (`00:00–24:00`), Day (`06:00–17:00`), Dusk (`17:00–19:00`, orange tint, long shadows, `+10%` spawn rate), and Night (`19:00–06:00`, darkness mask, `+50%` spawn rate, flashlight enable, Night Stalker unlocks), plus debug time controls.
33. `src/main.js` — Master game loop, multi-layer Canvas renderer, camera controller (with bus velocity lead), wave spawner, HUD & debug console bindings (`window.debug`), and stress-test mode (`100+` zombies benchmark).
34. Documentation & Phase Reports:
    - `AGENT_PHASE1_REPORT.md` through `AGENT_PHASE5_REPORT.md`
    - `AGENT_DOCUMENTATION.md`
    - `AGENT_DEVIATIONS.md`
    - `AGENT_COMPLETION_REPORT.md`

---

## 3. System Dependencies Graph

```text
EventBus.js (Core Pub/Sub)
  ├── MapManager.js <── MapSelectionUI.js
  │     └── Loads /assets/maps/<id>/map.json
  │           ├── Initializes PathfindingManager.js + DynamicObstacle.js
  │           ├── Initializes BusController.js + VehicleController.js + Bus.js (on Terminal Transit)
  │           └── Initializes MapMechanicsController.js (Doors, PaP, Power, Neon Signs, Fire Escapes, Bear Traps, Trees, Ziplines, Mud)
  ├── WeatherManager.js ──> WeatherState.js + [RainEffect, FogEffect, StormEffect, SnowEffect]
  │     └── Broadcasts 'weather:updated' (accuracy, speed, drift, visibility, spawn distance, audio cutoff, tracks)
  └── TimeOfDayManager.js ──> FlashlightController.js + NightStalkerAI.js
        └── Broadcasts 'time:updated' (ambient darkness, shadow length, spawn rate +10%/+50%, night stalker enable)
```

---

## 4. Estimated Complexity Per Task

| Phase / Task | Complexity | Key Technical Risk & Mitigation |
|--------------|------------|---------------------------------|
| **Phase 1: Map Selection System & JSON Schema** | Medium | Ensuring zero hardcoded map logic in JS -> All geometry, interactables, mechanics, and weather weights live in `map.json`. |
| **Phase 2: Terminal Transit & Drivable Bus** | High | Preventing pathfinding lag when bus moves -> Incremental OBB cell diffing in `DynamicObstacle.js` + `PathfindingManager.js`. |
| **Phase 3: Neon Night Market & Blackwood Logging Camp** | Medium-High | Supporting diverse environmental mechanics data-driven from JSON -> Polymorphic hazard handlers in `MapMechanicsController.js`. |
| **Phase 4: Dynamic Weather System** | Medium | Keeping particle FX & surface tracks at 60 FPS -> Fixed-capacity `ObjectPool` instances and adaptive particle budgets. |
| **Phase 5: Day/Night Cycle & Verification** | Medium | Rendering smooth darkness + radial player vision + directional flashlight/headlight cones -> Offscreen lighting canvas composited with `destination-out` gradients. |
