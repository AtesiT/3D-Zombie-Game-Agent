/**
 * @fileoverview Top-Down Player Entity (`Player.js`).
 * Handles movement, weapon inventory, Pack-a-Punch upgrades, accuracy modifiers
 * (Heavy Rain -15% accuracy, Elevated Fire Escape +25% accuracy), speed modifiers
 * (Snow -25% speed, Mud Patches -40% speed, Bear Trap root), and Zipline traversal.
 */

import { MathUtils } from '../utils/MathUtils.js';
import { soundManager } from '../utils/SoundManager.js';

export const WEAPON_CATALOG = {
  pistol: {
    key: 'pistol',
    name: 'M1911 Tactical',
    upgradedName: 'Mustang & Sally Mk.II',
    damage: 38,
    fireRate: 5.5,
    spreadRad: 0.04,
    pellets: 1,
    projectileSpeed: 920,
    color: '#fbbf24',
    upgradedColor: '#f43f5e'
  },
  shotgun: {
    key: 'shotgun',
    name: 'M870 Combat Shotgun',
    upgradedName: 'Dragon Breath 870',
    damage: 32,
    fireRate: 1.8,
    spreadRad: 0.19,
    pellets: 6,
    projectileSpeed: 840,
    color: '#fb923c',
    upgradedColor: '#ec4899'
  },
  smg: {
    key: 'smg',
    name: 'KRISS Vector SMG',
    upgradedName: 'Neon Viper X9',
    damage: 30,
    fireRate: 11.5,
    spreadRad: 0.075,
    pellets: 1,
    projectileSpeed: 960,
    color: '#38bdf8',
    upgradedColor: '#22d3ee'
  },
  rifle: {
    key: 'rifle',
    name: 'M4A1 Tactical Rifle',
    upgradedName: 'Aether Punisher AR',
    damage: 54,
    fireRate: 8.2,
    spreadRad: 0.045,
    pellets: 1,
    projectileSpeed: 1080,
    color: '#a3e635',
    upgradedColor: '#c084fc'
  },
  railgun: {
    key: 'railgun',
    name: 'Vortex Arc Railgun',
    upgradedName: 'Zeus Omega Cannon',
    damage: 165,
    fireRate: 2.4,
    spreadRad: 0.015,
    pellets: 1,
    projectileSpeed: 1350,
    pierce: 3,
    color: '#60a5fa',
    upgradedColor: '#f472b6'
  }
};

export class Player {
  /**
   * @param {number} [x=1000]
   * @param {number} [y=900]
   */
  constructor(x = 1000, y = 900) {
    this.reset(x, y);
  }

  /**
   * Reset player state for a new match or map load.
   * @param {number} x
   * @param {number} y
   */
  reset(x = 1000, y = 900) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = 16;
    this.angle = 0;

    this.maxHealth = 150;
    this.health = 150;
    this.baseSpeed = 235;
    this.points = 1500;
    this.kills = 0;

    // Weapon state
    this.weaponKey = 'rifle';
    this.isPackAPunched = false;
    this.fireCooldown = 0;

    // Vehicle state
    this.inVehicle = false;
    this.vehicleRef = null;

    // Environmental & map modifiers
    this.weatherSpeedMultiplier = 1.0; // Snow = 0.75 (-25%)
    this.weatherAccuracyMultiplier = 1.0; // Heavy Rain = 0.85 (-15% accuracy)
    this.inMud = false;
    this.mudSpeedMultiplier = 1.0; // Mud patch = 0.60 (-40%)
    this.isElevated = false; // Fire escape = true (+25% accuracy, +20% damage)
    this.elevatedZoneName = '';
    this.rootedTimer = 0; // Bear trap root duration

    // Zipline state
    this.ziplineState = null; // { targetX, targetY, speed }

