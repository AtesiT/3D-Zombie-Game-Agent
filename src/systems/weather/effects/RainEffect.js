/**
 * @fileoverview Pooled Heavy Rain Visual & Splash Effect (`RainEffect.js`).
 * Scales particle count with device capability and renders angled rain streaks + ground ripples.
 */

import { ObjectPool } from '../../../utils/ObjectPool.js';

export class RainEffect {
  /**
   * @param {number} [particleBudget=180]
   */
  constructor(particleBudget = 180) {
    this.budget = particleBudget;
    this.dropPool = new ObjectPool(
      () => ({ x: 0, y: 0, vx: -160, vy: 820, len: 20, alpha: 0.5 }),
      null,
      particleBudget,
      particleBudget
    );
    this.ripples = [];
  }

  /**
   * Update rain drops in screen space.
   * @param {number} dt
   * @param {number} intensity - [0..1]
   * @param {number} viewportW
   * @param {number} viewportH
   */
  update(dt, intensity, viewportW, viewportH) {
    if (intensity <= 0.02) {
      if (this.dropPool.getActive().length > 0) {
        this.dropPool.releaseAll();
      }
      this.ripples.length = 0;
      return;
    }

    const desiredCount = Math.floor(this.budget * intensity);
    const active = this.dropPool.getActive();

    while (active.length < desiredCount) {
      const d = this.dropPool.acquire();
      d.x = Math.random() * (viewportW + 160);
      d.y = Math.random() * viewportH;
      d.vx = -160 - Math.random() * 60;
      d.vy = 780 + Math.random() * 240;
      d.len = 16 + Math.random() * 14;
      d.alpha = (0.28 + Math.random() * 0.35) * intensity;
    }

    while (active.length > desiredCount) {
      this.dropPool.releaseAt(active.length - 1);
    }

    for (let i = 0; i < active.length; i++) {
      const d = active[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.alpha = (0.35 + (i % 5) * 0.08) * intensity;

      if (d.y > viewportH) {
        if (this.ripples.length < 36 && Math.random() < 0.25) {
          this.ripples.push({ x: d.x, y: viewportH - Math.random() * viewportH, r: 2, maxR: 12, alpha: 0.45 * intensity });
        }
        d.y = -20;
        d.x = Math.random() * (viewportW + 180);
      }
      if (d.x < -40) {
        d.x = viewportW + 40;
      }
    }

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += 26 * dt;
      rp.alpha -= 0.9 * dt;
      if (rp.alpha <= 0 || rp.r >= rp.maxR) {
        this.ripples.splice(i, 1);
      }
    }
  }

  /**
   * Render rain streaks and splash ripples to the viewport canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} intensity
   * @param {number} viewportW
   * @param {number} viewportH
   */
  render(ctx, intensity, viewportW, viewportH) {
    if (intensity <= 0.02) return;

    const active = this.dropPool.getActive();
    ctx.save();
    ctx.strokeStyle = `rgba(147, 197, 253, ${0.52 * intensity})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < active.length; i++) {
      const d = active[i];
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 4, d.y + d.len);
    }
    ctx.stroke();

    // Splash ripples
    for (let i = 0; i < this.ripples.length; i++) {
      const rp = this.ripples[i];
      ctx.strokeStyle = `rgba(186, 230, 253, ${Math.max(0, rp.alpha)})`;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

export default RainEffect;
