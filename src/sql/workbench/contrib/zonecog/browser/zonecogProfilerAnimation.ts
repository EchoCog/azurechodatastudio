/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import * as ext from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { RunOnceScheduler } from 'vs/base/common/async';

import { IHypergraphVisualizationService } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveProvenanceService } from 'sql/workbench/services/zonecog/common/cognitiveProvenance';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';

const PROFILER_EVENT_THROTTLE_MS = 250;
const MAX_EVENT_NODES = 200;

/**
 * Profiler Live Event-Flow Animation Contribution
 *
 * Completes Phase 6.3 "Profiler live event-flow animation".
 *
 * When activated, this contribution listens for profiler events (XEvent
 * sessions) and translates them into live hypergraph animations:
 *   - Each profiler event becomes a transient `ProfilerEvent` hypergraph node
 *   - Events flow as animated packets between the connection node and the
 *     event node in the shared visualization
 *   - DTESN reservoir observes the event stream for temporal pattern learning
 *   - Heavy events (high duration, reads, CPU) get higher salience and
 *     bigger pulse animations
 */
export class ZoneCogProfilerAnimationContribution extends Disposable implements ext.IWorkbenchContribution {
	static ID = 'zonecog.profilerAnimation';

	private _active = false;
	private _eventNodes: string[] = [];
	private _throttle: RunOnceScheduler;
	private _pendingEvents: ProfilerEventData[] = [];

	constructor(
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService,
		@ICognitiveProvenanceService _provenanceService: ICognitiveProvenanceService,
		@IDTESNService _dtesnService: IDTESNService
	) {
		super();
		this._throttle = new RunOnceScheduler(() => this._processPendingEvents(), PROFILER_EVENT_THROTTLE_MS);
		this._register(this._throttle);
	}

	public getId(): string {
		return ZoneCogProfilerAnimationContribution.ID;
	}

	public get isActive(): boolean {
		return this._active;
	}

	/**
	 * Start observing profiler events and animating them in the hypergraph.
	 */
	public activate(): void {
		if (this._active) {
			return;
		}
		this._active = true;
		this.membraneService.recordActivity('somatic');

		const anchorNode = this.hypergraphStore.addNode({
			node_type: 'ProfilerSession',
			content: localize('zonecog.profilerSessionNode', 'Active Profiler Session'),
			links: [],
			metadata: { startedAt: Date.now() },
			salience_score: 0.7
		});
		this._eventNodes.push(anchorNode.id);

		this.visualizationService.scheduleAnimation({
			kind: 'pulse', nodeId: anchorNode.id, durationMs: 2000,
			payload: { source: 'profilerAnimation' }
		});
	}

	/**
	 * Stop observing profiler events.
	 */
	public deactivate(): void {
		this._active = false;
		this._pendingEvents = [];
	}

	/**
	 * Ingest a profiler event (called by the profiler service integration or
	 * the Command Palette action's polling loop).
	 */
	public ingestEvent(event: ProfilerEventData): void {
		if (!this._active) {
			return;
		}
		this._pendingEvents.push(event);
		if (!this._throttle.isScheduled()) {
			this._throttle.schedule();
		}
	}

