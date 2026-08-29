/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { RunOnceScheduler } from 'vs/base/common/async';
import { generateUuid } from 'vs/base/common/uuid';
import { ILogService } from 'vs/platform/log/common/log';
import {
	IHypergraphVisualizationService,
	VisualizationAnimation,
	VisualizationFocus,
	VisualizationLayoutOptions,
	VisualizationSimEdge,
	VisualizationSimNode,
	VisualizationViewport,
	DEFAULT_LAYOUT_OPTIONS
} from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';

/** Default cap on simulated nodes; the most salient are kept. */
const DEFAULT_NODE_BUDGET = 120;

/** Simulation ticks run after each rebuild by default. */
const DEFAULT_TICKS = 120;

/** Debounce for hypergraph change events before relayout. */
const REBUILD_DELAY_MS = 500;

/** Default animation durations (ms). */
const PULSE_DURATION_MS = 900;
const DECAY_DURATION_MS = 1200;
const FLOW_DURATION_MS = 800;

/** Extra pixels around the viewport within which animations still render. */
const CULL_MARGIN_PX = 40;

type FrameCallback = (animations: readonly VisualizationAnimation[]) => void;

/**
 * Shared force-directed simulation + animation clock backing every
 * hypergraph visualization view. Extracted and generalized from the original
 * HypergraphExplorerView simulation so all views share one engine, one color
 * registry, one selection bus, and one requestAnimationFrame loop.
 */
