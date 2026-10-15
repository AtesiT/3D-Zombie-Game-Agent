/**
 * @fileoverview Procedural Web Audio API Sound Engine with dynamic bus engine pitch synthesis,
 * zombie crushing SFX, gunfire, thunder, electrical hazards, and weather-driven low-pass filtering
 * (Heavy Rain muffles audio cues automatically).
 */

export class SoundManager {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {BiquadFilterNode|null} */
    this.weatherLowPassFilter = null;
    /** @type {GainNode|null} */
    this.masterGain = null;

    // Bus engine continuous synth nodes
    this._engineOsc = null;
    this._engineSubOsc = null;
    this._engineGain = null;
    this._engineRunning = false;

    this.muted = false;
    this.lowPassCutoffHz = 20000;
  }

  /**
   * Lazily initialize the Web Audio context on first user gesture.
   * @returns {boolean} True if audio context is active
   */
  ensureContext() {
    if (typeof window === 'undefined') return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        this.weatherLowPassFilter = this.ctx.createBiquadFilter();
        this.weatherLowPassFilter.type = 'lowpass';
        this.weatherLowPassFilter.frequency.value = this.lowPassCutoffHz;
        this.weatherLowPassFilter.Q.value = 0.7;

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.28;

        this.weatherLowPassFilter.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
      } catch (e) {
        return false;
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return Boolean(this.ctx);
  }

  /**
   * Update the master low-pass filter cutoff frequency (used by Heavy Rain / Thunderstorm to muffle audio cues).
   * @param {number} cutoffHz - Target cutoff frequency in Hz (e.g., 1600 in Heavy Rain, 20000 in Clear)
   */
  setWeatherLowPassCutoff(cutoffHz) {
    this.lowPassCutoffHz = Math.max(400, Math.min(20000, cutoffHz));
    if (this.ctx && this.weatherLowPassFilter) {
      this.weatherLowPassFilter.frequency.setTargetAtTime(
        this.lowPassCutoffHz,
        this.ctx.currentTime,
        0.15
      );
    }
  }

  /**
   * Start or update the continuous Armored Bus engine sound whose pitch changes with speed & throttle.
   * @param {boolean} active - Whether the player is driving or engine is idling
   * @param {number} speedNormalized - Normalized speed [0..1]
   * @param {number} throttle - Current throttle input [-1..1]
   */
  updateBusEngine(active, speedNormalized = 0, throttle = 0) {
    if (this.muted || !this.ensureContext()) return;

    if (!active) {
      if (this._engineRunning && this._engineGain && this.ctx) {
        this._engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.12);
      }
      return;
    }

    if (!this._engineRunning) {
      this._engineOsc = this.ctx.createOscillator();
      this._engineSubOsc = this.ctx.createOscillator();
      this._engineGain = this.ctx.createGain();

      this._engineOsc.type = 'sawtooth';
      this._engineSubOsc.type = 'triangle';
      this._engineOsc.frequency.value = 48;
      this._engineSubOsc.frequency.value = 24;
      this._engineGain.gain.value = 0.01;

      this._engineOsc.connect(this._engineGain);
      this._engineSubOsc.connect(this._engineGain);
      this._engineGain.connect(this.weatherLowPassFilter);

      this._engineOsc.start();
      this._engineSubOsc.start();
      this._engineRunning = true;
    }

    const basePitch = 44 + speedNormalized * 95 + Math.abs(throttle) * 22;
    const now = this.ctx.currentTime;
    this._engineOsc.frequency.setTargetAtTime(basePitch, now, 0.06);
    this._engineSubOsc.frequency.setTargetAtTime(basePitch * 0.5, now, 0.06);
    const targetGain = 0.06 + speedNormalized * 0.09 + Math.abs(throttle) * 0.04;
    this._engineGain.gain.setTargetAtTime(targetGain, now, 0.08);
  }

  /**
   * Play a visceral impact sound when the Armored Bus crushes or shoves a zombie.
   * @param {boolean} lethal - True if the zombie was crushed to death
   */
  playZombieCrush(lethal = true) {
    if (this.muted || !this.ensureContext()) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = lethal ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(lethal ? 135 : 95, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + (lethal ? 0.22 : 0.14));

    gain.gain.setValueAtTime(lethal ? 0.32 : 0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (lethal ? 0.24 : 0.15));

    osc.connect(gain);
    gain.connect(this.weatherLowPassFilter);
    osc.start(now);
    osc.stop(now + (lethal ? 0.25 : 0.16));
  }

  /**
   * Play weapon fire sound effect.
   * @param {string} weaponType - 'pistol' | 'shotgun' | 'smg' | 'rifle' | 'railgun' | 'turret'
   * @param {boolean} upgraded - True if Pack-a-Punched (adds laser harmonic)
   */
  playWeaponShot(weaponType = 'rifle', upgraded = false) {
    if (this.muted || !this.ensureContext()) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const startFreq = upgraded ? 520 : weaponType === 'shotgun' ? 140 : weaponType === 'railgun' ? 680 : 240;
    const duration = weaponType === 'shotgun' ? 0.16 : 0.09;

    osc.type = upgraded ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + duration);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.weatherLowPassFilter);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  /**
   * Play a rolling thunderclap for Thunderstorm lightning strikes.
   */
  playThunderStrike() {
    if (this.muted || !this.ensureContext()) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.65);

    gain.gain.setValueAtTime(0.38, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.72);
  }

  /**
   * Play an interaction chime (door opened, weapon purchased, Pack-a-Punch, trap triggered).
   * @param {'buy'|'error'|'power'|'electric'|'trap'|'horn'} kind
   */
  playInteraction(kind = 'buy') {
    if (this.muted || !this.ensureContext()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (kind === 'horn') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(185, now);
      osc.frequency.setValueAtTime(233, now + 0.05);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.weatherLowPassFilter);
      osc.start(now);
      osc.stop(now + 0.36);
      return;
    }

    const freqMap = {
      buy: [330, 520],
      power: [180, 440],
      electric: [480, 160],
      trap: [210, 75],
      error: [150, 110]
    };
    const [f1, f2] = freqMap[kind] || freqMap.buy;
    osc.type = kind === 'electric' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(f1, now);
    osc.frequency.exponentialRampToValueAtTime(f2, now + 0.18);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.weatherLowPassFilter);
    osc.start(now);
    osc.stop(now + 0.21);
  }
}

export const soundManager = new SoundManager();
export default soundManager;
