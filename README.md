# Dead Transit // Top-Down 3D/2.5D Browser Zombie Survival Game

A modular, data-driven top-down zombie survival web game built with native ES Modules, Vite, HTML5 Canvas multi-layer compositing, and Web Audio API procedural synthesis.

## 🚀 Features
1. **Data-Driven Map Selection System (`src/systems/map/MapManager.js`, `MapSelectionUI.js`)**
   - Maps are defined in `/assets/maps/registry.json` and `/assets/maps/<id>/map.json`.
   - Adding a new map requires **only** a new JSON file and assets (or uploading a custom `.json` directly in the Map Selection UI).
2. **Map 1: "Terminal Transit" & Drivable Armored Bus (`src/systems/vehicle/BusController.js`)**
   - Top-down inertia and anisotropic drift physics (`Space` for handbrake drift).
   - Incremental Oriented Bounding Box (OBB) dynamic obstacle patching in `PathfindingManager.js` — zombies pathfind around the bus without full-grid recomputation.
   - Speed-based zombie crushing & knockback (small/standard zombies insta-killed at speed).
   - Bus durability (HP) & fuel consumption with Repair Bays and Fuel Stations.
   - Subway Entrance, Bus Depot, City Street Loop, Open Civic Plaza, 2 Power Switches, 3 Pack-a-Punch vaults, point-locked doors, and wall weapons.
3. **Map 2: "Neon Night Market" (`assets/maps/neon-night-market/map.json`)**
   - Shootable overhanging **Neon Signs** that crash down and create **Electrical Hazard Zones** (DoT, radius expanded in rain).
   - Elevated **Fire Escapes** granting **+25% accuracy** and **+20% damage** while zombies climb slowly.
   - 3-node **Cyber Shrine Main Easter Egg**.
4. **Map 3: "Blackwood Logging Camp" (`assets/maps/blackwood-logging-camp/map.json`)**
   - **Bear Traps** on the ground (heavy damage + 3.5s root for zombies and players, re-armable with `F`).
   - **Shootable Support Beams** that fell massive trees, crushing enemies and creating dynamic pathfinding cover/blockers.
   - **Mud Patches** reducing movement speed by **40%** for players and zombies.
   - High-speed **Escape Ziplines** between elevated platforms.
5. **Dynamic Weather System (`src/systems/weather/WeatherManager.js`)**
   - Smooth 5–10s transitions between **Clear**, **Heavy Rain** (`-15%` accuracy, `+10%` vehicle drift, muffled audio), **Dense Fog** (`40%` visibility radius, `30%` closer spawns), **Thunderstorm** (`150` DMG open-sky lightning strikes every 10–20s), and **Snow** (`-25%` movement speed, visible footprints).
6. **Day/Night Cycle (`src/systems/time/TimeOfDayManager.js`)**
   - **Day (06:00–17:00)**, **Dusk (17:00–19:00)** (`+10%` spawn rate, orange tint, long shadows), and **Night (19:00–06:00)** (`+50%` spawn rate, darkness mask, toggleable **Flashlight `[L]`** with battery drain, and fast flanking/pouncing **Night Stalker** zombie variant).

## 🛠️ Running Locally
```bash
npm install
npm run dev
```

## Documentation
- [`AGENT_DISCOVERY.md`](./AGENT_DISCOVERY.md) — Codebase discovery findings
- [`AGENT_PLAN.md`](./AGENT_PLAN.md) — Implementation plan & system dependency graph
- [`AGENT_DOCUMENTATION.md`](./AGENT_DOCUMENTATION.md) — Public API & debug command reference
- [`AGENT_COMPLETION_REPORT.md`](./AGENT_COMPLETION_REPORT.md) — Final acceptance criteria verification report
