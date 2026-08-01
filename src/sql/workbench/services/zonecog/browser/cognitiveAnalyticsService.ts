/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveAnalyticsService,
	CognitiveAnalyticsSnapshot,
	LatencyHistogram,
	ThinkingPhaseStat,
	ECANEfficiencyMetrics,
	WorkingMemoryUtilization,
	LLMTokenEconomics,
	DTESNConvergenceMetrics
} from 'sql/workbench/services/zonecog/common/cognitiveAnalytics';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Latency histogram bucket upper bounds in ms. The final implicit bucket
 * captures everything above the last bound.
 */
const LATENCY_BUCKET_BOUNDS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Maximum retained DTESN MSE history entries.
 */
const MAX_MSE_HISTORY = 50;

/**
 * Counter for deterministic analytics node IDs.
 */
let analyticsIdCounter = 0;

function analyticsId(prefix: string): string {
	return `${prefix}-${Date.now()}-${++analyticsIdCounter}`;
}

/**
 * Cognitive Analytics & Telemetry Service (Phase 6.3).
 *
 * Passively subscribes to the cognitive subsystems' event streams and
 * aggregates the performance metrics laid out in the ZoneCog plan:
 * query latency histograms, thinking phase durations, ECAN efficiency,
 * working memory utilization, LLM token economics, and DTESN training
 * convergence.
 */
export class CognitiveAnalyticsService extends Disposable implements ICognitiveAnalyticsService {

	declare readonly _serviceBrand: undefined;

	// -- Query latency histogram ----------------------------------------------
	private readonly _latencyBucketCounts: number[] = new Array(LATENCY_BUCKET_BOUNDS_MS.length + 1).fill(0);
	private _latencyCount = 0;
	private _latencyTotalMs = 0;
	private _latencyMinMs = 0;
	private _latencyMaxMs = 0;

	// -- Thinking phase stats ---------------------------------------------------
	private readonly _phaseStats = new Map<string, { count: number; totalMs: number; maxMs: number }>();

	// -- ECAN efficiency ---------------------------------------------------------
	private _ecanSamples = 0;
	private _ecanFocusRatioTotal = 0;
	private _ecanLatestFocusRatio = 0;
	private _ecanTotalRentCollected = 0;
	private _ecanSpreadingCycles = 0;

	// -- Working memory utilization -----------------------------------------------
	private _wmSamples = 0;
	private _wmUtilizationTotal = 0;
	private _wmLatestUtilization = 0;
	private _wmPeakUtilization = 0;
	private _wmEpisodeCount = 0;

	// -- LLM token economics --------------------------------------------------------
	private _llmRequestCount = 0;
	private _llmFallbackCount = 0;
	private _llmStreamedCount = 0;
	private _llmPromptTokens = 0;
	private _llmCompletionTokens = 0;
	private _llmTotalTokens = 0;
	private _llmLatencyTotalMs = 0;
	private readonly _llmRequestsByProvider = new Map<string, number>();

	// -- DTESN convergence --------------------------------------------------------
	private _dtesnTrainingRuns = 0;
	private _dtesnLatestMse = 0;
	private _dtesnBestMse = 0;
	private _dtesnFirstMse = 0;
	private readonly _dtesnMseHistory: number[] = [];

