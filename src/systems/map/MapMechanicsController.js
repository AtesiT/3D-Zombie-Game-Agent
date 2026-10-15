/**
 * @fileoverview Data-Driven Map Environmental Mechanics Controller (`MapMechanicsController.js`).
 * Processes all interactive elements and map-specific hazards defined in a map's `map.json`:
 * - Universal: Point-locked Doors, Wall Weapons, Power Switches, Pack-a-Punch machines, Spawn Barriers
 * - Neon Night Market: Destructible Neon Signs -> Electrical Hazard Zones (DoT), Elevated Fire Escapes
 *   (+25% player accuracy bonus, slow zombie climb), and 3-Relay Cyber Shrine Main Easter Egg
 * - Blackwood Logging Camp: Bear Traps (damage + 3.5s root), Shootable Support Beams -> Falling Trees
 *   (crush sweep + DynamicObstacle path blocking), Mud Patches (-40% speed for player & zombies),
 *   and Elevated Escape Ziplines.
 */

import { MathUtils } from '../../utils/MathUtils.js';
import { DynamicObstacle } from '../pathfinding/DynamicObstacle.js';
import { WEAPON_CATALOG } from '../../entities/Player.js';
import { soundManager } from '../../utils/SoundManager.js';
import { EventBus } from '../../utils/EventBus.js';

export class MapMechanicsController {
  /**
   * @param {Object} params
   * @param {import('./MapManager.js').MapManager} params.mapManager
   * @param {import('../pathfinding/PathfindingManager.js').PathfindingManager} params.pathfindingManager
   * @param {import('../../utils/EventBus.js').EventEmitter} [params.eventBus=EventBus]
   */
  constructor({ mapManager, pathfindingManager, eventBus = EventBus }) {
    this.mapManager = mapManager;
    this.pathfindingManager = pathfindingManager;
    this.eventBus = eventBus;

    /** @type {Array<Object>} Active electrical hazard zones from fallen neon signs */
    this.electricalHazards = [];
    /** @type {Array<DynamicObstacle>} Dynamic obstacles created by fallen trees */
    this.fallenTreeObstacles = [];
    /** @type {Object|null} Closest interactable prompt near the player */
    this.activePrompt = null;
    this.isRainActive = false;

    this.eventBus.on('weather:updated', (w) => {
      this.isRainActive = w && (w.name === 'rain' || w.name === 'thunderstorm');
    });
  }

  /**
   * Initialize mechanics state when a map is loaded.
   * @param {Object} mapData
   */
  initForMap(mapData) {
    // Unregister any previous fallen tree obstacles
    for (const obs of this.fallenTreeObstacles) {
      this.pathfindingManager.unregisterDynamicObstacle(obs.id);
    }
    this.fallenTreeObstacles = [];
    this.electricalHazards = [];
    this.activePrompt = null;

    if (!mapData) return;

    const env = mapData.environmentalObjects || {};
    for (const sign of env.neonSigns || []) {
      sign.destroyed = false;
    }
    for (const tree of env.fallingTrees || []) {
      tree.fallen = false;
      tree.fallAnim = 0;
    }
    for (const zl of env.ziplines || []) {
      zl.cooldownTimer = 0;
    }
  }

