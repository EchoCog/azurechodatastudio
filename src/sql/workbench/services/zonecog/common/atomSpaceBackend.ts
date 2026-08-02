/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { TruthValue } from 'sql/workbench/services/zonecog/common/plnReasoning';

export const IAtomSpaceBackendService = createDecorator<IAtomSpaceBackendService>('atomSpaceBackendService');

// ---------------------------------------------------------------------------
// Native AtomSpace atom model (OpenCog Hyperon)
// ---------------------------------------------------------------------------

/**
 * OpenCog-style attention value. `sti` (short-term importance) is the
 * lossless carrier for the hypergraph `salience_score`; `lti` (long-term
 * importance) and `vlti` (very-long-term importance flag) follow the
 * classic ECAN attention value triple.
 */
export interface AttentionValue {
	/** Short-term importance in [0, 1] - carries the hypergraph salience. */
	sti: number;
	/** Long-term importance in [0, 1]. */
	lti: number;
	/** Very-long-term importance ("do not forget") flag. */
	vlti: boolean;
}

export type AtomKind = 'Node' | 'Link';

interface AtomBase {
	/** Stable content-addressed AtomSpace handle. */
	handle: string;
	kind: AtomKind;
	/**
	 * AtomSpace atom type name. Node types end in `Node` (e.g. `ConceptNode`,
	 * `TableNode`), link types end in `Link` (e.g. `InheritanceLink`,
	 * `EvaluationLink`).
	 */
	type: string;
	/** PLN simple truth value (strength/confidence). */
	truthValue: TruthValue;
	/** ECAN attention value. */
	attentionValue: AttentionValue;
	/**
	 * Arbitrary values attached to the atom, mirroring the AtomSpace
	 * key→value store on atoms. Used to carry the original hypergraph id
	 * (`hypergraph:id`) and metadata (`hypergraph:metadata`) so the
	 * HypergraphNode ↔ Atom mapping is fully round-trippable.
	 */
	values: Record<string, unknown>;
}

/** A named node atom - identity is (type, name), per AtomSpace semantics. */
export interface NodeAtom extends AtomBase {
	kind: 'Node';
	name: string;
}

/** A link atom - identity is (type, outgoing handles), per AtomSpace semantics. */
export interface LinkAtom extends AtomBase {
	kind: 'Link';
	/** Ordered handles of the atoms this link connects. */
	outgoing: string[];
}

export type Atom = NodeAtom | LinkAtom;

// ---------------------------------------------------------------------------
// Truth value ↔ salience conversion
// ---------------------------------------------------------------------------

/**
 * Evidence-count constant `K` in the OpenCog count→confidence formula
 * `confidence = n / (n + K)`. Chosen so the default evidence count yields
 * confidence 0.5, matching the PLN reasoning service's default link
 * confidence.
 */
export const TRUTH_VALUE_LOOKAHEAD_K = 10;

/** Default evidence count backing a salience-derived truth value. */
export const DEFAULT_EVIDENCE_COUNT = 10;

// ---------------------------------------------------------------------------
// Pattern matching (BindLink / GetLink)
// ---------------------------------------------------------------------------

/**
 * A term inside a pattern-matcher query. Terms form a tree mirroring the
 * atoms they match:
 *  - `variable` terms bind to any atom (subject to declared type restrictions),
 *  - `node` terms match node atoms by type and/or name (omitted = wildcard),
 *  - `link` terms match link atoms by type and recursively by outgoing terms.
 */
export type PatternTerm =
	| { kind: 'variable'; name: string }
	| { kind: 'node'; type?: string; name?: string }
	| { kind: 'link'; type?: string; outgoing: PatternTerm[] };

/** Declared query variable with an optional atom-type restriction. */
export interface VariableSpec {
	name: string;
	/** When set, the variable may only bind atoms of this exact type. */
	typeRestriction?: string;
}

/**
 * GetLink-style query: find all consistent variable groundings for
 * `pattern` against the atom table.
 */
export interface GetLinkQuery {
	variables: VariableSpec[];
	pattern: PatternTerm;
}

/**
 * BindLink-style query: for every grounding of `pattern`, instantiate
 * `rewrite` (creating any atoms it describes) - the AtomSpace's native
 * rewrite/production-rule primitive.
 */
export interface BindLinkQuery extends GetLinkQuery {
	rewrite: PatternTerm;
}

/** A single consistent grounding: variable name → bound atom handle. */
export type PatternBinding = Record<string, string>;

export interface PatternMatchResult {
	bindings: PatternBinding[];
	/** Number of atoms examined while matching. */
	atomsExamined: number;
}

export interface BindResult extends PatternMatchResult {
	/** Atoms instantiated (or resolved, when they already existed) by the rewrite. */
	instantiated: Atom[];
}

