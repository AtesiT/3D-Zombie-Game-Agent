/**
 * @fileoverview 2D Top-Down Math, Geometry, Collision, and Interpolation Utilities.
 */

export const MathUtils = {
  /**
   * Clamp a numeric value between min and max.
   * @param {number} val
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  },

  /**
   * Linearly interpolate between a and b by t [0..1].
   * @param {number} a
   * @param {number} b
   * @param {number} t
   * @returns {number}
   */
  lerp(a, b, t) {
    return a + (b - a) * this.clamp(t, 0, 1);
  },

  /**
   * Smooth Hermite interpolation between 0 and 1.
   * @param {number} t - Normalized parameter [0..1]
   * @returns {number}
   */
  smoothStep(t) {
    const c = this.clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  },

  /**
   * Move a value toward target by at most maxDelta.
   * @param {number} current
   * @param {number} target
   * @param {number} maxDelta
   * @returns {number}
   */
  moveTowards(current, target, maxDelta) {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  },

  /**
   * Shortest angular difference in radians between two angles.
   * @param {number} fromRad
   * @param {number} toRad
   * @returns {number} Angle delta in [-PI, PI]
   */
  angleDiff(fromRad, toRad) {
    let diff = ((toRad - fromRad + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
  },

  /**
   * Interpolate smoothly between two angles in radians.
   * @param {number} fromRad
   * @param {number} toRad
   * @param {number} t
   * @returns {number}
   */
  lerpAngle(fromRad, toRad, t) {
    return fromRad + this.angleDiff(fromRad, toRad) * this.clamp(t, 0, 1);
  },

  /**
   * Euclidean distance between two 2D points.
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @returns {number}
   */
   dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  },

  /**
   * Squared distance between two 2D points.
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @returns {number}
   */
  distSq(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  },

  /**
   * Test whether a point (px, py) lies inside an axis-aligned rectangle.
   * @param {number} px
   * @param {number} py
   * @param {{x:number, y:number, w:number, h:number}} rect
   * @returns {boolean}
   */
  pointInRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
  },

  /**
   * Resolve circle vs Axis-Aligned Bounding Box (AABB) collision.
   * Returns a push-out vector {x, y, hit} if overlapping.
   * @param {number} cx - Circle center X
   * @param {number} cy - Circle center Y
   * @param {number} r - Circle radius
   * @param {{x:number, y:number, w:number, h:number}} rect - AABB
   * @returns {{hit: boolean, pushX: number, pushY: number, closestX: number, closestY: number}}
   */
  circleVsRect(cx, cy, r, rect) {
    const closestX = this.clamp(cx, rect.x, rect.x + rect.w);
    const closestY = this.clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - closestX;
    const dy = cy - closestY;
    const dSq = dx * dx + dy * dy;
    if (dSq >= r * r) {
      return { hit: false, pushX: 0, pushY: 0, closestX, closestY };
    }
    const d = Math.sqrt(dSq);
    if (d < 0.0001) {
      // Center is inside rect; push out along shallowest axis
      const leftPen = (cx - rect.x) + r;
      const rightPen = (rect.x + rect.w - cx) + r;
      const topPen = (cy - rect.y) + r;
      const bottomPen = (rect.y + rect.h - cy) + r;
      const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
      if (minPen === leftPen) return { hit: true, pushX: -leftPen, pushY: 0, closestX, closestY };
      if (minPen === rightPen) return { hit: true, pushX: rightPen, pushY: 0, closestX, closestY };
      if (minPen === topPen) return { hit: true, pushX: 0, pushY: -topPen, closestX, closestY };
      return { hit: true, pushX: 0, pushY: bottomPen, closestX, closestY };
    }
    const overlap = r - d;
    return {
      hit: true,
      pushX: (dx / d) * overlap,
      pushY: (dy / d) * overlap,
      closestX,
      closestY
    };
  },

  /**
   * Test and resolve circle vs Oriented Bounding Box (OBB), such as the Armored Bus or fallen logs.
   * @param {number} cx - Circle world X
   * @param {number} cy - Circle world Y
   * @param {number} radius - Circle radius
   * @param {number} obbX - OBB center X
   * @param {number} obbY - OBB center Y
   * @param {number} halfW - OBB half-length (along forward axis)
   * @param {number} halfH - OBB half-width (along lateral axis)
   * @param {number} angle - OBB rotation in radians
   * @returns {{hit: boolean, pushX: number, pushY: number, localX: number, localY: number}}
   */
  circleVsOBB(cx, cy, radius, obbX, obbY, halfW, halfH, angle) {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const dx = cx - obbX;
    const dy = cy - obbY;

    // Transform circle center into OBB local space
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const clampedX = this.clamp(localX, -halfW, halfW);
    const clampedY = this.clamp(localY, -halfH, halfH);

    const diffX = localX - clampedX;
    const diffY = localY - clampedY;
    const distSq = diffX * diffX + diffY * diffY;

    if (distSq >= radius * radius) {
      return { hit: false, pushX: 0, pushY: 0, localX, localY };
    }

    let localPushX = 0;
    let localPushY = 0;
    const dist = Math.sqrt(distSq);

    if (dist < 0.0001) {
      const penX = halfW - Math.abs(localX) + radius;
      const penY = halfH - Math.abs(localY) + radius;
      if (penX < penY) {
        localPushX = (localX >= 0 ? 1 : -1) * penX;
      } else {
        localPushY = (localY >= 0 ? 1 : -1) * penY;
      }
    } else {
      const overlap = radius - dist;
      localPushX = (diffX / dist) * overlap;
      localPushY = (diffY / dist) * overlap;
    }

    // Rotate push vector back to world space
    const wCos = Math.cos(angle);
    const wSin = Math.sin(angle);
    return {
      hit: true,
      pushX: localPushX * wCos - localPushY * wSin,
      pushY: localPushX * wSin + localPushY * wCos,
      localX,
      localY
    };
  },

  /**
   * Raycast a line segment (x1,y1)->(x2,y2) against an axis-aligned rectangle.
   * Returns normalized hit fraction t in [0..1] or null if no intersection.
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @param {{x:number, y:number, w:number, h:number}} rect
   * @returns {number|null}
   */
  segmentVsRect(x1, y1, x2, y2, rect) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let tMin = 0;
    let tMax = 1;

    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];

    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-8) {
        if (q[i] < 0) return null;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > tMax) return null;
          if (t > tMin) tMin = t;
        } else {
          if (t < tMin) return null;
          if (t < tMax) tMax = t;
        }
      }
    }
    return tMin <= tMax ? tMin : null;
  },

  /**
   * Generate a random float between min and max.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  randomRange(min, max) {
    return min + Math.random() * (max - min);
  }
};

export default MathUtils;
