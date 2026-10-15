/**
 * @fileoverview Pooled Snow Particle & Frost Tint Effect (`SnowEffect.js`).
 * Renders drifting snowflakes, white frost tint overlay, and accompanies the -25% speed modifier
 * and persistent ground footprints/tire tracks.
 */

import { ObjectPool } from '../../../utils/ObjectPool.js';

export class SnowEffect {
  /**
   * @param {number} [particleBudget=150]
   */
  constructor(particleBudget = 150) {
    this.budget = particleBudget;
    this.flakePool = new ObjectPool(
      () => ({ x: 0, y: 0, vx: 0, vy: 80, r: 2.5, phase: 0 }),
      null,
      particleBudget,
      particleBudget
    );
    this._time = 0;
  }

  /**
   * Update snowflakes in screen space.
   * @param {number} dt
   * @param {number} intensity
   * @param {number} viewportW
   * @param {number} viewportH
   */
  update(dt, intensity, viewportW, viewportH) {
    this._time += dt;
    if (intensity <= 0.02) {
      if (this.flakePool.getActive().length > 0) {
        this.flakePool.releaseAll();
      }
      return;
    }

    const desiredCount = Math.floor(this.budget * intensity);
    const active = this.flakePool.getActive();

    while (active.length < desiredCount) {
      const f = this.flakePool.acquire();
      f.x = Math.random() * viewportW;
      f.y = Math.random() * viewportH;
      f.vx = -25 + Math.random() * 50;
      f.vy = 65 + Math.random() * 65;
      f.r = 1.6 + Math.random() * 2.8;
      f.phase = Math.random() * Math.PI * 2;
    }

    while (active.length > desiredCount) {
      this.flakePool.releaseAt(active.length - 1);
    }

    for (let i = 0; i < active.length; i++) {
      const f = active[i];
      f.x += (f.vx + Math.sin(this._time * 2 + f.phase) * 24) * dt;
      f.y += f.vy * dt;

      if (f.y > viewportH + 10) {
        f.y = -10;
        f.x = Math.random() * viewportW;
      }
      if (f.x < -10) f.x = viewportW + 10;
      if (f.x > viewportW + 10) f.x = -10;
    }
  }

  /**
   * Render falling snowflakes and subtle frost border tint.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} intensity
   * @param {number} viewportW
   * @param {number} viewportH
   */
  render(ctx, intensity, viewportW, viewportH) {
    if (intensity <= 0.02) return;

    const active = this.flakePool.getActive();
    ctx.save();
    ctx.fillStyle = `rgba(248, 250, 252, ${0.8 * intensity})`;
    ctx.beginPath();
    for (let i = 0; i < active.length; i++) {
      const f = active[i];
      ctx.moveTo(f.x + f.r, f.y);
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }
}

export default SnowEffect;
