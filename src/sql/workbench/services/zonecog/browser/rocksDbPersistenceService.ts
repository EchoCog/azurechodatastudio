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

		this._initialized = false;
		this.logService.info('[RocksDbPersistenceService] Database closed');
		this._onDidChangeConnectionState.fire(false);
	}

	// --- Node Operations ---

	async putNode(node: HypergraphNode): Promise<void> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		const key = node.id;
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
		const value = JSON.stringify(link);

		cf.data.set(key, value);
		this._updateBloomFilter('links', key);

		// Index by source and target nodes
		this._addToIndex('links', `source:${link.source_id}`, key);
		this._addToIndex('links', `target:${link.target_id}`, key);

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
				this._removeFromIndex('links', `source:${link.source_id}`, id);
				this._removeFromIndex('links', `target:${link.target_id}`, id);
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
		const sourceIndex = cf.indices.get(`source:${nodeId}`) ?? new Set();
		const targetIndex = cf.indices.get(`target:${nodeId}`) ?? new Set();

		const linkIds = new Set([...sourceIndex, ...targetIndex]);
		const links: HypergraphLink[] = [];

		for (const id of linkIds) {
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

		// Execute all operations atomically
		for (const op of operations) {
			const cf = this._getColumnFamily(op.columnFamily);

			switch (op.type) {
				case 'put':
					if (op.value !== undefined) {
						cf.data.set(op.key, op.value);
						this._updateBloomFilter(op.columnFamily, op.key);
					}
					break;
				case 'delete':
					cf.data.delete(op.key);
					break;
				case 'merge':
					if (op.value !== undefined) {
						const existing = cf.data.get(op.key);
						if (existing) {
							// Merge JSON objects
							const merged = { ...JSON.parse(existing), ...JSON.parse(op.value) };
							cf.data.set(op.key, JSON.stringify(merged));
						} else {
							cf.data.set(op.key, op.value);
						}
						this._updateBloomFilter(op.columnFamily, op.key);
					}
					break;
			}
		}

		this._writeCount += operations.length;
		this.membraneService.recordActivity('somatic');
	}

	async bulkPutNodes(nodes: HypergraphNode[]): Promise<{ inserted: number; updated: number }> {
		this._ensureInitialized();

		let inserted = 0;
		let updated = 0;

		const cf = this._getColumnFamily('nodes');

		for (const node of nodes) {
			const existed = cf.data.has(node.id);
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
			const existed = cf.data.has(link.id);
			cf.data.set(link.id, JSON.stringify(link));
			this._updateBloomFilter('links', link.id);
			this._addToIndex('links', `source:${link.source_id}`, link.id);
			this._addToIndex('links', `target:${link.target_id}`, link.id);

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
			// In a browser environment, we'd serialize to IndexedDB or download.
			// For this implementation, we just record the event.
			const data: Record<string, Record<string, string>> = {};
			for (const [family, store] of this._columnFamilies) {
				data[family] = Object.fromEntries(store.data);
			}

			// Store in metadata
			const metadataCf = this._getColumnFamily('metadata');
			metadataCf.data.set(`backup:${backupPath}`, JSON.stringify({
				timestamp: Date.now(),
				data
			}));

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
			const metadataCf = this._getColumnFamily('metadata');
			const backupData = metadataCf.data.get(`backup:${backupPath}`);

			if (!backupData) {
				throw new Error(`Backup not found: ${backupPath}`);
			}

			const { data } = JSON.parse(backupData) as { timestamp: number; data: Record<string, Record<string, string>> };

			// Restore each column family
			for (const [family, entries] of Object.entries(data)) {
				const cf = this._getColumnFamily(family as RocksDbColumnFamily);
				cf.data.clear();
				for (const [key, value] of Object.entries(entries)) {
					cf.data.set(key, value);
					this._updateBloomFilter(family as RocksDbColumnFamily, key);
				}
			}

			this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: true });
			this.logService.info('[RocksDbPersistenceService] Restored from backup:', backupPath);
		} catch (error) {
			this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: false });
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
