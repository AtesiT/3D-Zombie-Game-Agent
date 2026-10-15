/**
 * @fileoverview Data-Driven Map Manager.
 * Loads the map catalog from `/assets/maps/registry.json` and individual map definitions
 * from `/assets/maps/<id>/map.json`. Exposes the active map's data to all systems via EventBus.
 * Adding a new map requires ONLY adding a JSON entry + assets — zero JS code changes.
 */

import { EventBus } from '../../utils/EventBus.js';
import { MathUtils } from '../../utils/MathUtils.js';

export class MapManager {
  /**
   * @param {import('../../utils/EventBus.js').EventEmitter} [eventBus=EventBus]
   */
  constructor(eventBus = EventBus) {
    this.eventBus = eventBus;
    this.registryUrl = '/assets/maps/registry.json';
    /** @type {Array<Object>} */
    this.availableMaps = [];
    /** @type {Map<string, Object>} */
    this._rawMapCache = new Map();
    /** @type {Object|null} */
    this.currentMap = null;
    this.isLoading = false;
  }

  /**
   * Load the master map registry JSON file.
   * @param {string} [url='/assets/maps/registry.json']
   * @returns {Promise<Array<Object>>} List of map catalog entries
   */
  async loadRegistry(url = this.registryUrl) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`[MapManager] Failed to load map registry from ${url} (${response.status})`);
    }
    const data = await response.json();
    this.availableMaps = Array.isArray(data.maps) ? data.maps : [];
    this.eventBus.emit('map:registryLoaded', {
      maps: this.availableMaps,
      defaultMapId: data.defaultMapId || (this.availableMaps[0] && this.availableMaps[0].id)
    });
    return this.availableMaps;
  }

  /**
   * Register a new map definition dynamically at runtime (e.g. from custom JSON upload or mod).
   * Demonstrates that adding a map requires only JSON data and zero code changes.
   * @param {Object} mapJson - Complete map definition JSON object
   * @returns {Object} Registry entry created for the map
   */
  registerCustomMap(mapJson) {
    this.validateMapSchema(mapJson);
    this._rawMapCache.set(mapJson.id, JSON.parse(JSON.stringify(mapJson)));

    const existingIdx = this.availableMaps.findIndex((m) => m.id === mapJson.id);
    const catalogEntry = {
      id: mapJson.id,
      name: mapJson.name,
      subtitle: mapJson.subtitle || 'Custom Survival Sector',
      scene: mapJson.scene,
      configUrl: mapJson.configUrl || null,
      thumbnail: mapJson.thumbnail || '/assets/maps/terminal-transit/layout.png',
      tileset: mapJson.tileset || '/assets/maps/terminal-transit/tileset.png',
      layout: mapJson.layout || '/assets/maps/terminal-transit/layout.png',
      musicTrack: mapJson.musicTrack || '/assets/audio/custom_theme.ogg',
      difficulty: mapJson.difficulty || 3,
      background: mapJson.background,
      uniqueMechanics: {
        primary: mapJson.uniqueMechanics?.title || mapJson.uniqueMechanics?.type || 'Custom Mechanics',
        summary: mapJson.uniqueMechanics?.description || 'Custom data-driven map configuration.',
        tags: ['Custom JSON Map', mapJson.uniqueMechanics?.type || 'Survival']
      }
    };

    if (existingIdx >= 0) {
      this.availableMaps[existingIdx] = catalogEntry;
    } else {
      this.availableMaps.push(catalogEntry);
    }

    this.eventBus.emit('map:registryLoaded', {
      maps: this.availableMaps,
      defaultMapId: mapJson.id
    });
    return catalogEntry;
  }

  /**
   * Validate that a map JSON object contains all required acceptance criteria fields.
   * @param {Object} mapData
   */
  validateMapSchema(mapData) {
    if (!mapData || typeof mapData !== 'object') {
      throw new Error('[MapManager] Invalid map JSON: expected an object');
    }
    const requiredFields = ['id', 'name', 'scene', 'uniqueMechanics', 'musicTrack', 'background', 'thumbnail'];
    for (const field of requiredFields) {
      if (!mapData[field]) {
        throw new Error(`[MapManager] Map "${mapData.id || 'unknown'}" is missing required field "${field}"`);
      }
    }
  }

  /**
   * Load and activate a map by its ID.
   * Emits `map:unloaded`, `map:loading`, and `map:loaded` on the EventBus.
   * @param {string} mapId - Map identifier (e.g. 'terminal-transit', 'neon-night-market', 'blackwood-logging-camp')
   * @returns {Promise<Object>} Active map state instance
   */
  async loadMap(mapId) {
    if (this.isLoading) return this.currentMap;
    this.isLoading = true;

    try {
      if (this.currentMap) {
        const previousMap = this.currentMap;
        this.currentMap = null;
        this.eventBus.emit('map:unloaded', { map: previousMap });
      }

      this.eventBus.emit('map:loading', { mapId });

      let rawMap = this._rawMapCache.get(mapId);
      if (!rawMap) {
        const entry = this.availableMaps.find((m) => m.id === mapId);
        const configUrl = entry?.configUrl || `/assets/maps/${mapId}/map.json`;
        const response = await fetch(configUrl);
        if (!response.ok) {
          throw new Error(`[MapManager] Failed to load map JSON from ${configUrl} (${response.status})`);
        }
        rawMap = await response.json();
        this.validateMapSchema(rawMap);
        this._rawMapCache.set(mapId, rawMap);
      }

      // Deep clone so runtime state (opened doors, destroyed neon signs, fallen trees) resets cleanly on reload
      this.currentMap = JSON.parse(JSON.stringify(rawMap));
      this.currentMap.runtime = {
        loadedAt: performance.now(),
        powerActivatedCount: 0,
        totalPowerSwitches: (this.currentMap.powerLocations || []).length,
        allPowerActive: false,
        easterEggCompleted: false
      };

      this.isLoading = false;
      this.eventBus.emit('map:loaded', { map: this.currentMap });
      return this.currentMap;
    } catch (error) {
      this.isLoading = false;
      this.eventBus.emit('map:error', { mapId, error: error.message });
      throw error;
    }
  }

  /**
   * Return the currently loaded map object.
   * @returns {Object|null}
   */
  getCurrentMap() {
    return this.currentMap;
  }

  /**
   * Return the list of available maps from the registry.
   * @returns {Array<Object>}
   */
  getAvailableMaps() {
    return this.availableMaps;
  }

  /**
   * Return all currently solid wall rectangles (static walls + closed doors).
   * @returns {Array<{x:number, y:number, w:number, h:number, isDoor?:boolean, id?:string}>}
   */
  getSolidColliders() {
    if (!this.currentMap) return [];
    const colliders = [...(this.currentMap.walls || [])];
    for (const door of this.currentMap.doors || []) {
      if (!door.isOpen) {
        colliders.push({
          x: door.x,
          y: door.y,
          w: door.w,
          h: door.h,
          color: '#b45309',
          label: door.name,
          isDoor: true,
          id: door.id
        });
      }
    }
    return colliders;
  }

  /**
   * Check whether a world coordinate (x, y) is inside a roofed/indoor zone
   * (used by Thunderstorm lightning strikes so lightning only hits open-sky areas).
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isPointRoofed(x, y) {
    if (!this.currentMap || !this.currentMap.zones) return false;
    for (const zone of this.currentMap.zones) {
      if (zone.roofed && MathUtils.pointInRect(x, y, zone)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Return the zone containing (x, y), if any.
   * @param {number} x
   * @param {number} y
   * @returns {Object|null}
   */
  getZoneAt(x, y) {
    if (!this.currentMap || !this.currentMap.zones) return null;
    for (const zone of this.currentMap.zones) {
      if (MathUtils.pointInRect(x, y, zone)) {
        return zone;
      }
    }
    return null;
  }
}

export default MapManager;
