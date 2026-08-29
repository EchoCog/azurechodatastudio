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

import { IHypergraphVisualizationService, VisualizationAnimation } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { ICognitiveMembraneService, MembraneTriad } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { ICognitiveAnalyticsService } from 'sql/workbench/services/zonecog/common/cognitiveAnalytics';
import { IAAROrchestrationService, AARAgent, AARRelation } from 'sql/workbench/services/zonecog/common/aarOrchestration';

/** Debounce for stat refreshes. */
const STATS_REFRESH_MS = 400;

/** Reservoir neurons rendered per DTESN layer (activation subsample). */
const MAX_RESERVOIR_DOTS = 64;

/** Convergence sparkline window. */
const MAX_SPARK_POINTS = 60;

/**
 * Base class for canvas-backed ZoneCog visualization views: handles canvas
 * sizing, theme-aware foreground resolution, and layout propagation for
 * views rendered on a shared frame clock.
 */
abstract class ZoneCogCanvasView extends ViewPane {
	protected _canvas?: HTMLCanvasElement;
	protected _width = 300;
	protected _height = 200;

	constructor(
		options: IViewPaneOptions,
		keybindingService: IKeybindingService,
		contextMenuService: IContextMenuService,
		configurationService: IConfigurationService,
		contextKeyService: IContextKeyService,
		viewDescriptorService: IViewDescriptorService,
		instantiationService: IInstantiationService,
		openerService: IOpenerService,
		themeService: IThemeService,
		telemetryService: ITelemetryService,
		protected readonly visualizationService: IHypergraphVisualizationService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._width = Math.max(100, width);
		this._height = Math.max(100, height - 4);
		if (this._canvas) {
			this._canvas.width = this._width;
			this._canvas.height = this._height;
		}
		this.onLayout();
	}

	protected onLayout(): void {
		// optional hook for subclasses
	}

	protected get ctx(): CanvasRenderingContext2D | undefined {
		return this._canvas?.getContext('2d') ?? undefined;
	}

	protected foreground(): string {
		return this._canvas?.parentElement
			? getComputedStyle(this._canvas.parentElement).color
			: '#cccccc';
	}
}

// ---------------------------------------------------------------------------
// ECAN Attention Heatmap
// ---------------------------------------------------------------------------

/**
 * ECAN Attention Heatmap View - renders the shared simulation with a
 * salience/STI heat overlay: hot nodes glow, cold nodes dim. ECAN spreading
 * activation shows as travelling packets along edges (boosted/decayed
 * pulses); rent-collection evictions flash and fade.
 */
export class ECANAttentionHeatmapView extends ZoneCogCanvasView {
	private _statsEl?: HTMLElement;
	private _statsScheduler!: RunOnceScheduler;

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
		@IHypergraphVisualizationService visualizationService: IHypergraphVisualizationService,
		@IECANAttentionService private readonly ecanService: IECANAttentionService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, visualizationService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.membraneService.recordActivity('somatic');

		const wrapper = append(container, $('.zonecog-view.zonecog-heatmap-view'));
		this._canvas = append(wrapper, $('canvas.zonecog-hypergraph-canvas')) as HTMLCanvasElement;
		this._statsEl = append(wrapper, $('.zonecog-heatmap-stats'));

		this._register(this.visualizationService.attachRenderer(animations => {
			if (!this.isBodyVisible()) {
				return;
			}
			this._draw(animations);
		}));

