/**
 * @fileoverview Dynamic Weather State Machine Manager (`WeatherManager.js`).
 * Orchestrates smooth 5-10s transitions between Clear, Heavy Rain, Dense Fog, Thunderstorm,
 * and Snow. Broadcasts gameplay modifiers via EventBus, supports JSON serialization,
 * and exposes debug hooks (URL params, console commands, and UI buttons).
 */

import { WEATHER_PROFILES, WeatherState } from './WeatherState.js';
import { RainEffect } from './effects/RainEffect.js';
import { FogEffect } from './effects/FogEffect.js';
import { StormEffect } from './effects/StormEffect.js';
import { SnowEffect } from './effects/SnowEffect.js';
import { MathUtils } from '../../utils/MathUtils.js';
import { EventBus } from '../../utils/EventBus.js';
import { soundManager } from '../../utils/SoundManager.js';

export class WeatherManager {
  /**
   * @param {Object} [options={}]
   * @param {import('../../utils/EventBus.js').EventEmitter} [options.eventBus=EventBus]
   * @param {number} [options.transitionDuration=6.0] - Smooth lerp duration in seconds (5-10s)
   * @param {number} [options.cycleIntervalSeconds=90] - Time between automatic weather changes
   */
  constructor({ eventBus = EventBus, transitionDuration = 6.0, cycleIntervalSeconds = 90 } = {}) {
    this.eventBus = eventBus;
    this.transitionDuration = MathUtils.clamp(transitionDuration, 5.0, 10.0);
    this.cycleIntervalSeconds = cycleIntervalSeconds;

    // Scale particle budgets based on device hardwareConcurrency
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const scale = cores >= 8 ? 1.0 : cores >= 4 ? 0.8 : 0.55;

    this.rainEffect = new RainEffect(Math.round(180 * scale));
    this.fogEffect = new FogEffect();
    this.stormEffect = new StormEffect(this.eventBus);
    this.snowEffect = new SnowEffect(Math.round(150 * scale));

    this.previousProfile = WEATHER_PROFILES.clear;
    this.targetProfile = WEATHER_PROFILES.clear;
    this.transitionProgress = 1.0;
    this.autoCycleTimer = this.cycleIntervalSeconds;
    this.autoCycleEnabled = true;

    /** @type {Array<{state:string, weight:number}>} */
    this.mapWeatherWeights = [
      { state: 'clear', weight: 30 },
      { state: 'rain', weight: 25 },
      { state: 'fog', weight: 20 },
      { state: 'thunderstorm', weight: 15 },
      { state: 'snow', weight: 10 }
    ];

    this.currentState = WeatherState.interpolate(this.previousProfile, this.targetProfile, 1.0);
  }

  /**
   * Configure map-specific weather probability table when a map loads.
   * @param {Object} mapData
   */
  configureForMap(mapData) {
    if (mapData && Array.isArray(mapData.weatherWeights) && mapData.weatherWeights.length > 0) {
      this.mapWeatherWeights = mapData.weatherWeights;
    }
  }

  /**
   * Transition to a target weather state ('clear' | 'rain' | 'fog' | 'thunderstorm' | 'snow').
   * @param {string} weatherName
   * @param {Object} [options={}]
   * @param {boolean} [options.immediate=false] - If true, skip the 5-10s lerp transition
   * @param {number} [options.durationSeconds] - Optional custom transition duration
   * @returns {Object} Target weather profile
   */
  setWeather(weatherName, { immediate = false, durationSeconds } = {}) {
    const key = WeatherState.normalizeName(weatherName);
    const nextProfile = WEATHER_PROFILES[key] || WEATHER_PROFILES.clear;

    // Snapshot current blended values as the starting point for smooth transition
    this.previousProfile = { ...this.targetProfile };
    this.targetProfile = nextProfile;

    if (typeof durationSeconds === 'number') {
      this.transitionDuration = MathUtils.clamp(durationSeconds, 0.1, 15.0);
    }

    this.transitionProgress = immediate ? 1.0 : 0.0;
    this.autoCycleTimer = this.cycleIntervalSeconds;

    this.currentState = WeatherState.interpolate(
      this.previousProfile,
      this.targetProfile,
      this.transitionProgress
    );

    soundManager.setWeatherLowPassCutoff(this.currentState.audioLowPassHz);

    this.eventBus.emit('weather:changed', {
      previous: this.previousProfile.name,
      current: this.targetProfile.name,
      state: this.currentState
    });
    this.eventBus.emit('weather:updated', this.currentState);

    return this.currentState;
  }

  /**
   * Roll the next weather state based on map weights (called on timer or wave threshold).
   */
  rollNextWeather() {
    const candidates = this.mapWeatherWeights.filter((w) => w.state !== this.targetProfile.name);
    const pool = candidates.length > 0 ? candidates : this.mapWeatherWeights;
    const totalWeight = pool.reduce((acc, item) => acc + (item.weight || 10), 0);
    let r = Math.random() * totalWeight;
    for (const entry of pool) {
      r -= entry.weight || 10;
      if (r <= 0) {
        return this.setWeather(entry.state);
      }
    }
    return this.setWeather(pool[0].state);
  }

