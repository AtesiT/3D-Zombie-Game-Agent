/**
 * @fileoverview Main Game Orchestrator & Multi-Layer Canvas Renderer (`src/main.js`).
 * Coordinates MapManager, MapSelectionUI, PathfindingManager, BusController,
 * MapMechanicsController, WeatherManager, TimeOfDayManager, FlashlightController,
 * NightStalkerAI, ObjectPool instances, and the `window.debug` verification API.
 */

import { EventBus } from './utils/EventBus.js';
import { ObjectPool } from './utils/ObjectPool.js';
import { MathUtils } from './utils/MathUtils.js';
import { soundManager } from './utils/SoundManager.js';

import { MapManager } from './systems/map/MapManager.js';
import { MapSelectionUI } from './systems/map/MapSelectionUI.js';
import { MapMechanicsController } from './systems/map/MapMechanicsController.js';

import { PathfindingManager } from './systems/pathfinding/PathfindingManager.js';
import { BusController } from './systems/vehicle/BusController.js';

import { WeatherManager } from './systems/weather/WeatherManager.js';
import { TimeOfDayManager } from './systems/time/TimeOfDayManager.js';
import { FlashlightController } from './systems/time/FlashlightController.js';
import { NightStalkerAI } from './systems/time/NightStalkerAI.js';

import { Player } from './entities/Player.js';
import { Zombie } from './entities/Zombie.js';

