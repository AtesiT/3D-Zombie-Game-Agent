/**
 * @fileoverview Vehicle Input Handler (`VehicleInput.js`).
 * Captures keyboard controls for throttle, braking/reverse, steering, handbrake drift,
 * horn, and vehicle entry/exit. Also supports scripted override inputs for automated testing.
 */

export class VehicleInput {
  constructor() {
    this.keys = new Set();
    this.throttle = 0;
    this.steer = 0;
    this.handbrake = false;
    this.hornPressed = false;
    this.exitRequested = false;

    /** @type {{throttle?:number, steer?:number, handbrake?:boolean}|null} */
    this._override = null;

    this._onKeyDown = (e) => {
      const code = e.code;
      this.keys.add(code);
      if (code === 'KeyH') {
        this.hornPressed = true;
      }
    };

    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
    }
  }

  /**
   * Sample current input state for the active frame.
   * @returns {{ throttle: number, steer: number, handbrake: boolean, horn: boolean }}
   */
  sample() {
    if (this._override) {
      this.throttle = this._override.throttle ?? 0;
      this.steer = this._override.steer ?? 0;
      this.handbrake = Boolean(this._override.handbrake);
      return {
        throttle: this.throttle,
        steer: this.steer,
        handbrake: this.handbrake,
        horn: false
      };
    }

    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const backward = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');

    this.throttle = (forward ? 1 : 0) - (backward ? 1 : 0);
    this.steer = (right ? 1 : 0) - (left ? 1 : 0);
    this.handbrake = this.keys.has('Space');

    const horn = this.hornPressed;
    this.hornPressed = false;

    return {
      throttle: this.throttle,
      steer: this.steer,
      handbrake: this.handbrake,
      horn
    };
  }

  /**
   * Set or clear programmatic driving inputs (used for autopilot demo or verification tests).
   * @param {{throttle?:number, steer?:number, handbrake?:boolean}|null} overrideState
   */
  setOverride(overrideState) {
    this._override = overrideState;
  }

  /**
   * Clean up DOM event listeners.
   */
  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
    }
  }
}

export default VehicleInput;
