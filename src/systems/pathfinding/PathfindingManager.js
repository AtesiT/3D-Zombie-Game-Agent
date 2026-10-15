/**
 * @fileoverview Incremental Grid Pathfinding & Dynamic Obstacle Avoidance Manager.
 * Combines localized OBB grid patching (for the moving Armored Bus and felled trees)
 * with fast bounded A* and tangential dynamic obstacle steering so 100+ zombies pathfind
 * smoothly around moving vehicles at 60 FPS without full-grid recomputation.
 */

import { MathUtils } from '../../utils/MathUtils.js';

export class PathfindingManager {
  /**
   * @param {number} [worldWidth=2400]
   * @param {number} [worldHeight=1800]
   * @param {number} [cellSize=40]
   */
  constructor(worldWidth = 2400, worldHeight = 1800, cellSize = 40) {
    this.initGrid(worldWidth, worldHeight, cellSize);
  }

  /**
   * Initialize or resize the navigation grid for a newly loaded map.
   * @param {number} worldWidth
   * @param {number} worldHeight
   * @param {number} [cellSize=40]
   */
  initGrid(worldWidth, worldHeight, cellSize = 40) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldHeight / cellSize);
    const total = this.cols * this.rows;

    /** @type {Uint8Array} 1 if blocked by static wall or closed door */
    this.staticGrid = new Uint8Array(total);
    /** @type {Uint8Array} Count of dynamic obstacles currently occupying cell */
    this.dynamicGrid = new Uint8Array(total);
    /** @type {Uint32Array} Cell modification version stamp for incremental path invalidation */
    this.cellVersion = new Uint32Array(total);
    this.globalVersion = 1;

    /** @type {Map<string, import('./DynamicObstacle.js').DynamicObstacle>} */
    this.dynamicObstacles = new Map();

    // Reusable A* search buffers to avoid per-query GC allocations
    this._searchStamp = new Uint32Array(total);
    this._gScore = new Float32Array(total);
    this._parent = new Int32Array(total);
    this._currentSearchId = 1;

    // Telemetry counters
    this.lastIncrementalCellsUpdated = 0;
    this.totalIncrementalUpdates = 0;
  }

  /**
   * Rasterize static walls and closed doors from the loaded map.
   * @param {Array<{x:number, y:number, w:number, h:number}>} colliders
   */
  bakeStaticColliders(colliders) {
    this.staticGrid.fill(0);
    const pad = 10;
    for (const rect of colliders) {
      const minC = MathUtils.clamp(Math.floor((rect.x - pad) / this.cellSize), 0, this.cols - 1);
      const maxC = MathUtils.clamp(Math.floor((rect.x + rect.w + pad) / this.cellSize), 0, this.cols - 1);
      const minR = MathUtils.clamp(Math.floor((rect.y - pad) / this.cellSize), 0, this.rows - 1);
      const maxR = MathUtils.clamp(Math.floor((rect.y + rect.h + pad) / this.cellSize), 0, this.rows - 1);

      for (let r = minR; r <= maxR; r++) {
        const rowOffset = r * this.cols;
        for (let c = minC; c <= maxC; c++) {
          this.staticGrid[rowOffset + c] = 1;
        }
      }
    }
    this.globalVersion++;
  }

  /**
   * Register a dynamic obstacle (such as the Armored Bus or a felled tree) and apply its initial cells.
   * @param {import('./DynamicObstacle.js').DynamicObstacle} obstacle
   */
  registerDynamicObstacle(obstacle) {
    if (!obstacle) return;
    this.dynamicObstacles.set(obstacle.id, obstacle);
    this.updateDynamicObstacle(obstacle, true);
  }

  /**
   * Remove a dynamic obstacle and clear only its occupied cells.
   * @param {string} obstacleId
   */
  unregisterDynamicObstacle(obstacleId) {
    const obs = this.dynamicObstacles.get(obstacleId);
    if (!obs) return;
    obs.active = false;
    this.updateDynamicObstacle(obs, true);
    this.dynamicObstacles.delete(obstacleId);
  }

  /**
   * Incrementally patch ONLY the grid cells that changed since the obstacle's last position.
   * Executes in O(k) where k is the perimeter cell diff (~8-20 cells), avoiding full-grid rebuilds.
   * @param {import('./DynamicObstacle.js').DynamicObstacle} obstacle
   * @param {boolean} [force=false]
   * @returns {boolean} True if any grid cells changed
   */
  updateDynamicObstacle(obstacle, force = false) {
    if (!obstacle) return false;
    if (!force && !obstacle.hasMovedBeyondThreshold(6, 0.05)) {
      return false;
    }

    const diff = obstacle.computeIncrementalCellDiff(this.cellSize, this.cols, this.rows);
    if (!diff.changed) return false;

    this.globalVersion++;
    for (let i = 0; i < diff.removed.length; i++) {
      const idx = diff.removed[i];
      if (this.dynamicGrid[idx] > 0) {
        this.dynamicGrid[idx]--;
      }
      this.cellVersion[idx] = this.globalVersion;
    }

    for (let i = 0; i < diff.added.length; i++) {
      const idx = diff.added[i];
      if (this.dynamicGrid[idx] < 255) {
        this.dynamicGrid[idx]++;
      }
      this.cellVersion[idx] = this.globalVersion;
    }

    this.lastIncrementalCellsUpdated = diff.added.length + diff.removed.length;
    this.totalIncrementalUpdates++;
    return true;
  }

  /**
   * Check whether a grid coordinate (col, row) is blocked by a static wall or dynamic obstacle.
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  isCellBlocked(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return true;
    const idx = row * this.cols + col;
    return this.staticGrid[idx] !== 0 || this.dynamicGrid[idx] !== 0;
  }

  /**
   * Check whether any cell in a previously cached path has been invalidated by a dynamic obstacle.
   * @param {Array<{col:number, row:number, idx:number}>} pathCells
   * @returns {boolean}
   */
  isPathBlocked(pathCells) {
    if (!pathCells || pathCells.length === 0) return true;
    for (let i = 0; i < pathCells.length; i++) {
      const idx = pathCells[i].idx;
      if (this.staticGrid[idx] !== 0 || this.dynamicGrid[idx] !== 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the nearest unblocked cell to (col, row) within a small search ring.
   * @param {number} col
   * @param {number} row
   * @returns {{col:number, row:number}}
   */
  findNearestWalkableCell(col, row) {
    const c0 = MathUtils.clamp(col, 0, this.cols - 1);
    const r0 = MathUtils.clamp(row, 0, this.rows - 1);
    if (!this.isCellBlocked(c0, r0)) return { col: c0, row: r0 };

    for (let radius = 1; radius <= 4; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
          const nc = c0 + dc;
          const nr = r0 + dr;
          if (!this.isCellBlocked(nc, nr)) {
            return { col: nc, row: nr };
          }
        }
      }
    }
    return { col: c0, row: r0 };
  }

  /**
   * Compute a grid path from (startX, startY) to (targetX, targetY) using bounded A*.
   * Returns an array of waypoint objects `{ x, y, col, row, idx }`.
   * @param {number} startX
   * @param {number} startY
   * @param {number} targetX
   * @param {number} targetY
   * @param {number} [maxIterations=380]
   * @returns {Array<{x:number, y:number, col:number, row:number, idx:number}>}
   */
  findPath(startX, startY, targetX, targetY, maxIterations = 380) {
    const rawStartCol = Math.floor(startX / this.cellSize);
    const rawStartRow = Math.floor(startY / this.cellSize);
    const rawGoalCol = Math.floor(targetX / this.cellSize);
    const rawGoalRow = Math.floor(targetY / this.cellSize);

    const start = this.findNearestWalkableCell(rawStartCol, rawStartRow);
    const goal = this.findNearestWalkableCell(rawGoalCol, rawGoalRow);

    const startIdx = start.row * this.cols + start.col;
    const goalIdx = goal.row * this.cols + goal.col;

    if (startIdx === goalIdx) {
      return [{ x: targetX, y: targetY, col: goal.col, row: goal.row, idx: goalIdx }];
    }

    this._currentSearchId = (this._currentSearchId + 1) & 0x7fffffff;
    const searchId = this._currentSearchId;

    // Simple binary-heap / flat priority open list
    const openIndices = [startIdx];
    const openF = [Math.hypot(goal.col - start.col, goal.row - start.row)];

    this._searchStamp[startIdx] = searchId;
    this._gScore[startIdx] = 0;
    this._parent[startIdx] = -1;

    let closestIdx = startIdx;
    let closestH = openF[0];
    let iterations = 0;

    // 8-way neighbor offsets
    const dCols = [1, -1, 0, 0, 1, 1, -1, -1];
    const dRows = [0, 0, 1, -1, 1, -1, 1, -1];
    const dCosts = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];

    while (openIndices.length > 0 && iterations < maxIterations) {
      iterations++;

      // Pop node with lowest F score
      let bestPos = 0;
      let bestF = openF[0];
      for (let i = 1; i < openF.length; i++) {
        if (openF[i] < bestF) {
          bestF = openF[i];
          bestPos = i;
        }
      }

      const currentIdx = openIndices[bestPos];
      const lastIdx = openIndices.pop();
      const lastF = openF.pop();
      if (bestPos < openIndices.length) {
        openIndices[bestPos] = lastIdx;
        openF[bestPos] = lastF;
      }

      if (currentIdx === goalIdx) {
        closestIdx = goalIdx;
        break;
      }

      const cRow = Math.floor(currentIdx / this.cols);
      const cCol = currentIdx - cRow * this.cols;
      const currentG = this._gScore[currentIdx];

      for (let dir = 0; dir < 8; dir++) {
        const nCol = cCol + dCols[dir];
        const nRow = cRow + dRows[dir];
        if (this.isCellBlocked(nCol, nRow)) continue;

        // Prevent diagonal corner-cutting across blocked cells
        if (dir >= 4) {
          if (this.isCellBlocked(cCol + dCols[dir], cRow) || this.isCellBlocked(cCol, cRow + dRows[dir])) {
            continue;
          }
        }

        const nIdx = nRow * this.cols + nCol;
        const tentativeG = currentG + dCosts[dir];

        if (this._searchStamp[nIdx] !== searchId || tentativeG < this._gScore[nIdx]) {
          this._searchStamp[nIdx] = searchId;
          this._gScore[nIdx] = tentativeG;
          this._parent[nIdx] = currentIdx;

          const h = Math.hypot(goal.col - nCol, goal.row - nRow);
          if (h < closestH) {
            closestH = h;
            closestIdx = nIdx;
          }

          openIndices.push(nIdx);
          openF.push(tentativeG + h * 1.15);
        }
      }
    }

    // Reconstruct path from closestIdx back to startIdx
    const path = [];
    let curr = closestIdx;
    let safety = 0;
    while (curr !== -1 && curr !== startIdx && safety < 256) {
      safety++;
      const r = Math.floor(curr / this.cols);
      const c = curr - r * this.cols;
      path.push({
        x: (c + 0.5) * this.cellSize,
        y: (r + 0.5) * this.cellSize,
        col: c,
        row: r,
        idx: curr
      });
      curr = this._parent[curr];
    }

    path.reverse();
    if (path.length === 0) {
      path.push({ x: targetX, y: targetY, col: goal.col, row: goal.row, idx: goalIdx });
    }
    return path;
  }

  /**
   * Compute a local steering vector that routes an agent around any nearby DynamicObstacle
   * (such as the Armored Bus) so agents never walk into or get stuck against the bus hull.
   * @param {number} ax - Agent X
   * @param {number} ay - Agent Y
   * @param {number} desiredDirX - Normalized desired direction X
   * @param {number} desiredDirY - Normalized desired direction Y
   * @param {number} [clearance=34] - Extra clearance radius around obstacle
   * @returns {{ dirX: number, dirY: number, avoided: boolean }}
   */
  computeDynamicAvoidanceSteering(ax, ay, desiredDirX, desiredDirY, clearance = 34) {
    let steerX = desiredDirX;
    let steerY = desiredDirY;
    let avoided = false;

    for (const obs of this.dynamicObstacles.values()) {
      if (!obs.active) continue;
      const halfW = obs.width * 0.5;
      const halfH = obs.height * 0.5;
      const check = MathUtils.circleVsOBB(ax, ay, clearance, obs.x, obs.y, halfW, halfH, obs.angle);
      if (check.hit) {
        avoided = true;
        const pLen = Math.hypot(check.pushX, check.pushY) || 1;
        const nx = check.pushX / pLen;
        const ny = check.pushY / pLen;

        // Choose tangent direction that aligns best with desired movement
        const tan1X = -ny;
        const tan1Y = nx;
        const tan2X = ny;
        const tan2Y = -nx;

        const dot1 = tan1X * desiredDirX + tan1Y * desiredDirY;
        const dot2 = tan2X * desiredDirX + tan2Y * desiredDirY;
        const tx = dot1 >= dot2 ? tan1X : tan2X;
        const ty = dot1 >= dot2 ? tan1Y : tan2Y;

        steerX = desiredDirX * 0.35 + tx * 0.95 + nx * 0.55;
        steerY = desiredDirY * 0.35 + ty * 0.95 + ny * 0.55;
      }
    }

    const len = Math.hypot(steerX, steerY) || 1;
    return { dirX: steerX / len, dirY: steerY / len, avoided };
  }
}

export default PathfindingManager;
