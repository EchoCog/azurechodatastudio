/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/zonecogDashboard';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { $, append, clearNode } from 'vs/base/browser/dom';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { KeyCode } from 'vs/base/common/keyCodes';
import { RunOnceScheduler } from 'vs/base/common/async';

import { IHypergraphStore, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IHypergraphVisualizationService, VisualizationAnimation, VisualizationSimNode } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { IHypergraphSemanticSearchService } from 'sql/workbench/services/zonecog/common/hypergraphSemanticSearch';

/** Node labels are drawn only for this many top-salience nodes. */
const MAX_LABELS = 12;

/** Debounce for search-box queries. */
const SEARCH_DELAY_MS = 350;

/** Link types rendered dashed instead of solid. */
const DASHED_LINK_TYPES = new Set(['monitors', 'modulates', 'SimilarTo']);

/**
 * Hypergraph Explorer View - interactive force-directed visualization of the
 * hypergraph store backed by the shared IHypergraphVisualizationService
 * simulation engine. Supports hover tooltips, click-to-inspect, node
 * dragging, zoom/pan, node-type filter chips, semantic search, link-type
 * edge styling, keyboard navigation, and animation channels (pulse / decay /
 * flow / trail) shared with every other ZoneCog view.
 */
export class HypergraphExplorerView extends ViewPane {
	private _canvas?: HTMLCanvasElement;
	private _legend?: HTMLElement;
	private _emptyMessage?: HTMLElement;
	private _tooltip?: HTMLElement;
	private _detailPane?: HTMLElement;
	private _filterBar?: HTMLElement;
	private _searchInput?: HTMLInputElement;

	private _width = 300;
	private _height = 200;
	private _zoom = 1;
	private _panX = 0;
	private _panY = 0;
	private _dragNode?: VisualizationSimNode;
	private _panning = false;
	private _panStart = { x: 0, y: 0 };
	private _hoveredId?: string;
	private _inspectedId?: string;
	private _keyboardIndex = -1;
	private readonly _hiddenTypes = new Set<string>();
	private _searchHits = new Set<string>();
	private _searchScheduler!: RunOnceScheduler;

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
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService,
		@IHypergraphSemanticSearchService private readonly semanticSearchService: IHypergraphSemanticSearchService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const view = append(container, $('.zonecog-view.zonecog-hypergraph-view'));

		// Toolbar: semantic search + hint
		const toolbar = append(view, $('.zonecog-hypergraph-toolbar'));
		this._searchInput = append(toolbar, $('input.zonecog-hypergraph-search')) as HTMLInputElement;
		this._searchInput.type = 'text';
		this._searchInput.placeholder = localize('zonecog.hypergraphSearch', 'Semantic search hypergraph…');
		this._searchInput.setAttribute('aria-label', localize('zonecog.hypergraphSearchAria', 'Semantic search over hypergraph nodes'));
		this._searchScheduler = this._register(new RunOnceScheduler(() => this._runSearch(), SEARCH_DELAY_MS));
		this._searchInput.addEventListener('input', () => this._searchScheduler.schedule());

		// Filter chips
		this._filterBar = append(view, $('.zonecog-hypergraph-filters'));

		this._canvas = append(view, $('canvas.zonecog-hypergraph-canvas')) as HTMLCanvasElement;
		this._canvas.tabIndex = 0;
		this._canvas.setAttribute('role', 'application');
		this._canvas.setAttribute('aria-label', localize('zonecog.hypergraphAria', 'Hypergraph explorer canvas. Use arrow keys to walk nodes, Enter to inspect.'));

		this._tooltip = append(view, $('.zonecog-hypergraph-tooltip')) as HTMLElement;
		this._tooltip.style.display = 'none';
		this._detailPane = append(view, $('.zonecog-hypergraph-detail')) as HTMLElement;
		this._detailPane.style.display = 'none';
		this._legend = append(view, $('.zonecog-hypergraph-legend'));
		this._emptyMessage = append(view, $('.zonecog-thinking-idle'));
		this._emptyMessage.textContent = localize('zonecog.hypergraphEmpty', 'The hypergraph is empty - process a query or perceive a schema to grow it.');

		this._register(this.visualizationService.onDidChangeSimulation(() => {
			this._renderFilterChips();
			this._renderLegend();
		}));
		this._register(this.visualizationService.onDidFocusNode(focus => {
			if (focus.source !== 'explorer') {
				this._inspectedId = focus.nodeId;
				this._renderDetailPane();
			}
		}));
		this._register(this.visualizationService.attachRenderer(animations => {
			if (!this.isBodyVisible()) {
				return;
			}
			this._draw(this.visualizationService.cullAnimations({
				x: this._panX, y: this._panY,
				width: this._width / this._zoom, height: this._height / this._zoom
			}));
		}));

