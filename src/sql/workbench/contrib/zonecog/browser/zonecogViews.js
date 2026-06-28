"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembraneHealthView = exports.CognitiveStateView = void 0;
require("vs/css!./media/zonecogDashboard");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const themeService_1 = require("vs/platform/theme/common/themeService");
const nls_1 = require("vs/nls");
const dom_1 = require("vs/base/browser/dom");
const viewPane_1 = require("vs/workbench/browser/parts/views/viewPane");
const views_1 = require("vs/workbench/common/views");
const configuration_1 = require("vs/platform/configuration/common/configuration");
const telemetry_1 = require("vs/platform/telemetry/common/telemetry");
const contextkey_1 = require("vs/platform/contextkey/common/contextkey");
const contextView_1 = require("vs/platform/contextview/browser/contextView");
const keybinding_1 = require("vs/platform/keybinding/common/keybinding");
const opener_1 = require("vs/platform/opener/common/opener");
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const cognitiveLoop_1 = require("sql/workbench/services/zonecog/common/cognitiveLoop");
const zonecogService_2 = require("sql/workbench/services/zonecog/common/zonecogService");
/**
 * Cognitive State View - displays the overall cognitive system state.
 */
let CognitiveStateView = class CognitiveStateView extends viewPane_1.ViewPane {
    zonecogService;
    loopService;
    membraneService;
    _container;
    _cognitiveStateSection;
    _loopStatusSection;
    _loadGaugeSection;
    constructor(options, instantiationService, viewDescriptorService, configurationService, telemetryService, contextKeyService, contextMenuService, keybindingService, openerService, themeService, zonecogService, loopService, membraneService) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
        this.zonecogService = zonecogService;
        this.loopService = loopService;
        this.membraneService = membraneService;
    }
    renderBody(container) {
        super.renderBody(container);
        this._container = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-view'));
        // Cognitive State Section
        this._cognitiveStateSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(this._cognitiveStateSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.cognitiveState', 'Cognitive State');
        // Loop Status Section
        this._loopStatusSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(this._loopStatusSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.loopStatus', 'Cognitive Loop');
        // Cognitive Load Section
        this._loadGaugeSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(this._loadGaugeSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.cognitiveLoad', 'Cognitive Load');
        // Subscribe to state changes
        this._register(this.zonecogService.onDidChangeCognitiveState(() => this._refreshCognitiveState()));
        this._register(this.loopService.onDidChangeState(() => this._refreshLoopStatus()));
        this._register(this.membraneService.onDidChangeMembraneStatus(() => this._refreshCognitiveState()));
        // Initial render
        this._refreshCognitiveState();
        this._refreshLoopStatus();
    }
    _refreshCognitiveState() {
        if (!this._cognitiveStateSection) {
            return;
        }
        // Clear existing content except header
        const header = this._cognitiveStateSection.querySelector('.zonecog-section-header');
        (0, dom_1.clearNode)(this._cognitiveStateSection);
        if (header) {
            this._cognitiveStateSection.appendChild(header);
        }
        const state = this.zonecogService.getCognitiveState();
        const grid = (0, dom_1.append)(this._cognitiveStateSection, (0, dom_1.$)('.zonecog-cognitive-state'));
        // Initialized
        this._createStatCard(grid, (0, nls_1.localize)('zonecog.initialized', 'Status'), state.isInitialized ? (0, nls_1.localize)('zonecog.active', 'Active') : (0, nls_1.localize)('zonecog.inactive', 'Inactive'), state.isInitialized ? 'positive' : 'warning');
        // Thinking Mode
        this._createStatCard(grid, (0, nls_1.localize)('zonecog.thinkingMode', 'Thinking'), state.thinkingModeEnabled ? (0, nls_1.localize)('zonecog.enabled', 'Enabled') : (0, nls_1.localize)('zonecog.disabled', 'Disabled'), state.thinkingModeEnabled ? 'positive' : '');
        // Hypergraph Nodes
        this._createStatCard(grid, (0, nls_1.localize)('zonecog.nodes', 'Nodes'), String(state.hypergraphNodeCount));
        // Membrane Health
        this._createStatCard(grid, (0, nls_1.localize)('zonecog.membranes', 'Membranes'), state.membraneHealthy ? (0, nls_1.localize)('zonecog.healthy', 'Healthy') : (0, nls_1.localize)('zonecog.unhealthy', 'Unhealthy'), state.membraneHealthy ? 'positive' : 'negative');
        // Cognitive Load Gauge
        this._refreshLoadGauge(state);
    }
    _refreshLoopStatus() {
        if (!this._loopStatusSection) {
            return;
        }
        // Clear existing content except header
        const header = this._loopStatusSection.querySelector('.zonecog-section-header');
        (0, dom_1.clearNode)(this._loopStatusSection);
        if (header) {
            this._loopStatusSection.appendChild(header);
        }
        const loopState = this.loopService.getState();
        const statusContainer = (0, dom_1.append)(this._loopStatusSection, (0, dom_1.$)('.zonecog-loop-status'));
        // Status indicator
        const indicator = (0, dom_1.append)(statusContainer, (0, dom_1.$)('.zonecog-loop-indicator'));
        if (loopState.running && !loopState.paused) {
            indicator.classList.add('running');
        }
        else if (loopState.paused) {
            indicator.classList.add('paused');
        }
        else {
            indicator.classList.add('stopped');
        }
        // Status label
        const label = (0, dom_1.append)(statusContainer, (0, dom_1.$)('.zonecog-loop-label'));
        if (loopState.running && !loopState.paused) {
            label.textContent = (0, nls_1.localize)('zonecog.loopRunning', 'Running');
        }
        else if (loopState.paused) {
            label.textContent = (0, nls_1.localize)('zonecog.loopPaused', 'Paused');
        }
        else {
            label.textContent = (0, nls_1.localize)('zonecog.loopStopped', 'Stopped');
        }
        // Stats
        const stats = (0, dom_1.append)(statusContainer, (0, dom_1.$)('.zonecog-loop-stats'));
        stats.textContent = (0, nls_1.localize)('zonecog.loopStats', '{0} iterations, avg {1}ms', loopState.totalIterations, loopState.averageIterationMs);
    }
    _refreshLoadGauge(state) {
        if (!this._loadGaugeSection) {
            return;
        }
        // Clear existing content except header
        const header = this._loadGaugeSection.querySelector('.zonecog-section-header');
        (0, dom_1.clearNode)(this._loadGaugeSection);
        if (header) {
            this._loadGaugeSection.appendChild(header);
        }
        const gauge = (0, dom_1.append)(this._loadGaugeSection, (0, dom_1.$)('.zonecog-load-gauge'));
        const fill = (0, dom_1.append)(gauge, (0, dom_1.$)('.zonecog-load-fill'));
        const text = (0, dom_1.append)(gauge, (0, dom_1.$)('.zonecog-load-text'));
        const loadPercent = Math.round(state.cognitiveLoad * 100);
        fill.style.width = `${loadPercent}%`;
        text.textContent = `${loadPercent}%`;
    }
    _createStatCard(container, label, value, className) {
        const card = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-stat-card'));
        (0, dom_1.append)(card, (0, dom_1.$)('.zonecog-stat-label')).textContent = label;
        const valueEl = (0, dom_1.append)(card, (0, dom_1.$)('.zonecog-stat-value'));
        valueEl.textContent = value;
        if (className) {
            valueEl.classList.add(className);
        }
    }
    layoutBody(height, width) {
        super.layoutBody(height, width);
    }
};
exports.CognitiveStateView = CognitiveStateView;
exports.CognitiveStateView = CognitiveStateView = __decorate([
    __param(1, instantiation_1.IInstantiationService),
    __param(2, views_1.IViewDescriptorService),
    __param(3, configuration_1.IConfigurationService),
    __param(4, telemetry_1.ITelemetryService),
    __param(5, contextkey_1.IContextKeyService),
    __param(6, contextView_1.IContextMenuService),
    __param(7, keybinding_1.IKeybindingService),
    __param(8, opener_1.IOpenerService),
    __param(9, themeService_1.IThemeService),
    __param(10, zonecogService_1.IZoneCogService),
    __param(11, cognitiveLoop_1.ICognitiveLoopService),
    __param(12, zonecogService_2.ICognitiveMembraneService)
], CognitiveStateView);
/**
 * Membrane Health View - displays the health of cognitive membrane triads.
 */
let MembraneHealthView = class MembraneHealthView extends viewPane_1.ViewPane {
    membraneService;
    _container;
    _membraneGrid;
    constructor(options, instantiationService, viewDescriptorService, configurationService, telemetryService, contextKeyService, contextMenuService, keybindingService, openerService, themeService, membraneService) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
        this.membraneService = membraneService;
    }
    renderBody(container) {
        super.renderBody(container);
        this._container = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-view'));
        const section = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(section, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.membraneTriads', 'Membrane Triads');
        this._membraneGrid = (0, dom_1.append)(section, (0, dom_1.$)('.zonecog-membrane-grid'));
        // Subscribe to membrane status changes
        this._register(this.membraneService.onDidChangeMembraneStatus(() => this._refreshMembranes()));
        // Initial render
        this._refreshMembranes();
    }
    _refreshMembranes() {
        if (!this._membraneGrid) {
            return;
        }
        (0, dom_1.clearNode)(this._membraneGrid);
        const triads = ['cerebral', 'somatic', 'autonomic'];
        const icons = {
            // allow-any-unicode-next-line
            cerebral: '🧠',
            // allow-any-unicode-next-line
            somatic: '💪',
            // allow-any-unicode-next-line
            autonomic: '⚡',
        };
        for (const triad of triads) {
            const status = this.membraneService.getStatus(triad);
            this._createMembraneCard(this._membraneGrid, triad, icons[triad], status);
        }
    }
    _createMembraneCard(container, triad, icon, status) {
        const card = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-membrane-card'));
        card.classList.add(status.healthy ? 'healthy' : 'unhealthy');
        (0, dom_1.append)(card, (0, dom_1.$)('.zonecog-membrane-icon')).textContent = icon;
        (0, dom_1.append)(card, (0, dom_1.$)('.zonecog-membrane-name')).textContent = triad;
        const statusEl = (0, dom_1.append)(card, (0, dom_1.$)('.zonecog-membrane-status'));
        statusEl.textContent = status.healthy ? (0, nls_1.localize)('zonecog.healthy', 'Healthy') : (0, nls_1.localize)('zonecog.unhealthy', 'Unhealthy');
        const countEl = (0, dom_1.append)(card, (0, dom_1.$)('.zonecog-membrane-count'));
        countEl.textContent = (0, nls_1.localize)('zonecog.processErrors', '{0} processes, {1} errors', status.activeProcesses, status.errorCount);
    }
    layoutBody(height, width) {
        super.layoutBody(height, width);
    }
};
exports.MembraneHealthView = MembraneHealthView;
exports.MembraneHealthView = MembraneHealthView = __decorate([
    __param(1, instantiation_1.IInstantiationService),
    __param(2, views_1.IViewDescriptorService),
    __param(3, configuration_1.IConfigurationService),
    __param(4, telemetry_1.ITelemetryService),
    __param(5, contextkey_1.IContextKeyService),
    __param(6, contextView_1.IContextMenuService),
    __param(7, keybinding_1.IKeybindingService),
    __param(8, opener_1.IOpenerService),
    __param(9, themeService_1.IThemeService),
    __param(10, zonecogService_2.ICognitiveMembraneService)
], MembraneHealthView);
