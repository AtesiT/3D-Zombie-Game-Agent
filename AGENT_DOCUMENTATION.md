# AGENT TECHNICAL DOCUMENTATION (`AGENT_DOCUMENTATION.md`)

## 1. Architecture Overview
The browser-based top-down zombie survival game is built with **native ES Modules (`import`/`export`)**, bundled and served via **Vite**, and rendered using a **7-pass HTML5 Canvas 2D compositing pipeline** with `ObjectPool` memory management and a zero-coupling `EventBus`.

```text
/src/
  main.js                                   # Master loop, 7-pass renderer, Wave Spawner, HUD & window.debug API
  styles.css                                # Responsive tactical HUD & Map Selection UI styling
  /systems/
    /map/
      MapManager.js                         # Fetches /assets/maps/*.json, validates schema, emits map events
      MapSelectionUI.js                     # Map selection modal + runtime custom map.json import
      MapMechanicsController.js             # Doors, Wall Weapons, Power, PaP, Neon Signs, Fire Escapes, Traps, Trees, Mud, Ziplines
    /vehicle/
      VehicleInput.js                       # WASD, Space (handbrake drift), H (horn), E (enter/exit)
      VehicleController.js                  # Top-down inertia & anisotropic lateral grip/drift physics
      BusController.js                      # Bus crushing, fuel, armor repair, camera lead, audio pitch & DynamicObstacle sync
    /weather/
      WeatherState.js                       # Clear, Heavy Rain, Dense Fog, Thunderstorm, Snow profiles & smoothStep lerp
      WeatherManager.js                     # Weather FSM, 5-10s transitions, JSON serialization, EventBus publisher
      /effects/
        RainEffect.js                       # Pooled rain streaks & ground splash ripples
        FogEffect.js                        # Volumetric fog banks & 40% visibility radius vignette
        StormEffect.js                      # Open-sky lightning strikes (10-20s interval, 150 DMG) & screen flash
        SnowEffect.js                       # Pooled snowflakes & frost tint
    /time/
      TimeOfDayManager.js                   # 24h clock, Day/Dusk/Night phases, shadow length & +10%/+50% spawn rate modifiers
      FlashlightController.js               # Toggleable [L] cone of light + battery drain/flicker/recharge
      NightStalkerAI.js                     # Night-exclusive fast flanking & pouncing zombie variant
    /pathfinding/
      DynamicObstacle.js                    # OBB grid cell rasterizer & threshold-gated incremental cell diff calculator
      PathfindingManager.js                 # Static wall baking, O(k) incremental DynamicObstacle patching, bounded A*
  /entities/
    Player.js                               # Top-down player, 5 weapons, Pack-a-Punch, accuracy/speed modifiers
    Zombie.js                               # Pooled zombie entity ('small', 'walker', 'runner', 'brute', 'night_stalker')
    Bus.js                                  # Armored Transit Bus state (HP, fuel, velocity, drift angle, crush counter)
  /utils/
    EventBus.js                             # Pub/Sub EventEmitter + DOM CustomEvent dispatcher
    ObjectPool.js                           # Pre-warmed zero-allocation object pool with O(1) swap-remove
    MathUtils.js                            # Circle vs Rect, Circle vs OBB, segment raycast, smoothStep, angle math
    SoundManager.js                         # Web Audio API synth (bus engine RPM pitch, crush SFX, weather low-pass filter)
```

---

## 2. System API Reference

### 2.1 `MapManager` (`src/systems/map/MapManager.js`)
- `await mapManager.loadRegistry(url)` — Loads `/assets/maps/registry.json` and emits `map:registryLoaded`.
- `await mapManager.loadMap(mapId)` — Loads `/assets/maps/<mapId>/map.json`, validates required fields (`id`, `name`, `scene`, `uniqueMechanics`, `musicTrack`, `background`, `thumbnail`), deep-clones runtime state, and emits `map:loaded`.
- `mapManager.registerCustomMap(mapJson)` — Registers a new map from a JSON object at runtime with zero code changes.
- `mapManager.isPointRoofed(x, y)` — Returns `true` if `(x, y)` is inside an indoor/roofed zone (protecting entities from Thunderstorm lightning strikes).

