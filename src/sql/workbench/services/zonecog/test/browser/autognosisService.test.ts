/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IAutognosisService, SelfAssessment } from 'sql/workbench/services/zonecog/common/autognosis';
import { AutognosisService } from 'sql/workbench/services/zonecog/browser/autognosisService';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService, MembraneTriad } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { DTESNService } from 'sql/workbench/services/zonecog/browser/dtesnService';
import { ICognitiveAnalyticsService } from 'sql/workbench/services/zonecog/common/cognitiveAnalytics';
import { CognitiveAnalyticsService } from 'sql/workbench/services/zonecog/browser/cognitiveAnalyticsService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Autognosis Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let autognosisService: IAutognosisService;
	let membraneService: CognitiveMembraneService;
	let embodiedService: EmbodiedCognitionService;
	let zonecogService: ZoneCogService;
	let hypergraphStore: HypergraphStore;

	setup(async () => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const llmService = instantiationService.createInstance(LLMProviderService);
		instantiationService.stub(ILLMProviderService, llmService);

		embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		const workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
		instantiationService.stub(ICognitiveWorkspaceService, workspaceService);

		const ecanService = instantiationService.createInstance(ECANAttentionService);
		instantiationService.stub(IECANAttentionService, ecanService);

		const dtesnService = instantiationService.createInstance(DTESNService);
		instantiationService.stub(IDTESNService, dtesnService);

		zonecogService = instantiationService.createInstance(ZoneCogService);
		instantiationService.stub(IZoneCogService, zonecogService);
		await zonecogService.initialize();

		const analyticsService = instantiationService.createInstance(CognitiveAnalyticsService);
		instantiationService.stub(ICognitiveAnalyticsService, analyticsService);

		autognosisService = instantiationService.createInstance(AutognosisService);
	});

	// --- Initial state ---

	test('should start with no assessment history', () => {
		assert.strictEqual(autognosisService.getLatestAssessment(), undefined);
		assert.deepStrictEqual(autognosisService.getAssessmentHistory(), []);
		assert.strictEqual(autognosisService.getTrend(), 'stable');
	});

	// --- Nominal assessment ---

	test('should report a nominal verdict when all subsystems are healthy', () => {
		const assessment = autognosisService.performSelfAssessment();

		assert.strictEqual(assessment.verdict, 'nominal');
		assert.strictEqual(assessment.selfConfidence, 1);
		assert.strictEqual(assessment.anomalies.length, 0);
		assert.ok(assessment.observations.length >= 4); // 3 membrane triads + embodiment
		assert.ok(assessment.observations.every(o => o.healthy));
	});

	test('should fire onDidCompleteSelfAssessment', () => {
		let fired: SelfAssessment | undefined;
		autognosisService.onDidCompleteSelfAssessment(a => fired = a);

		const assessment = autognosisService.performSelfAssessment();
		assert.ok(fired);
		assert.strictEqual(fired!.id, assessment.id);
	});

	test('should persist the assessment as a SelfAssessment hypergraph node', () => {
		const assessment = autognosisService.performSelfAssessment();

		const node = hypergraphStore.getNode(assessment.id);
		assert.ok(node);
		assert.strictEqual(node!.node_type, 'SelfAssessment');
		assert.strictEqual(node!.metadata['verdict'], 'nominal');
	});

	test('should trigger a self-assessment automatically after a query is processed', async () => {
		assert.strictEqual(autognosisService.getLatestAssessment(), undefined);
		await zonecogService.processQuery('What tables exist in this database?');
		assert.ok(autognosisService.getLatestAssessment());
	});

	// --- Degraded / critical assessment ---

	test('should report critical when a membrane triad is unhealthy', () => {
		const triad: MembraneTriad = 'somatic';
		for (let i = 0; i < 10; i++) {
			membraneService.recordError(triad, `synthetic error ${i}`);
		}

		const assessment = autognosisService.performSelfAssessment();
		assert.strictEqual(assessment.verdict, 'critical');
		// Exactly one unhealthy triad should cost exactly one 0.2 penalty: the
		// embodiment observation mirrors membrane health and must not be
		// double-counted (see AutognosisService._computeSelfConfidence).
		assert.strictEqual(assessment.selfConfidence, 0.8);
		const somaticObservation = assessment.observations.find(o => o.subsystem === 'somatic');
		assert.ok(somaticObservation);
		assert.strictEqual(somaticObservation!.healthy, false);
	});

	test('should report degraded with an anomaly on sustained high cognitive load', () => {
		// EmbodiedCognitionService estimates load from percepts+actions in the
		// last 30s: min(1, (recentPercepts / 10 + recentActions / 5) / 2). 21
		// near-simultaneous percepts drive load to 1.0, well past the 0.85 anomaly
		// threshold, with no actions and no membrane errors recorded.
		for (let i = 0; i < 21; i++) {
			embodiedService.perceive('query', `query ${i}`, 'SELECT * FROM huge_table', 1);
		}
		assert.ok(embodiedService.getProprioceptiveState().cognitiveLoad > 0.85);

		const assessment = autognosisService.performSelfAssessment();
		assert.strictEqual(assessment.verdict, 'degraded');
		assert.ok(assessment.anomalies.some(a => a.includes('cognitive load')));
	});

	// --- History & trend ---

	test('should retain assessment history, most recent first', () => {
		autognosisService.performSelfAssessment();
		autognosisService.performSelfAssessment();
		const third = autognosisService.performSelfAssessment();

		const history = autognosisService.getAssessmentHistory();
		assert.strictEqual(history.length, 3);
		assert.strictEqual(history[0].id, third.id);
	});

	test('should honor the history limit', () => {
		autognosisService.performSelfAssessment();
		autognosisService.performSelfAssessment();
		autognosisService.performSelfAssessment();

		assert.strictEqual(autognosisService.getAssessmentHistory(1).length, 1);
	});

	test('should report a degrading trend when confidence declines', () => {
		autognosisService.performSelfAssessment();
		autognosisService.performSelfAssessment();

		for (let i = 0; i < 10; i++) {
			membraneService.recordError('cerebral', `synthetic error ${i}`);
		}
		autognosisService.performSelfAssessment();

		assert.strictEqual(autognosisService.getTrend(), 'degrading');
	});

	// --- Reset ---

	test('reset should clear history and remove persisted nodes', () => {
		const assessment = autognosisService.performSelfAssessment();
		assert.ok(hypergraphStore.getNode(assessment.id));

		autognosisService.reset();

		assert.deepStrictEqual(autognosisService.getAssessmentHistory(), []);
		assert.strictEqual(autognosisService.getLatestAssessment(), undefined);
		assert.strictEqual(hypergraphStore.getNode(assessment.id), undefined);
	});
});