		this._statsScheduler = this._register(new RunOnceScheduler(() => this._renderStats(), STATS_REFRESH_MS));
		this._register(this.ecanService.onDidSpread(() => this._statsScheduler.schedule()));
		this._register(this.visualizationService.onDidChangeSimulation(() => this._statsScheduler.schedule()));
		this._renderStats();
	}

	private _renderStats(): void {
		if (!this._statsEl) {
			return;
		}
		const snapshot = this.ecanService.getSnapshot();
		this._statsEl.textContent = localize('zonecog.heatmapStats',
			'Focus boundary {0} · {1}/{2} nodes in focus · rent collected {3} · {4} spread cycles',
			snapshot.attentionalFocusBoundary.toFixed(3),
			snapshot.nodesInFocus,
			snapshot.totalTrackedNodes,
			snapshot.rentCollected.toFixed(1),
			snapshot.spreadingCycles);
	}

	private _draw(animations: readonly VisualizationAnimation[]): void {
		const ctx = this.ctx;
		if (!ctx) {
			return;
		}
		const nodes = this.visualizationService.getSimNodes();
		const edges = this.visualizationService.getSimEdges();
		const boundary = this.ecanService.getFocusBoundary();
		ctx.clearRect(0, 0, this._width, this._height);
		const fg = this.foreground();

		// Edges
		ctx.strokeStyle = fg;
		ctx.globalAlpha = 0.2;
		ctx.lineWidth = 1;
		for (const edge of edges) {
			ctx.beginPath();
			ctx.moveTo(edge.source.x, edge.source.y);
			ctx.lineTo(edge.target.x, edge.target.y);
			ctx.stroke();
		}

		// Heat overlay: STI above boundary renders as a warm glow
		for (const sim of nodes) {
			const av = this.ecanService.getAttentionValue(sim.node.id);
			const heat = Math.max(0, Math.min(1, (av.sti + 1) / 2));
			const inFocus = av.sti >= boundary;
			if (inFocus) {
				const glow = ctx.createRadialGradient(sim.x, sim.y, 0, sim.x, sim.y, sim.radius * 3);
				glow.addColorStop(0, `rgba(255, ${Math.round(120 + heat * 100)}, 40, ${0.35 + heat * 0.3})`);
				glow.addColorStop(1, 'rgba(255, 80, 0, 0)');
				ctx.fillStyle = glow;
				ctx.globalAlpha = 1;
				ctx.beginPath();
				ctx.arc(sim.x, sim.y, sim.radius * 3, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 0.4 + heat * 0.6;
			ctx.fillStyle = inFocus ? `hsl(${Math.round(30 - heat * 30)}, 90%, 55%)` : sim.color;
			ctx.beginPath();
			ctx.arc(sim.x, sim.y, sim.radius, 0, Math.PI * 2);
			ctx.fill();
		}

		// Animations: pulses, decay flashes, edge-flow packets
		ctx.globalAlpha = 1;
		for (const animation of animations) {
			this._drawAnimation(ctx, animation);
		}
	}

	private _drawAnimation(ctx: CanvasRenderingContext2D, animation: VisualizationAnimation): void {
		if (animation.kind === 'flow' && animation.sourceId && animation.targetId) {
			const source = this.visualizationService.getSimNode(animation.sourceId);
			const target = this.visualizationService.getSimNode(animation.targetId);
			if (!source || !target) {
				return;
			}
			const t = animation.progress;
			const x = source.x + (target.x - source.x) * t;
			const y = source.y + (target.y - source.y) * t;
			ctx.fillStyle = '#4fc3f7';
			ctx.globalAlpha = 1 - t * 0.5;
			ctx.beginPath();
			ctx.arc(x, y, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = 1;
			return;
		}
		const sim = animation.nodeId ? this.visualizationService.getSimNode(animation.nodeId) : undefined;
		if (!sim) {
			return;
		}
		if (animation.kind === 'pulse') {
			const r = sim.radius + animation.progress * sim.radius * 2.5;
			ctx.strokeStyle = '#ffd54f';
			ctx.globalAlpha = 1 - animation.progress;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(sim.x, sim.y, r, 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		} else if (animation.kind === 'decay') {
			ctx.strokeStyle = '#ef5350';
			ctx.globalAlpha = 1 - animation.progress;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(sim.x, sim.y, Math.max(1, sim.radius * (1 - animation.progress * 0.7)), 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}
}

// ---------------------------------------------------------------------------
// Membrane triad health diagram
// ---------------------------------------------------------------------------

/** Triad positions on the diagram (fractions of canvas size). */
const TRIAD_LAYOUT: Array<{ triad: MembraneTriad; fx: number; fy: number; label: string }> = [
	{ triad: 'cerebral', fx: 0.5, fy: 0.22, label: 'Cerebral' },
	{ triad: 'somatic', fx: 0.25, fy: 0.7, label: 'Somatic' },
	{ triad: 'autonomic', fx: 0.75, fy: 0.7, label: 'Autonomic' }
];

/**
 * Membrane Triad Diagram View - animated P-System architecture diagram.
 * Each triad is a ring whose pulse rate reflects real activity traffic and
 * whose color reflects health; inter-membrane channels carry flow packets
 * whenever activity is recorded.
 */
export class MembraneTriadDiagramView extends ZoneCogCanvasView {
	private _lastActivity = new Map<MembraneTriad, number>();
	private _phase = 0;

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
		@IHypergraphVisualizationService visualizationService: IHypergraphVisualizationService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, visualizationService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._canvas = append(append(container, $('.zonecog-view.zonecog-membrane-diagram')), $('canvas.zonecog-hypergraph-canvas')) as HTMLCanvasElement;

		this._register(this.visualizationService.attachRenderer(() => {
			if (!this.isBodyVisible()) {
				return;
			}
			this._draw();
		}));

		this._register(this.membraneService.onDidChangeMembraneStatus(status => {
			this._lastActivity.set(status.triad, Date.now());
			// Inter-membrane flow: any triad activity sends packets to the others.
			for (const other of TRIAD_LAYOUT) {
				if (other.triad !== status.triad) {
					this.visualizationService.scheduleAnimation({
						kind: 'flow',
						sourceId: `membrane-${status.triad}`,
						targetId: `membrane-${other.triad}`,
						durationMs: 900,
						payload: { membrane: status.triad }
					});
				}
			}
		}));

		for (const t of TRIAD_LAYOUT) {
			this._lastActivity.set(t.triad, 0);
		}
	}

	private _triadCenter(triad: MembraneTriad): { x: number; y: number } {
		const layout = TRIAD_LAYOUT.find(t => t.triad === triad)!;
		return { x: layout.fx * this._width, y: layout.fy * this._height };
	}

	private _draw(): void {
		const ctx = this.ctx;
		if (!ctx) {
			return;
		}
		this._phase = (this._phase + 0.03) % (Math.PI * 2);
		ctx.clearRect(0, 0, this._width, this._height);
		const fg = this.foreground();
		const now = Date.now();

		// Inter-membrane channels
		ctx.strokeStyle = fg;
		ctx.globalAlpha = 0.25;
		ctx.lineWidth = 2;
		for (let i = 0; i < TRIAD_LAYOUT.length; i++) {
			for (let j = i + 1; j < TRIAD_LAYOUT.length; j++) {
				const a = this._triadCenter(TRIAD_LAYOUT[i].triad);
				const b = this._triadCenter(TRIAD_LAYOUT[j].triad);
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.stroke();
			}
		}

		// Membrane flow packets along channels
		for (const animation of this.visualizationService.getActiveAnimations()) {
			if (animation.kind !== 'flow' || !animation.sourceId || !animation.targetId) {
				continue;
			}
			const srcTriad = animation.sourceId.replace('membrane-', '') as MembraneTriad;
			const dstTriad = animation.targetId.replace('membrane-', '') as MembraneTriad;
			if (!TRIAD_LAYOUT.some(t => t.triad === srcTriad) || !TRIAD_LAYOUT.some(t => t.triad === dstTriad)) {
				continue;
			}
			const a = this._triadCenter(srcTriad);
			const b = this._triadCenter(dstTriad);
			const t = animation.progress;
			ctx.fillStyle = '#81c784';
			ctx.globalAlpha = 1 - t * 0.4;
			ctx.beginPath();
			ctx.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		// Triad rings
		ctx.globalAlpha = 1;
		for (const layout of TRIAD_LAYOUT) {
			const status = this.membraneService.getStatus(layout.triad);
			const center = this._triadCenter(layout.triad);
			const baseRadius = Math.min(this._width, this._height) * 0.13;
			// Pulse faster after recent activity
			const recentActivity = now - (this._lastActivity.get(layout.triad) ?? 0) < 2000;
			const pulse = recentActivity ? Math.sin(this._phase * 3) * 3 : Math.sin(this._phase) * 1.5;
			const radius = baseRadius + pulse;

			ctx.strokeStyle = status.healthy ? '#66bb6a' : '#ef5350';
			ctx.lineWidth = status.healthy ? 3 : 4;
			ctx.globalAlpha = 0.9;
			ctx.beginPath();
			ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
			ctx.stroke();

			// Inner activity ring (arc length proportional to active processes)
			const activityRatio = Math.min(1, status.activeProcesses / 10);
			ctx.strokeStyle = status.healthy ? '#a5d6a7' : '#e57373';
			ctx.lineWidth = 5;
			ctx.globalAlpha = 0.7;
			ctx.beginPath();
			ctx.arc(center.x, center.y, radius * 0.7, -Math.PI / 2, -Math.PI / 2 + activityRatio * Math.PI * 2);
			ctx.stroke();

			// Labels
			ctx.globalAlpha = 1;
			ctx.fillStyle = fg;
			ctx.font = '11px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(layout.label, center.x, center.y - 2);
			ctx.font = '9px sans-serif';
			const detail = status.errorCount > 0
				? localize('zonecog.membraneErrors', '{0} proc · {1} err', status.activeProcesses, status.errorCount)
				: localize('zonecog.membraneOk', '{0} proc', status.activeProcesses);
			ctx.fillText(detail, center.x, center.y + 11);
		}
		ctx.textAlign = 'left';
	}
}

// ---------------------------------------------------------------------------
// DTESN reservoir animation
// ---------------------------------------------------------------------------

/**
 * DTESN Reservoir Animation View - live scatter of reservoir activations
 * per layer (position stable per neuron, brightness by activation magnitude),
 * a spectral-radius gauge per layer, and a training-convergence sparkline fed
 * by the cognitive analytics MSE history.
 */
export class DTESNReservoirAnimationView extends ZoneCogCanvasView {
	private _mseHistory: number[] = [];

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
		@IHypergraphVisualizationService visualizationService: IHypergraphVisualizationService,
		@IDTESNService private readonly dtesnService: IDTESNService,
		@ICognitiveAnalyticsService private readonly analyticsService: ICognitiveAnalyticsService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, visualizationService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._canvas = append(append(container, $('.zonecog-view.zonecog-reservoir-view')), $('canvas.zonecog-hypergraph-canvas')) as HTMLCanvasElement;

		this._register(this.visualizationService.attachRenderer(() => {
			if (!this.isBodyVisible()) {
				return;
			}
			this._draw();
		}));

		this._register(this.dtesnService.onDidLearn(e => {
			this._mseHistory.push(e.mse);
			if (this._mseHistory.length > MAX_SPARK_POINTS) {
				this._mseHistory.shift();
			}
		}));
		// Seed from analytics history so the sparkline is useful immediately.
		this._mseHistory = this.analyticsService.getDTESNConvergence().mseHistory.slice(-MAX_SPARK_POINTS);
	}

	private _draw(): void {
		const ctx = this.ctx;
		if (!ctx) {
			return;
		}
		ctx.clearRect(0, 0, this._width, this._height);
		const fg = this.foreground();
		const state = this.dtesnService.getState();
		const config = this.dtesnService.getConfig();
		const layerBandWidth = this._width / Math.max(1, state.layers.length);

		// Layer scatter bands
		for (let layerIdx = 0; layerIdx < state.layers.length; layerIdx++) {
			const layer = state.layers[layerIdx];
			const x0 = layerIdx * layerBandWidth;
			const spectral = this.dtesnService.getLayerSpectralRadius(layerIdx);

			// Band separator
			ctx.strokeStyle = fg;
			ctx.globalAlpha = 0.2;
			ctx.beginPath();
			ctx.moveTo(x0, 0);
			ctx.lineTo(x0, this._height - 60);
			ctx.stroke();

			// Neuron dots: activation magnitude -> brightness
			const step = Math.max(1, Math.floor(layer.activation.length / MAX_RESERVOIR_DOTS));
			for (let i = 0; i < layer.activation.length; i += step) {
				const activation = layer.activation[i];
				const magnitude = Math.min(1, Math.abs(activation));
				const nx = x0 + ((i / step) % 8 + 0.5) * (layerBandWidth / 8);
				const ny = 20 + (Math.floor(i / step / 8) + 0.5) * ((this._height - 100) / Math.ceil(Math.min(MAX_RESERVOIR_DOTS, layer.activation.length / step) / 8));
				ctx.fillStyle = activation >= 0 ? `rgba(79, 195, 247, ${0.25 + magnitude * 0.75})` : `rgba(186, 104, 200, ${0.25 + magnitude * 0.75})`;
				ctx.globalAlpha = 1;
				ctx.beginPath();
				ctx.arc(nx, Math.min(this._height - 70, ny), 2 + magnitude * 3, 0, Math.PI * 2);
				ctx.fill();
			}

			// Spectral radius gauge
			const gaugeY = this._height - 55;
			const target = config.layers[Math.min(layerIdx, config.layers.length - 1)]?.spectralRadius ?? 1;
			const ratio = Math.min(1.5, spectral / Math.max(0.0001, target)) / 1.5;
			ctx.globalAlpha = 0.25;
			ctx.fillStyle = fg;
			ctx.fillRect(x0 + 6, gaugeY, layerBandWidth - 12, 6);
			ctx.globalAlpha = 1;
			ctx.fillStyle = spectral > 1 ? '#ef5350' : '#66bb6a';
			ctx.fillRect(x0 + 6, gaugeY, (layerBandWidth - 12) * ratio, 6);
			ctx.fillStyle = fg;
			ctx.font = '9px sans-serif';
			ctx.fillText(localize('zonecog.layerGauge', 'L{0} ρ={1}', layerIdx, spectral.toFixed(3)), x0 + 6, gaugeY + 16);
		}

		// Convergence sparkline
		const sparkTop = this._height - 30;
		const sparkHeight = 24;
		ctx.strokeStyle = fg;
		ctx.globalAlpha = 0.3;
		ctx.strokeRect(4, sparkTop, this._width - 8, sparkHeight);
		if (this._mseHistory.length > 1) {
			const max = Math.max(...this._mseHistory, 1e-12);
			ctx.strokeStyle = '#ffd54f';
			ctx.globalAlpha = 1;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let i = 0; i < this._mseHistory.length; i++) {
				const x = 4 + (i / (MAX_SPARK_POINTS - 1)) * (this._width - 8);
				const y = sparkTop + sparkHeight - (this._mseHistory[i] / max) * sparkHeight;
				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
		ctx.fillStyle = fg;
		ctx.font = '9px sans-serif';
		ctx.fillText(localize('zonecog.convergenceLabel', 'Training MSE ({0} runs)', this._mseHistory.length), 8, sparkTop - 3);
	}
}

// ---------------------------------------------------------------------------
// AAR orchestration graph
// ---------------------------------------------------------------------------

/**
 * AAR Orchestration Graph View - the Agent-Arena-Relation network rendered
 * as a live graph: agents are nodes (color by role, ring when active),
 * relations are directed edges (styled by relation type), and task
 * completions send a flow packet along the agent path taken.
 */
export class AAROrchestrationGraphView extends ZoneCogCanvasView {
	private _positions = new Map<string, { x: number; y: number }>();

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
		@IHypergraphVisualizationService visualizationService: IHypergraphVisualizationService,
		@IAAROrchestrationService private readonly aarService: IAAROrchestrationService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, visualizationService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._canvas = append(append(container, $('.zonecog-view.zonecog-aar-graph')), $('canvas.zonecog-hypergraph-canvas')) as HTMLCanvasElement;

		this._register(this.visualizationService.attachRenderer(() => {
			if (!this.isBodyVisible()) {
				return;
			}
			this._draw();
		}));

		this._register(this.aarService.onDidCompleteTask(result => {
			// Message-flow packets along the agent path taken by the task.
			for (let i = 0; i + 1 < result.agentPath.length; i++) {
				this.visualizationService.scheduleAnimation({
					kind: 'flow',
					sourceId: `aar-${result.agentPath[i]}`,
					targetId: `aar-${result.agentPath[i + 1]}`,
					durationMs: 700,
					payload: { taskId: result.task.id, success: result.success }
				});
			}
		}));
	}

	protected override onLayout(): void {
		this._layoutAgents();
	}

	private _layoutAgents(): void {
		const agents = this.aarService.getAllAgents();
		const cx = this._width / 2;
		const cy = this._height / 2;
		const radius = Math.min(this._width, this._height) * 0.36;
		for (let i = 0; i < agents.length; i++) {
			const angle = (i / Math.max(1, agents.length)) * Math.PI * 2 - Math.PI / 2;
			this._positions.set(agents[i].id, {
				x: cx + Math.cos(angle) * radius,
				y: cy + Math.sin(angle) * radius
			});
		}
	}

	private _roleColor(agent: AARAgent): string {
		return this.visualizationService.colorForNodeType(`AAR-${agent.role}`);
	}

	private _draw(): void {
		const ctx = this.ctx;
		if (!ctx) {
			return;
		}
		if (this._positions.size === 0) {
			this._layoutAgents();
		}
		ctx.clearRect(0, 0, this._width, this._height);
		const fg = this.foreground();
		const agents = this.aarService.getAllAgents();

		if (agents.length === 0) {
			ctx.fillStyle = fg;
			ctx.font = '11px sans-serif';
			ctx.globalAlpha = 0.7;
			ctx.fillText(localize('zonecog.aarEmpty', 'No agents registered in the Arena yet.'), 10, 20);
			ctx.globalAlpha = 1;
			return;
		}

		// Arena ring
		const cx = this._width / 2;
		const cy = this._height / 2;
		ctx.strokeStyle = fg;
		ctx.globalAlpha = 0.3;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.arc(cx, cy, Math.min(this._width, this._height) * 0.18, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.font = '9px sans-serif';
		ctx.fillStyle = fg;
		ctx.textAlign = 'center';
		ctx.fillText(localize('zonecog.arena', 'Arena'), cx, cy + 3);
		ctx.textAlign = 'left';

		// Relations (directed edges)
		const drawnRelations = new Set<string>();
		for (const agent of agents) {
			for (const relation of this.aarService.getRelationsFrom(agent.id)) {
				if (drawnRelations.has(relation.id)) {
					continue;
				}
				drawnRelations.add(relation.id);
				const a = this._positions.get(relation.sourceAgentId);
				const b = this._positions.get(relation.targetAgentId);
				if (!a || !b) {
					continue;
				}
				this._drawRelation(ctx, relation, a, b);
			}
		}

		// Task flow packets
		for (const animation of this.visualizationService.getActiveAnimations()) {
			if (animation.kind !== 'flow' || !animation.sourceId?.startsWith('aar-')) {
				continue;
			}
			const a = this._positions.get(animation.sourceId.slice(4));
			const b = animation.targetId ? this._positions.get(animation.targetId.slice(4)) : undefined;
			if (!a || !b) {
				continue;
			}
			const t = animation.progress;
			ctx.fillStyle = animation.payload?.success === false ? '#ef5350' : '#4fc3f7';
			ctx.globalAlpha = 1 - t * 0.4;
			ctx.beginPath();
			ctx.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = 1;
		}

		// Agent nodes
		for (const agent of agents) {
			const pos = this._positions.get(agent.id);
			if (!pos) {
				continue;
			}
			ctx.fillStyle = agent.active ? this._roleColor(agent) : '#757575';
			ctx.globalAlpha = agent.active ? 1 : 0.5;
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
			ctx.fill();

			// Load ring
			const loadRatio = Math.min(1, agent.totalTasksProcessed > 0 ? 0.3 + Math.min(0.7, agent.totalTasksProcessed / 50) : 0);
			ctx.strokeStyle = fg;
			ctx.globalAlpha = 0.5;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, 11, -Math.PI / 2, -Math.PI / 2 + loadRatio * Math.PI * 2);
			ctx.stroke();

			ctx.globalAlpha = 1;
			ctx.fillStyle = fg;
			ctx.font = '9px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(agent.name.length > 14 ? `${agent.name.slice(0, 14)}…` : agent.name, pos.x, pos.y + 22);
			ctx.textAlign = 'left';
		}
	}

	private _drawRelation(ctx: CanvasRenderingContext2D, relation: AARRelation, a: { x: number; y: number }, b: { x: number; y: number }): void {
		ctx.strokeStyle = this.visualizationService.colorForNodeType(`AARRelation-${relation.relationType}`);
		ctx.globalAlpha = relation.active ? 0.6 : 0.2;
		ctx.lineWidth = 1 + relation.weight * 2;
		if (relation.relationType === 'monitors' || relation.relationType === 'modulates') {
			ctx.setLineDash([3, 3]);
		}
		ctx.beginPath();
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.stroke();
		ctx.setLineDash([]);

		// Arrowhead
		const angle = Math.atan2(b.y - a.y, b.x - a.x);
		const ax = b.x - Math.cos(angle) * 12;
		const ay = b.y - Math.sin(angle) * 12;
		ctx.beginPath();
		ctx.moveTo(ax, ay);
		ctx.lineTo(ax - 6 * Math.cos(angle - 0.4), ay - 6 * Math.sin(angle - 0.4));
		ctx.lineTo(ax - 6 * Math.cos(angle + 0.4), ay - 6 * Math.sin(angle + 0.4));
		ctx.closePath();
		ctx.fillStyle = ctx.strokeStyle;
		ctx.fill();
		ctx.globalAlpha = 1;
	}
}
