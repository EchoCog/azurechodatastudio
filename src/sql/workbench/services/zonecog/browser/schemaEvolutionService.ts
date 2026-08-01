/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ISchemaEvolutionService,
	SchemaChange,
	SchemaChangeType,
	SchemaSnapshotInfo,
	SchemaEvolutionEvent
} from 'sql/workbench/services/zonecog/common/schemaEvolution';
import { ISchemaPerceptionService, PerceivedSchemaElement } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/** Maximum number of changes retained per connection in the bounded history. */
const MAX_CHANGES_PER_CONNECTION = 500;

/** Node type used for persisted schema changes in the hypergraph store. */
const CHANGE_NODE_TYPE = 'SchemaChange';

/** Salience assigned to persisted change nodes per change type. */
const CHANGE_SALIENCE: Record<SchemaChangeType, number> = {
	added: 0.6,
	removed: 0.7,
	modified: 0.5
};

interface ConnectionState {
	snapshot: Map<string, PerceivedSchemaElement>;
	takenAt: number;
	snapshotCount: number;
	changes: SchemaChange[];
}

/**
 * Implementation of the Schema Evolution service.
 *
 * Diffs successive schema perceptions per connection to detect added,
 * removed, and modified elements, retains a bounded change history, and
 * persists every change as a SchemaChange hypergraph node. Self-wires to
 * `ISchemaPerceptionService.onDidPerceiveSchema` so schema perception feeds
 * evolution tracking automatically.
 */
export class SchemaEvolutionService extends Disposable implements ISchemaEvolutionService {

	declare readonly _serviceBrand: undefined;

	private readonly _connections = new Map<string, ConnectionState>();
	private _changeCounter = 0;

	private readonly _onDidDetectSchemaChanges = this._register(new Emitter<SchemaEvolutionEvent>());
	readonly onDidDetectSchemaChanges: Event<SchemaEvolutionEvent> = this._onDidDetectSchemaChanges.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@ISchemaPerceptionService schemaPerceptionService: ISchemaPerceptionService
	) {
		super();
		this._register(schemaPerceptionService.onDidPerceiveSchema(event => {
			if (event.type === 'discovered' || event.type === 'updated') {
				this.recordSnapshot(event.connectionUri, event.elements);
			}
		}));
		this.logService.info('SchemaEvolutionService: initialized schema evolution tracking');
	}

	// -- Snapshot recording & diffing ---------------------------------------------

	recordSnapshot(connectionUri: string, elements: PerceivedSchemaElement[]): SchemaChange[] {
		this.membraneService.recordActivity('somatic');

		const now = Date.now();
		const newSnapshot = new Map<string, PerceivedSchemaElement>();
		for (const element of elements) {
			newSnapshot.set(element.id, element);
		}

		const state = this._connections.get(connectionUri);
		if (!state) {
			// First snapshot establishes the baseline; no evolution to report.
			this._connections.set(connectionUri, {
				snapshot: newSnapshot,
				takenAt: now,
				snapshotCount: 1,
				changes: []
			});
			this.logService.info(`SchemaEvolutionService: baseline snapshot for ${connectionUri} (${elements.length} elements)`);
			return [];
		}

		const changes: SchemaChange[] = [];
		for (const [id, element] of newSnapshot) {
			const previous = state.snapshot.get(id);
			if (!previous) {
				changes.push(this._buildChange('added', element, now, undefined, element));
			} else if (this._elementFingerprint(previous) !== this._elementFingerprint(element)) {
				changes.push(this._buildChange('modified', element, now, previous, element));
			}
		}
		for (const [id, previous] of state.snapshot) {
			if (!newSnapshot.has(id)) {
				changes.push(this._buildChange('removed', previous, now, previous, undefined));
			}
		}

		state.snapshot = newSnapshot;
		state.takenAt = now;
		state.snapshotCount++;

		if (changes.length > 0) {
			for (const change of changes) {
				state.changes.push(change);
				this._persistChange(change);
			}
			while (state.changes.length > MAX_CHANGES_PER_CONNECTION) {
				const evicted = state.changes.shift();
				if (evicted) {
					this.hypergraphStore.removeNode(evicted.id);
				}
			}
			this.logService.info(`SchemaEvolutionService: detected ${changes.length} schema change(s) for ${connectionUri}`);
			this._onDidDetectSchemaChanges.fire({ connectionUri, changes });
		}
		return changes;
	}

	// -- Queries ---------------------------------------------------------------------

	getChangeHistory(connectionUri: string, limit?: number): SchemaChange[] {
		const state = this._connections.get(connectionUri);
		if (!state) {
			return [];
		}
		const history = state.changes.slice().reverse();
		return limit !== undefined && limit >= 0 ? history.slice(0, limit) : history;
	}

	getSnapshotInfo(connectionUri: string): SchemaSnapshotInfo | undefined {
		const state = this._connections.get(connectionUri);
		if (!state) {
			return undefined;
		}
		return {
			connectionUri,
			takenAt: state.takenAt,
			elementCount: state.snapshot.size,
			snapshotCount: state.snapshotCount
		};
	}

	getTrackedConnections(): string[] {
		return Array.from(this._connections.keys());
	}

	// -- Lifecycle ---------------------------------------------------------------------

	clear(connectionUri?: string): void {
		const uris = connectionUri !== undefined ? [connectionUri] : Array.from(this._connections.keys());
		for (const uri of uris) {
			const state = this._connections.get(uri);
			if (state) {
				for (const change of state.changes) {
					this.hypergraphStore.removeNode(change.id);
				}
				this._connections.delete(uri);
			}
		}
		this.logService.info(`SchemaEvolutionService: cleared evolution tracking for ${connectionUri ?? 'all connections'}`);
	}

	// -- Internals ------------------------------------------------------------------------

	private _buildChange(
		changeType: SchemaChangeType,
		element: PerceivedSchemaElement,
		detectedAt: number,
		before: PerceivedSchemaElement | undefined,
		after: PerceivedSchemaElement | undefined
	): SchemaChange {
		return {
			id: `schemachange-${detectedAt}-${++this._changeCounter}`,
			changeType,
			elementId: element.id,
			elementType: element.elementType,
			qualifiedName: element.qualifiedName,
			connectionUri: element.connectionUri,
			detectedAt,
			before: before !== undefined ? this._elementFingerprint(before) : undefined,
			after: after !== undefined ? this._elementFingerprint(after) : undefined
		};
	}

	/**
	 * Canonical JSON fingerprint of the evolution-relevant element state.
	 * Excludes `perceivedAt` so re-perceiving an unchanged element is not
	 * reported as a modification.
	 */
	private _elementFingerprint(element: PerceivedSchemaElement): string {
		return JSON.stringify({
			elementType: element.elementType,
			name: element.name,
			qualifiedName: element.qualifiedName,
			parentId: element.parentId,
			metadata: element.metadata
		});
	}

	private _persistChange(change: SchemaChange): void {
		this.hypergraphStore.addNode({
			id: change.id,
			node_type: CHANGE_NODE_TYPE,
			content: `Schema element ${change.qualifiedName} (${change.elementType}) was ${change.changeType}`,
			links: [],
			metadata: {
				changeType: change.changeType,
				elementId: change.elementId,
				elementType: change.elementType,
				qualifiedName: change.qualifiedName,
				connectionUri: change.connectionUri,
				detectedAt: change.detectedAt,
				before: change.before,
				after: change.after
			},
			salience_score: CHANGE_SALIENCE[change.changeType]
		});
	}
}
