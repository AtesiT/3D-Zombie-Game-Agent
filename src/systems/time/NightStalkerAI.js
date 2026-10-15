/**
 * @fileoverview Night-Exclusive "Night Stalker" Zombie Variant AI (`NightStalkerAI.js`).
 * Active during Night (19:00-06:00). Night Stalkers move faster, deal heavier damage,
 * weave laterally to evade player aim when outside flashlight beams, and execute high-speed
 * pounce lunges when within striking distance.
 */

import { MathUtils } from '../../utils/MathUtils.js';

export class NightStalkerAI {
  constructor() {
    this.pounceRangeMin = 65;
    this.pounceRangeMax = 185;
    this.pounceCooldownSeconds = 3.2;
    this.pounceSpeedMultiplier = 2.15;
    this.flankWeaveAmplitude = 0.52;
  }

  /**
   * Determine whether a newly spawned zombie at Night should be promoted to a Night Stalker variant.
   * @param {boolean} isNightPhase
   * @param {number} [wave=1]
   * @returns {boolean}
   */
  shouldSpawnNightStalker(isNightPhase, wave = 1) {
    if (!isNightPhase) return false;
    const chance = MathUtils.clamp(0.28 + wave * 0.03, 0.28, 0.55);
    return Math.random() < chance;
  }

  /**
   * Compute specialized flanking and pounce steering for a Night Stalker zombie.
   * @param {import('../../entities/Zombie.js').Zombie} zombie
   * @param {number} targetX
   * @param {number} targetY
   * @param {number} baseDirX
   * @param {number} baseDirY
   * @param {number} dt
   * @returns {{ dirX: number, dirY: number, speedMultiplier: number, isPouncing: boolean }}
   */
  computeBehavior(zombie, targetX, targetY, baseDirX, baseDirY, dt) {
    if (zombie.leapCooldown > 0) {
      zombie.leapCooldown -= dt;
    }

    const dist = MathUtils.dist(zombie.x, zombie.y, targetX, targetY);

    // Trigger a high-speed pounce lunge when in mid-range
    if (
      dist >= this.pounceRangeMin &&
      dist <= this.pounceRangeMax &&
      zombie.leapCooldown <= 0
    ) {
      zombie.leapCooldown = this.pounceCooldownSeconds;
      zombie.pounceTimer = 0.42;
    }

    if (zombie.pounceTimer && zombie.pounceTimer > 0) {
      zombie.pounceTimer -= dt;
      return {
        dirX: baseDirX,
        dirY: baseDirY,
        speedMultiplier: this.pounceSpeedMultiplier,
        isPouncing: true
      };
    }

    // Outside pounce range: weave laterally along a flanking arc
    const perpX = -baseDirY * (zombie.flankSign || 1);
    const perpY = baseDirX * (zombie.flankSign || 1);
    const weave = Math.sin(performance.now() * 0.0055 + zombie.id) * this.flankWeaveAmplitude;

    const rawX = baseDirX + perpX * weave;
    const rawY = baseDirY + perpY * weave;
    const len = Math.hypot(rawX, rawY) || 1;

    return {
      dirX: rawX / len,
      dirY: rawY / len,
      speedMultiplier: 1.18,
      isPouncing: false
    };
  }
}

export default NightStalkerAI;
