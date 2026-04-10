/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IZoneCogService = createDecorator<IZoneCogService>('zonecogService');

/**
 * Zone-Cog cognitive protocol interface for embodied cognition workbench.
 *
 * Implements the full Zone-Cog thinking sequence:
 *   Initial Engagement → Problem Space Exploration → Hypothesis Generation →
 *   Natural Discovery → Testing & Verification → Knowledge Synthesis → Response
 */
export interface IZoneCogService {
	readonly _serviceBrand: undefined;

	/**
	 * Fired when the cognitive state changes (e.g. load, context, thinking mode).
	 */
	readonly onDidChangeCognitiveState: Event<ZoneCogState>;

	/**
	 * Fired when a cognitive processing cycle completes.
	 */
	readonly onDidProcessQuery: Event<ZoneCogResponse>;

	/**
	 * Initialize the Zone-Cog cognitive framework.
	 */
	initialize(): Promise<void>;

	/**
	 * Process a query through the full Zone-Cog thinking protocol.
	 * @param query The human query to process
	 * @returns The response after comprehensive cognitive processing
	 */
	processQuery(query: string): Promise<ZoneCogResponse>;

	/**
	 * Get the current cognitive state of the Zone-Cog system.
	 */
	getCognitiveState(): ZoneCogState;

	/**
	 * Enable or disable the comprehensive thinking mode.
	 */
	setThinkingMode(enabled: boolean): void;

	/**
	 * Get the underlying hypergraph store for direct access.
	 */
	getHypergraphStore(): IHypergraphStore;
}

// ---------------------------------------------------------------------------
// Hypergraph types – follows the EchoCog standard HypergraphNode structure
// ---------------------------------------------------------------------------

/**
 * Standard EchoCog HypergraphNode structure.
 * Fields: id, node_type, content, links, metadata, salience_score
 */
export interface HypergraphNode {
	/** Unique stable identifier for this node. */
	id: string;
	/** Categorical type (e.g. "TableNode", "CognitiveState", "ThinkingPhase"). */
	node_type: string;
	/** Primary content payload – query text, SQL schema JSON, thinking output, etc. */
	content: string;
	/** Ordered list of link-IDs that this node participates in. */
	links: string[];
	/** Arbitrary key-value metadata bag. */
	metadata: Record<string, unknown>;
	/** Salience / attention score in [0, 1]. Used by ECAN-style attention allocation. */
	salience_score: number;
}

/**
 * Typed link between hypergraph nodes.
 */
export interface HypergraphLink {
	id: string;
	link_type: string;
	/** Outgoing node IDs (ordered). */
	outgoing: string[];
	metadata: Record<string, unknown>;
}

export const IHypergraphStore = createDecorator<IHypergraphStore>('hypergraphStore');

/**
 * In-memory hypergraph store following the EchoCog HypergraphNode standard.
 */
export interface IHypergraphStore {
	readonly _serviceBrand: undefined;

	readonly onDidChangeNode: Event<HypergraphNode>;
	readonly onDidChangeLink: Event<HypergraphLink>;

	// Node CRUD
	addNode(node: HypergraphNode): void;
	getNode(id: string): HypergraphNode | undefined;
	updateNode(id: string, patch: Partial<Omit<HypergraphNode, 'id'>>): HypergraphNode | undefined;
	removeNode(id: string): boolean;
	getNodesByType(nodeType: string): HypergraphNode[];
	getAllNodes(): HypergraphNode[];

	// Link CRUD
	addLink(link: HypergraphLink): void;
	getLink(id: string): HypergraphLink | undefined;
	removeLink(id: string): boolean;
	getLinksByType(linkType: string): HypergraphLink[];
	getLinksForNode(nodeId: string): HypergraphLink[];

	// Salience helpers
	getTopSalientNodes(n: number): HypergraphNode[];
	decayAllSalience(factor: number): void;

	// Bulk
	clear(): void;
	nodeCount(): number;
	linkCount(): number;
}

// ---------------------------------------------------------------------------
// Cognitive Membrane types
// ---------------------------------------------------------------------------

export const ICognitiveMembraneService = createDecorator<ICognitiveMembraneService>('cognitiveMembraneService');

export type MembraneTriad = 'cerebral' | 'somatic' | 'autonomic';

export interface MembraneStatus {
	triad: MembraneTriad;
	healthy: boolean;
	activeProcesses: number;
	errorCount: number;
	lastActivity: number; // timestamp ms
}

/**
 * Cognitive Membrane service implementing the Cerebral / Somatic / Autonomic
 * triad architecture mapped from the P-System Membrane model.
 */
export interface ICognitiveMembraneService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeMembraneStatus: Event<MembraneStatus>;

	/** Report an activity in the given triad. */
	recordActivity(triad: MembraneTriad): void;

	/** Report an error in the given triad. */
	recordError(triad: MembraneTriad, message: string): void;

	/** Get status for a single triad. */
	getStatus(triad: MembraneTriad): MembraneStatus;

	/** Get status for all three triads. */
	getAllStatuses(): MembraneStatus[];

	/** Check overall system health (all membranes healthy). */
	isSystemHealthy(): boolean;

	/** Reset error counts for a triad. */
	resetErrors(triad: MembraneTriad): void;
}

// ---------------------------------------------------------------------------
// Response / State types
// ---------------------------------------------------------------------------

/**
 * A single phase inside the Zone-Cog thinking sequence.
 */
export interface ThinkingPhase {
	name: string;
	content: string;
	durationMs: number;
}

/**
 * Response from Zone-Cog cognitive processing.
 */
export interface ZoneCogResponse {
	/** The thinking process (internal monologue) – hidden from user. */
	thinking: string;

	/** Structured phases that produced the thinking output. */
	phases: ThinkingPhase[];

	/** The final response to the human. */
	response: string;

	/** Confidence level in the response (0-1). */
	confidence: number;

	/** Processing metadata. */
	metadata: {
		queryComplexity: QueryComplexity;
		thinkingDepth: ThinkingDepth;
		processingTime: number;
		/** IDs of hypergraph nodes created/referenced during processing. */
		relatedNodes: string[];
	};
}

export type QueryComplexity = 'simple' | 'moderate' | 'complex';
export type ThinkingDepth = 'shallow' | 'moderate' | 'deep';

/**
 * Current cognitive state of the Zone-Cog system.
 */
export interface ZoneCogState {
	isInitialized: boolean;
	thinkingModeEnabled: boolean;
	currentContext: string | null;
	/** Cognitive load in [0, 1]. */
	cognitiveLoad: number;
	/** Number of nodes currently held in the hypergraph store. */
	hypergraphNodeCount: number;
	/** Membrane health summary. */
	membraneHealthy: boolean;
}
