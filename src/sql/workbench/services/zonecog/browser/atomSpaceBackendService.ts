/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	IAtomSpaceBackendService,
	Atom,
	NodeAtom,
	LinkAtom,
	AttentionValue,
	AtomSpaceRocksConfig,
	AtomSpaceConnectionState,
	AtomPage,
	AtomSpacePersistResult,
	AtomSpaceImportResult,
	AtomSpaceExportResult,
	GetLinkQuery,
	BindLinkQuery,
	PatternMatchResult,
	BindResult,
	PatternTerm,
	PatternBinding,
	salienceToTruthValue,
	truthValueToSalience,
	TRUTH_VALUE_LOOKAHEAD_K,
} from 'sql/workbench/services/zonecog/common/atomSpaceBackend';
import { TruthValue } from 'sql/workbench/services/zonecog/common/plnReasoning';
import { IPLNReasoningService } from 'sql/workbench/services/zonecog/common/plnReasoning';
import {
	IHypergraphStore,
	ICognitiveMembraneService,
	HypergraphNode,
	HypergraphLink,
} from 'sql/workbench/services/zonecog/common/zonecogService';

const DEFAULT_CONFIG: AtomSpaceRocksConfig = {
	baseUrl: 'http://127.0.0.1:7807',
	timeoutMs: 10000,
	authToken: undefined,
	pageSize: 256,
	compressionEnabled: true,
	compressionThresholdBytes: 1024,
};

const DEFAULT_LINK_STRENGTH = 0.9;
const DEFAULT_LINK_CONFIDENCE = 0.5;

/** Cap on the equivalent evidence count used during truth-value revision. */
const MAX_REVISION_COUNT = 10000;

/** Local-window cursor prefix used for offset-based pagination. */
const OFFSET_CURSOR_PREFIX = 'offset:';

// ---------------------------------------------------------------------------
// Content-addressed handles (FNV-1a 64-bit)
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

function fnv1a64(text: string): string {
	let hash = FNV_OFFSET_BASIS;
	for (let i = 0; i < text.length; i++) {
		hash ^= BigInt(text.charCodeAt(i));
		hash = (hash * FNV_PRIME) & FNV_MASK;
	}
	return hash.toString(16).padStart(16, '0');
}

/** Deterministic node handle - AtomSpace identity is (type, name). */
export function nodeHandle(type: string, name: string): string {
	return `n${fnv1a64(`${type}\u0000${name}`)}`;
}

/** Deterministic link handle - AtomSpace identity is (type, outgoing). */
export function linkHandle(type: string, outgoing: readonly string[]): string {
	return `l${fnv1a64(`${type}\u0000${outgoing.join('\u0000')}`)}`;
}

// ---------------------------------------------------------------------------
// gzip compression (web-standard CompressionStream, available in the
// Electron renderer and Node.js >= 18)
// ---------------------------------------------------------------------------

/** gzip-compress a string, returning the raw compressed bytes. */
export async function gzipCompress(text: string): Promise<Uint8Array> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
	const buffer = await new Response(stream).arrayBuffer();
	return new Uint8Array(buffer);
}

/** Inverse of `gzipCompress`. */
export async function gzipDecompress(data: Uint8Array): Promise<string> {
	const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Response(stream).text();
}

// ---------------------------------------------------------------------------
// Truth-value revision (OpenCog count-based revision rule)
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
	if (Number.isNaN(n)) { return 0; }
	return Math.max(0, Math.min(1, n));
}

function confidenceToCount(confidence: number): number {
	const c = clamp01(confidence);
	if (c >= 1) { return MAX_REVISION_COUNT; }
	return Math.min(MAX_REVISION_COUNT, (TRUTH_VALUE_LOOKAHEAD_K * c) / (1 - c));
}

function countToConfidence(count: number): number {
	return clamp01(count / (count + TRUTH_VALUE_LOOKAHEAD_K));
}

/**
 * Merge two truth values with the OpenCog revision rule: convert each
 * confidence to an equivalent evidence count, pool the evidence, and
 * compute the count-weighted mean strength.
 */
