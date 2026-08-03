/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

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
	/** Number of nodes currently held in cold-tier archive storage. */
	archivedNodeCount: number;
}

/**
 * Result of an {@link IHypergraphPersistenceService.archiveLowSalienceNodes}
 * pass.
 */
export interface ArchiveStats {
	/** Number of nodes moved from the live hypergraph into cold storage. */
	archivedNodeCount: number;
	/** Number of links moved alongside them (every outgoing id also archived). */
	archivedLinkCount: number;
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
 *   Store 1 : "nodes"     - HypergraphNode objects keyed by id
 *   Store 2 : "links"     - HypergraphLink objects keyed by id
 *   Store 3 : "snapshots" - HypergraphSnapshot metadata keyed by id
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
	 *
	 * The graph is saved to IndexedDB on the given interval until
	 * {@link disableAutoSave} is called or the service is disposed.
	 *
	 * @param intervalMs Interval between saves in milliseconds.
	 *   Must be at least 10 000 ms; smaller values are clamped to that minimum.
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

	// -- Export ---------------------------------------------------------------

	/**
	 * Export the current in-memory hypergraph as a Neo4j Cypher script.
	 *
	 * Each node becomes a `CREATE` statement labeled with its `node_type`;
	 * each hyperedge (which may connect any number of nodes, not just two) is
	 * reified as its own `:HyperLink` node with ordered `:PARTICIPATES`
	 * relationships to every node in its `outgoing` list, since Cypher
	 * relationships are strictly binary.
	 */
	exportToCypher(): string;

	/**
	 * Export the current in-memory hypergraph as OpenCog AtomSpace Scheme.
	 *
	 * Each node becomes an atom declaration named by its own `node_type`
	 * (mirroring the generic Node/Link atom mapping already used by
	 * `IAtomSpaceTransportService`, which does not remap `node_type`/
	 * `link_type` to canonical OpenCog atom names) carrying a truth value
	 * derived from `salience_score`; each link becomes a Scheme form over
	 * `ConceptNode` references to its outgoing node ids.
	 */
	exportToAtomSpaceScheme(): string;

	// -- Tiered storage (hybrid hot/cold hypergraph) --------------------------

	/**
	 * Move nodes whose `salience_score` is below `threshold` out of the live
	 * in-memory hypergraph and into cold-tier IndexedDB storage, shrinking
	 * the working set for large graphs. A link is archived alongside its
	 * nodes only when every one of its `outgoing` ids is also being archived
	 * in the same pass; links with a remaining hot endpoint are left live.
	 * Archived nodes/links are removed from the in-memory `IHypergraphStore`
	 * but remain durably retrievable via {@link restoreArchivedNode}.
	 *
	 * @param threshold Salience cutoff, exclusive. Defaults to a low,
	 *   service-defined constant if omitted.
	 */
	archiveLowSalienceNodes(threshold?: number): Promise<ArchiveStats>;

	/**
	 * Lazily restore a single archived node - and any links archived
	 * alongside it that this node itself references - back into the live
	 * in-memory hypergraph, without loading the rest of the cold tier.
	 * @returns The restored node, or undefined if no archived node has this id.
	 */
	restoreArchivedNode(nodeId: string): Promise<HypergraphNode | undefined>;

	/**
	 * List all archived (cold-tier) node records without loading them into
	 * the live hypergraph.
	 */
	listArchivedNodes(): Promise<HypergraphNode[]>;

	/**
	 * Dispose of the service and release any resources.
	 */
	dispose(): void;
}
