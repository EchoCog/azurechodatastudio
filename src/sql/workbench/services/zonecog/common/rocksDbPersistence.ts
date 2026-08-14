/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HypergraphNode, HypergraphLink } from './zonecogService';

/**
 * RocksDB column family identifiers for hypergraph data organization.
 */
export type RocksDbColumnFamily = 'nodes' | 'links' | 'indices' | 'metadata';

/**
 * Configuration options for RocksDB persistence backend.
 */
export interface RocksDbConfig {
	/** Database path (IndexedDB virtual path for WASM) */
	dbPath: string;
	/** Enable write-ahead logging for durability */
	enableWAL: boolean;
	/** Maximum write buffer size in bytes */
	writeBufferSize: number;
	/** Maximum number of write buffers */
	maxWriteBuffers: number;
	/** Target file size for level-0 SST files */
	targetFileSizeBase: number;
	/** Enable bloom filters for faster lookups */
	enableBloomFilters: boolean;
	/** Bloom filter bits per key */
	bloomFilterBitsPerKey: number;
	/** Compression type: 'none' | 'snappy' | 'lz4' | 'zstd' */
	compression: 'none' | 'snappy' | 'lz4' | 'zstd';
	/** Enable background compaction */
	enableCompaction: boolean;
	/** Maximum background compaction threads */
	maxBackgroundCompactions: number;
}

/**
 * Default RocksDB configuration optimized for hypergraph storage.
 */
export const DEFAULT_ROCKSDB_CONFIG: RocksDbConfig = {
	dbPath: 'zonecog-hypergraph-rocksdb',
	enableWAL: true,
	writeBufferSize: 64 * 1024 * 1024, // 64MB
	maxWriteBuffers: 3,
	targetFileSizeBase: 64 * 1024 * 1024, // 64MB
	enableBloomFilters: true,
	bloomFilterBitsPerKey: 10,
	compression: 'lz4',
	enableCompaction: true,
	maxBackgroundCompactions: 2,
};

/**
 * Range query options for efficient hypergraph retrieval.
 */
export interface RangeQueryOptions {
	/** Column family to query */
	columnFamily: RocksDbColumnFamily;
	/** Start key (inclusive) */
	startKey?: string;
	/** End key (exclusive) */
	endKey?: string;
	/** Maximum number of results */
	limit?: number;
	/** Skip first N results */
	offset?: number;
	/** Reverse iteration order */
	reverse?: boolean;
	/** Key prefix filter */
	prefix?: string;
}

/**
 * Result of a range query operation.
 */
export interface RangeQueryResult<T> {
	/** Retrieved items */
	items: T[];
	/** Total count matching criteria (if known) */
	totalCount?: number;
	/** Whether more results exist */
	hasMore: boolean;
	/** Continuation token for pagination */
	nextCursor?: string;
}

/**
 * Batch write operation for atomic multi-key updates.
 */
export interface BatchWriteOperation {
	/** Operation type */
	type: 'put' | 'delete' | 'merge';
	/** Column family */
	columnFamily: RocksDbColumnFamily;
	/** Key */
	key: string;
	/** Value (required for put/merge) */
	value?: string;
}

/**
 * Statistics about RocksDB storage state.
 */
export interface RocksDbStats {
	/** Database size in bytes */
	dbSizeBytes: number;
	/** Number of SST files */
	sstFileCount: number;
	/** Number of entries per column family */
	entryCounts: Record<RocksDbColumnFamily, number>;
	/** Write amplification factor */
	writeAmplification: number;
	/** Read amplification factor */
	readAmplification: number;
	/** Pending compaction bytes */
	pendingCompactionBytes: number;
	/** Memory usage breakdown */
	memoryUsage: {
		blockCache: number;
		writeBuffer: number;
		indexAndFilter: number;
	};
}

/**
 * Compaction status and progress.
 */
export interface CompactionStatus {
	/** Whether compaction is running */
	isRunning: boolean;
	/** Current compaction level */
	currentLevel?: number;
	/** Compaction progress (0-1) */
	progress?: number;
	/** Estimated completion time */
	estimatedCompletionMs?: number;
	/** Last compaction timestamp */
	lastCompactionTime?: number;
}

/**
 * Index definition for efficient queries.
 */
export interface IndexDefinition {
	/** Index name */
	name: string;
	/** Column family being indexed */
	sourceColumnFamily: RocksDbColumnFamily;
	/** Key extraction function (serialized) */
	keyExtractor: string;
	/** Whether index is unique */
	unique: boolean;
	/** Whether index is sparse (excludes null values) */
	sparse: boolean;
}

/**
 * Service identifier for RocksDB persistence.
 */
export const IRocksDbPersistenceService = createDecorator<IRocksDbPersistenceService>('rocksDbPersistenceService');

/**
 * RocksDB-backed persistence service for hypergraph storage.
 *
 * Provides high-performance persistent storage using RocksDB (via WASM)
 * with column families for nodes, links, and indices, efficient range
 * queries, bloom filters for fast lookups, and automatic compaction.
 *
 * This service extends the base persistence functionality with RocksDB-
 * specific features like batch writes, custom compaction, and detailed
 * storage statistics.
 */