// ---------------------------------------------------------------------------
// Persistent store (AtomSpace-Rocks) types
// ---------------------------------------------------------------------------

/**
 * Configuration for the persistent AtomSpace backend connection. The
 * endpoint is either the ZoneCog Python bridge (which proxies to an
 * AtomSpace-Rocks storage node when `ATOMSPACE_MODE=http`) or a direct
 * AtomSpace REST endpoint.
 */
export interface AtomSpaceRocksConfig {
	/** Base URL of the bridge / AtomSpace-Rocks REST endpoint. */
	baseUrl: string;
	/** Request timeout in milliseconds. */
	timeoutMs: number;
	/** Optional bearer token forwarded as `Authorization`. */
	authToken?: string;
	/** Page size used for streaming atom retrieval. */
	pageSize: number;
	/**
	 * When true, request bodies larger than `compressionThresholdBytes` are
	 * gzip-compressed (`Content-Encoding: gzip`) - only applied when the
	 * connected backend advertised the `gzip` capability during `connect()`.
	 */
	compressionEnabled: boolean;
	/** Minimum payload size in bytes before compression is applied. */
	compressionThresholdBytes: number;
}

export type AtomSpaceConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** One page of a streaming atom retrieval. */
export interface AtomPage {
	atoms: Atom[];
	/** Cursor for the next page, or undefined when this is the last page. */
	nextCursor?: string;
	/** Total atoms available, when the backend reports it. */
	total?: number;
}

export interface AtomSpacePersistResult {
	success: boolean;
	atomCount: number;
	/** Serialized payload size before compression. */
	uncompressedBytes: number;
	/** Wire size actually sent (equals uncompressedBytes when not compressed). */
	transferBytes: number;
	/** Whether gzip compression was applied to the transfer. */
	compressed: boolean;
	durationMs: number;
	error?: string;
}

export interface AtomSpaceImportResult {
	nodesImported: number;
	linksImported: number;
	/** Hypergraph nodes that merged into an existing atom (same type+name). */
	duplicatesMerged: number;
	/** Hypergraph link ids skipped because they referenced missing nodes. */
	danglingSkipped: string[];
}

export interface AtomSpaceExportResult {
	nodesExported: number;
	linksExported: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * OpenCog Hyperon AtomSpace backend service (Phase B).
 *
 * Provides a native AtomSpace storage interface over the ZoneCog
 * hypergraph: a content-addressed atom table with AtomSpace identity
 * semantics (nodes unique by type+name, links unique by type+outgoing),
 * PLN truth values converted from hypergraph salience, ECAN attention
 * values, a BindLink/GetLink pattern-matching query engine, and a
 * persistent connection to an AtomSpace-Rocks storage node (via the
 * ZoneCog Python bridge) with lazy loading, paginated streaming
 * retrieval, and gzip-compressed network transfer.
 */
export interface IAtomSpaceBackendService {
	readonly _serviceBrand: undefined;

	/** Fired when an atom is added to (or upserted into) the atom table. */
	readonly onDidAddAtom: Event<Atom>;

	/** Fired when an atom is removed from the atom table. */
	readonly onDidRemoveAtom: Event<Atom>;

	/** Fired whenever the persistent-store connection state changes. */
	readonly onDidChangeConnectionState: Event<AtomSpaceConnectionState>;

	/** Fired after every persist attempt, success or failure. */
	readonly onDidPersist: Event<AtomSpacePersistResult>;

	// -- Native atom operations ---------------------------------------------

	/**
	 * Upsert a node atom. Per AtomSpace semantics the atom's identity is
	 * (type, name): adding the same node twice returns the same atom, with
	 * truth value merged by confidence-weighted revision.
	 */
	addNode(type: string, name: string, truthValue?: TruthValue): NodeAtom;

	/**
	 * Upsert a link atom. Identity is (type, outgoing): adding the same
	 * link twice returns the same atom. Every outgoing handle must resolve
	 * to an existing atom.
	 */
	addLink(type: string, outgoing: string[], truthValue?: TruthValue): LinkAtom;

	getAtom(handle: string): Atom | undefined;
	getAtomsByType(type: string): Atom[];
	getAllAtoms(): Atom[];

	/** All link atoms whose outgoing set contains the given handle. */
	getIncoming(handle: string): LinkAtom[];

	/**
	 * Remove an atom. Removal fails when link atoms still reference the
	 * atom, unless `recursive` is set (which removes the incoming links too).
	 */
	removeAtom(handle: string, recursive?: boolean): boolean;

	atomCount(): number;

	/** Remove every atom from the atom table. */
	clear(): void;

	// -- Truth values ---------------------------------------------------------

	getTruthValue(handle: string): TruthValue | undefined;
	setTruthValue(handle: string, truthValue: TruthValue): void;

