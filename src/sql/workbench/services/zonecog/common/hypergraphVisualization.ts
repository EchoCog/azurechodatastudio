/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';

export const IHypergraphVisualizationService = createDecorator<IHypergraphVisualizationService>('hypergraphVisualizationService');

// ---------------------------------------------------------------------------
// Simulation types
// ---------------------------------------------------------------------------

/** A node tracked by the shared force-directed simulation. */
export interface VisualizationSimNode {
	/** The hypergraph node being rendered. */
	node: HypergraphNode;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Radius derived from salience. */
	radius: number;
	/** Color derived from the node-type registry. */
	color: string;
	/** When true, the position is pinned (e.g. after a user drag). */
	pinned: boolean;
}

/** A binary edge between two simulation nodes. */
export interface VisualizationSimEdge {
	link: HypergraphLink;
	source: VisualizationSimNode;
	target: VisualizationSimNode;
}

/** Viewport rectangle used for render culling (canvas coordinates). */
export interface VisualizationViewport {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Tuning parameters for the shared force-directed simulation. All values
 * have production defaults; views may override a subset.
 */
export interface VisualizationLayoutOptions {
	/** Gravitational pull toward the canvas centre per tick. Default 0.005. */
	centerGravity: number;
	/** Repulsion strength between node pairs. Default 400. */
	repulsion: number;
	/** Minimum squared distance used when computing repulsion. Default 25. */
	minDistanceSq: number;
	/** Spring stiffness along edges. Default 0.01. */
	spring: number;
	/** Velocity damping factor per tick. Default 0.85. */
	damping: number;
}

export const DEFAULT_LAYOUT_OPTIONS: VisualizationLayoutOptions = {
	centerGravity: 0.005,
	repulsion: 400,
	minDistanceSq: 25,
	spring: 0.01,
	damping: 0.85
};

// ---------------------------------------------------------------------------
// Animation channel types
// ---------------------------------------------------------------------------

/** Kinds of transient animation effects views can render. */
export type VisualizationAnimationKind =
	| 'pulse'  // radial pulse on a node (birth / stimulation)
	| 'decay'  // shrinking fade on a node (salience decay / eviction)
	| 'flow'   // packet travelling along an edge (ECAN diffusion, PLN inference, message passing)
	| 'trail'; // fading highlight trail over a node (provenance / thinking focus)

/** A single animation effect scheduled on the shared animation clock. */
export interface VisualizationAnimation {
	/** Unique animation id. */
	id: string;
	kind: VisualizationAnimationKind;
	/** Node id for node-centric effects; undefined for pure edge effects. */
	nodeId?: string;
	/** Source node id for 'flow' effects. */
	sourceId?: string;
	/** Target node id for 'flow' effects. */
	targetId?: string;
	/** Epoch-ms when the animation started. */
	startedAt: number;
	/** Effect duration in ms. */
	durationMs: number;
	/** Progress in [0, 1], advanced by the shared animation clock. */
	progress: number;
	/** Optional free-form payload (e.g. truth value, link type, strength). */
	payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Selection bus types
// ---------------------------------------------------------------------------

/** Payload of the shared selection / focus bus. */
export interface VisualizationFocus {
	/** The focused hypergraph node id. */
	nodeId: string;
	/** View or host feature that requested the focus (e.g. 'objectExplorer'). */
	source: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Hypergraph Visualization service - the shared rendering substrate for all
 * Zone-Cog hypergraph views and animations.
 *
 * Responsibilities:
 *   - One shared force-directed simulation over the hypergraph store, with
 *     layout position persistence across rebuilds (nodes keep their places).
 *   - A node-type -> color registry with a deterministic hash fallback.
 *   - A selection bus so every view and host feature focuses the same node.
 *   - Animation channels (pulse / decay / flow / trail) driven by a single
 *     global requestAnimationFrame clock with per-subscriber viewport culling.
 *   - Node/edge budgets: the simulation always renders at most the top-N
 *     nodes by salience so views stay responsive on large hypergraphs.
 *
 * The service subscribes to the hypergraph store and ECAN attention events
 * and synthesizes animation effects from them automatically; views may also
 * schedule explicit effects (e.g. PLN inference steps, AAR message flow).
 */
export interface IHypergraphVisualizationService {
	readonly _serviceBrand: undefined;

	/** Fired when the shared simulation's node/edge set changes. */
	readonly onDidChangeSimulation: Event<void>;

