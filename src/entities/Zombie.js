/**
 * @fileoverview Pooled Zombie Entity (`Zombie.js`).
 * Supports multiple variants ('small', 'walker', 'runner', 'brute', 'night_stalker'),
 * incremental A* pathfinding + dynamic obstacle avoidance around the Armored Bus,
 * window barrier attacks, fire-escape climbing slowdown, mud slowdown, and bear-trap rooting.
 */

import { MathUtils } from '../utils/MathUtils.js';

let NEXT_ZOMBIE_ID = 1;

export const ZOMBIE_VARIANTS = {
  small: {
    variant: 'small',
    label: 'Crawler',
    radius: 11,
    baseSpeed: 138,
    baseHp: 55,
    damage: 10,
    color: '#84cc16',
    outline: '#365314'
  },
  walker: {
    variant: 'walker',
    label: 'Walker',
    radius: 14,
    baseSpeed: 105,
    baseHp: 110,
    damage: 16,
    color: '#4ade80',
    outline: '#14532d'
  },
  runner: {
    variant: 'runner',
    label: 'Sprinter',
    radius: 13,
    baseSpeed: 152,
    baseHp: 90,
    damage: 18,
    color: '#facc15',
    outline: '#713f12'
  },
  brute: {
    variant: 'brute',
    label: 'Armored Brute',
    radius: 19,
    baseSpeed: 78,
    baseHp: 320,
    damage: 32,
    color: '#f97316',
    outline: '#7c2d12'
  },
  night_stalker: {
    variant: 'night_stalker',
    label: 'Night Stalker',
    radius: 15,
    baseSpeed: 178,
    baseHp: 190,
    damage: 34,
    color: '#e11d48',
    outline: '#881337',
    isNightExclusive: true
  }
};

export class Zombie {
  constructor() {
    this.id = NEXT_ZOMBIE_ID++;
    this.alive = false;
    this.reset();
  }

  /**
   * Reset pooled zombie state.
   */
  reset() {
    this.alive = false;
    this.variant = 'walker';
    this.label = 'Walker';
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.radius = 14;
    this.baseSpeed = 105;
    this.hp = 100;
    this.maxHp = 100;
    this.damage = 16;
    this.color = '#4ade80';
    this.outline = '#14532d';

    // Knockback & stun state
    this.knockbackVx = 0;
    this.knockbackVy = 0;
    this.stunTimer = 0;
    this.rootedTimer = 0;

    // Environmental modifiers
    this.inMud = false;
    this.mudSpeedMultiplier = 1.0;
    this.isClimbingFireEscape = false;
    this.climbSlowMultiplier = 1.0;

    // Pathfinding cache
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.lastPathVersion = 0;

    // Night Stalker AI state
    this.leapCooldown = 0;
    this.flankSign = Math.random() < 0.5 ? 1 : -1;
    this.attackCooldown = 0;
  }

  /**
   * Initialize a pooled zombie at (x, y) with wave scaling.
   * @param {Object} config
   * @param {number} config.x
   * @param {number} config.y
   * @param {string} [config.variant='walker']
   * @param {number} [config.wave=1]
   */
  spawn({ x, y, variant = 'walker', wave = 1 }) {
    const spec = ZOMBIE_VARIANTS[variant] || ZOMBIE_VARIANTS.walker;
    this.id = NEXT_ZOMBIE_ID++;
    this.alive = true;
    this.variant = spec.variant;
    this.label = spec.label;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = spec.radius;
    this.baseSpeed = spec.baseSpeed * (1 + Math.min(0.35, (wave - 1) * 0.03));
    const hpScale = 1 + (wave - 1) * 0.12;
    this.maxHp = Math.round(spec.baseHp * hpScale);
    this.hp = this.maxHp;
    this.damage = spec.damage;
    this.color = spec.color;
    this.outline = spec.outline;

    this.knockbackVx = 0;
    this.knockbackVy = 0;
    this.stunTimer = 0;
    this.rootedTimer = 0;
    this.inMud = false;
    this.isClimbingFireEscape = false;
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = Math.random() * 0.25;
    this.leapCooldown = 1.5;
    this.attackCooldown = 0;
  }

  /**
   * Apply external knockback impulse (e.g. when shoved or rammed by the Armored Bus).
   * @param {number} kx
   * @param {number} ky
   * @param {number} [stunSeconds=0.25]
   */
  applyKnockback(kx, ky, stunSeconds = 0.25) {
    this.knockbackVx = kx;
    this.knockbackVy = ky;
    this.stunTimer = Math.max(this.stunTimer, stunSeconds);
  }

  /**
   * Root the zombie in place (e.g. Bear Trap).
   * @param {number} durationSeconds
   */
  applyRoot(durationSeconds) {
    this.rootedTimer = Math.max(this.rootedTimer, durationSeconds);
  }

