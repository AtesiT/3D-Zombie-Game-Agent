/**
 * @fileoverview Top-Down Inertia & Drift Vehicle Physics Controller (`VehicleController.js`).
 * Implements longitudinal acceleration, braking, reverse, speed-proportional steering torque,
 * and anisotropic lateral velocity cancellation with visible drift and weather slip modifiers.
 */

import { MathUtils } from '../../utils/MathUtils.js';

export class VehicleController {
  constructor() {
    this.weatherDriftBonus = 0; // e.g. +0.10 in Heavy Rain
    this.weatherSpeedMultiplier = 1.0; // e.g. 0.75 in Snow
  }

  /**
   * Apply weather gameplay modifiers to vehicle physics.
   * @param {{ driftBonus?: number, speedMultiplier?: number }} modifiers
   */
  setWeatherModifiers({ driftBonus = 0, speedMultiplier = 1.0 } = {}) {
    this.weatherDriftBonus = driftBonus;
    this.weatherSpeedMultiplier = speedMultiplier;
  }

  /**
   * Step the vehicle's top-down rigid-body physics for dt seconds.
   * @param {import('../../entities/Bus.js').Bus} vehicle
   * @param {{ throttle: number, steer: number, handbrake: boolean }} input
   * @param {number} dt - Delta time in seconds
   * @param {Array<{x:number, y:number, w:number, h:number}>} solidColliders - Map walls and closed doors
   * @param {{ width: number, height: number }} worldBounds
   */
  updatePhysics(vehicle, input, dt, solidColliders = [], worldBounds = { width: 2400, height: 1800 }) {
    const forwardX = Math.cos(vehicle.angle);
    const forwardY = Math.sin(vehicle.angle);
    const rightX = -forwardY;
    const rightY = forwardX;

    // Decompose world velocity into vehicle-local forward and lateral components
    let forwardVel = vehicle.vx * forwardX + vehicle.vy * forwardY;
    let lateralVel = vehicle.vx * rightX + vehicle.vy * rightY;

    const canPowerEngine = vehicle.hasDriver && vehicle.fuel > 0 && vehicle.health > 0;
    const throttle = canPowerEngine ? input.throttle : 0;
    const steer = canPowerEngine ? input.steer : 0;
    const handbrake = canPowerEngine ? input.handbrake : false;

    const maxFwd = vehicle.maxSpeed * this.weatherSpeedMultiplier;
    const maxRev = vehicle.reverseSpeed * this.weatherSpeedMultiplier;

    // 1. Longitudinal acceleration / braking / rolling resistance
    if (Math.abs(throttle) > 0.01) {
      const isBraking = (forwardVel > 15 && throttle < 0) || (forwardVel < -15 && throttle > 0);
      if (isBraking) {
        forwardVel = MathUtils.moveTowards(forwardVel, 0, vehicle.braking * dt);
      } else {
        const targetCap = throttle > 0 ? maxFwd : -maxRev;
        const accelRate = throttle > 0 ? vehicle.acceleration : vehicle.acceleration * 0.75;
        forwardVel = MathUtils.moveTowards(forwardVel, targetCap, accelRate * dt);
      }
    } else {
      const drag = handbrake ? vehicle.braking * 0.75 : 210;
      forwardVel = MathUtils.moveTowards(forwardVel, 0, drag * dt);
    }

    // 2. Speed-proportional steering with inertia (no snap-turning when stopped)
    const speedFactor = MathUtils.clamp(Math.abs(forwardVel) / 110, 0, 1);
    const reverseSign = forwardVel >= -10 ? 1 : -1;
    const driftSteerBoost = handbrake ? 1.38 : 1.0;
    const targetAngVel = steer * reverseSign * vehicle.turnSpeed * driftSteerBoost * speedFactor;

    vehicle.angularVelocity = MathUtils.lerp(vehicle.angularVelocity, targetAngVel, MathUtils.clamp(dt * 10, 0, 1));
    vehicle.angle += vehicle.angularVelocity * dt;

    // Transfer part of forward momentum into lateral velocity when rotating at speed (creates natural cornering drift!)
    lateralVel += forwardVel * vehicle.angularVelocity * dt * 0.55;

    // 3. Anisotropic Lateral Grip (controls drift slip; Heavy Rain adds +10% drift)
    const baseGrip = handbrake ? vehicle.driftGrip : vehicle.normalGrip;
    const weatherAdjustedGrip = MathUtils.clamp(baseGrip * (1 - this.weatherDriftBonus * 2.2), 0.12, 0.95);
    const lateralDamping = Math.pow(1 - weatherAdjustedGrip, dt * 8);
    lateralVel *= lateralDamping;

    // Reconstruct world velocity from updated heading
    const newFwdX = Math.cos(vehicle.angle);
    const newFwdY = Math.sin(vehicle.angle);
    const newRightX = -newFwdY;
    const newRightY = newFwdX;

    vehicle.vx = newFwdX * forwardVel + newRightX * lateralVel;
    vehicle.vy = newFwdY * forwardVel + newRightY * lateralVel;

    vehicle.x += vehicle.vx * dt;
    vehicle.y += vehicle.vy * dt;

    vehicle.forwardSpeed = forwardVel;
    vehicle.lateralSpeed = lateralVel;
    vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);
    vehicle.driftAngle = vehicle.speed > 25 ? Math.atan2(lateralVel, Math.abs(forwardVel) + 1) : 0;
    vehicle.isDrifting = vehicle.speed > 95 && (Math.abs(lateralVel) > 32 || handbrake);

    // 4. Resolve collisions against world bounds and solid walls
    const collisionRadius = Math.min(vehicle.width, vehicle.height) * 0.48;
    for (let i = 0; i < solidColliders.length; i++) {
      const wall = solidColliders[i];
      const res = MathUtils.circleVsRect(vehicle.x, vehicle.y, collisionRadius, wall);
      if (res.hit) {
        vehicle.x += res.pushX;
        vehicle.y += res.pushY;
        vehicle.vx *= 0.45;
        vehicle.vy *= 0.45;
      }
    }

    vehicle.x = MathUtils.clamp(vehicle.x, 80, worldBounds.width - 80);
    vehicle.y = MathUtils.clamp(vehicle.y, 80, worldBounds.height - 80);
  }
}

export default VehicleController;
