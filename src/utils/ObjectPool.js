/**
 * @fileoverview Generic zero-allocation Object Pool for high-frequency game entities
 * (Zombies, Projectiles, Weather Particles, Surface Footprints/Tire Tracks, Floating Damage Texts).
 */

export class ObjectPool {
  /**
   * Create a new ObjectPool.
   * @template T
   * @param {() => T} factoryFn - Function that creates a new pooled instance
   * @param {(item: T) => void} [resetFn] - Function that resets an instance before reuse
   * @param {number} [initialSize=64] - Number of objects to pre-allocate immediately
   * @param {number} [maxSize=1024] - Hard cap on active + free objects to prevent runaway memory growth
   */
  constructor(factoryFn, resetFn = null, initialSize = 64, maxSize = 1024) {
    this._factoryFn = factoryFn;
    this._resetFn = resetFn;
    this._maxSize = maxSize;
    /** @type {Array<any>} */
    this._freeList = [];
    /** @type {Array<any>} */
    this._activeList = [];
    /** @type {Set<any>} */
    this._activeSet = new Set();

    this.prewarm(initialSize);
  }

  /**
   * Pre-allocate objects into the free list.
   * @param {number} count - Number of instances to pre-allocate
   */
  prewarm(count) {
    const target = Math.min(count, this._maxSize);
    for (let i = 0; i < target; i++) {
      const item = this._factoryFn();
      item.__pooledActive = false;
      this._freeList.push(item);
    }
  }

  /**
   * Acquire an object from the pool (or recycle the oldest active item if at capacity).
   * @returns {any} Pooled object ready for initialization
   */
  acquire() {
    let item = null;
    if (this._freeList.length > 0) {
      item = this._freeList.pop();
    } else if (this._activeList.length + this._freeList.length < this._maxSize) {
      item = this._factoryFn();
    } else if (this._activeList.length > 0) {
      // Recycle oldest active instance so particle/decal pools never leak or exceed maxSize
      item = this._activeList.shift();
      this._activeSet.delete(item);
    } else {
      item = this._factoryFn();
    }

    if (this._resetFn) {
      this._resetFn(item);
    }

    item.__pooledActive = true;
    this._activeList.push(item);
    this._activeSet.add(item);
    return item;
  }

  /**
   * Return an active object back to the pool.
   * @param {any} item - Object previously obtained via acquire()
   */
  release(item) {
    if (!item || !this._activeSet.has(item)) return;
    this._activeSet.delete(item);
    item.__pooledActive = false;

    const idx = this._activeList.indexOf(item);
    if (idx !== -1) {
      const last = this._activeList.pop();
      if (idx < this._activeList.length) {
        this._activeList[idx] = last;
      }
    }

    this._freeList.push(item);
  }

  /**
   * Release an active object by its index in the active list (O(1) swap-remove).
   * @param {number} activeIndex - Index in getActive() array
   */
  releaseAt(activeIndex) {
    if (activeIndex < 0 || activeIndex >= this._activeList.length) return;
    const item = this._activeList[activeIndex];
    this._activeSet.delete(item);
    item.__pooledActive = false;

    const last = this._activeList.pop();
    if (activeIndex < this._activeList.length) {
      this._activeList[activeIndex] = last;
    }

    this._freeList.push(item);
  }

  /**
   * Release all currently active objects back to the free list.
   */
  releaseAll() {
    while (this._activeList.length > 0) {
      const item = this._activeList.pop();
      item.__pooledActive = false;
      this._freeList.push(item);
    }
    this._activeSet.clear();
  }

  /**
   * Get the array of currently active objects for zero-allocation iteration.
   * @returns {Array<any>}
   */
  getActive() {
    return this._activeList;
  }

  /**
   * Get pool telemetry statistics.
   * @returns {{ active: number, free: number, total: number, maxSize: number }}
   */
  getStats() {
    return {
      active: this._activeList.length,
      free: this._freeList.length,
      total: this._activeList.length + this._freeList.length,
      maxSize: this._maxSize
    };
  }
}

export default ObjectPool;
