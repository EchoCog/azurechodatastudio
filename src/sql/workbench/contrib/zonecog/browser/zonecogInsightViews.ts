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
import { RunOnceScheduler } from 'vs/base/common/async';

import { IZoneCogService, ThinkingPhase, ZoneCogResponse, IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ICognitiveTraceService } from 'sql/workbench/services/zonecog/common/cognitiveTrace';
import { ICognitiveWorkspaceService, CognitiveEpisode } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { ICognitiveProvenanceService, CognitiveDecision } from 'sql/workbench/services/zonecog/common/cognitiveProvenance';
import { IPLNReasoningService, InferredLink } from 'sql/workbench/services/zonecog/common/plnReasoning';
import { IHypergraphVisualizationService } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';

/** Maximum swim-lane bars kept on screen. */
const MAX_TIMELINE_PHASES = 60;

/** Maximum episodes on the timeline. */
const MAX_TIMELINE_EPISODES = 40;

/** Maximum provenance decisions listed. */
const MAX_PROVENANCE_DECISIONS = 25;

/** Maximum chain entries rendered per decision. */
const MAX_CHAIN_ENTRIES = 30;

/** Debounce for provenance/inference list rebuilds. */
const LIST_REFRESH_MS = 400;

/**
 * Thinking Timeline View - swim-lane visualization of the 11-phase thinking
 * protocol. Each phase renders as a positioned, width-proportional bar on a
 * single timeline per query; replayed traces flow through the same pipeline.
 */
export class ThinkingTimelineView extends ViewPane {
	private _lanesEl?: HTMLElement;
	private _currentPhases: ThinkingPhase[] = [];
	private _liveLane?: HTMLElement;

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
		@IZoneCogService private readonly zonecogService: IZoneCogService,
		@ICognitiveTraceService private readonly traceService: ICognitiveTraceService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const section = append(container, $('.zonecog-view'));
		append(section, $('.zonecog-section-header')).textContent = localize('zonecog.thinkingTimeline', 'Thinking Timeline');
		this._lanesEl = append(section, $('.zonecog-timeline-lanes'));
		this._renderIdle();

		this._register(this.zonecogService.onDidCompleteThinkingPhase(phase => this._onPhase(phase)));
		this._register(this.zonecogService.onDidProcessQuery(response => this._onQueryComplete(response)));
		// Trace replays render through the same swim-lane pipeline.
		this._register(this.traceService.onDidReplayPhase(e => this._onPhase(e.phase)));
		this._register(this.traceService.onDidCompleteReplay(() => this._onQueryComplete(undefined)));
	}

	private _renderIdle(): void {
		if (!this._lanesEl) {
			return;
		}
		clearNode(this._lanesEl);
		append(this._lanesEl, $('.zonecog-thinking-idle')).textContent =
			localize('zonecog.timelineIdle', 'Idle - process a query (or replay a trace) to see the phase swim-lane.');
	}

	private _onPhase(phase: ThinkingPhase): void {
		if (!this._lanesEl) {
			return;
		}
		if (this._currentPhases.length === 0) {
			clearNode(this._lanesEl);
			this._liveLane = append(this._lanesEl, $('.zonecog-timeline-lane'));
		}
		this._currentPhases.push(phase);

		if (!this._liveLane) {
			return;
		}
		// Cumulative offset of this phase within the current query.
		let offset = 0;
		for (let i = 0; i < this._currentPhases.length - 1; i++) {
			offset += Math.max(1, this._currentPhases[i].durationMs);
		}
		const bar = append(this._liveLane, $('.zonecog-timeline-bar'));
		bar.style.width = `${Math.max(24, Math.min(240, phase.durationMs / 4))}px`;
		bar.style.marginLeft = `${Math.min(360, offset / 8)}px`;
		bar.title = `${phase.name} · ${phase.durationMs}ms`;
		append(bar, $('.zonecog-timeline-bar-label')).textContent = `${this._currentPhases.length}. ${phase.name}`;
		append(bar, $('.zonecog-timeline-bar-duration')).textContent = `${phase.durationMs}ms`;
	}

	private _onQueryComplete(_response: ZoneCogResponse | undefined): void {
		this._currentPhases = [];
		this._liveLane = undefined;
		// Trim old lanes
		if (this._lanesEl) {
			while (this._lanesEl.children.length > MAX_TIMELINE_PHASES) {
				this._lanesEl.removeChild(this._lanesEl.children[0]);
			}
		}
	}
}

/**
 * Episodic Memory Timeline View - a time-scrubber over recorded cognitive
 * episodes. Scrubbing highlights the hypergraph nodes created during that
 * episode through the shared selection bus, replaying the moment.
 */
export class EpisodicTimelineView extends ViewPane {
	private _scrubber?: HTMLInputElement;
	private _listEl?: HTMLElement;
	private _detailEl?: HTMLElement;
	private _episodes: CognitiveEpisode[] = [];

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
		@ICognitiveWorkspaceService private readonly workspaceService: ICognitiveWorkspaceService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const section = append(container, $('.zonecog-view'));
		append(section, $('.zonecog-section-header')).textContent = localize('zonecog.episodeTimeline', 'Episodic Memory Timeline');

