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
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { IAAROrchestrationService } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { IHypergraphPersistenceService } from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { ISchemaPerceptionService } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { IAphroditeService } from 'sql/workbench/services/zonecog/common/aphrodite';
import { ICognitiveWorkflowAutomationService } from 'sql/workbench/services/zonecog/common/cognitiveWorkflowAutomation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ILogService } from 'vs/platform/log/common/log';
import { localize } from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { CognitiveLoopStatusBarContribution } from 'sql/workbench/contrib/zonecog/browser/cognitiveLoopStatusBar';
import { IAgiStudioService } from 'sql/workbench/services/zonecog/common/agiStudio';
import { ICognitiveProvenanceService } from 'sql/workbench/services/zonecog/common/cognitiveProvenance';
import { ISchemaEvolutionService } from 'sql/workbench/services/zonecog/common/schemaEvolution';

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
				const phases = it.phases.map(p => p.name).join('->');
				return `  #${it.iteration}: ${it.durationMs}ms [${phases}] ${it.success ? 'OK' : 'FAIL'}`;
			});
			message += '\n\nRecent Iterations:\n' + recentLines.join('\n');
		}

		notificationService.info(message);
	}
}

/**
 * Action to mine recorded interactions for recurring patterns
 */
class ZoneCogDetectInteractionPatternsAction extends Action2 {

