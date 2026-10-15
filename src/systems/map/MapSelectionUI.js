/**
 * @fileoverview Map Selection UI Controller.
 * Renders the data-driven map cards from MapManager, displays unique mechanics,
 * difficulty skulls, weather weights, and allows launching any map or importing a custom JSON map.
 */

import { EventBus } from '../../utils/EventBus.js';

export class MapSelectionUI {
  /**
   * @param {import('./MapManager.js').MapManager} mapManager
   * @param {import('../../utils/EventBus.js').EventEmitter} [eventBus=EventBus]
   */
  constructor(mapManager, eventBus = EventBus) {
    this.mapManager = mapManager;
    this.eventBus = eventBus;
    this.selectedMapId = 'terminal-transit';
    this.isVisible = true;

    this.containerEl = null;
    this.gridEl = null;
    this.detailEl = null;

    this._bindEvents();
  }

  /**
   * Bind EventBus listeners for map registry updates.
   * @private
   */
  _bindEvents() {
    this.eventBus.on('map:registryLoaded', ({ maps, defaultMapId }) => {
      if (!this.selectedMapId && defaultMapId) {
        this.selectedMapId = defaultMapId;
      }
      this.renderMapCards(maps);
      this.renderSelectedMapDetails();
    });

    this.eventBus.on('map:loaded', ({ map }) => {
      this.selectedMapId = map.id;
      this.hide();
    });
  }