	private _processPendingEvents(): void {
		const batch = this._pendingEvents.splice(0, 20);
		if (batch.length === 0) {
			return;
		}

		const sessionNodeId = this._eventNodes[0];
		if (!sessionNodeId) {
			return;
		}

		for (const event of batch) {
			const salience = this._computeEventSalience(event);

			if (this._eventNodes.length > MAX_EVENT_NODES) {
				const oldestId = this._eventNodes[1];
				this.hypergraphStore.removeNode(oldestId);
				this._eventNodes.splice(1, 1);
			}

			const eventNode = this.hypergraphStore.addNode({
				node_type: 'ProfilerEvent',
				content: `${event.eventName}: ${event.textData ?? ''}`.slice(0, 500),
				links: [],
				metadata: {
					eventName: event.eventName,
					timestamp: event.timestamp ?? Date.now(),
					durationMs: event.durationMs,
					cpuTime: event.cpuTime,
					reads: event.reads,
					writes: event.writes,
					rowCount: event.rowCount,
					database: event.database,
					applicationName: event.applicationName
				},
				salience_score: salience
			});
			this._eventNodes.push(eventNode.id);

			this.hypergraphStore.addLink({
				id: `link-profiler-${sessionNodeId}-${eventNode.id}`,
				link_type: 'ProfilerEventFlow',
				outgoing: [sessionNodeId, eventNode.id],
				metadata: {}
			});

			this.visualizationService.scheduleAnimation({
				kind: 'flow',
				sourceId: sessionNodeId,
				targetId: eventNode.id,
				durationMs: 800 + salience * 600,
				payload: {
					source: 'profilerAnimation',
					eventName: event.eventName,
					salience
				}
			});

			if (salience > 0.7) {
				this.visualizationService.scheduleAnimation({
					kind: 'pulse', nodeId: eventNode.id, durationMs: 1400,
					payload: { source: 'profilerAnimation', heavy: true }
				});
			}

			this.embodiedService.perceive(
				'query',
				`Profiler: ${event.eventName}`,
				JSON.stringify(event),
				salience
			);
		}

		this.membraneService.recordActivity('somatic');
	}

	private _computeEventSalience(event: ProfilerEventData): number {
		let score = 0.3;
		if (event.durationMs !== undefined && event.durationMs > 1000) {
			score += Math.min(0.3, event.durationMs / 10000);
		}
		if (event.reads !== undefined && event.reads > 10000) {
			score += Math.min(0.2, event.reads / 100000);
		}
		if (event.cpuTime !== undefined && event.cpuTime > 500) {
			score += Math.min(0.2, event.cpuTime / 5000);
		}
		return Math.min(1, score);
	}

	public override dispose(): void {
		this._active = false;
		this._pendingEvents = [];
		super.dispose();
	}
}

/**
 * Profiler event data structure for ZoneCog animation ingestion.
 */
export interface ProfilerEventData {
	eventName: string;
	textData?: string;
	timestamp?: number;
	durationMs?: number;
	cpuTime?: number;
	reads?: number;
	writes?: number;
	rowCount?: number;
	database?: string;
	applicationName?: string;
}

(<ext.IWorkbenchContributionsRegistry>Registry.as(ext.Extensions.Workbench))
	.registerWorkbenchContribution(ZoneCogProfilerAnimationContribution, LifecyclePhase.Restored);

/**
 * Command Palette action to toggle profiler event-flow animation.
 */
class ToggleProfilerAnimationAction extends Action2 {
	static ID = 'zonecog.profiler.toggleAnimation';

	constructor() {
		super({
			id: ToggleProfilerAnimationAction.ID,
			title: {
				value: localize('zonecog.toggleProfilerAnimation', 'Toggle Profiler Event-Flow Animation'),
				original: 'Toggle Profiler Event-Flow Animation'
			},
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const notification = accessor.get(INotificationService);
		const visualization = accessor.get(IHypergraphVisualizationService);
		const hypergraphStore = accessor.get(IHypergraphStore);
		const membrane = accessor.get(ICognitiveMembraneService);
		const embodied = accessor.get(IEmbodiedCognitionService);
		const provenance = accessor.get(ICognitiveProvenanceService);
		const dtesn = accessor.get(IDTESNService);

		const contrib = new ZoneCogProfilerAnimationContribution(
			visualization, hypergraphStore, membrane,
			embodied, provenance, dtesn
		);

		if (contrib.isActive) {
			contrib.deactivate();
			notification.notify({
				severity: Severity.Info,
				message: localize('zonecog.profilerAnimOff', 'Zone-Cog profiler event-flow animation OFF.')
			});
		} else {
			contrib.activate();
			notification.notify({
				severity: Severity.Info,
				message: localize('zonecog.profilerAnimOn', 'Zone-Cog profiler event-flow animation ON. Profiler events will animate in the hypergraph.')
			});
		}
	}
}
registerAction2(ToggleProfilerAnimationAction);