  /**
   * Check if a projectile hits any shootable environmental mechanic (Neon Sign or Tree Support Beam).
   * @param {{x:number, y:number, damage:number}} proj
   * @param {Array<import('../../entities/Zombie.js').Zombie>} zombies
   * @param {import('../../entities/Player.js').Player} player
   * @param {Function} [onFloatingText]
   * @returns {boolean} True if projectile hit a destructible prop
   */
  checkProjectileHit(proj, zombies, player, onFloatingText) {
    const map = this.mapManager.getCurrentMap();
    if (!map || !map.environmentalObjects) return false;
    const env = map.environmentalObjects;

    // 1. Destructible Neon Signs (Neon Night Market)
    for (const sign of env.neonSigns || []) {
      if (sign.destroyed) continue;
      const rect = {
        x: sign.x - sign.w * 0.5,
        y: sign.y - sign.h * 0.5,
        w: sign.w,
        h: sign.h
      };
      if (MathUtils.pointInRect(proj.x, proj.y, rect)) {
        sign.hp -= proj.damage;
        if (sign.hp <= 0) {
          this.triggerNeonSignFall(sign, zombies, player, onFloatingText);
        } else if (onFloatingText) {
          onFloatingText(sign.x, sign.y - 16, `NEON BRACKET -${proj.damage}`, '#f43f5e');
        }
        return true;
      }
    }

    // 2. Shootable Support Beams for Falling Trees (Blackwood Logging Camp)
    for (const tree of env.fallingTrees || []) {
      if (tree.fallen) continue;
      const dist = MathUtils.dist(proj.x, proj.y, tree.x, tree.y);
      if (dist <= 28) {
        tree.hp -= proj.damage;
        if (tree.hp <= 0) {
          this.triggerTreeFall(tree, zombies, player, onFloatingText);
        } else if (onFloatingText) {
          onFloatingText(tree.x, tree.y - 18, `BEAM HP ${Math.max(0, tree.hp)}`, '#f59e0b');
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Drop a shot Neon Sign, crushing enemies directly below and spawning an Electrical Hazard Zone.
   * @param {Object} sign
   * @param {Array<import('../../entities/Zombie.js').Zombie>} zombies
   * @param {import('../../entities/Player.js').Player} player
   * @param {Function} [onFloatingText]
   */
  triggerNeonSignFall(sign, zombies = [], player = null, onFloatingText = null) {
    if (!sign || sign.destroyed) return;
    sign.destroyed = true;
    soundManager.playInteraction('electric');

    // Immediate impact crush damage underneath the falling sign
    const crushRadius = 75;
    for (const z of zombies) {
      if (!z || !z.alive) continue;
      if (MathUtils.dist(z.x, z.y, sign.x, sign.y) <= crushRadius) {
        const killed = z.takeDamage(380, 'neon_crush');
        if (killed && player) {
          player.points += 60;
          player.kills++;
        }
      }
    }

    const hazard = {
      id: `hazard_${sign.id}_${Date.now()}`,
      label: sign.label,
      x: sign.x,
      y: sign.y + 18,
      baseRadius: sign.shockRadius || 135,
      damagePerSec: sign.shockDamagePerSec || 55,
      remainingTime: sign.hazardDuration || 16,
      maxTime: sign.hazardDuration || 16,
      color: sign.color || '#06b6d4',
      tickTimer: 0
    };
    this.electricalHazards.push(hazard);

    if (onFloatingText) {
      onFloatingText(sign.x, sign.y - 24, `⚡ ${sign.label} CRASHED! ELECTRICAL HAZARD!`, '#22d3ee');
    }

    this.eventBus.emit('mechanic:neonSignDestroyed', { sign, hazard });
  }

  /**
   * Fell a tree when its support beam is shot, crushing targets along its fall corridor
   * and registering a DynamicObstacle in PathfindingManager to block/reroute paths.
   * @param {Object} tree
   * @param {Array<import('../../entities/Zombie.js').Zombie>} zombies
   * @param {import('../../entities/Player.js').Player} player
   * @param {Function} [onFloatingText]
   */
  triggerTreeFall(tree, zombies = [], player = null, onFloatingText = null) {
    if (!tree || tree.fallen) return;
    tree.fallen = true;
    tree.fallAnim = 1;
    soundManager.playZombieCrush(true);

    const angle = tree.fallAngle || 0;
    const len = tree.trunkLength || 210;
    const width = tree.trunkWidth || 46;
    const centerX = tree.x + Math.cos(angle) * (len * 0.5);
    const centerY = tree.y + Math.sin(angle) * (len * 0.5);
    tree.centerX = centerX;
    tree.centerY = centerY;

    // Crush zombies in the fallen trunk OBB
    let crushedCount = 0;
    for (const z of zombies) {
      if (!z || !z.alive) continue;
      const hit = MathUtils.circleVsOBB(z.x, z.y, z.radius + 8, centerX, centerY, len * 0.5, width * 0.5, angle);
      if (hit.hit) {
        const killed = z.takeDamage(tree.crushDamage || 900, 'falling_tree');
        if (killed) {
          crushedCount++;
          if (player) {
            player.points += 80;
            player.kills++;
          }
        }
      }
    }

    // Register the fallen log as a DynamicObstacle in PathfindingManager
    const obstacle = new DynamicObstacle({
      id: `fallen_tree_${tree.id}`,
      x: centerX,
      y: centerY,
      width: len,
      height: width,
      angle,
      padding: 10
    });
    this.pathfindingManager.registerDynamicObstacle(obstacle);
    this.fallenTreeObstacles.push(obstacle);

    if (onFloatingText) {
      onFloatingText(
        centerX,
        centerY - 24,
        `🌲 TIMBER FELL! (${crushedCount} CRUSHED // PATH BLOCKED)`,
        '#84cc16'
      );
    }

    this.eventBus.emit('mechanic:treeFallen', { tree, crushedCount, obstacle });
  }

  /**
   * Update all active environmental mechanics each frame.
   * @param {number} dt
   * @param {Object} context
   * @param {import('../../entities/Player.js').Player} context.player
   * @param {Array<import('../../entities/Zombie.js').Zombie>} context.zombies
   * @param {Function} [context.onFloatingText]
   */
  update(dt, { player, zombies = [], onFloatingText }) {
    const map = this.mapManager.getCurrentMap();
    if (!map || !player) return;

    const env = map.environmentalObjects || {};

    // 1. Update active Electrical Hazard Zones (Neon Night Market)
    for (let i = this.electricalHazards.length - 1; i >= 0; i--) {
      const hz = this.electricalHazards[i];
      hz.remainingTime -= dt;
      if (hz.remainingTime <= 0) {
        this.electricalHazards.splice(i, 1);
        continue;
      }

      const effectiveRadius = hz.baseRadius * (this.isRainActive ? 1.4 : 1.0);
      hz.effectiveRadius = effectiveRadius;
      hz.tickTimer -= dt;

      if (hz.tickTimer <= 0) {
        hz.tickTimer = 0.35;
        const dmg = Math.round(hz.damagePerSec * 0.35);

        // Shock zombies inside hazard zone
        for (const z of zombies) {
          if (!z || !z.alive) continue;
          if (MathUtils.dist(z.x, z.y, hz.x, hz.y) <= effectiveRadius) {
            const killed = z.takeDamage(dmg, 'electrical_hazard');
            if (killed) {
              player.points += 50;
              player.kills++;
              if (onFloatingText) {
                onFloatingText(z.x, z.y - 12, '⚡ ELECTROCUTED +50', '#22d3ee');
              }
            }
          }
        }

        // Shock player if standing inside hazard zone
        if (!player.inVehicle && MathUtils.dist(player.x, player.y, hz.x, hz.y) <= effectiveRadius) {
          player.takeDamage(Math.round(dmg * 0.28));
        }
      }
    }

    // 2. Evaluate Fire Escapes (Neon Night Market)
    player.isElevated = false;
    player.elevatedZoneName = '';
    for (const fe of env.fireEscapes || []) {
      if (MathUtils.pointInRect(player.x, player.y, fe)) {
        player.isElevated = true;
        player.elevatedZoneName = fe.name;
        break;
      }
    }

    for (const z of zombies) {
      if (!z || !z.alive) continue;
      z.isClimbingFireEscape = false;
      z.climbSlowMultiplier = 1.0;
      for (const fe of env.fireEscapes || []) {
        if (MathUtils.pointInRect(z.x, z.y, fe)) {
          z.isClimbingFireEscape = true;
          z.climbSlowMultiplier = fe.zombieClimbSlowFactor || 0.32;
          break;
        }
      }
    }

    // 3. Evaluate Mud Patches (Blackwood Logging Camp: -40% movement speed)
    player.inMud = false;
    player.mudSpeedMultiplier = 1.0;
    for (const mud of env.mudPatches || []) {
      const normDx = (player.x - mud.x) / mud.rx;
      const normDy = (player.y - mud.y) / mud.ry;
      if (normDx * normDx + normDy * normDy <= 1.0) {
        player.inMud = true;
        player.mudSpeedMultiplier = mud.speedMultiplier ?? 0.60;
        break;
      }
    }

    for (const z of zombies) {
      if (!z || !z.alive) continue;
      z.inMud = false;
      z.mudSpeedMultiplier = 1.0;
      for (const mud of env.mudPatches || []) {
        const normDx = (z.x - mud.x) / mud.rx;
        const normDy = (z.y - mud.y) / mud.ry;
        if (normDx * normDx + normDy * normDy <= 1.0) {
          z.inMud = true;
          z.mudSpeedMultiplier = mud.speedMultiplier ?? 0.60;
          break;
        }
      }
    }

    // 4. Evaluate Bear Traps (Blackwood Logging Camp: damage + root for X seconds)
    for (const trap of env.bearTraps || []) {
      if (!trap.armed) continue;

      // Check zombies first
      let triggered = false;
      for (const z of zombies) {
        if (!z || !z.alive) continue;
        if (MathUtils.dist(z.x, z.y, trap.x, trap.y) <= trap.radius) {
          trap.armed = false;
          triggered = true;
          z.applyRoot(trap.rootDuration || 3.5);
          const killed = z.takeDamage(trap.zombieDamage || 320, 'bear_trap');
          soundManager.playInteraction('trap');
          if (killed) {
            player.points += 60;
            player.kills++;
          }
          if (onFloatingText) {
            onFloatingText(
              trap.x,
              trap.y - 20,
              killed ? '🪤 TRAP LETHAL SNAP! +60' : `🪤 ROOTED ${trap.rootDuration}s!`,
              '#f97316'
            );
          }
          this.eventBus.emit('mechanic:bearTrapTriggered', { trap, target: z, targetType: 'zombie' });
          break;
        }
      }

      // Check player if still armed
      if (!triggered && !player.inVehicle && !player.ziplineState) {
        if (MathUtils.dist(player.x, player.y, trap.x, trap.y) <= trap.radius * 0.85) {
          trap.armed = false;
          player.applyRoot(Math.min(2.0, trap.rootDuration || 2.0));
          player.takeDamage(trap.playerDamage || 25);
          soundManager.playInteraction('trap');
          if (onFloatingText) {
            onFloatingText(player.x, player.y - 24, '🪤 SNARED IN BEAR TRAP!', '#ef4444');
          }
          this.eventBus.emit('mechanic:bearTrapTriggered', { trap, target: player, targetType: 'player' });
        }
      }
    }

    // 5. Resolve fallen tree OBB collisions against zombies and player
    for (const obs of this.fallenTreeObstacles) {
      if (!obs.active) continue;
      const halfW = obs.width * 0.5;
      const halfH = obs.height * 0.5;
      if (!player.inVehicle && !player.ziplineState) {
        const pHit = MathUtils.circleVsOBB(player.x, player.y, player.radius, obs.x, obs.y, halfW, halfH, obs.angle);
        if (pHit.hit) {
          player.x += pHit.pushX;
          player.y += pHit.pushY;
        }
      }
      for (const z of zombies) {
        if (!z || !z.alive) continue;
        const zHit = MathUtils.circleVsOBB(z.x, z.y, z.radius, obs.x, obs.y, halfW, halfH, obs.angle);
        if (zHit.hit) {
          z.x += zHit.pushX;
          z.y += zHit.pushY;
        }
      }
    }

    // 6. Update Zipline cooldowns
    for (const zl of env.ziplines || []) {
      if (zl.cooldownTimer > 0) {
        zl.cooldownTimer = Math.max(0, zl.cooldownTimer - dt);
      }
    }

    // 7. Compute closest interactable prompt for HUD
    this.activePrompt = this.findClosestInteractable(player);
  }

  /**
   * Locate the closest interactive object within interaction range of the player.
   * @param {import('../../entities/Player.js').Player} player
   * @returns {Object|null}
   */
  findClosestInteractable(player) {
    const map = this.mapManager.getCurrentMap();
    if (!map || !player || player.inVehicle) return null;

    const range = 95;
    let best = null;
    let bestDist = range;

    // 1. Closed Doors
    for (const door of map.doors || []) {
      if (door.isOpen) continue;
      const cx = door.x + door.w * 0.5;
      const cy = door.y + door.h * 0.5;
      const d = MathUtils.dist(player.x, player.y, cx, cy);
      if (d < bestDist + 30) {
        bestDist = d;
        best = {
          kind: 'door',
          target: door,
          label: `[F] Open ${door.name} (${door.cost} PTS)`
        };
      }
    }

    // 2. Wall Weapons
    for (const ww of map.wallWeapons || []) {
      const d = MathUtils.dist(player.x, player.y, ww.x, ww.y);
      if (d < bestDist) {
        bestDist = d;
        best = {
          kind: 'wall_weapon',
          target: ww,
          label: `[F] Buy ${ww.name} (${ww.cost} PTS)`
        };
      }
    }

    // 3. Power Switches
    for (const pwr of map.powerLocations || []) {
      if (pwr.activated) continue;
      const d = MathUtils.dist(player.x, player.y, pwr.x, pwr.y);
      if (d < bestDist) {
        bestDist = d;
        best = {
          kind: 'power',
          target: pwr,
          label: `[F] Activate ${pwr.name} (FREE)`
        };
      }
    }

    // 4. Pack-a-Punch Vaults
    for (const pap of map.packAPunchLocations || []) {
      const d = MathUtils.dist(player.x, player.y, pap.x, pap.y);
      if (d < bestDist) {
        bestDist = d;
        const cost = map.runtime?.allPowerActive ? 1500 : pap.cost || 2500;
        best = {
          kind: 'pap',
          target: pap,
          cost,
          label: `[F] Pack-a-Punch Weapon at ${pap.name} (${cost} PTS)`
        };
      }
    }

    const env = map.environmentalObjects || {};

    // 5. Ziplines (Blackwood Logging Camp)
    for (const zl of env.ziplines || []) {
      const dStart = MathUtils.dist(player.x, player.y, zl.startX, zl.startY);
      const dEnd = MathUtils.dist(player.x, player.y, zl.endX, zl.endY);
      if (dStart < bestDist) {
        bestDist = dStart;
        best = {
          kind: 'zipline_forward',
          target: zl,
          label: zl.cooldownTimer > 0
            ? `Zipline Cooling (${zl.cooldownTimer.toFixed(1)}s)`
            : `[F] Ride ${zl.name}`
        };
      } else if (dEnd < bestDist) {
        bestDist = dEnd;
        best = {
          kind: 'zipline_reverse',
          target: zl,
          label: zl.cooldownTimer > 0
            ? `Zipline Cooling (${zl.cooldownTimer.toFixed(1)}s)`
            : `[F] Ride ${zl.name} (Return)`
        };
      }
    }

    // 6. Sprung Bear Traps (Blackwood Logging Camp)
    for (const trap of env.bearTraps || []) {
      if (trap.armed) continue;
      const d = MathUtils.dist(player.x, player.y, trap.x, trap.y);
      if (d < bestDist) {
        bestDist = d;
        best = {
          kind: 'rearm_trap',
          target: trap,
          label: `[F] Re-Arm Steel Bear Trap (100 PTS)`
        };
      }
    }

    // 7. Easter Egg Nodes (Neon Night Market)
    for (const node of env.easterEggNodes || []) {
      if (node.activated) continue;
      const d = MathUtils.dist(player.x, player.y, node.x, node.y);
      if (d < bestDist) {
        bestDist = d;
        best = {
          kind: 'easter_egg',
          target: node,
          label: `[F] Hack ${node.name}`
        };
      }
    }

    return best;
  }

  /**
   * Execute the currently highlighted `[F]` interaction for the player.
   * @param {import('../../entities/Player.js').Player} player
   * @param {Array<import('../../entities/Zombie.js').Zombie>} zombies
   * @param {Function} [onFloatingText]
   * @returns {boolean} True if interaction succeeded
   */
  tryInteract(player, zombies = [], onFloatingText = null) {
    const map = this.mapManager.getCurrentMap();
    if (!map || !player) return false;

    const prompt = this.findClosestInteractable(player);
    if (!prompt) return false;

    const { kind, target } = prompt;

    if (kind === 'door') {
      if (player.points < target.cost) {
        soundManager.playInteraction('error');
        if (onFloatingText) onFloatingText(player.x, player.y - 24, `NEED ${target.cost} PTS!`, '#ef4444');
        return false;
      }
      player.points -= target.cost;
      target.isOpen = true;
      this.pathfindingManager.bakeStaticColliders(this.mapManager.getSolidColliders());
      soundManager.playInteraction('buy');
      if (onFloatingText) onFloatingText(target.x, target.y, `🔓 ${target.name} OPENED!`, '#4ade80');
      this.eventBus.emit('map:doorOpened', { door: target });
      return true;
    }

    if (kind === 'wall_weapon') {
      if (player.points < target.cost) {
        soundManager.playInteraction('error');
        if (onFloatingText) onFloatingText(player.x, player.y - 24, `NEED ${target.cost} PTS!`, '#ef4444');
        return false;
      }
      player.points -= target.cost;
      player.weaponKey = WEAPON_CATALOG[target.weaponKey] ? target.weaponKey : 'rifle';
      player.isPackAPunched = false;
      soundManager.playInteraction('buy');
      if (onFloatingText) onFloatingText(target.x, target.y - 18, `🔫 EQUIPPED ${target.name}!`, '#38bdf8');
      return true;
    }

    if (kind === 'power') {
      target.activated = true;
      map.runtime.powerActivatedCount = (map.powerLocations || []).filter((p) => p.activated).length;
      map.runtime.allPowerActive = map.runtime.powerActivatedCount >= map.runtime.totalPowerSwitches;
      soundManager.playInteraction('power');
      if (onFloatingText) {
        onFloatingText(
          target.x,
          target.y - 22,
          map.runtime.allPowerActive
            ? '⚡ ALL SECTOR POWER ONLINE! (PaP DISCOUNTED)'
            : `⚡ POWER SWITCH ONLINE (${map.runtime.powerActivatedCount}/${map.runtime.totalPowerSwitches})`,
          '#facc15'
        );
      }
      this.eventBus.emit('map:powerActivated', { power: target, allActive: map.runtime.allPowerActive });
      return true;
    }

    if (kind === 'pap') {
      const cost = prompt.cost || 2500;
      if (player.points < cost) {
        soundManager.playInteraction('error');
        if (onFloatingText) onFloatingText(player.x, player.y - 24, `NEED ${cost} PTS FOR PACK-A-PUNCH!`, '#ef4444');
        return false;
      }
      player.points -= cost;
      player.isPackAPunched = true;
      soundManager.playInteraction('power');
      const w = player.getActiveWeapon();
      if (onFloatingText) {
        onFloatingText(target.x, target.y - 24, `🔥 PACK-A-PUNCHED: ${w.displayName}!`, '#e879f9');
      }
      this.eventBus.emit('player:packAPunched', { weapon: w });
      return true;
    }

    if (kind === 'zipline_forward' || kind === 'zipline_reverse') {
      if (target.cooldownTimer > 0) return false;
      target.cooldownTimer = target.cooldown || 8;
      if (kind === 'zipline_forward') {
        player.startZipline(target.startX, target.startY, target.endX, target.endY, target.speed || 680);
      } else {
        player.startZipline(target.endX, target.endY, target.startX, target.startY, target.speed || 680);
      }
      soundManager.playInteraction('buy');
      if (onFloatingText) onFloatingText(player.x, player.y - 26, '🪢 ZIPLINE ESCAPE ENGAGED!', '#34d399');
      this.eventBus.emit('mechanic:ziplineUsed', { zipline: target });
      return true;
    }

    if (kind === 'rearm_trap') {
      if (player.points < 100) return false;
      player.points -= 100;
      target.armed = true;
      soundManager.playInteraction('buy');
      if (onFloatingText) onFloatingText(target.x, target.y - 18, '🪤 BEAR TRAP RE-ARMED!', '#f59e0b');
      return true;
    }

    if (kind === 'easter_egg') {
      target.activated = true;
      soundManager.playInteraction('electric');
      const nodes = map.environmentalObjects?.easterEggNodes || [];
      const activeCount = nodes.filter((n) => n.activated).length;

      if (activeCount >= nodes.length && !map.runtime.easterEggCompleted) {
        map.runtime.easterEggCompleted = true;
        player.points += 2500;
        player.isPackAPunched = true;
        for (const z of zombies) {
          if (z && z.alive) {
            z.takeDamage(9999, 'easter_egg_orbital');
            player.kills++;
          }
        }
        if (onFloatingText) {
          onFloatingText(
            player.x,
            player.y - 38,
            '🌟 CYBER SHRINE EASTER EGG COMPLETE! +2500 PTS & PACK-A-PUNCH UNLOCKED!',
            '#f472b6'
          );
        }
        this.eventBus.emit('map:easterEggCompleted', { mapId: map.id });
      } else if (onFloatingText) {
        onFloatingText(
          target.x,
          target.y - 22,
          `🔮 NEON RELAY HACKED (${activeCount}/${nodes.length})`,
          '#c084fc'
        );
      }
      return true;
    }

    return false;
  }
}

export default MapMechanicsController;
