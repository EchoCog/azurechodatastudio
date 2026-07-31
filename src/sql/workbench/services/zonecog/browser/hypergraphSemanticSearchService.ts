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
	SemanticSearchResult
} from 'sql/workbench/services/zonecog/common/hypergraphSemanticSearch';
import { IAphroditeService } from 'sql/workbench/services/zonecog/common/aphrodite';
import { IHypergraphStore, HypergraphNode, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';

/** Dimensionality of the deterministic local fallback embedding. */
const LOCAL_EMBEDDING_DIM = 128;

/** Maximum number of texts sent to `IAphroditeService.embed()` per batch request. */
const EMBED_BATCH_SIZE = 32;

/** Upper bound on the number of embeddings retained in memory; least-recently-used entries are evicted past this. */
const MAX_INDEX_ENTRIES = 5000;

interface IndexEntry {
	vector: number[];
	contentHash: string;
	source: SemanticEmbeddingSource;
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

	private readonly _index = new Map<string, IndexEntry>();

	private readonly _onDidIndexNode = this._register(new Emitter<string>());
	readonly onDidIndexNode: Event<string> = this._onDidIndexNode.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IAphroditeService private readonly aphroditeService: IAphroditeService
	) {
		super();
		// Node content changed: drop the stale entry so it is lazily
		// re-embedded the next time it is indexed or searched.
		this._register(this.hypergraphStore.onDidChangeNode(node => {
			const entry = this._index.get(node.id);
			if (entry && entry.contentHash !== this._contentHash(node)) {
				this._index.delete(node.id);
			}
		}));
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

		const stale = nodes.filter(node => this._isStale(node));
		if (stale.length === 0) {
			return 0;
		}

		this.membraneService.recordActivity('cerebral');
		await this._indexNodes(stale);
		this.logService.info(`HypergraphSemanticSearchService: indexed ${stale.length}/${nodes.length} node(s)`);
		return stale.length;
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

		const stale = candidates.filter(node => this._isStale(node));
		if (stale.length > 0) {
			await this._indexNodes(stale);
		}

		const queryVector = await this._embed(query);
		const results: SemanticSearchResult[] = [];
		for (const node of candidates) {
			const entry = this._index.get(node.id);
			if (!entry) {
				continue;
			}
			this._touch(node.id, entry);
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

	private _isStale(node: HypergraphNode): boolean {
		const entry = this._index.get(node.id);
		return !entry || entry.contentHash !== this._contentHash(node) || entry.source !== this._currentSource();
	}

	private async _ensureIndexed(node: HypergraphNode): Promise<void> {
		if (!this._isStale(node)) {
			return;
		}
		this.membraneService.recordActivity('cerebral');
		await this._indexNodes([node]);
	}

	/**
	 * Embed and index a set of stale nodes. When connected to Aphrodite, texts
	 * are sent in batches of `EMBED_BATCH_SIZE` per `embed()` call instead of
	 * one request per node, cutting round trips for large re-index runs.
	 */
	private async _indexNodes(nodes: HypergraphNode[]): Promise<void> {
		const source = this._currentSource();

		if (source === 'local') {
			for (const node of nodes) {
				this._setIndexEntry(node.id, { vector: localEmbed(nodeEmbeddingText(node)), contentHash: this._contentHash(node), source: 'local' });
			}
			return;
		}

		for (let i = 0; i < nodes.length; i += EMBED_BATCH_SIZE) {
			const batch = nodes.slice(i, i + EMBED_BATCH_SIZE);
			try {
				const response = await this.aphroditeService.embed({ texts: batch.map(nodeEmbeddingText) });
				batch.forEach((node, index) => {
					const vector = response.embeddings[index];
					if (vector && vector.length > 0) {
						this._setIndexEntry(node.id, { vector, contentHash: this._contentHash(node), source: 'aphrodite' });
					} else {
						this._setIndexEntry(node.id, { vector: localEmbed(nodeEmbeddingText(node)), contentHash: this._contentHash(node), source: 'local' });
					}
				});
			} catch (err) {
				this.logService.warn(`HypergraphSemanticSearchService: batch embed() failed for ${batch.length} node(s), falling back to local embedding: ${err instanceof Error ? err.message : String(err)}`);
				for (const node of batch) {
					this._setIndexEntry(node.id, { vector: localEmbed(nodeEmbeddingText(node)), contentHash: this._contentHash(node), source: 'local' });
				}
			}
		}
	}

	private _setIndexEntry(nodeId: string, entry: IndexEntry): void {
		this._index.delete(nodeId); // re-insert to mark as most-recently-used
		this._index.set(nodeId, entry);
		this._evictIfNeeded();
		this._onDidIndexNode.fire(nodeId);
	}

	/** Marks an entry as recently used by moving it to the end of the (LRU-ordered) index map. */
	private _touch(nodeId: string, entry: IndexEntry): void {
		this._index.delete(nodeId);
		this._index.set(nodeId, entry);
	}

	private _evictIfNeeded(): void {
		while (this._index.size > MAX_INDEX_ENTRIES) {
			const oldestKey = this._index.keys().next().value;
			if (oldestKey === undefined) {
				break;
			}
			this._index.delete(oldestKey);
		}
	}

	private _currentSource(): SemanticEmbeddingSource {
		return this.aphroditeService.isConnected() ? 'aphrodite' : 'local';
	}

	private async _embed(text: string): Promise<number[]> {
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
}
