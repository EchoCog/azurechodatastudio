/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const ICognitiveAnalyticsService = createDecorator<ICognitiveAnalyticsService>('cognitiveAnalyticsService');

// ---------------------------------------------------------------------------
// Metric types
// ---------------------------------------------------------------------------

/**
 * A single bucket in a latency histogram.
 */
export interface LatencyHistogramBucket {
	/** Inclusive upper bound of the bucket in ms (Infinity for the last bucket). */
	upperBoundMs: number;
	/** Number of observations that fell into this bucket. */
	count: number;
}

/**
 * Histogram of observed latencies.
 */
export interface LatencyHistogram {
	/** Ordered histogram buckets. */
	buckets: LatencyHistogramBucket[];
	/** Total number of observations. */
	totalCount: number;
	/** Minimum observed latency in ms (0 when no observations). */
	minMs: number;
	/** Maximum observed latency in ms (0 when no observations). */
	maxMs: number;
	/** Mean observed latency in ms (0 when no observations). */
	meanMs: number;
}

/**
 * Aggregated duration statistics for a single thinking phase.
 */
export interface ThinkingPhaseStat {
	/** Phase name (e.g. "Initial Engagement"). */
	name: string;
	/** Number of times this phase executed. */
	count: number;
	/** Total duration across all executions in ms. */
	totalMs: number;
	/** Mean duration in ms. */
	meanMs: number;
	/** Maximum single-execution duration in ms. */
	maxMs: number;
}

/**
 * ECAN attention allocation efficiency metrics.
 */
export interface ECANEfficiencyMetrics {
	/** Number of ECAN snapshots sampled. */
	samples: number;
	/** Mean fraction of tracked nodes inside the attentional focus [0, 1]. */
	meanFocusRatio: number;
	/** Latest observed focus ratio [0, 1]. */
	latestFocusRatio: number;
	/** Total rent collected across sampled cycles. */
	totalRentCollected: number;
	/** Total spreading cycles observed at the latest sample. */
	spreadingCycles: number;
}

/**
 * Working memory utilization metrics.
 */
export interface WorkingMemoryUtilization {
	/** Number of workspace samples taken. */
	samples: number;
	/** Mean working memory fill ratio [0, 1]. */
	meanUtilization: number;
	/** Latest working memory fill ratio [0, 1]. */
	latestUtilization: number;
	/** Peak working memory fill ratio observed [0, 1]. */
	peakUtilization: number;
	/** Total episodes recorded at the latest sample. */
	episodeCount: number;
}

/**
 * LLM token economics aggregated across all completed requests.
 */
export interface LLMTokenEconomics {
	/** Total completed requests observed. */
	requestCount: number;
	/** Requests served by the built-in fallback. */
	fallbackCount: number;
	/** Requests served via the streaming path. */
	streamedCount: number;
	/** Total prompt tokens consumed. */
	totalPromptTokens: number;
	/** Total completion tokens produced. */
	totalCompletionTokens: number;
	/** Total tokens across all requests. */
	totalTokens: number;
	/** Mean request latency in ms (0 when no requests). */
	meanLatencyMs: number;
	/** Per-provider request counts. */
	requestsByProvider: Record<string, number>;
}

/**
 * DTESN readout training convergence metrics.
 */
export interface DTESNConvergenceMetrics {
	/** Number of training runs observed. */
	trainingRuns: number;
	/** MSE of the most recent training run (0 when none). */
	latestMse: number;
	/** Lowest MSE observed across training runs (0 when none). */
	bestMse: number;
	/** MSE of the first observed training run (0 when none). */
	firstMse: number;
	/** Whether MSE is trending downward (latest < first). */
	converging: boolean;
	/** Recent MSE history (most recent last, bounded window). */
	mseHistory: number[];
}

/**
 * A complete point-in-time snapshot of all cognitive analytics metrics.
 */
export interface CognitiveAnalyticsSnapshot {
	/** Query processing latency histogram. */
	queryLatency: LatencyHistogram;
	/** Per-phase thinking duration statistics. */
	thinkingPhases: ThinkingPhaseStat[];
	/** ECAN attention efficiency metrics. */
	ecanEfficiency: ECANEfficiencyMetrics;
	/** Working memory utilization metrics. */
	workingMemory: WorkingMemoryUtilization;
	/** LLM token economics. */
	tokenEconomics: LLMTokenEconomics;
	/** DTESN training convergence metrics. */
	dtesnConvergence: DTESNConvergenceMetrics;
	/** Timestamp of the snapshot. */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Cognitive Analytics & Telemetry Service (Phase 6.3).
 *
 * Passively observes the cognitive subsystems and aggregates performance
 * metrics for measuring and optimizing cognitive performance:
 *
 * - Query processing latency histograms (via `IZoneCogService.onDidProcessQuery`)
 * - Thinking phase duration statistics
 * - ECAN attention allocation efficiency (sampled per processed query)
 * - Working memory utilization (sampled per processed query)
 * - LLM token economics (via `ILLMProviderService.onDidCompleteRequest`)
 * - DTESN readout training convergence (via `IDTESNService.onDidLearn`)
 *
 * A human-readable report can be generated on demand; each generated report
 * is also persisted as a hypergraph node for longitudinal analysis.
 */
export interface ICognitiveAnalyticsService {
	readonly _serviceBrand: undefined;

	/** Fired whenever any metric is updated with a fresh snapshot. */
	readonly onDidUpdateMetrics: Event<CognitiveAnalyticsSnapshot>;

	/**
	 * Get a point-in-time snapshot of all metrics.
	 */
	getSnapshot(): CognitiveAnalyticsSnapshot;

	/**
	 * Get the query processing latency histogram.
	 */
	getQueryLatencyHistogram(): LatencyHistogram;

	/**
	 * Get per-phase thinking duration statistics, sorted by total time descending.
	 */
	getThinkingPhaseStats(): ThinkingPhaseStat[];

	/**
	 * Get ECAN attention allocation efficiency metrics.
	 */
	getECANEfficiency(): ECANEfficiencyMetrics;

	/**
	 * Get working memory utilization metrics.
	 */
	getWorkingMemoryUtilization(): WorkingMemoryUtilization;

	/**
	 * Get LLM token economics metrics.
	 */
	getTokenEconomics(): LLMTokenEconomics;

	/**
	 * Get DTESN training convergence metrics.
	 */
	getDTESNConvergence(): DTESNConvergenceMetrics;

	/**
	 * Generate a human-readable analytics report. The report is also
	 * persisted as a hypergraph node (node_type "AnalyticsReport").
	 */
	generateReport(): string;

	/**
	 * Reset all collected metrics.
	 */
	reset(): void;
}