  /**
   * Inflict damage on the zombie.
   * @param {number} amount
   * @param {string} [source='bullet']
   * @returns {boolean} True if this hit killed the zombie
   */
  takeDamage(amount, source = 'bullet') {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deathSource = source;
      return true;
    }
    return false;
  }

  /**
   * Step zombie AI, pathfinding, and physics for dt seconds.
   * @param {number} dt
   * @param {Object} context
   */
  update(dt, {
    targetX,
    targetY,
    player,
    pathfindingManager,
    nightStalkerAI,
    weatherSpeedMultiplier = 1.0,
    timeSpeedMultiplier = 1.0,
    solidColliders = [],
    worldBounds = { width: 2400, height: 1800 }
  }) {
    if (!this.alive) return;

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.stunTimer > 0) this.stunTimer -= dt;
    if (this.rootedTimer > 0) this.rootedTimer -= dt;

    // Process knockback velocity decay
    if (Math.hypot(this.knockbackVx, this.knockbackVy) > 5) {
      this.x += this.knockbackVx * dt;
      this.y += this.knockbackVy * dt;
      const damp = Math.pow(0.02, dt);
      this.knockbackVx *= damp;
      this.knockbackVy *= damp;
    }

    // If rooted by a Bear Trap or stunned, skip voluntary locomotion
    if (this.rootedTimer > 0 || this.stunTimer > 0) {
      return;
    }

    // Recompute path incrementally when timer expires OR if a DynamicObstacle invalidated our cached path
    this.repathTimer -= dt;
    const pathInvalidated =
      pathfindingManager &&
      this.path &&
      this.lastPathVersion !== pathfindingManager.globalVersion &&
      pathfindingManager.isPathBlocked(this.path);

    if (pathfindingManager && (this.repathTimer <= 0 || !this.path || pathInvalidated)) {
      this.repathTimer = 0.35 + Math.random() * 0.2;
      this.path = pathfindingManager.findPath(this.x, this.y, targetX, targetY, 260);
      this.pathIndex = 0;
      this.lastPathVersion = pathfindingManager.globalVersion;
    }

    // Determine next steering waypoint
    let goalX = targetX;
    let goalY = targetY;
    if (this.path && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      if (MathUtils.dist(this.x, this.y, wp.x, wp.y) < 26 && this.pathIndex < this.path.length - 1) {
        this.pathIndex++;
      }
      const activeWp = this.path[this.pathIndex];
      goalX = activeWp.x;
      goalY = activeWp.y;
    }

    let dirX = goalX - this.x;
    let dirY = goalY - this.y;
    const distToGoal = Math.hypot(dirX, dirY) || 1;
    dirX /= distToGoal;
    dirY /= distToGoal;

    // Night Stalker specialized flank & leap behavior
    let stalkerSpeedBoost = 1.0;
    if (this.variant === 'night_stalker' && nightStalkerAI) {
      const mod = nightStalkerAI.computeBehavior(this, targetX, targetY, dirX, dirY, dt);
      dirX = mod.dirX;
      dirY = mod.dirY;
      stalkerSpeedBoost = mod.speedMultiplier;
    }

    // Apply tangential avoidance around dynamic obstacles (such as the Armored Bus or fallen logs)
    if (pathfindingManager) {
      const avoid = pathfindingManager.computeDynamicAvoidanceSteering(
        this.x,
        this.y,
        dirX,
        dirY,
        this.radius + 26
      );
      dirX = avoid.dirX;
      dirY = avoid.dirY;
    }

    const mudMult = this.inMud ? this.mudSpeedMultiplier : 1.0;
    const climbMult = this.isClimbingFireEscape ? this.climbSlowMultiplier : 1.0;
    const speed =
      this.baseSpeed *
      weatherSpeedMultiplier *
      timeSpeedMultiplier *
      mudMult *
      climbMult *
      stalkerSpeedBoost;

    this.vx = dirX * speed;
    this.vy = dirY * speed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = Math.atan2(this.vy, this.vx);

    // Resolve static wall collisions
    for (let i = 0; i < solidColliders.length; i++) {
      const res = MathUtils.circleVsRect(this.x, this.y, this.radius, solidColliders[i]);
      if (res.hit) {
        this.x += res.pushX;
        this.y += res.pushY;
      }
    }

    this.x = MathUtils.clamp(this.x, 30, worldBounds.width - 30);
    this.y = MathUtils.clamp(this.y, 30, worldBounds.height - 30);

    // Melee attack check against player
    if (player && !player.inVehicle && !player.ziplineState) {
      const dPlayer = MathUtils.dist(this.x, this.y, player.x, player.y);
      if (dPlayer <= this.radius + player.radius + 6 && this.attackCooldown <= 0) {
        this.attackCooldown = 0.75;
        player.takeDamage(this.damage);
      }
    }
  }
}

export default Zombie;
