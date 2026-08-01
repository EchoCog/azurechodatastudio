/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveTraceService,
	CognitiveTrace,
	TracedQuery,
	TRACE_FORMAT_VERSION
} from 'sql/workbench/services/zonecog/common/cognitiveTrace';
import { IZoneCogService, ThinkingPhase, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/** Maximum queries retained in the session trace. */
const MAX_TRACED_QUERIES = 100;

/**
 * Implementation of the cognitive trace service.
 *
 * Self-wires to `IZoneCogService.onDidProcessQuery` so every completed
 * cognitive query is recorded with its phase sequence. The query text is
 * correlated from `getQueryHistory()`, which the Zone-Cog service appends
 * to before firing the completion event.
 */
export class CognitiveTraceService extends Disposable implements ICognitiveTraceService {

	declare readonly _serviceBrand: undefined;

	private readonly _sessionTrace: TracedQuery[] = [];
	private _importedTrace: CognitiveTrace | undefined;

	private readonly _onDidReplayPhase = this._register(new Emitter<{ queryIndex: number; phase: ThinkingPhase }>());
	readonly onDidReplayPhase: Event<{ queryIndex: number; phase: ThinkingPhase }> = this._onDidReplayPhase.event;

	private readonly _onDidCompleteReplay = this._register(new Emitter<TracedQuery>());
	readonly onDidCompleteReplay: Event<TracedQuery> = this._onDidCompleteReplay.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IZoneCogService private readonly zonecogService: IZoneCogService
	) {
		super();
		this._register(this.zonecogService.onDidProcessQuery(response => {
			const history = this.zonecogService.getQueryHistory();
			const latest = history.length > 0 ? history[history.length - 1] : undefined;
			this._sessionTrace.push({
				query: latest ? latest.query : '',
				phases: response.phases.map(p => ({ ...p })),
				response: response.response,
				confidence: response.confidence,
				complexity: response.metadata.queryComplexity,
				depth: response.metadata.thinkingDepth,
				processingTimeMs: response.metadata.processingTime,
				completedAt: Date.now()
			});
			while (this._sessionTrace.length > MAX_TRACED_QUERIES) {
				this._sessionTrace.shift();
			}
		}));
		this.logService.info('CognitiveTraceService: initialized cognitive trace recording');
	}

	// -- Recording & export ----------------------------------------------------------

	getSessionTrace(): TracedQuery[] {
		return this._sessionTrace.map(q => ({ ...q, phases: q.phases.map(p => ({ ...p })) }));
	}

	exportTrace(label?: string): string {
		const trace: CognitiveTrace = {
			formatVersion: TRACE_FORMAT_VERSION,
			label: label ?? 'zonecog-session-trace',
			exportedAt: Date.now(),
			queries: this.getSessionTrace()
		};
		return JSON.stringify(trace, undefined, 2);
	}

	// -- Import & replay -------------------------------------------------------------

	importTrace(json: string): CognitiveTrace {
		this.membraneService.recordActivity('somatic');

		let parsed: unknown;
		try {
			parsed = JSON.parse(json);
		} catch (e) {
			throw new Error(`Cognitive trace is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
		}

		const trace = parsed as Partial<CognitiveTrace>;
		if (typeof trace !== 'object' || trace === null || !Array.isArray(trace.queries)) {
			throw new Error('Cognitive trace is missing the queries array.');
		}
		if (trace.formatVersion !== TRACE_FORMAT_VERSION) {
			throw new Error(`Unsupported cognitive trace format version: ${trace.formatVersion} (expected ${TRACE_FORMAT_VERSION}).`);
		}
		for (const query of trace.queries) {
			if (typeof query.response !== 'string' || !Array.isArray(query.phases)) {
				throw new Error('Cognitive trace contains a malformed query entry.');
			}
			for (const phase of query.phases) {
				if (typeof phase.name !== 'string' || typeof phase.content !== 'string' || typeof phase.durationMs !== 'number') {
					throw new Error('Cognitive trace contains a malformed thinking phase.');
				}
			}
		}

		this._importedTrace = {
			formatVersion: TRACE_FORMAT_VERSION,
			label: typeof trace.label === 'string' ? trace.label : 'imported-trace',
			exportedAt: typeof trace.exportedAt === 'number' ? trace.exportedAt : 0,
			queries: trace.queries as TracedQuery[]
		};
		this.logService.info(`CognitiveTraceService: imported trace "${this._importedTrace.label}" (${this._importedTrace.queries.length} queries)`);
		return this._importedTrace;
	}

	getImportedTrace(): CognitiveTrace | undefined {
		return this._importedTrace;
	}

	replay(queryIndex: number = 0, trace?: CognitiveTrace): TracedQuery | undefined {
		const source = trace ?? this._importedTrace;
		if (!source || queryIndex < 0 || queryIndex >= source.queries.length) {
			return undefined;
		}
		this.membraneService.recordActivity('cerebral');

		const query = source.queries[queryIndex];
		for (const phase of query.phases) {
			this._onDidReplayPhase.fire({ queryIndex, phase: { ...phase } });
		}
		this._onDidCompleteReplay.fire(query);
		this.logService.info(`CognitiveTraceService: replayed query ${queryIndex} (${query.phases.length} phases)`);
		return query;
	}

	clear(): void {
		this._sessionTrace.length = 0;
		this.logService.info('CognitiveTraceService: cleared session trace');
	}
}