	static ID = 'zonecog.detectInteractionPatterns';
	constructor() {
		super({
			id: ZoneCogDetectInteractionPatternsAction.ID,
			title: { value: localize('zonecog.detectInteractionPatterns', 'Detect Interaction Patterns'), original: 'Detect Interaction Patterns' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.repo,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const embodiedService = accessor.get(IEmbodiedCognitionService);
		const notificationService = accessor.get(INotificationService);

		const patterns = embodiedService.detectInteractionPatterns();
		const history = embodiedService.getInteractionPatterns(10);

		if (patterns.length === 0 && history.length === 0) {
			notificationService.info(localize('zonecog.noInteractionPatterns',
				'No interaction patterns detected yet. Interact with the workbench first (or none met the repetition threshold).'));
			return;
		}

		const toShow = patterns.length > 0 ? patterns : history;
		const lines = toShow.slice(0, 10).map(p =>
			`  [${p.kind}] ${p.description} (confidence: ${p.confidence.toFixed(2)})`
		).join('\n');

		notificationService.info(localize('zonecog.interactionPatternsResult',
			'{0} interaction pattern(s) {1}:\n{2}',
			toShow.length,
			patterns.length > 0 ? 'newly detected' : 'previously detected',
			lines
		));
	}
}

// =============================================================================
// Phase 4 actions - DTESN, AAR Orchestration, Hypergraph Persistence
// =============================================================================

/**
 * Action to run a DTESN forward pass with a test input
 */
class ZoneCogDTESNForwardAction extends Action2 {

	static ID = 'zonecog.dtesnForward';
	constructor() {
		super({
			id: ZoneCogDTESNForwardAction.ID,
			title: { value: localize('zonecog.dtesnForward', 'Run DTESN Forward Pass'), original: 'Run DTESN Forward Pass' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.symbolMisc,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const dtesnService = accessor.get(IDTESNService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const inputStr = await quickInputService.input({
			prompt: localize('zonecog.dtesnInputPrompt', 'Enter comma-separated input values (up to 8 floats)'),
			placeHolder: localize('zonecog.dtesnInputPlaceholder', 'e.g. 0.5,0.2,0.8,0.1,0.6,0.3,0.9,0.4'),
		});

		if (inputStr === undefined) { return; }

		const rawValues = (inputStr || '0.5,0.3,0.7,0.2,0.6,0.4,0.8,0.1')
			.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));

		const result = dtesnService.forward(rawValues);
		const outputStr = result.output.map(v => v.toFixed(4)).join(', ');
		const layerNorms = result.layerStates.map((ls, i) => {
			const norm = Math.sqrt(ls.activation.reduce((s, v) => s + v * v, 0));
			return `L${i}=||${norm.toFixed(3)}||`;
		}).join(' ');

		notificationService.info(localize('zonecog.dtesnResult',
			'DTESN Forward Pass:\nInput dim: {0}\nOutput: [{1}]\nLayer norms: {2}\nDuration: {3}ms\n\n{4}',
			rawValues.length,
			outputStr,
			layerNorms,
			result.durationMs,
			dtesnService.getDiagnosticSummary()
		));
	}
}

/**
 * Action to view DTESN network status and diagnostics
 */
class ZoneCogDTESNStatusAction extends Action2 {

	static ID = 'zonecog.dtesnStatus';
	constructor() {
		super({
			id: ZoneCogDTESNStatusAction.ID,
			title: { value: localize('zonecog.dtesnStatus', 'Show DTESN Network Status'), original: 'Show DTESN Network Status' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.graph,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const dtesnService = accessor.get(IDTESNService);
		const notificationService = accessor.get(INotificationService);

		const state = dtesnService.getState();
		const config = dtesnService.getConfig();
		const spectralRadii = config.layers.map((_, i) =>
			`L${i}: ${dtesnService.getLayerSpectralRadius(i).toFixed(4)}`
		).join(', ');

		notificationService.info(localize('zonecog.dtesnStatusMsg',
			'Deep Tree Echo State Network:\nDepth: {0} layers\nInput dim: {1} | Output dim: {2}\nTotal ticks: {3}\nTraining buffer: {4} samples\nLast tick: {5}\nSpectral radii: {6}\n\n{7}',
			config.treeDepth,
			config.inputDim,
			config.outputDim,
			state.totalTicks,
			dtesnService.getTrainingBufferSize(),
			state.lastTickTime > 0 ? new Date(state.lastTickTime).toLocaleTimeString() : 'Never',
			spectralRadii,
			dtesnService.getDiagnosticSummary()
		));
	}
}

/**
 * Action to orchestrate a task through the AAR agent network
 */
class ZoneCogAAROrchestrationAction extends Action2 {

	static ID = 'zonecog.aarOrchestrate';
	constructor() {
		super({
			id: ZoneCogAAROrchestrationAction.ID,
			title: { value: localize('zonecog.aarOrchestrate', 'AAR: Orchestrate Cognitive Task'), original: 'AAR: Orchestrate Cognitive Task' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.organization,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aarService = accessor.get(IAAROrchestrationService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const description = await quickInputService.input({
			prompt: localize('zonecog.aarTaskPrompt', 'Describe the cognitive task to orchestrate'),
			placeHolder: localize('zonecog.aarTaskPlaceholder', 'e.g. "Analyse recent query patterns and suggest optimisations"'),
		});

		if (!description) { return; }

		notificationService.info(localize('zonecog.aarStarted', 'AAR orchestration started for: {0}', description));

		try {
			const result = await aarService.orchestrate({
				description,
				payload: description,
				requiredCapabilities: [],
				priority: 0.7,
			});

			const agentPath = result.agentPath.join(' -> ');
			const statusIcon = result.success ? '[OK]' : '[FAIL]';

			notificationService.info(localize('zonecog.aarResult',
				'AAR Task Complete {0}\nPath: {1}\nDuration: {2}ms\nSuccess: {3}',
				statusIcon,
				agentPath,
				result.totalDurationMs,
				result.success ? 'Yes' : `No - ${result.error}`
			));
		} catch (err) {
			notificationService.error(localize('zonecog.aarError',
				'AAR orchestration failed: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to view the AAR Arena status
 */
class ZoneCogAARArenaStatusAction extends Action2 {

	static ID = 'zonecog.aarArenaStatus';
	constructor() {
		super({
			id: ZoneCogAARArenaStatusAction.ID,
			title: { value: localize('zonecog.aarArenaStatus', 'Show AAR Arena Status'), original: 'Show AAR Arena Status' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.serverProcess,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aarService = accessor.get(IAAROrchestrationService);
		const notificationService = accessor.get(INotificationService);

		const arenaState = aarService.getArenaState();
		const agents = aarService.getAllAgents();
		const agentLines = agents.map(a =>
			`  [${a.role}] ${a.name} - tasks: ${a.totalTasksProcessed}, ` +
			`active: ${a.active ? 'yes' : 'no'}`
		).join('\n');

		notificationService.info(localize('zonecog.aarArenaMsg',
			'AAR Arena (session: {0}):\nAgents: {1}\nRelations: {2}\nTasks orchestrated: {3}\nSuccessful: {4}\nActive now: {5}\n\nRegistered Agents:\n{6}',
			arenaState.sessionId.substring(0, 16),
			arenaState.agentCount,
			arenaState.relationCount,
			arenaState.totalTasksOrchestrated,
			arenaState.successfulTasks,
			arenaState.activeTaskCount,
			agentLines
		));
	}
}

/**
 * Action to save the hypergraph to IndexedDB
 */
class ZoneCogPersistenceSaveAction extends Action2 {

	static ID = 'zonecog.persistenceSave';
	constructor() {
		super({
			id: ZoneCogPersistenceSaveAction.ID,
			title: { value: localize('zonecog.persistenceSave', 'Save Hypergraph to IndexedDB'), original: 'Save Hypergraph to IndexedDB' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.save,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const persistenceService = accessor.get(IHypergraphPersistenceService);
		const notificationService = accessor.get(INotificationService);

		try {
			const snapshot = await persistenceService.save('manual');
			notificationService.info(localize('zonecog.persistenceSaved',
				'Hypergraph saved to IndexedDB:\n{0} nodes, {1} links\nSnapshot ID: {2}\nTime: {3}',
				snapshot.nodeCount,
				snapshot.linkCount,
				snapshot.id,
				new Date(snapshot.timestamp).toLocaleTimeString()
			));
		} catch (err) {
			notificationService.error(localize('zonecog.persistenceSaveError',
				'Failed to save hypergraph: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to load the hypergraph from IndexedDB
 */
class ZoneCogPersistenceLoadAction extends Action2 {

	static ID = 'zonecog.persistenceLoad';
	constructor() {
		super({
			id: ZoneCogPersistenceLoadAction.ID,
			title: { value: localize('zonecog.persistenceLoad', 'Load Hypergraph from IndexedDB'), original: 'Load Hypergraph from IndexedDB' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.desktopDownload,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const persistenceService = accessor.get(IHypergraphPersistenceService);
		const notificationService = accessor.get(INotificationService);

		try {
			const snapshot = await persistenceService.load();
			if (!snapshot) {
				notificationService.info(localize('zonecog.persistenceNothingStored',
					'No hypergraph data found in IndexedDB. Save the graph first.'));
				return;
			}
			notificationService.info(localize('zonecog.persistenceLoaded',
				'Hypergraph loaded from IndexedDB:\n{0} nodes, {1} links\nOriginal save: {2}',
				snapshot.nodeCount,
				snapshot.linkCount,
				new Date(snapshot.timestamp).toLocaleString()
			));
		} catch (err) {
			notificationService.error(localize('zonecog.persistenceLoadError',
				'Failed to load hypergraph: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to view hypergraph persistence statistics
 */
class ZoneCogPersistenceStatsAction extends Action2 {

	static ID = 'zonecog.persistenceStats';
	constructor() {
		super({
			id: ZoneCogPersistenceStatsAction.ID,
			title: { value: localize('zonecog.persistenceStats', 'Show Hypergraph Persistence Stats'), original: 'Show Hypergraph Persistence Stats' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.database,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const persistenceService = accessor.get(IHypergraphPersistenceService);
		const notificationService = accessor.get(INotificationService);

		try {
			const stats = await persistenceService.getStats();
			const lastSave = stats.lastSaveTime > 0
				? new Date(stats.lastSaveTime).toLocaleTimeString()
				: 'Never';
			const lastLoad = stats.lastLoadTime > 0
				? new Date(stats.lastLoadTime).toLocaleTimeString()
				: 'Never';
			const sizeKb = (stats.estimatedBytes / 1024).toFixed(1);

			notificationService.info(localize('zonecog.persistenceStatsMsg',
				'Hypergraph Persistence (IndexedDB):\nDB ready: {0}\nStored nodes: {1}\nStored links: {2}\nSnapshots: {3}\nEst. size: {4} KB\nLast save: {5}\nLast load: {6}\nAuto-save: {7}',
				stats.databaseReady ? 'Yes' : 'No',
				stats.storedNodeCount,
				stats.storedLinkCount,
				stats.snapshotCount,
				sizeKb,
				lastSave,
				lastLoad,
				persistenceService.isAutoSaveEnabled() ? 'Enabled' : 'Disabled'
			));
		} catch (err) {
			notificationService.error(localize('zonecog.persistenceStatsError',
				'Failed to get persistence stats: {0}', err instanceof Error ? err.message : String(err)));
		}
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
registerAction2(ZoneCogDetectInteractionPatternsAction);

// Phase 4 actions
registerAction2(ZoneCogDTESNForwardAction);
registerAction2(ZoneCogDTESNStatusAction);
registerAction2(ZoneCogAAROrchestrationAction);
registerAction2(ZoneCogAARArenaStatusAction);
registerAction2(ZoneCogPersistenceSaveAction);
registerAction2(ZoneCogPersistenceLoadAction);
registerAction2(ZoneCogPersistenceStatsAction);

// =============================================================================
// Phase 5 actions - Schema Perception, Aphrodite Engine
// =============================================================================

/**
 * Action to perceive a database schema through the embodied cognition interface
 */
class ZoneCogPerceiveSchemaAction extends Action2 {

	static ID = 'zonecog.perceiveSchema';
	constructor() {
		super({
			id: ZoneCogPerceiveSchemaAction.ID,
			title: { value: localize('zonecog.perceiveSchema', 'Perceive Database Schema'), original: 'Perceive Database Schema' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.database,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const schemaService = accessor.get(ISchemaPerceptionService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const connectionUri = await quickInputService.input({
			prompt: localize('zonecog.schemaConnectionPrompt', 'Enter connection URI to perceive'),
			placeHolder: localize('zonecog.schemaConnectionPlaceholder', 'e.g., mssql://localhost/AdventureWorks'),
		});

		if (!connectionUri) { return; }

		try {
			notificationService.info(localize('zonecog.perceivingSchema', 'Perceiving schema for: {0}...', connectionUri));

			const elements = await schemaService.perceiveSchema(connectionUri);

			const tables = elements.filter(e => e.elementType === 'table').length;
			const views = elements.filter(e => e.elementType === 'view').length;
			const columns = elements.filter(e => e.elementType === 'column').length;

			notificationService.info(localize('zonecog.schemaPerceived',
				'Schema Perceived:\nElements: {0}\nTables: {1}\nViews: {2}\nColumns: {3}',
				elements.length, tables, views, columns
			));
		} catch (err) {
			notificationService.error(localize('zonecog.perceiveSchemaError',
				'Failed to perceive schema: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to view schema perception statistics
 */
class ZoneCogSchemaStatsAction extends Action2 {

	static ID = 'zonecog.schemaStats';
	constructor() {
		super({
			id: ZoneCogSchemaStatsAction.ID,
			title: { value: localize('zonecog.schemaStats', 'Show Schema Perception Stats'), original: 'Show Schema Perception Stats' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.graphScatter,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const schemaService = accessor.get(ISchemaPerceptionService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const connectionUri = await quickInputService.input({
			prompt: localize('zonecog.schemaStatsPrompt', 'Enter connection URI for stats'),
			placeHolder: localize('zonecog.schemaStatsPlaceholder', 'e.g., mssql://localhost/AdventureWorks'),
		});

		if (!connectionUri) { return; }

		const stats = schemaService.getQueryStatistics(connectionUri);
		const elements = schemaService.getPerceivedElements(connectionUri);

		const frequentTables = stats.frequentTables.slice(0, 5)
			.map(t => `  ${t.table}: ${t.accessCount} accesses`)
			.join('\n');

		notificationService.info(localize('zonecog.schemaStatsInfo',
			'Schema Perception Stats for {0}:\nTotal Elements: {1}\nQueries Observed: {2}\nSuccess Rate: {3}%\nAvg Duration: {4}ms\n\nMost Accessed Tables:\n{5}',
			connectionUri,
			elements.length,
			stats.totalQueries,
			stats.totalQueries > 0 ? Math.round((stats.successfulQueries / stats.totalQueries) * 100) : 0,
			Math.round(stats.averageDurationMs),
			frequentTables || '  (none)'
		));
	}
}

/**
 * Action to register schema elements in the hypergraph
 */
class ZoneCogRegisterSchemaInHypergraphAction extends Action2 {

	static ID = 'zonecog.registerSchemaHypergraph';
	constructor() {
		super({
			id: ZoneCogRegisterSchemaInHypergraphAction.ID,
			title: { value: localize('zonecog.registerSchemaHypergraph', 'Register Schema in Hypergraph'), original: 'Register Schema in Hypergraph' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.symbolStructure,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const schemaService = accessor.get(ISchemaPerceptionService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const connectionUri = await quickInputService.input({
			prompt: localize('zonecog.registerSchemaPrompt', 'Enter connection URI to register'),
			placeHolder: localize('zonecog.registerSchemaPlaceholder', 'e.g., mssql://localhost/AdventureWorks'),
		});

		if (!connectionUri) { return; }

		try {
			const nodeCount = await schemaService.registerSchemaInHypergraph(connectionUri);
			notificationService.info(localize('zonecog.schemaRegistered',
				'Schema registered in hypergraph: {0} nodes created', nodeCount));
		} catch (err) {
			notificationService.error(localize('zonecog.registerSchemaError',
				'Failed to register schema: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to connect to Aphrodite LLM engine
 */
class ZoneCogAphroditeConnectAction extends Action2 {

	static ID = 'zonecog.aphroditeConnect';
	constructor() {
		super({
			id: ZoneCogAphroditeConnectAction.ID,
			title: { value: localize('zonecog.aphroditeConnect', 'Connect to Aphrodite Engine'), original: 'Connect to Aphrodite Engine' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.vm,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aphroditeService = accessor.get(IAphroditeService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const baseUrl = await quickInputService.input({
			prompt: localize('zonecog.aphroditeUrlPrompt', 'Enter Aphrodite API URL'),
			placeHolder: 'http://localhost:2242',
			value: 'http://localhost:2242',
		});

		if (!baseUrl) { return; }

		try {
			await aphroditeService.initialize({ baseUrl });

			if (aphroditeService.isConnected()) {
				const models = await aphroditeService.listModels();
				const modelList = models.slice(0, 5).map(m => m.id).join(', ');

				notificationService.info(localize('zonecog.aphroditeConnected',
					'Connected to Aphrodite Engine at {0}\nAvailable models: {1}',
					baseUrl, modelList || '(none)'
				));
			} else {
				notificationService.warn(localize('zonecog.aphroditeNotConnected',
					'Aphrodite Engine not available at {0}', baseUrl));
			}
		} catch (err) {
			notificationService.error(localize('zonecog.aphroditeConnectError',
				'Failed to connect to Aphrodite: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to view Aphrodite engine status and stats
 */
class ZoneCogAphroditeStatusAction extends Action2 {

	static ID = 'zonecog.aphroditeStatus';
	constructor() {
		super({
			id: ZoneCogAphroditeStatusAction.ID,
			title: { value: localize('zonecog.aphroditeStatus', 'Show Aphrodite Engine Status'), original: 'Show Aphrodite Engine Status' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.serverProcess,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aphroditeService = accessor.get(IAphroditeService);
		const notificationService = accessor.get(INotificationService);

		const connected = aphroditeService.isConnected();
		const config = aphroditeService.getConfig();

		if (!connected) {
			notificationService.info(localize('zonecog.aphroditeDisconnected',
				'Aphrodite Engine: Not connected\nConfigured URL: {0}\nModel: {1}',
				config.baseUrl, config.model
			));
			return;
		}

		try {
			const stats = await aphroditeService.getStats();
			const model = await aphroditeService.getCurrentModel();

			const gpuMem = stats.gpuMemoryTotal > 0
				? `${(stats.gpuMemoryUsed / 1024 / 1024 / 1024).toFixed(1)}/${(stats.gpuMemoryTotal / 1024 / 1024 / 1024).toFixed(1)} GB`
				: 'N/A';

			notificationService.info(localize('zonecog.aphroditeStatusInfo',
				'Aphrodite Engine Status:\nConnected: Yes\nModel: {0}\nContext Length: {1}\nTokens/sec: {2}\nActive Requests: {3}\nQueued: {4}\nGPU Memory: {5}\nGPU Util: {6}%',
				model?.name || 'Unknown',
				model?.contextLength || 'Unknown',
				stats.tokensPerSecond.toFixed(1),
				stats.activeRequests,
				stats.queuedRequests,
				gpuMem,
				stats.gpuUtilization.toFixed(1)
			));
		} catch (err) {
			notificationService.error(localize('zonecog.aphroditeStatusError',
				'Failed to get Aphrodite stats: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to run a completion through Aphrodite
 */
class ZoneCogAphroditeCompleteAction extends Action2 {

	static ID = 'zonecog.aphroditeComplete';
	constructor() {
		super({
			id: ZoneCogAphroditeCompleteAction.ID,
			title: { value: localize('zonecog.aphroditeComplete', 'Run Aphrodite Completion'), original: 'Run Aphrodite Completion' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.sparkle,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aphroditeService = accessor.get(IAphroditeService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		if (!aphroditeService.isConnected()) {
			notificationService.warn(localize('zonecog.aphroditeNotConnectedWarn',
				'Aphrodite Engine is not connected. Use "Connect to Aphrodite Engine" first.'));
			return;
		}

		const prompt = await quickInputService.input({
			prompt: localize('zonecog.aphroditePrompt', 'Enter prompt for Aphrodite'),
			placeHolder: localize('zonecog.aphroditePlaceholder', 'e.g., "Explain this SQL query..."'),
		});

		if (!prompt) { return; }

		try {
			notificationService.info(localize('zonecog.aphroditeProcessing', 'Processing...'));

			const response = await aphroditeService.complete({
				prompt,
				maxTokens: 256,
			});

			notificationService.info(localize('zonecog.aphroditeResponse',
				'Aphrodite Response:\n{0}\n\nTokens: {1} prompt + {2} completion\nTime: {3}ms',
				response.text.substring(0, 500) + (response.text.length > 500 ? '...' : ''),
				response.promptTokens,
				response.completionTokens,
				response.generationTimeMs
			));
		} catch (err) {
			notificationService.error(localize('zonecog.aphroditeCompleteError',
				'Aphrodite completion failed: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

// =============================================================================
// Phase 6 actions - Cognitive Workflow Automation
// =============================================================================

/**
 * Action to list all registered workflows
 */
class ZoneCogListWorkflowsAction extends Action2 {

	static ID = 'zonecog.listWorkflows';
	constructor() {
		super({
			id: ZoneCogListWorkflowsAction.ID,
			title: { value: localize('zonecog.listWorkflows', 'List Cognitive Workflows'), original: 'List Cognitive Workflows' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.listTree,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workflowService = accessor.get(ICognitiveWorkflowAutomationService);
		const notificationService = accessor.get(INotificationService);

		const workflows = workflowService.getWorkflows();

		if (workflows.length === 0) {
			notificationService.info(localize('zonecog.noWorkflows', 'No cognitive workflows registered.'));
			return;
		}

		const workflowList = workflows.map(w =>
			`  [${w.enabled ? 'ON' : 'OFF'}] ${w.definition.id} - ${w.definition.name}\n` +
			`       Executions: ${w.executionCount} (${w.successCount} successful)`
		).join('\n');

		notificationService.info(localize('zonecog.workflowList',
			'Registered Cognitive Workflows ({0}):\n{1}',
			workflows.length, workflowList
		));
	}
}

/**
 * Action to execute a workflow
 */
class ZoneCogExecuteWorkflowAction extends Action2 {

	static ID = 'zonecog.executeWorkflow';
	constructor() {
		super({
			id: ZoneCogExecuteWorkflowAction.ID,
			title: { value: localize('zonecog.executeWorkflow', 'Execute Cognitive Workflow'), original: 'Execute Cognitive Workflow' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.run,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workflowService = accessor.get(ICognitiveWorkflowAutomationService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const workflows = workflowService.getWorkflows().filter(w => w.enabled);

		if (workflows.length === 0) {
			notificationService.info(localize('zonecog.noEnabledWorkflows', 'No enabled workflows available.'));
			return;
		}

		const items = workflows.map(w => ({
			label: w.definition.name,
			description: w.definition.id,
			detail: w.definition.description,
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('zonecog.selectWorkflow', 'Select a workflow to execute'),
		});

		if (!selected) { return; }

		const workflowId = selected.description!;

		try {
			notificationService.info(localize('zonecog.workflowStarting',
				'Starting workflow: {0}...', selected.label));

			const result = await workflowService.executeWorkflow(workflowId);

			// allow-any-unicode-next-line
			const statusIcon = result.success ? '✓' : '✗';
			notificationService.info(localize('zonecog.workflowResult',
				'Workflow {0} {1}\n{2}\nDuration: {3}ms',
				statusIcon,
				result.success ? 'completed' : 'failed',
				result.summary,
				result.durationMs
			));
		} catch (err) {
			notificationService.error(localize('zonecog.workflowError',
				'Workflow execution failed: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to view workflow execution history
 */
class ZoneCogWorkflowHistoryAction extends Action2 {

	static ID = 'zonecog.workflowHistory';
	constructor() {
		super({
			id: ZoneCogWorkflowHistoryAction.ID,
			title: { value: localize('zonecog.workflowHistory', 'Show Workflow Execution History'), original: 'Show Workflow Execution History' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.history,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workflowService = accessor.get(ICognitiveWorkflowAutomationService);
		const notificationService = accessor.get(INotificationService);

		const history = workflowService.getExecutionHistory(undefined, 10);

		if (history.length === 0) {
			notificationService.info(localize('zonecog.noWorkflowHistory', 'No workflow executions in history.'));
			return;
		}

		const historyLines = history.map((exec, i) => {
			const duration = exec.endTime ? exec.endTime - exec.startTime : 0;
			// allow-any-unicode-next-line
			const statusIcon = exec.status === 'completed' ? '✓' : exec.status === 'failed' ? '✗' : '○';
			return `${i + 1}. ${statusIcon} ${exec.workflowId} - ${exec.status} (${duration}ms, ${new Date(exec.startTime).toLocaleTimeString()})`;
		}).join('\n');

		notificationService.info(localize('zonecog.workflowHistoryList',
			'Recent Workflow Executions:\n{0}', historyLines));
	}
}

/**
 * Action to toggle a workflow enabled/disabled
 */
class ZoneCogToggleWorkflowAction extends Action2 {

	static ID = 'zonecog.toggleWorkflow';
	constructor() {
		super({
			id: ZoneCogToggleWorkflowAction.ID,
			title: { value: localize('zonecog.toggleWorkflow', 'Toggle Workflow Enabled'), original: 'Toggle Workflow Enabled' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.gear,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workflowService = accessor.get(ICognitiveWorkflowAutomationService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const workflows = workflowService.getWorkflows();

		if (workflows.length === 0) {
			notificationService.info(localize('zonecog.noWorkflowsToToggle', 'No workflows available.'));
			return;
		}

		const items = workflows.map(w => ({
			label: `${w.enabled ? '$(check)' : '$(circle-outline)'} ${w.definition.name}`,
			description: w.definition.id,
			detail: w.enabled ? 'Currently enabled' : 'Currently disabled',
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('zonecog.selectWorkflowToggle', 'Select a workflow to toggle'),
		});

		if (!selected) { return; }

		const workflowId = selected.description!;
		const workflow = workflowService.getWorkflow(workflowId);
		if (!workflow) { return; }

		const newState = !workflow.enabled;
		workflowService.setWorkflowEnabled(workflowId, newState);

		notificationService.info(localize('zonecog.workflowToggled',
			'Workflow "{0}" is now {1}',
			workflow.definition.name,
			newState ? 'enabled' : 'disabled'
		));
	}
}

// Phase 5 actions
registerAction2(ZoneCogPerceiveSchemaAction);
registerAction2(ZoneCogSchemaStatsAction);
registerAction2(ZoneCogRegisterSchemaInHypergraphAction);
registerAction2(ZoneCogAphroditeConnectAction);
registerAction2(ZoneCogAphroditeStatusAction);
registerAction2(ZoneCogAphroditeCompleteAction);

// Phase 6 actions
registerAction2(ZoneCogListWorkflowsAction);
registerAction2(ZoneCogExecuteWorkflowAction);
registerAction2(ZoneCogWorkflowHistoryAction);
registerAction2(ZoneCogToggleWorkflowAction);

// =============================================================================
// Phase 7 actions - AGI Studio
// =============================================================================

/**
 * Action to start an AGI Studio autonomous run
 */
class ZoneCogAgiStudioStartRunAction extends Action2 {

	static ID = 'zonecog.agiStudio.startRun';
	constructor() {
		super({
			id: ZoneCogAgiStudioStartRunAction.ID,
			title: { value: localize('zonecog.agiStudio.startRun', 'AGI Studio: Start Autonomous Run'), original: 'AGI Studio: Start Autonomous Run' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.play,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agiStudioService = accessor.get(IAgiStudioService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const goal = await quickInputService.input({
			prompt: localize('zonecog.agiStudio.goalPrompt', 'Enter a goal for the AGI Studio autonomous agent'),
			placeHolder: localize('zonecog.agiStudio.goalPlaceholder', 'e.g., "Analyze SQL query patterns and identify performance improvements"'),
		});

		if (!goal) {
			return;
		}

		try {
			const run = await agiStudioService.startRun(goal);
			notificationService.info(localize('zonecog.agiStudio.runStarted',
				'AGI Studio run started.\nRun ID: {0}\nGoal: {1}\nRoot Agent: {2}',
				run.id.slice(-12),
				run.goal.slice(0, 80),
				run.rootAgentId.slice(-12)
			));
		} catch (err) {
			notificationService.error(localize('zonecog.agiStudio.runError',
				'Failed to start AGI Studio run: {0}', err instanceof Error ? err.message : String(err)));
		}
	}
}

/**
 * Action to show AGI Studio run and agent-tree status
 */
class ZoneCogAgiStudioShowStatusAction extends Action2 {

	static ID = 'zonecog.agiStudio.showStatus';
	constructor() {
		super({
			id: ZoneCogAgiStudioShowStatusAction.ID,
			title: { value: localize('zonecog.agiStudio.showStatus', 'AGI Studio: Show Run Status'), original: 'AGI Studio: Show Run Status' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.organization,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agiStudioService = accessor.get(IAgiStudioService);
		const notificationService = accessor.get(INotificationService);

		const activeRun = agiStudioService.getActiveRun();
		const allRuns = agiStudioService.getRuns();

		if (!activeRun && allRuns.length === 0) {
			notificationService.info(localize('zonecog.agiStudio.noRuns',
				'AGI Studio: No runs yet. Use "AGI Studio: Start Autonomous Run" to begin.'));
			return;
		}

		const runId = activeRun?.id ?? allRuns[0].id;
		const run = activeRun ?? allRuns[0];

		const agents = agiStudioService.getAgents(runId);
		const messages = agiStudioService.getMessages(runId);
		const toolCalls = agiStudioService.getToolCalls(runId);

		const agentTree = agents.map(a => {
			const indent = '  '.repeat(a.depth);
			return `${indent}[${a.role}] ${a.name} - ${a.status}`;
		}).join('\n');

		const recentMessages = messages.slice(-5).map(m =>
			`  [${m.messageType}] ${m.fromAgentId.slice(-8)} → ${m.toAgentId.slice(-8)}: ${m.content.slice(0, 60)}`
		).join('\n');

		notificationService.info(localize('zonecog.agiStudio.statusReport',
			'AGI Studio Status:\nRun: {0} ({1})\nGoal: {2}\nAgents: {3}\nMessages: {4}\nTool Calls: {5}\n\nAgent Tree:\n{6}\n\nRecent Messages:\n{7}',
			run.id.slice(-12),
			run.status,
			run.goal.slice(0, 60),
			agents.length,
			messages.length,
			toolCalls.length,
			agentTree || '  (none)',
			recentMessages || '  (none)'
		));
	}
}

/**
 * Action to stop the current AGI Studio run
 */
class ZoneCogAgiStudioStopRunAction extends Action2 {

	static ID = 'zonecog.agiStudio.stopRun';
	constructor() {
		super({
			id: ZoneCogAgiStudioStopRunAction.ID,
			title: { value: localize('zonecog.agiStudio.stopRun', 'AGI Studio: Stop Current Run'), original: 'AGI Studio: Stop Current Run' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.debugStop,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agiStudioService = accessor.get(IAgiStudioService);
		const notificationService = accessor.get(INotificationService);

		const activeRun = agiStudioService.getActiveRun();

		if (!activeRun) {
			notificationService.info(localize('zonecog.agiStudio.noActiveRun',
				'AGI Studio: No active run to stop.'));
			return;
		}

		agiStudioService.stopRun(activeRun.id);
		notificationService.info(localize('zonecog.agiStudio.runStopped',
			'AGI Studio run stopped.\nRun ID: {0}\nGoal: {1}',
			activeRun.id.slice(-12),
			activeRun.goal.slice(0, 80)
		));
	}
}

// Phase 7 actions
registerAction2(ZoneCogAgiStudioStartRunAction);
registerAction2(ZoneCogAgiStudioShowStatusAction);
registerAction2(ZoneCogAgiStudioStopRunAction);

// ============================================================================
// Phase 3.4 Actions: Cognitive Provenance and Schema Evolution
// ============================================================================

/**
 * Action to show the cognitive decision audit trail
 */
class ZoneCogAuditTrailAction extends Action2 {

	static ID = 'zonecog.auditTrail';
	constructor() {
		super({
			id: ZoneCogAuditTrailAction.ID,
			title: { value: localize('zonecog.auditTrail', 'Show Cognitive Audit Trail'), original: 'Show Cognitive Audit Trail' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.law,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const provenanceService = accessor.get(ICognitiveProvenanceService);
		const notificationService = accessor.get(INotificationService);

		const decisions = provenanceService.getAuditTrail({ limit: 10 });
		if (decisions.length === 0) {
			notificationService.info(localize('zonecog.auditTrailEmpty',
				'Cognitive Audit Trail: no decisions recorded yet ({0} total).',
				provenanceService.getDecisionCount()));
			return;
		}

		const lines = decisions.map(d =>
			`  [${new Date(d.timestamp).toISOString()}] ${d.actor} / ${d.decisionType}: ${d.summary} (confidence ${Math.round(d.confidence * 100)}%, ${d.evidenceNodeIds.length} evidence)`
		).join('\n');

		notificationService.info(localize('zonecog.auditTrailInfo',
			'Cognitive Audit Trail ({0} decisions retained, showing most recent {1}):\n{2}',
			provenanceService.getDecisionCount(),
			decisions.length,
			lines
		));
	}
}

/**
 * Action to show the schema evolution history for a connection
 */
class ZoneCogSchemaEvolutionAction extends Action2 {

	static ID = 'zonecog.schemaEvolution';
	constructor() {
		super({
			id: ZoneCogSchemaEvolutionAction.ID,
			title: { value: localize('zonecog.schemaEvolution', 'Show Schema Evolution History'), original: 'Show Schema Evolution History' },
			category: ZONECOG_CATEGORY,
			icon: Codicon.history,
			f1: true,
			menu: { id: MenuId.CommandPalette },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const evolutionService = accessor.get(ISchemaEvolutionService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const tracked = evolutionService.getTrackedConnections();
		if (tracked.length === 0) {
			notificationService.info(localize('zonecog.schemaEvolutionNone',
				'Schema Evolution: no connections are tracked yet. Perceive a schema first.'));
			return;
		}

		const connectionUri = await quickInputService.pick(
			tracked.map(uri => ({ label: uri })),
			{ placeHolder: localize('zonecog.schemaEvolutionPick', 'Select a tracked connection') }
		);
		if (!connectionUri) { return; }

		const info = evolutionService.getSnapshotInfo(connectionUri.label);
		const changes = evolutionService.getChangeHistory(connectionUri.label, 10);
		const lines = changes.map(c =>
			`  [${new Date(c.detectedAt).toISOString()}] ${c.changeType}: ${c.qualifiedName} (${c.elementType})`
		).join('\n');

		notificationService.info(localize('zonecog.schemaEvolutionInfo',
			'Schema Evolution for {0}:\nSnapshots: {1}\nElements: {2}\nRecent Changes:\n{3}',
			connectionUri.label,
			info ? info.snapshotCount : 0,
			info ? info.elementCount : 0,
			lines || localize('zonecog.schemaEvolutionNoChanges', '  (no changes detected since baseline)')
		));
	}
}

// Phase 3.4 actions
registerAction2(ZoneCogAuditTrailAction);
registerAction2(ZoneCogSchemaEvolutionAction);

// Register the cognitive loop status bar contribution so the loop state is
// always visible in the workbench status bar.
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(CognitiveLoopStatusBarContribution, LifecyclePhase.Restored);
