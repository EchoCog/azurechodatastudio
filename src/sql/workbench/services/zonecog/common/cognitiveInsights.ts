/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const ICognitiveInsightsService = createDecorator<ICognitiveInsightsService>('cognitiveInsightsService');

// ---------------------------------------------------------------------------
// Insight types
// ---------------------------------------------------------------------------

export type InsightSeverity = 'info' | 'suggestion' | 'warning';

export type InsightSource = 'query-observation' | 'schema-perception' | 'cognitive-processing';

/**
 * An automatically generated insight, persisted as an `Insight` hypergraph node.
 */
export interface CognitiveInsight {
	/** Stable hypergraph node id of this insight. */
	id: string;
	severity: InsightSeverity;
	source: InsightSource;
	/** Short human-readable insight text. */
	message: string;
	/** Optional subject the insight is about (table name, query fragment, ...). */
	subject?: string;
	/** Epoch milliseconds when the insight was generated. */
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Auto-generated insights service.
 *
 * Closes the "Auto-generated insights from data patterns" roadmap item
 * (Phase 4.3): observes query executions and schema perceptions as they
 * happen, applies rule-based heuristics (SELECT *, unfiltered writes,
 * repeatedly queried tables, wide tables, heavy processing latency), and
 * surfaces the findings as bounded, deduplicated insights - each persisted
 * as an `Insight` hypergraph node so downstream reasoning can build on them.
 * The heuristics are deliberately LLM-free so insights work without any
 * provider configured.
 */
export interface ICognitiveInsightsService {
	readonly _serviceBrand: undefined;

	/** Fired each time a new insight is generated. */
	readonly onDidGenerateInsight: Event<CognitiveInsight>;

	/**
	 * Analyze an observed SQL query and generate any applicable insights.
	 * Called automatically for every `ISchemaPerceptionService.onDidObserveQuery`
	 * event; can also be invoked directly.
	 */
	analyzeQuery(queryText: string, executionTimeMs?: number): CognitiveInsight[];

	/** Recent insights, most recent first. */
	getRecentInsights(limit?: number): CognitiveInsight[];

	/** Total number of insights generated this session (including evicted). */
	getInsightCount(): number;

	/** Clear all retained insights and their hypergraph nodes. */
	clear(): void;
}
