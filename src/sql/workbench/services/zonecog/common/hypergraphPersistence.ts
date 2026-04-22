/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IHypergraphPersistenceService = createDecorator<IHypergraphPersistenceService>('hypergraphPersistenceService');

// ---------------------------------------------------------------------------
// Persistence types
// ---------------------------------------------------------------------------

/**
 * A versioned snapshot of the full hypergraph, stored in IndexedDB.
 */
export interface HypergraphSnapshot {
	/** Auto-generated snapshot ID (epoch-ms). */
	id: number;
	/** ISO wall-clock timestamp. */
	timestamp: number;
	/** Number of nodes at the time of the snapshot. */
	nodeCount: number;
	/** Number of links at the time of the snapshot. */
	linkCount: number;
	/** Optional human-readable label (e.g. "auto-save", "manual"). */
	label: string;
}

/**
 * Statistics about the persisted hypergraph storage.
 */
export interface PersistenceStats {
	/** Whether the IndexedDB database is open and ready. */
	databaseReady: boolean;
	/** Total number of node records currently in storage. */
	storedNodeCount: number;
	/** Total number of link records currently in storage. */
	storedLinkCount: number;
	/** Total number of snapshots recorded. */
	snapshotCount: number;
	/** Epoch-ms of the most recent save. 0 if never saved. */
	lastSaveTime: number;
	/** Epoch-ms of the most recent load. 0 if never loaded. */
	lastLoadTime: number;
	/** Estimated storage size in bytes (best-effort). */
	estimatedBytes: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Hypergraph Persistence Service.
 *
 * Provides durable storage for the Zone-Cog hypergraph using the browser's
 * built-in IndexedDB API.  This allows the knowledge graph to survive page
 * reloads and workbench restarts.
 *
 * Database schema:
 *   DB name : "zonecog-hypergraph"
 *   Store 1 : "nodes"     — HypergraphNode objects keyed by id
 *   Store 2 : "links"     — HypergraphLink objects keyed by id
 *   Store 3 : "snapshots" — HypergraphSnapshot metadata keyed by id
 *
 * Lifecycle:
 *   1. Service opens the DB on first use (auto-upgrade / create if needed).
 *   2. Callers can save the current in-memory hypergraph at any time.
 *   3. Callers can load a previously saved graph back into memory.
 *   4. An optional auto-save interval can be configured.
 */
export interface IHypergraphPersistenceService {
	readonly _serviceBrand: undefined;

	/** Fired when a save operation completes. */
	readonly onDidSave: Event<HypergraphSnapshot>;

	/** Fired when a load operation completes. */
	readonly onDidLoad: Event<HypergraphSnapshot>;

	/** Fired when an error occurs during a persistence operation. */
	readonly onDidError: Event<{ operation: string; message: string }>;

	// -- Core operations -----------------------------------------------------

	/**
	 * Save the current in-memory hypergraph to IndexedDB.
	 * Overwrites any previously saved nodes/links and records a snapshot.
	 * @param label Optional label for this snapshot (defaults to "manual").
	 */
	save(label?: string): Promise<HypergraphSnapshot>;

	/**
	 * Load the most recently saved hypergraph from IndexedDB into memory.
	 * Replaces the current in-memory hypergraph entirely.
	 * @returns The snapshot that was loaded, or undefined if nothing is stored.
	 */
	load(): Promise<HypergraphSnapshot | undefined>;

	/**
	 * Clear all persisted data from IndexedDB (nodes, links, snapshots).
	 */
	clearStorage(): Promise<void>;

	// -- Snapshot management -------------------------------------------------

	/**
	 * List all recorded snapshot metadata entries, newest first.
	 */
	listSnapshots(): Promise<HypergraphSnapshot[]>;

	// -- Auto-save -----------------------------------------------------------

	/**
	 * Enable automatic periodic saves.
	 * @param intervalMs Interval between saves in milliseconds (minimum 10 000 ms).
	 */
	enableAutoSave(intervalMs: number): void;

	/**
	 * Disable automatic saving.
	 */
	disableAutoSave(): void;

	/**
	 * Whether auto-save is currently enabled.
	 */
	isAutoSaveEnabled(): boolean;

	// -- Diagnostics ---------------------------------------------------------

	/**
	 * Return current storage statistics.
	 */
	getStats(): Promise<PersistenceStats>;
}