export class ZombieSurvivalGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    // Offscreen darkness/lighting composite canvas for Night & Dense Fog
    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d');

    this.viewportW = window.innerWidth;
    this.viewportH = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Core systems
    this.eventBus = EventBus;
    this.mapManager = new MapManager(this.eventBus);
    this.pathfindingManager = new PathfindingManager(2400, 1800, 40);
    this.busController = new BusController({
      pathfindingManager: this.pathfindingManager,
      eventBus: this.eventBus
    });
    this.mapMechanics = new MapMechanicsController({
      mapManager: this.mapManager,
      pathfindingManager: this.pathfindingManager,
      eventBus: this.eventBus
    });
    this.weatherManager = new WeatherManager({
      eventBus: this.eventBus,
      transitionDuration: 6.0,
      cycleIntervalSeconds: 75
    });
    this.timeManager = new TimeOfDayManager({
      eventBus: this.eventBus,
      initialHours: 9.5,
      realSecondsPerGameHour: 28
    });
    this.flashlight = new FlashlightController({ eventBus: this.eventBus });
    this.nightStalkerAI = new NightStalkerAI();

    // Entities & Object Pools
    this.player = new Player(1020, 920);
    this.zombiePool = new ObjectPool(
      () => new Zombie(),
      (z) => z.reset(),
      140,
      320
    );
    this.projectilePool = new ObjectPool(
      () => ({ x: 0, y: 0, vx: 0, vy: 0, damage: 30, color: '#fbbf24', pierce: 1, life: 1 }),
      null,
      96,
      256
    );
    this.decalPool = new ObjectPool(
      () => ({ type: 'snow_footprint', x: 0, y: 0, angle: 0, alpha: 0.5, life: 12 }),
      null,
      128,
      320
    );
    this.floatingTextPool = new ObjectPool(
      () => ({ text: '', x: 0, y: 0, color: '#fff', life: 1.1, maxLife: 1.1 }),
      null,
      32,
      80
    );

    // Camera state (with smooth damping & bus velocity lead)
    this.camera = { x: 1020, y: 920 };

    // Wave Spawner state
    this.wave = 1;
    this.waveZombiesRemainingToSpawn = 14;
    this.spawnTimer = 0.8;
    this.baseSpawnInterval = 1.65;

    // Input state
    this.keys = new Set();
    this.mouseScreenX = this.viewportW * 0.5;
    this.mouseScreenY = this.viewportH * 0.5;
    this.mouseWorldX = 1020;
    this.mouseWorldY = 920;
    this.mouseDown = false;

    // Telemetry
    this.fps = 60;
    this._frameCount = 0;
    this._fpsAccum = 0;
    this._lastFrameTime = performance.now();

    // Map Selection UI
    this.mapSelectionUI = new MapSelectionUI(this.mapManager, this.eventBus);

    this._bindEvents();
    this._handleResize();
  }

  /**
   * Initialize the game, load registry, apply URL params, and start the main loop.
   */
  async init() {
    const mapRoot = document.getElementById('map-selection-root');
    this.mapSelectionUI.mount(mapRoot);

    await this.mapManager.loadRegistry();

    const params = new URLSearchParams(window.location.search);
    const initialMap = params.get('map') || 'terminal-transit';
    await this.mapManager.loadMap(initialMap);

    // Apply optional debug URL parameters (?weather=...&time=...&select=1)
    if (params.get('weather')) {
      this.weatherManager.setWeather(params.get('weather'), { immediate: true });
    }
    if (params.get('time')) {
      this.timeManager.setTime(params.get('time'));
    }
    if (params.get('select') === '1') {
      this.mapSelectionUI.show();
    } else {
      // Show map selection UI only when requested or keep accessible via [M] button,
      // while also having the default map immediately loaded underneath.
    }

    this._exposeDebugAPI();
    requestAnimationFrame((ts) => this._loop(ts));
  }

  /**
   * Bind DOM, keyboard, mouse, and EventBus listeners.
   * @private
   */
  _bindEvents() {
    window.addEventListener('resize', () => this._handleResize());

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      soundManager.ensureContext();

      if (e.code === 'KeyE') {
        this.busController.togglePlayerEnterExit(this.player);
      } else if (e.code === 'KeyF') {
        this.mapMechanics.tryInteract(
          this.player,
          this.zombiePool.getActive(),
          (x, y, text, color) => this.spawnFloatingText(x, y, text, color)
        );
      } else if (e.code === 'KeyL') {
        this.flashlight.toggle();
      } else if (e.code === 'KeyM') {
        if (this.mapSelectionUI.isVisible) {
          this.mapSelectionUI.hide();
        } else {
          this.mapSelectionUI.show();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        soundManager.ensureContext();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    });

    // When a map finishes loading, initialize all map-dependent subsystems
    this.eventBus.on('map:loaded', ({ map }) => {
      const w = map.worldSize?.width || 2400;
      const h = map.worldSize?.height || 1800;
      const cell = map.worldSize?.gridCellSize || 40;

      this.pathfindingManager.initGrid(w, h, cell);
      this.pathfindingManager.bakeStaticColliders(this.mapManager.getSolidColliders());

      this.zombiePool.releaseAll();
      this.projectilePool.releaseAll();
      this.decalPool.releaseAll();
      this.floatingTextPool.releaseAll();

      const spawnX = map.playerSpawn?.x || w * 0.5;
      const spawnY = map.playerSpawn?.y || h * 0.5;
      this.player.reset(spawnX, spawnY);
      this.camera.x = spawnX;
      this.camera.y = spawnY;

      this.busController.initForMap(map);
      this.mapMechanics.initForMap(map);
      this.weatherManager.configureForMap(map);
      this.timeManager.setTime(map.startingTimeHours ?? 9.5);

      this.wave = 1;
      this.waveZombiesRemainingToSpawn = 16;
      this.spawnTimer = 0.5;

      this.spawnFloatingText(spawnX, spawnY - 32, `SECTOR LOADED: ${map.name.toUpperCase()}`, '#38bdf8');
    });

    // Bind Debug & HUD buttons
    document.getElementById('btn-open-map-select')?.addEventListener('click', () => {
      this.mapSelectionUI.show();
    });

    document.querySelectorAll('[data-debug-weather]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = btn.getAttribute('data-debug-weather');
        this.weatherManager.setWeather(w);
      });
    });

    document.getElementById('btn-debug-lightning')?.addEventListener('click', () => {
      this.weatherManager.triggerDebugLightningStrike(this.player, false);
    });

    document.querySelectorAll('[data-debug-time]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-debug-time');
        this.timeManager.setTime(t);
      });
    });

    document.getElementById('btn-debug-pause-time')?.addEventListener('click', (e) => {
      const paused = this.timeManager.setPaused();
      e.currentTarget.textContent = paused ? '▶️ Resume Clock' : '⏸️ Pause Clock';
    });

    document.getElementById('btn-debug-flashlight')?.addEventListener('click', () => {
      this.flashlight.toggle();
    });

    document.getElementById('btn-debug-enter-bus')?.addEventListener('click', () => {
      if (!this.busController.bus) {
        this.spawnFloatingText(this.player.x, this.player.y - 24, 'Bus is on Terminal Transit!', '#facc15');
        return;
      }
      // Teleport close if needed, then toggle entry/exit
      if (!this.player.inVehicle && !this.busController.canPlayerEnter(this.player)) {
        const door = this.busController.bus.getDriverDoorPosition();
        this.player.x = door.x;
        this.player.y = door.y;
      }
      this.busController.togglePlayerEnterExit(this.player);
    });

    document.getElementById('btn-debug-spawn-25')?.addEventListener('click', () => {
      this.spawnZombieBatch(25);
    });

    document.getElementById('btn-debug-spawn-100')?.addEventListener('click', () => {
      const current = this.zombiePool.getActive().length;
      const needed = Math.max(25, 110 - current);
      this.spawnZombieBatch(needed);
    });

    document.getElementById('btn-debug-next-wave')?.addEventListener('click', () => {
      this.advanceWave();
    });
  }

  /**
   * Handle window resize and devicePixelRatio scaling.
   * @private
   */
  _handleResize() {
    this.viewportW = window.innerWidth;
    this.viewportH = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(this.viewportW * this.dpr);
    this.canvas.height = Math.floor(this.viewportH * this.dpr);

    this.lightCanvas.width = this.viewportW;
    this.lightCanvas.height = this.viewportH;
  }

  /**
   * Spawn floating world-space status text.
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {string} [color='#facc15']
   */
  spawnFloatingText(x, y, text, color = '#facc15') {
    const ft = this.floatingTextPool.acquire();
    ft.x = x;
    ft.y = y;
    ft.text = text;
    ft.color = color;
    ft.life = 1.25;
    ft.maxLife = 1.25;
  }

  /**
   * Emit a pooled ground decal (snow footprint, mud footprint, tire skid, blood splatter).
   * @param {{type:string, x:number, y:number, angle:number, alpha?:number}} spec
   */
  emitDecal(spec) {
    const d = this.decalPool.acquire();
    d.type = spec.type;
    d.x = spec.x;
    d.y = spec.y;
    d.angle = spec.angle || 0;
    d.alpha = spec.alpha ?? 0.55;
    d.life = 14.0;
  }

  /**
   * Advance to the next survival wave, triggering time-of-day progression and weather checks.
   */
  advanceWave() {
    this.wave++;
    this.waveZombiesRemainingToSpawn += 12 + this.wave * 4;
    this.timeManager.onWaveAdvanced();
    if (this.wave % 2 === 0) {
      this.weatherManager.rollNextWeather();
    }
    this.spawnFloatingText(this.player.x, this.player.y - 36, `🌊 WAVE ${this.wave} STARTED!`, '#f43f5e');
    this.eventBus.emit('wave:started', { wave: this.wave });
  }

  /**
   * Spawn a single zombie at a valid map spawn point or ring around the player.
   * Respects Dense Fog's `spawnDistanceMultiplier` (30% closer spawns) and Night's `NightStalker` unlock.
   * @param {string} [forcedVariant]
   * @returns {Zombie}
   */
  spawnSingleZombie(forcedVariant = null) {
    const map = this.mapManager.getCurrentMap();
    const w = map?.worldSize?.width || 2400;
    const h = map?.worldSize?.height || 1800;
    const weatherState = this.weatherManager.getState();
    const timeState = this.timeManager.getState();

    // Base minimum spawn distance shrinks by 30% in Dense Fog (spawnDistanceMultiplier = 0.70)
    const minSpawnDist = 340 * (weatherState.spawnDistanceMultiplier || 1.0);

    let spawnX = 200;
    let spawnY = 200;

    const spawnPoints = map?.spawnPoints || [];
    if (spawnPoints.length > 0 && Math.random() < 0.65) {
      // Pick a spawn point at least minSpawnDist away, or fallback to random spawn point
      const validPts = spawnPoints.filter(
        (sp) => MathUtils.dist(sp.x, sp.y, this.player.x, this.player.y) >= minSpawnDist * 0.7
      );
      const chosen =
        validPts.length > 0
          ? validPts[Math.floor(Math.random() * validPts.length)]
          : spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
      spawnX = chosen.x + (Math.random() - 0.5) * 40;
      spawnY = chosen.y + (Math.random() - 0.5) * 40;
    } else {
      // Ring spawn at minSpawnDist around player (closer during Dense Fog!)
      const angle = Math.random() * Math.PI * 2;
      const dist = minSpawnDist + Math.random() * 140;
      spawnX = MathUtils.clamp(this.player.x + Math.cos(angle) * dist, 60, w - 60);
      spawnY = MathUtils.clamp(this.player.y + Math.sin(angle) * dist, 60, h - 60);
    }

    let variant = forcedVariant;
    if (!variant) {
      if (this.nightStalkerAI.shouldSpawnNightStalker(timeState.allowNightStalkers, this.wave)) {
        variant = 'night_stalker';
      } else {
        const roll = Math.random();
        if (roll < 0.28) variant = 'small';
        else if (roll < 0.72) variant = 'walker';
        else if (roll < 0.90) variant = 'runner';
        else variant = 'brute';
      }
    }

    const z = this.zombiePool.acquire();
    z.spawn({ x: spawnX, y: spawnY, variant, wave: this.wave });
    return z;
  }

  /**
   * Spawn a batch of zombies immediately (e.g. for 100+ zombie stress test).
   * @param {number} count
   * @param {string} [forcedVariant]
   */
  spawnZombieBatch(count = 25, forcedVariant = null) {
    for (let i = 0; i < count; i++) {
      this.spawnSingleZombie(forcedVariant);
    }
  }

  /**
   * Main requestAnimationFrame loop.
   * @private
   */
  _loop(timestamp) {
    const rawDt = (timestamp - this._lastFrameTime) * 0.001;
    this._lastFrameTime = timestamp;
    const dt = MathUtils.clamp(rawDt, 0.001, 0.05);

    this._frameCount++;
    this._fpsAccum += rawDt;
    if (this._fpsAccum >= 0.4) {
      this.fps = Math.round(this._frameCount / this._fpsAccum);
      this._frameCount = 0;
      this._fpsAccum = 0;
    }

    this.update(dt);
    this.render();
    this._updateHUD();

    requestAnimationFrame((ts) => this._loop(ts));
  }

  /**
   * Update all game systems for dt seconds.
   * @param {number} dt
   */
  update(dt) {
    const map = this.mapManager.getCurrentMap();
    if (!map) return;

    const worldBounds = {
      width: map.worldSize?.width || 2400,
      height: map.worldSize?.height || 1800
    };
    const solidColliders = this.mapManager.getSolidColliders();
    const activeZombies = this.zombiePool.getActive();

    // Update mouse world position
    this.mouseWorldX = this.camera.x - this.viewportW * 0.5 + this.mouseScreenX;
    this.mouseWorldY = this.camera.y - this.viewportH * 0.5 + this.mouseScreenY;

    // 1. Update TimeOfDayManager & FlashlightController
    const timeState = this.timeManager.update(dt);
    this.flashlight.update(dt);

    // 2. Update WeatherManager
    this.weatherManager.update(dt, {
      viewportW: this.viewportW,
      viewportH: this.viewportH,
      player: this.player,
      zombies: activeZombies,
      mapManager: this.mapManager,
      onFloatingText: (x, y, text, color) => this.spawnFloatingText(x, y, text, color)
    });
    const weatherState = this.weatherManager.getState();

    // 3. Wave Spawner (modulated by TimeOfDay spawnRateMultiplier: +10% Dusk, +50% Night)
    const effectiveSpawnInterval = this.baseSpawnInterval / (timeState.spawnRateMultiplier || 1.0);
    if (this.waveZombiesRemainingToSpawn > 0 && activeZombies.length < 180) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = effectiveSpawnInterval;
        this.waveZombiesRemainingToSpawn--;
        this.spawnSingleZombie();
      }
    } else if (this.waveZombiesRemainingToSpawn <= 0 && activeZombies.length === 0) {
      this.advanceWave();
    }

    // 4. Update Player
    this.player.update(dt, {
      keys: this.keys,
      mouseWorldX: this.mouseWorldX,
      mouseWorldY: this.mouseWorldY,
      mouseDown: this.mouseDown && !this.mapSelectionUI.isVisible,
      solidColliders,
      worldBounds,
      emitFootprints: weatherState.emitFootprints,
      onEmitDecal: (spec) => this.emitDecal(spec),
      onSpawnProjectile: (projSpec) => {
        const p = this.projectilePool.acquire();
        Object.assign(p, projSpec);
      }
    });

    // 5. Update Drivable Armored Bus
    this.busController.update(dt, {
      zombies: activeZombies,
      solidColliders,
      worldBounds,
      onEmitDecal: (spec) => this.emitDecal(spec),
      onFloatingText: (x, y, text, color) => this.spawnFloatingText(x, y, text, color)
    });

    // 6. Update Map Environmental Mechanics
    this.mapMechanics.update(dt, {
      player: this.player,
      zombies: activeZombies,
      onFloatingText: (x, y, text, color) => this.spawnFloatingText(x, y, text, color)
    });

    // 7. Update Projectiles
    const activeProjectiles = this.projectilePool.getActive();
    for (let i = activeProjectiles.length - 1; i >= 0; i--) {
      const p = activeProjectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      if (p.life <= 0 || p.x < 0 || p.x > worldBounds.width || p.y < 0 || p.y > worldBounds.height) {
        this.projectilePool.releaseAt(i);
        continue;
      }

      // Check destructible environmental props (Neon Signs / Tree Support Beams)
      if (
        this.mapMechanics.checkProjectileHit(p, activeZombies, this.player, (x, y, t, c) =>
          this.spawnFloatingText(x, y, t, c)
        )
      ) {
        this.projectilePool.releaseAt(i);
        continue;
      }

      // Check solid walls
      let hitWall = false;
      for (let wIdx = 0; wIdx < solidColliders.length; wIdx++) {
        if (MathUtils.pointInRect(p.x, p.y, solidColliders[wIdx])) {
          hitWall = true;
          break;
        }
      }
      if (hitWall) {
        this.projectilePool.releaseAt(i);
        continue;
      }

      // Check zombie hits
      for (let zIdx = activeZombies.length - 1; zIdx >= 0; zIdx--) {
        const z = activeZombies[zIdx];
        if (!z.alive) continue;
        if (MathUtils.distSq(p.x, p.y, z.x, z.y) <= (z.radius + 5) * (z.radius + 5)) {
          const killed = z.takeDamage(p.damage, 'bullet');
          this.player.points += 10;
          if (killed) {
            this.player.points += 50;
            this.player.kills++;
            this.emitDecal({ type: 'blood', x: z.x, y: z.y, angle: Math.random() * 6.28, alpha: 0.55 });
          }
          p.pierce--;
          if (p.pierce <= 0) {
            this.projectilePool.releaseAt(i);
            break;
          }
        }
      }
    }

    // 8. Update Pooled Zombies (and release dead zombies back to pool)
    const targetX = this.player.inVehicle && this.busController.bus ? this.busController.bus.x : this.player.x;
    const targetY = this.player.inVehicle && this.busController.bus ? this.busController.bus.y : this.player.y;

    for (let i = activeZombies.length - 1; i >= 0; i--) {
      const z = activeZombies[i];
      if (!z.alive) {
        this.zombiePool.releaseAt(i);
        continue;
      }
      z.update(dt, {
        targetX,
        targetY,
        player: this.player,
        pathfindingManager: this.pathfindingManager,
        nightStalkerAI: this.nightStalkerAI,
        weatherSpeedMultiplier: weatherState.moveSpeedMultiplier,
        timeSpeedMultiplier: timeState.phase === 'night' ? 1.15 : 1.0,
        solidColliders,
        worldBounds
      });
    }

    // 9. Update Ground Decals & Floating Texts
    const decals = this.decalPool.getActive();
    for (let i = decals.length - 1; i >= 0; i--) {
      decals[i].life -= dt;
      if (decals[i].life <= 0) {
        this.decalPool.releaseAt(i);
      }
    }

    const texts = this.floatingTextPool.getActive();
    for (let i = texts.length - 1; i >= 0; i--) {
      texts[i].y -= 28 * dt;
      texts[i].life -= dt;
      if (texts[i].life <= 0) {
        this.floatingTextPool.releaseAt(i);
      }
    }

    // 10. Smooth Camera Tracking (with velocity look-ahead lead when driving the Armored Bus)
    let desiredCamX = this.player.x;
    let desiredCamY = this.player.y;
    if (this.player.inVehicle && this.busController.bus) {
      const lead = this.busController.getCameraTargetWithLead();
      if (lead) {
        desiredCamX = lead.x;
        desiredCamY = lead.y;
      }
    }

    const camSmooth = MathUtils.clamp(dt * 7.5, 0, 1);
    this.camera.x = MathUtils.lerp(this.camera.x, desiredCamX, camSmooth);
    this.camera.y = MathUtils.lerp(this.camera.y, desiredCamY, camSmooth);
  }

  /**
   * Render all world layers, directional shadows, entities, lighting/darkness mask, and weather FX.
   */
  render() {
    const ctx = this.ctx;
    const map = this.mapManager.getCurrentMap();
    if (!ctx || !map) return;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const vw = this.viewportW;
    const vh = this.viewportH;
    const camLeft = this.camera.x - vw * 0.5;
    const camTop = this.camera.y - vh * 0.5;

    // Clear viewport
    ctx.fillStyle = map.background?.groundColor || '#141923';
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(-camLeft, -camTop);

    // PASS 1: World Base, Grid, Zones, Roads, Mud Patches, Fire Escapes & Decals
    this._renderWorldBase(ctx, map);

    // PASS 2: Dynamic Top-Down Directional Shadows (scaled by TimeOfDay shadowLengthMultiplier)
    this._renderDirectionalShadows(ctx, map);

    // PASS 3: Map Walls, Doors, Stations, Traps, Trees, Ziplines & Neon Signs
    this._renderMapObjects(ctx, map);

    // PASS 4: Entities (Zombies, Projectiles, Player, Drivable Armored Bus)
    this._renderEntities(ctx);

    // PASS 5: World-Space Weather Hazards (Thunderstorm Lightning Strikes)
    this.weatherManager.renderWorld(ctx);

    // Floating combat & interaction texts
    this._renderFloatingTexts(ctx);

    ctx.restore();

    // PASS 6: Day/Night Ambient Tint + Darkness Mask + Flashlight Cone + Bus Headlights
    const focusScreenX = this.player.x - camLeft;
    const focusScreenY = this.player.y - camTop;
    this._renderLightingAndDarkness(ctx, vw, vh, focusScreenX, focusScreenY, camLeft, camTop);

    // PASS 7: Screen-Space Weather FX (Heavy Rain, Blizzard Snow, Dense Fog, Lightning Flash)
    this.weatherManager.renderScreen(ctx, vw, vh, focusScreenX, focusScreenY);

    // Tactical Minimap in bottom-right corner
    this._renderMinimap(ctx, map, vw, vh);

    ctx.restore();
  }

  /**
   * Render world ground, tactical grid, zones, road lanes, mud patches, fire escapes, and decals.
   * @private
   */
  _renderWorldBase(ctx, map) {
    const w = map.worldSize?.width || 2400;
    const h = map.worldSize?.height || 1800;

    // Zones
    for (const z of map.zones || []) {
      ctx.fillStyle = z.floorColor || '#1e293b';
      ctx.fillRect(z.x, z.y, z.w, z.h);

      ctx.strokeStyle = z.accentColor || '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);

      // Road lane markings for Terminal Transit City Street Loop
      if (z.isRoadLoop) {
        ctx.save();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.38)';
        ctx.lineWidth = 3;
        ctx.setLineDash([24, 20]);
        ctx.strokeRect(z.x + 150, z.y + 160, z.w - 300, z.h - 320);
        ctx.restore();
      }

      ctx.fillStyle = 'rgba(248, 250, 252, 0.16)';
      ctx.font = '800 16px Inter, sans-serif';
      ctx.fillText(z.name + (z.roofed ? ' [ROOFED]' : ''), z.x + 18, z.y + 30);
    }

    // Subtle world grid
    ctx.strokeStyle = map.background?.gridColor || 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx <= w; gx += 80) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
    }
    for (let gy = 0; gy <= h; gy += 80) {
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
    }
    ctx.stroke();

    const env = map.environmentalObjects || {};

    // Mud Patches (Blackwood Logging Camp: -40% movement speed)
    for (const mud of env.mudPatches || []) {
      ctx.save();
      ctx.fillStyle = 'rgba(69, 39, 19, 0.78)';
      ctx.strokeStyle = 'rgba(120, 53, 15, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(mud.x, mud.y, mud.rx, mud.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fde68a';
      ctx.font = '700 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🥾 MUD PATCH (-40% SPEED)', mud.x, mud.y + 4);
      ctx.restore();
    }

    // Elevated Fire Escapes (Neon Night Market: +25% accuracy bonus)
    for (const fe of env.fireEscapes || []) {
      ctx.save();
      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.fillRect(fe.x, fe.y, fe.w, fe.h);
      ctx.strokeRect(fe.x, fe.y, fe.w, fe.h);

      // Grating stripes
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.beginPath();
      for (let sy = fe.y + 12; sy < fe.y + fe.h; sy += 14) {
        ctx.moveTo(fe.x, sy);
        ctx.lineTo(fe.x + fe.w, sy);
      }
      ctx.stroke();

      ctx.fillStyle = '#7dd3fc';
      ctx.font = '700 11px Inter, sans-serif';
      ctx.fillText('🪜 FIRE ESCAPE (+25% ACC)', fe.x + 10, fe.y + 20);
      ctx.restore();
    }

    // Ground Decals (Footprints, Tire Skids, Blood)
    const decals = this.decalPool.getActive();
    for (let i = 0; i < decals.length; i++) {
      const d = decals[i];
      const fade = Math.min(1, d.life / 4) * d.alpha;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);
      if (d.type === 'snow_footprint') {
        ctx.fillStyle = `rgba(226, 232, 240, ${fade})`;
        ctx.fillRect(-5, -4, 6, 3);
        ctx.fillRect(1, 2, 6, 3);
      } else if (d.type === 'mud_footprint') {
        ctx.fillStyle = `rgba(92, 52, 24, ${fade})`;
        ctx.fillRect(-5, -4, 6, 3);
        ctx.fillRect(1, 2, 6, 3);
      } else if (d.type === 'tire_skid') {
        ctx.fillStyle = `rgba(15, 23, 42, ${fade})`;
        ctx.fillRect(-8, -28, 14, 7);
        ctx.fillRect(-8, 21, 14, 7);
      } else if (d.type === 'blood') {
        ctx.fillStyle = `rgba(153, 27, 27, ${fade})`;
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * Render directional shadows based on TimeOfDayManager sun angle & shadowLengthMultiplier.
   * @private
   */
  _renderDirectionalShadows(ctx, map) {
    const timeState = this.timeManager.getState();
    const lenMult = timeState.shadowLengthMultiplier || 1.0;
    const sunAngle = timeState.sunAngle || 0.8;
    const offX = Math.cos(sunAngle) * 14 * lenMult;
    const offY = Math.sin(sunAngle) * 14 * lenMult;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';

    for (const w of map.walls || []) {
      ctx.fillRect(w.x + offX, w.y + offY, w.w, w.h);
    }

    if (this.busController.bus) {
      const bus = this.busController.bus;
      ctx.save();
      ctx.translate(bus.x + offX * 1.1, bus.y + offY * 1.1);
      ctx.rotate(bus.angle);
      ctx.fillRect(-bus.width * 0.5, -bus.height * 0.5, bus.width, bus.height);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Render walls, doors, wall weapons, power switches, Pack-a-Punch, stations, and map-specific hazards.
   * @private
   */
  _renderMapObjects(ctx, map) {
    // 1. Static Walls
    for (const w of map.walls || []) {
      ctx.fillStyle = w.color || '#334155';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    // 2. Point-Locked Doors
    for (const door of map.doors || []) {
      if (door.isOpen) {
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(door.x, door.y, door.w, door.h);
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = '#b45309';
        ctx.fillRect(door.x, door.y, door.w, door.h);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.strokeRect(door.x, door.y, door.w, door.h);

        ctx.fillStyle = '#fef08a';
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🔒 ${door.cost} PTS`, door.x + door.w * 0.5, door.y + door.h * 0.5 + 4);
      }
    }

    // 3. Vehicle Repair & Fuel Stations (Terminal Transit)
    for (const st of map.vehicleStations || []) {
      ctx.save();
      ctx.strokeStyle = st.type === 'fuel' ? '#38bdf8' : '#4ade80';
      ctx.fillStyle = st.type === 'fuel' ? 'rgba(56, 189, 248, 0.10)' : 'rgba(74, 222, 128, 0.10)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = st.type === 'fuel' ? '#7dd3fc' : '#86efac';
      ctx.font = '800 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(st.type === 'fuel' ? `⛽ ${st.name}` : `🔧 ${st.name}`, st.x, st.y + 4);
      ctx.restore();
    }

    // 4. Power Switches
    for (const pwr of map.powerLocations || []) {
      ctx.save();
      ctx.fillStyle = pwr.activated ? '#16a34a' : '#dc2626';
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(pwr.x, pwr.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = '700 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pwr.activated ? '⚡ POWER ON' : '⚡ POWER [F]', pwr.x, pwr.y - 26);
      ctx.restore();
    }

    // 5. Pack-a-Punch Machines
    for (const pap of map.packAPunchLocations || []) {
      ctx.save();
      ctx.fillStyle = '#581c87';
      ctx.strokeStyle = '#e879f9';
      ctx.lineWidth = 2.5;
      ctx.fillRect(pap.x - 28, pap.y - 18, 56, 36);
      ctx.strokeRect(pap.x - 28, pap.y - 18, 56, 36);

      ctx.fillStyle = '#f5d0fe';
      ctx.font = '800 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔥 PACK-A-PUNCH [F]', pap.x, pap.y - 24);
      ctx.restore();
    }

    // 6. Wall Weapons
    for (const ww of map.wallWeapons || []) {
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.fillRect(ww.x - 24, ww.y - 14, 48, 28);
      ctx.strokeRect(ww.x - 24, ww.y - 14, 48, 28);

      ctx.fillStyle = '#bae6fd';
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🔫 ${ww.name} (${ww.cost})`, ww.x, ww.y - 18);
      ctx.restore();
    }

    // 7. Spawn Points & Barriers
    for (const sp of map.spawnPoints || []) {
      ctx.save();
      ctx.strokeStyle = sp.type === 'subway_tunnel' ? '#f43f5e' : '#a855f7';
      ctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fda4af';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sp.label, sp.x, sp.y + 34);
      ctx.restore();
    }

    const env = map.environmentalObjects || {};

    // 8. Destructible Neon Signs & Electrical Hazard Zones (Neon Night Market)
    for (const hz of this.mapMechanics.electricalHazards) {
      const r = hz.effectiveRadius || hz.baseRadius;
      ctx.save();
      ctx.fillStyle = 'rgba(6, 182, 212, 0.22)';
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Animated electric arcs
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let a = 0; a < 4; a++) {
        const ang = Math.random() * Math.PI * 2;
        ctx.moveTo(hz.x, hz.y);
        ctx.lineTo(hz.x + Math.cos(ang) * r * 0.85, hz.y + Math.sin(ang) * r * 0.85);
      }
      ctx.stroke();

      ctx.fillStyle = '#67e8f9';
      ctx.font = '800 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`⚡ ELECTRICAL HAZARD (${hz.remainingTime.toFixed(1)}s)`, hz.x, hz.y - 6);
      ctx.restore();
    }

    for (const sign of env.neonSigns || []) {
      if (sign.destroyed) continue;
      ctx.save();
      ctx.shadowColor = sign.color || '#f43f5e';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = sign.color || '#f43f5e';
      ctx.lineWidth = 3;
      ctx.fillRect(sign.x - sign.w * 0.5, sign.y - sign.h * 0.5, sign.w, sign.h);
      ctx.strokeRect(sign.x - sign.w * 0.5, sign.y - sign.h * 0.5, sign.w, sign.h);

      ctx.fillStyle = '#fff';
      ctx.font = '800 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🎯 ${sign.label}`, sign.x, sign.y + 4);
      ctx.restore();
    }

    // 9. Easter Egg Relays (Neon Night Market)
    for (const node of env.easterEggNodes || []) {
      ctx.save();
      ctx.fillStyle = node.activated ? '#10b981' : '#d946ef';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f5d0fe';
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.activated ? '🔮 RELAY ACTIVE' : `🔮 ${node.name} [F]`, node.x, node.y - 22);
      ctx.restore();
    }

    // 10. Bear Traps (Blackwood Logging Camp)
    for (const trap of env.bearTraps || []) {
      ctx.save();
      ctx.strokeStyle = trap.armed ? '#f97316' : '#64748b';
      ctx.fillStyle = trap.armed ? 'rgba(249, 115, 22, 0.24)' : 'rgba(71, 85, 105, 0.25)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(trap.x, trap.y, trap.radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = trap.armed ? '#fed7aa' : '#94a3b8';
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(trap.armed ? '🪤 BEAR TRAP' : '🪤 SPRUNG [F]', trap.x, trap.y - 22);
      ctx.restore();
    }

    // 11. Shootable Support Beams & Fallen Trees (Blackwood Logging Camp)
    for (const tree of env.fallingTrees || []) {
      ctx.save();
      if (!tree.fallen) {
        // Standing tree canopy + shootable red support beam
        ctx.fillStyle = '#14532d';
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tree.x, tree.y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Red shootable support bracket
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(tree.x - 10, tree.y - 10, 20, 20);

        ctx.fillStyle = '#fef08a';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🎯 SHOOT BEAM (${tree.hp} HP)`, tree.x, tree.y - 32);
      } else {
        // Fallen log barrier blocking pathfinding
        const len = tree.trunkLength || 210;
        const width = tree.trunkWidth || 46;
        const cx = tree.centerX ?? tree.x + Math.cos(tree.fallAngle || 0) * len * 0.5;
        const cy = tree.centerY ?? tree.y + Math.sin(tree.fallAngle || 0) * len * 0.5;
        ctx.translate(cx, cy);
        ctx.rotate(tree.fallAngle || 0);
        ctx.fillStyle = '#78350f';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        ctx.fillRect(-len * 0.5, -width * 0.5, len, width);
        ctx.strokeRect(-len * 0.5, -width * 0.5, len, width);

        ctx.fillStyle = '#fde68a';
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🌲 FALLEN LOG COVER (BLOCKS PATH)', 0, 4);
      }
      ctx.restore();
    }

    // 12. Escape Ziplines (Blackwood Logging Camp)
    for (const zl of env.ziplines || []) {
      ctx.save();
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(zl.startX, zl.startY);
      ctx.lineTo(zl.endX, zl.endY);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const [ax, ay, tag] of [
        [zl.startX, zl.startY, '🪢 ZIPLINE [F]'],
        [zl.endX, zl.endY, '🪢 ZIPLINE [F]']
      ]) {
        ctx.fillStyle = '#059669';
        ctx.beginPath();
        ctx.arc(ax, ay, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a7f3d0';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tag, ax, ay - 22);
      }
      ctx.restore();
    }
  }

  /**
   * Render pooled Zombies, Projectiles, Player, and the Drivable Armored Bus.
   * @private
   */
  _renderEntities(ctx) {
    // 1. Projectiles
    const projectiles = this.projectilePool.getActive();
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      ctx.fillStyle = p.color || '#fbbf24';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Pooled Zombies
    const zombies = this.zombiePool.getActive();
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (!z.alive) continue;

      ctx.save();
      ctx.translate(z.x, z.y);

      // Rooted Bear Trap indicator ring
      if (z.rootedTimer > 0) {
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, z.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.rotate(z.angle);
      ctx.fillStyle = z.color;
      ctx.strokeStyle = z.outline;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Zombie arms
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(4, -z.radius * 0.7);
      ctx.lineTo(z.radius + 6, -z.radius * 0.45);
      ctx.moveTo(4, z.radius * 0.7);
      ctx.lineTo(z.radius + 6, z.radius * 0.45);
      ctx.stroke();

      // Night Stalker glowing crimson eyes
      if (z.variant === 'night_stalker') {
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(z.radius * 0.45, -4, 2.8, 0, Math.PI * 2);
        ctx.arc(z.radius * 0.45, 4, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Zombie HP bar if damaged
      if (z.hp < z.maxHp) {
        const bw = 26;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(z.x - bw * 0.5, z.y - z.radius - 10, bw, 4);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(z.x - bw * 0.5, z.y - z.radius - 10, bw * (z.hp / z.maxHp), 4);
      }
    }

    // 3. Drivable Armored Bus (Terminal Transit)
    if (this.busController.bus) {
      this._renderArmoredBus(ctx, this.busController.bus);
    }

    // 4. Player (when on foot or riding zipline)
    if (!this.player.inVehicle) {
      const p = this.player;
      ctx.save();
      ctx.translate(p.x, p.y);

      if (p.isElevated) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.rotate(p.angle);
      // Gun barrel
      ctx.fillStyle = p.isPackAPunched ? '#e879f9' : '#94a3b8';
      ctx.fillRect(6, -3, 20, 6);

      // Player body
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Render the detailed top-down Armored Transit Bus with V-plow, roof turret, and status bars.
   * @private
   */
  _renderArmoredBus(ctx, bus) {
    ctx.save();
    ctx.translate(bus.x, bus.y);
    ctx.rotate(bus.angle);

    const hw = bus.width * 0.5;
    const hh = bus.height * 0.5;

    // Heavy armored V-plow on front
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hw, -hh - 4);
    ctx.lineTo(hw + 18, 0);
    ctx.lineTo(hw, hh + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bus Armored Chassis
    ctx.fillStyle = bus.hasDriver ? '#eab308' : '#ca8a04';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    ctx.fillRect(-hw, -hh, bus.width, bus.height);
    ctx.strokeRect(-hw, -hh, bus.width, bus.height);

    // Roof armor plates & windows
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-hw + 16, -hh + 10, bus.width - 36, bus.height - 20);

    // Windshield
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(hw - 22, -hh + 8, 14, bus.height - 16);

    // Roof turret ring
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(-10, 0, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // World-space label & bars above bus
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 12px Inter, sans-serif';
    ctx.fillStyle = '#fef08a';
    ctx.fillText(
      bus.hasDriver
        ? `🚌 DRIVING ARMORED BUS (${Math.round(bus.speed)} u/s) [E: Exit]`
        : '🚌 ARMORED BUS [Press E to Drive]',
      bus.x,
      bus.y - hh - 18
    );
    ctx.restore();
  }

  /**
   * Render floating combat and interaction status text.
   * @private
   */
  _renderFloatingTexts(ctx) {
    const texts = this.floatingTextPool.getActive();
    if (texts.length === 0) return;

    ctx.save();
    ctx.font = '800 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < texts.length; i++) {
      const ft = texts[i];
      ctx.globalAlpha = MathUtils.clamp(ft.life / ft.maxLife, 0, 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.restore();
  }

  /**
   * Render Dusk orange tint, Night darkness mask, radial player vision, Flashlight cone, and Bus headlights.
   * @private
   */
  _renderLightingAndDarkness(ctx, vw, vh, focusX, focusY, camLeft, camTop) {
    const timeState = this.timeManager.getState();
    const weatherState = this.weatherManager.getState();

    // 1. Ambient Dusk/Night tint
    const [ar, ag, ab, aa] = timeState.ambientColor || [0, 0, 0, 0];
    if (aa > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${aa})`;
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }

    // 2. Offscreen Darkness Mask for Night & Dusk
    const darkness = timeState.darknessAlpha || 0;
    if (darkness > 0.02) {
      const lctx = this.lightCtx;
      lctx.clearRect(0, 0, vw, vh);
      lctx.fillStyle = `rgba(4, 7, 17, ${darkness})`;
      lctx.fillRect(0, 0, vw, vh);

      // Cut out ambient player visibility radius (shrunk by Dense Fog's visibilityMultiplier!)
      const visRadius = (timeState.visibilityRadius || 320) * (weatherState.visibilityMultiplier || 1.0);
      lctx.save();
      lctx.globalCompositeOperation = 'destination-out';
      const ambGrad = lctx.createRadialGradient(focusX, focusY, 18, focusX, focusY, visRadius);
      ambGrad.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
      ambGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.45)');
      ambGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      lctx.fillStyle = ambGrad;
      lctx.beginPath();
      lctx.arc(focusX, focusY, visRadius, 0, Math.PI * 2);
      lctx.fill();

      // Cut out Armored Bus dual Headlight cones when Bus is present
      if (this.busController.bus) {
        const lights = this.busController.bus.getHeadlightTransforms();
        for (const hl of lights) {
          const sx = hl.x - camLeft;
          const sy = hl.y - camTop;
          const range = 430;
          const hGrad = lctx.createRadialGradient(sx, sy, 6, sx, sy, range);
          hGrad.addColorStop(0, 'rgba(0, 0, 0, 0.96)');
          hGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          lctx.fillStyle = hGrad;
          lctx.beginPath();
          lctx.moveTo(sx, sy);
          lctx.arc(sx, sy, range, hl.angle - 0.36, hl.angle + 0.36);
          lctx.closePath();
          lctx.fill();
        }
      }
      lctx.restore();

      // Cut out Player Flashlight cone & render warm beam
      if (!this.player.inVehicle) {
        this.flashlight.renderCone(lctx, ctx, focusX, focusY, this.player.angle, darkness);
      }

      // Composite darkness mask over main viewport
      ctx.drawImage(this.lightCanvas, 0, 0);
    } else if (!this.player.inVehicle && this.flashlight.isOn) {
      // Even during day/dusk, show subtle beam if player manually turns on flashlight
      this.flashlight.renderCone(null, ctx, focusX, focusY, this.player.angle, 0);
    }
  }

  /**
   * Render a live Tactical Minimap in the bottom-right corner.
   * @private
   */
  _renderMinimap(ctx, map, vw, vh) {
    const mw = 190;
    const mh = 142;
    const mx = vw - mw - 16;
    const my = vh - mh - 64;
    const worldW = map.worldSize?.width || 2400;
    const worldH = map.worldSize?.height || 1800;
    const scaleX = mw / worldW;
    const scaleY = mh / worldH;

    ctx.save();
    ctx.fillStyle = 'rgba(9, 13, 22, 0.86)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.38)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeRect(mx, my, mw, mh);

    // Walls on minimap
    ctx.fillStyle = '#475569';
    for (const w of map.walls || []) {
      ctx.fillRect(mx + w.x * scaleX, my + w.y * scaleY, Math.max(2, w.w * scaleX), Math.max(2, w.h * scaleY));
    }

    // Zombies on minimap
    const zombies = this.zombiePool.getActive();
    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (!z.alive) continue;
      ctx.fillRect(mx + z.x * scaleX - 1.5, my + z.y * scaleY - 1.5, 3, 3);
    }

    // Bus on minimap
    if (this.busController.bus) {
      const b = this.busController.bus;
      ctx.fillStyle = '#facc15';
      ctx.fillRect(mx + b.x * scaleX - 4, my + b.y * scaleY - 3, 8, 6);
    }

    // Player on minimap
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(mx + this.player.x * scaleX, my + this.player.y * scaleY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Synchronize DOM HUD elements with live game telemetry.
   * @private
   */
  _updateHUD() {
    const map = this.mapManager.getCurrentMap();
    const weather = this.weatherManager.getState();
    const time = this.timeManager.getState();
    const weapon = this.player.getActiveWeapon();
    const activeZombies = this.zombiePool.getActive();

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(val)) el.textContent = String(val);
    };

    setTxt('hud-map-name', map ? map.name.toUpperCase() : 'SECTOR');
    setTxt('hud-wave-num', this.wave);
    setTxt('hud-zombies-alive', activeZombies.length);
    setTxt('hud-kills', this.player.kills);

    setTxt('hud-weapon-name', `🔫 ${weapon.displayName}`);
    setTxt('hud-points', `${this.player.points} PTS`);
    setTxt('hud-hp-text', `${Math.round(this.player.health)}/${this.player.maxHealth}`);
    setTxt('hud-acc-text', `${weapon.effectiveAccuracyPercent}%`);

    const hpBar = document.getElementById('hud-hp-bar');
    if (hpBar) hpBar.style.width = `${(this.player.health / this.player.maxHealth) * 100}%`;

    setTxt('hud-flashlight-state', this.flashlight.isOn ? 'ON' : 'OFF');
    setTxt('hud-battery-text', `${Math.round(this.flashlight.battery)}%`);
    const batBar = document.getElementById('hud-battery-bar');
    if (batBar) batBar.style.width = `${this.flashlight.battery}%`;

    setTxt('hud-weather-label', `${weather.icon} ${weather.label}`);
    setTxt('hud-clock-label', `🕒 ${time.formattedClock} (${time.phaseLabel})`);

    // Active gameplay modifiers pills
    const modContainer = document.getElementById('hud-modifiers-list');
    if (modContainer) {
      const pills = [];
      if (weather.accuracyMultiplier < 0.99) {
        pills.push(`<span class="mod-pill warn">Acc ${Math.round((weather.accuracyMultiplier - 1) * 100)}%</span>`);
      }
      if (weather.vehicleDriftBonus > 0.01) {
        pills.push(`<span class="mod-pill warn">+${Math.round(weather.vehicleDriftBonus * 100)}% Drift</span>`);
      }
      if (weather.visibilityMultiplier < 0.95) {
        pills.push(`<span class="mod-pill warn">Vis ${Math.round(weather.visibilityMultiplier * 100)}%</span>`);
      }
      if (weather.spawnDistanceMultiplier < 0.95) {
        pills.push(`<span class="mod-pill danger">Spawns -${Math.round((1 - weather.spawnDistanceMultiplier) * 100)}% Dist</span>`);
      }
      if (weather.moveSpeedMultiplier < 0.98) {
        pills.push(`<span class="mod-pill warn">Speed ${Math.round((weather.moveSpeedMultiplier - 1) * 100)}%</span>`);
      }
      if (weather.lightningEnabled) {
        pills.push(`<span class="mod-pill danger">⚡ 150 DMG Lightning</span>`);
      }
      if (time.spawnRateMultiplier > 1.01) {
        pills.push(`<span class="mod-pill danger">+${Math.round((time.spawnRateMultiplier - 1) * 100)}% Spawn Rate</span>`);
      }
      if (time.allowNightStalkers) {
        pills.push(`<span class="mod-pill danger">🦇 Night Stalkers Active</span>`);
      }
      if (this.player.isElevated) {
        pills.push(`<span class="mod-pill">🪜 Elevated +25% Acc</span>`);
      }
      if (this.player.inMud) {
        pills.push(`<span class="mod-pill warn">🥾 Mud -40% Speed</span>`);
      }
      if (pills.length === 0) {
        pills.push(`<span class="mod-pill">Baseline Modifiers (100%)</span>`);
      }
      const html = pills.join('');
      if (modContainer.innerHTML !== html) modContainer.innerHTML = html;
    }

    // Bus HUD Card
    const busCard = document.getElementById('hud-bus-card');
    const bus = this.busController.bus;
    if (busCard) {
      if (!bus) {
        busCard.classList.add('hidden');
      } else {
        busCard.classList.remove('hidden');
        setTxt('hud-bus-status', bus.hasDriver ? '🚌 DRIVING BUS [E: Exit]' : '🚌 ARMORED BUS [E: Drive]');
        setTxt('hud-bus-crush', `💀 ${bus.crushKills} Crushed`);
        setTxt('hud-bus-hp-text', `${Math.round(bus.health)}/${bus.maxHealth}`);
        setTxt('hud-bus-speed', Math.round(bus.speed));
        setTxt('hud-bus-fuel-text', `${Math.round(bus.fuel)}%`);
        setTxt('hud-bus-drift-badge', bus.isDrifting ? '🔥 DRIFTING!' : 'Grip: Normal');

        const busHpBar = document.getElementById('hud-bus-hp-bar');
        if (busHpBar) busHpBar.style.width = `${(bus.health / bus.maxHealth) * 100}%`;
        const busFuelBar = document.getElementById('hud-bus-fuel-bar');
        if (busFuelBar) busFuelBar.style.width = `${(bus.fuel / bus.maxFuel) * 100}%`;
      }
    }

    // Telemetry line
    setTxt(
      'hud-telemetry',
      `FPS: ${this.fps} | Zombies: ${activeZombies.length} | Path Diffs: ${this.pathfindingManager.totalIncrementalUpdates} (${this.pathfindingManager.lastIncrementalCellsUpdated} cells)`
    );

    // Contextual interaction banner
    const banner = document.getElementById('hud-interaction-banner');
    if (banner) {
      if (this.player.inVehicle && bus) {
        banner.textContent = 'Driving Armored Bus — [WASD] Drive | [Space] Drift | [H] Horn | [E] Exit Vehicle';
        banner.classList.remove('hidden');
      } else if (this.busController.canPlayerEnter(this.player)) {
        banner.textContent = 'Press [E] to board the Armored Transit Bus';
        banner.classList.remove('hidden');
      } else if (this.mapMechanics.activePrompt) {
        banner.textContent = this.mapMechanics.activePrompt.label;
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }
  }

  /**
   * Expose `window.debug` and `window.game` for console & automated verification checks.
   * @private
   */
  _exposeDebugAPI() {
    window.game = this;
    window.debug = {
      /** Load a map by ID ('terminal-transit' | 'neon-night-market' | 'blackwood-logging-camp') */
      loadMap: (mapId) => this.mapManager.loadMap(mapId),
      /** Register a new custom map JSON at runtime with zero code changes */
      registerCustomMap: (mapJson) => this.mapManager.registerCustomMap(mapJson),
      /** Force weather ('clear' | 'rain' | 'fog' | 'thunderstorm' | 'snow') */
      setWeather: (state, immediate = true) => this.weatherManager.setWeather(state, { immediate }),
      /** Get current weather state and gameplay modifiers */
      getWeatherState: () => this.weatherManager.getState(),
      /** Serialize current weather state to JSON */
      serializeWeather: () => this.weatherManager.toJSON(),
      /** Restore weather state from JSON */
      restoreWeather: (data) => this.weatherManager.fromJSON(data),
      /** Trigger a lightning strike near the player */
      triggerLightning: (instant = true) => this.weatherManager.triggerDebugLightningStrike(this.player, instant),
      /** Set time of day ('day' | 'dusk' | 'night' or hour 0..24) */
      setTime: (val) => this.timeManager.setTime(val),
      /** Pause or resume the Day/Night clock */
      pauseTime: (paused = true) => this.timeManager.setPaused(paused),
      /** Get current TimeOfDay state */
      getTimeState: () => this.timeManager.getState(),
      /** Toggle player flashlight */
      toggleFlashlight: () => this.flashlight.toggle(),
      /** Spawn N zombies immediately */
      spawnZombies: (count = 25, variant = null) => this.spawnZombieBatch(count, variant),
      /** Board the Armored Bus on Terminal Transit */
      enterBus: () => {
        if (!this.busController.bus) return false;
        if (!this.player.inVehicle) {
          const door = this.busController.bus.getDriverDoorPosition();
          this.player.x = door.x;
          this.player.y = door.y;
          return this.busController.togglePlayerEnterExit(this.player);
        }
        return true;
      },
      /** Exit the Armored Bus */
      exitBus: () => {
        if (this.player.inVehicle) {
          return this.busController.togglePlayerEnterExit(this.player);
        }
        return false;
      },
      /**
       * Automated verification helper: places small/standard zombies in front of the bus
       * and drives forward to verify zombie crushing & dynamic pathfinding updates.
       */
      runBusCrushVerification: (zombieCount = 14) => {
        const bus = this.busController.bus;
        if (!bus) return false;
        window.debug.enterBus();
        const cos = Math.cos(bus.angle);
        const sin = Math.sin(bus.angle);
        for (let i = 0; i < zombieCount; i++) {
          const dist = 95 + i * 24;
          const lateral = ((i % 3) - 1) * 18;
          const zx = bus.x + cos * dist - sin * lateral;
          const zy = bus.y + sin * dist + cos * lateral;
          const z = this.zombiePool.acquire();
          z.spawn({ x: zx, y: zy, variant: i % 2 === 0 ? 'small' : 'walker', wave: 1 });
        }
        this.busController.input.setOverride({ throttle: 1, steer: 0, handbrake: false });
        setTimeout(() => {
          this.busController.input.setOverride(null);
        }, 2200);
        return true;
      },
      /** Return comprehensive runtime telemetry snapshot */
      getTelemetry: () => ({
        fps: this.fps,
        currentMapId: this.mapManager.getCurrentMap()?.id || null,
        activeZombies: this.zombiePool.getActive().length,
        nightStalkerCount: this.zombiePool.getActive().filter((z) => z.variant === 'night_stalker').length,
        playerPoints: this.player.points,
        playerKills: this.player.kills,
        playerInVehicle: this.player.inVehicle,
        playerIsElevated: this.player.isElevated,
        playerInMud: this.player.inMud,
        playerEffectiveAccuracy: this.player.getActiveWeapon().effectiveAccuracyPercent,
        busCrushKills: this.busController.bus ? this.busController.bus.crushKills : 0,
        busSpeed: this.busController.bus ? Math.round(this.busController.bus.speed) : 0,
        busHealth: this.busController.bus ? Math.round(this.busController.bus.health) : 0,
        busFuel: this.busController.bus ? Math.round(this.busController.bus.fuel) : 0,
        pathfindingIncrementalUpdates: this.pathfindingManager.totalIncrementalUpdates,
        lastIncrementalCellsUpdated: this.pathfindingManager.lastIncrementalCellsUpdated,
        weather: this.weatherManager.toJSON(),
        time: this.timeManager.getState(),
        flashlightOn: this.flashlight.isOn,
        flashlightBattery: Math.round(this.flashlight.battery)
      })
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new ZombieSurvivalGame();
  game.init().catch((err) => {
    console.error('[ZombieSurvivalGame] Initialization failed:', err);
  });
});