export function reviseTruthValues(a: TruthValue, b: TruthValue): TruthValue {
	const na = confidenceToCount(a.confidence);
	const nb = confidenceToCount(b.confidence);
	const n = na + nb;
	if (n <= 0) {
		return { strength: clamp01((a.strength + b.strength) / 2), confidence: 0 };
	}
	return {
		strength: clamp01((clamp01(a.strength) * na + clamp01(b.strength) * nb) / n),
		confidence: countToConfidence(Math.min(n, MAX_REVISION_COUNT)),
	};
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

/**
 * OpenCog Hyperon AtomSpace backend service (Phase B.1 + B.3).
 *
 * Maintains a native, content-addressed atom table with AtomSpace identity
 * semantics: node atoms are unique by (type, name), link atoms by
 * (type, outgoing), and re-adding an existing atom merges truth values via
 * the OpenCog revision rule. Provides bidirectional HypergraphNode ↔ Atom
 * mapping (salience carried losslessly as ECAN STI and converted to PLN
 * strength/confidence), a BindLink/GetLink pattern-matching engine, and a
 * persistent connection to an AtomSpace-Rocks storage node via the ZoneCog
 * Python bridge - with lazy loading, paginated streaming retrieval, and
 * gzip-compressed network transfer negotiated through the backend's
 * advertised capabilities.
 */
export class AtomSpaceBackendService extends Disposable implements IAtomSpaceBackendService {

	declare readonly _serviceBrand: undefined;

	private readonly _atoms = new Map<string, Atom>();
	private readonly _typeIndex = new Map<string, Set<string>>();
	private readonly _incomingIndex = new Map<string, Set<string>>();
	/** Original hypergraph id → atom handle, built during import. */
	private readonly _hypergraphIdToHandle = new Map<string, string>();

	private _config: AtomSpaceRocksConfig = { ...DEFAULT_CONFIG };
	private _connectionState: AtomSpaceConnectionState = 'disconnected';
	private _remoteGzipSupported = false;
	/** Cached remote snapshot used for client-side windowing across pages. */
	private _remoteSnapshot: Atom[] | undefined = undefined;

	private readonly _onDidAddAtom = this._register(new Emitter<Atom>());
	readonly onDidAddAtom: Event<Atom> = this._onDidAddAtom.event;

	private readonly _onDidRemoveAtom = this._register(new Emitter<Atom>());
	readonly onDidRemoveAtom: Event<Atom> = this._onDidRemoveAtom.event;

	private readonly _onDidChangeConnectionState = this._register(new Emitter<AtomSpaceConnectionState>());
	readonly onDidChangeConnectionState: Event<AtomSpaceConnectionState> = this._onDidChangeConnectionState.event;

	private readonly _onDidPersist = this._register(new Emitter<AtomSpacePersistResult>());
	readonly onDidPersist: Event<AtomSpacePersistResult> = this._onDidPersist.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IPLNReasoningService private readonly plnReasoningService: IPLNReasoningService
	) {
		super();
		this.logService.info('AtomSpaceBackendService: initialized native AtomSpace storage backend');
	}

	// -- Cloning helpers -------------------------------------------------------

	private static _cloneAtom(atom: Atom): Atom {
		if (atom.kind === 'Node') {
			return { ...atom, truthValue: { ...atom.truthValue }, attentionValue: { ...atom.attentionValue }, values: { ...atom.values } };
		}
		return { ...atom, outgoing: [...atom.outgoing], truthValue: { ...atom.truthValue }, attentionValue: { ...atom.attentionValue }, values: { ...atom.values } };
	}

	private static _defaultAttention(sti: number): AttentionValue {
		return { sti: clamp01(sti), lti: 0, vlti: false };
	}

	// -- Native atom operations ---------------------------------------------

	addNode(type: string, name: string, truthValue?: TruthValue): NodeAtom {
		const handle = nodeHandle(type, name);
		const existing = this._atoms.get(handle);
		if (existing && existing.kind === 'Node') {
			if (truthValue) {
				existing.truthValue = reviseTruthValues(existing.truthValue, truthValue);
			}
			return AtomSpaceBackendService._cloneAtom(existing) as NodeAtom;
		}
		const tv = truthValue
			? { strength: clamp01(truthValue.strength), confidence: clamp01(truthValue.confidence) }
			: salienceToTruthValue(0.5);
		const atom: NodeAtom = {
			handle,
			kind: 'Node',
			type,
			name,
			truthValue: tv,
			attentionValue: AtomSpaceBackendService._defaultAttention(truthValueToSalience(tv)),
			values: {},
		};
		this._storeAtom(atom);
		return AtomSpaceBackendService._cloneAtom(atom) as NodeAtom;
	}

	addLink(type: string, outgoing: string[], truthValue?: TruthValue): LinkAtom {
		for (const target of outgoing) {
			if (!this._atoms.has(target)) {
				throw new Error(`AtomSpaceBackendService: cannot add ${type} - outgoing atom ${target} does not exist`);
			}
		}
		const handle = linkHandle(type, outgoing);
		const existing = this._atoms.get(handle);
		if (existing && existing.kind === 'Link') {
			if (truthValue) {
				existing.truthValue = reviseTruthValues(existing.truthValue, truthValue);
			}
			return AtomSpaceBackendService._cloneAtom(existing) as LinkAtom;
		}
		const tv = truthValue
			? { strength: clamp01(truthValue.strength), confidence: clamp01(truthValue.confidence) }
			: { strength: DEFAULT_LINK_STRENGTH, confidence: DEFAULT_LINK_CONFIDENCE };
		const atom: LinkAtom = {
			handle,
			kind: 'Link',
			type,
			outgoing: [...outgoing],
			truthValue: tv,
			attentionValue: AtomSpaceBackendService._defaultAttention(truthValueToSalience(tv)),
			values: {},
		};
		this._storeAtom(atom);
		return AtomSpaceBackendService._cloneAtom(atom) as LinkAtom;
	}

	getAtom(handle: string): Atom | undefined {
		const atom = this._atoms.get(handle);
		return atom ? AtomSpaceBackendService._cloneAtom(atom) : undefined;
	}

	getAtomsByType(type: string): Atom[] {
		const handles = this._typeIndex.get(type);
		if (!handles) { return []; }
		const result: Atom[] = [];
		for (const handle of handles) {
			const atom = this._atoms.get(handle);
			if (atom) { result.push(AtomSpaceBackendService._cloneAtom(atom)); }
		}
		return result;
	}

	getAllAtoms(): Atom[] {
		return Array.from(this._atoms.values()).map(a => AtomSpaceBackendService._cloneAtom(a));
	}

	getIncoming(handle: string): LinkAtom[] {
		const incoming = this._incomingIndex.get(handle);
		if (!incoming) { return []; }
		const result: LinkAtom[] = [];
		for (const linkId of incoming) {
			const atom = this._atoms.get(linkId);
			if (atom && atom.kind === 'Link') { result.push(AtomSpaceBackendService._cloneAtom(atom) as LinkAtom); }
		}
		return result;
	}

	removeAtom(handle: string, recursive?: boolean): boolean {
		const atom = this._atoms.get(handle);
		if (!atom) { return false; }
		const incoming = this._incomingIndex.get(handle);
		if (incoming && incoming.size > 0) {
			if (!recursive) {
				this.logService.warn(`AtomSpaceBackendService: refusing to remove ${handle} - ${incoming.size} incoming link(s); pass recursive=true`);
				return false;
			}
			for (const linkId of [...incoming]) {
				this.removeAtom(linkId, true);
			}
		}
		this._atoms.delete(handle);
		this._typeIndex.get(atom.type)?.delete(handle);
		if (atom.kind === 'Link') {
			for (const target of atom.outgoing) {
				this._incomingIndex.get(target)?.delete(handle);
			}
		}
		this._incomingIndex.delete(handle);
		this._onDidRemoveAtom.fire(AtomSpaceBackendService._cloneAtom(atom));
		return true;
	}

	atomCount(): number {
		return this._atoms.size;
	}

	clear(): void {
		this._atoms.clear();
		this._typeIndex.clear();
		this._incomingIndex.clear();
		this._hypergraphIdToHandle.clear();
		this._remoteSnapshot = undefined;
	}

	private _storeAtom(atom: Atom): void {
		this._atoms.set(atom.handle, atom);
		let typeSet = this._typeIndex.get(atom.type);
		if (!typeSet) {
			typeSet = new Set<string>();
			this._typeIndex.set(atom.type, typeSet);
		}
		typeSet.add(atom.handle);
		if (atom.kind === 'Link') {
			for (const target of atom.outgoing) {
				let incoming = this._incomingIndex.get(target);
				if (!incoming) {
					incoming = new Set<string>();
					this._incomingIndex.set(target, incoming);
				}
				incoming.add(atom.handle);
			}
		}
		this._onDidAddAtom.fire(AtomSpaceBackendService._cloneAtom(atom));
	}

	// -- Truth values ---------------------------------------------------------

	getTruthValue(handle: string): TruthValue | undefined {
		const atom = this._atoms.get(handle);
		return atom ? { ...atom.truthValue } : undefined;
	}

	setTruthValue(handle: string, truthValue: TruthValue): void {
		const atom = this._atoms.get(handle);
		if (!atom) { return; }
		atom.truthValue = { strength: clamp01(truthValue.strength), confidence: clamp01(truthValue.confidence) };
	}

	// -- HypergraphNode ↔ Atom mapping ---------------------------------------

	private static _atomNodeType(nodeType: string): string {
		return nodeType.endsWith('Node') ? nodeType : `${nodeType}Node`;
	}

	private static _atomLinkType(linkType: string): string {
		return linkType.endsWith('Link') ? linkType : `${linkType}Link`;
	}

	hypergraphNodeToAtom(node: HypergraphNode): NodeAtom {
		const type = AtomSpaceBackendService._atomNodeType(node.node_type);
		return {
			handle: nodeHandle(type, node.content),
			kind: 'Node',
			type,
			name: node.content,
			truthValue: salienceToTruthValue(node.salience_score),
			attentionValue: AtomSpaceBackendService._defaultAttention(node.salience_score),
			values: {
				'hypergraph:id': node.id,
				'hypergraph:node_type': node.node_type,
				'hypergraph:metadata': { ...node.metadata },
				'hypergraph:links': [...node.links],
			},
		};
	}

	atomToHypergraphNode(atom: NodeAtom): HypergraphNode {
		const metadata = atom.values['hypergraph:metadata'];
		const links = atom.values['hypergraph:links'];
		return {
			id: typeof atom.values['hypergraph:id'] === 'string' ? atom.values['hypergraph:id'] as string : `atom_${atom.handle}`,
			node_type: typeof atom.values['hypergraph:node_type'] === 'string' ? atom.values['hypergraph:node_type'] as string : atom.type,
			content: atom.name,
			links: Array.isArray(links) ? links.filter((l): l is string => typeof l === 'string') : [],
			metadata: metadata && typeof metadata === 'object' ? { ...metadata as Record<string, unknown> } : {},
			salience_score: clamp01(atom.attentionValue.sti),
		};
	}

	hypergraphLinkToAtom(link: HypergraphLink): LinkAtom {
		const type = AtomSpaceBackendService._atomLinkType(link.link_type);
		const outgoing = link.outgoing.map(id => {
			const mapped = this._hypergraphIdToHandle.get(id);
			if (mapped) { return mapped; }
			const node = this.hypergraphStore.getNode(id);
			return node ? nodeHandle(AtomSpaceBackendService._atomNodeType(node.node_type), node.content) : id;
		});
		const truthValue = this.plnReasoningService.getTruthValue(link.id)
			?? { strength: DEFAULT_LINK_STRENGTH, confidence: DEFAULT_LINK_CONFIDENCE };
		return {
			handle: linkHandle(type, outgoing),
			kind: 'Link',
			type,
			outgoing,
			truthValue: { strength: clamp01(truthValue.strength), confidence: clamp01(truthValue.confidence) },
			attentionValue: AtomSpaceBackendService._defaultAttention(truthValueToSalience(truthValue)),
			values: {
				'hypergraph:id': link.id,
				'hypergraph:link_type': link.link_type,
				'hypergraph:metadata': { ...link.metadata },
				'hypergraph:outgoing': [...link.outgoing],
			},
		};
	}

	atomToHypergraphLink(atom: LinkAtom): HypergraphLink {
		const metadata = atom.values['hypergraph:metadata'];
		const originalOutgoing = atom.values['hypergraph:outgoing'];
		const outgoing = Array.isArray(originalOutgoing)
			? originalOutgoing.filter((o): o is string => typeof o === 'string')
			: atom.outgoing.map(handle => this._hypergraphIdForHandle(handle));
		return {
			id: typeof atom.values['hypergraph:id'] === 'string' ? atom.values['hypergraph:id'] as string : `atomlink_${atom.handle}`,
			link_type: typeof atom.values['hypergraph:link_type'] === 'string' ? atom.values['hypergraph:link_type'] as string : atom.type,
			outgoing,
			metadata: metadata && typeof metadata === 'object' ? { ...metadata as Record<string, unknown> } : {},
		};
	}

	private _hypergraphIdForHandle(handle: string): string {
		const atom = this._atoms.get(handle);
		if (atom && typeof atom.values['hypergraph:id'] === 'string') {
			return atom.values['hypergraph:id'] as string;
		}
		return `atom_${handle}`;
	}

	importFromHypergraph(): AtomSpaceImportResult {
		this.membraneService.recordActivity('cerebral');
		const result: AtomSpaceImportResult = { nodesImported: 0, linksImported: 0, duplicatesMerged: 0, danglingSkipped: [] };
		const knownNodeIds = new Set<string>();

		for (const node of this.hypergraphStore.getAllNodes()) {
			knownNodeIds.add(node.id);
			const atom = this.hypergraphNodeToAtom(node);
			const existing = this._atoms.get(atom.handle);
			if (existing) {
				existing.truthValue = reviseTruthValues(existing.truthValue, atom.truthValue);
				existing.attentionValue = { ...existing.attentionValue, sti: Math.max(existing.attentionValue.sti, atom.attentionValue.sti) };
				result.duplicatesMerged++;
			} else {
				this._storeAtom(atom);
				result.nodesImported++;
			}
			this._hypergraphIdToHandle.set(node.id, atom.handle);
		}

		const seenLinkIds = new Set<string>();
		for (const node of this.hypergraphStore.getAllNodes()) {
			for (const link of this.hypergraphStore.getLinksForNode(node.id)) {
				if (seenLinkIds.has(link.id)) { continue; }
				seenLinkIds.add(link.id);
				if (link.outgoing.some(id => !knownNodeIds.has(id))) {
					result.danglingSkipped.push(link.id);
					continue;
				}
				const atom = this.hypergraphLinkToAtom(link);
				const existing = this._atoms.get(atom.handle);
				if (existing) {
					existing.truthValue = reviseTruthValues(existing.truthValue, atom.truthValue);
					result.duplicatesMerged++;
				} else {
					this._storeAtom(atom);
					result.linksImported++;
				}
				this._hypergraphIdToHandle.set(link.id, atom.handle);
			}
		}

		this.logService.info(`AtomSpaceBackendService: imported ${result.nodesImported} node atoms and ${result.linksImported} link atoms from hypergraph (${result.duplicatesMerged} merged, ${result.danglingSkipped.length} dangling skipped)`);
		return result;
	}

	exportToHypergraph(): AtomSpaceExportResult {
		this.membraneService.recordActivity('cerebral');
		const result: AtomSpaceExportResult = { nodesExported: 0, linksExported: 0 };

		for (const atom of this._atoms.values()) {
			if (atom.kind !== 'Node') { continue; }
			const node = this.atomToHypergraphNode(atom);
			if (this.hypergraphStore.getNode(node.id)) {
				this.hypergraphStore.updateNode(node.id, {
					node_type: node.node_type,
					content: node.content,
					metadata: node.metadata,
					salience_score: node.salience_score,
				});
			} else {
				this.hypergraphStore.addNode(node);
			}
			this._hypergraphIdToHandle.set(node.id, atom.handle);
			result.nodesExported++;
		}

		for (const atom of this._atoms.values()) {
			if (atom.kind !== 'Link') { continue; }
			const link = this.atomToHypergraphLink(atom);
			this.hypergraphStore.addLink(link);
			this._hypergraphIdToHandle.set(link.id, atom.handle);
			result.linksExported++;
		}

		this.logService.info(`AtomSpaceBackendService: exported ${result.nodesExported} nodes and ${result.linksExported} links back to hypergraph`);
		return result;
	}

	// -- Pattern matching (BindLink / GetLink) --------------------------------

	get(query: GetLinkQuery): PatternMatchResult {
		this.membraneService.recordActivity('cerebral');
		const restrictions = new Map<string, string>();
		for (const variable of query.variables) {
			if (variable.typeRestriction) {
				restrictions.set(variable.name, variable.typeRestriction);
			}
		}

		const candidates = this._candidatesFor(query.pattern);
		const bindings: PatternBinding[] = [];
		const seen = new Set<string>();
		let atomsExamined = 0;

		for (const handle of candidates) {
			atomsExamined++;
			const match = this._matchTerm(query.pattern, handle, {}, restrictions);
			if (match === undefined) { continue; }
			const key = query.variables.map(v => `${v.name}=${match[v.name] ?? ''}`).join('&');
			if (seen.has(key)) { continue; }
			seen.add(key);
			bindings.push(match);
		}

		return { bindings, atomsExamined };
	}

	bind(query: BindLinkQuery): BindResult {
		const matches = this.get(query);
		const instantiated: Atom[] = [];
		const seenHandles = new Set<string>();

		for (const binding of matches.bindings) {
			const handle = this._instantiate(query.rewrite, binding);
			if (handle === undefined) { continue; }
			if (!seenHandles.has(handle)) {
				seenHandles.add(handle);
				const atom = this._atoms.get(handle);
				if (atom) { instantiated.push(AtomSpaceBackendService._cloneAtom(atom)); }
			}
		}

		return { bindings: matches.bindings, atomsExamined: matches.atomsExamined, instantiated };
	}

	/** Candidate handles for the top-level pattern term (type-indexed when possible). */
	private _candidatesFor(pattern: PatternTerm): string[] {
		if (pattern.kind !== 'variable' && pattern.type !== undefined) {
			const typed = this._typeIndex.get(pattern.type);
			return typed ? [...typed] : [];
		}
		if (pattern.kind === 'node') {
			return [...this._atoms.values()].filter(a => a.kind === 'Node').map(a => a.handle);
		}
		if (pattern.kind === 'link') {
			return [...this._atoms.values()].filter(a => a.kind === 'Link').map(a => a.handle);
		}
		return [...this._atoms.keys()];
	}

	/**
	 * Unify a pattern term against a concrete atom under the given binding.
	 * Returns the extended binding on success, undefined on mismatch.
	 */
	private _matchTerm(term: PatternTerm, handle: string, binding: PatternBinding, restrictions: Map<string, string>): PatternBinding | undefined {
		const atom = this._atoms.get(handle);
		if (!atom) { return undefined; }

		switch (term.kind) {
			case 'variable': {
				const restriction = restrictions.get(term.name);
				if (restriction && atom.type !== restriction) { return undefined; }
				const existing = binding[term.name];
				if (existing !== undefined) {
					return existing === handle ? binding : undefined;
				}
				return { ...binding, [term.name]: handle };
			}
			case 'node': {
				if (atom.kind !== 'Node') { return undefined; }
				if (term.type !== undefined && atom.type !== term.type) { return undefined; }
				if (term.name !== undefined && atom.name !== term.name) { return undefined; }
				return binding;
			}
			case 'link': {
				if (atom.kind !== 'Link') { return undefined; }
				if (term.type !== undefined && atom.type !== term.type) { return undefined; }
				if (atom.outgoing.length !== term.outgoing.length) { return undefined; }
				let current: PatternBinding | undefined = binding;
				for (let i = 0; i < term.outgoing.length; i++) {
					current = this._matchTerm(term.outgoing[i], atom.outgoing[i], current, restrictions);
					if (current === undefined) { return undefined; }
				}
				return current;
			}
		}
	}

	/** Instantiate a rewrite term under a binding, creating atoms as needed. */
	private _instantiate(term: PatternTerm, binding: PatternBinding): string | undefined {
		switch (term.kind) {
			case 'variable':
				return binding[term.name];
			case 'node': {
				if (term.type === undefined || term.name === undefined) { return undefined; }
				return this.addNode(term.type, term.name).handle;
			}
			case 'link': {
				if (term.type === undefined) { return undefined; }
				const children: string[] = [];
				for (const child of term.outgoing) {
					const handle = this._instantiate(child, binding);
					if (handle === undefined) { return undefined; }
					children.push(handle);
				}
				return this.addLink(term.type, children).handle;
			}
		}
	}

	// -- Persistent store (AtomSpace-Rocks via the ZoneCog bridge) -------------

	configure(config: Partial<AtomSpaceRocksConfig>): void {
		this._config = { ...this._config, ...config };
		this.logService.info(`AtomSpaceBackendService: configured with baseUrl=${this._config.baseUrl}`);
	}

	getConfig(): AtomSpaceRocksConfig {
		return { ...this._config };
	}

	getConnectionState(): AtomSpaceConnectionState {
		return this._connectionState;
	}

	async connect(): Promise<boolean> {
		this.membraneService.recordActivity('somatic');
		this._setConnectionState('connecting');
		try {
			const response = await fetch(`${this._config.baseUrl}/health`, {
				method: 'GET',
				headers: this._getHeaders(),
				signal: AbortSignal.timeout(this._config.timeoutMs),
			});
			if (!response.ok) {
				this._setConnectionState('error');
				return false;
			}
			const body = await response.json();
			const capabilities: unknown = body?.capabilities;
			this._remoteGzipSupported = Array.isArray(capabilities)
				&& capabilities.some(c => c === 'gzip' || c === 'gzip-ingest');
			this._setConnectionState('connected');
			return true;
		} catch (error) {
			this.logService.warn(`AtomSpaceBackendService: connect failed: ${error}`);
			this._setConnectionState('error');
			return false;
		}
	}

	disconnect(): void {
		this._remoteSnapshot = undefined;
		this._remoteGzipSupported = false;
		this._setConnectionState('disconnected');
	}

	private _setConnectionState(state: AtomSpaceConnectionState): void {
		if (this._connectionState !== state) {
			this._connectionState = state;
			this._onDidChangeConnectionState.fire(state);
		}
	}

	async loadAtom(handle: string): Promise<Atom | undefined> {
		const local = this._atoms.get(handle);
		if (local) { return AtomSpaceBackendService._cloneAtom(local); }
		if (this._connectionState !== 'connected') { return undefined; }
		let cursor: string | undefined = undefined;
		do {
			const page: AtomPage = await this.fetchAtomPage(cursor, this._config.pageSize);
			const found = page.atoms.find(a => a.handle === handle);
			if (found) { return found; }
			cursor = page.nextCursor;
		} while (cursor !== undefined);
		return undefined;
	}

	async fetchAtomPage(cursor: string | undefined, pageSize?: number): Promise<AtomPage> {
		const limit = Math.max(1, pageSize ?? this._config.pageSize);
		if (this._connectionState !== 'connected') {
			return this._localPage(cursor, limit);
		}
		this.membraneService.recordActivity('somatic');
		try {
			const offset = this._offsetOf(cursor);
			if (offset !== undefined && this._remoteSnapshot !== undefined) {
				return this._windowSnapshot(this._remoteSnapshot, offset, limit);
			}
			const params = new URLSearchParams({ limit: String(limit) });
			if (cursor !== undefined) { params.set('cursor', cursor); }
			const response = await fetch(`${this._config.baseUrl}/atoms?${params.toString()}`, {
				method: 'GET',
				headers: this._getHeaders(),
				signal: AbortSignal.timeout(this._config.timeoutMs),
			});
			if (!response.ok) {
				throw new Error(`AtomSpace backend returned HTTP ${response.status}`);
			}
			const body = await response.json();
			return this._parseRemotePage(body, cursor, limit);
		} catch (error) {
			this.logService.warn(`AtomSpaceBackendService: remote page fetch failed, serving local page: ${error}`);
			this._setConnectionState('error');
			return this._localPage(cursor, limit);
		}
	}

	async *streamAtoms(pageSize?: number): AsyncIterable<Atom> {
		let cursor: string | undefined = undefined;
		do {
			const page: AtomPage = await this.fetchAtomPage(cursor, pageSize);
			for (const atom of page.atoms) {
				yield atom;
			}
			cursor = page.nextCursor;
		} while (cursor !== undefined);
	}

	async persistAll(): Promise<AtomSpacePersistResult> {
		this.membraneService.recordActivity('somatic');
		const startTime = Date.now();
		const atoms = this.getAllAtoms();
		const nodes = atoms.filter((a): a is NodeAtom => a.kind === 'Node').map(a => ({
			type: 'Node',
			node_type: a.type,
			name: a.name,
			uuid: a.handle,
			truth_value: a.truthValue,
			attention_value: a.attentionValue,
		}));
		const links = atoms.filter((a): a is LinkAtom => a.kind === 'Link').map(a => ({
			type: 'Link',
			link_type: a.type,
			out: [...a.outgoing],
			uuid: a.handle,
			truth_value: a.truthValue,
			attention_value: a.attentionValue,
		}));
		const payload = JSON.stringify({ atoms: { nodes, links } });
		const uncompressedBytes = new TextEncoder().encode(payload).byteLength;

		let result: AtomSpacePersistResult;
		try {
			const headers = this._getHeaders();
			let body: BodyInit = payload;
			let compressed = false;
			let transferBytes = uncompressedBytes;
			if (this._config.compressionEnabled && this._remoteGzipSupported && uncompressedBytes > this._config.compressionThresholdBytes) {
				const compressedBytes = await gzipCompress(payload);
				body = compressedBytes;
				headers['Content-Encoding'] = 'gzip';
				compressed = true;
				transferBytes = compressedBytes.byteLength;
			}
			const response = await fetch(`${this._config.baseUrl}/ingest/atoms`, {
				method: 'POST',
				headers,
				body,
				signal: AbortSignal.timeout(this._config.timeoutMs),
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(`AtomSpace backend returned HTTP ${response.status}: ${text}`);
			}
			await response.json();
			result = {
				success: true,
				atomCount: atoms.length,
				uncompressedBytes,
				transferBytes,
				compressed,
				durationMs: Date.now() - startTime,
			};
		} catch (error) {
			result = {
				success: false,
				atomCount: atoms.length,
				uncompressedBytes,
				transferBytes: 0,
				compressed: false,
				durationMs: Date.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
			};
			this.logService.warn(`AtomSpaceBackendService: persist failed: ${result.error}`);
		}

		this._onDidPersist.fire(result);
		return result;
	}

	// -- Pagination helpers -----------------------------------------------------

	private _offsetOf(cursor: string | undefined): number | undefined {
		if (cursor === undefined || !cursor.startsWith(OFFSET_CURSOR_PREFIX)) { return undefined; }
		const parsed = Number.parseInt(cursor.slice(OFFSET_CURSOR_PREFIX.length), 10);
		return Number.isNaN(parsed) || parsed < 0 ? undefined : parsed;
	}

	private _localPage(cursor: string | undefined, limit: number): AtomPage {
		const sorted = [...this._atoms.values()]
			.sort((a, b) => a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0)
			.map(a => AtomSpaceBackendService._cloneAtom(a));
		const offset = this._offsetOf(cursor) ?? 0;
		return this._pageOf(sorted, offset, limit);
	}

	private _windowSnapshot(snapshot: Atom[], offset: number, limit: number): AtomPage {
		return this._pageOf(snapshot, offset, limit);
	}

	private _pageOf(atoms: Atom[], offset: number, limit: number): AtomPage {
		const slice = atoms.slice(offset, offset + limit);
		const nextOffset = offset + slice.length;
		return {
			atoms: slice,
			nextCursor: nextOffset < atoms.length ? `${OFFSET_CURSOR_PREFIX}${nextOffset}` : undefined,
			total: atoms.length,
		};
	}

	/** Parse a remote atoms response, supporting native pagination and bridge-shaped bodies. */
	private _parseRemotePage(body: any, cursor: string | undefined, limit: number): AtomPage {
		if (body && Array.isArray(body.atoms)) {
			const atoms = body.atoms
				.map((raw: unknown) => this._parseRemoteAtom(raw))
				.filter((a: Atom | undefined): a is Atom => a !== undefined);
			this._cacheRemoteAtoms(atoms);
			const nextCursor = typeof body.next_cursor === 'string' && body.next_cursor.length > 0 ? body.next_cursor : undefined;
			return { atoms, nextCursor, total: typeof body.total === 'number' ? body.total : undefined };
		}

		const rawAtoms: unknown[] = [];
		if (body && Array.isArray(body.nodes)) { rawAtoms.push(...body.nodes); }
		if (body && Array.isArray(body.links)) { rawAtoms.push(...body.links); }
		if (Array.isArray(body)) { rawAtoms.push(...body); }
		const parsed = rawAtoms
			.map(raw => this._parseRemoteAtom(raw))
			.filter((a): a is Atom => a !== undefined);
		this._cacheRemoteAtoms(parsed);
		this._remoteSnapshot = parsed;
		const offset = this._offsetOf(cursor) ?? 0;
		return this._windowSnapshot(parsed, offset, limit);
	}

	private _parseRemoteAtom(raw: any): Atom | undefined {
		if (!raw || typeof raw !== 'object') { return undefined; }
		const tvRaw = raw.truth_value ?? raw.truthValue;
		const truthValue: TruthValue = tvRaw && typeof tvRaw.strength === 'number'
			? { strength: clamp01(tvRaw.strength), confidence: clamp01(typeof tvRaw.confidence === 'number' ? tvRaw.confidence : DEFAULT_LINK_CONFIDENCE) }
			: salienceToTruthValue(0.5);
		const avRaw = raw.attention_value ?? raw.attentionValue;
		const attentionValue: AttentionValue = avRaw && typeof avRaw.sti === 'number'
			? { sti: clamp01(avRaw.sti), lti: clamp01(typeof avRaw.lti === 'number' ? avRaw.lti : 0), vlti: avRaw.vlti === true }
			: AtomSpaceBackendService._defaultAttention(truthValueToSalience(truthValue));

		if (raw.type === 'Node' || (raw.node_type !== undefined && raw.link_type === undefined)) {
			const type = String(raw.node_type ?? 'ConceptNode');
			const name = String(raw.name ?? '');
			return {
				handle: typeof raw.uuid === 'string' && raw.uuid.length > 0 ? raw.uuid : nodeHandle(type, name),
				kind: 'Node',
				type,
				name,
				truthValue,
				attentionValue,
				values: {},
			};
		}
		if (raw.type === 'Link' || raw.link_type !== undefined) {
			const type = String(raw.link_type ?? 'ListLink');
			const rawOut = raw.out ?? raw.outgoing;
			const outgoing = Array.isArray(rawOut) ? rawOut.map((o: unknown) => String(o)) : [];
			return {
				handle: typeof raw.uuid === 'string' && raw.uuid.length > 0 ? raw.uuid : linkHandle(type, outgoing),
				kind: 'Link',
				type,
				outgoing,
				truthValue,
				attentionValue,
				values: {},
			};
		}
		return undefined;
	}

	/** Lazily cache remotely-fetched atoms into the local atom table. */
	private _cacheRemoteAtoms(atoms: Atom[]): void {
		for (const atom of atoms) {
			if (!this._atoms.has(atom.handle)) {
				this._storeAtom(AtomSpaceBackendService._cloneAtom(atom));
			}
		}
	}

	private _getHeaders(): Record<string, string> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this._config.authToken) {
			headers['Authorization'] = `Bearer ${this._config.authToken}`;
		}
		return headers;
	}
}
