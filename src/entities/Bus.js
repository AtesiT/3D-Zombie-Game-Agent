/**
 * @fileoverview Armored Transit Bus Entity (`Bus.js`).
 * Stores physical state, durability (HP), fuel level, driver occupancy, headlights,
 * and helper geometry for entry/exit and zombie crushing.
 */

export class Bus {
  /**
   * @param {Object} [config={}] - Data-driven bus configuration from map.json
   */
  constructor(config = {}) {
    this.id = 'armored_transit_bus';
    this.x = config.spawnX ?? 1180;
    this.y = config.spawnY ?? 920;
    this.angle = config.spawnAngle ?? 0; // Radians (0 = East)

    this.width = config.width ?? 150;
    this.height = config.height ?? 74;

    // Linear & angular velocity
    this.vx = 0;
    this.vy = 0;
    this.angularVelocity = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.speed = 0;
    this.driftAngle = 0;
    this.isDrifting = false;

    // Durability (HP)
    this.maxHealth = config.maxHealth ?? 1200;
    this.health = this.maxHealth;

    // Fuel / Energy
    this.maxFuel = config.maxFuel ?? 100;
    this.fuel = this.maxFuel;
    this.fuelConsumptionPerSec = config.fuelConsumptionPerSec ?? 2.4;

    // Physics parameters
    this.maxSpeed = config.maxSpeed ?? 430;
    this.reverseSpeed = config.reverseSpeed ?? 185;
    this.acceleration = config.acceleration ?? 380;
    this.braking = config.braking ?? 520;
    this.turnSpeed = config.turnSpeed ?? 2.35;
    this.normalGrip = config.normalGrip ?? 0.86;
    this.driftGrip = config.driftGrip ?? 0.28;

    // Crushing parameters
    this.minCrushSpeed = config.minCrushSpeed ?? 115;
    this.instaKillSmallSpeed = config.instaKillSmallSpeed ?? 140;
    this.crushDamageMultiplier = config.crushDamageMultiplier ?? 1.4;

    // Driver & Headlights state
    this.hasDriver = false;
    this.driver = null;
    this.headlightsOn = true;
    this.crushKills = 0;

    // Hit cooldown map so a single zombie isn't damaged 60 times in 1 second
    /** @type {Map<number, number>} */
    this.hitCooldowns = new Map();
  }

  /**
   * Compute the world position of the driver's side door (for entering/exiting the bus).
   * @returns {{ x: number, y: number }}
   */
  getDriverDoorPosition() {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    // Slightly forward and to the left side of the bus hull
    const localX = this.width * 0.2;
    const localY = -(this.height * 0.5 + 24);
    return {
      x: this.x + localX * cos - localY * sin,
      y: this.y + localX * sin + localY * cos
    };
  }

  /**
   * Compute the world positions of the two front headlights.
   * @returns {Array<{x:number, y:number, angle:number}>}
   */
  getHeadlightTransforms() {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const frontX = this.width * 0.5;
    const offsetY = this.height * 0.34;
    return [
      {
        x: this.x + frontX * cos - (-offsetY) * sin,
        y: this.y + frontX * sin + (-offsetY) * cos,
        angle: this.angle
      },
      {
        x: this.x + frontX * cos - offsetY * sin,
        y: this.y + frontX * sin + offsetY * cos,
        angle: this.angle
      }
    ];
  }

  /**
   * Apply damage to the bus armor from zombie attacks or environmental hazards.
   * @param {number} amount
   * @returns {number} Remaining health
   */
  takeDamage(amount) {
    this.health = Math.max(0, this.health - Math.max(0, amount));
    return this.health;
  }

  /**
   * Repair the bus armor by a specified amount.
   * @param {number} amount
   * @returns {number} New health value
   */
  repair(amount) {
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    return this.health;
  }

  /**
   * Refuel the bus tank by a specified amount.
   * @param {number} amount
   * @returns {number} New fuel value
   */
  refuel(amount) {
    this.fuel = Math.min(this.maxFuel, this.fuel + Math.max(0, amount));
    return this.fuel;
  }
}

export default Bus;
