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

import { IZoneCogService, ThinkingPhase, ZoneCogResponse } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ICognitiveTraceService } from 'sql/workbench/services/zonecog/common/cognitiveTrace';

/** Maximum completed queries retained in the recent list. */
const MAX_RECENT_QUERIES = 5;

/** Maximum characters of phase content shown per phase card. */
const MAX_PHASE_CONTENT_CHARS = 200;

interface CompletedQuerySummary {
	confidence: number;
	complexity: string;
	depth: string;
	processingTimeMs: number;
	phaseCount: number;
	responsePreview: string;
}

/**
 * Thinking Process View - real-time display of the Zone-Cog thinking
 * protocol. Streams each completed thinking phase and response token as it
 * happens, and keeps a short history of recently completed queries.
 */
export class ThinkingProcessView extends ViewPane {
	private _container?: HTMLElement;
	private _liveSection?: HTMLElement;
	private _livePhaseList?: HTMLElement;
	private _liveResponse?: HTMLElement;
	private _recentSection?: HTMLElement;
	private _recentList?: HTMLElement;

	private _currentPhases: ThinkingPhase[] = [];
	private _currentResponseText = '';
	private readonly _recentQueries: CompletedQuerySummary[] = [];

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

		this._container = append(container, $('.zonecog-view'));

		this._liveSection = append(this._container, $('.zonecog-section'));
		append(this._liveSection, $('.zonecog-section-header')).textContent = localize('zonecog.liveThinking', 'Live Thinking');
		this._livePhaseList = append(this._liveSection, $('.zonecog-thinking-phases'));
		this._liveResponse = append(this._liveSection, $('.zonecog-thinking-response'));

		this._recentSection = append(this._container, $('.zonecog-section'));
		append(this._recentSection, $('.zonecog-section-header')).textContent = localize('zonecog.recentQueries', 'Recent Queries');
		this._recentList = append(this._recentSection, $('.zonecog-thinking-recent'));

		this._register(this.zonecogService.onDidCompleteThinkingPhase(phase => this._onPhase(phase)));
		this._register(this.zonecogService.onDidStreamResponseToken(e => this._onToken(e.token)));
		this._register(this.zonecogService.onDidProcessQuery(response => this._onQueryComplete(response)));
		// Replayed traces render through the same live pipeline, so another
		// session's reasoning appears exactly as it originally unfolded.
		this._register(this.traceService.onDidReplayPhase(e => this._onPhase(e.phase)));
		this._register(this.traceService.onDidCompleteReplay(query => {
			this._currentPhases = [];
			this._onToken(query.response);
			this._currentResponseText = '';
		}));

		this._renderIdle();
		this._renderRecent();
	}

	private _renderIdle(): void {
		if (!this._livePhaseList) {
			return;
		}
		clearNode(this._livePhaseList);
		append(this._livePhaseList, $('.zonecog-thinking-idle')).textContent =
			localize('zonecog.thinkingIdle', 'Idle - run a cognitive query to watch the thinking protocol live.');
	}

	private _onPhase(phase: ThinkingPhase): void {
		if (!this._livePhaseList) {
			return;
		}
		if (this._currentPhases.length === 0) {
			// First phase of a new query: clear the idle placeholder / previous run.
			clearNode(this._livePhaseList);
			this._currentResponseText = '';
			if (this._liveResponse) {
				clearNode(this._liveResponse);
			}
		}
		this._currentPhases.push(phase);

		const card = append(this._livePhaseList, $('.zonecog-thinking-phase'));
		const header = append(card, $('.zonecog-thinking-phase-header'));
		append(header, $('.zonecog-thinking-phase-name')).textContent = `${this._currentPhases.length}. ${phase.name}`;
		append(header, $('.zonecog-thinking-phase-duration')).textContent = localize('zonecog.phaseDuration', '{0}ms', phase.durationMs);
		const content = phase.content.length > MAX_PHASE_CONTENT_CHARS
			? `${phase.content.slice(0, MAX_PHASE_CONTENT_CHARS)}…`
			: phase.content;
		append(card, $('.zonecog-thinking-phase-content')).textContent = content;
	}

	private _onToken(token: string): void {
		if (!this._liveResponse) {
			return;
		}
		if (this._currentResponseText.length === 0) {
			clearNode(this._liveResponse);
			append(this._liveResponse, $('.zonecog-thinking-response-label')).textContent = localize('zonecog.streamingResponse', 'Response');
			append(this._liveResponse, $('.zonecog-thinking-response-text'));
		}
		this._currentResponseText += token;
		const textEl = this._liveResponse.querySelector('.zonecog-thinking-response-text');
		if (textEl) {
			textEl.textContent = this._currentResponseText;
		}
	}

	private _onQueryComplete(response: ZoneCogResponse): void {
		this._recentQueries.unshift({
			confidence: response.confidence,
			complexity: response.metadata.queryComplexity,
			depth: response.metadata.thinkingDepth,
			processingTimeMs: response.metadata.processingTime,
			phaseCount: response.phases.length,
			responsePreview: response.response.length > 80 ? `${response.response.slice(0, 80)}…` : response.response
		});
		while (this._recentQueries.length > MAX_RECENT_QUERIES) {
			this._recentQueries.pop();
		}

		// Reset the live accumulator so the next query starts a fresh run;
		// keep the finished phases on screen until it does.
		this._currentPhases = [];
		this._renderRecent();
	}

	private _renderRecent(): void {
		if (!this._recentList) {
			return;
		}
		clearNode(this._recentList);
		if (this._recentQueries.length === 0) {
			append(this._recentList, $('.zonecog-thinking-idle')).textContent =
				localize('zonecog.noRecentQueries', 'No queries processed yet this session.');
			return;
		}
		for (const entry of this._recentQueries) {
			const item = append(this._recentList, $('.zonecog-thinking-recent-item'));
			const meta = append(item, $('.zonecog-thinking-recent-meta'));
			meta.textContent = localize('zonecog.recentQueryMeta', '{0} / {1} · {2} phases · {3}ms · confidence {4}%',
				entry.complexity, entry.depth, entry.phaseCount, entry.processingTimeMs, Math.round(entry.confidence * 100));
			append(item, $('.zonecog-thinking-recent-preview')).textContent = entry.responsePreview;
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