  /**
   * Mount the Map Selection UI into the given DOM element.
   * @param {HTMLElement} rootElement
   */
  mount(rootElement) {
    this.containerEl = rootElement;
    if (!this.containerEl) return;

    this.containerEl.innerHTML = `
      <div class="map-select-backdrop">
        <div class="map-select-modal">
          <header class="map-select-header">
            <div>
              <span class="badge-tag">OPERATION DEAD TRANSIT // TACTICAL DEPLOYMENT</span>
              <h1>SELECT SURVIVAL SECTOR</h1>
              <p>Data-driven maps loaded dynamically from <code>/assets/maps/*/map.json</code></p>
            </div>
            <div class="header-actions">
              <label class="custom-map-upload-btn" title="Load a custom map.json file with zero code changes">
                <span>+ Import Custom Map JSON</span>
                <input type="file" id="custom-map-json-input" accept=".json,application/json" hidden />
              </label>
              <button type="button" id="close-map-select-btn" class="btn-secondary">Resume Match</button>
            </div>
          </header>

          <div class="map-select-body">
            <div id="map-cards-grid" class="map-cards-grid" role="listbox" aria-label="Available Maps"></div>
            <aside id="map-detail-panel" class="map-detail-panel"></aside>
          </div>
        </div>
      </div>
    `;

    this.gridEl = this.containerEl.querySelector('#map-cards-grid');
    this.detailEl = this.containerEl.querySelector('#map-detail-panel');

    const closeBtn = this.containerEl.querySelector('#close-map-select-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (this.mapManager.getCurrentMap()) {
          this.hide();
        }
      });
    }

    const fileInput = this.containerEl.querySelector('#custom-map-json-input');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const json = JSON.parse(text);
          const entry = this.mapManager.registerCustomMap(json);
          this.selectMap(entry.id);
          await this.launchSelectedMap();
        } catch (err) {
          alert(`Custom Map JSON error: ${err.message}`);
        }
      });
    }

    const maps = this.mapManager.getAvailableMaps();
    if (maps.length > 0) {
      this.renderMapCards(maps);
      this.renderSelectedMapDetails();
    }
  }

  /**
   * Render the list of available map cards.
   * @param {Array<Object>} maps
   */
  renderMapCards(maps) {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = maps
      .map((map) => {
        const isSelected = map.id === this.selectedMapId;
        const skulls = '💀'.repeat(Math.max(1, Math.min(5, map.difficulty || 3)));
        const tags = (map.uniqueMechanics?.tags || [])
          .map((t) => `<span class="mechanic-chip">${t}</span>`)
          .join('');

        return `
          <article
            class="map-card ${isSelected ? 'selected' : ''}"
            data-map-id="${map.id}"
            role="option"
            aria-selected="${isSelected}"
            tabindex="0"
          >
            <div class="map-card-thumb" style="background-image: url('${map.thumbnail}')">
              <span class="map-card-scene">${map.scene}</span>
              <span class="map-card-difficulty" title="Difficulty Rating">${skulls}</span>
            </div>
            <div class="map-card-content">
              <h3>${map.name}</h3>
              <p class="map-card-subtitle">${map.subtitle || ''}</p>
              <div class="map-card-mechanic-title">⚡ ${map.uniqueMechanics?.primary || 'Survival Sector'}</div>
              <div class="map-card-tags">${tags}</div>
              <button type="button" class="btn-deploy-card" data-launch-map="${map.id}">
                Deploy to ${map.name}
              </button>
            </div>
          </article>
        `;
      })
      .join('');

    this.gridEl.querySelectorAll('.map-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const id = card.getAttribute('data-map-id');
        this.selectMap(id);
        if (e.target.closest('[data-launch-map]')) {
          this.launchSelectedMap();
        }
      });
      card.addEventListener('dblclick', () => {
        const id = card.getAttribute('data-map-id');
        this.selectMap(id);
        this.launchSelectedMap();
      });
    });
  }

  /**
   * Render detailed inspector view for the currently highlighted map.
   */
  renderSelectedMapDetails() {
    if (!this.detailEl) return;
    const maps = this.mapManager.getAvailableMaps();
    const map = maps.find((m) => m.id === this.selectedMapId) || maps[0];
    if (!map) return;

    this.detailEl.innerHTML = `
      <div class="detail-preview" style="background-image: url('${map.layout || map.thumbnail}')">
        <div class="detail-preview-overlay">
          <span class="detail-id-pill">ID: ${map.id}</span>
          <h2>${map.name}</h2>
          <p>${map.subtitle || ''}</p>
        </div>
      </div>
      <div class="detail-info">
        <div class="detail-section">
          <h4>UNIQUE ENVIRONMENTAL MECHANIC</h4>
          <p class="detail-highlight">${map.uniqueMechanics?.primary || ''}</p>
          <p class="detail-desc">${map.uniqueMechanics?.summary || ''}</p>
        </div>
        <div class="detail-meta-grid">
          <div>
            <span class="meta-label">SCENE REF</span>
            <code>${map.scene}</code>
          </div>
          <div>
            <span class="meta-label">AUDIO STEM</span>
            <code>${map.musicTrack.split('/').pop()}</code>
          </div>
          <div>
            <span class="meta-label">SKYBOX PROFILE</span>
            <code>${map.background?.skybox || 'default'}</code>
          </div>
          <div>
            <span class="meta-label">CONFIG SOURCE</span>
            <code>${map.configUrl || 'Runtime JSON'}</code>
          </div>
        </div>
        <button type="button" id="confirm-launch-map-btn" class="btn-primary-launch">
          ▶ LAUNCH ${map.name.toUpperCase()}
        </button>
      </div>
    `;

    const launchBtn = this.detailEl.querySelector('#confirm-launch-map-btn');
    if (launchBtn) {
      launchBtn.addEventListener('click', () => this.launchSelectedMap());
    }
  }

  /**
   * Highlight a map by ID in the selection UI.
   * @param {string} mapId
   */
  selectMap(mapId) {
    this.selectedMapId = mapId;
    this.renderMapCards(this.mapManager.getAvailableMaps());
    this.renderSelectedMapDetails();
    this.eventBus.emit('map:previewSelected', { mapId });
  }

  /**
   * Load and start the currently selected map.
   * @returns {Promise<Object>}
   */
  async launchSelectedMap() {
    if (!this.selectedMapId) return null;
    return this.mapManager.loadMap(this.selectedMapId);
  }

  /**
   * Show the Map Selection UI overlay.
   */
  show() {
    this.isVisible = true;
    if (this.containerEl) {
      this.containerEl.classList.remove('hidden');
      this.renderMapCards(this.mapManager.getAvailableMaps());
      this.renderSelectedMapDetails();
    }
  }

  /**
   * Hide the Map Selection UI overlay.
   */
  hide() {
    this.isVisible = false;
    if (this.containerEl) {
      this.containerEl.classList.add('hidden');
    }
  }
}

export default MapSelectionUI;
