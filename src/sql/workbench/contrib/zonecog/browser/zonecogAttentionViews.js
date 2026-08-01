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
exports.WorkingMemoryView = exports.ECANAttentionView = void 0;
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
const ecanAttention_1 = require("sql/workbench/services/zonecog/common/ecanAttention");
const cognitiveWorkspace_1 = require("sql/workbench/services/zonecog/common/cognitiveWorkspace");
/**
 * ECAN Attention View - displays the ECAN attention values and spreading activation.
 */
let ECANAttentionView = class ECANAttentionView extends viewPane_1.ViewPane {
	ecanService;
	_container;
	_statsSection;
	_attentionBars;
	constructor(options, instantiationService, viewDescriptorService, configurationService, telemetryService, contextKeyService, contextMenuService, keybindingService, openerService, themeService, ecanService) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.ecanService = ecanService;
	}
	renderBody(container) {
		super.renderBody(container);
		this._container = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-view'));
		// Stats Section
		const statsSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
		(0, dom_1.append)(statsSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.ecanStats', 'ECAN Statistics');
		this._statsSection = (0, dom_1.append)(statsSection, (0, dom_1.$)('.zonecog-ecan-stats'));
		// Attention Bars Section
		const barsSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
		(0, dom_1.append)(barsSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.attentionDistribution', 'Attention Distribution');
		this._attentionBars = (0, dom_1.append)(barsSection, (0, dom_1.$)('.zonecog-attention-bars'));
		// Subscribe to ECAN changes
		this._register(this.ecanService.onDidChangeAttention(() => this._refreshECAN()));
		this._register(this.ecanService.onDidSpreadingActivation(() => this._refreshECAN()));
		// Initial render
		this._refreshECAN();
	}
	_refreshECAN() {
		this._refreshStats();
		this._refreshAttentionBars();
	}
	_refreshStats() {
		if (!this._statsSection) {
			return;
		}
		(0, dom_1.clearNode)(this._statsSection);
		const state = this.ecanService.getState();
		// Total nodes tracked
		const totalCard = (0, dom_1.append)(this._statsSection, (0, dom_1.$)('.zonecog-stat-card'));
		(0, dom_1.append)(totalCard, (0, dom_1.$)('.zonecog-stat-label')).textContent = (0, nls_1.localize)('zonecog.nodesTracked', 'Tracked Nodes');
		(0, dom_1.append)(totalCard, (0, dom_1.$)('.zonecog-stat-value')).textContent = String(state.totalNodes);
		// Important count
		const importantCard = (0, dom_1.append)(this._statsSection, (0, dom_1.$)('.zonecog-stat-card'));
		(0, dom_1.append)(importantCard, (0, dom_1.$)('.zonecog-stat-label')).textContent = (0, nls_1.localize)('zonecog.importantNodes', 'Important');
		const importantValue = (0, dom_1.append)(importantCard, (0, dom_1.$)('.zonecog-stat-value'));
		importantValue.textContent = String(state.importantCount);
		importantValue.classList.add('positive');
		// Total attention
		const attentionCard = (0, dom_1.append)(this._statsSection, (0, dom_1.$)('.zonecog-stat-card'));
		(0, dom_1.append)(attentionCard, (0, dom_1.$)('.zonecog-stat-label')).textContent = (0, nls_1.localize)('zonecog.totalAttention', 'Total Attention');
		(0, dom_1.append)(attentionCard, (0, dom_1.$)('.zonecog-stat-value')).textContent = state.totalAttention.toFixed(2);
		// Rent cycles
		const rentCard = (0, dom_1.append)(this._statsSection, (0, dom_1.$)('.zonecog-stat-card'));
		(0, dom_1.append)(rentCard, (0, dom_1.$)('.zonecog-stat-label')).textContent = (0, nls_1.localize)('zonecog.rentCycles', 'Rent Cycles');
		(0, dom_1.append)(rentCard, (0, dom_1.$)('.zonecog-stat-value')).textContent = String(state.rentCycles);
	}
	_refreshAttentionBars() {
		if (!this._attentionBars) {
			return;
		}
		(0, dom_1.clearNode)(this._attentionBars);
		// Get top nodes by attention
		const topNodes = this.ecanService.getTopByAttention(10);
		if (topNodes.length === 0) {
			const empty = (0, dom_1.append)(this._attentionBars, (0, dom_1.$)('.zonecog-empty-state'));
			empty.textContent = (0, nls_1.localize)('zonecog.noAttentionNodes', 'No nodes with attention values');
			return;
		}
		// Find max attention for scaling
		const maxAttention = Math.max(...topNodes.map(n => n.attentionValue), 1);
		for (const node of topNodes) {
			const barContainer = (0, dom_1.append)(this._attentionBars, (0, dom_1.$)('.zonecog-attention-bar'));
			// Label
			const label = (0, dom_1.append)(barContainer, (0, dom_1.$)('.zonecog-attention-label'));
			const nodeId = node.nodeId.length > 20 ? node.nodeId.substring(0, 17) + '...' : node.nodeId;
			label.textContent = nodeId;
			label.title = node.nodeId;
			// Bar
			const bar = (0, dom_1.append)(barContainer, (0, dom_1.$)('.zonecog-attention-fill'));
			const width = Math.round((node.attentionValue / maxAttention) * 100);
			bar.style.width = `${width}%`;
			// STI indicator
			if (node.attentionValue >= this.ecanService.getState().importantThreshold) {
				bar.classList.add('important');
			}
			// Value
			const value = (0, dom_1.append)(barContainer, (0, dom_1.$)('.zonecog-attention-value'));
			value.textContent = node.attentionValue.toFixed(2);
		}
	}
	layoutBody(height, width) {
		super.layoutBody(height, width);
	}
};
exports.ECANAttentionView = ECANAttentionView;
exports.ECANAttentionView = ECANAttentionView = __decorate([
	__param(1, instantiation_1.IInstantiationService),
	__param(2, views_1.IViewDescriptorService),
	__param(3, configuration_1.IConfigurationService),
	__param(4, telemetry_1.ITelemetryService),
	__param(5, contextkey_1.IContextKeyService),
	__param(6, contextView_1.IContextMenuService),
	__param(7, keybinding_1.IKeybindingService),
	__param(8, opener_1.IOpenerService),
	__param(9, themeService_1.IThemeService),
	__param(10, ecanAttention_1.IECANAttentionService)
], ECANAttentionView);
/**
 * Working Memory View - displays items in working memory.
 */
let WorkingMemoryView = class WorkingMemoryView extends viewPane_1.ViewPane {
	workspaceService;
	_container;
	_memoryList;
	constructor(options, instantiationService, viewDescriptorService, configurationService, telemetryService, contextKeyService, contextMenuService, keybindingService, openerService, themeService, workspaceService) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.workspaceService = workspaceService;
	}
	renderBody(container) {
		super.renderBody(container);
		this._container = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-view'));
		// Working Memory Section
		const section = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
		(0, dom_1.append)(section, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.workingMemory', 'Working Memory');
		this._memoryList = (0, dom_1.append)(section, (0, dom_1.$)('.zonecog-working-memory'));
		// Subscribe to workspace changes
		this._register(this.workspaceService.onDidChangeWorkspace(() => this._refreshWorkingMemory()));
		// Initial render
		this._refreshWorkingMemory();
	}
	_refreshWorkingMemory() {
		if (!this._memoryList) {
			return;
		}
		(0, dom_1.clearNode)(this._memoryList);
		const items = this.workspaceService.getWorkingMemory();
		if (items.length === 0) {
			const empty = (0, dom_1.append)(this._memoryList, (0, dom_1.$)('.zonecog-empty-state'));
			empty.textContent = (0, nls_1.localize)('zonecog.emptyWorkingMemory', 'Working memory is empty');
			return;
		}
		for (const item of items) {
			this._createMemoryItem(this._memoryList, item);
		}
	}
	_createMemoryItem(container, item) {
		const itemEl = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-memory-item'));
		// Type icon
		const typeIcon = (0, dom_1.append)(itemEl, (0, dom_1.$)('.zonecog-memory-icon'));
		typeIcon.textContent = this._getTypeIcon(item.type);
		// Content
		const content = (0, dom_1.append)(itemEl, (0, dom_1.$)('.zonecog-memory-content'));
		const label = (0, dom_1.append)(content, (0, dom_1.$)('.zonecog-memory-label'));
		const displayContent = item.content.length > 50 ? item.content.substring(0, 47) + '...' : item.content;
		label.textContent = displayContent;
		label.title = item.content;
		const meta = (0, dom_1.append)(content, (0, dom_1.$)('.zonecog-memory-meta'));
		const ageMs = Date.now() - item.timestamp;
		const ageSec = Math.round(ageMs / 1000);
		meta.textContent = (0, nls_1.localize)('zonecog.memoryMeta', '{0} • {1}s ago', item.type, ageSec);
		// Activation
		const activation = (0, dom_1.append)(itemEl, (0, dom_1.$)('.zonecog-memory-activation'));
		const activationPercent = Math.round(item.activation * 100);
		activation.textContent = `${activationPercent}%`;
		// Color based on activation
		if (item.activation > 0.7) {
			itemEl.classList.add('high-activation');
		}
		else if (item.activation < 0.3) {
			itemEl.classList.add('low-activation');
		}
	}
	_getTypeIcon(type) {
		switch (type) {
			// allow-any-unicode-next-line
			case 'percept': return '👁️';
			// allow-any-unicode-next-line
			case 'thought': return '💭';
			case 'goal': return '🎯';
			// allow-any-unicode-next-line
			case 'action': return '⚡';
			// allow-any-unicode-next-line
			case 'query': return '🔍';
			// allow-any-unicode-next-line
			case 'result': return '📊';
			// allow-any-unicode-next-line
			default: return '📝';
		}
	}
	layoutBody(height, width) {
		super.layoutBody(height, width);
	}
};
exports.WorkingMemoryView = WorkingMemoryView;
exports.WorkingMemoryView = WorkingMemoryView = __decorate([
	__param(1, instantiation_1.IInstantiationService),
	__param(2, views_1.IViewDescriptorService),
	__param(3, configuration_1.IConfigurationService),
	__param(4, telemetry_1.ITelemetryService),
	__param(5, contextkey_1.IContextKeyService),
	__param(6, contextView_1.IContextMenuService),
	__param(7, keybinding_1.IKeybindingService),
	__param(8, opener_1.IOpenerService),
	__param(9, themeService_1.IThemeService),
	__param(10, cognitiveWorkspace_1.ICognitiveWorkspaceService)
], WorkingMemoryView);
