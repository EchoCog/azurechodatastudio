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

import { IAgiStudioService, StudioRun, StudioAgent, AgentMessage } from 'sql/workbench/services/zonecog/common/agiStudio';

/**
 * AGI Studio View - displays the current run status, agent hierarchy, and
 * recent inter-agent messages in the Zone-Cog panel.
 *
 * Refreshes reactively on `onDidChangeRun`, `onDidSpawnAgent`, and
 * `onDidSendMessage` events.
 */
export class AgiStudioView extends ViewPane {

	private _container?: HTMLElement;
	private _runStatusSection?: HTMLElement;
	private _agentTreeSection?: HTMLElement;
	private _messageLogSection?: HTMLElement;

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
		@IAgiStudioService private readonly agiStudioService: IAgiStudioService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		// Run status section
		const runStatusWrapper = append(this._container, $('.zonecog-section'));
		append(runStatusWrapper, $('.zonecog-section-header')).textContent =
			localize('zonecog.agiStudio.runStatus', 'AGI Studio Run Status');
		this._runStatusSection = append(runStatusWrapper, $('.zonecog-agi-run-status'));

		// Agent hierarchy section
		const agentTreeWrapper = append(this._container, $('.zonecog-section'));
		append(agentTreeWrapper, $('.zonecog-section-header')).textContent =
			localize('zonecog.agiStudio.agentTree', 'Agent Hierarchy');
		this._agentTreeSection = append(agentTreeWrapper, $('.zonecog-agi-agent-tree'));

		// Recent messages section
		const messageWrapper = append(this._container, $('.zonecog-section'));
		append(messageWrapper, $('.zonecog-section-header')).textContent =
			localize('zonecog.agiStudio.messageLog', 'Recent Messages');
		this._messageLogSection = append(messageWrapper, $('.zonecog-agi-message-log'));

		// Subscribe to service events for reactive updates
		this._register(this.agiStudioService.onDidChangeRun(() => this._refresh()));
		this._register(this.agiStudioService.onDidSpawnAgent(() => this._refreshAgentTree()));
		this._register(this.agiStudioService.onDidSendMessage(() => this._refreshMessageLog()));

