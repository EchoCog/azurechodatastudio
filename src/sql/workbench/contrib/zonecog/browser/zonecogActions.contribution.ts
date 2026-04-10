/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ILogService } from 'vs/platform/log/common/log';
import { localize } from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';

/**
 * Action to test ZoneCog cognitive processing
 */
class ZoneCogTestAction extends Action2 {

	static ID = 'zonecog.test';
	static LABEL = localize('zonecog.test', 'Test Zone-Cog Cognitive Processing');

	constructor() {
		super({
			id: ZoneCogTestAction.ID,
			title: ZoneCogTestAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.circuitBoard,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const zonecogService = accessor.get(IZoneCogService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);
		const logService = accessor.get(ILogService);

		// Initialize the service if not already done
		await zonecogService.initialize();

		// Get user input
		const input = await quickInputService.input({
			prompt: localize('zonecog.prompt', 'Enter a query for Zone-Cog cognitive processing'),
			placeHolder: localize('zonecog.placeholder', 'Ask anything about data, analysis, or Azure Data Studio...'),
		});

		if (!input) {
			return;
		}

		try {
			// Process the query through Zone-Cog
			const response = await zonecogService.processQuery(input);

			// Show the result
			const message = localize('zonecog.result',
				'Zone-Cog Response: {0}\n\nComplexity: {1} | Confidence: {2}% | Processing Time: {3}ms | Phases: {4}',
				response.response,
				response.metadata.queryComplexity,
				Math.round(response.confidence * 100),
				response.metadata.processingTime,
				response.phases.length
			);

			notificationService.info(message);

			// Log the thinking process for diagnostics
			if (response.thinking) {
				logService.debug('Zone-Cog Thinking Process:\n' + response.thinking);
				logService.debug('Zone-Cog Phases: ' + response.phases.map(p => p.name).join(' → '));
			}

		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			notificationService.error(localize('zonecog.error', 'Zone-Cog processing failed: {0}', errMsg));
		}
	}
}

/**
 * Action to toggle Zone-Cog thinking mode
 */
class ZoneCogToggleThinkingAction extends Action2 {

	static ID = 'zonecog.toggleThinking';
	static LABEL = localize('zonecog.toggleThinking', 'Toggle Zone-Cog Thinking Mode');

	constructor() {
		super({
			id: ZoneCogToggleThinkingAction.ID,
			title: ZoneCogToggleThinkingAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.gear,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const zonecogService = accessor.get(IZoneCogService);
		const notificationService = accessor.get(INotificationService);

		await zonecogService.initialize();

		const currentState = zonecogService.getCognitiveState();
		const newThinkingMode = !currentState.thinkingModeEnabled;

		zonecogService.setThinkingMode(newThinkingMode);

		const message = newThinkingMode
			? localize('zonecog.thinkingEnabled', 'Zone-Cog comprehensive thinking mode enabled')
			: localize('zonecog.thinkingDisabled', 'Zone-Cog comprehensive thinking mode disabled');

		notificationService.info(message);
	}
}

/**
 * Action to show Zone-Cog status including membrane, hypergraph, embodied cognition, and workspace info
 */
class ZoneCogStatusAction extends Action2 {

	static ID = 'zonecog.status';
	static LABEL = localize('zonecog.status', 'Show Zone-Cog Workbench Status');

	constructor() {
		super({
			id: ZoneCogStatusAction.ID,
			title: ZoneCogStatusAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.info,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const zonecogService = accessor.get(IZoneCogService);
		const embodiedService = accessor.get(IEmbodiedCognitionService);
		const workspaceService = accessor.get(ICognitiveWorkspaceService);
		const notificationService = accessor.get(INotificationService);

		const state = zonecogService.getCognitiveState();
		const proprio = embodiedService.getProprioceptiveState();
		const wsSummary = workspaceService.getSummary();

		const coreStatus = localize('zonecog.statusInfoCore',
			'Zone-Cog Workbench Status:\nInitialized: {0}\nThinking Mode: {1}\nCognitive Load: {2}%\nHypergraph Nodes: {3}\nMembrane Health: {4}',
			state.isInitialized ? 'Yes' : 'No',
			state.thinkingModeEnabled ? 'Enabled' : 'Disabled',
			Math.round(state.cognitiveLoad * 100),
			state.hypergraphNodeCount,
			state.membraneHealthy ? 'Healthy' : 'Degraded'
		);

		const workbenchStatus = localize('zonecog.statusInfoWorkbench',
			'Sensory Channels: {0}\nWorking Memory: {1}/{2}\nEpisodes: {3}\nActive Task: {4}\nAttentional Focus: {5}',
			proprio.activeSensoryChannels,
			wsSummary.workingMemorySize,
			wsSummary.workingMemoryCapacity,
			wsSummary.episodeCount,
			wsSummary.activeTask || 'None',
			proprio.attentionalFocus || 'None'
		);

		const message = `${coreStatus}\n${workbenchStatus}`;

		notificationService.info(message);
	}
}

/**
 * Action to explore the hypergraph knowledge store
 */
class ZoneCogExploreHypergraphAction extends Action2 {

	static ID = 'zonecog.exploreHypergraph';
	static LABEL = localize('zonecog.exploreHypergraph', 'Explore Hypergraph Knowledge Store');

	constructor() {
		super({
			id: ZoneCogExploreHypergraphAction.ID,
			title: ZoneCogExploreHypergraphAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.graphScatter,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const hypergraphStore = accessor.get(IHypergraphStore);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const nodeCount = hypergraphStore.nodeCount();
		const linkCount = hypergraphStore.linkCount();

		if (nodeCount === 0) {
			notificationService.info(localize('zonecog.emptyGraph', 'Hypergraph is empty. Process a query first to populate it.'));
			return;
		}

		// Collect node type counts
		const allNodes = hypergraphStore.getAllNodes();
		const typeCounts = new Map<string, number>();
		for (const node of allNodes) {
			typeCounts.set(node.node_type, (typeCounts.get(node.node_type) ?? 0) + 1);
		}

		// Show type picker
		const items = Array.from(typeCounts.entries()).map(([type, count]) => ({
			label: type,
			description: `${count} node${count > 1 ? 's' : ''}`,
		}));
		items.unshift({ label: 'Top Salient', description: 'Most salient nodes across all types' });

		const pick = await quickInputService.pick(items, {
			placeHolder: localize('zonecog.graphPicker', 'Select node type to explore ({0} nodes, {1} links)', nodeCount, linkCount),
		});

		if (!pick) {
			return;
		}

		let nodes;
		if (pick.label === 'Top Salient') {
			nodes = hypergraphStore.getTopSalientNodes(10);
		} else {
			nodes = hypergraphStore.getNodesByType(pick.label).slice(0, 10);
		}

		const summary = nodes.map(n =>
			`[${n.node_type}] ${n.content.substring(0, 80)}${n.content.length > 80 ? '...' : ''} (salience: ${n.salience_score.toFixed(2)})`
		).join('\n');

		notificationService.info(localize('zonecog.graphExplore', 'Hypergraph Nodes ({0}):\n{1}', pick.label, summary));
	}
}

/**
 * Action to set cognitive attentional focus
 */
class ZoneCogSetFocusAction extends Action2 {

	static ID = 'zonecog.setFocus';
	static LABEL = localize('zonecog.setFocus', 'Set Cognitive Focus');

	constructor() {
		super({
			id: ZoneCogSetFocusAction.ID,
			title: ZoneCogSetFocusAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.eye,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const embodiedService = accessor.get(IEmbodiedCognitionService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const current = embodiedService.getProprioceptiveState().attentionalFocus;

		const input = await quickInputService.input({
			prompt: localize('zonecog.focusPrompt', 'Set attentional focus (leave empty to clear)'),
			placeHolder: localize('zonecog.focusPlaceholder', 'e.g., "orders table schema", "query performance"...'),
			value: current ?? '',
		});

		if (input === undefined) {
			return; // cancelled
		}

		const focus = input.trim() || null;
		embodiedService.setAttentionalFocus(focus);

		const message = focus
			? localize('zonecog.focusSet', 'Cognitive focus set to: {0}', focus)
			: localize('zonecog.focusCleared', 'Cognitive focus cleared');
		notificationService.info(message);
	}
}

/**
 * Action to view the cognitive workspace summary
 */
class ZoneCogWorkspaceSummaryAction extends Action2 {

	static ID = 'zonecog.workspaceSummary';
	static LABEL = localize('zonecog.workspaceSummary', 'Show Cognitive Workspace Summary');

	constructor() {
		super({
			id: ZoneCogWorkspaceSummaryAction.ID,
			title: ZoneCogWorkspaceSummaryAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.notebook,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceService = accessor.get(ICognitiveWorkspaceService);
		const embodiedService = accessor.get(IEmbodiedCognitionService);
		const notificationService = accessor.get(INotificationService);

		const summary = workspaceService.getSummary();
		const env = embodiedService.getEnvironmentSnapshot();
		const wm = workspaceService.getWorkingMemory();
		const episodes = workspaceService.getRecentEpisodes(5);

		let message = localize('zonecog.wsSummary',
			'Cognitive Workspace:\nWorking Memory: {0}/{1} items\nEpisodes: {2}\nTasks: {3}\nActive Task: {4}\n\nEnvironment:\nKnown Schemas: {5}\nRecent Query Patterns: {6}\nTotal Percepts: {7}\nTotal Actions: {8}',
			summary.workingMemorySize,
			summary.workingMemoryCapacity,
			summary.episodeCount,
			summary.taskCount,
			summary.activeTask || 'None',
			env.knownSchemas.length,
			env.recentQueryPatterns.length,
			env.totalPercepts,
			env.totalActions
		);

		if (wm.length > 0) {
			const wmItems = wm.slice(0, 5).map(item =>
				`  [${item.category}] ${item.content.substring(0, 60)} (rel: ${item.relevance.toFixed(2)})`
			).join('\n');
			message += '\n\nWorking Memory Contents:\n' + wmItems;
		}

		if (episodes.length > 0) {
			const epItems = episodes.map(ep =>
				`  ${ep.title} (${new Date(ep.startTime).toLocaleTimeString()})`
			).join('\n');
			message += '\n\nRecent Episodes:\n' + epItems;
		}

		notificationService.info(message);
	}
}

/**
 * Action to create a cognitive task
 */
class ZoneCogCreateTaskAction extends Action2 {

	static ID = 'zonecog.createTask';
	static LABEL = localize('zonecog.createTask', 'Create Cognitive Task');

	constructor() {
		super({
			id: ZoneCogCreateTaskAction.ID,
			title: ZoneCogCreateTaskAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.checklist,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceService = accessor.get(ICognitiveWorkspaceService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const input = await quickInputService.input({
			prompt: localize('zonecog.taskPrompt', 'Describe the cognitive task'),
			placeHolder: localize('zonecog.taskPlaceholder', 'e.g., "Analyze query performance patterns"...'),
		});

		if (!input) {
			return;
		}

		const task = workspaceService.createTask(input, true);
		notificationService.info(localize('zonecog.taskCreated', 'Cognitive task created and activated: {0}', task.description));
	}
}

/**
 * Action to view membrane triad health details
 */
class ZoneCogMembraneHealthAction extends Action2 {

	static ID = 'zonecog.membraneHealth';
	static LABEL = localize('zonecog.membraneHealth', 'Show Membrane Triad Health');

	constructor() {
		super({
			id: ZoneCogMembraneHealthAction.ID,
			title: ZoneCogMembraneHealthAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.heartFilled,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const membraneService = accessor.get(ICognitiveMembraneService);
		const notificationService = accessor.get(INotificationService);

		const statuses = membraneService.getAllStatuses();
		const lines = statuses.map(s =>
			`${s.triad.charAt(0).toUpperCase() + s.triad.slice(1)} Triad: ${s.healthy ? 'Healthy' : 'DEGRADED'} | ` +
			`Processes: ${s.activeProcesses} | Errors: ${s.errorCount} | ` +
			`Last Activity: ${new Date(s.lastActivity).toLocaleTimeString()}`
		);

		notificationService.info(localize('zonecog.membraneStatus',
			'Cognitive Membrane Architecture (P-System):\n{0}\n\nOverall: {1}',
			lines.join('\n'),
			membraneService.isSystemHealthy() ? 'All membranes healthy' : 'System health degraded'
		));
	}
}

/**
 * Action to reset the cognitive workbench state
 */
class ZoneCogResetAction extends Action2 {

	static ID = 'zonecog.reset';
	static LABEL = localize('zonecog.reset', 'Reset Cognitive Workbench');

	constructor() {
		super({
			id: ZoneCogResetAction.ID,
			title: ZoneCogResetAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.debugRestart,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const zonecogService = accessor.get(IZoneCogService);
		const hypergraphStore = accessor.get(IHypergraphStore);
		const embodiedService = accessor.get(IEmbodiedCognitionService);
		const workspaceService = accessor.get(ICognitiveWorkspaceService);
		const notificationService = accessor.get(INotificationService);

		zonecogService.reset();
		hypergraphStore.clear();
		embodiedService.reset();
		workspaceService.reset();

		const membraneService = accessor.get(ICognitiveMembraneService);
		membraneService.resetErrors('cerebral');
		membraneService.resetErrors('somatic');
		membraneService.resetErrors('autonomic');

		notificationService.info(localize('zonecog.resetDone', 'Cognitive workbench reset: all services, hypergraph, embodiment, workspace, and membrane errors cleared.'));
	}
}

/**
 * Action to view query processing history
 */
class ZoneCogQueryHistoryAction extends Action2 {

	static ID = 'zonecog.queryHistory';
	static LABEL = localize('zonecog.queryHistory', 'Show Query History');

	constructor() {
		super({
			id: ZoneCogQueryHistoryAction.ID,
			title: ZoneCogQueryHistoryAction.LABEL,
			category: localize('zonecog.category', 'Zone-Cog'),
			icon: Codicon.history,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const zonecogService = accessor.get(IZoneCogService);
		const notificationService = accessor.get(INotificationService);

		const history = zonecogService.getQueryHistory();

		if (history.length === 0) {
			notificationService.info(localize('zonecog.noHistory', 'No query history yet. Process a query first.'));
			return;
		}

		const lines = history.slice(-10).reverse().map((entry, i) =>
			`${i + 1}. "${entry.query.substring(0, 60)}${entry.query.length > 60 ? '...' : ''}" (${new Date(entry.timestamp).toLocaleTimeString()})`
		);

		notificationService.info(localize('zonecog.historyList',
			'Recent Query History ({0} total):\n{1}',
			history.length,
			lines.join('\n')
		));
	}
}

// Register all actions
registerAction2(ZoneCogTestAction);
registerAction2(ZoneCogToggleThinkingAction);
registerAction2(ZoneCogStatusAction);
registerAction2(ZoneCogExploreHypergraphAction);
registerAction2(ZoneCogSetFocusAction);
registerAction2(ZoneCogWorkspaceSummaryAction);
registerAction2(ZoneCogCreateTaskAction);
registerAction2(ZoneCogMembraneHealthAction);
registerAction2(ZoneCogResetAction);
registerAction2(ZoneCogQueryHistoryAction);
