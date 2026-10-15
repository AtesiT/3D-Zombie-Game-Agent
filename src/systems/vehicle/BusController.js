/**
 * @fileoverview Armored Bus High-Level Orchestrator (`BusController.js`).
 * Integrates VehicleInput, VehicleController, DynamicObstacle incremental pathfinding updates,
 * speed-based zombie crushing & knockback, fuel consumption, station repair/refuel,
 * camera velocity lead, and WebAudio pitch synthesis.
 */

import { Bus } from '../../entities/Bus.js';
import { VehicleInput } from './VehicleInput.js';
import { VehicleController } from './VehicleController.js';
import { DynamicObstacle } from '../pathfinding/DynamicObstacle.js';
import { MathUtils } from '../../utils/MathUtils.js';
import { EventBus } from '../../utils/EventBus.js';
import { soundManager } from '../../utils/SoundManager.js';

export class BusController {
  /**
   * @param {Object} params
   * @param {import('../pathfinding/PathfindingManager.js').PathfindingManager} params.pathfindingManager
   * @param {import('../../utils/EventBus.js').EventEmitter} [params.eventBus=EventBus]
   */
  constructor({ pathfindingManager, eventBus = EventBus }) {
    this.pathfindingManager = pathfindingManager;
    this.eventBus = eventBus;
    this.input = new VehicleInput();
    this.vehicleController = new VehicleController();

    /** @type {Bus|null} */
    this.bus = null;
    /** @type {DynamicObstacle|null} */
    this.dynamicObstacle = null;
    /** @type {Array<Object>} */
    this.stations = [];

    this._skidEmitTimer = 0;

    // Listen to weather updates so Heavy Rain (+10% vehicle drift) and Snow (-25% speed) apply automatically
    this.eventBus.on('weather:updated', (state) => {
      if (!state) return;
      this.vehicleController.setWeatherModifiers({
        driftBonus: state.vehicleDriftBonus || 0,
        speedMultiplier: state.moveSpeedMultiplier || 1.0
      });
    });
  }

  /**
   * Spawn or remove the Armored Bus based on the loaded map's JSON configuration.
   * @param {Object} mapData
   */
  initForMap(mapData) {
    if (this.dynamicObstacle && this.pathfindingManager) {
      this.pathfindingManager.unregisterDynamicObstacle(this.dynamicObstacle.id);
      this.dynamicObstacle = null;
    }

    const busConfig = mapData?.uniqueMechanics?.busConfig;
    if (!busConfig || !busConfig.enabled) {
      this.bus = null;
      this.stations = [];
      soundManager.updateBusEngine(false);
      return;
    }

    this.bus = new Bus(busConfig);
    this.stations = mapData.vehicleStations || [];

    this.dynamicObstacle = new DynamicObstacle({
      id: this.bus.id,
      x: this.bus.x,
      y: this.bus.y,
      width: this.bus.width,
      height: this.bus.height,
      angle: this.bus.angle,
      padding: 14
    });

    if (this.pathfindingManager) {
      this.pathfindingManager.registerDynamicObstacle(this.dynamicObstacle);
    }

    this.eventBus.emit('bus:spawned', { bus: this.bus });
  }

  /**
   * Check if the player is close enough to enter the bus (driver seat or hull perimeter).
   * @param {{x:number, y:number}} player
   * @returns {boolean}
   */
  canPlayerEnter(player) {
    if (!this.bus || this.bus.hasDriver || !player) return false;
    const door = this.bus.getDriverDoorPosition();
    const dDoor = MathUtils.dist(player.x, player.y, door.x, door.y);
    const dCenter = MathUtils.dist(player.x, player.y, this.bus.x, this.bus.y);
    return dDoor <= 85 || dCenter <= 115;
  }

  /**
   * Toggle player entry or exit from the Armored Bus.
   * @param {import('../../entities/Player.js').Player} player
   * @returns {boolean} True if state changed
   */
  togglePlayerEnterExit(player) {
    if (!this.bus || !player) return false;

    if (this.bus.hasDriver && this.bus.driver === player) {
      // Exit bus at driver side door
      const exitPos = this.bus.getDriverDoorPosition();
      this.bus.hasDriver = false;
      this.bus.driver = null;
      player.inVehicle = false;
      player.vehicleRef = null;
      player.x = exitPos.x;
      player.y = exitPos.y;
      soundManager.updateBusEngine(false);
      this.eventBus.emit('bus:exited', { bus: this.bus, player });
      return true;
    }

    if (this.canPlayerEnter(player)) {
      this.bus.hasDriver = true;
      this.bus.driver = player;
      player.inVehicle = true;
      player.vehicleRef = this.bus;
      player.x = this.bus.x;
      player.y = this.bus.y;
      soundManager.playInteraction('buy');
      this.eventBus.emit('bus:entered', { bus: this.bus, player });
      return true;
    }

    return false;
  }

