/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveInsightsService,
	CognitiveInsight,
	InsightSeverity,
	InsightSource
} from 'sql/workbench/services/zonecog/common/cognitiveInsights';
import { ISchemaPerceptionService } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/** Maximum insights retained in the bounded history. */
const MAX_INSIGHTS = 200;

/** Node type used for persisted insights in the hypergraph store. */
const INSIGHT_NODE_TYPE = 'Insight';

/** Query latency above which a slow-query insight is generated. */
const SLOW_QUERY_MS = 5000;

/** Repeat count within a session after which a frequent-table insight fires. */
const FREQUENT_TABLE_THRESHOLD = 5;

/** Column count above which a perceived table is called out as wide. */
const WIDE_TABLE_COLUMNS = 40;

const INSIGHT_SALIENCE: Record<InsightSeverity, number> = {
	info: 0.4,
	suggestion: 0.55,
	warning: 0.7
};

/**
 * Implementation of the auto-generated insights service.
 *
 * Self-wires to `ISchemaPerceptionService.onDidObserveQuery` and
 * `onDidPerceiveSchema` so insights accumulate passively while the user
 * works. All heuristics are rule-based; no LLM is required.
 */
export class CognitiveInsightsService extends Disposable implements ICognitiveInsightsService {

	declare readonly _serviceBrand: undefined;

	private readonly _insights: CognitiveInsight[] = [];
	/** Dedup keys of insights already raised this session. */
	private readonly _raisedKeys = new Set<string>();
	private readonly _tableQueryCounts = new Map<string, number>();
	private _insightCounter = 0;
	private _totalGenerated = 0;

	private readonly _onDidGenerateInsight = this._register(new Emitter<CognitiveInsight>());
	readonly onDidGenerateInsight: Event<CognitiveInsight> = this._onDidGenerateInsight.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@ISchemaPerceptionService schemaPerceptionService: ISchemaPerceptionService
	) {
		super();
		this._register(schemaPerceptionService.onDidObserveQuery(e => {
			this.analyzeQuery(e.query.queryText, e.query.durationMs);
		}));
		this._register(schemaPerceptionService.onDidPerceiveSchema(e => {
			if (e.type === 'discovered' || e.type === 'updated') {
				this._analyzePerceivedSchema(e.elements.length, e.connectionUri, e.elements
					.filter(el => el.elementType === 'table')
					.map(el => ({ name: el.qualifiedName, columns: this._columnCount(e.elements, el.id) })));
			}
		}));
		this.logService.info('CognitiveInsightsService: initialized auto-generated insights');
	}

	// -- Query analysis ----------------------------------------------------------------

	analyzeQuery(queryText: string, executionTimeMs?: number): CognitiveInsight[] {
		this.membraneService.recordActivity('cerebral');
		const generated: CognitiveInsight[] = [];
		const normalized = queryText.replace(/\s+/g, ' ').trim();

		if (/\bSELECT\s+\*/i.test(normalized)) {
			this._raise(generated, 'suggestion', 'query-observation',
				'Query uses SELECT * - selecting only needed columns reduces I/O and makes results resilient to schema changes.',
				this._firstTable(normalized), `select-star|${this._firstTable(normalized) ?? normalized.slice(0, 60)}`);
		}

		if (/\b(UPDATE|DELETE)\b/i.test(normalized) && !/\bWHERE\b/i.test(normalized)) {
			this._raise(generated, 'warning', 'query-observation',
				'UPDATE/DELETE without a WHERE clause affects every row in the table.',
				this._firstTable(normalized), `unfiltered-write|${normalized.slice(0, 80)}`);
		}

		if (/\bLIKE\s+'%/i.test(normalized)) {
			this._raise(generated, 'suggestion', 'query-observation',
				'Leading-wildcard LIKE predicates cannot use indexes; consider full-text search for contains-style matching.',
				this._firstTable(normalized), `leading-wildcard|${normalized.slice(0, 80)}`);
		}

		if (executionTimeMs !== undefined && executionTimeMs >= SLOW_QUERY_MS) {
			this._raise(generated, 'warning', 'query-observation',
				`Query took ${Math.round(executionTimeMs)}ms - consider reviewing its plan or adding covering indexes.`,
				this._firstTable(normalized), `slow-query|${normalized.slice(0, 80)}`);
		}

		const table = this._firstTable(normalized);
		if (table) {
			const count = (this._tableQueryCounts.get(table) ?? 0) + 1;
			this._tableQueryCounts.set(table, count);
			if (count === FREQUENT_TABLE_THRESHOLD) {
				this._raise(generated, 'info', 'query-observation',
					`Table ${table} has been queried ${count} times this session - a hot spot worth keeping well-indexed.`,
					table, `frequent-table|${table}`);
			}
		}

		return generated;
	}

	// -- Queries ---------------------------------------------------------------------------

	getRecentInsights(limit?: number): CognitiveInsight[] {
		const recent = this._insights.slice().reverse();
		return limit !== undefined && limit >= 0 ? recent.slice(0, limit) : recent;
	}

	getInsightCount(): number {
		return this._totalGenerated;
	}

	clear(): void {
		for (const insight of this._insights) {
			this.hypergraphStore.removeNode(insight.id);
		}
		this._insights.length = 0;
		this._raisedKeys.clear();
		this._tableQueryCounts.clear();
		this.logService.info('CognitiveInsightsService: cleared all insights');
	}

	// -- Internals ---------------------------------------------------------------------------

	private _analyzePerceivedSchema(elementCount: number, connectionUri: string, tables: Array<{ name: string; columns: number }>): void {
		for (const table of tables) {
			if (table.columns >= WIDE_TABLE_COLUMNS) {
				const generated: CognitiveInsight[] = [];
				this._raise(generated, 'suggestion', 'schema-perception',
					`Table ${table.name} has ${table.columns} columns - wide tables often mix concerns and may benefit from vertical partitioning.`,
					table.name, `wide-table|${table.name}`);
			}
		}
	}

	private _columnCount(elements: Array<{ elementType: string; parentId: string | null }>, tableId: string): number {
		let count = 0;
		for (const el of elements) {
			if (el.elementType === 'column' && el.parentId === tableId) {
				count++;
			}
		}
		return count;
	}

	private _firstTable(sql: string): string | undefined {
		const match = /\b(?:FROM|INTO|UPDATE|JOIN)\s+([\w[\].]+)/i.exec(sql);
		return match ? match[1] : undefined;
	}

	private _raise(collector: CognitiveInsight[], severity: InsightSeverity, source: InsightSource, message: string, subject: string | undefined, dedupKey: string): void {
		if (this._raisedKeys.has(dedupKey)) {
			return;
		}
		this._raisedKeys.add(dedupKey);

		const insight: CognitiveInsight = {
			id: `insight-${Date.now()}-${++this._insightCounter}`,
			severity,
			source,
			message,
			subject,
			generatedAt: Date.now()
		};

		this.hypergraphStore.addNode({
			id: insight.id,
			node_type: INSIGHT_NODE_TYPE,
			content: message,
			links: [],
			metadata: { severity, source, subject, generatedAt: insight.generatedAt },
			salience_score: INSIGHT_SALIENCE[severity]
		});

		this._insights.push(insight);
		this._totalGenerated++;
		while (this._insights.length > MAX_INSIGHTS) {
			const evicted = this._insights.shift();
			if (evicted) {
				this.hypergraphStore.removeNode(evicted.id);
			}
		}

		collector.push(insight);
		this._onDidGenerateInsight.fire(insight);
	}
}
