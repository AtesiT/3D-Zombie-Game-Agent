/**
 * @fileoverview Decoupled Pub/Sub Event Bus for cross-system communication.
 * Enables MapManager, WeatherManager, TimeOfDayManager, BusController, PathfindingManager,
 * and UI layers to communicate without tight coupling.
 */

export class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** @type {Map<string, any>} */
    this._lastPayloads = new Map();
  }

  /**
   * Subscribe a callback function to a named event.
   * @param {string} eventName - Event identifier (e.g. 'map:loaded', 'weather:changed')
   * @param {Function} callback - Handler invoked with event payload
   * @returns {Function} Unsubscribe closure
   */
  on(eventName, callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('EventBus.on requires a callback function');
    }
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(callback);

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      // Also mirror through DOM CustomEvent when requested by external consumers
    }

    return () => this.off(eventName, callback);
  }

  /**
   * Subscribe a callback function that executes at most once for the given event.
   * @param {string} eventName - Event identifier
   * @param {Function} callback - Handler invoked once
   * @returns {Function} Unsubscribe closure
   */
  once(eventName, callback) {
    const wrapper = (payload) => {
      this.off(eventName, wrapper);
      callback(payload);
    };
    return this.on(eventName, wrapper);
  }

  /**
   * Unsubscribe a callback function from a named event.
   * @param {string} eventName - Event identifier
   * @param {Function} callback - Previously registered callback
   */
  off(eventName, callback) {
    const set = this._listeners.get(eventName);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) {
      this._listeners.delete(eventName);
    }
  }

  /**
   * Emit an event synchronously to all registered listeners and dispatch a browser CustomEvent.
   * @param {string} eventName - Event identifier
   * @param {*} [payload] - Data payload passed to listeners
   */
  emit(eventName, payload) {
    this._lastPayloads.set(eventName, payload);
    const set = this._listeners.get(eventName);
    if (set && set.size > 0) {
      for (const listener of Array.from(set)) {
        try {
          listener(payload);
        } catch (err) {
          console.error(`[EventBus] Error in listener for "${eventName}":`, err);
        }
      }
    }

    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`game:${eventName}`, { detail: payload }));
    }
  }

  /**
   * Retrieve the most recent payload emitted for a given event name.
   * @param {string} eventName - Event identifier
   * @returns {*} Last emitted payload or undefined
   */
  getLastPayload(eventName) {
    return this._lastPayloads.get(eventName);
  }

  /**
   * Remove all listeners for a specific event or all events.
   * @param {string} [eventName] - Optional event name to clear
   */
  clear(eventName) {
    if (eventName) {
      this._listeners.delete(eventName);
      this._lastPayloads.delete(eventName);
    } else {
      this._listeners.clear();
      this._lastPayloads.clear();
    }
  }
}

/**
 * Shared singleton EventBus instance used across all game systems.
 * @type {EventEmitter}
 */
export const EventBus = new EventEmitter();
export default EventBus;