  /**
   * Main per-frame update for the Armored Bus.
   * @param {number} dt - Delta time in seconds
   * @param {Object} context
   * @param {Array<import('../../entities/Zombie.js').Zombie>} context.zombies
   * @param {Array<Object>} context.solidColliders
   * @param {{width:number, height:number}} context.worldBounds
   * @param {Function} [context.onEmitDecal] - Callback to spawn tire tracks or blood decals
   * @param {Function} [context.onFloatingText] - Callback to spawn floating status text
   */
  update(dt, { zombies = [], solidColliders = [], worldBounds, onEmitDecal, onFloatingText }) {
    if (!this.bus) return;

    const sampled = this.input.sample();
    if (this.bus.hasDriver && sampled.horn) {
      soundManager.playInteraction('horn');
    }

    // 1. Fuel consumption while driving
    if (this.bus.hasDriver && Math.abs(sampled.throttle) > 0.05 && this.bus.fuel > 0 && this.bus.health > 0) {
      this.bus.fuel = Math.max(0, this.bus.fuel - this.bus.fuelConsumptionPerSec * dt);
    }

    // 2. Step vehicle physics
    this.vehicleController.updatePhysics(this.bus, sampled, dt, solidColliders, worldBounds);

    // Keep seated driver synchronized with bus coordinates
    if (this.bus.hasDriver && this.bus.driver) {
      this.bus.driver.x = this.bus.x;
      this.bus.driver.y = this.bus.y;
      this.bus.driver.angle = this.bus.angle;
    }

    // 3. Incrementally update DynamicObstacle on PathfindingManager grid
    if (this.dynamicObstacle && this.pathfindingManager) {
      this.dynamicObstacle.x = this.bus.x;
      this.dynamicObstacle.y = this.bus.y;
      this.dynamicObstacle.angle = this.bus.angle;
      this.pathfindingManager.updateDynamicObstacle(this.dynamicObstacle);
    }

    // 4. Emit tire skid / snow tracks when drifting or moving
    this._skidEmitTimer -= dt;
    if (onEmitDecal && this.bus.speed > 40 && this._skidEmitTimer <= 0) {
      if (this.bus.isDrifting) {
        this._skidEmitTimer = 0.045;
        onEmitDecal({
          type: 'tire_skid',
          x: this.bus.x - Math.cos(this.bus.angle) * (this.bus.width * 0.35),
          y: this.bus.y - Math.sin(this.bus.angle) * (this.bus.width * 0.35),
          angle: this.bus.angle,
          alpha: 0.45
        });
      }
    }

    // 5. Evaluate zombie crushing & hull collisions
    this._evaluateZombieInteractions(zombies, dt, onEmitDecal, onFloatingText);

    // 6. Evaluate Repair & Fuel Depot Stations
    this._evaluateDepotStations(dt, onFloatingText);

    // 7. Update continuous engine pitch audio
    const speedNorm = MathUtils.clamp(this.bus.speed / this.bus.maxSpeed, 0, 1);
    soundManager.updateBusEngine(
      this.bus.hasDriver && this.bus.fuel > 0 && this.bus.health > 0,
      speedNorm,
      sampled.throttle
    );
  }

