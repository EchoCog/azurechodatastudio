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
import { IDisposable } from 'vs/base/common/lifecycle';
import { RunOnceScheduler } from 'vs/base/common/async';

import { IHypergraphVisualizationService, VisualizationSimNode, VisualizationAnimation } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { ICognitiveMembraneService, MembraneTriad } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';

const WIDGET_PADDING = 12;
const MINI_CANVAS_SIZE = 160;
const REFRESH_MS = 500;

/**
 * Dashboard ZoneCog tab - renders a compact dashboard with three mini-widgets:
 *   1. Mini hypergraph overview (force-directed snapshot)
 *   2. Membrane triad health indicators
 *   3. ECAN attention heatmap summary
 *
 * Completes Phase 6.3 "Dashboard ZoneCog tab with mini hypergraph/membrane/heatmap widgets".
 */
export class ZoneCogDashboardTabView extends ViewPane {
	private _container?: HTMLElement;
	private _miniHypergraphCanvas?: HTMLCanvasElement;
	private _membraneContainer?: HTMLElement;
	private _heatmapCanvas?: HTMLCanvasElement;
	private _rendererHandle?: IDisposable;
	private _refreshScheduler: RunOnceScheduler;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IECANAttentionService _ecanService: IECANAttentionService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._refreshScheduler = new RunOnceScheduler(() => this._refresh(), REFRESH_MS);
		this._register(this.membraneService.onDidChangeMembraneStatus(() => this._refreshScheduler.schedule()));
		this._register(this.hypergraphStore.onDidChangeNode(() => this._refreshScheduler.schedule()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = append(container, $('div.zonecog-dashboard-tab'));
		this._container.style.display = 'flex';
		this._container.style.flexWrap = 'wrap';
		this._container.style.gap = `${WIDGET_PADDING}px`;
		this._container.style.padding = `${WIDGET_PADDING}px`;
		this._container.style.overflow = 'auto';

		this._buildMiniHypergraph();
		this._buildMembraneWidget();
		this._buildHeatmapWidget();

		this._rendererHandle = this.visualizationService.attachRenderer((animations) => {
			this._drawMiniHypergraph(animations);
			this._drawHeatmap();
		});
		this._register({ dispose: () => this._rendererHandle?.dispose() });
		this._refresh();
	}

	private _buildMiniHypergraph(): void {
		const wrapper = append(this._container!, $('div.zonecog-dashboard-widget'));
		append(wrapper, $('div.zonecog-dashboard-widget-title')).textContent =
			localize('zonecog.dashMiniHypergraph', 'Hypergraph Overview');
		this._miniHypergraphCanvas = append(wrapper, $('canvas.zonecog-dashboard-mini-hypergraph'));
		this._miniHypergraphCanvas.width = MINI_CANVAS_SIZE;
		this._miniHypergraphCanvas.height = MINI_CANVAS_SIZE;
	}

	private _buildMembraneWidget(): void {
		const wrapper = append(this._container!, $('div.zonecog-dashboard-widget'));
		append(wrapper, $('div.zonecog-dashboard-widget-title')).textContent =
			localize('zonecog.dashMembraneHealth', 'Membrane Health');
		this._membraneContainer = append(wrapper, $('div.zonecog-dashboard-membrane'));
	}

	private _buildHeatmapWidget(): void {
		const wrapper = append(this._container!, $('div.zonecog-dashboard-widget'));
		append(wrapper, $('div.zonecog-dashboard-widget-title')).textContent =
			localize('zonecog.dashAttentionHeatmap', 'Attention Heatmap');
		this._heatmapCanvas = append(wrapper, $('canvas.zonecog-dashboard-mini-heatmap'));
		this._heatmapCanvas.width = MINI_CANVAS_SIZE;
		this._heatmapCanvas.height = MINI_CANVAS_SIZE;
	}

	private _refresh(): void {
		this._updateMembrane();
	}

	private _drawMiniHypergraph(animations: readonly VisualizationAnimation[]): void {
		const canvas = this._miniHypergraphCanvas;
		if (!canvas) {
			return;
		}
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return;
		}
		const w = canvas.width;
		const h = canvas.height;
		ctx.clearRect(0, 0, w, h);

		const nodes = this.visualizationService.getSimNodes();
		const edges = this.visualizationService.getSimEdges();
		if (nodes.length === 0) {
			ctx.fillStyle = this._foreground(canvas);
			ctx.font = '11px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(localize('zonecog.dashEmpty', 'No nodes'), w / 2, h / 2);
			return;
		}

		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const n of nodes) {
			if (n.x < minX) { minX = n.x; }
			if (n.x > maxX) { maxX = n.x; }
			if (n.y < minY) { minY = n.y; }
			if (n.y > maxY) { maxY = n.y; }
		}
		const rangeX = Math.max(maxX - minX, 1);
		const rangeY = Math.max(maxY - minY, 1);
		const pad = 16;
		const scaleX = (w - pad * 2) / rangeX;
		const scaleY = (h - pad * 2) / rangeY;
		const scale = Math.min(scaleX, scaleY);

