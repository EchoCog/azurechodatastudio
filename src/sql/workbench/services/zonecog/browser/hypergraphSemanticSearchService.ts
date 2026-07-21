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

		let indexed = 0;
		for (const node of nodes) {
			const before = this._index.get(node.id);
			await this._ensureIndexed(node);
			if (!before || before !== this._index.get(node.id)) {
				indexed++;
			}
		}
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

		for (const node of candidates) {
			await this._ensureIndexed(node);
		}

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
		this._index.set(node.id, { vector, contentHash, source });
		this._onDidIndexNode.fire(node.id);
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
