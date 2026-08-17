/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';

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
 * Pluggable durable backends for the hybrid persistence layer (Phase E.2).
 *
 * - `indexeddb` - browser IndexedDB object stores (default).
 * - `rocksdb` - RocksDB-compatible LSM engine with column families, bloom
 *   filters (WebAssembly memory), range queries and leveled compaction.
 * - `atomspace` - OpenCog AtomSpace backend via {@link IAtomSpaceBackendService}.
 */
export type HypergraphPersistenceBackendKind = 'indexeddb' | 'rocksdb' | 'atomspace';

/** Storage tier a node currently occupies in the hybrid hot/warm/cold layout. */
export type HypergraphStorageTier = 'hot' | 'warm' | 'cold';

/**
 * Diagnostics for the in-process RocksDB-compatible engine when that backend
 * is active (or was last used).
 */
export interface RocksDbPersistenceStats {
	columnFamilies: string[];
	memtableEntries: number;
	sstableCount: number;
	bloomFilterBits: number;
	bloomFilterHits: number;
	bloomFilterMisses: number;
	compactionCount: number;
	estimatedBytes: number;
	ready: boolean;
}

/**
 * Optional HTTP cloud-backup endpoint configuration (Phase E.3).
 *
 * When configured, {@link IHypergraphPersistenceService.uploadBackupToCloud}
 * POSTs a JSON backup to `{endpointUrl}/{prefix}/{name}` and
 * {@link IHypergraphPersistenceService.downloadBackupFromCloud} GETs one back.
 * Auth is a bearer token when `authToken` is set. No provider is enabled by
 * default - cloud integration is strictly opt-in.
 */
export interface CloudStorageConfig {
	/** Absolute base URL of the backup API (no trailing slash required). */
	endpointUrl: string;
	/** Optional bearer token sent as an HTTP Authorization bearer header. */
	authToken?: string;
	/** Remote path prefix under the endpoint (default `"zonecog-backups"`). */
	prefix?: string;
	/** Request timeout in milliseconds (default 30_000). */
	timeoutMs?: number;
}

/** Result of a cloud backup upload or download attempt. */
export interface CloudBackupResult {
	success: boolean;
	remotePath: string;
	bytesTransferred: number;
	durationMs: number;
	error?: string;
}

/**
 * Statistics about the persisted hypergraph storage.
 */
export interface PersistenceStats {
	/** Whether the active durable backend is open and ready. */
	databaseReady: boolean;
	/** Total number of node records currently in hot-tier storage. */
	storedNodeCount: number;
	/** Total number of link records currently in hot-tier storage. */
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
	/** Number of nodes currently held in the warm tier (durable, not in memory). */
	warmNodeCount: number;
	/** Epoch-ms of the most recent backup export. 0 if never backed up. */
	lastBackupTime: number;
	/** Currently selected durable backend. */
	backend: HypergraphPersistenceBackendKind;
	/** RocksDB engine diagnostics when the rocksdb backend has been opened. */
	rocksDb?: RocksDbPersistenceStats;
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

/** Format version stamped into every exported {@link HypergraphBackup}. */
export const HYPERGRAPH_BACKUP_FORMAT_VERSION = 1;

/**
 * A portable, JSON-serializable backup of the hypergraph - either the full
 * current state, or (when created with a `sinceTimestamp`) an incremental
 * delta of just the nodes/links that changed since then.
 *
 * Incremental deltas only cover *upserts* (adds and updates), tracked via
 * {@link IHypergraphStore.onDidChangeNode}/`onDidChangeLink`. Node/link
 * removal performed directly against `IHypergraphStore` (outside this
 * service) is not observable through those events and so is not captured by
 * a delta; a periodic full backup (`sinceTimestamp` omitted) always reflects
 * the true current state regardless.
 */
export interface HypergraphBackup {
	formatVersion: number;
	/** Epoch-ms when this backup was created. */
	createdAt: number;
	/** True for a full snapshot; false for an incremental delta. */
	full: boolean;
	/** The `sinceTimestamp` this delta was computed against, if incremental. */
	sinceTimestamp?: number;
	nodes: HypergraphNode[];
	links: HypergraphLink[];
}

/** Result of applying a {@link HypergraphBackup} via {@link IHypergraphPersistenceService.importBackup}. */
export interface BackupImportResult {
	nodesUpserted: number;
	linksUpserted: number;
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

	// -- Incremental backup / restore -----------------------------------------

