/**
 * @fileoverview Player Flashlight Controller (`FlashlightController.js`).
 * Provides a toggleable directional cone of light for nighttime / dense fog survival,
 * with battery drain while active, low-battery flicker, and battery recharge/replacement.
 */

import { MathUtils } from '../../utils/MathUtils.js';
import { EventBus } from '../../utils/EventBus.js';
import { soundManager } from '../../utils/SoundManager.js';

export class FlashlightController {
  /**
   * @param {Object} [options={}]
   * @param {import('../../utils/EventBus.js').EventEmitter} [options.eventBus=EventBus]
   */
  constructor({ eventBus = EventBus } = {}) {
    this.eventBus = eventBus;
    this.isOn = false;
    this.autoEnableAtNight = true;

    this.maxBattery = 100;
    this.battery = 100;
    this.drainPerSecond = 2.2;        // ~45 seconds of continuous beam before recharge
    this.passiveRechargePerSec = 5.5; // Recharges when toggled off

    this.coneLength = 390;
    this.coneHalfAngleRad = 0.44;     // ~50 degree total cone spread
    this.flickerFactor = 1.0;
    this._flickerTime = 0;

    // Automatically turn on flashlight when Night starts if battery is available
    this.eventBus.on('time:phaseChanged', ({ phase }) => {
      if (phase === 'night' && this.autoEnableAtNight && this.battery > 15 && !this.isOn) {
        this.setFlashlight(true);
      } else if (phase === 'day' && this.isOn) {
        this.setFlashlight(false);
      }
    });
  }

  /**
   * Toggle the flashlight on or off (`L` key or HUD button).
   * @returns {boolean} New flashlight active state
   */
  toggle() {
    return this.setFlashlight(!this.isOn);
  }

  /**
   * Explicitly set the flashlight on or off.
   * @param {boolean} active
   * @returns {boolean}
   */
  setFlashlight(active) {
    if (active && this.battery <= 1) {
      this.isOn = false;
      soundManager.playInteraction('error');
      return false;
    }
    this.isOn = Boolean(active);
    soundManager.playInteraction('buy');
    this.eventBus.emit('flashlight:toggled', {
      isOn: this.isOn,
      battery: this.battery
    });
    return this.isOn;
  }

  /**
   * Add battery charge (e.g. from battery pickup or debug command).
   * @param {number} amount
   */
  addBattery(amount = 50) {
    this.battery = MathUtils.clamp(this.battery + amount, 0, this.maxBattery);
    this.eventBus.emit('flashlight:battery', { battery: this.battery, isOn: this.isOn });
  }

  /**
   * Update flashlight battery drain/recharge and low-battery flicker.
   * @param {number} dt
   */
  update(dt) {
    this._flickerTime += dt;

    if (this.isOn) {
      this.battery = Math.max(0, this.battery - this.drainPerSecond * dt);
      if (this.battery <= 0) {
        this.isOn = false;
        this.eventBus.emit('flashlight:depleted', { battery: 0 });
      } else if (this.battery < 18) {
        // Low-battery flicker warning
        this.flickerFactor = Math.sin(this._flickerTime * 28) > -0.35 ? 0.85 : 0.25;
      } else {
        this.flickerFactor = 1.0;
      }
    } else if (this.battery < this.maxBattery) {
      this.battery = Math.min(this.maxBattery, this.battery + this.passiveRechargePerSec * dt);
      this.flickerFactor = 1.0;
    }
  }

  /**
   * Carve the flashlight's directional light cone out of the darkness mask canvas,
   * and draw a subtle volumetric beam glow on the main viewport.
   * @param {CanvasRenderingContext2D} maskCtx - Offscreen darkness mask context (uses 'destination-out')
   * @param {CanvasRenderingContext2D} mainCtx - Main screen context for additive beam tint
   * @param {number} screenX - Player screen X
   * @param {number} screenY - Player screen Y
   * @param {number} angleRad - Player aim angle in radians
   * @param {number} darknessAlpha - Current night darkness [0..1]
   */
  renderCone(maskCtx, mainCtx, screenX, screenY, angleRad, darknessAlpha) {
    if (!this.isOn || this.battery <= 0) return;

    const range = this.coneLength * (0.75 + 0.25 * (this.battery / this.maxBattery));
    const halfAngle = this.coneHalfAngleRad;
    const strength = this.flickerFactor;

    // 1. Cut cone out of darkness mask
    if (maskCtx && darknessAlpha > 0.03) {
      maskCtx.save();
      maskCtx.globalCompositeOperation = 'destination-out';
      const grad = maskCtx.createRadialGradient(screenX, screenY, 8, screenX, screenY, range);
      grad.addColorStop(0, `rgba(0, 0, 0, ${0.98 * strength})`);
      grad.addColorStop(0.75, `rgba(0, 0, 0, ${0.82 * strength})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      maskCtx.fillStyle = grad;
      maskCtx.beginPath();
      maskCtx.moveTo(screenX, screenY);
      maskCtx.arc(screenX, screenY, range, angleRad - halfAngle, angleRad + halfAngle);
      maskCtx.closePath();
      maskCtx.fill();
      maskCtx.restore();
    }

    // 2. Draw visible warm beam cone on main canvas
    if (mainCtx) {
      mainCtx.save();
      const beamGrad = mainCtx.createRadialGradient(screenX, screenY, 10, screenX, screenY, range);
      beamGrad.addColorStop(0, `rgba(254, 249, 195, ${0.26 * strength})`);
      beamGrad.addColorStop(0.65, `rgba(253, 224, 71, ${0.11 * strength})`);
      beamGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');

      mainCtx.fillStyle = beamGrad;
      mainCtx.beginPath();
      mainCtx.moveTo(screenX, screenY);
      mainCtx.arc(screenX, screenY, range, angleRad - halfAngle, angleRad + halfAngle);
      mainCtx.closePath();
      mainCtx.fill();
      mainCtx.restore();
    }
  }
}

export default FlashlightController;
