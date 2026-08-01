/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

export const IHypergraphSemanticSearchService = createDecorator<IHypergraphSemanticSearchService>('hypergraphSemanticSearchService');

/**
 * The embedding source used to vectorize a piece of text.
 * 'aphrodite' is used when `IAphroditeService.isConnected()`; a candidate
 * set must be re-embedded on a source change so that queries and indexed
 * vectors always compare like-for-like.
 */
export type SemanticEmbeddingSource = 'aphrodite' | 'local';

/**
 * A hypergraph node ranked by cosine similarity to a search query.
 */
export interface SemanticSearchResult {
	node: HypergraphNode;
	/** Cosine similarity in [-1, 1] (in practice [0, 1] for non-negative local vectors). */
	score: number;
}

/**
 * Embedding cache statistics.
 */
export interface EmbeddingCacheStats {
	/** Total entries in cache */
	totalEntries: number;
	/** Cache size in bytes (estimated) */
	sizeBytes: number;
	/** Maximum cache size in bytes */
	maxSizeBytes: number;
	/** Cache hit count */
	hitCount: number;
	/** Cache miss count */
	missCount: number;
	/** Cache hit rate (0-1) */
	hitRate: number;
	/** Cache eviction count */
	evictionCount: number;
}

/**
 * Batch embedding request for efficient hypergraph indexing.
 */
export interface BatchEmbeddingRequest {
	/** Node IDs to embed */
	nodeIds: string[];
	/** Maximum batch size for API calls */
	batchSize?: number;
	/** Progress callback */
	onProgress?: (completed: number, total: number) => void;
}

/**
 * Batch embedding result.
 */
export interface BatchEmbeddingResult {
	/** Number of nodes successfully embedded */
	successCount: number;
	/** Number of nodes that failed to embed */
	failureCount: number;
	/** Node IDs that failed */
	failedNodeIds: string[];
	/** Total time in milliseconds */
	totalTimeMs: number;
}

/**
 * Dimension reduction configuration for visualization.
 */
export interface DimensionReductionConfig {
	/** Target number of dimensions */
	targetDimensions: number;
	/** Reduction method */
	method: 'pca';
	/** Whether to preserve distances as much as possible */
	preserveDistances: boolean;
}

/**
 * Reduced-dimension embedding for visualization.
 */
export interface ReducedEmbedding {
	/** Node ID */
	nodeId: string;
	/** Reduced coordinates */
	coordinates: number[];
	/** Original embedding dimension */
	originalDimension: number;
}

/**
 * Incremental re-indexing statistics.
 */
export interface IncrementalIndexStats {
	/** Number of nodes pending re-indexing */
	pendingCount: number;
	/** Number of nodes re-indexed since last clear */
	reIndexedCount: number;
	/** Whether auto-reindexing is enabled */
	autoReindexEnabled: boolean;
	/** Auto-reindex batch size */
	autoReindexBatchSize: number;
	/** Last auto-reindex timestamp */
	lastAutoReindexTime?: number;
}

/**
 * Hypergraph Semantic Search service.
 *
 * Closes the "Embedding Support - vector embeddings for hypergraph semantic
 * search" item from the Aphrodite deep-integration plan (issue #53, 5.3):
 * indexed hypergraph nodes are embedded via `IAphroditeService.embed()` when
 * an Aphrodite engine is connected, falling back to a deterministic local
 * hashing-trick bag-of-words embedding otherwise (works with no external
 * dependency, mirroring the built-in rule-based LLM fallback). Search ranks
 * nodes by cosine similarity to an embedded query string, going beyond the
 * exact node-type / keyword matching `IHypergraphStore` and
 * `IFederatedQueryService` provide.
 */
export interface IHypergraphSemanticSearchService {
	readonly _serviceBrand: undefined;

	/** Fired with the node id whenever a node is (re-)indexed. */
	readonly onDidIndexNode: Event<string>;

	/** Fired when the embedding cache is updated. */
	readonly onDidUpdateCache: Event<EmbeddingCacheStats>;

	/** Fired when batch embedding progress is made. */
	readonly onDidBatchProgress: Event<{ completed: number; total: number }>;

	/**
	 * Embed and index a single hypergraph node. No-ops (returns false) if the
	 * node does not exist. Returns true if the node was (re-)embedded or was
	 * already up to date.
	 */
	indexNode(nodeId: string): Promise<boolean>;

	/**
	 * Embed and index every hypergraph node, optionally restricted to the
	 * given node types. Returns the number of nodes indexed or refreshed.
	 */
	indexAll(nodeTypes?: string[]): Promise<number>;

	/**
	 * Embed `query` and rank indexed hypergraph nodes by cosine similarity.
	 * Any matching node that is unindexed or stale is embedded first, so a
	 * search always reflects current node content. Results are sorted by
	 * descending score.
	 */
	search(query: string, topK?: number, nodeTypes?: string[]): Promise<SemanticSearchResult[]>;

	/** Whether a node is currently indexed with an up-to-date embedding. */
	isIndexed(nodeId: string): boolean;

	/** Number of nodes currently indexed. */
	getIndexedCount(): number;

	/** Drop all indexed embeddings. */
	clear(): void;

	// --- Batch Embedding (A.2) ---

	/**
	 * Embed multiple nodes in batches for efficient hypergraph indexing.
	 * More efficient than calling indexNode() repeatedly.
	 */
	batchEmbed(request: BatchEmbeddingRequest): Promise<BatchEmbeddingResult>;

	// --- Embedding Cache (A.2) ---

	/**
	 * Get embedding cache statistics.
	 */
	getCacheStats(): EmbeddingCacheStats;

	/**
	 * Set the maximum cache size in bytes.
	 */
	setMaxCacheSize(sizeBytes: number): void;

	/**
	 * Clear the embedding cache.
	 */
	clearCache(): void;

	/**
	 * Persist the embedding cache to IndexedDB.
	 */
	persistCache(): Promise<void>;

	/**
	 * Load the embedding cache from IndexedDB.
	 */
	loadCache(): Promise<boolean>;

	// --- Incremental Re-indexing (A.2) ---

	/**
	 * Get incremental indexing statistics.
	 */
	getIncrementalIndexStats(): IncrementalIndexStats;

	/**
	 * Enable or disable automatic incremental re-indexing.
	 */
	setAutoReindex(enabled: boolean, batchSize?: number): void;

	/**
	 * Manually trigger incremental re-indexing of stale nodes.
	 */
	reindexStale(limit?: number): Promise<number>;

	/**
	 * Mark a node as needing re-indexing (e.g., after content update).
	 */
	markStale(nodeId: string): void;

	/**
	 * Get the list of node IDs pending re-indexing.
	 */
	getPendingReindex(): string[];

	// --- Dimension Reduction (A.2) ---

	/**
	 * Get embeddings reduced to lower dimensions for visualization.
	 * Uses PCA for dimension reduction.
	 */
	getReducedEmbeddings(config: DimensionReductionConfig, nodeIds?: string[]): Promise<ReducedEmbedding[]>;

	/**
	 * Get the raw embedding vector for a node.
	 */
	getEmbedding(nodeId: string): number[] | undefined;

	/**
	 * Get the embedding dimension (depends on source).
	 */
	getEmbeddingDimension(): number;
}
