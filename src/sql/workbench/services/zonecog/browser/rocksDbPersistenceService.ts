/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import {
	IRocksDbPersistenceService,
	RocksDbConfig,
	RocksDbColumnFamily,
	RangeQueryOptions,
	RangeQueryResult,
	BatchWriteOperation,
	RocksDbStats,
	CompactionStatus,
	IndexDefinition,
	DEFAULT_ROCKSDB_CONFIG
} from '../common/rocksDbPersistence';
import { HypergraphNode, HypergraphLink } from '../common/zonecogService';
import { ICognitiveMembraneService } from '../common/zonecogService';

/**
 * In-memory emulation of RocksDB column family storage.
 * In a full implementation, this would use RocksDB WASM bindings.
 */
interface ColumnFamilyStore {
	data: Map<string, string>;
	indices: Map<string, Set<string>>; // secondary indices
}

/**
 * RocksDB-backed persistence service for hypergraph storage.
 *
 * This implementation provides a high-performance storage backend using
 * an in-memory store that emulates RocksDB semantics. In production, this
 * would be backed by RocksDB WASM bindings (e.g., via @aspect-build/rules_js
 * or a custom WASM compilation of RocksDB).
 *
 * Key features:
 * - Column families for data organization (nodes, links, indices, metadata)
 * - Efficient range queries using sorted key iteration
 * - Bloom filter emulation for fast existence checks
 * - Batch write operations with atomic semantics
 * - Secondary index support for efficient queries
 * - Compaction and statistics tracking
 */
