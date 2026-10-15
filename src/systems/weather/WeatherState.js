/**
 * @fileoverview Weather State Profiles & Smooth Interpolation (`WeatherState.js`).
 * Defines both visual presentation parameters and concrete gameplay modifiers for:
 * - Clear ('clear')
 * - Heavy Rain ('rain')
 * - Dense Fog ('fog')
 * - Thunderstorm ('thunderstorm')
 * - Snow ('snow')
 */

import { MathUtils } from '../../utils/MathUtils.js';

export const WEATHER_PROFILES = {
  clear: {
    name: 'clear',
    label: 'Clear Skies',
    icon: '☀️',
    accuracyMultiplier: 1.0,        // Baseline
    vehicleDriftBonus: 0.0,         // Baseline
    audioLowPassHz: 20000,          // Unmuffled
    visibilityMultiplier: 1.0,      // Full draw distance
    spawnDistanceMultiplier: 1.0,   // Baseline spawn distance
    moveSpeedMultiplier: 1.0,       // Baseline entity speed
    emitFootprints: false,
    lightningEnabled: false,
    rainIntensity: 0.0,
    fogIntensity: 0.0,
    snowIntensity: 0.0,
    tintColor: [15, 23, 42, 0.0],
    description: 'Baseline conditions. Full visibility and surface traction.'
  },
  rain: {
    name: 'rain',
    label: 'Heavy Rain',
    icon: '🌧️',
    accuracyMultiplier: 0.85,       // -15% player accuracy
    vehicleDriftBonus: 0.10,        // +10% vehicle drift
    audioLowPassHz: 1800,           // Audio cues muffled
    visibilityMultiplier: 0.85,
    spawnDistanceMultiplier: 0.95,
    moveSpeedMultiplier: 1.0,
    emitFootprints: false,
    lightningEnabled: false,
    rainIntensity: 1.0,
    fogIntensity: 0.18,
    snowIntensity: 0.0,
    tintColor: [30, 58, 95, 0.22],
    description: '-15% Player Accuracy, +10% Vehicle Drift, Audio Cues Muffled.'
  },
  fog: {
    name: 'fog',
    label: 'Dense Fog',
    icon: '🌫️',
    accuracyMultiplier: 1.0,
    vehicleDriftBonus: 0.02,
    audioLowPassHz: 14000,
    visibilityMultiplier: 0.40,     // Visibility radius shrinks to 40%
    spawnDistanceMultiplier: 0.70,  // Zombies spawn 30% closer undetected
    moveSpeedMultiplier: 1.0,
    emitFootprints: false,
    lightningEnabled: false,
    rainIntensity: 0.0,
    fogIntensity: 1.0,
    snowIntensity: 0.0,
    tintColor: [148, 163, 184, 0.36],
    description: 'Visibility radius shrinks to 40%; Zombies spawn 30% closer undetected.'
  },
  thunderstorm: {
    name: 'thunderstorm',
    label: 'Thunderstorm',
    icon: '⛈️',
    accuracyMultiplier: 0.85,       // Includes storm rain accuracy penalty
    vehicleDriftBonus: 0.10,        // Wet road drift
    audioLowPassHz: 1650,           // Heavy storm audio muffling
    visibilityMultiplier: 0.72,
    spawnDistanceMultiplier: 0.85,
    moveSpeedMultiplier: 1.0,
    emitFootprints: false,
    lightningEnabled: true,         // Random lightning strikes every 10-20s (150 damage)
    lightningDamage: 150,
    lightningIntervalMin: 10,
    lightningIntervalMax: 20,
    rainIntensity: 0.92,
    fogIntensity: 0.28,
    snowIntensity: 0.0,
    tintColor: [17, 24, 39, 0.28],
    description: 'Lightning strikes every 10-20s in open areas (150 DMG) + Rain modifiers.'
  },
  snow: {
    name: 'snow',
    label: 'Blizzard Snow',
    icon: '❄️',
    accuracyMultiplier: 0.95,
    vehicleDriftBonus: 0.12,
    audioLowPassHz: 9500,
    visibilityMultiplier: 0.78,
    spawnDistanceMultiplier: 0.90,
    moveSpeedMultiplier: 0.75,      // -25% movement speed for all entities
    emitFootprints: true,           // Footprints visible on ground
    lightningEnabled: false,
    rainIntensity: 0.0,
    fogIntensity: 0.25,
    snowIntensity: 1.0,
    tintColor: [241, 245, 249, 0.24],
    description: '-25% Movement Speed for all entities; Footprints & tire tracks visible.'
  }
};

