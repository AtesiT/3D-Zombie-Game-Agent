/**
 * @fileoverview Dynamic Pathfinding Obstacle representation.
 * Computes the set of grid cells overlapped by an Oriented Bounding Box (OBB) such as the
 * moving Armored Bus or a felled tree, and outputs incremental cell diffs (added / removed cells)
 * so PathfindingManager never performs full-grid recomputation.
 */

import { MathUtils } from '../../utils/MathUtils.js';

export class DynamicObstacle {
  /**
   * @param {Object} config
   * @param {string} config.id - Unique obstacle ID
   * @param {number} config.x - Center world X
   * @param {number} config.y - Center world Y
   * @param {number} config.width - Full length along local X axis
   * @param {number} config.height - Full width along local Y axis
   * @param {number} [config.angle=0] - Heading in radians
   * @param {number} [config.padding=10] - Extra clearance radius for zombie agents
   */
  constructor({ id, x, y, width, height, angle = 0, padding = 10 }) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.angle = angle;
    this.padding = padding;
    this.active = true;

    // Last committed transform for threshold gating
    this._lastGridX = NaN;
    this._lastGridY = NaN;
    this._lastGridAngle = NaN;

    /** @type {Set<number>} Currently occupied 1D grid cell indices */
    this.occupiedCells = new Set();
  }

  /**
   * Check whether the obstacle has moved or rotated enough to warrant a local grid cell diff update.
   * @param {number} moveThreshold - Minimum translation in pixels (default 6px)
   * @param {number} angleThreshold - Minimum rotation in radians (default 0.05 rad)
   * @returns {boolean}
   */
  hasMovedBeyondThreshold(moveThreshold = 6, angleThreshold = 0.05) {
    if (Number.isNaN(this._lastGridX)) return true;
    const distSq = MathUtils.distSq(this.x, this.y, this._lastGridX, this._lastGridY);
    if (distSq >= moveThreshold * moveThreshold) return true;
    if (Math.abs(MathUtils.angleDiff(this.angle, this._lastGridAngle)) >= angleThreshold) return true;
    return false;
  }

  /**
   * Compute the incremental diff of grid cells occupied by this OBB.
   * Only scans the tight axis-aligned bounding box around the obstacle (typically 4x6 cells).
   * @param {number} cellSize - Grid cell size in world units
   * @param {number} cols - Grid column count
   * @param {number} rows - Grid row count
   * @returns {{ changed: boolean, added: number[], removed: number[] }}
   */
  computeIncrementalCellDiff(cellSize, cols, rows) {
    this._lastGridX = this.x;
    this._lastGridY = this.y;
    this._lastGridAngle = this.angle;

    const nextCells = new Set();

    if (this.active) {
      const halfW = this.width * 0.5 + this.padding;
      const halfH = this.height * 0.5 + this.padding;
      const cos = Math.abs(Math.cos(this.angle));
      const sin = Math.abs(Math.sin(this.angle));

      // Tight AABB around the rotated OBB
      const boundHalfX = halfW * cos + halfH * sin;
      const boundHalfY = halfW * sin + halfH * cos;

      const minCol = MathUtils.clamp(Math.floor((this.x - boundHalfX) / cellSize), 0, cols - 1);
      const maxCol = MathUtils.clamp(Math.floor((this.x + boundHalfX) / cellSize), 0, cols - 1);
      const minRow = MathUtils.clamp(Math.floor((this.y - boundHalfY) / cellSize), 0, rows - 1);
      const maxRow = MathUtils.clamp(Math.floor((this.y + boundHalfY) / cellSize), 0, rows - 1);

      const cellRadius = cellSize * 0.42;

      for (let r = minRow; r <= maxRow; r++) {
        const cy = (r + 0.5) * cellSize;
        for (let c = minCol; c <= maxCol; c++) {
          const cx = (c + 0.5) * cellSize;
          const hit = MathUtils.circleVsOBB(
            cx,
            cy,
            cellRadius,
            this.x,
            this.y,
            this.width * 0.5 + this.padding * 0.5,
            this.height * 0.5 + this.padding * 0.5,
            this.angle
          );
          if (hit.hit) {
            nextCells.add(r * cols + c);
          }
        }
      }
    }

    const added = [];
    const removed = [];

    for (const cellIdx of nextCells) {
      if (!this.occupiedCells.has(cellIdx)) {
        added.push(cellIdx);
      }
    }
    for (const cellIdx of this.occupiedCells) {
      if (!nextCells.has(cellIdx)) {
        removed.push(cellIdx);
      }
    }

    this.occupiedCells = nextCells;
    return {
      changed: added.length > 0 || removed.length > 0,
      added,
      removed
    };
  }
}

export default DynamicObstacle;
