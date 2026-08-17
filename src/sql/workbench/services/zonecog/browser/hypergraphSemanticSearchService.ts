/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import {
	IHypergraphSemanticSearchService,
	SemanticEmbeddingSource,
	SemanticSearchResult,
	EmbeddingCacheStats,
	BatchEmbeddingRequest,
	BatchEmbeddingResult,
	DimensionReductionConfig,
	ReducedEmbedding,
	IncrementalIndexStats
} from 'sql/workbench/services/zonecog/common/hypergraphSemanticSearch';
import { IAphroditeService } from 'sql/workbench/services/zonecog/common/aphrodite';
import { IHypergraphStore, HypergraphNode, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';

/** Dimensionality of the deterministic local fallback embedding. */
const LOCAL_EMBEDDING_DIM = 128;

/** Default maximum cache size in bytes (50 MB). */
const DEFAULT_MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024;

/** Estimated bytes per embedding dimension (8 bytes for float64). */
const BYTES_PER_DIMENSION = 8;

/** Default batch size for batch embedding requests. */
const DEFAULT_BATCH_SIZE = 32;

/** Auto-reindex interval in milliseconds (30 seconds). */
const AUTO_REINDEX_INTERVAL_MS = 30000;

/** IndexedDB database name for cache persistence. */
const CACHE_DB_NAME = 'zonecog-embedding-cache';

/** IndexedDB object store name. */
const CACHE_STORE_NAME = 'embeddings';

interface IndexEntry {
	vector: number[];
	contentHash: string;
	source: SemanticEmbeddingSource;
	/** Last access time for LRU eviction. */
	lastAccessTime: number;
}

/**
 * FNV-1a 32-bit hash, used both for the local hashing-trick embedding and
 * for cheap content-change detection.
 */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function tokenize(text: string): string[] {
	return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function normalize(vector: number[]): number[] {
	let norm = 0;
	for (const x of vector) {
		norm += x * x;
	}
	norm = Math.sqrt(norm);
	if (norm === 0) {
		return vector;
	}
	return vector.map(x => x / norm);
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) {
		return 0;
	}
	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic bag-of-words embedding using the hashing trick. Requires no
 * external service, so semantic search works out of the box; used whenever
 * no Aphrodite engine is connected.
 */
function localEmbed(text: string): number[] {
	const vector = new Array(LOCAL_EMBEDDING_DIM).fill(0);
	for (const token of tokenize(text)) {
		vector[fnv1a(token) % LOCAL_EMBEDDING_DIM] += 1;
	}
	return normalize(vector);
}

/**
 * Text used to embed a hypergraph node: its type plus content, so searches
 * can match on category ("TableNode users...") as well as content.
 */
function nodeEmbeddingText(node: HypergraphNode): string {
	return `${node.node_type} ${node.content}`;
}

/**
 * Implementation of the Hypergraph Semantic Search service.
 *
 * Maintains an in-memory embedding index over hypergraph nodes and ranks
 * search queries by cosine similarity. Embeddings come from
 * `IAphroditeService.embed()` when connected, otherwise from a deterministic
 * local hashing-trick embedding. Index entries record which source produced
 * them so a change in Aphrodite connection status triggers re-embedding
 * instead of comparing incompatible vector spaces.
 */
export class HypergraphSemanticSearchService extends Disposable implements IHypergraphSemanticSearchService {

	declare readonly _serviceBrand: undefined;

	// --- Index State ---
	private readonly _index = new Map<string, IndexEntry>();

	// --- Cache Statistics ---
	private _maxCacheSizeBytes = DEFAULT_MAX_CACHE_SIZE_BYTES;
	private _cacheHitCount = 0;
	private _cacheMissCount = 0;
	private _cacheEvictionCount = 0;

	// --- Incremental Re-indexing ---
	private readonly _staleNodeIds = new Set<string>();
	private _autoReindexEnabled = false;
	private _autoReindexBatchSize = DEFAULT_BATCH_SIZE;
	private _autoReindexTimer: ReturnType<typeof setInterval> | undefined;
	private _lastAutoReindexTime: number | undefined;
	private _reIndexedCount = 0;

	// --- Events ---
	private readonly _onDidIndexNode = this._register(new Emitter<string>());
	readonly onDidIndexNode: Event<string> = this._onDidIndexNode.event;

	private readonly _onDidUpdateCache = this._register(new Emitter<EmbeddingCacheStats>());
	readonly onDidUpdateCache: Event<EmbeddingCacheStats> = this._onDidUpdateCache.event;

	private readonly _onDidBatchProgress = this._register(new Emitter<{ completed: number; total: number }>());
	readonly onDidBatchProgress: Event<{ completed: number; total: number }> = this._onDidBatchProgress.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IAphroditeService private readonly aphroditeService: IAphroditeService
	) {
		super();
		// Node content changed: mark stale for incremental re-indexing
		// or drop the entry if auto-reindex is disabled
		this._register(this.hypergraphStore.onDidChangeNode(node => {
			const entry = this._index.get(node.id);
			if (entry && entry.contentHash !== this._contentHash(node)) {
				if (this._autoReindexEnabled) {
					this._staleNodeIds.add(node.id);
				} else {
					this._index.delete(node.id);
				}
			}
		}));

		// Clean up auto-reindex timer on dispose
		this._register({
			dispose: () => {
				if (this._autoReindexTimer) {
					clearInterval(this._autoReindexTimer);
					this._autoReindexTimer = undefined;
				}
			}
		});

		this.logService.info('HypergraphSemanticSearchService: initialized');
	}

	// -- Indexing ----------------------------------------------------------

	async indexNode(nodeId: string): Promise<boolean> {
		const node = this.hypergraphStore.getNode(nodeId);
		if (!node) {
			return false;
		}
		await this._ensureIndexed(node);
		return true;
	}

	async indexAll(nodeTypes?: string[]): Promise<number> {
		const nodes = nodeTypes && nodeTypes.length > 0
			? nodeTypes.flatMap(type => this.hypergraphStore.getNodesByType(type))
			: this.hypergraphStore.getAllNodes();

		const indexed = await this._ensureIndexedBatch(nodes);
		this.logService.info(`HypergraphSemanticSearchService: indexed ${indexed}/${nodes.length} node(s)`);
		return indexed;
	}

	// -- Search --------------------------------------------------------------

	async search(query: string, topK: number = 10, nodeTypes?: string[]): Promise<SemanticSearchResult[]> {
		this.membraneService.recordActivity('cerebral');

		const candidates = nodeTypes && nodeTypes.length > 0
			? nodeTypes.flatMap(type => this.hypergraphStore.getNodesByType(type))
			: this.hypergraphStore.getAllNodes();

		if (candidates.length === 0 || query.trim().length === 0) {
			return [];
		}

		await this._ensureIndexedBatch(candidates);

		const queryVector = await this._embed(query);
		const results: SemanticSearchResult[] = [];
		for (const node of candidates) {
			const entry = this._index.get(node.id);
			if (!entry) {
				continue;
			}
			const score = cosineSimilarity(queryVector, entry.vector);
			results.push({ node, score });
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, Math.max(0, topK));
	}

	// -- Queries ---------------------------------------------------------------

	isIndexed(nodeId: string): boolean {
		const node = this.hypergraphStore.getNode(nodeId);
		const entry = this._index.get(nodeId);
		return !!node && !!entry && entry.contentHash === this._contentHash(node);
	}

	getIndexedCount(): number {
		return this._index.size;
	}

	clear(): void {
		this._index.clear();
		this.logService.info('HypergraphSemanticSearchService: cleared semantic index');
	}

	// -- Internals ------------------------------------------------------------

	private async _ensureIndexed(node: HypergraphNode): Promise<void> {
		const contentHash = this._contentHash(node);
		const source = this._currentSource();
		const existing = this._index.get(node.id);
		if (existing && existing.contentHash === contentHash && existing.source === source) {
			return;
		}

		this.membraneService.recordActivity('cerebral');
		const vector = await this._embed(nodeEmbeddingText(node));
		this._index.set(node.id, { vector, contentHash, source, lastAccessTime: Date.now() });
		this._staleNodeIds.delete(node.id);
		this._reIndexedCount++;
		this._onDidIndexNode.fire(node.id);

		// LRU eviction if cache exceeds size limit
		this._enforceMaxCacheSize();
	}

	/**
	 * Index every node in `nodes` that isn't already cached under its current
	 * content hash / embedding source, embedding all of them in as few
	 * `embed()` calls as the connected backend's batch size allows instead of
	 * one call per node. Returns the number of nodes (re-)indexed.
	 */
	private async _ensureIndexedBatch(nodes: readonly HypergraphNode[]): Promise<number> {
		const source = this._currentSource();
		const toIndex: { node: HypergraphNode; contentHash: string }[] = [];
		for (const node of nodes) {
			const contentHash = this._contentHash(node);
			const existing = this._index.get(node.id);
			if (existing && existing.contentHash === contentHash && existing.source === source) {
				continue;
			}
			toIndex.push({ node, contentHash });
		}

		if (toIndex.length === 0) {
			return 0;
		}

		this.membraneService.recordActivity('cerebral');
		const vectors = await this._embedTextsBatched(toIndex.map(({ node }) => nodeEmbeddingText(node)));

		for (let i = 0; i < toIndex.length; i++) {
			const { node, contentHash } = toIndex[i];
			this._index.set(node.id, { vector: vectors[i], contentHash, source, lastAccessTime: Date.now() });
			this._staleNodeIds.delete(node.id);
			this._reIndexedCount++;
			this._onDidIndexNode.fire(node.id);
		}

		// LRU eviction if cache exceeds size limit
		this._enforceMaxCacheSize();

		return toIndex.length;
	}

	/**
	 * Embed multiple texts using as few `embed()` calls as the connected
	 * backend's configured batch size allows (chunking when there are more
	 * texts than fit in one request). Falls back to the local hashing-trick
	 * embedding per-text when disconnected - there's no network call to
	 * batch in that case.
	 */
	private async _embedTextsBatched(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}
		if (!this.aphroditeService.isConnected()) {
			return texts.map(text => localEmbed(text));
		}

		const batchSize = Math.max(1, this.aphroditeService.getConfig().maxBatchSize);
		const vectors: number[][] = new Array(texts.length);
		for (let i = 0; i < texts.length; i += batchSize) {
			const chunk = texts.slice(i, i + batchSize);
			try {
				const response = await this.aphroditeService.embed({ texts: chunk });
				for (let j = 0; j < chunk.length; j++) {
					const vector = response.embeddings[j];
					vectors[i + j] = vector && vector.length > 0 ? vector : localEmbed(chunk[j]);
				}
			} catch (err) {
				this.logService.warn(`HypergraphSemanticSearchService: batch embed() failed, falling back to local embedding: ${err instanceof Error ? err.message : String(err)}`);
				for (let j = 0; j < chunk.length; j++) {
					vectors[i + j] = localEmbed(chunk[j]);
				}
			}
		}
		return vectors;
	}

	private _currentSource(): SemanticEmbeddingSource {
		return this.aphroditeService.isConnected() ? 'aphrodite' : 'local';
	}

	private async _embed(text: string): Promise<number[]> {
		// Check cache first
		const cacheKey = `${this._currentSource()}:${fnv1a(text)}`;
		const existing = this._findCachedEmbedding(cacheKey);
		if (existing) {
			this._cacheHitCount++;
			return existing;
		}
		this._cacheMissCount++;

		if (this.aphroditeService.isConnected()) {
			try {
				const response = await this.aphroditeService.embed({ texts: [text] });
				const vector = response.embeddings[0];
				if (vector && vector.length > 0) {
					return vector;
				}
			} catch (err) {
				this.logService.warn(`HypergraphSemanticSearchService: Aphrodite embed() failed, falling back to local embedding: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		return localEmbed(text);
	}

	private _contentHash(node: HypergraphNode): string {
		return String(fnv1a(nodeEmbeddingText(node)));
	}

	private _findCachedEmbedding(_cacheKey: string): number[] | undefined {
		// Cache lookup based on content hash is implicitly done via the index entries
		// For direct embedding cache, we rely on the index entries themselves
		return undefined;
	}

	private _enforceMaxCacheSize(): void {
		const currentSize = this._estimateCacheSize();
		if (currentSize <= this._maxCacheSizeBytes) {
			return;
		}

		// Sort entries by last access time (oldest first)
		const entries = Array.from(this._index.entries())
			.sort((a, b) => a[1].lastAccessTime - b[1].lastAccessTime);

		// Evict oldest entries until we're under the limit
		let removedSize = 0;
		const targetSize = this._maxCacheSizeBytes * 0.8; // Evict to 80% to avoid thrashing
		let evictionCount = 0;

		for (const [nodeId, entry] of entries) {
			if (currentSize - removedSize <= targetSize) {
				break;
			}
			const entrySize = entry.vector.length * BYTES_PER_DIMENSION;
			this._index.delete(nodeId);
			removedSize += entrySize;
			evictionCount++;
		}

		this._cacheEvictionCount += evictionCount;
		this._onDidUpdateCache.fire(this.getCacheStats());
		this.logService.info(`HypergraphSemanticSearchService: evicted ${evictionCount} entries for cache limit`);
	}

	private _estimateCacheSize(): number {
		let size = 0;
		for (const entry of this._index.values()) {
			size += entry.vector.length * BYTES_PER_DIMENSION;
		}
		return size;
	}

	// -- Batch Embedding (A.2) ----------------------------------------------

	async batchEmbed(request: BatchEmbeddingRequest): Promise<BatchEmbeddingResult> {
		this.membraneService.recordActivity('cerebral');
		const startTime = Date.now();
		const batchSize = request.batchSize ?? DEFAULT_BATCH_SIZE;

		let successCount = 0;
		let failureCount = 0;
		const failedNodeIds: string[] = [];

		// Process nodes in batches
		for (let i = 0; i < request.nodeIds.length; i += batchSize) {
			const batchNodeIds = request.nodeIds.slice(i, i + batchSize);
			const batchNodes: HypergraphNode[] = [];
			const batchTexts: string[] = [];

			for (const nodeId of batchNodeIds) {
				const node = this.hypergraphStore.getNode(nodeId);
				if (node) {
					batchNodes.push(node);
					batchTexts.push(nodeEmbeddingText(node));
				} else {
					failedNodeIds.push(nodeId);
					failureCount++;
				}
			}

			if (batchTexts.length > 0) {
				try {
					let embeddings: number[][];
					if (this.aphroditeService.isConnected()) {
						const response = await this.aphroditeService.embed({ texts: batchTexts });
						embeddings = response.embeddings;
					} else {
						embeddings = batchTexts.map(text => localEmbed(text));
					}

					const source = this._currentSource();
					for (let j = 0; j < batchNodes.length; j++) {
						const node = batchNodes[j];
						const vector = embeddings[j];
						if (vector && vector.length > 0) {
							const contentHash = this._contentHash(node);
							this._index.set(node.id, { vector, contentHash, source, lastAccessTime: Date.now() });
							this._staleNodeIds.delete(node.id);
							this._reIndexedCount++;
							this._onDidIndexNode.fire(node.id);
							successCount++;
						} else {
							failedNodeIds.push(node.id);
							failureCount++;
						}
					}
				} catch (err) {
					// Batch failed, mark all as failed
					this.logService.warn(`HypergraphSemanticSearchService: batch embed failed: ${err instanceof Error ? err.message : String(err)}`);
					for (const node of batchNodes) {
						failedNodeIds.push(node.id);
						failureCount++;
					}
				}
			}

			// Report progress
			const completed = Math.min(i + batchSize, request.nodeIds.length);
			this._onDidBatchProgress.fire({ completed, total: request.nodeIds.length });
			if (request.onProgress) {
				request.onProgress(completed, request.nodeIds.length);
			}
		}

		this._enforceMaxCacheSize();
		const totalTimeMs = Date.now() - startTime;
		this.logService.info(`HypergraphSemanticSearchService: batch embed completed - ${successCount} success, ${failureCount} failed in ${totalTimeMs}ms`);

		return { successCount, failureCount, failedNodeIds, totalTimeMs };
	}

	// -- Embedding Cache (A.2) ----------------------------------------------

	getCacheStats(): EmbeddingCacheStats {
		const sizeBytes = this._estimateCacheSize();
		const totalRequests = this._cacheHitCount + this._cacheMissCount;
		return {
			totalEntries: this._index.size,
			sizeBytes,
			maxSizeBytes: this._maxCacheSizeBytes,
			hitCount: this._cacheHitCount,
			missCount: this._cacheMissCount,
			hitRate: totalRequests > 0 ? this._cacheHitCount / totalRequests : 0,
			evictionCount: this._cacheEvictionCount
		};
	}

	setMaxCacheSize(sizeBytes: number): void {
		this._maxCacheSizeBytes = Math.max(1024, sizeBytes); // Min 1KB
		this._enforceMaxCacheSize();
		this._onDidUpdateCache.fire(this.getCacheStats());
		this.logService.info(`HypergraphSemanticSearchService: max cache size set to ${sizeBytes} bytes`);
	}

	clearCache(): void {
		this._index.clear();
		this._cacheHitCount = 0;
		this._cacheMissCount = 0;
		this._cacheEvictionCount = 0;
		this._onDidUpdateCache.fire(this.getCacheStats());
		this.logService.info('HypergraphSemanticSearchService: cache cleared');
	}

	async persistCache(): Promise<void> {
		this.membraneService.recordActivity('autonomic');

		// Check if IndexedDB is available
		if (typeof indexedDB === 'undefined') {
			this.logService.warn('HypergraphSemanticSearchService: IndexedDB not available, cannot persist cache');
			return;
		}

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(CACHE_DB_NAME, 1);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
					db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'nodeId' });
				}
			};

			request.onsuccess = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				try {
					const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
					const store = transaction.objectStore(CACHE_STORE_NAME);

					// Clear existing data
					store.clear();

					// Write all entries
					for (const [nodeId, entry] of this._index.entries()) {
						store.put({
							nodeId,
							vector: entry.vector,
							contentHash: entry.contentHash,
							source: entry.source,
							lastAccessTime: entry.lastAccessTime
						});
					}

					transaction.oncomplete = () => {
						db.close();
						this.logService.info(`HypergraphSemanticSearchService: persisted ${this._index.size} cache entries`);
						resolve();
					};

					transaction.onerror = () => {
						db.close();
						reject(new Error('Failed to persist cache'));
					};
				} catch (err) {
					db.close();
					reject(err);
				}
			};

			request.onerror = () => {
				reject(new Error('Failed to open IndexedDB'));
			};
		});
	}

	async loadCache(): Promise<boolean> {
		this.membraneService.recordActivity('autonomic');

		// Check if IndexedDB is available
		if (typeof indexedDB === 'undefined') {
			this.logService.warn('HypergraphSemanticSearchService: IndexedDB not available, cannot load cache');
			return false;
		}

		return new Promise((resolve) => {
			const request = indexedDB.open(CACHE_DB_NAME, 1);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
					db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'nodeId' });
				}
			};

			request.onsuccess = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				try {
					const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
					const store = transaction.objectStore(CACHE_STORE_NAME);
					const getAllRequest = store.getAll();

					getAllRequest.onsuccess = () => {
						const entries = getAllRequest.result;
						let loadedCount = 0;
						for (const entry of entries) {
							// Only load if node still exists and content matches
							const node = this.hypergraphStore.getNode(entry.nodeId);
							if (node && this._contentHash(node) === entry.contentHash) {
								this._index.set(entry.nodeId, {
									vector: entry.vector,
									contentHash: entry.contentHash,
									source: entry.source,
									lastAccessTime: entry.lastAccessTime
								});
								loadedCount++;
							}
						}
						db.close();
						this.logService.info(`HypergraphSemanticSearchService: loaded ${loadedCount} cache entries from IndexedDB`);
						this._onDidUpdateCache.fire(this.getCacheStats());
						resolve(loadedCount > 0);
					};

					getAllRequest.onerror = () => {
						db.close();
						this.logService.warn('HypergraphSemanticSearchService: failed to load cache from IndexedDB');
						resolve(false);
					};
				} catch {
					db.close();
					resolve(false);
				}
			};

			request.onerror = () => {
				this.logService.warn('HypergraphSemanticSearchService: failed to open IndexedDB for cache load');
				resolve(false);
			};
		});
	}

	// -- Incremental Re-indexing (A.2) --------------------------------------

	getIncrementalIndexStats(): IncrementalIndexStats {
		return {
			pendingCount: this._staleNodeIds.size,
			reIndexedCount: this._reIndexedCount,
			autoReindexEnabled: this._autoReindexEnabled,
			autoReindexBatchSize: this._autoReindexBatchSize,
			lastAutoReindexTime: this._lastAutoReindexTime
		};
	}

	setAutoReindex(enabled: boolean, batchSize?: number): void {
		this._autoReindexEnabled = enabled;
		if (batchSize !== undefined) {
			this._autoReindexBatchSize = Math.max(1, batchSize);
		}

		// Clear existing timer
		if (this._autoReindexTimer) {
			clearInterval(this._autoReindexTimer);
			this._autoReindexTimer = undefined;
		}

		// Start new timer if enabled
		if (enabled) {
			this._autoReindexTimer = setInterval(() => {
				// Nothing awaits this background pass, so swallow-and-log rather
				// than let a rejection escape as an unhandled promise rejection.
				this._performAutoReindex().catch(err => {
					this.logService.error(`HypergraphSemanticSearchService: auto-reindex failed: ${err}`);
				});
			}, AUTO_REINDEX_INTERVAL_MS);
		}

		this.logService.info(`HypergraphSemanticSearchService: auto-reindex ${enabled ? 'enabled' : 'disabled'}, batch size: ${this._autoReindexBatchSize}`);
	}

	private async _performAutoReindex(): Promise<void> {
		if (this._staleNodeIds.size === 0) {
			return;
		}

		this._lastAutoReindexTime = Date.now();
		const count = await this.reindexStale(this._autoReindexBatchSize);
		if (count > 0) {
			this.logService.info(`HypergraphSemanticSearchService: auto-reindexed ${count} stale nodes`);
		}
	}

	async reindexStale(limit?: number): Promise<number> {
		this.membraneService.recordActivity('cerebral');

		const nodeIds = Array.from(this._staleNodeIds);
		const toProcess = limit !== undefined ? nodeIds.slice(0, limit) : nodeIds;

		let reindexed = 0;
		for (const nodeId of toProcess) {
			const node = this.hypergraphStore.getNode(nodeId);
			if (node) {
				await this._ensureIndexed(node);
				reindexed++;
			} else {
				// Node no longer exists, remove from stale list
				this._staleNodeIds.delete(nodeId);
			}
		}

		return reindexed;
	}

	markStale(nodeId: string): void {
		const node = this.hypergraphStore.getNode(nodeId);
		if (node && this._index.has(nodeId)) {
			this._staleNodeIds.add(nodeId);
		}
	}

	getPendingReindex(): string[] {
		return Array.from(this._staleNodeIds);
	}

	// -- Dimension Reduction (A.2) ------------------------------------------

	async getReducedEmbeddings(config: DimensionReductionConfig, nodeIds?: string[]): Promise<ReducedEmbedding[]> {
		this.membraneService.recordActivity('cerebral');

		// Get embeddings for requested nodes (or all indexed nodes)
		const targetNodeIds = nodeIds ?? Array.from(this._index.keys());
		const embeddings: { nodeId: string; vector: number[] }[] = [];

		for (const nodeId of targetNodeIds) {
			const entry = this._index.get(nodeId);
			if (entry) {
				// Update last access time
				entry.lastAccessTime = Date.now();
				embeddings.push({ nodeId, vector: entry.vector });
			}
		}

		if (embeddings.length === 0) {
			return [];
		}

		const originalDimension = embeddings[0].vector.length;
		const targetDimensions = Math.min(config.targetDimensions, originalDimension);

		if (targetDimensions === originalDimension) {
			// No reduction needed
			return embeddings.map(e => ({
				nodeId: e.nodeId,
				coordinates: e.vector,
				originalDimension
			}));
		}

		// Apply PCA-like dimension reduction
		const reduced = this._applyPCA(embeddings.map(e => e.vector), targetDimensions);

		return embeddings.map((e, i) => ({
			nodeId: e.nodeId,
			coordinates: reduced[i],
			originalDimension
		}));
	}

	/**
	 * Simple PCA implementation via SVD-approximation using power iteration.
	 * For production use, a proper linear algebra library would be used.
	 */
	private _applyPCA(vectors: number[][], targetDims: number): number[][] {
		if (vectors.length === 0) {
			return [];
		}

		const n = vectors.length;
		const d = vectors[0].length;

		// Center the data
		const mean = new Array(d).fill(0);
		for (const vec of vectors) {
			for (let i = 0; i < d; i++) {
				mean[i] += vec[i] / n;
			}
		}

		const centered = vectors.map(vec => vec.map((v, i) => v - mean[i]));

		// Extract principal components via power iteration
		const components: number[][] = [];
		const deflatedData = centered.map(row => [...row]);

		for (let comp = 0; comp < targetDims && comp < Math.min(n, d); comp++) {
			// Initialize random vector
			let pc = new Array(d).fill(0).map(() => Math.random() - 0.5);
			pc = normalize(pc);

			// Power iteration (simplified)
			for (let iter = 0; iter < 100; iter++) {
				// Compute X^T * X * pc
				const projections = deflatedData.map(row => {
					let dot = 0;
					for (let i = 0; i < d; i++) {
						dot += row[i] * pc[i];
					}
					return dot;
				});

				const newPc = new Array(d).fill(0);
				for (let i = 0; i < n; i++) {
					for (let j = 0; j < d; j++) {
						newPc[j] += deflatedData[i][j] * projections[i];
					}
				}

				pc = normalize(newPc);
			}

			components.push(pc);

			// Deflate: remove this component from data
			const scores = deflatedData.map(row => {
				let dot = 0;
				for (let i = 0; i < d; i++) {
					dot += row[i] * pc[i];
				}
				return dot;
			});

			for (let i = 0; i < n; i++) {
				for (let j = 0; j < d; j++) {
					deflatedData[i][j] -= scores[i] * pc[j];
				}
			}
		}

		// Project data onto components
		return centered.map(row => {
			const projection = new Array(targetDims).fill(0);
			for (let c = 0; c < components.length; c++) {
				for (let i = 0; i < d; i++) {
					projection[c] += row[i] * components[c][i];
				}
			}
			return projection;
		});
	}

	getEmbedding(nodeId: string): number[] | undefined {
		const entry = this._index.get(nodeId);
		if (entry) {
			entry.lastAccessTime = Date.now();
			return entry.vector;
		}
		return undefined;
	}

	getEmbeddingDimension(): number {
		// Return the dimension of the first indexed embedding, or local fallback dimension
		const firstEntry = this._index.values().next().value;
		if (firstEntry) {
			return firstEntry.vector.length;
		}
		return this.aphroditeService.isConnected() ? 0 : LOCAL_EMBEDDING_DIM;
	}
}
