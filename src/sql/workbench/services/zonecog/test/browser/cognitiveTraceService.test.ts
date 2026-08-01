/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICognitiveTraceService, TRACE_FORMAT_VERSION } from 'sql/workbench/services/zonecog/common/cognitiveTrace';
import { CognitiveTraceService } from 'sql/workbench/services/zonecog/browser/cognitiveTraceService';
import { IZoneCogService, ZoneCogResponse, ThinkingPhase, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { Emitter } from 'vs/base/common/event';

suite('Cognitive Trace Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let traceService: ICognitiveTraceService;
	let processEmitter: Emitter<ZoneCogResponse>;
	let queryHistory: Array<{ query: string; timestamp: number }>;

	function makeResponse(response: string, phases: ThinkingPhase[] = []): ZoneCogResponse {
		return {
			thinking: '',
			phases,
			response,
			confidence: 0.8,
			metadata: {
				queryComplexity: 'moderate',
				thinkingDepth: 'moderate',
				processingTime: 42,
				relatedNodes: []
			}
		};
	}

	function processQuery(query: string, response: ZoneCogResponse): void {
		queryHistory.push({ query, timestamp: Date.now() });
		processEmitter.fire(response);
	}

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		processEmitter = new Emitter<ZoneCogResponse>();
		queryHistory = [];
		instantiationService.stub(IZoneCogService, <Partial<IZoneCogService>>{
			onDidProcessQuery: processEmitter.event,
			getQueryHistory: () => queryHistory
		});

		traceService = instantiationService.createInstance(CognitiveTraceService);
	});

	test('should start with an empty session trace', () => {
		assert.deepStrictEqual(traceService.getSessionTrace(), []);
		assert.strictEqual(traceService.getImportedTrace(), undefined);
	});

	test('should record processed queries with phases and query text', () => {
		processQuery('how many users?', makeResponse('42 users.', [
			{ name: 'Initial Engagement', content: 'thinking...', durationMs: 10 }
		]));

		const trace = traceService.getSessionTrace();
		assert.strictEqual(trace.length, 1);
		assert.strictEqual(trace[0].query, 'how many users?');
		assert.strictEqual(trace[0].response, '42 users.');
		assert.strictEqual(trace[0].phases.length, 1);
		assert.strictEqual(trace[0].complexity, 'moderate');
	});

	test('exported trace should round-trip through import', () => {
		processQuery('q1', makeResponse('a1', [{ name: 'p', content: 'c', durationMs: 5 }]));

		const json = traceService.exportTrace('my-trace');
		const imported = traceService.importTrace(json);

		assert.strictEqual(imported.formatVersion, TRACE_FORMAT_VERSION);
		assert.strictEqual(imported.label, 'my-trace');
		assert.strictEqual(imported.queries.length, 1);
		assert.strictEqual(imported.queries[0].response, 'a1');
		assert.strictEqual(traceService.getImportedTrace(), imported);
	});

	test('import should reject invalid JSON', () => {
		assert.throws(() => traceService.importTrace('not json'), /not valid JSON/);
	});

	test('import should reject wrong format versions', () => {
		const bad = JSON.stringify({ formatVersion: 999, label: 'x', exportedAt: 0, queries: [] });
		assert.throws(() => traceService.importTrace(bad), /format version/);
	});

	test('import should reject malformed phases', () => {
		const bad = JSON.stringify({
			formatVersion: TRACE_FORMAT_VERSION, label: 'x', exportedAt: 0,
			queries: [{ query: 'q', response: 'r', phases: [{ name: 'p' }], confidence: 1, complexity: 'simple', depth: 'shallow', processingTimeMs: 1, completedAt: 0 }]
		});
		assert.throws(() => traceService.importTrace(bad), /malformed thinking phase/);
	});

	test('replay should re-emit phases in order and fire completion', () => {
		processQuery('q1', makeResponse('a1', [
			{ name: 'one', content: 'c1', durationMs: 1 },
			{ name: 'two', content: 'c2', durationMs: 2 }
		]));
		traceService.importTrace(traceService.exportTrace());

		const replayedPhases: string[] = [];
		let completed = 0;
		traceService.onDidReplayPhase(e => replayedPhases.push(e.phase.name));
		traceService.onDidCompleteReplay(() => completed++);

		const replayed = traceService.replay();
		assert.ok(replayed);
		assert.deepStrictEqual(replayedPhases, ['one', 'two']);
		assert.strictEqual(completed, 1);
	});

	test('replay should return undefined for out-of-range indexes or missing traces', () => {
		assert.strictEqual(traceService.replay(), undefined);
		traceService.importTrace(JSON.stringify({ formatVersion: TRACE_FORMAT_VERSION, label: 'x', exportedAt: 0, queries: [] }));
		assert.strictEqual(traceService.replay(0), undefined);
	});

	test('clear should empty the session trace but keep the imported trace', () => {
		processQuery('q1', makeResponse('a1'));
		traceService.importTrace(traceService.exportTrace());

		traceService.clear();

		assert.deepStrictEqual(traceService.getSessionTrace(), []);
		assert.ok(traceService.getImportedTrace());
	});
});
