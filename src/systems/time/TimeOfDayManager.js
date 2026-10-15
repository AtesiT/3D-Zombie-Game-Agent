/**
 * @fileoverview Day/Night Cycle Manager (`TimeOfDayManager.js`).
 * Progresses in-game time (00:00 - 24:00) continuously and/or on wave advancement.
 * Phases & Gameplay Effects:
 * - Day (06:00-17:00): Full brightness, baseline spawn rate (1.0x)
 * - Dusk (17:00-19:00): Orange tint, long shadows (2.6x), +10% zombie spawn rate (1.10x)
 * - Night (19:00-06:00): Dark ambient, limited visibility, +50% zombie spawn rate (1.50x),
 *   player flashlight enabled, "Night Stalker" zombie variant unlocked.
 */

import { MathUtils } from '../../utils/MathUtils.js';
import { EventBus } from '../../utils/EventBus.js';

export class TimeOfDayManager {
  /**
   * @param {Object} [options={}]
   * @param {import('../../utils/EventBus.js').EventEmitter} [options.eventBus=EventBus]
   * @param {number} [options.initialHours=9.5] - Starting clock hour [0..24)
   * @param {number} [options.realSecondsPerGameHour=30] - Speed of continuous time progression
   */
  constructor({
    eventBus = EventBus,
    initialHours = 9.5,
    realSecondsPerGameHour = 30
  } = {}) {
    this.eventBus = eventBus;
    this.currentHours = ((initialHours % 24) + 24) % 24;
    this.realSecondsPerGameHour = realSecondsPerGameHour;
    this.isPaused = false;
    this.advanceOnWave = true;
    this.hoursPerWave = 1.75;

    this.phase = this._resolvePhase(this.currentHours);
    this.state = this._computeStateSnapshot();
  }

  /**
   * Resolve the discrete phase name from a 24-hour clock value.
   * - Day: 06:00 - 17:00
   * - Dusk: 17:00 - 19:00
   * - Night: 19:00 - 06:00
   * @param {number} hours
   * @returns {'day'|'dusk'|'night'}
   */
  _resolvePhase(hours) {
    const h = ((hours % 24) + 24) % 24;
    if (h >= 6 && h < 17) return 'day';
    if (h >= 17 && h < 19) return 'dusk';
    return 'night';
  }

  /**
   * Set the clock to a specific hour (0..24) or named phase ('day' | 'dusk' | 'night').
   * @param {number|string} timeOrPhase
   * @returns {Object} Updated time state snapshot
   */
  setTime(timeOrPhase) {
    if (typeof timeOrPhase === 'string') {
      const clean = timeOrPhase.toLowerCase().trim();
      if (clean === 'day' || clean === 'noon') {
        this.currentHours = 12.0;
      } else if (clean === 'dusk' || clean === 'sunset') {
        this.currentHours = 18.0;
      } else if (clean === 'night' || clean === 'midnight') {
        this.currentHours = 22.5;
      } else {
        const parsed = parseFloat(clean);
        if (!Number.isNaN(parsed)) {
          this.currentHours = ((parsed % 24) + 24) % 24;
        }
      }
    } else if (typeof timeOrPhase === 'number' && !Number.isNaN(timeOrPhase)) {
      this.currentHours = ((timeOrPhase % 24) + 24) % 24;
    }

    const prevPhase = this.phase;
    this.phase = this._resolvePhase(this.currentHours);
    this.state = this._computeStateSnapshot();

    if (prevPhase !== this.phase) {
      this.eventBus.emit('time:phaseChanged', {
        previousPhase: prevPhase,
        phase: this.phase,
        hours: this.currentHours,
        state: this.state
      });
    }
    this.eventBus.emit('time:updated', this.state);
    return this.state;
  }

  /**
   * Pause or resume continuous time progression.
   * @param {boolean} [paused]
   * @returns {boolean} Current paused state
   */
  setPaused(paused) {
    this.isPaused = typeof paused === 'boolean' ? paused : !this.isPaused;
    this.eventBus.emit('time:paused', { isPaused: this.isPaused });
    return this.isPaused;
  }

  /**
   * Advance clock when a survival wave completes.
   */
  onWaveAdvanced() {
    if (!this.advanceOnWave) return;
    this.setTime(this.currentHours + this.hoursPerWave);
  }

