/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/zonecogDashboard';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { $, append } from 'vs/base/browser/dom';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { RunOnceScheduler } from 'vs/base/common/async';

import { IHypergraphStore, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

/** Maximum nodes rendered; the most salient are kept. */
const MAX_RENDERED_NODES = 120;

/** Simulation ticks run after each data refresh. */
const SIMULATION_TICKS = 120;

/** Node labels are drawn only for this many top-salience nodes. */
const MAX_LABELS = 12;

/** Debounce for hypergraph change events before relayout. */
const REFRESH_DELAY_MS = 500;

interface SimNode {
	node: HypergraphNode;
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	color: string;
}

interface SimEdge {
	source: SimNode;
	target: SimNode;
}

/**
 * Hypergraph Explorer View - interactive force-directed visualization of the
 * hypergraph store. Nodes are colored by node_type and sized by salience;
 * binary links are drawn as edges. The layout re-runs (debounced) whenever
 * the hypergraph changes.
 */
export class HypergraphExplorerView extends ViewPane {
	private _canvas?: HTMLCanvasElement;
	private _legend?: HTMLElement;
	private _emptyMessage?: HTMLElement;
	private _simNodes: SimNode[] = [];
	private _simEdges: SimEdge[] = [];
	private _ticksRemaining = 0;
	private _animationHandle: number | undefined;
	private _refreshScheduler!: RunOnceScheduler;
	private _width = 300;
	private _height = 200;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const view = append(container, $('.zonecog-view.zonecog-hypergraph-view'));
		this._canvas = append(view, $('canvas.zonecog-hypergraph-canvas')) as HTMLCanvasElement;
		this._legend = append(view, $('.zonecog-hypergraph-legend'));
		this._emptyMessage = append(view, $('.zonecog-thinking-idle'));
		this._emptyMessage.textContent = localize('zonecog.hypergraphEmpty', 'The hypergraph is empty - process a query or perceive a schema to grow it.');

		this._refreshScheduler = this._register(new RunOnceScheduler(() => this._rebuild(), REFRESH_DELAY_MS));
		this._register(this.hypergraphStore.onDidChangeNode(() => this._refreshScheduler.schedule()));
		this._register(this.hypergraphStore.onDidChangeLink(() => this._refreshScheduler.schedule()));

		this._rebuild();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._width = Math.max(100, width);
		this._height = Math.max(100, height - 40);
		if (this._canvas) {
			this._canvas.width = this._width;
			this._canvas.height = this._height;
			this._draw();
		}
	}

	override dispose(): void {
		if (this._animationHandle !== undefined) {
			cancelAnimationFrame(this._animationHandle);
			this._animationHandle = undefined;
		}
		super.dispose();
	}

	// -- Data -> simulation -----------------------------------------------------------

	private _rebuild(): void {
		const allNodes = this.hypergraphStore.getAllNodes()
			.sort((a, b) => b.salience_score - a.salience_score)
			.slice(0, MAX_RENDERED_NODES);

		if (this._emptyMessage) {
			this._emptyMessage.style.display = allNodes.length === 0 ? '' : 'none';
		}

		const byId = new Map<string, SimNode>();
		const previous = new Map(this._simNodes.map(n => [n.node.id, n]));
		this._simNodes = allNodes.map((node, i) => {
			const prior = previous.get(node.id);
			const angle = (i / Math.max(1, allNodes.length)) * Math.PI * 2;
			const sim: SimNode = {
				node,
				x: prior ? prior.x : this._width / 2 + Math.cos(angle) * this._width / 4,
				y: prior ? prior.y : this._height / 2 + Math.sin(angle) * this._height / 4,
				vx: 0,
				vy: 0,
				radius: 3 + node.salience_score * 7,
				color: HypergraphExplorerView._colorForType(node.node_type)
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
					this._simEdges.push({ source, target });
				}
			}
		}

		this._renderLegend(allNodes);
		this._ticksRemaining = SIMULATION_TICKS;
		this._ensureAnimating();
	}

	private _renderLegend(nodes: HypergraphNode[]): void {
		if (!this._legend) {
			return;
		}
		this._legend.textContent = '';
		const counts = new Map<string, number>();
		for (const node of nodes) {
			counts.set(node.node_type, (counts.get(node.node_type) ?? 0) + 1);
		}
		const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
		for (const [type, count] of top) {
			const entry = append(this._legend, $('.zonecog-hypergraph-legend-entry'));
			const swatch = append(entry, $('.zonecog-hypergraph-legend-swatch'));
			swatch.style.backgroundColor = HypergraphExplorerView._colorForType(type);
			append(entry, $('span')).textContent = `${type} (${count})`;
		}
	}

	// -- Simulation ---------------------------------------------------------------------

	private _ensureAnimating(): void {
		if (this._animationHandle !== undefined) {
			return;
		}
		const step = () => {
			this._animationHandle = undefined;
			if (this._ticksRemaining <= 0) {
				return;
			}
			this._ticksRemaining--;
			this._tick();
			this._draw();
			this._animationHandle = requestAnimationFrame(step);
		};
		this._animationHandle = requestAnimationFrame(step);
	}

	private _tick(): void {
		const nodes = this._simNodes;
		const cx = this._width / 2;
		const cy = this._height / 2;

		// Pairwise repulsion + center gravity
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			a.vx += (cx - a.x) * 0.005;
			a.vy += (cy - a.y) * 0.005;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				const distSq = Math.max(25, dx * dx + dy * dy);
				const force = 400 / distSq;
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
			edge.source.vx += dx * 0.01; edge.source.vy += dy * 0.01;
			edge.target.vx -= dx * 0.01; edge.target.vy -= dy * 0.01;
		}

		// Integrate with damping, clamp to canvas
		for (const node of nodes) {
			node.vx *= 0.85; node.vy *= 0.85;
			node.x = Math.max(node.radius, Math.min(this._width - node.radius, node.x + node.vx));
			node.y = Math.max(node.radius, Math.min(this._height - node.radius, node.y + node.vy));
		}
	}

	private _draw(): void {
		const ctx = this._canvas?.getContext('2d');
		if (!ctx || !this._canvas) {
			return;
		}
		ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

		const foreground = this._canvas.parentElement
			? getComputedStyle(this._canvas.parentElement).color
			: '#cccccc';

		ctx.strokeStyle = foreground;
		ctx.globalAlpha = 0.25;
		ctx.lineWidth = 1;
		for (const edge of this._simEdges) {
			ctx.beginPath();
			ctx.moveTo(edge.source.x, edge.source.y);
			ctx.lineTo(edge.target.x, edge.target.y);
			ctx.stroke();
		}

		ctx.globalAlpha = 1;
		for (const node of this._simNodes) {
			ctx.fillStyle = node.color;
			ctx.beginPath();
			ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.fillStyle = foreground;
		ctx.font = '9px sans-serif';
		for (const node of this._simNodes.slice(0, MAX_LABELS)) {
			const label = node.node.content.length > 24 ? `${node.node.content.slice(0, 24)}…` : node.node.content;
			ctx.fillText(label, node.x + node.radius + 2, node.y + 3);
		}
	}

	/** Deterministic HSL color derived from the node type name. */
	private static _colorForType(nodeType: string): string {
		let hash = 0;
		for (let i = 0; i < nodeType.length; i++) {
			hash = ((hash << 5) - hash + nodeType.charCodeAt(i)) | 0;
		}
		const hue = Math.abs(hash) % 360;
		return `hsl(${hue}, 55%, 55%)`;
	}
}