		this._wirePointerEvents();
		this._wireKeyboard();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._width = Math.max(100, width);
		this._height = Math.max(100, height - 110);
		if (this._canvas) {
			this._canvas.width = this._width;
			this._canvas.height = this._height;
		}
		this.visualizationService.setViewportSize(this._width, this._height);
	}

	// -- Interaction ------------------------------------------------------------

	private _toWorld(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this._canvas!.getBoundingClientRect();
		return {
			x: (clientX - rect.left) / this._zoom + this._panX,
			y: (clientY - rect.top) / this._zoom + this._panY
		};
	}

	private _nodeAt(world: { x: number; y: number }): VisualizationSimNode | undefined {
		for (const sim of this.visualizationService.getSimNodes()) {
			if (this._hiddenTypes.has(sim.node.node_type)) {
				continue;
			}
			const dx = sim.x - world.x;
			const dy = sim.y - world.y;
			if (dx * dx + dy * dy <= (sim.radius + 3) * (sim.radius + 3)) {
				return sim;
			}
		}
		return undefined;
	}

	private _wirePointerEvents(): void {
		if (!this._canvas) {
			return;
		}
		this._canvas.addEventListener('mousedown', e => {
			const world = this._toWorld(e.clientX, e.clientY);
			const sim = this._nodeAt(world);
			if (sim) {
				this._dragNode = sim;
			} else {
				this._panning = true;
				this._panStart = { x: e.clientX, y: e.clientY };
			}
		});
		this._canvas.addEventListener('mousemove', e => {
			const world = this._toWorld(e.clientX, e.clientY);
			if (this._dragNode) {
				this.visualizationService.moveNode(this._dragNode.node.id, world.x, world.y);
				return;
			}
			if (this._panning) {
				this._panX -= (e.clientX - this._panStart.x) / this._zoom;
				this._panY -= (e.clientY - this._panStart.y) / this._zoom;
				this._panStart = { x: e.clientX, y: e.clientY };
				return;
			}
			const sim = this._nodeAt(world);
			this._hoveredId = sim?.node.id;
			this._renderTooltip(sim, e.offsetX, e.offsetY);
		});
		const endInteraction = () => {
			if (this._dragNode) {
				this.visualizationService.setPinned(this._dragNode.node.id, false);
			}
			this._dragNode = undefined;
			this._panning = false;
		};
		this._canvas.addEventListener('mouseup', endInteraction);
		this._canvas.addEventListener('mouseleave', () => {
			endInteraction();
			this._hoveredId = undefined;
			if (this._tooltip) {
				this._tooltip.style.display = 'none';
			}
		});
		this._canvas.addEventListener('click', e => {
			const sim = this._nodeAt(this._toWorld(e.clientX, e.clientY));
			this._inspectedId = sim?.node.id;
			if (sim) {
				this.visualizationService.focusNode(sim.node.id, 'explorer');
			}
			this._renderDetailPane();
		});
		this._canvas.addEventListener('wheel', e => {
			e.preventDefault();
			const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
			this._zoom = Math.max(0.4, Math.min(3, this._zoom * factor));
		}, { passive: false });
	}

	private _wireKeyboard(): void {
		if (!this._canvas) {
			return;
		}
		this._canvas.addEventListener('keydown', (e: KeyboardEvent) => {
			const visible = this.visualizationService.getSimNodes().filter(n => !this._hiddenTypes.has(n.node.node_type));
			if (visible.length === 0) {
				return;
			}
			if (e.keyCode === KeyCode.RightArrow || e.keyCode === KeyCode.DownArrow) {
				this._keyboardIndex = (this._keyboardIndex + 1) % visible.length;
				this._focusKeyboardNode(visible);
				e.preventDefault();
			} else if (e.keyCode === KeyCode.LeftArrow || e.keyCode === KeyCode.UpArrow) {
				this._keyboardIndex = (this._keyboardIndex - 1 + visible.length) % visible.length;
				this._focusKeyboardNode(visible);
				e.preventDefault();
			} else if (e.keyCode === KeyCode.Enter && this._keyboardIndex >= 0) {
				const sim = visible[this._keyboardIndex];
				this._inspectedId = sim.node.id;
				this.visualizationService.focusNode(sim.node.id, 'explorer');
				this._renderDetailPane();
				e.preventDefault();
			} else if (e.keyCode === KeyCode.Escape) {
				this._inspectedId = undefined;
				this._keyboardIndex = -1;
				this.visualizationService.clearFocus('explorer');
				this._renderDetailPane();
				e.preventDefault();
			}
		});
	}

	private _focusKeyboardNode(visible: VisualizationSimNode[]): void {
		const sim = visible[this._keyboardIndex];
		if (sim) {
			this._hoveredId = sim.node.id;
			this.visualizationService.scheduleAnimation({ kind: 'trail', nodeId: sim.node.id, durationMs: 600, payload: { source: 'explorer-keyboard' } });
		}
	}

	// -- Search / filters ---------------------------------------------------------

	private _runSearch(): void {
		const query = this._searchInput?.value.trim() ?? '';
		this._searchHits = new Set<string>();
		if (query.length === 0) {
			return;
		}
		// Semantic search ranks nodes by embedding similarity; hits highlight.
		void this.semanticSearchService.search(query, 8).then(results => {
			this._searchHits = new Set(results.map(r => r.node.id));
			if (results.length > 0) {
				this.visualizationService.scheduleAnimation({ kind: 'pulse', nodeId: results[0].node.id, durationMs: 1200, payload: { source: 'search' } });
			}
		});
	}

	private _renderFilterChips(): void {
		if (!this._filterBar) {
			return;
		}
		clearNode(this._filterBar);
		const counts = new Map<string, number>();
		for (const sim of this.visualizationService.getSimNodes()) {
			counts.set(sim.node.node_type, (counts.get(sim.node.node_type) ?? 0) + 1);
		}
		const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
		for (const [type, count] of top) {
			const chip = append(this._filterBar, $('.zonecog-hypergraph-chip'));
			chip.textContent = `${type} (${count})`;
			chip.tabIndex = 0;
			const hidden = this._hiddenTypes.has(type);
			chip.classList.toggle('zonecog-hypergraph-chip-off', hidden);
			chip.setAttribute('role', 'button');
			chip.setAttribute('aria-pressed', String(!hidden));
			const toggle = () => {
				if (this._hiddenTypes.has(type)) {
					this._hiddenTypes.delete(type);
				} else {
					this._hiddenTypes.add(type);
				}
				this._renderFilterChips();
			};
			chip.addEventListener('click', toggle);
			chip.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					toggle();
					e.preventDefault();
				}
			});
		}
	}

	// -- Tooltip / detail -----------------------------------------------------------

	private _renderTooltip(sim: VisualizationSimNode | undefined, x: number, y: number): void {
		if (!this._tooltip) {
			return;
		}
		if (!sim) {
			this._tooltip.style.display = 'none';
			return;
		}
		const links = this.hypergraphStore.getLinksForNode(sim.node.id).length;
		this._tooltip.style.display = '';
		this._tooltip.style.left = `${x + 12}px`;
		this._tooltip.style.top = `${y + 8}px`;
		this._tooltip.textContent = `${sim.node.node_type} · salience ${sim.node.salience_score.toFixed(2)} · ${links} links\n${sim.node.content.slice(0, 120)}`;
	}

	private _renderDetailPane(): void {
		if (!this._detailPane) {
			return;
		}
		clearNode(this._detailPane);
		if (!this._inspectedId) {
			this._detailPane.style.display = 'none';
			return;
		}
		const node = this.hypergraphStore.getNode(this._inspectedId);
		if (!node) {
			this._detailPane.style.display = 'none';
			return;
		}
		this._detailPane.style.display = '';
		append(this._detailPane, $('.zonecog-hypergraph-detail-type')).textContent = node.node_type;
		const body = append(this._detailPane, $('.zonecog-hypergraph-detail-body'));
		body.textContent = node.content.length > 400 ? `${node.content.slice(0, 400)}…` : node.content;
		const links = this.hypergraphStore.getLinksForNode(node.id);
		append(this._detailPane, $('.zonecog-hypergraph-detail-meta')).textContent =
			localize('zonecog.hypergraphDetailMeta', 'salience {0} · {1} links · id {2}', node.salience_score.toFixed(3), links.length, node.id);
	}

	// -- Legend / rendering ----------------------------------------------------------

	private _renderLegend(): void {
		if (!this._legend) {
			return;
		}
		this._legend.textContent = '';
		const nodes = this.visualizationService.getSimNodes();
		if (this._emptyMessage) {
			this._emptyMessage.style.display = nodes.length === 0 ? '' : 'none';
		}
		const counts = new Map<string, number>();
		for (const sim of nodes) {
			counts.set(sim.node.node_type, (counts.get(sim.node.node_type) ?? 0) + 1);
		}
		const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
		for (const [type, count] of top) {
			const entry = append(this._legend, $('.zonecog-hypergraph-legend-entry'));
			const swatch = append(entry, $('.zonecog-hypergraph-legend-swatch'));
			swatch.style.backgroundColor = this.visualizationService.colorForNodeType(type);
			append(entry, $('span')).textContent = `${type} (${count})`;
		}
	}

	private _draw(animations: readonly VisualizationAnimation[]): void {
		const ctx = this._canvas?.getContext('2d');
		if (!ctx || !this._canvas) {
			return;
		}
		ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
		ctx.save();
		ctx.scale(this._zoom, this._zoom);
		ctx.translate(-this._panX, -this._panY);

		const foreground = this.foreground();
		const visibleNodes = this.visualizationService.getSimNodes().filter(n => !this._hiddenTypes.has(n.node.node_type));
		const visibleIds = new Set(visibleNodes.map(n => n.node.id));
		const focused = this.visualizationService.getFocusedNode();

		// Edges, styled by link type
		ctx.lineWidth = 1;
		for (const edge of this.visualizationService.getSimEdges()) {
			if (!visibleIds.has(edge.source.node.id) || !visibleIds.has(edge.target.node.id)) {
				continue;
			}
			const linkType = edge.link.link_type;
			ctx.strokeStyle = this.visualizationService.colorForNodeType(`Link-${linkType}`);
			ctx.globalAlpha = 0.22;
			if (DASHED_LINK_TYPES.has(linkType)) {
				ctx.setLineDash([4, 3]);
			}
			ctx.beginPath();
			ctx.moveTo(edge.source.x, edge.source.y);
			ctx.lineTo(edge.target.x, edge.target.y);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Nodes
		for (const sim of visibleNodes) {
			const isHovered = sim.node.id === this._hoveredId;
			const isFocused = focused?.nodeId === sim.node.id;
			const isSearchHit = this._searchHits.has(sim.node.id);
			ctx.globalAlpha = 1;
			ctx.fillStyle = sim.color;
			ctx.beginPath();
			ctx.arc(sim.x, sim.y, sim.radius, 0, Math.PI * 2);
			ctx.fill();
			if (isHovered || isFocused || isSearchHit) {
				ctx.strokeStyle = isSearchHit ? '#ffd54f' : foreground;
				ctx.lineWidth = isFocused ? 3 : 2;
				ctx.beginPath();
				ctx.arc(sim.x, sim.y, sim.radius + 3, 0, Math.PI * 2);
				ctx.stroke();
			}
		}

		// Animation channels
		for (const animation of animations) {
			this._drawAnimation(ctx, animation, foreground);
		}

		// Labels for top-salience visible nodes
		ctx.globalAlpha = 1;
		ctx.fillStyle = foreground;
		ctx.font = '9px sans-serif';
		for (const sim of visibleNodes.slice(0, MAX_LABELS)) {
			const label = sim.node.content.length > 24 ? `${sim.node.content.slice(0, 24)}…` : sim.node.content;
			ctx.fillText(label, sim.x + sim.radius + 2, sim.y + 3);
		}

		ctx.restore();
	}

	private _drawAnimation(ctx: CanvasRenderingContext2D, animation: VisualizationAnimation, foreground: string): void {
		if (animation.kind === 'flow' && animation.sourceId && animation.targetId) {
			const source = this.visualizationService.getSimNode(animation.sourceId);
			const target = this.visualizationService.getSimNode(animation.targetId);
			if (!source || !target) {
				return;
			}
			const t = animation.progress;
			ctx.fillStyle = '#4fc3f7';
			ctx.globalAlpha = 1 - t * 0.5;
			ctx.beginPath();
			ctx.arc(source.x + (target.x - source.x) * t, source.y + (target.y - source.y) * t, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = 1;
			return;
		}
		const sim = animation.nodeId ? this.visualizationService.getSimNode(animation.nodeId) : undefined;
		if (!sim) {
			return;
		}
		if (animation.kind === 'pulse') {
			ctx.strokeStyle = '#ffd54f';
			ctx.globalAlpha = 1 - animation.progress;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(sim.x, sim.y, sim.radius + animation.progress * sim.radius * 2.5, 0, Math.PI * 2);
			ctx.stroke();
		} else if (animation.kind === 'decay') {
			ctx.strokeStyle = '#ef5350';
			ctx.globalAlpha = 1 - animation.progress;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(sim.x, sim.y, Math.max(1, sim.radius * (1 - animation.progress * 0.7)), 0, Math.PI * 2);
			ctx.stroke();
		} else if (animation.kind === 'trail') {
			ctx.strokeStyle = foreground;
			ctx.globalAlpha = (1 - animation.progress) * 0.8;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([2, 3]);
			ctx.beginPath();
			ctx.arc(sim.x, sim.y, sim.radius + 5 + animation.progress * 8, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		ctx.globalAlpha = 1;
	}
}

// Re-export for existing imports of node type in tests/docs.
export type { HypergraphNode };