	/**
	 * Create a portable, JSON-serializable backup of the hypergraph.
	 *
	 * @param sinceTimestamp When omitted, returns a full backup of every
	 *   current node/link. When given (an epoch-ms value, typically a prior
	 *   backup's `createdAt`), returns an incremental delta containing only
	 *   the nodes/links upserted since then - see {@link HypergraphBackup}
	 *   for what a delta does and does not capture.
	 */
	createBackup(sinceTimestamp?: number): Promise<HypergraphBackup>;

	/**
	 * Convenience wrapper: {@link createBackup} serialized to a JSON string,
	 * suitable for the clipboard or a file.
	 */
	exportBackupJson(sinceTimestamp?: number): Promise<string>;

	/**
	 * Apply a previously created backup - full or incremental - by upserting
	 * every node/link it contains into both the live in-memory hypergraph and
	 * the hot IndexedDB tier. Existing records with the same id are
	 * overwritten; nothing is cleared first, so multiple incremental backups
	 * (or a full backup followed by incrementals) can be applied in sequence
	 * to reconstruct state.
	 */
	importBackup(backup: HypergraphBackup): Promise<BackupImportResult>;

	/**
	 * Convenience wrapper: parses a JSON string produced by
	 * {@link exportBackupJson} and applies it via {@link importBackup}.
	 */
	importBackupJson(json: string): Promise<BackupImportResult>;

	// -- Pluggable backend selection (Phase E.2) ------------------------------

	/**
	 * Switch the durable backend used for hot/warm/cold tiers.
	 *
	 * The current in-memory hypergraph is written through to the newly
	 * selected backend on switch so no live state is lost. Available kinds
	 * are listed by {@link getAvailableBackends}.
	 */
	setBackend(kind: HypergraphPersistenceBackendKind): Promise<void>;

	/** Currently active durable backend. */
	getBackend(): HypergraphPersistenceBackendKind;

	/** Backends this build can activate. */
	getAvailableBackends(): HypergraphPersistenceBackendKind[];

	// -- Warm tier (Phase E.2 hot/warm/cold) ----------------------------------

	/**
	 * Move nodes whose salience is below `threshold` (default 0.25) but at or
	 * above the cold-archive threshold out of the live hypergraph into the
	 * warm tier. Warm nodes remain durably stored and can be lazily restored
	 * via {@link restoreWarmNode} without loading the rest of the tier.
	 * Nodes below the cold threshold are left for {@link archiveLowSalienceNodes}.
	 */
	demoteToWarmTier(threshold?: number): Promise<ArchiveStats>;

	/**
	 * Lazily restore a single warm-tier node (and its warm links) back into
	 * the live hypergraph.
	 */
	restoreWarmNode(nodeId: string): Promise<HypergraphNode | undefined>;

	/** List warm-tier nodes without loading them into the live hypergraph. */
	listWarmNodes(): Promise<HypergraphNode[]>;

	// -- Range queries / compaction -------------------------------------------

	/**
	 * Efficient ordered retrieval of hot-tier nodes whose id is greater than
	 * or equal to `prefix` and shares that prefix. Backed by RocksDB range
	 * scans when that backend is active; falls back to an in-memory filter
	 * over the IndexedDB/AtomSpace hot set otherwise.
	 */
	rangeQueryNodes(prefix: string, limit?: number): Promise<HypergraphNode[]>;

	/**
	 * Force memtable flush + leveled compaction on the RocksDB backend.
	 * No-op for backends that do not support compaction.
	 */
	compactStorage(): Promise<void>;

	// -- Optional cloud storage (Phase E.3) -----------------------------------

	/**
	 * Configure (or clear, when `config` is `undefined`) the optional HTTP
	 * cloud backup endpoint. Cloud integration is disabled until this is
	 * called with a valid config.
	 */
	configureCloudStorage(config: CloudStorageConfig | undefined): void;

	/** Current cloud storage config, or `undefined` when disabled. */
	getCloudStorageConfig(): CloudStorageConfig | undefined;

	/**
	 * Create a backup (full or incremental) and POST it to the configured
	 * cloud endpoint. Fails fast when cloud storage is not configured.
	 */
	uploadBackupToCloud(sinceTimestamp?: number, remoteName?: string): Promise<CloudBackupResult>;

	/**
	 * Download a previously uploaded backup from the cloud endpoint and
	 * apply it via {@link importBackup}.
	 */
	downloadBackupFromCloud(remotePath: string): Promise<BackupImportResult>;

	/** List backup object names under the configured cloud prefix. */
	listCloudBackups(): Promise<string[]>;

	/**
	 * Dispose of the service and release any resources.
	 */
	dispose(): void;
}
