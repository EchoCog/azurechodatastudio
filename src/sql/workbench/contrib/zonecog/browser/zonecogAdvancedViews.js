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
exports.CognitiveWorkflowsView = exports.AAROrchestrationView = exports.DTESNNetworkView = void 0;
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
const dtesn_1 = require("sql/workbench/services/zonecog/common/dtesn");
const aarOrchestration_1 = require("sql/workbench/services/zonecog/common/aarOrchestration");
const cognitiveWorkflowAutomation_1 = require("sql/workbench/services/zonecog/common/cognitiveWorkflowAutomation");
/**
 * DTESN Neural Network View - displays the Deep Tree Echo State Network status.
 */
let DTESNNetworkView = class DTESNNetworkView extends viewPane_1.ViewPane {
    dtesnService;
    _container;
    _networkSection;
    _layerVisualization;
    constructor(options, instantiationService, viewDescriptorService, configurationService, telemetryService, contextKeyService, contextMenuService, keybindingService, openerService, themeService, dtesnService) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
        this.dtesnService = dtesnService;
    }
    renderBody(container) {
        super.renderBody(container);
        this._container = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-view'));
        // Network Stats Section
        const statsSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(statsSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.dtesnNetwork', 'DTESN Network');
        this._networkSection = (0, dom_1.append)(statsSection, (0, dom_1.$)('.zonecog-dtesn-stats'));
        // Layer Visualization Section
        const layerSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(layerSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.dtesnLayers', 'Network Layers');
        this._layerVisualization = (0, dom_1.append)(layerSection, (0, dom_1.$)('.zonecog-dtesn-layers'));
        // Subscribe to DTESN changes
        this._register(this.dtesnService.onDidTick(() => this._refresh()));
        // Initial render
        this._refresh();
    }
    _refresh() {
        this._refreshNetworkStats();
        this._refreshLayerVisualization();
    }
    _refreshNetworkStats() {
        if (!this._networkSection) {
            return;
        }
        (0, dom_1.clearNode)(this._networkSection);
        const state = this.dtesnService.getState();
        const config = this.dtesnService.getConfig();
        // Grid of stats
        const statsGrid = (0, dom_1.append)(this._networkSection, (0, dom_1.$)('.zonecog-cognitive-state'));
        // Depth
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.dtesnDepth', 'Depth'), `${config.treeDepth} layers`);
        // Total Ticks
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.dtesnTicks', 'Ticks'), String(state.totalTicks));
        // Input/Output
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.dtesnIO', 'I/O'), `${config.inputDim}→${config.outputDim}`);
        // Training Buffer
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.dtesnBuffer', 'Buffer'), `${this.dtesnService.getTrainingBufferSize()} samples`);
    }
    _refreshLayerVisualization() {
        if (!this._layerVisualization) {
            return;
        }
        (0, dom_1.clearNode)(this._layerVisualization);
        const config = this.dtesnService.getConfig();
        for (let i = 0; i < config.treeDepth; i++) {
            const layerConfig = config.layers[i];
            const spectralRadius = this.dtesnService.getLayerSpectralRadius(i);
            const layerEl = (0, dom_1.append)(this._layerVisualization, (0, dom_1.$)('.zonecog-dtesn-layer'));
            // Layer header
            const header = (0, dom_1.append)(layerEl, (0, dom_1.$)('.zonecog-dtesn-layer-header'));
            header.textContent = `Layer ${i}`;
            // Layer details
            const details = (0, dom_1.append)(layerEl, (0, dom_1.$)('.zonecog-dtesn-layer-details'));
            // allow-any-unicode-next-line
            details.textContent = `${layerConfig.reservoirSize} units, ρ=${spectralRadius.toFixed(3)}`;
            // Visual indicator bar
            const bar = (0, dom_1.append)(layerEl, (0, dom_1.$)('.zonecog-dtesn-layer-bar'));
            const fill = (0, dom_1.append)(bar, (0, dom_1.$)('.zonecog-dtesn-layer-fill'));
            // Use spectral radius as indicator (clamped to max 1.5)
            const width = Math.min(spectralRadius / 1.5, 1) * 100;
            fill.style.width = `${width}%`;
            // Color based on spectral radius
            if (spectralRadius > 1.0) {
                fill.classList.add('chaotic');
            }
            else if (spectralRadius < 0.5) {
                fill.classList.add('stable');
            }
        }
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
exports.DTESNNetworkView = DTESNNetworkView;
exports.DTESNNetworkView = DTESNNetworkView = __decorate([
    __param(1, instantiation_1.IInstantiationService),
    __param(2, views_1.IViewDescriptorService),
    __param(3, configuration_1.IConfigurationService),
    __param(4, telemetry_1.ITelemetryService),
    __param(5, contextkey_1.IContextKeyService),
    __param(6, contextView_1.IContextMenuService),
    __param(7, keybinding_1.IKeybindingService),
    __param(8, opener_1.IOpenerService),
    __param(9, themeService_1.IThemeService),
    __param(10, dtesn_1.IDTESNService)
], DTESNNetworkView);
/**
 * AAR Orchestration View - displays the Agent-Arena-Relation network status.
 */
let AAROrchestrationView = class AAROrchestrationView extends viewPane_1.ViewPane {
    aarService;
    _container;
    _arenaSection;
    _agentList;
    constructor(options, instantiationService, viewDescriptorService, configurationService, telemetryService, contextKeyService, contextMenuService, keybindingService, openerService, themeService, aarService) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
        this.aarService = aarService;
    }
    renderBody(container) {
        super.renderBody(container);
        this._container = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-view'));
        // Arena Stats Section
        const arenaStatsSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(arenaStatsSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.aarArena', 'AAR Arena');
        this._arenaSection = (0, dom_1.append)(arenaStatsSection, (0, dom_1.$)('.zonecog-aar-stats'));
        // Agent List Section
        const agentListSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(agentListSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.aarAgents', 'Registered Agents');
        this._agentList = (0, dom_1.append)(agentListSection, (0, dom_1.$)('.zonecog-aar-agents'));
        // Subscribe to AAR changes
        this._register(this.aarService.onDidCompleteTask(() => this._refresh()));
        // Initial render
        this._refresh();
    }
    _refresh() {
        this._refreshArenaStats();
        this._refreshAgentList();
    }
    _refreshArenaStats() {
        if (!this._arenaSection) {
            return;
        }
        (0, dom_1.clearNode)(this._arenaSection);
        const arenaState = this.aarService.getArenaState();
        // Stats grid
        const statsGrid = (0, dom_1.append)(this._arenaSection, (0, dom_1.$)('.zonecog-cognitive-state'));
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.aarAgentCount', 'Agents'), String(arenaState.agentCount));
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.aarRelations', 'Relations'), String(arenaState.relationCount));
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.aarTasks', 'Tasks'), String(arenaState.totalTasksOrchestrated));
        const successRate = arenaState.totalTasksOrchestrated > 0
            ? Math.round((arenaState.successfulTasks / arenaState.totalTasksOrchestrated) * 100)
            : 0;
        this._createStatCard(statsGrid, (0, nls_1.localize)('zonecog.aarSuccess', 'Success'), `${successRate}%`, successRate >= 80 ? 'positive' : successRate >= 50 ? '' : 'negative');
    }
    _refreshAgentList() {
        if (!this._agentList) {
            return;
        }
        (0, dom_1.clearNode)(this._agentList);
        const agents = this.aarService.getAllAgents();
        if (agents.length === 0) {
            const empty = (0, dom_1.append)(this._agentList, (0, dom_1.$)('.zonecog-empty-state'));
            empty.textContent = (0, nls_1.localize)('zonecog.noAgents', 'No agents registered');
            return;
        }
        for (const agent of agents) {
            const agentEl = (0, dom_1.append)(this._agentList, (0, dom_1.$)('.zonecog-aar-agent'));
            agentEl.classList.add(agent.active ? 'active' : 'inactive');
            // Agent icon based on role
            const icon = (0, dom_1.append)(agentEl, (0, dom_1.$)('.zonecog-aar-agent-icon'));
            icon.textContent = this._getRoleIcon(agent.role);
            // Agent info
            const info = (0, dom_1.append)(agentEl, (0, dom_1.$)('.zonecog-aar-agent-info'));
            const name = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-aar-agent-name'));
            name.textContent = agent.name;
            const details = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-aar-agent-details'));
            details.textContent = `${agent.role} • ${agent.totalTasksProcessed} tasks`;
            // Status indicator
            const status = (0, dom_1.append)(agentEl, (0, dom_1.$)('.zonecog-aar-agent-status'));
            // allow-any-unicode-next-line
            status.textContent = agent.active ? '●' : '○';
        }
    }
    _getRoleIcon(role) {
        switch (role) {
            // allow-any-unicode-next-line
            case 'analyzer': return '🔍';
            // allow-any-unicode-next-line
            case 'reasoner': return '🧠';
            // allow-any-unicode-next-line
            case 'advisor': return '💡';
            // allow-any-unicode-next-line
            case 'pattern': return '📊';
            case 'orchestrator': return '🎯';
            // allow-any-unicode-next-line
            default: return '🤖';
        }
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
exports.AAROrchestrationView = AAROrchestrationView;
exports.AAROrchestrationView = AAROrchestrationView = __decorate([
    __param(1, instantiation_1.IInstantiationService),
    __param(2, views_1.IViewDescriptorService),
    __param(3, configuration_1.IConfigurationService),
    __param(4, telemetry_1.ITelemetryService),
    __param(5, contextkey_1.IContextKeyService),
    __param(6, contextView_1.IContextMenuService),
    __param(7, keybinding_1.IKeybindingService),
    __param(8, opener_1.IOpenerService),
    __param(9, themeService_1.IThemeService),
    __param(10, aarOrchestration_1.IAAROrchestrationService)
], AAROrchestrationView);
/**
 * Cognitive Workflows View - displays registered workflows and recent executions.
 */
let CognitiveWorkflowsView = class CognitiveWorkflowsView extends viewPane_1.ViewPane {
    workflowService;
    _container;
    _workflowList;
    _historySection;
    constructor(options, instantiationService, viewDescriptorService, configurationService, telemetryService, contextKeyService, contextMenuService, keybindingService, openerService, themeService, workflowService) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
        this.workflowService = workflowService;
    }
    renderBody(container) {
        super.renderBody(container);
        this._container = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-view'));
        // Workflows Section
        const workflowsSection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(workflowsSection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.workflows', 'Workflows');
        this._workflowList = (0, dom_1.append)(workflowsSection, (0, dom_1.$)('.zonecog-workflow-list'));
        // History Section
        const historySection = (0, dom_1.append)(this._container, (0, dom_1.$)('.zonecog-section'));
        (0, dom_1.append)(historySection, (0, dom_1.$)('.zonecog-section-header')).textContent = (0, nls_1.localize)('zonecog.recentExecutions', 'Recent Executions');
        this._historySection = (0, dom_1.append)(historySection, (0, dom_1.$)('.zonecog-workflow-history'));
        // Subscribe to workflow changes
        this._register(this.workflowService.onDidCompleteExecution(() => this._refresh()));
        this._register(this.workflowService.onDidStartExecution(() => this._refresh()));
        // Initial render
        this._refresh();
    }
    _refresh() {
        this._refreshWorkflowList();
        this._refreshHistory();
    }
    _refreshWorkflowList() {
        if (!this._workflowList) {
            return;
        }
        (0, dom_1.clearNode)(this._workflowList);
        const workflows = this.workflowService.getWorkflows();
        if (workflows.length === 0) {
            const empty = (0, dom_1.append)(this._workflowList, (0, dom_1.$)('.zonecog-empty-state'));
            empty.textContent = (0, nls_1.localize)('zonecog.noWorkflowsView', 'No workflows registered');
            return;
        }
        for (const workflow of workflows) {
            this._createWorkflowItem(this._workflowList, workflow);
        }
    }
    _createWorkflowItem(container, workflow) {
        const item = (0, dom_1.append)(container, (0, dom_1.$)('.zonecog-workflow-item'));
        item.classList.add(workflow.enabled ? 'enabled' : 'disabled');
        // Status indicator
        const status = (0, dom_1.append)(item, (0, dom_1.$)('.zonecog-workflow-status'));
        // allow-any-unicode-next-line
        status.textContent = workflow.enabled ? '●' : '○';
        status.title = workflow.enabled ? 'Enabled' : 'Disabled';
        // Workflow info
        const info = (0, dom_1.append)(item, (0, dom_1.$)('.zonecog-workflow-info'));
        const name = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-workflow-name'));
        name.textContent = workflow.definition.name;
        const desc = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-workflow-desc'));
        desc.textContent = workflow.definition.description;
        // Stats
        const stats = (0, dom_1.append)(item, (0, dom_1.$)('.zonecog-workflow-stats'));
        const successRate = workflow.executionCount > 0
            ? Math.round((workflow.successCount / workflow.executionCount) * 100)
            : 0;
        stats.textContent = `${workflow.executionCount} runs, ${successRate}% success`;
    }
    _refreshHistory() {
        if (!this._historySection) {
            return;
        }
        (0, dom_1.clearNode)(this._historySection);
        const history = this.workflowService.getExecutionHistory(undefined, 5);
        const active = this.workflowService.getActiveExecutions();
        if (history.length === 0 && active.length === 0) {
            const empty = (0, dom_1.append)(this._historySection, (0, dom_1.$)('.zonecog-empty-state'));
            empty.textContent = (0, nls_1.localize)('zonecog.noExecutions', 'No executions yet');
            return;
        }
        // Show active executions first
        for (const exec of active) {
            const item = (0, dom_1.append)(this._historySection, (0, dom_1.$)('.zonecog-execution-item'));
            item.classList.add('running');
            const statusIcon = (0, dom_1.append)(item, (0, dom_1.$)('.zonecog-execution-status'));
            // allow-any-unicode-next-line
            statusIcon.textContent = '◐';
            statusIcon.title = 'Running';
            const info = (0, dom_1.append)(item, (0, dom_1.$)('.zonecog-execution-info'));
            const name = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-execution-name'));
            name.textContent = exec.workflowId;
            const details = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-execution-details'));
            details.textContent = `Running... Step: ${exec.currentStep || 'starting'}`;
        }
        // Show history
        for (const exec of history) {
            const item = (0, dom_1.append)(this._historySection, (0, dom_1.$)('.zonecog-execution-item'));
            item.classList.add(exec.status);
            const statusIcon = (0, dom_1.append)(item, (0, dom_1.$)('.zonecog-execution-status'));
            // allow-any-unicode-next-line
            statusIcon.textContent = exec.status === 'completed' ? '✓' : exec.status === 'failed' ? '✗' : '○';
            const info = (0, dom_1.append)(item, (0, dom_1.$)('.zonecog-execution-info'));
            const name = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-execution-name'));
            name.textContent = exec.workflowId;
            const details = (0, dom_1.append)(info, (0, dom_1.$)('.zonecog-execution-details'));
            const duration = exec.endTime ? exec.endTime - exec.startTime : 0;
            details.textContent = `${exec.status} • ${duration}ms • ${new Date(exec.startTime).toLocaleTimeString()}`;
        }
    }
    layoutBody(height, width) {
        super.layoutBody(height, width);
    }
};
exports.CognitiveWorkflowsView = CognitiveWorkflowsView;
exports.CognitiveWorkflowsView = CognitiveWorkflowsView = __decorate([
    __param(1, instantiation_1.IInstantiationService),
    __param(2, views_1.IViewDescriptorService),
    __param(3, configuration_1.IConfigurationService),
    __param(4, telemetry_1.ITelemetryService),
    __param(5, contextkey_1.IContextKeyService),
    __param(6, contextView_1.IContextMenuService),
    __param(7, keybinding_1.IKeybindingService),
    __param(8, opener_1.IOpenerService),
    __param(9, themeService_1.IThemeService),
    __param(10, cognitiveWorkflowAutomation_1.ICognitiveWorkflowAutomationService)
], CognitiveWorkflowsView);