		const tx = (n: VisualizationSimNode) => pad + (n.x - minX) * scale;
		const ty = (n: VisualizationSimNode) => pad + (n.y - minY) * scale;

		ctx.globalAlpha = 0.3;
		ctx.strokeStyle = this._foreground(canvas);
		ctx.lineWidth = 0.5;
		for (const e of edges) {
			ctx.beginPath();
			ctx.moveTo(tx(e.source), ty(e.source));
			ctx.lineTo(tx(e.target), ty(e.target));
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		for (const n of nodes) {
			const r = Math.max(2, n.radius * 0.4);
			const px = tx(n);
			const py = ty(n);
			ctx.beginPath();
			ctx.arc(px, py, r, 0, Math.PI * 2);
			ctx.fillStyle = n.color;
			ctx.fill();

			const pulseAnim = animations.find(a => a.kind === 'pulse' && a.nodeId === n.node.id);
			if (pulseAnim) {
				ctx.beginPath();
				ctx.arc(px, py, r + 6 * pulseAnim.progress, 0, Math.PI * 2);
				ctx.strokeStyle = n.color;
				ctx.globalAlpha = 1 - pulseAnim.progress;
				ctx.lineWidth = 2;
				ctx.stroke();
				ctx.globalAlpha = 1;
				ctx.lineWidth = 0.5;
			}
		}
	}

	private _updateMembrane(): void {
		if (!this._membraneContainer) {
			return;
		}
		this._membraneContainer.innerHTML = '';
		const triads: MembraneTriad[] = ['cerebral', 'somatic', 'autonomic'];
		for (const triad of triads) {
			const status = this.membraneService.getStatus(triad);
			const row = append(this._membraneContainer, $('div.zonecog-dashboard-membrane-row'));
			const indicator = append(row, $('span.zonecog-dashboard-membrane-indicator'));
			indicator.style.width = '10px';
			indicator.style.height = '10px';
			indicator.style.borderRadius = '50%';
			indicator.style.display = 'inline-block';
			indicator.style.marginRight = '8px';
			indicator.style.backgroundColor = status.healthy ? '#4caf50' : '#f44336';

			const label = append(row, $('span'));
			label.textContent = `${triad[0].toUpperCase()}${triad.slice(1)}: ${status.activeProcesses} active, ${status.errorCount} errors`;
		}
	}

	private _drawHeatmap(): void {
		const canvas = this._heatmapCanvas;
		if (!canvas) {
			return;
		}
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return;
		}
		const w = canvas.width;
		const h = canvas.height;
		ctx.clearRect(0, 0, w, h);

		const nodes = this.visualizationService.getSimNodes();
		if (nodes.length === 0) {
			ctx.fillStyle = this._foreground(canvas);
			ctx.font = '11px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(localize('zonecog.dashHeatmapEmpty', 'No attention data'), w / 2, h / 2);
			return;
		}

		const gridSize = 8;
		const cellW = w / gridSize;
		const cellH = h / gridSize;
		const grid: number[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));

		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const n of nodes) {
			if (n.x < minX) { minX = n.x; }
			if (n.x > maxX) { maxX = n.x; }
			if (n.y < minY) { minY = n.y; }
			if (n.y > maxY) { maxY = n.y; }
		}
		const rangeX = Math.max(maxX - minX, 1);
		const rangeY = Math.max(maxY - minY, 1);

		for (const n of nodes) {
			const gx = Math.min(gridSize - 1, Math.floor(((n.x - minX) / rangeX) * gridSize));
			const gy = Math.min(gridSize - 1, Math.floor(((n.y - minY) / rangeY) * gridSize));
			grid[gy][gx] += n.node.salience_score;
		}

		let maxVal = 0;
		for (let r = 0; r < gridSize; r++) {
			for (let c = 0; c < gridSize; c++) {
				if (grid[r][c] > maxVal) { maxVal = grid[r][c]; }
			}
		}
		if (maxVal === 0) { maxVal = 1; }

		for (let r = 0; r < gridSize; r++) {
			for (let c = 0; c < gridSize; c++) {
				const intensity = grid[r][c] / maxVal;
				const red = Math.round(255 * intensity);
				const blue = Math.round(255 * (1 - intensity));
				ctx.fillStyle = `rgba(${red}, ${Math.round(40 * intensity)}, ${blue}, ${0.15 + 0.85 * intensity})`;
				ctx.fillRect(c * cellW, r * cellH, cellW - 1, cellH - 1);
			}
		}
	}

	private _foreground(canvas: HTMLCanvasElement): string {
		return canvas.parentElement
			? getComputedStyle(canvas.parentElement).color
			: '#cccccc';
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._width = Math.max(100, width);
		this._height = Math.max(100, height - 4);
	}

	public override dispose(): void {
		this._rendererHandle?.dispose();
		this._refreshScheduler.dispose();
		super.dispose();
	}
}
