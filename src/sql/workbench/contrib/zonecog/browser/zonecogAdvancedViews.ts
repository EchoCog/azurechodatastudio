/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/zonecogDashboard';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { $, append, clearNode } from 'vs/base/browser/dom';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';

import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { IAAROrchestrationService } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { ICognitiveWorkflowAutomationService, RegisteredWorkflow } from 'sql/workbench/services/zonecog/common/cognitiveWorkflowAutomation';

/**
 * DTESN Neural Network View - displays the Deep Tree Echo State Network status.
 */
export class DTESNNetworkView extends ViewPane {
	private _container?: HTMLElement;
	private _networkSection?: HTMLElement;
	private _layerVisualization?: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IDTESNService private readonly dtesnService: IDTESNService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		// Network Stats Section
		const statsSection = append(this._container, $('.zonecog-section'));
		append(statsSection, $('.zonecog-section-header')).textContent = localize('zonecog.dtesnNetwork', 'DTESN Network');
		this._networkSection = append(statsSection, $('.zonecog-dtesn-stats'));

		// Layer Visualization Section
		const layerSection = append(this._container, $('.zonecog-section'));
		append(layerSection, $('.zonecog-section-header')).textContent = localize('zonecog.dtesnLayers', 'Network Layers');
		this._layerVisualization = append(layerSection, $('.zonecog-dtesn-layers'));

		// Subscribe to DTESN changes
		this._register(this.dtesnService.onDidTick(() => this._refresh()));

