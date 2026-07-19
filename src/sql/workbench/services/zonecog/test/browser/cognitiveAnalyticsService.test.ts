/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICognitiveAnalyticsService, CognitiveAnalyticsSnapshot } from 'sql/workbench/services/zonecog/common/cognitiveAnalytics';
import { CognitiveAnalyticsService } from 'sql/workbench/services/zonecog/browser/cognitiveAnalyticsService';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { DTESNService } from 'sql/workbench/services/zonecog/browser/dtesnService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Cognitive Analytics Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let analyticsService: ICognitiveAnalyticsService;
	let zonecogService: ZoneCogService;
	let llmService: LLMProviderService;
	let dtesnService: DTESNService;
	let hypergraphStore: HypergraphStore;

	setup(async () => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		llmService = instantiationService.createInstance(LLMProviderService);
		instantiationService.stub(ILLMProviderService, llmService);

		const ecanService = instantiationService.createInstance(ECANAttentionService);
		instantiationService.stub(IECANAttentionService, ecanService);

		const workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
		instantiationService.stub(ICognitiveWorkspaceService, workspaceService);

		dtesnService = instantiationService.createInstance(DTESNService);
		instantiationService.stub(IDTESNService, dtesnService);

		zonecogService = instantiationService.createInstance(ZoneCogService);
		instantiationService.stub(IZoneCogService, zonecogService);
		await zonecogService.initialize();

		analyticsService = instantiationService.createInstance(CognitiveAnalyticsService);
	});

	// --- Initial state ---

	test('should start with empty metrics', () => {
		const snapshot = analyticsService.getSnapshot();
		assert.strictEqual(snapshot.queryLatency.totalCount, 0);
		assert.strictEqual(snapshot.thinkingPhases.length, 0);
		assert.strictEqual(snapshot.ecanEfficiency.samples, 0);
		assert.strictEqual(snapshot.workingMemory.samples, 0);
		assert.strictEqual(snapshot.tokenEconomics.requestCount, 0);
		assert.strictEqual(snapshot.dtesnConvergence.trainingRuns, 0);
	});

	test('should report zero mean latency with no observations', () => {
		const histogram = analyticsService.getQueryLatencyHistogram();
		assert.strictEqual(histogram.meanMs, 0);
		assert.strictEqual(histogram.minMs, 0);
		assert.strictEqual(histogram.maxMs, 0);
	});

	// --- Query latency & thinking phases ---

	test('should record query latency after processing a query', async () => {
		await zonecogService.processQuery('What tables exist in this database?');

		const histogram = analyticsService.getQueryLatencyHistogram();
		assert.strictEqual(histogram.totalCount, 1);
		assert.ok(histogram.meanMs >= 0);
		const bucketTotal = histogram.buckets.reduce((sum, b) => sum + b.count, 0);
		assert.strictEqual(bucketTotal, 1);
	});

	test('should record thinking phase durations after processing a query', async () => {
		await zonecogService.processQuery('Analyze the performance of this system');

		const phases = analyticsService.getThinkingPhaseStats();
		assert.ok(phases.length > 0, 'should have recorded at least one thinking phase');
		for (const phase of phases) {
			assert.ok(phase.count >= 1);
			assert.ok(phase.meanMs >= 0);
			assert.ok(phase.maxMs >= 0);
		}
	});

	test('should accumulate latency across multiple queries', async () => {
		await zonecogService.processQuery('first query');
		await zonecogService.processQuery('second query');

		const histogram = analyticsService.getQueryLatencyHistogram();
		assert.strictEqual(histogram.totalCount, 2);
	});

	// --- ECAN & working memory sampling ---

	test('should sample ECAN efficiency per processed query', async () => {
		await zonecogService.processQuery('sample ecan metrics');

		const ecan = analyticsService.getECANEfficiency();
		assert.strictEqual(ecan.samples, 1);
		assert.ok(ecan.meanFocusRatio >= 0 && ecan.meanFocusRatio <= 1);
	});

	test('should sample working memory utilization per processed query', async () => {
		await zonecogService.processQuery('sample working memory');

		const wm = analyticsService.getWorkingMemoryUtilization();
		assert.strictEqual(wm.samples, 1);
		assert.ok(wm.meanUtilization >= 0 && wm.meanUtilization <= 1);
		assert.ok(wm.peakUtilization >= wm.meanUtilization || wm.samples > 1);
	});

	// --- LLM token economics ---

	test('should record token economics for LLM completions', async () => {
		await llmService.complete('hello there');

		const tok = analyticsService.getTokenEconomics();
		assert.strictEqual(tok.requestCount, 1);
		assert.strictEqual(tok.fallbackCount, 1);
		assert.strictEqual(tok.streamedCount, 0);
		assert.ok(tok.meanLatencyMs >= 0);
		assert.ok(tok.requestsByProvider['builtin-fallback'] === 1);
	});

	test('should record streamed completions separately', async () => {
		await llmService.completeStream({
			systemPrompt: 'system',
			userMessage: 'stream this',
		}, () => { /* consume tokens */ });

		const tok = analyticsService.getTokenEconomics();
		assert.strictEqual(tok.requestCount, 1);
		assert.strictEqual(tok.streamedCount, 1);
	});

	// --- DTESN convergence ---

	test('should track DTESN training convergence', () => {
		const config = dtesnService.getConfig();
		const input = new Array(config.inputDim).fill(0.5);
		const target = new Array(config.outputDim).fill(1);

		for (let i = 0; i < 5; i++) {
			dtesnService.forward(input);
			dtesnService.recordTrainingSample(input, target);
		}
		dtesnService.trainReadout();
		dtesnService.trainReadout();

		const convergence = analyticsService.getDTESNConvergence();
		assert.strictEqual(convergence.trainingRuns, 2);
		assert.strictEqual(convergence.mseHistory.length, 2);
		assert.ok(convergence.bestMse <= convergence.firstMse);
	});

	// --- Events ---

	test('should fire onDidUpdateMetrics when a query is processed', async () => {
		let received: CognitiveAnalyticsSnapshot | undefined;
		const disposable = analyticsService.onDidUpdateMetrics(snapshot => { received = snapshot; });

		await zonecogService.processQuery('trigger metrics update');

		assert.ok(received, 'should have received a metrics snapshot');
		assert.ok(received!.queryLatency.totalCount >= 1);
		disposable.dispose();
	});

	// --- Reporting ---

	test('should generate a report containing all metric sections', async () => {
		await zonecogService.processQuery('report source query');

		const report = analyticsService.generateReport();
		assert.ok(report.includes('Cognitive Analytics Report'));
		assert.ok(report.includes('Query Processing'));
		assert.ok(report.includes('Thinking Phases'));
		assert.ok(report.includes('ECAN Attention Efficiency'));
		assert.ok(report.includes('Working Memory Utilization'));
		assert.ok(report.includes('LLM Token Economics'));
		assert.ok(report.includes('DTESN Training Convergence'));
	});

	test('should persist the report as an AnalyticsReport hypergraph node', () => {
		analyticsService.generateReport();

		const reportNodes = hypergraphStore.getNodesByType('AnalyticsReport');
		assert.strictEqual(reportNodes.length, 1);
		assert.ok(reportNodes[0].content.includes('Cognitive Analytics Report'));
	});

	// --- Reset ---

	test('should reset all metrics', async () => {
		await zonecogService.processQuery('accumulate before reset');
		await llmService.complete('accumulate llm');

		analyticsService.reset();

		const snapshot = analyticsService.getSnapshot();
		assert.strictEqual(snapshot.queryLatency.totalCount, 0);
		assert.strictEqual(snapshot.thinkingPhases.length, 0);
		assert.strictEqual(snapshot.ecanEfficiency.samples, 0);
		assert.strictEqual(snapshot.workingMemory.samples, 0);
		assert.strictEqual(snapshot.tokenEconomics.requestCount, 0);
		assert.strictEqual(snapshot.dtesnConvergence.trainingRuns, 0);
	});

	test('should continue collecting after reset', async () => {
		await zonecogService.processQuery('before reset');
		analyticsService.reset();
		await zonecogService.processQuery('after reset');

		const histogram = analyticsService.getQueryLatencyHistogram();
		assert.strictEqual(histogram.totalCount, 1);
	});
});