export class HypergraphVisualizationService extends Disposable implements IHypergraphVisualizationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSimulation = this._register(new Emitter<void>());
	readonly onDidChangeSimulation: Event<void> = this._onDidChangeSimulation.event;

	private readonly _onDidFocusNode = this._register(new Emitter<VisualizationFocus>());
	readonly onDidFocusNode: Event<VisualizationFocus> = this._onDidFocusNode.event;

	private readonly _onDidScheduleAnimation = this._register(new Emitter<VisualizationAnimation>());
	readonly onDidScheduleAnimation: Event<VisualizationAnimation> = this._onDidScheduleAnimation.event;

	private readonly _onDidTickFrame = this._register(new Emitter<number>());
	readonly onDidTickFrame: Event<number> = this._onDidTickFrame.event;

	private _simNodes: VisualizationSimNode[] = [];
	private _simEdges: VisualizationSimEdge[] = [];
	private _ticksRemaining = 0;
	private _width = 600;
	private _height = 400;
	private _nodeBudget = DEFAULT_NODE_BUDGET;

	private readonly _renderers = new Set<FrameCallback>();
	private _animationHandle: number | undefined;
	private readonly _animations = new Map<string, VisualizationAnimation>();
	private _focused: VisualizationFocus | undefined;
	private _lowPowerMode = false;
	private _suspended = false;

	private readonly _colorRegistry = new Map<string, string>();
	private readonly _rebuildScheduler: RunOnceScheduler;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IECANAttentionService private readonly ecanService: IECANAttentionService
	) {
		super();

		this._rebuildScheduler = this._register(new RunOnceScheduler(() => this.rebuild(), REBUILD_DELAY_MS));

		// Node birth/decay pulses synthesized from real hypergraph mutations.
		this._register(this.hypergraphStore.onDidChangeNode(node => {
			this.scheduleAnimation({
				kind: 'pulse',
				nodeId: node.id,
				durationMs: PULSE_DURATION_MS,
				payload: { nodeType: node.node_type }
			});
			this._rebuildScheduler.schedule();
		}));

		// Edge flow when new links materialize (e.g. PLN inferred links).
		this._register(this.hypergraphStore.onDidChangeLink(link => {
			if (link.outgoing.length === 2) {
				this.scheduleAnimation({
					kind: 'flow',
					sourceId: link.outgoing[0],
					targetId: link.outgoing[1],
					durationMs: FLOW_DURATION_MS,
					payload: { linkType: link.link_type }
				});
			}
			this._rebuildScheduler.schedule();
		}));

		// ECAN attention dynamics: boosted nodes pulse, decayed nodes fade,
		// evicted nodes shrink away.
		this._register(this.ecanService.onDidSpread(spread => {
			for (const nodeId of spread.boosted) {
				this.scheduleAnimation({ kind: 'pulse', nodeId, durationMs: PULSE_DURATION_MS, payload: { source: 'ecan' } });
			}
			for (const nodeId of spread.decayed) {
				this.scheduleAnimation({ kind: 'decay', nodeId, durationMs: DECAY_DURATION_MS, payload: { source: 'ecan' } });
			}
			for (const nodeId of spread.evicted) {
				this.scheduleAnimation({ kind: 'decay', nodeId, durationMs: DECAY_DURATION_MS, payload: { source: 'ecan-rent', evicted: true } });
			}
		}));

		// Eagerly establish the initial simulation (the frame clock starts when
		// a renderer attaches). Guarded so headless unit tests can construct the
		// service without a DOM; rebuilds still run via the scheduler on changes.
		if (typeof requestAnimationFrame === 'function') {
			this.rebuild();
		}
	}

	// -- Renderer attachment / frame clock -------------------------------------

	attachRenderer(onFrame: FrameCallback): { dispose: () => void } {
		this.membraneService.recordActivity('somatic');
		this._renderers.add(onFrame);
		this._ensureAnimating();
		return {
			dispose: () => {
				this._renderers.delete(onFrame);
				if (this._renderers.size === 0) {
					this._stopFrameLoop();
				}
			}
		};
	}

	private _ensureAnimating(): void {
		if (this._animationHandle !== undefined || this._suspended || this._renderers.size === 0) {
			return;
		}
		const step = (timestamp: number) => {
			this._animationHandle = undefined;
			if (this._suspended || this._renderers.size === 0) {
				return;
			}

			if (this._ticksRemaining > 0) {
				this._ticksRemaining--;
				this.tick();
			}

			this._advanceAnimations();

			const active = this.getActiveAnimations();
			if (!this._lowPowerMode || this._ticksRemaining > 0) {
				for (const render of this._renderers) {
					render(active);
				}
				this._onDidTickFrame.fire(timestamp);
			}

			// Keep looping while there is simulation work, live animations, or
			// (in full-power mode) an attached renderer that wants steady frames.
			if (this._ticksRemaining > 0 || active.length > 0 || (!this._lowPowerMode && this._renderers.size > 0)) {
				this._animationHandle = requestAnimationFrame(step);
			}
		};
		this._animationHandle = requestAnimationFrame(step);
	}

	private _stopFrameLoop(): void {
		if (this._animationHandle !== undefined) {
			cancelAnimationFrame(this._animationHandle);
			this._animationHandle = undefined;
		}
	}

	private _advanceAnimations(): void {
		const now = Date.now();
		for (const [id, animation] of this._animations) {
			animation.progress = Math.min(1, (now - animation.startedAt) / Math.max(1, animation.durationMs));
			if (animation.progress >= 1) {
				this._animations.delete(id);
			}
		}
	}

	// -- Simulation -------------------------------------------------------------

	getSimNodes(): readonly VisualizationSimNode[] {
		return this._simNodes;
	}

	getSimEdges(): readonly VisualizationSimEdge[] {
		return this._simEdges;
	}

	getSimNode(nodeId: string): VisualizationSimNode | undefined {
		return this._simNodes.find(n => n.node.id === nodeId);
	}

	requestTicks(count: number): void {
		this._ticksRemaining = Math.max(this._ticksRemaining, Math.max(0, count));
		this._ensureAnimating();
	}

	setViewportSize(width: number, height: number): void {
		this._width = Math.max(100, width);
		this._height = Math.max(100, height);
	}

	getViewportSize(): { width: number; height: number } {
		return { width: this._width, height: this._height };
	}

	getNodeBudget(): number {
		return this._nodeBudget;
	}

	setNodeBudget(budget: number): void {
		this._nodeBudget = Math.max(10, Math.min(1000, Math.floor(budget)));
		this.rebuild();
	}

	setPinned(nodeId: string, pinned: boolean): void {
		const sim = this.getSimNode(nodeId);
		if (sim) {
			sim.pinned = pinned;
		}
	}

	moveNode(nodeId: string, x: number, y: number): void {
		const sim = this.getSimNode(nodeId);
		if (sim) {
			sim.x = Math.max(sim.radius, Math.min(this._width - sim.radius, x));
			sim.y = Math.max(sim.radius, Math.min(this._height - sim.radius, y));
			sim.vx = 0;
			sim.vy = 0;
			sim.pinned = true;
		}
	}

	tick(options?: Partial<VisualizationLayoutOptions>): void {
		const opts: VisualizationLayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
		const nodes = this._simNodes;
		const cx = this._width / 2;
		const cy = this._height / 2;

		// Pairwise repulsion + center gravity
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			if (!a.pinned) {
				a.vx += (cx - a.x) * opts.centerGravity;
				a.vy += (cy - a.y) * opts.centerGravity;
			}
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				const distSq = Math.max(opts.minDistanceSq, dx * dx + dy * dy);
				const force = opts.repulsion / distSq;
				const dist = Math.sqrt(distSq);
				dx /= dist; dy /= dist;
				a.vx += dx * force; a.vy += dy * force;
				b.vx -= dx * force; b.vy -= dy * force;
			}
		}

		// Spring attraction along edges
		for (const edge of this._simEdges) {
			const dx = edge.target.x - edge.source.x;
			const dy = edge.target.y - edge.source.y;
			edge.source.vx += dx * opts.spring; edge.source.vy += dy * opts.spring;
			edge.target.vx -= dx * opts.spring; edge.target.vy -= dy * opts.spring;
		}

		// Integrate with damping, clamp to viewport
		for (const node of nodes) {
			if (node.pinned) {
				node.vx = 0; node.vy = 0;
				continue;
			}
			node.vx *= opts.damping; node.vy *= opts.damping;
			node.x = Math.max(node.radius, Math.min(this._width - node.radius, node.x + node.vx));
			node.y = Math.max(node.radius, Math.min(this._height - node.radius, node.y + node.vy));
		}
	}

	rebuild(): void {
		this.membraneService.recordActivity('cerebral');
		const allNodes = this.hypergraphStore.getAllNodes()
			.sort((a, b) => b.salience_score - a.salience_score)
			.slice(0, this._nodeBudget);

		const byId = new Map<string, VisualizationSimNode>();
		const previous = new Map(this._simNodes.map(n => [n.node.id, n]));
		this._simNodes = allNodes.map((node, i) => {
			const prior = previous.get(node.id);
			const angle = (i / Math.max(1, allNodes.length)) * Math.PI * 2;
			const sim: VisualizationSimNode = {
				node,
				x: prior ? prior.x : this._width / 2 + Math.cos(angle) * this._width / 4,
				y: prior ? prior.y : this._height / 2 + Math.sin(angle) * this._height / 4,
				vx: 0,
				vy: 0,
				radius: this.radiusForSalience(node.salience_score),
				color: this.colorForNodeType(node.node_type),
				pinned: prior ? prior.pinned : false
			};
			byId.set(node.id, sim);
			return sim;
		});

		this._simEdges = [];
		const seenLinks = new Set<string>();
		for (const sim of this._simNodes) {
			for (const link of this.hypergraphStore.getLinksForNode(sim.node.id)) {
				if (seenLinks.has(link.id) || link.outgoing.length !== 2) {
					continue;
				}
				seenLinks.add(link.id);
				const source = byId.get(link.outgoing[0]);
				const target = byId.get(link.outgoing[1]);
				if (source && target) {
					this._simEdges.push({ link, source, target });
				}
			}
		}

		this._ticksRemaining = Math.max(this._ticksRemaining, DEFAULT_TICKS);
		this._onDidChangeSimulation.fire();
		this._ensureAnimating();
	}

	// -- Color registry ----------------------------------------------------------

	registerNodeTypeColor(nodeType: string, color: string): void {
		this._colorRegistry.set(nodeType, color);
	}

	colorForNodeType(nodeType: string): string {
		const registered = this._colorRegistry.get(nodeType);
		if (registered) {
			return registered;
		}
		// Deterministic HSL color derived from the node type name.
		let hash = 0;
		for (let i = 0; i < nodeType.length; i++) {
			hash = ((hash << 5) - hash + nodeType.charCodeAt(i)) | 0;
		}
		const hue = Math.abs(hash) % 360;
		return `hsl(${hue}, 55%, 55%)`;
	}

	radiusForSalience(salience: number): number {
		const clamped = Math.max(0, Math.min(1, salience));
		return 3 + clamped * 7;
	}

	// -- Selection bus ------------------------------------------------------------

	focusNode(nodeId: string, source: string): void {
		this.membraneService.recordActivity('somatic');
		this._focused = { nodeId, source };
		this.scheduleAnimation({ kind: 'trail', nodeId, durationMs: 1500, payload: { source } });
		this._onDidFocusNode.fire(this._focused);
		this.logService.trace(`[HypergraphVisualization] focus node ${nodeId} from ${source}`);
	}

	getFocusedNode(): VisualizationFocus | undefined {
		return this._focused;
	}

	clearFocus(source: string): void {
		if (this._focused && this._focused.source === source) {
			this._focused = undefined;
		}
	}

	// -- Animation channels ---------------------------------------------------------

	scheduleAnimation(animation: Omit<VisualizationAnimation, 'id' | 'startedAt' | 'progress'>): string {
		const full: VisualizationAnimation = {
			...animation,
			id: generateUuid(),
			startedAt: Date.now(),
			progress: 0
		};
		this._animations.set(full.id, full);
		this._onDidScheduleAnimation.fire(full);
		this._ensureAnimating();
		return full.id;
	}

	getActiveAnimations(): readonly VisualizationAnimation[] {
		return Array.from(this._animations.values());
	}

	cullAnimations(viewport?: VisualizationViewport): readonly VisualizationAnimation[] {
		const active = this.getActiveAnimations();
		if (!viewport) {
			return active;
		}
		const inView = (nodeId: string | undefined): boolean => {
			if (!nodeId) {
				return false;
			}
			const sim = this.getSimNode(nodeId);
			if (!sim) {
				return false;
			}
			return sim.x >= viewport.x - CULL_MARGIN_PX
				&& sim.x <= viewport.x + viewport.width + CULL_MARGIN_PX
				&& sim.y >= viewport.y - CULL_MARGIN_PX
				&& sim.y <= viewport.y + viewport.height + CULL_MARGIN_PX;
		};
		return active.filter(a => {
			if (a.kind === 'flow') {
				return inView(a.sourceId) || inView(a.targetId);
			}
			return inView(a.nodeId);
		});
	}

	cancelAnimation(id: string): void {
		this._animations.delete(id);
	}

	// -- Performance guards -----------------------------------------------------------

	setLowPowerMode(enabled: boolean): void {
		this._lowPowerMode = enabled;
		if (!enabled) {
			this._ensureAnimating();
		}
	}

	isLowPowerMode(): boolean {
		return this._lowPowerMode;
	}

	setSuspended(suspended: boolean): void {
		this._suspended = suspended;
		if (suspended) {
			this._stopFrameLoop();
		} else {
			this._ensureAnimating();
		}
	}

	isAnimating(): boolean {
		return this._animationHandle !== undefined;
	}

	override dispose(): void {
		this._stopFrameLoop();
		super.dispose();
	}
}

// Re-export the underlying node/link types for convenience of view code.
export type { HypergraphNode, HypergraphLink };
