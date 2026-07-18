/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { PerceivedSchemaElement, SchemaElementType } from 'sql/workbench/services/zonecog/common/schemaPerception';

export const ISchemaEvolutionService = createDecorator<ISchemaEvolutionService>('schemaEvolutionService');

// ---------------------------------------------------------------------------
// Schema evolution types
// ---------------------------------------------------------------------------

/**
 * The kind of structural change detected between two schema snapshots.
 */
export type SchemaChangeType = 'added' | 'removed' | 'modified';

/**
 * A single detected schema change, persisted as a SchemaChange hypergraph node.
 */
export interface SchemaChange {
	/** Stable hypergraph node id of this change record. */
	id: string;
	changeType: SchemaChangeType;
	/** Id of the schema element that changed. */
	elementId: string;
	elementType: SchemaElementType;
	qualifiedName: string;
	connectionUri: string;
	/** Epoch milliseconds when the change was detected. */
	detectedAt: number;
	/** For 'modified' changes: JSON string of the element state before the change. */
	before?: string;
	/** For 'added' and 'modified' changes: JSON string of the element state after the change. */
	after?: string;
}

/**
 * Summary of the most recent snapshot retained for a connection.
 */
export interface SchemaSnapshotInfo {
	connectionUri: string;
	/** Epoch milliseconds when the snapshot was taken. */
	takenAt: number;
	/** Number of schema elements in the snapshot. */
	elementCount: number;
	/** How many snapshots have been recorded for this connection so far. */
	snapshotCount: number;
}

/**
 * Fired when a snapshot diff detects one or more changes.
 */
export interface SchemaEvolutionEvent {
	connectionUri: string;
	changes: SchemaChange[];
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Schema Evolution service.
 *
 * Closes the "schema evolution tracking" roadmap item (Phase 3.4): it keeps
 * a per-connection snapshot of the most recently perceived schema, diffs each
 * new perception against it to detect added / removed / modified elements,
 * persists every detected change as a SchemaChange hypergraph node, and
 * exposes the bounded change history for audit and reasoning.
 *
 * The service self-wires to `ISchemaPerceptionService.onDidPerceiveSchema`,
 * so every completed schema perception automatically feeds evolution
 * tracking; `recordSnapshot` can also be invoked directly.
 */
export interface ISchemaEvolutionService {
	readonly _serviceBrand: undefined;

	/** Fired when a snapshot diff detects one or more changes. */
	readonly onDidDetectSchemaChanges: Event<SchemaEvolutionEvent>;

	/**
	 * Record a schema snapshot for a connection and diff it against the
	 * previous snapshot. The first snapshot for a connection establishes the
	 * baseline and reports no changes. Returns the detected changes.
	 */
	recordSnapshot(connectionUri: string, elements: PerceivedSchemaElement[]): SchemaChange[];

	/** The retained change history for a connection, most recent first. */
	getChangeHistory(connectionUri: string, limit?: number): SchemaChange[];

	/** Info about the most recent snapshot for a connection, if any. */
	getSnapshotInfo(connectionUri: string): SchemaSnapshotInfo | undefined;

	/** Connections that currently have a tracked snapshot. */
	getTrackedConnections(): string[];

	/**
	 * Clear tracked snapshots and change history (and persisted SchemaChange
	 * nodes) for one connection, or for all connections when omitted.
	 */
	clear(connectionUri?: string): void;
}
