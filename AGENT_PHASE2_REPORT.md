# AGENT PHASE 2 REPORT (`AGENT_PHASE2_REPORT.md`)

**Phase:** 2 — "Terminal Transit" + Drivable Armored Bus + Incremental Pathfinding  
**Status:** Completed ✅

---

## 1. Summary of Work Implemented
1. **Incremental Dynamic Obstacle Pathfinding (`DynamicObstacle.js`, `PathfindingManager.js`):**
   - Implemented `DynamicObstacle` with Oriented Bounding Box (OBB) cell rasterization and threshold-gated incremental diff calculation (`added` vs `removed` cells).
   - Implemented `PathfindingManager` with static wall baking, `O(k)` incremental dynamic obstacle patching (never recomputing the entire grid), cached path version invalidation, bounded 8-way A*, and tangential dynamic obstacle avoidance around the bus hull.
2. **Drivable Armored Bus (`Bus.js`, `VehicleInput.js`, `VehicleController.js`, `BusController.js`):**
   - Inertia-based top-down vehicle physics with longitudinal acceleration, braking, reverse, speed-proportional steering, and anisotropic lateral grip producing visible cornering drift (plus `Space` handbrake drift and tire skid marks).
   - Speed-based zombie crushing: zombies hit by the moving bus take damage and knockback; small/standard zombies are insta-killed at lethal speeds; increments `bus.crushKills` and emits `bus:zombieCrushed`.
   - Durability (`health` / `maxHealth`) damaged by zombies and repaired at Bus Repair Stations.
   - Fuel system (`fuel` / `maxFuel`) drained while driving and refueled at designated Fuel Stations.
   - Entry/exit with `E` near the driver seat; camera target includes velocity-based look-ahead lead; Web Audio engine synthesizer modulates pitch with speed and throttle.
3. **Core Entities (`Player.js`, `Zombie.js`):**
   - `Player` supports 5 weapon classes, Pack-a-Punch upgrades, accuracy/speed modifiers, and bus entry/exit.
   - `Zombie` is fully object-pooled with 5 variants (`small`, `walker`, `runner`, `brute`, `night_stalker`) that dynamically route around the bus.

## 2. Files Created / Modified
- `src/systems/pathfinding/DynamicObstacle.js`
- `src/systems/pathfinding/PathfindingManager.js`
- `src/entities/Bus.js`
- `src/systems/vehicle/VehicleInput.js`
- `src/systems/vehicle/VehicleController.js`
- `src/systems/vehicle/BusController.js`
- `src/entities/Player.js`
- `src/entities/Zombie.js`

## 3. Next Steps for Phase 3
- Implement `src/systems/map/MapMechanicsController.js` to drive all interactive map mechanics across **Terminal Transit**, **Neon Night Market** (destructible neon signs + electrical hazards, elevated fire escapes, Cyber Shrine Easter Egg), and **Blackwood Logging Camp** (bear traps, shootable falling trees with dynamic pathfinding obstacles, mud patches, and escape ziplines).
