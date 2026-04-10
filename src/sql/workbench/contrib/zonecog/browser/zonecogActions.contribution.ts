/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IZoneCogService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
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
			icon: Codicon.brain,
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

			// Also log the thinking process for development purposes
			if (response.thinking) {
				console.log('Zone-Cog Thinking Process:', response.thinking);
				console.log('Zone-Cog Phases:', response.phases.map(p => p.name).join(' → '));
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
 * Action to show Zone-Cog status including membrane and hypergraph info
 */
class ZoneCogStatusAction extends Action2 {

	static ID = 'zonecog.status';
	static LABEL = localize('zonecog.status', 'Show Zone-Cog Status');

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
		const notificationService = accessor.get(INotificationService);

		const state = zonecogService.getCognitiveState();

		const message = localize('zonecog.statusInfo',
			'Zone-Cog Status:\nInitialized: {0}\nThinking Mode: {1}\nCognitive Load: {2}%\nHypergraph Nodes: {3}\nMembrane Health: {4}\nContext: {5}',
			state.isInitialized ? 'Yes' : 'No',
			state.thinkingModeEnabled ? 'Enabled' : 'Disabled',
			Math.round(state.cognitiveLoad * 100),
			state.hypergraphNodeCount,
			state.membraneHealthy ? 'Healthy' : 'Degraded',
			state.currentContext || 'None'
		);

		notificationService.info(message);
	}
}

// Register all actions
registerAction2(ZoneCogTestAction);
registerAction2(ZoneCogToggleThinkingAction);
registerAction2(ZoneCogStatusAction);