		const controls = append(section, $('.zonecog-timeline-controls'));
		append(controls, $('span.zonecog-timeline-scrub-label')).textContent = localize('zonecog.scrub', 'Scrub');
		this._scrubber = append(controls, $('input.zonecog-timeline-scrubber')) as HTMLInputElement;
		this._scrubber.type = 'range';
		this._scrubber.min = '0';
		this._scrubber.max = '0';
		this._scrubber.value = '0';
		this._scrubber.setAttribute('aria-label', localize('zonecog.scrubAria', 'Scrub through recorded episodes'));
		this._detailEl = append(section, $('.zonecog-timeline-detail'));
		this._listEl = append(section, $('.zonecog-wm-list'));

		this._register(this.workspaceService.onDidRecordEpisode(() => this._refresh()));

		this._scrubber.addEventListener('input', () => this._onScrub());

		this._refresh();
	}

	private _refresh(): void {
		this._episodes = this.workspaceService.getRecentEpisodes(MAX_TIMELINE_EPISODES).reverse(); // oldest first
		if (this._scrubber) {
			this._scrubber.max = String(Math.max(0, this._episodes.length - 1));
			this._scrubber.value = this._scrubber.max;
		}
		this._renderList();
		this._renderDetail(this._episodes.length - 1);
	}

	private _renderList(): void {
		if (!this._listEl) {
			return;
		}
		clearNode(this._listEl);
		if (this._episodes.length === 0) {
			append(this._listEl, $('.zonecog-thinking-idle')).textContent =
				localize('zonecog.noEpisodes', 'No episodes recorded yet - cognitive activity will appear here.');
			return;
		}
		for (let i = this._episodes.length - 1; i >= 0; i--) {
			const episode = this._episodes[i];
			const item = append(this._listEl, $('.zonecog-wm-item'));
			append(item, $('.zonecog-wm-category')).textContent = new Date(episode.endTime).toLocaleTimeString();
			const content = append(item, $('.zonecog-wm-content'));
			content.textContent = episode.title;
			content.title = episode.title;
			append(item, $('.zonecog-wm-relevance')).textContent = localize('zonecog.episodeNodes', '{0} nodes', episode.relatedNodes.length);
			item.tabIndex = 0;
			const index = i;
			item.addEventListener('click', () => this._selectEpisode(index));
			item.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					this._selectEpisode(index);
					e.preventDefault();
				}
			});
		}
	}

	private _onScrub(): void {
		if (!this._scrubber) {
			return;
		}
		this._renderDetail(Number(this._scrubber.value));
	}

	private _selectEpisode(index: number): void {
		if (this._scrubber) {
			this._scrubber.value = String(index);
		}
		this._renderDetail(index);
	}

	private _renderDetail(index: number): void {
		if (!this._detailEl) {
			return;
		}
		clearNode(this._detailEl);
		const episode = this._episodes[index];
		if (!episode) {
			return;
		}
		append(this._detailEl, $('.zonecog-timeline-detail-title')).textContent = episode.title;
		append(this._detailEl, $('.zonecog-timeline-detail-body')).textContent =
			episode.content.length > 240 ? `${episode.content.slice(0, 240)}…` : episode.content;

		// Highlight the episode's hypergraph nodes through the shared
		// selection bus so the explorer/heatmap re-highlight that moment.
		for (const nodeId of episode.relatedNodes) {
			if (this.hypergraphStore.getNode(nodeId)) {
				this.visualizationService.scheduleAnimation({ kind: 'trail', nodeId, durationMs: 1600, payload: { source: 'episodeTimeline', episodeId: episode.id } });
			}
		}
		if (episode.relatedNodes.length > 0) {
			this.visualizationService.focusNode(episode.relatedNodes[0], 'episodeTimeline');
		}
	}
}

/**
 * Provenance Chain Explorer View - lists recorded cognitive decisions and
 * renders the transitive EvidencedBy chain of the selected decision with a
 * step-through animation (each chain hop pulses in sequence in the shared
 * hypergraph views).
 */
export class ProvenanceChainExplorerView extends ViewPane {
	private _decisionList?: HTMLElement;
	private _chainEl?: HTMLElement;
	private _scheduler!: RunOnceScheduler;

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
		@ICognitiveProvenanceService private readonly provenanceService: ICognitiveProvenanceService,
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const section = append(container, $('.zonecog-view'));
		append(section, $('.zonecog-section-header')).textContent = localize('zonecog.provenanceExplorer', 'Provenance Chains');
		this._decisionList = append(section, $('.zonecog-wm-list'));
		this._chainEl = append(section, $('.zonecog-provenance-chain'));