	// -- HypergraphNode ↔ Atom mapping ---------------------------------------

	/**
	 * Convert a hypergraph node to a node atom (without storing it). The
	 * hypergraph id and metadata are preserved on the atom's `values` bag,
	 * salience is carried losslessly as `attentionValue.sti` and converted
	 * to the truth value via `salienceToTruthValue`.
	 */
	hypergraphNodeToAtom(node: HypergraphNode): NodeAtom;

	/** Inverse of `hypergraphNodeToAtom` - fully round-trippable. */
	atomToHypergraphNode(atom: NodeAtom): HypergraphNode;

	/**
	 * Convert a hypergraph link to a link atom (without storing it). The
	 * outgoing hypergraph node ids are resolved to atom handles through the
	 * id→handle mapping built by `importFromHypergraph`. Truth value comes
	 * from the PLN reasoning service when one was assigned to the link.
	 */
	hypergraphLinkToAtom(link: HypergraphLink): LinkAtom;

	/** Inverse of `hypergraphLinkToAtom`. */
	atomToHypergraphLink(atom: LinkAtom): HypergraphLink;

	/**
	 * Import the entire hypergraph store into the atom table: all nodes
	 * first (recording the hypergraph-id → handle mapping), then all links
	 * (skipping ones with dangling node references, reported in the result).
	 */
	importFromHypergraph(): AtomSpaceImportResult;

	/**
	 * Export every atom carrying hypergraph provenance back into the
	 * hypergraph store (upserting by original hypergraph id).
	 */
	exportToHypergraph(): AtomSpaceExportResult;

	// -- Pattern matching ------------------------------------------------------

	/** Execute a GetLink-style query: all consistent variable groundings. */
	get(query: GetLinkQuery): PatternMatchResult;

	/** Execute a BindLink-style query: ground the pattern, instantiate the rewrite. */
	bind(query: BindLinkQuery): BindResult;

	// -- Persistent store (AtomSpace-Rocks) ------------------------------------

	configure(config: Partial<AtomSpaceRocksConfig>): void;
	getConfig(): AtomSpaceRocksConfig;

	/**
	 * Probe the configured endpoint and transition to `connected` when
	 * reachable. Detects backend capabilities (e.g. gzip support) from the
	 * health response. Never throws.
	 */
	connect(): Promise<boolean>;

	disconnect(): void;
	getConnectionState(): AtomSpaceConnectionState;

	/**
	 * Lazily resolve an atom: served from the local atom table when cached,
	 * otherwise (when connected) fetched from the remote store page by page
	 * until found, caching every page seen along the way. Enables working
	 * against hypergraphs too large to load eagerly.
	 */
	loadAtom(handle: string): Promise<Atom | undefined>;

	/**
	 * Fetch one page of atoms. When connected, pages are retrieved from the
	 * remote store (with client-side windowing when the backend does not
	 * paginate); when disconnected, pages window over the local atom table
	 * with identical cursor semantics.
	 */
	fetchAtomPage(cursor: string | undefined, pageSize?: number): Promise<AtomPage>;

	/**
	 * Stream every atom via sequential page fetches - constant memory
	 * regardless of hypergraph size.
	 */
	streamAtoms(pageSize?: number): AsyncIterable<Atom>;

	/**
	 * Persist the entire atom table to the connected backend as an
	 * AtomSpace atom batch, gzip-compressing the payload when enabled,
	 * above the size threshold, and supported by the backend. Never throws -
	 * failures are reported in the returned/emitted result.
	 */
	persistAll(): Promise<AtomSpacePersistResult>;
}

// ---------------------------------------------------------------------------
// Conversion helpers (pure functions)
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
	if (Number.isNaN(n)) { return 0; }
	return Math.max(0, Math.min(1, n));
}

/**
 * Convert a hypergraph salience score into a PLN simple truth value.
 * Strength carries the salience directly; confidence follows the OpenCog
 * count→confidence formula `n / (n + K)` so callers with real evidence
 * counts get faithful confidences, while the default yields 0.5 - matching
 * the PLN reasoning service's default link confidence.
 */
export function salienceToTruthValue(salience: number, evidenceCount: number = DEFAULT_EVIDENCE_COUNT): TruthValue {
	const n = Math.max(0, evidenceCount);
	return {
		strength: clamp01(salience),
		confidence: clamp01(n / (n + TRUTH_VALUE_LOOKAHEAD_K)),
	};
}

/**
 * Convert a PLN truth value back into a salience score using Bayesian
 * shrinkage toward the uninformative prior 0.5: a fully-confident truth
 * value keeps its strength, a zero-confidence one collapses to 0.5.
 */
export function truthValueToSalience(truthValue: TruthValue): number {
	return clamp01(0.5 + (clamp01(truthValue.strength) - 0.5) * clamp01(truthValue.confidence));
}