### 2.2 Incremental Pathfinding (`PathfindingManager.js` & `DynamicObstacle.js`)
- `dynamicObstacle.computeIncrementalCellDiff(cellSize, cols, rows)` — Computes only the `added` and `removed` grid cell indices for an Oriented Bounding Box (OBB) when the obstacle moves `>= 6px` or rotates `>= 0.05 rad`.
- `pathfindingManager.updateDynamicObstacle(obstacle)` — Applies the `added` and `removed` cell diff in $O(k)$ time (typically 2–16 cells) and increments `globalVersion` so only paths intersecting newly blocked cells are recomputed.
- `pathfindingManager.computeDynamicAvoidanceSteering(ax, ay, dirX, dirY, clearance)` — Provides smooth tangential steering around the bus hull and fallen logs.

### 2.3 Drivable Armored Bus (`BusController.js`, `VehicleController.js`, `Bus.js`)
- **Physics:** Longitudinal acceleration/braking/reverse + speed-proportional steering torque + anisotropic lateral velocity damping (`normalGrip: 0.86`, `driftGrip: 0.28`, modulated by Heavy Rain's `+10%` drift modifier).
- **Zombie Crushing:** Above `minCrushSpeed`, impacts deal speed-proportional `VehicleCrush` damage and knockback; `small`, `walker`, and `runner` zombies hit above `instaKillSmallSpeed` are insta-killed.
- **Durability & Fuel:** Zombies attacking a slow/parked bus reduce `bus.health`; driving drains `bus.fuel`. Parking inside **Bus Repair Stations** or **Fuel Stations** restores armor and fuel.

### 2.4 Dynamic Weather System (`WeatherManager.js`, `WeatherState.js`)
| Weather Key | Visual Effect | Gameplay Modifier |
|-------------|---------------|-------------------|
| `clear` | Baseline | `1.0x` accuracy, `1.0x` speed, `1.0x` visibility, `20000 Hz` audio |
| `rain` | Pooled rain streaks + ripples + blue tint | `-15%` player accuracy (`0.85x`), `+10%` vehicle drift, muffled audio (`1800 Hz` low-pass) |
| `fog` | Drifting fog clouds + radial fog vignette | Visibility radius shrinks to `40%`; zombies spawn `30%` closer undetected (`0.70x`) |
| `thunderstorm` | Rain + screen flash + warning rings + bolts | Random lightning strikes every 10–20s in open areas dealing `150` damage |
| `snow` | Pooled snowflakes + frost tint | `-25%` movement speed (`0.75x`) for all entities + ground footprints/tire tracks |

### 2.5 Day/Night Cycle (`TimeOfDayManager.js`, `FlashlightController.js`, `NightStalkerAI.js`)
- **Day (`06:00–17:00`):** Full brightness, `1.0x` spawn rate.
- **Dusk (`17:00–19:00`):** Warm orange tint, `2.6x` long directional shadows, `+10%` zombie spawn rate.
- **Night (`19:00–06:00`):** `0.78` darkness overlay, `+50%` zombie spawn rate, player **Flashlight** (`[L]` key, directional cone + battery drain), and **Night Stalker** zombie variant spawns.

---

## 3. Debug Console & URL Parameter Reference

### URL Parameters
- `?map=terminal-transit` | `neon-night-market` | `blackwood-logging-camp`
- `?weather=clear` | `rain` | `fog` | `thunderstorm` | `snow`
- `?time=day` | `dusk` | `night` | `22.5`
- `?select=1` (Opens the Map Selection modal on startup)

### Browser Console Commands (`window.debug`)
```js
window.debug.loadMap('neon-night-market');
window.debug.setWeather('thunderstorm', false); // Smooth 6s transition
window.debug.triggerLightning(false);           // Telegraph + 150 DMG lightning strike
window.debug.serializeWeather();                // Returns JSON state
window.debug.setTime('night');                  // Jump to 22:30 Nightfall
window.debug.pauseTime(true);                   // Pause clock
window.debug.toggleFlashlight();                // Toggle flashlight cone
window.debug.spawnZombies(100);                 // Spawn 100 pooled zombies
window.debug.enterBus();                        // Board Armored Bus on Terminal Transit
window.debug.runBusCrushVerification(14);       // Auto-drive & crush 10+ zombies
window.debug.getTelemetry();                    // Inspect live FPS, pool counts & modifiers
```