	private readonly _onDidUpdateMetrics = this._register(new Emitter<CognitiveAnalyticsSnapshot>());
	readonly onDidUpdateMetrics: Event<CognitiveAnalyticsSnapshot> = this._onDidUpdateMetrics.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IZoneCogService private readonly zonecogService: IZoneCogService,
		@ILLMProviderService private readonly llmProviderService: ILLMProviderService,
		@IECANAttentionService private readonly ecanService: IECANAttentionService,
		@ICognitiveWorkspaceService private readonly workspaceService: ICognitiveWorkspaceService,
		@IDTESNService private readonly dtesnService: IDTESNService
	) {
		super();

		// Query latency + thinking phase durations, plus per-query sampling
		// of ECAN efficiency and working memory utilization.
		this._register(this.zonecogService.onDidProcessQuery(response => {
			this._recordQueryLatency(response.metadata.processingTime);
			for (const phase of response.phases) {
				this._recordPhaseDuration(phase.name, phase.durationMs);
			}
			this._sampleECAN();
			this._sampleWorkingMemory();
			this._fireUpdate();
		}));

		// LLM token economics
		this._register(this.llmProviderService.onDidCompleteRequest(telemetry => {
			this._llmRequestCount++;
			if (telemetry.isFallback) {
				this._llmFallbackCount++;
			}
			if (telemetry.streamed) {
				this._llmStreamedCount++;
			}
			this._llmPromptTokens += telemetry.promptTokens;
			this._llmCompletionTokens += telemetry.completionTokens;
			this._llmTotalTokens += telemetry.totalTokens;
			this._llmLatencyTotalMs += telemetry.latencyMs;
			this._llmRequestsByProvider.set(
				telemetry.providerId,
				(this._llmRequestsByProvider.get(telemetry.providerId) ?? 0) + 1
			);
			this._fireUpdate();
		}));

		// DTESN training convergence
		this._register(this.dtesnService.onDidLearn(result => {
			this._dtesnTrainingRuns++;
			this._dtesnLatestMse = result.mse;
			if (this._dtesnTrainingRuns === 1) {
				this._dtesnFirstMse = result.mse;
				this._dtesnBestMse = result.mse;
			} else {
				this._dtesnBestMse = Math.min(this._dtesnBestMse, result.mse);
			}
			this._dtesnMseHistory.push(result.mse);
			if (this._dtesnMseHistory.length > MAX_MSE_HISTORY) {
				this._dtesnMseHistory.shift();
			}
			this._fireUpdate();
		}));

		this.logService.info('CognitiveAnalyticsService: initialized cognitive telemetry collection');
	}

	// -- Metric accessors -------------------------------------------------------

	getQueryLatencyHistogram(): LatencyHistogram {
		const buckets = LATENCY_BUCKET_BOUNDS_MS.map((bound, i) => ({
			upperBoundMs: bound,
			count: this._latencyBucketCounts[i],
		}));
		buckets.push({
			upperBoundMs: Infinity,
			count: this._latencyBucketCounts[LATENCY_BUCKET_BOUNDS_MS.length],
		});

		return {
			buckets,
			totalCount: this._latencyCount,
			minMs: this._latencyMinMs,
			maxMs: this._latencyMaxMs,
			meanMs: this._latencyCount > 0 ? this._latencyTotalMs / this._latencyCount : 0,
		};
	}

	getThinkingPhaseStats(): ThinkingPhaseStat[] {
		const stats: ThinkingPhaseStat[] = [];
		for (const [name, s] of this._phaseStats) {
			stats.push({
				name,
				count: s.count,
				totalMs: s.totalMs,
				meanMs: s.count > 0 ? s.totalMs / s.count : 0,
				maxMs: s.maxMs,
			});
		}
		stats.sort((a, b) => b.totalMs - a.totalMs);
		return stats;
	}

	getECANEfficiency(): ECANEfficiencyMetrics {
		return {
			samples: this._ecanSamples,
			meanFocusRatio: this._ecanSamples > 0 ? this._ecanFocusRatioTotal / this._ecanSamples : 0,
			latestFocusRatio: this._ecanLatestFocusRatio,
			totalRentCollected: this._ecanTotalRentCollected,
			spreadingCycles: this._ecanSpreadingCycles,
		};
	}

	getWorkingMemoryUtilization(): WorkingMemoryUtilization {
		return {
			samples: this._wmSamples,
			meanUtilization: this._wmSamples > 0 ? this._wmUtilizationTotal / this._wmSamples : 0,
			latestUtilization: this._wmLatestUtilization,
			peakUtilization: this._wmPeakUtilization,
			episodeCount: this._wmEpisodeCount,
		};
	}

	getTokenEconomics(): LLMTokenEconomics {
		const requestsByProvider: Record<string, number> = {};
		for (const [providerId, count] of this._llmRequestsByProvider) {
			requestsByProvider[providerId] = count;
		}

		return {
			requestCount: this._llmRequestCount,
			fallbackCount: this._llmFallbackCount,
			streamedCount: this._llmStreamedCount,
			totalPromptTokens: this._llmPromptTokens,
			totalCompletionTokens: this._llmCompletionTokens,
			totalTokens: this._llmTotalTokens,
			meanLatencyMs: this._llmRequestCount > 0 ? this._llmLatencyTotalMs / this._llmRequestCount : 0,
			requestsByProvider,
		};
	}

	getDTESNConvergence(): DTESNConvergenceMetrics {
		return {
			trainingRuns: this._dtesnTrainingRuns,
			latestMse: this._dtesnLatestMse,
			bestMse: this._dtesnBestMse,
			firstMse: this._dtesnFirstMse,
			converging: this._dtesnTrainingRuns > 1 && this._dtesnLatestMse < this._dtesnFirstMse,
			mseHistory: [...this._dtesnMseHistory],
		};
	}

	getSnapshot(): CognitiveAnalyticsSnapshot {
		return {
			queryLatency: this.getQueryLatencyHistogram(),
			thinkingPhases: this.getThinkingPhaseStats(),
			ecanEfficiency: this.getECANEfficiency(),
			workingMemory: this.getWorkingMemoryUtilization(),
			tokenEconomics: this.getTokenEconomics(),
			dtesnConvergence: this.getDTESNConvergence(),
			timestamp: Date.now(),
		};
	}

	// -- Reporting ---------------------------------------------------------------

	generateReport(): string {
		this.membraneService.recordActivity('autonomic');

		const snapshot = this.getSnapshot();
		const lines: string[] = [];

		lines.push('=== Zone-Cog Cognitive Analytics Report ===');
		lines.push('');

		// Query latency
		const lat = snapshot.queryLatency;
		lines.push(`Query Processing (${lat.totalCount} queries):`);
		lines.push(`  min=${lat.minMs}ms mean=${lat.meanMs.toFixed(1)}ms max=${lat.maxMs}ms`);
		for (const bucket of lat.buckets) {
			if (bucket.count > 0) {
				const label = bucket.upperBoundMs === Infinity ? `>${LATENCY_BUCKET_BOUNDS_MS[LATENCY_BUCKET_BOUNDS_MS.length - 1]}ms` : `<=${bucket.upperBoundMs}ms`;
				lines.push(`  ${label}: ${bucket.count}`);
			}
		}
		lines.push('');

		// Thinking phases
		lines.push(`Thinking Phases (${snapshot.thinkingPhases.length} distinct):`);
		for (const phase of snapshot.thinkingPhases) {
			lines.push(`  ${phase.name}: count=${phase.count} mean=${phase.meanMs.toFixed(1)}ms max=${phase.maxMs}ms`);
		}
		lines.push('');

		// ECAN efficiency
		const ecan = snapshot.ecanEfficiency;
		lines.push('ECAN Attention Efficiency:');
		lines.push(`  samples=${ecan.samples} meanFocusRatio=${(ecan.meanFocusRatio * 100).toFixed(1)}% latestFocusRatio=${(ecan.latestFocusRatio * 100).toFixed(1)}%`);
		lines.push(`  totalRent=${ecan.totalRentCollected.toFixed(4)} spreadingCycles=${ecan.spreadingCycles}`);
		lines.push('');

		// Working memory
		const wm = snapshot.workingMemory;
		lines.push('Working Memory Utilization:');
		lines.push(`  samples=${wm.samples} mean=${(wm.meanUtilization * 100).toFixed(1)}% latest=${(wm.latestUtilization * 100).toFixed(1)}% peak=${(wm.peakUtilization * 100).toFixed(1)}%`);
		lines.push(`  episodes=${wm.episodeCount}`);
		lines.push('');

		// LLM token economics
		const tok = snapshot.tokenEconomics;
		lines.push('LLM Token Economics:');
		lines.push(`  requests=${tok.requestCount} fallback=${tok.fallbackCount} streamed=${tok.streamedCount}`);
		lines.push(`  promptTokens=${tok.totalPromptTokens} completionTokens=${tok.totalCompletionTokens} totalTokens=${tok.totalTokens}`);
		lines.push(`  meanLatency=${tok.meanLatencyMs.toFixed(1)}ms`);
		for (const [providerId, count] of Object.entries(tok.requestsByProvider)) {
			lines.push(`  provider ${providerId}: ${count} requests`);
		}
		lines.push('');

		// DTESN convergence
		const dtesn = snapshot.dtesnConvergence;
		lines.push('DTESN Training Convergence:');
		lines.push(`  runs=${dtesn.trainingRuns} latestMSE=${dtesn.latestMse.toFixed(6)} bestMSE=${dtesn.bestMse.toFixed(6)} converging=${dtesn.converging}`);

		const report = lines.join('\n');

		// Persist the report into the hypergraph for longitudinal analysis
		this.hypergraphStore.addNode({
			id: analyticsId('analytics-report'),
			node_type: 'AnalyticsReport',
			content: report,
			links: [],
			metadata: {
				queryCount: lat.totalCount,
				llmRequestCount: tok.requestCount,
				dtesnTrainingRuns: dtesn.trainingRuns,
				timestamp: snapshot.timestamp,
			},
			salience_score: 0.4,
		});

		return report;
	}

	reset(): void {
		this._latencyBucketCounts.fill(0);
		this._latencyCount = 0;
		this._latencyTotalMs = 0;
		this._latencyMinMs = 0;
		this._latencyMaxMs = 0;
		this._phaseStats.clear();
		this._ecanSamples = 0;
		this._ecanFocusRatioTotal = 0;
		this._ecanLatestFocusRatio = 0;
		this._ecanTotalRentCollected = 0;
		this._ecanSpreadingCycles = 0;
		this._wmSamples = 0;
		this._wmUtilizationTotal = 0;
		this._wmLatestUtilization = 0;
		this._wmPeakUtilization = 0;
		this._wmEpisodeCount = 0;
		this._llmRequestCount = 0;
		this._llmFallbackCount = 0;
		this._llmStreamedCount = 0;
		this._llmPromptTokens = 0;
		this._llmCompletionTokens = 0;
		this._llmTotalTokens = 0;
		this._llmLatencyTotalMs = 0;
		this._llmRequestsByProvider.clear();
		this._dtesnTrainingRuns = 0;
		this._dtesnLatestMse = 0;
		this._dtesnBestMse = 0;
		this._dtesnFirstMse = 0;
		this._dtesnMseHistory.length = 0;
		this.membraneService.recordActivity('autonomic');
		this._fireUpdate();
		this.logService.info('CognitiveAnalyticsService: metrics reset');
	}

	// -- Private recorders --------------------------------------------------------

	private _recordQueryLatency(latencyMs: number): void {
		const clamped = Math.max(0, latencyMs);
		let bucketIndex = LATENCY_BUCKET_BOUNDS_MS.findIndex(bound => clamped <= bound);
		if (bucketIndex === -1) {
			bucketIndex = LATENCY_BUCKET_BOUNDS_MS.length;
		}
		this._latencyBucketCounts[bucketIndex]++;

		if (this._latencyCount === 0) {
			this._latencyMinMs = clamped;
			this._latencyMaxMs = clamped;
		} else {
			this._latencyMinMs = Math.min(this._latencyMinMs, clamped);
			this._latencyMaxMs = Math.max(this._latencyMaxMs, clamped);
		}
		this._latencyCount++;
		this._latencyTotalMs += clamped;
	}

	private _recordPhaseDuration(name: string, durationMs: number): void {
		let stat = this._phaseStats.get(name);
		if (!stat) {
			stat = { count: 0, totalMs: 0, maxMs: 0 };
			this._phaseStats.set(name, stat);
		}
		stat.count++;
		stat.totalMs += Math.max(0, durationMs);
		stat.maxMs = Math.max(stat.maxMs, durationMs);
	}

	private _sampleECAN(): void {
		const snapshot = this.ecanService.getSnapshot();
		const focusRatio = snapshot.totalTrackedNodes > 0
			? snapshot.nodesInFocus / snapshot.totalTrackedNodes
			: 0;
		this._ecanSamples++;
		this._ecanFocusRatioTotal += focusRatio;
		this._ecanLatestFocusRatio = focusRatio;
		this._ecanTotalRentCollected += snapshot.rentCollected;
		this._ecanSpreadingCycles = snapshot.spreadingCycles;
	}

	private _sampleWorkingMemory(): void {
		const summary = this.workspaceService.getSummary();
		const utilization = summary.workingMemoryCapacity > 0
			? summary.workingMemorySize / summary.workingMemoryCapacity
			: 0;
		this._wmSamples++;
		this._wmUtilizationTotal += utilization;
		this._wmLatestUtilization = utilization;
		this._wmPeakUtilization = Math.max(this._wmPeakUtilization, utilization);
		this._wmEpisodeCount = summary.episodeCount;
	}

	private _fireUpdate(): void {
		this._onDidUpdateMetrics.fire(this.getSnapshot());
	}
}
