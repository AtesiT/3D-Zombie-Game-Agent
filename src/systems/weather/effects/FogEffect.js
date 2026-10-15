/**
 * @fileoverview Dense Fog Visual & Draw-Distance Effect (`FogEffect.js`).
 * Renders drifting volumetric fog banks and shrinks camera visibility radius to 40%.
 */

export class FogEffect {
  constructor() {
    this.clouds = Array.from({ length: 14 }, (_, i) => ({
      x: (i * 190) % 1600,
      y: (i * 130) % 950,
      vx: 18 + (i % 4) * 7,
      vy: (i % 2 === 0 ? 1 : -1) * 5,
      radius: 220 + (i % 5) * 65
    }));
  }

  /**
   * Update drifting fog clouds.
   * @param {number} dt
   * @param {number} intensity
   * @param {number} viewportW
   * @param {number} viewportH
   */
  update(dt, intensity, viewportW, viewportH) {
    if (intensity <= 0.02) return;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.x - c.radius > viewportW) c.x = -c.radius;
      if (c.y - c.radius > viewportH) c.y = -c.radius;
      if (c.y + c.radius < 0) c.y = viewportH + c.radius;
    }
  }

  /**
   * Render drifting fog layers and radial visibility constriction (40% visibility radius at full fog).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} intensity
   * @param {number} viewportW
   * @param {number} viewportH
   * @param {number} focusScreenX
   * @param {number} focusScreenY
   */
  render(ctx, intensity, viewportW, viewportH, focusScreenX, focusScreenY) {
    if (intensity <= 0.02) return;

    ctx.save();
    // Drifting fog puffs
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const grad = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, c.radius);
      grad.addColorStop(0, `rgba(203, 213, 225, ${0.16 * intensity})`);
      grad.addColorStop(1, 'rgba(203, 213, 225, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Radial visibility fog curtain (shrinks visible radius to 40% during Dense Fog)
    const baseRadius = Math.hypot(viewportW, viewportH) * 0.52;
    const clearRadius = baseRadius * (1 - intensity * 0.62); // 0.38 - 0.40 of base radius
    const outerRadius = clearRadius * 1.45 + 60;

    const fogVignette = ctx.createRadialGradient(
      focusScreenX,
      focusScreenY,
      clearRadius * 0.55,
      focusScreenX,
      focusScreenY,
      outerRadius
    );
    fogVignette.addColorStop(0, 'rgba(148, 163, 184, 0)');
    fogVignette.addColorStop(0.65, `rgba(100, 116, 139, ${0.58 * intensity})`);
    fogVignette.addColorStop(1, `rgba(71, 85, 105, ${0.92 * intensity})`);

    ctx.fillStyle = fogVignette;
    ctx.fillRect(0, 0, viewportW, viewportH);
    ctx.restore();
  }
}

export default FogEffect;