    this._footprintTimer = 0;
  }

  /**
   * Return active weapon stats including Pack-a-Punch upgrades.
   * @returns {Object}
   */
  getActiveWeapon() {
    const base = WEAPON_CATALOG[this.weaponKey] || WEAPON_CATALOG.rifle;
    const papMult = this.isPackAPunched ? 1.85 : 1.0;
    const elevDmgMult = this.isElevated ? 1.20 : 1.0;

    // Effective accuracy: Heavy Rain reduces accuracy by 15%; Elevated Fire Escape boosts accuracy by 25%
    const effectiveAccuracy =
      this.weatherAccuracyMultiplier * (this.isElevated ? 1.25 : 1.0);
    const effectiveSpread = base.spreadRad / Math.max(0.35, effectiveAccuracy);

    return {
      ...base,
      displayName: this.isPackAPunched ? base.upgradedName : base.name,
      damage: Math.round(base.damage * papMult * elevDmgMult),
      fireRate: base.fireRate * (this.isPackAPunched ? 1.25 : 1.0),
      spreadRad: effectiveSpread,
      effectiveAccuracyPercent: Math.round(effectiveAccuracy * 100),
      color: this.isPackAPunched ? base.upgradedColor : base.color,
      pierce: (base.pierce || 1) + (this.isPackAPunched ? 1 : 0)
    };
  }

  /**
   * Apply a bear-trap root effect for `duration` seconds.
   * @param {number} duration
   */
  applyRoot(duration) {
    this.rootedTimer = Math.max(this.rootedTimer, duration);
  }

  /**
   * Start a fast zipline escape traversal toward (endX, endY).
   * @param {number} startX
   * @param {number} startY
   * @param {number} endX
   * @param {number} endY
   * @param {number} [speed=680]
   */
  startZipline(startX, startY, endX, endY, speed = 680) {
    this.x = startX;
    this.y = startY;
    this.rootedTimer = 0;
    this.ziplineState = { targetX: endX, targetY: endY, speed };
  }

  /**
   * Apply damage to the player (ignored while inside the Armored Bus, which absorbs hits onto its armor).
   * @param {number} amount
   * @returns {boolean} True if player took damage
   */
  takeDamage(amount) {
    if (this.inVehicle && this.vehicleRef) {
      this.vehicleRef.takeDamage(amount);
      return false;
    }
    if (this.ziplineState) return false;
    this.health = Math.max(0, this.health - amount);
    return true;
  }

  /**
   * Update player movement, aiming, and shooting.
   * @param {number} dt
   * @param {Object} context
   */
  update(dt, {
    keys,
    mouseWorldX,
    mouseWorldY,
    mouseDown,
    solidColliders = [],
    worldBounds = { width: 2400, height: 1800 },
    onSpawnProjectile,
    onEmitDecal,
    emitFootprints = false
  }) {
    // Passive health regeneration when out of danger
    if (this.health > 0 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 4.5 * dt);
    }

    if (this.health <= 0) {
      // Auto-revive with small point penalty so survival sandbox testing never hard-locks
      this.health = this.maxHealth;
      this.points = Math.max(0, this.points - 250);
    }

    if (this.fireCooldown > 0) {
      this.fireCooldown -= dt;
    }

    if (this.rootedTimer > 0) {
      this.rootedTimer = Math.max(0, this.rootedTimer - dt);
    }

    // If riding zipline, glide directly over obstacles toward destination
    if (this.ziplineState) {
      const dx = this.ziplineState.targetX - this.x;
      const dy = this.ziplineState.targetY - this.y;
      const d = Math.hypot(dx, dy);
      if (d <= this.ziplineState.speed * dt + 8) {
        this.x = this.ziplineState.targetX;
        this.y = this.ziplineState.targetY;
        this.ziplineState = null;
      } else {
        this.x += (dx / d) * this.ziplineState.speed * dt;
        this.y += (dy / d) * this.ziplineState.speed * dt;
        this.angle = Math.atan2(dy, dx);
      }
      return;
    }

    // If driving the bus, position is managed by BusController
    if (this.inVehicle) {
      return;
    }

    // Aim toward mouse cursor in world space
    if (typeof mouseWorldX === 'number' && typeof mouseWorldY === 'number') {
      this.angle = Math.atan2(mouseWorldY - this.y, mouseWorldX - this.x);
    }

    // Movement input (disabled while rooted in a Bear Trap)
    let moveX = 0;
    let moveY = 0;
    if (this.rootedTimer <= 0 && keys) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) moveY -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) moveY += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) moveX -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) moveX += 1;
    }

    const len = Math.hypot(moveX, moveY);
    if (len > 0) {
      moveX /= len;
      moveY /= len;
    }

    const effectiveSpeed =
      this.baseSpeed * this.weatherSpeedMultiplier * (this.inMud ? this.mudSpeedMultiplier : 1.0);

    this.vx = moveX * effectiveSpeed;
    this.vy = moveY * effectiveSpeed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Resolve wall collisions
    for (let i = 0; i < solidColliders.length; i++) {
      const res = MathUtils.circleVsRect(this.x, this.y, this.radius, solidColliders[i]);
      if (res.hit) {
        this.x += res.pushX;
        this.y += res.pushY;
      }
    }

    this.x = MathUtils.clamp(this.x, 48, worldBounds.width - 48);
    this.y = MathUtils.clamp(this.y, 48, worldBounds.height - 48);

    // Emit footprints in Snow or Mud
    if ((emitFootprints || this.inMud) && len > 0.1 && onEmitDecal) {
      this._footprintTimer -= dt;
      if (this._footprintTimer <= 0) {
        this._footprintTimer = 0.16;
        onEmitDecal({
          type: this.inMud ? 'mud_footprint' : 'snow_footprint',
          x: this.x,
          y: this.y,
          angle: this.angle,
          alpha: 0.55
        });
      }
    }

    // Firing weapon
    if (mouseDown && this.fireCooldown <= 0 && onSpawnProjectile) {
      this.fireWeapon(onSpawnProjectile);
    }
  }

  /**
   * Fire the active weapon once.
   * @param {Function} onSpawnProjectile
   */
  fireWeapon(onSpawnProjectile) {
    const weapon = this.getActiveWeapon();
    this.fireCooldown = 1 / weapon.fireRate;

    const muzzleX = this.x + Math.cos(this.angle) * 22;
    const muzzleY = this.y + Math.sin(this.angle) * 22;

    for (let i = 0; i < weapon.pellets; i++) {
      const spreadOffset = (Math.random() - 0.5) * 2 * weapon.spreadRad;
      const shotAngle = this.angle + spreadOffset;
      onSpawnProjectile({
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(shotAngle) * weapon.projectileSpeed,
        vy: Math.sin(shotAngle) * weapon.projectileSpeed,
        damage: weapon.damage,
        color: weapon.color,
        pierce: weapon.pierce || 1,
        life: 1.15
      });
    }

    soundManager.playWeaponShot(this.weaponKey, this.isPackAPunched);
  }
}

export default Player;
