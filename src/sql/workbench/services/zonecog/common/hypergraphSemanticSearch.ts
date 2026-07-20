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
}