export class WeatherState {
  /**
   * Normalize a user-supplied weather string (e.g. 'heavy_rain' -> 'rain').
   * @param {string} raw
   * @returns {string}
   */
  static normalizeName(raw) {
    if (!raw) return 'clear';
    const clean = String(raw).toLowerCase().trim().replace(/[\s_-]+/g, '');
    if (clean === 'heavyrain' || clean === 'rain') return 'rain';
    if (clean === 'densefog' || clean === 'fog') return 'fog';
    if (clean === 'thunderstorm' || clean === 'storm') return 'thunderstorm';
    if (clean === 'snow' || clean === 'blizzard') return 'snow';
    return 'clear';
  }

  /**
   * Interpolate smoothly between two weather profiles by t [0..1].
   * @param {Object} fromProfile
   * @param {Object} toProfile
   * @param {number} t - Blend progress [0..1]
   * @returns {Object} Blended weather state snapshot
   */
  static interpolate(fromProfile, toProfile, t) {
    const s = MathUtils.smoothStep(t);
    const active = s >= 0.5 ? toProfile : fromProfile;

    return {
      name: toProfile.name,
      previousName: fromProfile.name,
      label: toProfile.label,
      icon: toProfile.icon,
      description: toProfile.description,
      transitionProgress: MathUtils.clamp(t, 0, 1),
      accuracyMultiplier: MathUtils.lerp(fromProfile.accuracyMultiplier, toProfile.accuracyMultiplier, s),
      vehicleDriftBonus: MathUtils.lerp(fromProfile.vehicleDriftBonus, toProfile.vehicleDriftBonus, s),
      audioLowPassHz: MathUtils.lerp(fromProfile.audioLowPassHz, toProfile.audioLowPassHz, s),
      visibilityMultiplier: MathUtils.lerp(fromProfile.visibilityMultiplier, toProfile.visibilityMultiplier, s),
      spawnDistanceMultiplier: MathUtils.lerp(fromProfile.spawnDistanceMultiplier, toProfile.spawnDistanceMultiplier, s),
      moveSpeedMultiplier: MathUtils.lerp(fromProfile.moveSpeedMultiplier, toProfile.moveSpeedMultiplier, s),
      emitFootprints: s >= 0.35 ? toProfile.emitFootprints : fromProfile.emitFootprints,
      lightningEnabled: s >= 0.35 ? toProfile.lightningEnabled : fromProfile.lightningEnabled,
      lightningDamage: toProfile.lightningDamage || 150,
      rainIntensity: MathUtils.lerp(fromProfile.rainIntensity, toProfile.rainIntensity, s),
      fogIntensity: MathUtils.lerp(fromProfile.fogIntensity, toProfile.fogIntensity, s),
      snowIntensity: MathUtils.lerp(fromProfile.snowIntensity, toProfile.snowIntensity, s),
      tintColor: [
        Math.round(MathUtils.lerp(fromProfile.tintColor[0], toProfile.tintColor[0], s)),
        Math.round(MathUtils.lerp(fromProfile.tintColor[1], toProfile.tintColor[1], s)),
        Math.round(MathUtils.lerp(fromProfile.tintColor[2], toProfile.tintColor[2], s)),
        MathUtils.lerp(fromProfile.tintColor[3], toProfile.tintColor[3], s)
      ],
      activeDominant: active.name
    };
  }
}

export default WeatherState;