export interface IRocksDbPersistenceService {
	readonly _serviceBrand: undefined;

	// --- Lifecycle ---

	/**
	 * Initialize the RocksDB database with configuration.
	 */
	initialize(config?: Partial<RocksDbConfig>): Promise<void>;

	/**
	 * Check if the database is initialized and ready.
	 */
	isInitialized(): boolean;

	/**
	 * Close the database and release resources.
	 */
	close(): Promise<void>;

	/**
	 * Fired when the database is opened or closed.
	 */
	readonly onDidChangeConnectionState: Event<boolean>;

	// --- Node Operations ---

	/**
	 * Store a hypergraph node.
	 */
	putNode(node: HypergraphNode): Promise<void>;

	/**
	 * Retrieve a node by ID.
	 */
	getNode(id: string): Promise<HypergraphNode | undefined>;

	/**
	 * Delete a node by ID.
	 */
	deleteNode(id: string): Promise<boolean>;

	/**
	 * Check if a node exists.
	 */
	hasNode(id: string): Promise<boolean>;

	/**
	 * Get all nodes (with optional pagination).
	 */
	getAllNodes(options?: { limit?: number; offset?: number }): Promise<HypergraphNode[]>;

	/**
	 * Query nodes by type.
	 */
	getNodesByType(nodeType: string, options?: { limit?: number; offset?: number }): Promise<HypergraphNode[]>;

	/**
	 * Query nodes by salience range.
	 */
	getNodesBySalienceRange(minSalience: number, maxSalience: number, options?: { limit?: number }): Promise<HypergraphNode[]>;

	// --- Link Operations ---

	/**
	 * Store a hypergraph link.
	 */
	putLink(link: HypergraphLink): Promise<void>;

	/**
	 * Retrieve a link by ID.
	 */
	getLink(id: string): Promise<HypergraphLink | undefined>;

	/**
	 * Delete a link by ID.
	 */
	deleteLink(id: string): Promise<boolean>;

	/**
	 * Get all links for a node.
	 */
	getLinksForNode(nodeId: string): Promise<HypergraphLink[]>;

	/**
	 * Get all links (with optional pagination).
	 */
	getAllLinks(options?: { limit?: number; offset?: number }): Promise<HypergraphLink[]>;

	// --- Range Queries ---

	/**
	 * Execute a range query on a column family.
	 */
	rangeQuery<T>(options: RangeQueryOptions): Promise<RangeQueryResult<T>>;

	/**
	 * Iterate over keys with a prefix.
	 */
	iteratePrefix(columnFamily: RocksDbColumnFamily, prefix: string, callback: (key: string, value: string) => boolean | void): Promise<void>;

	// --- Batch Operations ---

	/**
	 * Execute multiple operations atomically.
	 */
	batchWrite(operations: BatchWriteOperation[]): Promise<void>;

	/**
	 * Bulk import nodes (optimized for large datasets).
	 */
	bulkPutNodes(nodes: HypergraphNode[]): Promise<{ inserted: number; updated: number }>;

	/**
	 * Bulk import links (optimized for large datasets).
	 */
	bulkPutLinks(links: HypergraphLink[]): Promise<{ inserted: number; updated: number }>;

	// --- Index Management ---

	/**
	 * Create a secondary index.
	 */
	createIndex(definition: IndexDefinition): Promise<void>;

	/**
	 * Drop a secondary index.
	 */
	dropIndex(indexName: string): Promise<void>;

	/**
	 * List all indices.
	 */
	listIndices(): Promise<IndexDefinition[]>;

	/**
	 * Rebuild an index.
	 */
	rebuildIndex(indexName: string): Promise<void>;

	// --- Compaction & Maintenance ---

	/**
	 * Trigger manual compaction.
	 */
	compact(columnFamily?: RocksDbColumnFamily): Promise<void>;

	/**
	 * Get compaction status.
	 */
	getCompactionStatus(): Promise<CompactionStatus>;

	/**
	 * Fired when compaction completes.
	 */
	readonly onDidCompleteCompaction: Event<{ columnFamily?: RocksDbColumnFamily; durationMs: number }>;

	/**
	 * Flush write buffers to disk.
	 */
	flush(): Promise<void>;

	// --- Statistics ---

	/**
	 * Get detailed storage statistics.
	 */
	getStats(): Promise<RocksDbStats>;

	/**
	 * Get entry count for a column family.
	 */
	getEntryCount(columnFamily: RocksDbColumnFamily): Promise<number>;

	/**
	 * Estimate database size.
	 */
	estimateSize(): Promise<number>;

	// --- Snapshots & Backup ---

	/**
	 * Create a consistent snapshot for reads.
	 */
	createSnapshot(): Promise<string>;

	/**
	 * Release a snapshot.
	 */
	releaseSnapshot(snapshotId: string): Promise<void>;

	/**
	 * Create a backup checkpoint.
	 */
	createBackup(backupPath: string): Promise<void>;

	/**
	 * Restore from a backup.
	 */
	restoreFromBackup(backupPath: string): Promise<void>;

	/**
	 * Fired on backup/restore events.
	 */
	readonly onDidBackupOrRestore: Event<{ operation: 'backup' | 'restore'; path: string; success: boolean }>;
}