		this._scheduler = this._register(new RunOnceScheduler(() => this._renderDecisions(), LIST_REFRESH_MS));
		this._register(this.provenanceService.onDidRecordDecision(() => this._scheduler.schedule()));
		this._renderDecisions();
	}

	private _renderDecisions(): void {
		if (!this._decisionList) {
			return;
		}
		clearNode(this._decisionList);
		const decisions = this.provenanceService.getAuditTrail({ limit: MAX_PROVENANCE_DECISIONS });
		if (decisions.length === 0) {
			append(this._decisionList, $('.zonecog-thinking-idle')).textContent =
				localize('zonecog.noDecisions', 'No cognitive decisions recorded yet.');
			return;
		}
		for (const decision of decisions) {
			const item = append(this._decisionList, $('.zonecog-wm-item'));
			append(item, $('.zonecog-wm-category')).textContent = decision.decisionType;
			const content = append(item, $('.zonecog-wm-content'));
			content.textContent = decision.summary;
			content.title = decision.summary;
			append(item, $('.zonecog-wm-relevance')).textContent = `${Math.round(decision.confidence * 100)}%`;
			item.tabIndex = 0;
			item.addEventListener('click', () => this._selectDecision(decision));
			item.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					this._selectDecision(decision);
					e.preventDefault();
				}
			});
		}
	}

	private _selectDecision(decision: CognitiveDecision): void {
		if (!this._chainEl) {
			return;
		}
		clearNode(this._chainEl);
		const chain = this.provenanceService.getProvenanceChain(decision.id).slice(0, MAX_CHAIN_ENTRIES);
		const header = append(this._chainEl, $('.zonecog-section-header'));
		header.textContent = localize('zonecog.chainHeader', 'Evidence chain ({0} hops)', chain.length);

		if (chain.length === 0) {
			append(this._chainEl, $('.zonecog-thinking-idle')).textContent = localize('zonecog.noChain', 'No recorded evidence for this decision.');
		}
		for (const entry of chain) {
			const hop = append(this._chainEl, $('.zonecog-provenance-hop'));
			hop.style.marginLeft = `${Math.min(80, (entry.depth - 1) * 16)}px`;
			append(hop, $('.zonecog-provenance-hop-type')).textContent = entry.nodeType;
			const body = append(hop, $('.zonecog-provenance-hop-body'));
			body.textContent = entry.content.length > 120 ? `${entry.content.slice(0, 120)}…` : entry.content;
			body.title = entry.content;
		}

		// Step-through animation: each hop trails in sequence, shallowest first.
		chain.sort((a, b) => a.depth - b.depth).forEach((entry, i) => {
			this.visualizationService.scheduleAnimation({
				kind: 'trail',
				nodeId: entry.nodeId,
				durationMs: 900 + i * 250,
				payload: { source: 'provenance', depth: entry.depth, decisionId: decision.id }
			});
		});
		this.visualizationService.focusNode(decision.id, 'provenanceExplorer');
	}
}

/**
 * PLN Inference Visualizer View - the forward-chaining derivation stream:
 * each inferred link renders as a materializing edge card with its truth
 * value (strength/confidence) and rule badge; new derivations simultaneously
 * send a flow packet along the derived edge in the shared hypergraph views.
 */
export class PLNInferenceVisualizerView extends ViewPane {
	private _listEl?: HTMLElement;
	private _scheduler!: RunOnceScheduler;

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
		@IPLNReasoningService private readonly plnService: IPLNReasoningService,
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const section = append(container, $('.zonecog-view'));
		append(section, $('.zonecog-section-header')).textContent = localize('zonecog.inferenceStream', 'PLN Inference Stream');
		this._listEl = append(section, $('.zonecog-wm-list'));

		this._scheduler = this._register(new RunOnceScheduler(() => this._render(), LIST_REFRESH_MS));
		this._register(this.plnService.onDidInferLink(link => this._onInferred(link)));
		this._render();
	}

	private _onInferred(link: InferredLink): void {
		// Animate the materializing deduction edge in the shared views.
		this.visualizationService.scheduleAnimation({
			kind: 'flow',
			sourceId: link.from,
			targetId: link.to,
			durationMs: 1100,
			payload: { rule: link.rule, strength: link.truthValue.strength, confidence: link.truthValue.confidence }
		});
		this._scheduler.schedule();
	}

	private _render(): void {
		if (!this._listEl) {
			return;
		}
		clearNode(this._listEl);
		const inferred = this.plnService.getInferredLinks().slice(-40).reverse();
		if (inferred.length === 0) {
			append(this._listEl, $('.zonecog-thinking-idle')).textContent =
				localize('zonecog.noInferences', 'No inferences yet - run "Zone-Cog: Run PLN Inference" to derive new links.');
			return;
		}
		for (const link of inferred) {
			const item = append(this._listEl, $('.zonecog-wm-item'));
			append(item, $('.zonecog-wm-category')).textContent = link.rule;
			const content = append(item, $('.zonecog-wm-content'));
			content.textContent = `${link.from} → ${link.to}`;
			content.title = localize('zonecog.inferencePremises', 'Premises: {0}', link.premises.join(', '));
			append(item, $('.zonecog-wm-relevance')).textContent =
				localize('zonecog.truthValue', 's={0} c={1}', link.truthValue.strength.toFixed(2), link.truthValue.confidence.toFixed(2));
			item.tabIndex = 0;
			item.addEventListener('click', () => {
				this.visualizationService.focusNode(link.from, 'plnVisualizer');
			});
		}
	}
}