  /**
   * Check zombies against the bus OBB:
   * - Moving bus crushes/knocks back zombies (small/standard zombies insta-killed at speed).
   * - Stationary/slow bus takes durability damage from attacking zombies and pushes them outside its hull.
   * @private
   */
  _evaluateZombieInteractions(zombies, dt, onEmitDecal, onFloatingText) {
    const bus = this.bus;
    if (!bus) return;

    const now = performance.now() * 0.001;
    const halfW = bus.width * 0.5 + 6;
    const halfH = bus.height * 0.5 + 6;

    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (!z || !z.alive) continue;

      const hit = MathUtils.circleVsOBB(z.x, z.y, z.radius, bus.x, bus.y, halfW, halfH, bus.angle);
      if (!hit.hit) continue;

      // Always push zombie out of the solid bus hull
      z.x += hit.pushX * 1.1;
      z.y += hit.pushY * 1.1;

      const cooldownUntil = bus.hitCooldowns.get(z.id) || 0;
      if (now < cooldownUntil) continue;

      if (bus.speed >= bus.minCrushSpeed) {
        bus.hitCooldowns.set(z.id, now + 0.35);

        // Determine if insta-kill applies (small or standard walkers at lethal speed)
        const isInstaKill =
          (z.variant === 'small' || z.variant === 'walker' || z.variant === 'runner') &&
          bus.speed >= bus.instaKillSmallSpeed;

        const damage = isInstaKill
          ? z.hp + 999
          : Math.round(bus.speed * bus.crushDamageMultiplier * 0.55);

        const pushDirLen = Math.hypot(hit.pushX, hit.pushY) || 1;
        const nx = hit.pushX / pushDirLen;
        const ny = hit.pushY / pushDirLen;
        const knockbackForce = 280 + bus.speed * 0.85;

        z.applyKnockback(nx * knockbackForce, ny * knockbackForce, 0.35);
        const killed = z.takeDamage(damage, 'bus_crush');

        // Slight tactile momentum drag on the bus
        bus.vx *= 0.965;
        bus.vy *= 0.965;
        // Small durability wear on high-speed impact
        bus.takeDamage(2.5);

        soundManager.playZombieCrush(killed);

        if (onEmitDecal) {
          onEmitDecal({
            type: 'blood',
            x: z.x,
            y: z.y,
            angle: Math.random() * Math.PI * 2,
            alpha: 0.65
          });
        }

        if (killed) {
          bus.crushKills++;
          if (bus.driver) {
            bus.driver.points += 75;
            bus.driver.kills++;
          }
          if (onFloatingText) {
            onFloatingText(z.x, z.y - 16, isInstaKill ? '💥 CRUSHED! +75' : '🚌 ROADKILL! +75', '#facc15');
          }
          this.eventBus.emit('bus:zombieCrushed', {
            bus,
            zombie: z,
            crushKills: bus.crushKills,
            damage
          });
        } else if (onFloatingText) {
          onFloatingText(z.x, z.y - 14, `-${damage} RAM`, '#fb923c');
        }
      } else {
        // Bus is stationary or creeping slowly: zombie batters the bus armor
        bus.hitCooldowns.set(z.id, now + 0.85);
        bus.takeDamage(z.damage * 0.45);
      }
    }
  }

  /**
   * Refuel or repair the bus when parked/driving inside designated Fuel or Repair stations.
   * @private
   */
  _evaluateDepotStations(dt, onFloatingText) {
    const bus = this.bus;
    if (!bus || !this.stations) return;

    for (const st of this.stations) {
      const d = MathUtils.dist(bus.x, bus.y, st.x, st.y);
      if (d > st.radius) continue;

      if (st.type === 'fuel' && bus.fuel < bus.maxFuel) {
        const prev = Math.floor(bus.fuel);
        bus.refuel((st.ratePerSec || 35) * dt);
        if (Math.floor(bus.fuel) > prev && Math.floor(bus.fuel) % 20 === 0 && onFloatingText) {
          onFloatingText(bus.x, bus.y - 48, `⛽ REFUELING (${Math.round(bus.fuel)}%)`, '#38bdf8');
        }
      } else if (st.type === 'repair' && bus.health < bus.maxHealth) {
        const prev = Math.floor(bus.health);
        bus.repair((st.ratePerSec || 220) * dt);
        if (Math.floor(bus.health / 150) > Math.floor(prev / 150) && onFloatingText) {
          onFloatingText(bus.x, bus.y - 48, `🔧 ARMOR REPAIRED (${Math.round((bus.health / bus.maxHealth) * 100)}%)`, '#4ade80');
        }
      }
    }
  }

  /**
   * Compute the desired camera focus point when driving the bus, including smooth
   * velocity look-ahead lead in the movement direction.
   * @returns {{ x: number, y: number }|null}
   */
  getCameraTargetWithLead() {
    if (!this.bus) return null;
    const leadSeconds = 0.42;
    const maxLeadDist = 175;
    const rawLeadX = this.bus.vx * leadSeconds;
    const rawLeadY = this.bus.vy * leadSeconds;
    const len = Math.hypot(rawLeadX, rawLeadY);
    const scale = len > maxLeadDist ? maxLeadDist / len : 1;

    return {
      x: this.bus.x + rawLeadX * scale,
      y: this.bus.y + rawLeadY * scale
    };
  }
}

export default BusController;
