/**
 * @fileoverview Thunderstorm Lightning Strike Hazard & Flash Effect (`StormEffect.js`).
 * Triggers random lightning strikes every 10-20s in open areas (non-roofed),
 * telegraphs ground ionization for 1.4s, and deals 150 damage to anyone hit.
 */

import { MathUtils } from '../../../utils/MathUtils.js';
import { soundManager } from '../../../utils/SoundManager.js';
import { EventBus } from '../../../utils/EventBus.js';

export class StormEffect {
  /**
   * @param {import('../../../utils/EventBus.js').EventEmitter} [eventBus=EventBus]
   */
  constructor(eventBus = EventBus) {
    this.eventBus = eventBus;
    this.nextStrikeTimer = MathUtils.randomRange(10, 20);
    /** @type {Array<{x:number, y:number, radius:number, timer:number, maxTimer:number, struck:boolean, boltAlpha:number}>} */
    this.activeStrikes = [];
    this.screenFlashAlpha = 0;
    this.totalStrikesCount = 0;
  }

  /**
   * Immediately trigger a lightning strike at or near (x, y) (used by debug button or scheduler).
   * @param {number} x
   * @param {number} y
   * @param {number} [telegraphSeconds=1.2]
   */
  scheduleStrikeAt(x, y, telegraphSeconds = 1.2) {
    const strike = {
      x,
      y,
      radius: 110,
      timer: telegraphSeconds,
      maxTimer: Math.max(0.01, telegraphSeconds),
      struck: false,
      boltAlpha: 0
    };
    this.activeStrikes.push(strike);
    this.eventBus.emit('weather:lightningWarning', { x, y, radius: strike.radius });
    return strike;
  }

  /**
   * Update thunderstorm lightning timer and active strikes.
   * @param {number} dt
   * @param {boolean} enabled
   * @param {Object} context
   * @param {import('../../../entities/Player.js').Player} context.player
   * @param {Array<import('../../../entities/Zombie.js').Zombie>} context.zombies
   * @param {import('../../map/MapManager.js').MapManager} context.mapManager
   * @param {Function} [context.onFloatingText]
   */
  update(dt, enabled, { player, zombies = [], mapManager, onFloatingText } = {}) {
    if (this.screenFlashAlpha > 0) {
      this.screenFlashAlpha = Math.max(0, this.screenFlashAlpha - dt * 2.4);
    }

    if (enabled && player) {
      this.nextStrikeTimer -= dt;
      if (this.nextStrikeTimer <= 0) {
        this.nextStrikeTimer = MathUtils.randomRange(10, 20);
        const point = this._findOpenSkyPointNearPlayer(player, mapManager);
        if (point) {
          this.scheduleStrikeAt(point.x, point.y, 1.35);
        }
      }
    }

    for (let i = this.activeStrikes.length - 1; i >= 0; i--) {
      const s = this.activeStrikes[i];
      if (!s.struck) {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.struck = true;
          s.boltAlpha = 1.0;
          this.screenFlashAlpha = 0.65;
          this.totalStrikesCount++;
          soundManager.playThunderStrike();
          this._applyLightningDamage(s, player, zombies, mapManager, onFloatingText);
        }
      } else {
        s.boltAlpha -= dt * 2.8;
        if (s.boltAlpha <= 0) {
          this.activeStrikes.splice(i, 1);
        }
      }
    }
  }

  /**
   * Find a strike location near the player that is in an open-sky (non-roofed) area.
   * @private
   */
  _findOpenSkyPointNearPlayer(player, mapManager) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = MathUtils.randomRange(70, 320);
      const cx = player.x + Math.cos(angle) * dist;
      const cy = player.y + Math.sin(angle) * dist;
      if (!mapManager || !mapManager.isPointRoofed(cx, cy)) {
        return { x: cx, y: cy };
      }
    }
    return { x: player.x + 120, y: player.y };
  }

  /**
   * Apply 150 lightning damage to any entity inside the blast radius (if not under a roof).
   * @private
   */
  _applyLightningDamage(strike, player, zombies, mapManager, onFloatingText) {
    const damage = 150;
    let hits = 0;

    for (const z of zombies) {
      if (!z || !z.alive) continue;
      if (MathUtils.dist(z.x, z.y, strike.x, strike.y) <= strike.radius) {
        if (!mapManager || !mapManager.isPointRoofed(z.x, z.y)) {
          const killed = z.takeDamage(damage, 'lightning');
          hits++;
          if (killed && player) {
            player.points += 50;
            player.kills++;
          }
        }
      }
    }

    if (player && MathUtils.dist(player.x, player.y, strike.x, strike.y) <= strike.radius) {
      if (!mapManager || !mapManager.isPointRoofed(player.x, player.y)) {
        player.takeDamage(damage);
        hits++;
      }
    }

    if (onFloatingText) {
      onFloatingText(strike.x, strike.y - 24, `⚡ LIGHTNING STRIKE (-${damage} DMG)!`, '#facc15');
    }

    this.eventBus.emit('weather:lightningStrike', {
      x: strike.x,
      y: strike.y,
      radius: strike.radius,
      damage,
      hits,
      totalStrikesCount: this.totalStrikesCount
    });
  }

  /**
   * Render world-space lightning warning rings and jagged lightning bolts.
   * @param {CanvasRenderingContext2D} ctx
   */
  renderWorld(ctx) {
    if (this.activeStrikes.length === 0) return;

    ctx.save();
    for (const s of this.activeStrikes) {
      if (!s.struck) {
        const progress = 1 - MathUtils.clamp(s.timer / s.maxTimer, 0, 1);
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.4 + progress * 0.55})`;
        ctx.fillStyle = `rgba(56, 189, 248, ${0.12 + progress * 0.22})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Inner converging ring
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * (1 - progress), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Detonated bolt + scorch flash
        ctx.fillStyle = `rgba(250, 204, 21, ${s.boltAlpha * 0.45})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(254, 249, 195, ${s.boltAlpha})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        let bx = s.x - 25;
        let by = s.y - 420;
        ctx.moveTo(bx, by);
        for (let seg = 1; seg <= 6; seg++) {
          const ny = s.y - 420 + (420 * seg) / 6;
          const nx = seg === 6 ? s.x : s.x + (Math.random() - 0.5) * 45;
          ctx.lineTo(nx, ny);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Render screen-space lightning flash overlay.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} viewportW
   * @param {number} viewportH
   */
  renderScreen(ctx, viewportW, viewportH) {
    if (this.screenFlashAlpha <= 0.01) return;
    ctx.save();
    ctx.fillStyle = `rgba(224, 242, 254, ${this.screenFlashAlpha})`;
    ctx.fillRect(0, 0, viewportW, viewportH);
    ctx.restore();
  }
}

export default StormEffect;