export class RocksDbPersistenceService extends Disposable implements IRocksDbPersistenceService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnectionState = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionState: Event<boolean> = this._onDidChangeConnectionState.event;

	private readonly _onDidCompleteCompaction = this._register(new Emitter<{ columnFamily?: RocksDbColumnFamily; durationMs: number }>());
	readonly onDidCompleteCompaction: Event<{ columnFamily?: RocksDbColumnFamily; durationMs: number }> = this._onDidCompleteCompaction.event;

	private readonly _onDidBackupOrRestore = this._register(new Emitter<{ operation: 'backup' | 'restore'; path: string; success: boolean }>());
	readonly onDidBackupOrRestore: Event<{ operation: 'backup' | 'restore'; path: string; success: boolean }> = this._onDidBackupOrRestore.event;

	private _config: RocksDbConfig = { ...DEFAULT_ROCKSDB_CONFIG };
	private _initialized = false;

	// Column family stores
	private readonly _columnFamilies: Map<RocksDbColumnFamily, ColumnFamilyStore> = new Map();

	// Bloom filter emulation (set of known keys for fast negative lookups)
	private readonly _bloomFilters: Map<RocksDbColumnFamily, Set<string>> = new Map();

	// Snapshot management
	private readonly _snapshots: Map<string, Map<RocksDbColumnFamily, Map<string, string>>> = new Map();

	// Index definitions
	private readonly _indexDefinitions: Map<string, IndexDefinition> = new Map();

	// Separate backup storage (not part of column families to prevent restore from deleting backups)
	private readonly _backups: Map<string, { timestamp: number; data: Record<string, Record<string, string>>; indices: Record<string, Record<string, string[]>> }> = new Map();

	// Statistics
	private _writeCount = 0;
	private _readCount = 0;
	private _lastCompactionTime?: number;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this.logService.info('[RocksDbPersistenceService] Service instantiated');
	}

	// --- Lifecycle ---

	async initialize(config?: Partial<RocksDbConfig>): Promise<void> {
		if (this._initialized) {
			this.logService.warn('[RocksDbPersistenceService] Already initialized');
			return;
		}

		this._config = { ...DEFAULT_ROCKSDB_CONFIG, ...config };

		// Initialize column families
		const families: RocksDbColumnFamily[] = ['nodes', 'links', 'indices', 'metadata'];
		for (const family of families) {
			this._columnFamilies.set(family, {
				data: new Map(),
				indices: new Map()
			});
			if (this._config.enableBloomFilters) {
				this._bloomFilters.set(family, new Set());
			}
		}

		this._initialized = true;
		this.membraneService.recordActivity('autonomic');
		this.logService.info('[RocksDbPersistenceService] Initialized with config:', this._config.dbPath);
		this._onDidChangeConnectionState.fire(true);
	}

	isInitialized(): boolean {
		return this._initialized;
	}

	async close(): Promise<void> {
		if (!this._initialized) {
			return;
		}

		// Clear all data
		this._columnFamilies.clear();
		this._bloomFilters.clear();
		this._snapshots.clear();
		this._indexDefinitions.clear();
		this._backups.clear();

		this._initialized = false;
		this.logService.info('[RocksDbPersistenceService] Database closed');
		this._onDidChangeConnectionState.fire(false);
	}

	// --- Node Operations ---

	async putNode(node: HypergraphNode): Promise<void> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		const key = node.id;

		// Remove old index entries if updating an existing node
		const existingValue = cf.data.get(key);
		if (existingValue) {
			const existingNode = JSON.parse(existingValue) as HypergraphNode;
			this._removeFromIndex('nodes', `type:${existingNode.node_type}`, key);
		}

		const value = JSON.stringify(node);
		cf.data.set(key, value);
		this._updateBloomFilter('nodes', key);
		this._updateIndices('nodes', key, node);
		this._writeCount++;

		this.membraneService.recordActivity('somatic');
	}

	async getNode(id: string): Promise<HypergraphNode | undefined> {
		this._ensureInitialized();
		this._readCount++;

		// Fast negative lookup via bloom filter
		if (!this._checkBloomFilter('nodes', id)) {
			return undefined;
		}

		const cf = this._getColumnFamily('nodes');
		const value = cf.data.get(id);

		if (!value) {
			return undefined;
		}

		return JSON.parse(value) as HypergraphNode;
	}

	async deleteNode(id: string): Promise<boolean> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		const existed = cf.data.has(id);

		if (existed) {
			cf.data.delete(id);
			this._removeFromIndices('nodes', id);
			this._writeCount++;
			this.membraneService.recordActivity('somatic');
		}

		return existed;
	}

	async hasNode(id: string): Promise<boolean> {
		this._ensureInitialized();

		// Fast negative lookup via bloom filter
		if (!this._checkBloomFilter('nodes', id)) {
			return false;
		}

		const cf = this._getColumnFamily('nodes');
		return cf.data.has(id);
	}

	async getAllNodes(options?: { limit?: number; offset?: number }): Promise<HypergraphNode[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		let nodes: HypergraphNode[] = [];

		for (const value of cf.data.values()) {
			nodes.push(JSON.parse(value) as HypergraphNode);
		}

		// Apply pagination
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? nodes.length;

		return nodes.slice(offset, offset + limit);
	}

	async getNodesByType(nodeType: string, options?: { limit?: number; offset?: number }): Promise<HypergraphNode[]> {
		this._ensureInitialized();

		// Check for type index
		const indexKey = `type:${nodeType}`;
		const cf = this._getColumnFamily('nodes');
		const typeIndex = cf.indices.get(indexKey);

		let nodes: HypergraphNode[];

		if (typeIndex) {
			// Use index for efficient retrieval
			nodes = [];
			for (const id of typeIndex) {
				const value = cf.data.get(id);
				if (value) {
					nodes.push(JSON.parse(value) as HypergraphNode);
				}
			}
		} else {
			// Full scan
			nodes = [];
			for (const value of cf.data.values()) {
				const node = JSON.parse(value) as HypergraphNode;
				if (node.node_type === nodeType) {
					nodes.push(node);
				}
			}
		}

		// Apply pagination
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? nodes.length;

		return nodes.slice(offset, offset + limit);
	}

	async getNodesBySalienceRange(minSalience: number, maxSalience: number, options?: { limit?: number }): Promise<HypergraphNode[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		const nodes: HypergraphNode[] = [];

		for (const value of cf.data.values()) {
			const node = JSON.parse(value) as HypergraphNode;
			if (node.salience_score >= minSalience && node.salience_score <= maxSalience) {
				nodes.push(node);
			}
		}

		// Sort by salience descending
		nodes.sort((a, b) => b.salience_score - a.salience_score);

		// Apply limit
		const limit = options?.limit ?? nodes.length;
		return nodes.slice(0, limit);
	}

	// --- Link Operations ---

	async putLink(link: HypergraphLink): Promise<void> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		const key = link.id;

		// Remove old index entries if updating an existing link
		const existingValue = cf.data.get(key);
		if (existingValue) {
			const existingLink = JSON.parse(existingValue) as HypergraphLink;
			// Defensive: handle malformed links that may have been batch-written without outgoing array
			if (Array.isArray(existingLink.outgoing)) {
				for (const nodeId of existingLink.outgoing) {
					this._removeFromIndex('links', `outgoing:${nodeId}`, key);
				}
			}
		}

		const value = JSON.stringify(link);
		cf.data.set(key, value);
		this._updateBloomFilter('links', key);

		// Index by all nodes in the outgoing array
		if (Array.isArray(link.outgoing)) {
			for (const nodeId of link.outgoing) {
				this._addToIndex('links', `outgoing:${nodeId}`, key);
			}
		}

		this._writeCount++;
		this.membraneService.recordActivity('somatic');
	}

	async getLink(id: string): Promise<HypergraphLink | undefined> {
		this._ensureInitialized();
		this._readCount++;

		if (!this._checkBloomFilter('links', id)) {
			return undefined;
		}

		const cf = this._getColumnFamily('links');
		const value = cf.data.get(id);

		if (!value) {
			return undefined;
		}

		return JSON.parse(value) as HypergraphLink;
	}

	async deleteLink(id: string): Promise<boolean> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		const existed = cf.data.has(id);

		if (existed) {
			const value = cf.data.get(id);
			if (value) {
				const link = JSON.parse(value) as HypergraphLink;
				// Defensive: handle malformed links that may have been batch-written without outgoing array
				if (Array.isArray(link.outgoing)) {
					for (const nodeId of link.outgoing) {
						this._removeFromIndex('links', `outgoing:${nodeId}`, id);
					}
				}
			}
			cf.data.delete(id);
			this._writeCount++;
			this.membraneService.recordActivity('somatic');
		}

		return existed;
	}

	async getLinksForNode(nodeId: string): Promise<HypergraphLink[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		// Look up links that include this node in their outgoing array
		const outgoingIndex = cf.indices.get(`outgoing:${nodeId}`) ?? new Set();

		const links: HypergraphLink[] = [];

		for (const id of outgoingIndex) {
			const value = cf.data.get(id);
			if (value) {
				links.push(JSON.parse(value) as HypergraphLink);
			}
		}

		return links;
	}

	async getAllLinks(options?: { limit?: number; offset?: number }): Promise<HypergraphLink[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		let links: HypergraphLink[] = [];

		for (const value of cf.data.values()) {
			links.push(JSON.parse(value) as HypergraphLink);
		}

		// Apply pagination
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? links.length;

		return links.slice(offset, offset + limit);
	}

	// --- Range Queries ---

	async rangeQuery<T>(options: RangeQueryOptions): Promise<RangeQueryResult<T>> {
		this._ensureInitialized();

		const cf = this._getColumnFamily(options.columnFamily);
		let keys = Array.from(cf.data.keys()).sort();

		// Apply prefix filter
		if (options.prefix) {
			keys = keys.filter(k => k.startsWith(options.prefix!));
		}

		// Apply range bounds
		if (options.startKey) {
			keys = keys.filter(k => k >= options.startKey!);
		}
		if (options.endKey) {
			keys = keys.filter(k => k < options.endKey!);
		}

		// Apply reverse
		if (options.reverse) {
			keys.reverse();
		}

		// Apply pagination
		const offset = options.offset ?? 0;
		const limit = options.limit ?? keys.length;
		const hasMore = offset + limit < keys.length;
		const paginatedKeys = keys.slice(offset, offset + limit);

		// Retrieve values
		const items: T[] = [];
		for (const key of paginatedKeys) {
			const value = cf.data.get(key);
			if (value) {
				items.push(JSON.parse(value) as T);
			}
		}

		return {
			items,
			totalCount: keys.length,
			hasMore,
			nextCursor: hasMore ? String(offset + limit) : undefined
		};
	}

	async iteratePrefix(columnFamily: RocksDbColumnFamily, prefix: string, callback: (key: string, value: string) => boolean | void): Promise<void> {
		this._ensureInitialized();

		const cf = this._getColumnFamily(columnFamily);
		const keys = Array.from(cf.data.keys())
			.filter(k => k.startsWith(prefix))
			.sort();

		for (const key of keys) {
			const value = cf.data.get(key);
			if (value) {
				const shouldContinue = callback(key, value);
				if (shouldContinue === false) {
					break;
				}
			}
		}
	}

	// --- Batch Operations ---

	async batchWrite(operations: BatchWriteOperation[]): Promise<void> {
		this._ensureInitialized();

		// Create snapshot for rollback on failure
		const snapshots = new Map<RocksDbColumnFamily, { data: Map<string, string>; indices: Map<string, Set<string>> }>();
		const affectedFamilies = new Set(operations.map(op => op.columnFamily));

		for (const family of affectedFamilies) {
			const cf = this._getColumnFamily(family);
			snapshots.set(family, {
				data: new Map(cf.data),
				indices: new Map(Array.from(cf.indices.entries()).map(([k, v]) => [k, new Set(v)]))
			});
		}

		try {
			// Execute all operations
			for (const op of operations) {
				const cf = this._getColumnFamily(op.columnFamily);

				switch (op.type) {
					case 'put':
						if (op.value !== undefined) {
							// Remove old index entries before put
							const existingValue = cf.data.get(op.key);
							if (existingValue) {
								this._removeIndexEntriesForValue(op.columnFamily, op.key, existingValue);
							}
							cf.data.set(op.key, op.value);
							this._updateBloomFilter(op.columnFamily, op.key);
							// Add new index entries
							this._addIndexEntriesForValue(op.columnFamily, op.key, op.value);
						}
						break;
					case 'delete':
						const existingValue = cf.data.get(op.key);
						if (existingValue) {
							this._removeIndexEntriesForValue(op.columnFamily, op.key, existingValue);
						}
						cf.data.delete(op.key);
						break;
					case 'merge':
						if (op.value !== undefined) {
							const existing = cf.data.get(op.key);
							// Remove old index entries
							if (existing) {
								this._removeIndexEntriesForValue(op.columnFamily, op.key, existing);
							}
							const merged = existing
								? { ...JSON.parse(existing), ...JSON.parse(op.value) }
								: JSON.parse(op.value);
							const mergedStr = JSON.stringify(merged);
							cf.data.set(op.key, mergedStr);
							this._updateBloomFilter(op.columnFamily, op.key);
							// Add new index entries
							this._addIndexEntriesForValue(op.columnFamily, op.key, mergedStr);
						}
						break;
				}
			}

			this._writeCount += operations.length;
			this.membraneService.recordActivity('somatic');
		} catch (error) {
			// Rollback on failure
			for (const [family, snapshot] of snapshots) {
				const cf = this._getColumnFamily(family);
				cf.data.clear();
				for (const [k, v] of snapshot.data) {
					cf.data.set(k, v);
				}
				cf.indices.clear();
				for (const [k, v] of snapshot.indices) {
					cf.indices.set(k, new Set(v));
				}
			}
			throw error;
		}
	}

	async bulkPutNodes(nodes: HypergraphNode[]): Promise<{ inserted: number; updated: number }> {
		this._ensureInitialized();

		let inserted = 0;
		let updated = 0;

		const cf = this._getColumnFamily('nodes');

		for (const node of nodes) {
			const existingValue = cf.data.get(node.id);
			const existed = !!existingValue;

			// Remove old index entries if updating
			if (existingValue) {
				const existingNode = JSON.parse(existingValue) as HypergraphNode;
				this._removeFromIndex('nodes', `type:${existingNode.node_type}`, node.id);
			}

			cf.data.set(node.id, JSON.stringify(node));
			this._updateBloomFilter('nodes', node.id);
			this._updateIndices('nodes', node.id, node);

			if (existed) {
				updated++;
			} else {
				inserted++;
			}
		}

		this._writeCount += nodes.length;
		this.membraneService.recordActivity('somatic');

		return { inserted, updated };
	}

	async bulkPutLinks(links: HypergraphLink[]): Promise<{ inserted: number; updated: number }> {
		this._ensureInitialized();

		let inserted = 0;
		let updated = 0;

		const cf = this._getColumnFamily('links');

		for (const link of links) {
			const existingValue = cf.data.get(link.id);
			const existed = !!existingValue;

			// Remove old index entries if updating
			if (existingValue) {
				const existingLink = JSON.parse(existingValue) as HypergraphLink;
				for (const nodeId of existingLink.outgoing) {
					this._removeFromIndex('links', `outgoing:${nodeId}`, link.id);
				}
			}

			cf.data.set(link.id, JSON.stringify(link));
			this._updateBloomFilter('links', link.id);
			for (const nodeId of link.outgoing) {
				this._addToIndex('links', `outgoing:${nodeId}`, link.id);
			}

			if (existed) {
				updated++;
			} else {
				inserted++;
			}
		}

		this._writeCount += links.length;
		this.membraneService.recordActivity('somatic');

		return { inserted, updated };
	}

	// --- Index Management ---

	async createIndex(definition: IndexDefinition): Promise<void> {
		this._ensureInitialized();

		this._indexDefinitions.set(definition.name, definition);

		// Build the index
		await this.rebuildIndex(definition.name);

		this.logService.info('[RocksDbPersistenceService] Created index:', definition.name);
	}

	async dropIndex(indexName: string): Promise<void> {
		this._ensureInitialized();

		this._indexDefinitions.delete(indexName);

		// Remove index data
		const cf = this._getColumnFamily('indices');
		const keysToDelete: string[] = [];
		for (const key of cf.data.keys()) {
			if (key.startsWith(`${indexName}:`)) {
				keysToDelete.push(key);
			}
		}
		for (const key of keysToDelete) {
			cf.data.delete(key);
		}

		this.logService.info('[RocksDbPersistenceService] Dropped index:', indexName);
	}

	async listIndices(): Promise<IndexDefinition[]> {
		return Array.from(this._indexDefinitions.values());
	}

	async rebuildIndex(indexName: string): Promise<void> {
		this._ensureInitialized();

		const definition = this._indexDefinitions.get(indexName);
		if (!definition) {
			throw new Error(`Index not found: ${indexName}`);
		}

		const sourceCf = this._getColumnFamily(definition.sourceColumnFamily);
		const indexCf = this._getColumnFamily('indices');

		// Clear existing index entries
		const keysToDelete: string[] = [];
		for (const key of indexCf.data.keys()) {
			if (key.startsWith(`${indexName}:`)) {
				keysToDelete.push(key);
			}
		}
		for (const key of keysToDelete) {
			indexCf.data.delete(key);
		}

		// Rebuild index
		for (const [key, value] of sourceCf.data) {
			const doc = JSON.parse(value);
			// Execute key extractor (simplified - in production would use a sandboxed evaluator)
			const indexKey = this._extractIndexKey(definition.keyExtractor, doc);
			if (indexKey !== null || !definition.sparse) {
				const fullKey = `${indexName}:${indexKey}`;
				const existing = indexCf.data.get(fullKey);
				if (existing) {
					const ids = JSON.parse(existing) as string[];
					if (!ids.includes(key)) {
						ids.push(key);
						indexCf.data.set(fullKey, JSON.stringify(ids));
					}
				} else {
					indexCf.data.set(fullKey, JSON.stringify([key]));
				}
			}
		}

		this.logService.info('[RocksDbPersistenceService] Rebuilt index:', indexName);
	}

	// --- Compaction & Maintenance ---

	async compact(columnFamily?: RocksDbColumnFamily): Promise<void> {
		this._ensureInitialized();

		const startTime = Date.now();

		// In a real RocksDB implementation, this would trigger compaction.
		// For our emulation, we just record the event.
		await new Promise(resolve => setTimeout(resolve, 10)); // Simulate work

		this._lastCompactionTime = Date.now();
		const durationMs = Date.now() - startTime;

		this.membraneService.recordActivity('autonomic');
		this._onDidCompleteCompaction.fire({ columnFamily, durationMs });

		this.logService.info('[RocksDbPersistenceService] Compaction completed in', durationMs, 'ms');
	}

	async getCompactionStatus(): Promise<CompactionStatus> {
		return {
			isRunning: false,
			currentLevel: undefined,
			progress: undefined,
			estimatedCompletionMs: undefined,
			lastCompactionTime: this._lastCompactionTime
		};
	}

	async flush(): Promise<void> {
		this._ensureInitialized();

		// In a real implementation, this would flush write buffers to disk.
		// For our emulation, this is a no-op.
		this.logService.debug('[RocksDbPersistenceService] Flush completed');
	}

	// --- Statistics ---

	async getStats(): Promise<RocksDbStats> {
		this._ensureInitialized();

		const entryCounts: Record<RocksDbColumnFamily, number> = {
			nodes: this._getColumnFamily('nodes').data.size,
			links: this._getColumnFamily('links').data.size,
			indices: this._getColumnFamily('indices').data.size,
			metadata: this._getColumnFamily('metadata').data.size
		};

		// Estimate size
		let totalSize = 0;
		for (const cf of this._columnFamilies.values()) {
			for (const [key, value] of cf.data) {
				totalSize += key.length * 2 + value.length * 2; // UTF-16 estimate
			}
		}

		return {
			dbSizeBytes: totalSize,
			sstFileCount: 0, // Emulation doesn't have SST files
			entryCounts,
			writeAmplification: 1.0,
			readAmplification: 1.0,
			pendingCompactionBytes: 0,
			memoryUsage: {
				blockCache: 0,
				writeBuffer: totalSize,
				indexAndFilter: 0
			}
		};
	}

	async getEntryCount(columnFamily: RocksDbColumnFamily): Promise<number> {
		this._ensureInitialized();
		return this._getColumnFamily(columnFamily).data.size;
	}

	async estimateSize(): Promise<number> {
		const stats = await this.getStats();
		return stats.dbSizeBytes;
	}

	// --- Snapshots & Backup ---

	async createSnapshot(): Promise<string> {
		this._ensureInitialized();

		const snapshotId = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const snapshotData = new Map<RocksDbColumnFamily, Map<string, string>>();

		for (const [family, store] of this._columnFamilies) {
			snapshotData.set(family, new Map(store.data));
		}

		this._snapshots.set(snapshotId, snapshotData);

		this.logService.info('[RocksDbPersistenceService] Created snapshot:', snapshotId);
		return snapshotId;
	}

	async releaseSnapshot(snapshotId: string): Promise<void> {
		this._snapshots.delete(snapshotId);
		this.logService.info('[RocksDbPersistenceService] Released snapshot:', snapshotId);
	}

	async createBackup(backupPath: string): Promise<void> {
		this._ensureInitialized();

		try {
			// Serialize data and indices for all column families
			const data: Record<string, Record<string, string>> = {};
			const indices: Record<string, Record<string, string[]>> = {};

			for (const [family, store] of this._columnFamilies) {
				data[family] = Object.fromEntries(store.data);
				// Serialize indices as arrays for JSON compatibility
				const familyIndices: Record<string, string[]> = {};
				for (const [key, idSet] of store.indices) {
					familyIndices[key] = Array.from(idSet);
				}
				indices[family] = familyIndices;
			}

			// Store backup separately from column families
			this._backups.set(backupPath, {
				timestamp: Date.now(),
				data,
				indices
			});

			this._onDidBackupOrRestore.fire({ operation: 'backup', path: backupPath, success: true });
			this.logService.info('[RocksDbPersistenceService] Backup created:', backupPath);
		} catch (error) {
			this._onDidBackupOrRestore.fire({ operation: 'backup', path: backupPath, success: false });
			throw error;
		}
	}

	async restoreFromBackup(backupPath: string): Promise<void> {
		this._ensureInitialized();

		try {
			const backup = this._backups.get(backupPath);

			if (!backup) {
				this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: false });
				throw new Error(`Backup not found: ${backupPath}`);
			}

			const { data, indices } = backup;

			// Restore each column family's data and indices
			for (const [family, entries] of Object.entries(data)) {
				const cf = this._getColumnFamily(family as RocksDbColumnFamily);
				cf.data.clear();
				cf.indices.clear();

				// Restore data
				for (const [key, value] of Object.entries(entries)) {
					cf.data.set(key, value);
					this._updateBloomFilter(family as RocksDbColumnFamily, key);
				}

				// Restore indices
				const familyIndices = indices[family];
				if (familyIndices) {
					for (const [indexKey, ids] of Object.entries(familyIndices)) {
						cf.indices.set(indexKey, new Set(ids));
					}
				}
			}

			this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: true });
			this.logService.info('[RocksDbPersistenceService] Restored from backup:', backupPath);
		} catch (error) {
			if (!(error instanceof Error && error.message.includes('Backup not found'))) {
				this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: false });
			}
			throw error;
		}
	}

	// --- Private Helpers ---

	private _ensureInitialized(): void {
		if (!this._initialized) {
			throw new Error('RocksDbPersistenceService is not initialized. Call initialize() first.');
		}
	}

	private _getColumnFamily(family: RocksDbColumnFamily): ColumnFamilyStore {
		const cf = this._columnFamilies.get(family);
		if (!cf) {
			throw new Error(`Column family not found: ${family}`);
		}
		return cf;
	}

	private _updateBloomFilter(family: RocksDbColumnFamily, key: string): void {
		if (this._config.enableBloomFilters) {
			const filter = this._bloomFilters.get(family);
			if (filter) {
				filter.add(key);
			}
		}
	}

	private _checkBloomFilter(family: RocksDbColumnFamily, key: string): boolean {
		if (!this._config.enableBloomFilters) {
			return true; // No filter, assume key might exist
		}
		const filter = this._bloomFilters.get(family);
		return filter ? filter.has(key) : true;
	}

	private _updateIndices(family: RocksDbColumnFamily, key: string, doc: unknown): void {
		if (family === 'nodes') {
			const node = doc as HypergraphNode;
			this._addToIndex(family, `type:${node.node_type}`, key);
		}
	}

	private _removeFromIndices(family: RocksDbColumnFamily, key: string): void {
		const cf = this._getColumnFamily(family);
		for (const [indexKey, ids] of cf.indices) {
			ids.delete(key);
			if (ids.size === 0) {
				cf.indices.delete(indexKey);
			}
		}
	}

	private _removeIndexEntriesForValue(family: RocksDbColumnFamily, key: string, value: string): void {
		try {
			const doc = JSON.parse(value);
			if (family === 'nodes') {
				const node = doc as HypergraphNode;
				this._removeFromIndex(family, `type:${node.node_type}`, key);
			} else if (family === 'links') {
				const link = doc as HypergraphLink;
				// Defensive: handle malformed links without outgoing array
				if (Array.isArray(link.outgoing)) {
					for (const nodeId of link.outgoing) {
						this._removeFromIndex(family, `outgoing:${nodeId}`, key);
					}
				}
			}
		} catch {
			// If we can't parse the value, we can't remove index entries
		}
	}

	private _addIndexEntriesForValue(family: RocksDbColumnFamily, key: string, value: string): void {
		try {
			const doc = JSON.parse(value);
			if (family === 'nodes') {
				const node = doc as HypergraphNode;
				this._addToIndex(family, `type:${node.node_type}`, key);
			} else if (family === 'links') {
				const link = doc as HypergraphLink;
				// Defensive: handle malformed links without outgoing array
				if (Array.isArray(link.outgoing)) {
					for (const nodeId of link.outgoing) {
						this._addToIndex(family, `outgoing:${nodeId}`, key);
					}
				}
			}
		} catch {
			// If we can't parse the value, we can't add index entries
		}
	}

	private _addToIndex(family: RocksDbColumnFamily, indexKey: string, docKey: string): void {
		const cf = this._getColumnFamily(family);
		let ids = cf.indices.get(indexKey);
		if (!ids) {
			ids = new Set();
			cf.indices.set(indexKey, ids);
		}
		ids.add(docKey);
	}

	private _removeFromIndex(family: RocksDbColumnFamily, indexKey: string, docKey: string): void {
		const cf = this._getColumnFamily(family);
		const ids = cf.indices.get(indexKey);
		if (ids) {
			ids.delete(docKey);
			if (ids.size === 0) {
				cf.indices.delete(indexKey);
			}
		}
	}

	private _extractIndexKey(extractor: string, doc: unknown): string | null {
		// Simplified key extraction - supports dot notation
		// e.g., "node_type" or "metadata.category"
		try {
			const parts = extractor.split('.');
			let value: unknown = doc;
			for (const part of parts) {
				if (value && typeof value === 'object' && part in value) {
					value = (value as Record<string, unknown>)[part];
				} else {
					return null;
				}
			}
			return value != null ? String(value) : null;
		} catch {
			return null;
		}
	}
}
