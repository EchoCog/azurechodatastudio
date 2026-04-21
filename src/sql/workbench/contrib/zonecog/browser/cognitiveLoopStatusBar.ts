/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from 'vs/workbench/services/statusbar/browser/statusbar';
import { ICognitiveLoopService, CognitiveLoopState } from 'sql/workbench/services/zonecog/common/cognitiveLoop';

/**
 * Status bar contribution that surfaces the cognitive loop state in the workbench
 * status bar.
 *
 * Appearance:
 *   Stopped  — $(circle-outline) Zone-Cog
 *   Running  — $(sync~spin) Zone-Cog #<n>
 *   Paused   — $(debug-pause) Zone-Cog #<n>
 *
 * Clicking the item triggers the `zonecog.toggleCognitiveLoop` command so the
 * user can start, stop, or resume the loop directly from the status bar.
 */
export class CognitiveLoopStatusBarContribution extends Disposable implements IWorkbenchContribution {

	/** Unique status bar entry ID. */
	private static readonly ENTRY_ID = 'status.zonecog.cognitiveLoop';

	/** Command invoked when the status bar item is clicked. */
	private static readonly TOGGLE_COMMAND = 'zonecog.toggleCognitiveLoop';

	private readonly _name = localize('status.zonecog.cognitiveLoop.name', 'Zone-Cog Cognitive Loop');
	private readonly _statusItem: IStatusbarEntryAccessor;

	constructor(
		@IStatusbarService statusbarService: IStatusbarService,
		@ICognitiveLoopService private readonly _loopService: ICognitiveLoopService
	) {
		super();

		// Register the permanent status bar entry.  The text / tooltip are
		// updated reactively below; the entry is always visible so the user
		// can always see the loop state and click to toggle it.
		this._statusItem = this._register(
			statusbarService.addEntry(
				{
					name: this._name,
					text: this._stoppedText(),
					ariaLabel: localize('status.zonecog.stopped.aria', 'Zone-Cog Cognitive Loop: Stopped'),
					command: CognitiveLoopStatusBarContribution.TOGGLE_COMMAND,
					tooltip: this._stoppedTooltip(0),
				},
				CognitiveLoopStatusBarContribution.ENTRY_ID,
				StatusbarAlignment.LEFT,
				-1000  // Low priority — appears towards the right end of left-aligned items
			)
		);

		// Update on every state transition (start / stop / pause / resume)
		this._register(this._loopService.onDidChangeState(state => this._update(state)));

		// Also update on every completed iteration so the iteration counter stays current
		this._register(this._loopService.onDidCompleteIteration(() => {
			this._update(this._loopService.getState());
		}));

		// Initialise with the current state (service may already be running)
		this._update(this._loopService.getState());
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private _update(state: CognitiveLoopState): void {
		let text: string;
		let ariaLabel: string;
		let tooltip: string;

		if (state.running && !state.paused) {
			text = `$(sync~spin) Zone-Cog #${state.totalIterations}`;
			ariaLabel = localize(
				'status.zonecog.running.aria',
				'Zone-Cog Cognitive Loop: Running, iteration {0}',
				state.totalIterations
			);
			tooltip = localize(
				'status.zonecog.running.tooltip',
				'Zone-Cog Cognitive Loop: Running\nIteration: {0}  |  Avg: {1}ms  |  Interval: {2}ms\nClick to stop',
				state.totalIterations,
				state.averageIterationMs,
				state.tickIntervalMs
			);
		} else if (state.paused) {
			text = `$(debug-pause) Zone-Cog #${state.totalIterations}`;
			ariaLabel = localize(
				'status.zonecog.paused.aria',
				'Zone-Cog Cognitive Loop: Paused at iteration {0}',
				state.totalIterations
			);
			tooltip = localize(
				'status.zonecog.paused.tooltip',
				'Zone-Cog Cognitive Loop: Paused\nIterations completed: {0}  |  Avg: {1}ms\nClick to resume',
				state.totalIterations,
				state.averageIterationMs
			);
		} else {
			text = this._stoppedText();
			ariaLabel = localize('status.zonecog.stopped.aria', 'Zone-Cog Cognitive Loop: Stopped');
			tooltip = this._stoppedTooltip(state.totalIterations);
		}

		this._statusItem.update({
			name: this._name,
			text,
			ariaLabel,
			tooltip,
			command: CognitiveLoopStatusBarContribution.TOGGLE_COMMAND,
		});
	}

	private _stoppedText(): string {
		return '$(circle-outline) Zone-Cog';
	}

	private _stoppedTooltip(iterationCount: number): string {
		if (iterationCount === 0) {
			return localize(
				'status.zonecog.stopped.tooltip.zero',
				'Zone-Cog Cognitive Loop: Stopped\nClick to start the perceive → attend → think → act → reflect cycle'
			);
		}
		return localize(
			'status.zonecog.stopped.tooltip',
			'Zone-Cog Cognitive Loop: Stopped\nCompleted: {0} iteration{1}\nClick to restart',
			iterationCount,
			iterationCount !== 1 ? 's' : ''
		);
	}
}