  /**
   * Step the Day/Night clock forward by dt real seconds.
   * @param {number} dt
   * @returns {Object} Current time state snapshot
   */
  update(dt) {
    if (!this.isPaused && this.realSecondsPerGameHour > 0) {
      const deltaHours = dt / this.realSecondsPerGameHour;
      const nextHours = (this.currentHours + deltaHours) % 24;
      const prevPhase = this.phase;
      this.currentHours = nextHours;
      this.phase = this._resolvePhase(this.currentHours);
      this.state = this._computeStateSnapshot();

      if (prevPhase !== this.phase) {
        this.eventBus.emit('time:phaseChanged', {
          previousPhase: prevPhase,
          phase: this.phase,
          hours: this.currentHours,
          state: this.state
        });
      }
      this.eventBus.emit('time:updated', this.state);
    } else {
      this.state = this._computeStateSnapshot();
    }
    return this.state;
  }

  /**
   * Format current in-game hours as `HH:MM`.
   * @returns {string}
   */
  getFormattedClock() {
    const h = Math.floor(this.currentHours) % 24;
    const m = Math.floor((this.currentHours - Math.floor(this.currentHours)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Compute smoothly interpolated lighting, shadow, and gameplay modifiers for the current hour.
   * @private
   */
  _computeStateSnapshot() {
    const h = this.currentHours;
    const phase = this._resolvePhase(h);

    let darknessAlpha = 0.0;
    let ambientColor = [255, 255, 255, 0.0];
    let shadowLengthMultiplier = 1.0;
    let spawnRateMultiplier = 1.0;
    let visibilityRadius = 620;
    let allowNightStalkers = false;

    if (phase === 'day') {
      // 06:00 - 17:00: Full brightness, baseline spawn rates
      // Smooth dawn warm-up between 06:00 and 07:00
      if (h < 7.0) {
        const t = h - 6.0;
        darknessAlpha = MathUtils.lerp(0.35, 0.0, t);
        shadowLengthMultiplier = MathUtils.lerp(2.1, 1.0, t);
        ambientColor = [251, 146, 60, MathUtils.lerp(0.16, 0.0, t)];
      } else {
        darknessAlpha = 0.0;
        shadowLengthMultiplier = 1.0 + Math.abs(h - 12.0) * 0.14;
        ambientColor = [255, 255, 255, 0.0];
      }
      spawnRateMultiplier = 1.0;
      visibilityRadius = 650;
      allowNightStalkers = false;
    } else if (phase === 'dusk') {
      // 17:00 - 19:00: Orange tint, long shadows, +10% zombie spawn rate
      const t = (h - 17.0) / 2.0; // 0..1 across Dusk
      darknessAlpha = MathUtils.lerp(0.12, 0.55, t);
      const orangeAlpha = Math.sin(t * Math.PI) * 0.24 + 0.14;
      ambientColor = [249, 115, 22, orangeAlpha];
      shadowLengthMultiplier = MathUtils.lerp(1.8, 2.8, Math.sin(t * Math.PI));
      spawnRateMultiplier = 1.10; // +10% zombie spawn rate
      visibilityRadius = MathUtils.lerp(560, 340, t);
      allowNightStalkers = false;
    } else {
      // Night (19:00 - 06:00): Dark, limited visibility, +50% spawn rate, Night Stalkers unlocked
      darknessAlpha = 0.78;
      ambientColor = [15, 23, 42, 0.35];
      shadowLengthMultiplier = 1.75;
      spawnRateMultiplier = 1.50; // +50% zombie spawn rate
      visibilityRadius = 215;
      allowNightStalkers = true;
    }

    // Sun azimuth angle for casting directional shadows
    const sunAngle = ((h - 6) / 24) * Math.PI * 2;

    return {
      hours: Number(h.toFixed(2)),
      formattedClock: this.getFormattedClock(),
      phase,
      phaseLabel: phase === 'day' ? 'Daytime' : phase === 'dusk' ? 'Dusk' : 'Nightfall',
      isPaused: this.isPaused,
      darknessAlpha,
      ambientColor,
      shadowLengthMultiplier: Number(shadowLengthMultiplier.toFixed(2)),
       sunAngle,
      spawnRateMultiplier,
      visibilityRadius,
      allowNightStalkers
    };
  }

  /**
   * Return the current time-of-day state snapshot.
   * @returns {Object}
   */
  getState() {
    return this.state;
  }
}

export default TimeOfDayManager;
