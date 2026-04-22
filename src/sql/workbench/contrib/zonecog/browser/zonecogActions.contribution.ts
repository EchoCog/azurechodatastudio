/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ICognitiveLoopService } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ILogService } from 'vs/platform/log/common/log';
import { localize } from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { CognitiveLoopStatusBarContribution } from 'sql/workbench/contrib/zonecog/browser/cognitiveLoopStatusBar';

const ZONECOG_CATEGORY = { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' };

/**
 * Action to test ZoneCog cognitive processing
 */
class ZoneCogTestAction extends Action2 {

	static ID = 'zonecog.test';
	constructor() {
		super({
			id: ZoneCogTestAction.ID,
			title: { value: localize('zonecog.test', 'Test Zone-Cog Cognitive Processing'), original: 'Test Zone-Cog Cognitive Processing' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
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
	constructor() {
		super({
			id: ZoneCogToggleThinkingAction.ID,
			title: { value: localize('zonecog.toggleThinking', 'Toggle Zone-Cog Thinking Mode'), original: 'Toggle Zone-Cog Thinking Mode' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
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
	constructor() {
		super({
			id: ZoneCogStatusAction.ID,
			title: { value: localize('zonecog.status', 'Show Zone-Cog Status'), original: 'Show Zone-Cog Status' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
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
	constructor() {
		super({
			id: ZoneCogExploreHypergraphAction.ID,
			title: { value: localize('zonecog.exploreHypergraph', 'Explore Hypergraph Knowledge Store'), original: 'Explore Hypergraph Knowledge Store' },
			category: ZONECOG_CATEGORY,
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
	constructor() {
		super({
			id: ZoneCogSetFocusAction.ID,
			title: { value: localize('zonecog.setFocus', 'Set Cognitive Focus'), original: 'Set Cognitive Focus' },
			category: ZONECOG_CATEGORY,
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
	constructor() {
		super({
			id: ZoneCogWorkspaceSummaryAction.ID,
			title: { value: localize('zonecog.workspaceSummary', 'Show Cognitive Workspace Summary'), original: 'Show Cognitive Workspace Summary' },
			category: ZONECOG_CATEGORY,
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
	constructor() {
		super({
			id: ZoneCogCreateTaskAction.ID,
			title: { value: localize('zonecog.createTask', 'Create Cognitive Task'), original: 'Create Cognitive Task' },
			category: ZONECOG_CATEGORY,
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
	constructor() {
		super({
			id: ZoneCogMembraneHealthAction.ID,
			title: { value: localize('zonecog.membraneHealth', 'Show Membrane Triad Health'), original: 'Show Membrane Triad Health' },
			category: ZONECOG_CATEGORY,
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
	constructor() {
		super({
			id: ZoneCogResetAction.ID,
			title: { value: localize('zonecog.reset', 'Reset Cognitive Workbench'), original: 'Reset Cognitive Workbench' },
			category: ZONECOG_CATEGORY,
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

		hypergraphStore.clear();
		embodiedService.reset();
		workspaceService.reset();
		zonecogService.reset();

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
	constructor() {
		super({
			id: ZoneCogQueryHistoryAction.ID,
			title: { value: localize('zonecog.queryHistory', 'Show Query History'), original: 'Show Query History' },
			category: ZONECOG_CATEGORY,
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

/**
 * Action to view ECAN Attention Network snapshot
 */
class ZoneCogECANSnapshotAction extends Action2 {

	static ID = 'zonecog.ecanSnapshot';
	constructor() {
		super({
			id: ZoneCogECANSnapshotAction.ID,
			title: { value: localize('zonecog.ecanSnapshot', 'Show ECAN Attention Snapshot'), original: 'Show ECAN Attention Snapshot' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.flame,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const ecanService = accessor.get(IECANAttentionService);
		const notificationService = accessor.get(INotificationService);

		const snapshot = ecanService.getSnapshot();
		const focusNodes = ecanService.getAttentionalFocus();

		const message = localize('zonecog.ecanStatus',
			'ECAN Attention Network:\nFocus Boundary: {0}\nNodes in Focus: {1}\nTotal Tracked: {2}\nSpreading Cycles: {3}\nRent Collected: {4}\n\nFocus Node IDs: {5}',
			snapshot.attentionalFocusBoundary.toFixed(3),
			snapshot.nodesInFocus,
			snapshot.totalTrackedNodes,
			snapshot.spreadingCycles,
			snapshot.rentCollected.toFixed(4),
			focusNodes.length > 0 ? focusNodes.slice(0, 10).join(', ') : 'None'
		);

		notificationService.info(message);
	}
}

/**
 * Action to manually trigger ECAN spreading activation
 */
class ZoneCogSpreadActivationAction extends Action2 {

	static ID = 'zonecog.spreadActivation';
	constructor() {
		super({
			id: ZoneCogSpreadActivationAction.ID,
			title: { value: localize('zonecog.spreadActivation', 'Run ECAN Spreading Activation'), original: 'Run ECAN Spreading Activation' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.zap,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const ecanService = accessor.get(IECANAttentionService);
		const notificationService = accessor.get(INotificationService);

		const result = ecanService.spreadActivation();

		notificationService.info(localize('zonecog.spreadResult',
			'ECAN Spreading Activation Complete:\nBoosted: {0} nodes\nDecayed: {1} nodes\nEvicted: {2} nodes\nDuration: {3}ms',
			result.boosted.length,
			result.decayed.length,
			result.evicted.length,
			result.durationMs
		));
	}
}

/**
 * Action to start/stop the cognitive loop
 */
class ZoneCogCognitiveLoopToggleAction extends Action2 {

	static ID = 'zonecog.toggleCognitiveLoop';
	constructor() {
		super({
			id: ZoneCogCognitiveLoopToggleAction.ID,
			title: { value: localize('zonecog.toggleCognitiveLoop', 'Toggle Cognitive Loop'), original: 'Toggle Cognitive Loop' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.play,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const loopService = accessor.get(ICognitiveLoopService);
		const notificationService = accessor.get(INotificationService);

		const state = loopService.getState();

		if (state.running && !state.paused) {
			loopService.stop();
			notificationService.info(localize('zonecog.loopStopped', 'Cognitive loop stopped.'));
		} else if (state.paused) {
			loopService.resume();
			notificationService.info(localize('zonecog.loopResumed', 'Cognitive loop resumed.'));
		} else {
			loopService.start();
			notificationService.info(localize('zonecog.loopStarted',
				'Cognitive loop started (interval: {0}ms). Cycle: perceive → attend → think → act → reflect',
				state.tickIntervalMs
			));
		}
	}
}

/**
 * Action to view cognitive loop status and recent iterations
 */
class ZoneCogCognitiveLoopStatusAction extends Action2 {

	static ID = 'zonecog.cognitiveLoopStatus';
	constructor() {
		super({
			id: ZoneCogCognitiveLoopStatusAction.ID,
			title: { value: localize('zonecog.cognitiveLoopStatus', 'Show Cognitive Loop Status'), original: 'Show Cognitive Loop Status' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.pulse,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const loopService = accessor.get(ICognitiveLoopService);
		const notificationService = accessor.get(INotificationService);

		const state = loopService.getState();
		const recent = loopService.getRecentIterations(5);

		let statusLabel: string;
		if (state.running && !state.paused) {
			statusLabel = 'Running';
		} else if (state.paused) {
			statusLabel = 'Paused';
		} else {
			statusLabel = 'Stopped';
		}

		let message = localize('zonecog.loopStatus',
			'Cognitive Loop Status: {0}\nTotal Iterations: {1}\nFailed: {2}\nAvg Duration: {3}ms\nTick Interval: {4}ms',
			statusLabel,
			state.totalIterations,
			state.failedIterations,
			state.averageIterationMs,
			state.tickIntervalMs
		);

		if (recent.length > 0) {
			const recentLines = recent.reverse().map((it, i) => {
				const phases = it.phases.map(p => p.name).join('→');
				return `  #${it.iteration}: ${it.durationMs}ms [${phases}] ${it.success ? '✓' : '✗'}`;
			});
			message += '\n\nRecent Iterations:\n' + recentLines.join('\n');
		}

		notificationService.info(message);
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
registerAction2(ZoneCogECANSnapshotAction);
registerAction2(ZoneCogSpreadActivationAction);
registerAction2(ZoneCogCognitiveLoopToggleAction);
registerAction2(ZoneCogCognitiveLoopStatusAction);

// Register the cognitive loop status bar contribution so the loop state is
// always visible in the workbench status bar.
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(CognitiveLoopStatusBarContribution, LifecyclePhase.Restored);