	/** Fired when a node is focused through the selection bus. */
	readonly onDidFocusNode: Event<VisualizationFocus>;

	/** Fired when a new animation effect is scheduled. */
	readonly onDidScheduleAnimation: Event<VisualizationAnimation>;

	/**
	 * Fired on each frame of the shared animation clock while at least one
	 * renderer is attached. Carries the frame timestamp.
	 */
	readonly onDidTickFrame: Event<number>;

	// -- Simulation ----------------------------------------------------------

	/**
	 * Attach a renderer to the shared simulation/animation clock. Returns a
	 * disposable whose disposal detaches the renderer. While at least one
	 * renderer is attached the service ticks the simulation and advances
	 * animation progress on a single requestAnimationFrame loop.
	 *
	 * @param onFrame Called once per frame after the simulation tick. The
	 * callback receives the set of currently active (culled) animations.
	 */
	attachRenderer(onFrame: (animations: readonly VisualizationAnimation[]) => void): IDisposable;

	/** Current simulation nodes (top-salience, budget-capped). */
	getSimNodes(): readonly VisualizationSimNode[];

	/** Current simulation edges (binary links whose endpoints are visible). */
	getSimEdges(): readonly VisualizationSimEdge[];

	/** Look up the live simulation node for a hypergraph node id. */
	getSimNode(nodeId: string): VisualizationSimNode | undefined;

	/** Number of simulation ticks to run after the next rebuild. */
	requestTicks(count: number): void;

	/** Advance the simulation exactly one tick (used by the frame loop and tests). */
	tick(options?: Partial<VisualizationLayoutOptions>): void;

	/** Set the logical canvas size used by the simulation (centre gravity). */
	setViewportSize(width: number, height: number): void;

	/** The current viewport size. */
	getViewportSize(): { width: number; height: number };

	/** Maximum number of nodes the simulation renders at once. */
	getNodeBudget(): number;

	/** Update the node budget (perf guard). */
	setNodeBudget(budget: number): void;

	/** Pin/unpin a node (e.g. after user drags it). */
	setPinned(nodeId: string, pinned: boolean): void;

	/** Move a node to a position (also pins it). */
	moveNode(nodeId: string, x: number, y: number): void;

	/** Rebuild the simulation from the hypergraph store immediately. */
	rebuild(): void;

	// -- Color registry -------------------------------------------------------

	/** Register an explicit color for a node type. */
	registerNodeTypeColor(nodeType: string, color: string): void;

	/** Resolve the color for a node type (registered or deterministic hash). */
	colorForNodeType(nodeType: string): string;

	/** Map a salience score in [0, 1] to a node radius. */
	radiusForSalience(salience: number): number;

	// -- Selection bus ---------------------------------------------------------

	/** Focus a node across all views; the explorer highlights and reveals it. */
	focusNode(nodeId: string, source: string): void;

	/** The currently focused node, if any. */
	getFocusedNode(): VisualizationFocus | undefined;

	/** Clear the shared focus. */
	clearFocus(source: string): void;

	// -- Animation channels -----------------------------------------------------

	/**
	 * Schedule an animation effect. Effects auto-expire after `durationMs`
	 * and are culled per frame against the supplied viewport when provided.
	 * Returns the animation id.
	 */
	scheduleAnimation(animation: Omit<VisualizationAnimation, 'id' | 'startedAt' | 'progress'>): string;

	/** All currently active (unexpired) animations. */
	getActiveAnimations(): readonly VisualizationAnimation[];

	/**
	 * Active animations relevant to a viewport: node effects pass when their
	 * node is inside (or near) the viewport; edge effects pass when either
	 * endpoint is. Without a viewport all active animations are returned.
	 */
	cullAnimations(viewport?: VisualizationViewport): readonly VisualizationAnimation[];

	/** Cancel a scheduled animation by id. */
	cancelAnimation(id: string): void;

	// -- Performance guards ------------------------------------------------------

	/** Enable/disable continuous animation (low-power mode). */
	setLowPowerMode(enabled: boolean): void;

	/** Whether continuous animation is suspended. */
	isLowPowerMode(): boolean;

	/** Suspend/resume the frame clock (e.g. when no view is visible). */
	setSuspended(suspended: boolean): void;

	/** Whether the frame clock is currently running. */
	isAnimating(): boolean;
}