		// Initial render
		this._refresh();
	}

	private _refresh(): void {
		this._refreshNetworkStats();
		this._refreshLayerVisualization();
	}

	private _refreshNetworkStats(): void {
		if (!this._networkSection) {
			return;
		}

		clearNode(this._networkSection);

		const state = this.dtesnService.getState();
		const config = this.dtesnService.getConfig();

		// Grid of stats
		const statsGrid = append(this._networkSection, $('.zonecog-cognitive-state'));

		// Depth
		this._createStatCard(statsGrid, localize('zonecog.dtesnDepth', 'Depth'),
			`${config.treeDepth} layers`);

		// Total Ticks
		this._createStatCard(statsGrid, localize('zonecog.dtesnTicks', 'Ticks'),
			String(state.totalTicks));

		// Input/Output
		this._createStatCard(statsGrid, localize('zonecog.dtesnIO', 'I/O'),
			`${config.inputDim}→${config.outputDim}`);

		// Training Buffer
		this._createStatCard(statsGrid, localize('zonecog.dtesnBuffer', 'Buffer'),
			`${this.dtesnService.getTrainingBufferSize()} samples`);
	}

	private _refreshLayerVisualization(): void {
		if (!this._layerVisualization) {
			return;
		}

		clearNode(this._layerVisualization);

		const config = this.dtesnService.getConfig();

		for (let i = 0; i < config.treeDepth; i++) {
			const layerConfig = config.layers[i];
			const spectralRadius = this.dtesnService.getLayerSpectralRadius(i);

			const layerEl = append(this._layerVisualization, $('.zonecog-dtesn-layer'));

			// Layer header
			const header = append(layerEl, $('.zonecog-dtesn-layer-header'));
			header.textContent = `Layer ${i}`;

			// Layer details
			const details = append(layerEl, $('.zonecog-dtesn-layer-details'));
			// allow-any-unicode-next-line
			details.textContent = `${layerConfig.reservoirSize} units, ρ=${spectralRadius.toFixed(3)}`;

			// Visual indicator bar
			const bar = append(layerEl, $('.zonecog-dtesn-layer-bar'));
			const fill = append(bar, $('.zonecog-dtesn-layer-fill'));
			// Use spectral radius as indicator (clamped to max 1.5)
			const width = Math.min(spectralRadius / 1.5, 1) * 100;
			fill.style.width = `${width}%`;

			// Color based on spectral radius
			if (spectralRadius > 1.0) {
				fill.classList.add('chaotic');
			} else if (spectralRadius < 0.5) {
				fill.classList.add('stable');
			}
		}
	}

	private _createStatCard(container: HTMLElement, label: string, value: string, className?: string): void {
		const card = append(container, $('.zonecog-stat-card'));
		append(card, $('.zonecog-stat-label')).textContent = label;
		const valueEl = append(card, $('.zonecog-stat-value'));
		valueEl.textContent = value;
		if (className) {
			valueEl.classList.add(className);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

/**
 * AAR Orchestration View - displays the Agent-Arena-Relation network status.
 */
export class AAROrchestrationView extends ViewPane {
	private _container?: HTMLElement;
	private _arenaSection?: HTMLElement;
	private _agentList?: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IAAROrchestrationService private readonly aarService: IAAROrchestrationService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		// Arena Stats Section
		const arenaStatsSection = append(this._container, $('.zonecog-section'));
		append(arenaStatsSection, $('.zonecog-section-header')).textContent = localize('zonecog.aarArena', 'AAR Arena');
		this._arenaSection = append(arenaStatsSection, $('.zonecog-aar-stats'));

		// Agent List Section
		const agentListSection = append(this._container, $('.zonecog-section'));
		append(agentListSection, $('.zonecog-section-header')).textContent = localize('zonecog.aarAgents', 'Registered Agents');
		this._agentList = append(agentListSection, $('.zonecog-aar-agents'));

		// Subscribe to AAR changes
		this._register(this.aarService.onDidCompleteTask(() => this._refresh()));

		// Initial render
		this._refresh();
	}

	private _refresh(): void {
		this._refreshArenaStats();
		this._refreshAgentList();
	}

	private _refreshArenaStats(): void {
		if (!this._arenaSection) {
			return;
		}

		clearNode(this._arenaSection);

		const arenaState = this.aarService.getArenaState();

		// Stats grid
		const statsGrid = append(this._arenaSection, $('.zonecog-cognitive-state'));

		this._createStatCard(statsGrid, localize('zonecog.aarAgentCount', 'Agents'),
			String(arenaState.agentCount));

		this._createStatCard(statsGrid, localize('zonecog.aarRelations', 'Relations'),
			String(arenaState.relationCount));

		this._createStatCard(statsGrid, localize('zonecog.aarTasks', 'Tasks'),
			String(arenaState.totalTasksOrchestrated));

		const successRate = arenaState.totalTasksOrchestrated > 0
			? Math.round((arenaState.successfulTasks / arenaState.totalTasksOrchestrated) * 100)
			: 0;
		this._createStatCard(statsGrid, localize('zonecog.aarSuccess', 'Success'),
			`${successRate}%`, successRate >= 80 ? 'positive' : successRate >= 50 ? '' : 'negative');
	}

	private _refreshAgentList(): void {
		if (!this._agentList) {
			return;
		}

		clearNode(this._agentList);

		const agents = this.aarService.getAllAgents();

		if (agents.length === 0) {
			const empty = append(this._agentList, $('.zonecog-empty-state'));
			empty.textContent = localize('zonecog.noAgents', 'No agents registered');
			return;
		}

		for (const agent of agents) {
			const agentEl = append(this._agentList, $('.zonecog-aar-agent'));
			agentEl.classList.add(agent.active ? 'active' : 'inactive');

			// Agent icon based on role
			const icon = append(agentEl, $('.zonecog-aar-agent-icon'));
			icon.textContent = this._getRoleIcon(agent.role);

			// Agent info
			const info = append(agentEl, $('.zonecog-aar-agent-info'));

			const name = append(info, $('.zonecog-aar-agent-name'));
			name.textContent = agent.name;

			const details = append(info, $('.zonecog-aar-agent-details'));
			details.textContent = `${agent.role} • ${agent.totalTasksProcessed} tasks`;

			// Status indicator
			const status = append(agentEl, $('.zonecog-aar-agent-status'));
			// allow-any-unicode-next-line
			status.textContent = agent.active ? '●' : '○';
		}
	}

	private _getRoleIcon(role: string): string {
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

	private _createStatCard(container: HTMLElement, label: string, value: string, className?: string): void {
		const card = append(container, $('.zonecog-stat-card'));
		append(card, $('.zonecog-stat-label')).textContent = label;
		const valueEl = append(card, $('.zonecog-stat-value'));
		valueEl.textContent = value;
		if (className) {
			valueEl.classList.add(className);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

/**
 * Cognitive Workflows View - displays registered workflows and recent executions.
 */
export class CognitiveWorkflowsView extends ViewPane {
	private _container?: HTMLElement;
	private _workflowList?: HTMLElement;
	private _historySection?: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ICognitiveWorkflowAutomationService private readonly workflowService: ICognitiveWorkflowAutomationService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		// Workflows Section
		const workflowsSection = append(this._container, $('.zonecog-section'));
		append(workflowsSection, $('.zonecog-section-header')).textContent = localize('zonecog.workflows', 'Workflows');
		this._workflowList = append(workflowsSection, $('.zonecog-workflow-list'));

		// History Section
		const historySection = append(this._container, $('.zonecog-section'));
		append(historySection, $('.zonecog-section-header')).textContent = localize('zonecog.recentExecutions', 'Recent Executions');
		this._historySection = append(historySection, $('.zonecog-workflow-history'));

		// Subscribe to workflow changes
		this._register(this.workflowService.onDidCompleteExecution(() => this._refresh()));
		this._register(this.workflowService.onDidStartExecution(() => this._refresh()));

		// Initial render
		this._refresh();
	}

	private _refresh(): void {
		this._refreshWorkflowList();
		this._refreshHistory();
	}

	private _refreshWorkflowList(): void {
		if (!this._workflowList) {
			return;
		}

		clearNode(this._workflowList);

		const workflows = this.workflowService.getWorkflows();

		if (workflows.length === 0) {
			const empty = append(this._workflowList, $('.zonecog-empty-state'));
			empty.textContent = localize('zonecog.noWorkflowsView', 'No workflows registered');
			return;
		}

		for (const workflow of workflows) {
			this._createWorkflowItem(this._workflowList, workflow);
		}
	}

	private _createWorkflowItem(container: HTMLElement, workflow: RegisteredWorkflow): void {
		const item = append(container, $('.zonecog-workflow-item'));
		item.classList.add(workflow.enabled ? 'enabled' : 'disabled');

		// Status indicator
		const status = append(item, $('.zonecog-workflow-status'));
		// allow-any-unicode-next-line
		status.textContent = workflow.enabled ? '●' : '○';
		status.title = workflow.enabled ? 'Enabled' : 'Disabled';

		// Workflow info
		const info = append(item, $('.zonecog-workflow-info'));

		const name = append(info, $('.zonecog-workflow-name'));
		name.textContent = workflow.definition.name;

		const desc = append(info, $('.zonecog-workflow-desc'));
		desc.textContent = workflow.definition.description;

		// Stats
		const stats = append(item, $('.zonecog-workflow-stats'));
		const successRate = workflow.executionCount > 0
			? Math.round((workflow.successCount / workflow.executionCount) * 100)
			: 0;
		stats.textContent = `${workflow.executionCount} runs, ${successRate}% success`;
	}

	private _refreshHistory(): void {
		if (!this._historySection) {
			return;
		}

		clearNode(this._historySection);

		const history = this.workflowService.getExecutionHistory(undefined, 5);
		const active = this.workflowService.getActiveExecutions();

		if (history.length === 0 && active.length === 0) {
			const empty = append(this._historySection, $('.zonecog-empty-state'));
			empty.textContent = localize('zonecog.noExecutions', 'No executions yet');
			return;
		}

		// Show active executions first
		for (const exec of active) {
			const item = append(this._historySection, $('.zonecog-execution-item'));
			item.classList.add('running');

			const statusIcon = append(item, $('.zonecog-execution-status'));
			// allow-any-unicode-next-line
			statusIcon.textContent = '◐';
			statusIcon.title = 'Running';

			const info = append(item, $('.zonecog-execution-info'));
			const name = append(info, $('.zonecog-execution-name'));
			name.textContent = exec.workflowId;

			const details = append(info, $('.zonecog-execution-details'));
			details.textContent = `Running... Step: ${exec.currentStep || 'starting'}`;
		}

		// Show history
		for (const exec of history) {
			const item = append(this._historySection, $('.zonecog-execution-item'));
			item.classList.add(exec.status);

			const statusIcon = append(item, $('.zonecog-execution-status'));
			// allow-any-unicode-next-line
			statusIcon.textContent = exec.status === 'completed' ? '✓' : exec.status === 'failed' ? '✗' : '○';

			const info = append(item, $('.zonecog-execution-info'));
			const name = append(info, $('.zonecog-execution-name'));
			name.textContent = exec.workflowId;

			const details = append(info, $('.zonecog-execution-details'));
			const duration = exec.endTime ? exec.endTime - exec.startTime : 0;
			details.textContent = `${exec.status} • ${duration}ms • ${new Date(exec.startTime).toLocaleTimeString()}`;
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