		// Initial render
		this._refresh();
	}

	private _refresh(): void {
		this._refreshRunStatus();
		this._refreshAgentTree();
		this._refreshMessageLog();
	}

	private _refreshRunStatus(): void {
		if (!this._runStatusSection) {
			return;
		}

		clearNode(this._runStatusSection);

		const activeRun = this.agiStudioService.getActiveRun();
		const allRuns = this.agiStudioService.getRuns();

		const statsGrid = append(this._runStatusSection, $('.zonecog-cognitive-state'));

		// Current status
		this._createStatCard(
			statsGrid,
			localize('zonecog.agiStudio.status', 'Status'),
			activeRun
				? localize('zonecog.agiStudio.statusRunning', 'Running')
				: localize('zonecog.agiStudio.statusIdle', 'Idle'),
		);

		// Total runs
		this._createStatCard(
			statsGrid,
			localize('zonecog.agiStudio.totalRuns', 'Total Runs'),
			String(allRuns.length),
		);

		if (activeRun) {
			// Current goal (truncated)
			const goalEl = append(this._runStatusSection, $('.zonecog-agi-goal'));
			goalEl.textContent = localize(
				'zonecog.agiStudio.currentGoal',
				'Goal: {0}',
				activeRun.goal.length > 80
					? activeRun.goal.slice(0, 80) + '…'
					: activeRun.goal,
			);
		} else if (allRuns.length > 0) {
			// Show last completed run summary
			const lastRun = allRuns[0];
			const lastEl = append(this._runStatusSection, $('.zonecog-agi-goal'));

			const statusLabel = this._runStatusLabel(lastRun);
			lastEl.textContent = localize(
				'zonecog.agiStudio.lastRun',
				'Last run: {0} - {1}',
				statusLabel,
				lastRun.goal.slice(0, 60),
			);

			if (lastRun.result) {
				const resultEl = append(this._runStatusSection, $('.zonecog-agi-result'));
				resultEl.textContent = lastRun.result.slice(0, 200) + (lastRun.result.length > 200 ? '…' : '');
			}
		} else {
			const emptyEl = append(this._runStatusSection, $('.zonecog-agi-empty'));
			emptyEl.textContent = localize('zonecog.agiStudio.noRuns', 'No runs yet. Use the command palette to start a run.');
		}
	}

	private _refreshAgentTree(): void {
		if (!this._agentTreeSection) {
			return;
		}

		clearNode(this._agentTreeSection);

		const activeRun = this.agiStudioService.getActiveRun();
		const runId = activeRun?.id ?? this.agiStudioService.getRuns()[0]?.id;

		if (!runId) {
			const emptyEl = append(this._agentTreeSection, $('.zonecog-agi-empty'));
			emptyEl.textContent = localize('zonecog.agiStudio.noAgents', 'No agents yet.');
			return;
		}

		const agents = this.agiStudioService.getAgents(runId);

		if (agents.length === 0) {
			const emptyEl = append(this._agentTreeSection, $('.zonecog-agi-empty'));
			emptyEl.textContent = localize('zonecog.agiStudio.noAgents', 'No agents yet.');
			return;
		}

		const treeEl = append(this._agentTreeSection, $('.zonecog-agi-tree'));

		for (const agent of agents) {
			this._renderAgent(treeEl, agent);
		}
	}

	private _renderAgent(container: HTMLElement, agent: StudioAgent): void {
		const agentEl = append(container, $('.zonecog-agi-agent'));
		agentEl.style.paddingLeft = `${agent.depth * 16}px`;

		const statusClass = `zonecog-agi-status-${agent.status}`;
		const statusEl = append(agentEl, $(`.zonecog-agi-agent-status.${statusClass}`));
		statusEl.textContent = '●';

		const nameEl = append(agentEl, $('.zonecog-agi-agent-name'));
		nameEl.textContent = `${agent.name} [${agent.role}]`;

		const depthEl = append(agentEl, $('.zonecog-agi-agent-depth'));
		depthEl.textContent = localize('zonecog.agiStudio.agentDepth', 'd{0}', agent.depth);
	}

	private _refreshMessageLog(): void {
		if (!this._messageLogSection) {
			return;
		}

		clearNode(this._messageLogSection);

		const activeRun = this.agiStudioService.getActiveRun();
		const runId = activeRun?.id ?? this.agiStudioService.getRuns()[0]?.id;

		if (!runId) {
			const emptyEl = append(this._messageLogSection, $('.zonecog-agi-empty'));
			emptyEl.textContent = localize('zonecog.agiStudio.noMessages', 'No messages yet.');
			return;
		}

		const messages = this.agiStudioService.getMessages(runId);

		if (messages.length === 0) {
			const emptyEl = append(this._messageLogSection, $('.zonecog-agi-empty'));
			emptyEl.textContent = localize('zonecog.agiStudio.noMessages', 'No messages yet.');
			return;
		}

		// Show most recent 10 messages (reversed)
		const recentMessages = messages.slice(-10).reverse();

		for (const msg of recentMessages) {
			this._renderMessage(this._messageLogSection, msg);
		}
	}

	private _renderMessage(container: HTMLElement, msg: AgentMessage): void {
		const msgEl = append(container, $('.zonecog-agi-message'));

		const typeEl = append(msgEl, $('.zonecog-agi-message-type'));
		typeEl.textContent = this._messageTypeLabel(msg.messageType);

		const contentEl = append(msgEl, $('.zonecog-agi-message-content'));
		const truncated = msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content;
		contentEl.textContent = truncated;

		const timeEl = append(msgEl, $('.zonecog-agi-message-time'));
		timeEl.textContent = new Date(msg.timestamp).toLocaleTimeString();
	}

	// -- Helpers -------------------------------------------------------------

	private _createStatCard(container: HTMLElement, label: string, value: string): void {
		const card = append(container, $('.zonecog-stat-card'));
		append(card, $('.zonecog-stat-label')).textContent = label;
		append(card, $('.zonecog-stat-value')).textContent = value;
	}

	private _runStatusLabel(run: StudioRun): string {
		switch (run.status) {
			case 'running': return localize('zonecog.agiStudio.statusRunning', 'Running');
			case 'completed': return localize('zonecog.agiStudio.statusCompleted', 'Completed');
			case 'failed': return localize('zonecog.agiStudio.statusFailed', 'Failed');
			case 'stopped': return localize('zonecog.agiStudio.statusStopped', 'Stopped');
		}
	}

	private _messageTypeLabel(type: AgentMessage['messageType']): string {
		switch (type) {
			case 'task-assignment': return localize('zonecog.agiStudio.taskAssignment', '→ Task');
			case 'result-report': return localize('zonecog.agiStudio.resultReport', '← Result');
			case 'status-update': return localize('zonecog.agiStudio.statusUpdate', '• Status');
		}
	}
}