  /**
   * Advance weather transition lerp, particles, and thunderstorm hazards.
   * @param {number} dt
   * @param {Object} context
   */
  update(dt, {
    viewportW = 1280,
    viewportH = 720,
    player = null,
    zombies = [],
    mapManager = null,
    onFloatingText = null
  } = {}) {
    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + dt / this.transitionDuration);
    }

    if (this.autoCycleEnabled) {
      this.autoCycleTimer -= dt;
      if (this.autoCycleTimer <= 0) {
        this.rollNextWeather();
      }
    }

    this.currentState = WeatherState.interpolate(
      this.previousProfile,
      this.targetProfile,
      this.transitionProgress
    );

    // Update WebAudio low-pass filter so Heavy Rain / Thunderstorm muffle audio cues smoothly
    soundManager.setWeatherLowPassCutoff(this.currentState.audioLowPassHz);

    // Apply gameplay modifiers directly to player entity
    if (player) {
      player.weatherAccuracyMultiplier = this.currentState.accuracyMultiplier;
      player.weatherSpeedMultiplier = this.currentState.moveSpeedMultiplier;
    }

    // Update visual effects
    this.rainEffect.update(dt, this.currentState.rainIntensity, viewportW, viewportH);
    this.fogEffect.update(dt, this.currentState.fogIntensity, viewportW, viewportH);
    this.snowEffect.update(dt, this.currentState.snowIntensity, viewportW, viewportH);
    this.stormEffect.update(dt, this.currentState.lightningEnabled, {
      player,
      zombies,
      mapManager,
      onFloatingText
    });

    this.eventBus.emit('weather:updated', this.currentState);
  }

  /**
   * Render world-space weather hazards (such as Thunderstorm lightning rings & bolts).
   * @param {CanvasRenderingContext2D} ctx
   */
  renderWorld(ctx) {
    this.stormEffect.renderWorld(ctx);
  }

  /**
   * Render screen-space weather overlays (tint, rain, snow, fog, lightning flashes).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} viewportW
   * @param {number} viewportH
   * @param {number} focusScreenX
   * @param {number} focusScreenY
   */
  renderScreen(ctx, viewportW, viewportH, focusScreenX, focusScreenY) {
    const st = this.currentState;
    const [r, g, b, a] = st.tintColor;
    if (a > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
      ctx.fillRect(0, 0, viewportW, viewportH);
      ctx.restore();
    }

    this.rainEffect.render(ctx, st.rainIntensity, viewportW, viewportH);
    this.snowEffect.render(ctx, st.snowIntensity, viewportW, viewportH);
    this.fogEffect.render(ctx, st.fogIntensity, viewportW, viewportH, focusScreenX, focusScreenY);
    this.stormEffect.renderScreen(ctx, viewportW, viewportH);
  }

  /**
   * Trigger an immediate lightning strike near the player (for debug verification or boss events).
   * @param {import('../../entities/Player.js').Player} player
   * @param {boolean} [instant=false]
   */
  triggerDebugLightningStrike(player, instant = false) {
    const x = player ? player.x + 65 : 1100;
    const y = player ? player.y : 900;
    return this.stormEffect.scheduleStrikeAt(x, y, instant ? 0.05 : 0.9);
  }

  /**
   * Return the current blended weather state snapshot.
   * @returns {Object}
   */
  getState() {
    return this.currentState;
  }

  /**
   * Serialize the current weather state to a JSON-compatible object.
   * @returns {Object}
   */
  toJSON() {
    return {
      previousWeather: this.previousProfile.name,
      targetWeather: this.targetProfile.name,
      transitionProgress: Number(this.transitionProgress.toFixed(3)),
      transitionDuration: this.transitionDuration,
      autoCycleTimer: Number(this.autoCycleTimer.toFixed(2)),
      autoCycleEnabled: this.autoCycleEnabled,
      modifiers: {
        accuracyMultiplier: Number(this.currentState.accuracyMultiplier.toFixed(3)),
        vehicleDriftBonus: Number(this.currentState.vehicleDriftBonus.toFixed(3)),
        visibilityMultiplier: Number(this.currentState.visibilityMultiplier.toFixed(3)),
        spawnDistanceMultiplier: Number(this.currentState.spawnDistanceMultiplier.toFixed(3)),
        moveSpeedMultiplier: Number(this.currentState.moveSpeedMultiplier.toFixed(3)),
        audioLowPassHz: Math.round(this.currentState.audioLowPassHz),
        emitFootprints: this.currentState.emitFootprints,
        lightningEnabled: this.currentState.lightningEnabled
      }
    };
  }

  /**
   * Restore weather state from a serialized JSON object.
   * @param {Object} data
   */
  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    const prevKey = WeatherState.normalizeName(data.previousWeather || 'clear');
    const targetKey = WeatherState.normalizeName(data.targetWeather || 'clear');
    this.previousProfile = WEATHER_PROFILES[prevKey] || WEATHER_PROFILES.clear;
    this.targetProfile = WEATHER_PROFILES[targetKey] || WEATHER_PROFILES.clear;
    this.transitionProgress = MathUtils.clamp(data.transitionProgress ?? 1.0, 0, 1);
    if (typeof data.transitionDuration === 'number') {
      this.transitionDuration = data.transitionDuration;
    }
    if (typeof data.autoCycleTimer === 'number') {
      this.autoCycleTimer = data.autoCycleTimer;
    }
    if (typeof data.autoCycleEnabled === 'boolean') {
      this.autoCycleEnabled = data.autoCycleEnabled;
    }
    this.currentState = WeatherState.interpolate(
      this.previousProfile,
      this.targetProfile,
      this.transitionProgress
    );
    this.eventBus.emit('weather:updated', this.currentState);
  }
}

export default WeatherManager;
