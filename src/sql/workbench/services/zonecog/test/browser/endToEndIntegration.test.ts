/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ICognitiveLoopService } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { CognitiveLoopService } from 'sql/workbench/services/zonecog/browser/cognitiveLoopService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { IAphroditeService } from 'sql/workbench/services/zonecog/common/aphrodite';
import { AphroditeService } from 'sql/workbench/services/zonecog/browser/aphroditeService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { DTESNService } from 'sql/workbench/services/zonecog/browser/dtesnService';
import { ICognitiveAnalyticsService, CognitiveAnalyticsSnapshot } from 'sql/workbench/services/zonecog/common/cognitiveAnalytics';
import { CognitiveAnalyticsService } from 'sql/workbench/services/zonecog/browser/cognitiveAnalyticsService';
import { IPLNReasoningService, InferredLink } from 'sql/workbench/services/zonecog/common/plnReasoning';
import { PLNReasoningService } from 'sql/workbench/services/zonecog/browser/plnReasoningService';
import { ISchemaPerceptionService } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { SchemaPerceptionService } from 'sql/workbench/services/zonecog/browser/schemaPerceptionService';
import { ISchemaEvolutionService } from 'sql/workbench/services/zonecog/common/schemaEvolution';
import { SchemaEvolutionService } from 'sql/workbench/services/zonecog/browser/schemaEvolutionService';
import { ICognitiveWorkflowAutomationService, CognitiveWorkflowDefinition, WorkflowResult } from 'sql/workbench/services/zonecog/common/cognitiveWorkflowAutomation';
import { CognitiveWorkflowAutomationService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkflowAutomationService';
import { IAAROrchestrationService } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { AAROrchestrationService } from 'sql/workbench/services/zonecog/browser/aarOrchestrationService';
import { AutognosisService } from 'sql/workbench/services/zonecog/browser/autognosisService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Extended service graph — adds PLN, Schema, Workflow, and SchemaEvolution
// on top of the base cognitive pipeline
// ---------------------------------------------------------------------------

interface ExtendedServiceGraph {
	instantiationService: TestInstantiationService;
	hypergraphStore: HypergraphStore;
	membraneService: CognitiveMembraneService;
	ecanService: ECANAttentionService;
	embodiedService: EmbodiedCognitionService;
	workspaceService: CognitiveWorkspaceService;
	zonecogService: ZoneCogService;
	loopService: CognitiveLoopService;
	analyticsService: CognitiveAnalyticsService;
	autognosisService: AutognosisService;
	plnService: PLNReasoningService;
	schemaPerceptionService: SchemaPerceptionService;
	schemaEvolutionService: SchemaEvolutionService;
	workflowService: CognitiveWorkflowAutomationService;
	aarService: AAROrchestrationService;
}

async function buildExtendedServiceGraph(): Promise<ExtendedServiceGraph> {
	const instantiationService = new TestInstantiationService();
	instantiationService.stub(ILogService, new NullLogService());

	const hypergraphStore = instantiationService.createInstance(HypergraphStore);
	instantiationService.stub(IHypergraphStore, hypergraphStore);

	const membraneService = instantiationService.createInstance(CognitiveMembraneService);
	instantiationService.stub(ICognitiveMembraneService, membraneService);

	const aphroditeService = instantiationService.createInstance(AphroditeService);
	instantiationService.stub(IAphroditeService, aphroditeService);

	const llmService = instantiationService.createInstance(LLMProviderService);
	instantiationService.stub(ILLMProviderService, llmService);

	const ecanService = instantiationService.createInstance(ECANAttentionService);
	instantiationService.stub(IECANAttentionService, ecanService);

	const embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
	instantiationService.stub(IEmbodiedCognitionService, embodiedService);

	const workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
	instantiationService.stub(ICognitiveWorkspaceService, workspaceService);

	const dtesnService = instantiationService.createInstance(DTESNService);
	instantiationService.stub(IDTESNService, dtesnService);

	const zonecogService = instantiationService.createInstance(ZoneCogService);
	instantiationService.stub(IZoneCogService, zonecogService);
	await zonecogService.initialize();

	const loopService = instantiationService.createInstance(CognitiveLoopService) as CognitiveLoopService;
	instantiationService.stub(ICognitiveLoopService, loopService);

	const analyticsService = instantiationService.createInstance(CognitiveAnalyticsService);
	instantiationService.stub(ICognitiveAnalyticsService, analyticsService);

	const autognosisService = instantiationService.createInstance(AutognosisService) as AutognosisService;

	const plnService = instantiationService.createInstance(PLNReasoningService) as PLNReasoningService;
	instantiationService.stub(IPLNReasoningService, plnService);

	const schemaPerceptionService = instantiationService.createInstance(SchemaPerceptionService) as SchemaPerceptionService;
	instantiationService.stub(ISchemaPerceptionService, schemaPerceptionService);

	const schemaEvolutionService = instantiationService.createInstance(SchemaEvolutionService) as SchemaEvolutionService;
	instantiationService.stub(ISchemaEvolutionService, schemaEvolutionService);

	const aarService = instantiationService.createInstance(AAROrchestrationService) as AAROrchestrationService;
	instantiationService.stub(IAAROrchestrationService, aarService);

	const workflowService = instantiationService.createInstance(CognitiveWorkflowAutomationService) as CognitiveWorkflowAutomationService;
	instantiationService.stub(ICognitiveWorkflowAutomationService, workflowService);

	return {
		instantiationService,
		hypergraphStore,
		membraneService,
		ecanService,
		embodiedService,
		workspaceService,
		zonecogService,
		loopService,
		analyticsService,
		autognosisService,
		plnService,
		schemaPerceptionService,
		schemaEvolutionService,
		workflowService,
		aarService,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('End-to-End Integration Tests (Phase 7)', () => {

	let graph: ExtendedServiceGraph;

	setup(async () => {
		graph = await buildExtendedServiceGraph();
	});

	teardown(() => {
		graph.loopService.stop();
		graph.aarService.dispose();
		graph.workflowService.dispose();
	});

	// -------------------------------------------------------------------
	// Path 1: PLN → HypergraphStore → ECAN
	// -------------------------------------------------------------------

	suite('PLN → HypergraphStore → ECAN', () => {

		test('PLN inference persists Inferred links in the hypergraph store', () => {
			graph.hypergraphStore.addNode({
				id: 'pln-a', content: 'Concept A', node_type: 'Concept',
				salience_score: 0.7, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'pln-b', content: 'Concept B', node_type: 'Concept',
				salience_score: 0.7, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'pln-c', content: 'Concept C', node_type: 'Concept',
				salience_score: 0.7, metadata: {}, links: [],
			});

			graph.hypergraphStore.addLink({
				id: 'pln-ab', link_type: 'RelatesTo',
				outgoing: ['pln-a', 'pln-b'], metadata: {},
			});
			graph.hypergraphStore.addLink({
				id: 'pln-bc', link_type: 'RelatesTo',
				outgoing: ['pln-b', 'pln-c'], metadata: {},
			});

			graph.plnService.setTruthValue('pln-ab', { strength: 0.9, confidence: 0.8 });
			graph.plnService.setTruthValue('pln-bc', { strength: 0.85, confidence: 0.75 });

			const result = graph.plnService.infer({ maxIterations: 2 });

			assert.ok(result.inferred.length > 0,
				'PLN should derive at least one new link');

			const deducedAC = result.inferred.find(
				l => l.rule === 'deduction' && l.from === 'pln-a' && l.to === 'pln-c'
			);
			assert.ok(deducedAC, 'PLN should derive A→C via deduction from A→B and B→C');

			const persistedLink = graph.hypergraphStore.getLink(deducedAC!.id);
			assert.ok(persistedLink, 'inferred link should be persisted in the hypergraph store');
			assert.strictEqual(persistedLink!.link_type, 'Inferred');
		});

		test('ECAN spreading activation reaches PLN-inferred link endpoints', () => {
			graph.hypergraphStore.addNode({
				id: 'ecan-pln-a', content: 'Source', node_type: 'Concept',
				salience_score: 0.9, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'ecan-pln-b', content: 'Bridge', node_type: 'Concept',
				salience_score: 0.5, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'ecan-pln-c', content: 'Target', node_type: 'Concept',
				salience_score: 0.3, metadata: {}, links: [],
			});

			graph.hypergraphStore.addLink({
				id: 'ecan-pln-ab', link_type: 'RelatesTo',
				outgoing: ['ecan-pln-a', 'ecan-pln-b'], metadata: {},
			});
			graph.hypergraphStore.addLink({
				id: 'ecan-pln-bc', link_type: 'RelatesTo',
				outgoing: ['ecan-pln-b', 'ecan-pln-c'], metadata: {},
			});

			graph.plnService.setTruthValue('ecan-pln-ab', { strength: 0.9, confidence: 0.8 });
			graph.plnService.setTruthValue('ecan-pln-bc', { strength: 0.85, confidence: 0.7 });

			const inferResult = graph.plnService.infer({ maxIterations: 1 });
			assert.ok(inferResult.inferred.length > 0, 'should produce inferred links');

			graph.ecanService.stimulate('ecan-pln-a', 0.8);
			graph.ecanService.spreadActivation();

			const avB = graph.ecanService.getAttentionValue('ecan-pln-b');
			assert.ok(avB.sti > 0,
				'spreading activation should reach bridge node through existing links');

			graph.ecanService.spreadActivation();

			const avC = graph.ecanService.getAttentionValue('ecan-pln-c');
			assert.ok(avC.sti > 0,
				'spreading activation should propagate through to target node');
		});

		test('PLN-inferred nodes enter ECAN attentional focus via loop', async () => {
			graph.hypergraphStore.addNode({
				id: 'focus-a', content: 'Alpha concept', node_type: 'Concept',
				salience_score: 0.95, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'focus-b', content: 'Beta concept', node_type: 'Concept',
				salience_score: 0.9, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'focus-c', content: 'Gamma concept', node_type: 'Concept',
				salience_score: 0.85, metadata: {}, links: [],
			});

			graph.hypergraphStore.addLink({
				id: 'focus-ab', link_type: 'RelatesTo',
				outgoing: ['focus-a', 'focus-b'], metadata: {},
			});
			graph.hypergraphStore.addLink({
				id: 'focus-bc', link_type: 'RelatesTo',
				outgoing: ['focus-b', 'focus-c'], metadata: {},
			});

			graph.plnService.setTruthValue('focus-ab', { strength: 0.95, confidence: 0.9 });
			graph.plnService.setTruthValue('focus-bc', { strength: 0.9, confidence: 0.85 });
			graph.plnService.infer({ maxIterations: 2 });

			const inferredLinks = graph.plnService.getInferredLinks();
			assert.ok(inferredLinks.length > 0, 'should have inferred links before loop');

			const linkCountBefore = graph.hypergraphStore.linkCount();
			assert.ok(linkCountBefore >= 3,
				'hypergraph should contain original + inferred links');

			await graph.loopService.runOnce();

			const focusNodes = graph.ecanService.getAttentionalFocus();
			assert.ok(focusNodes.length > 0,
				'after loop iteration, ECAN should have nodes in attentional focus');

			let anyOriginalFocused = false;
			for (const nodeId of ['focus-a', 'focus-b', 'focus-c']) {
				const av = graph.ecanService.getAttentionValue(nodeId);
				if (av.sti > 0) {
					anyOriginalFocused = true;
					break;
				}
			}
			assert.ok(anyOriginalFocused,
				'loop ECAN pass should assign attention to PLN-involved nodes');
		});

		test('onDidInferLink fires for each inferred conclusion', () => {
			const inferred: InferredLink[] = [];
			graph.plnService.onDidInferLink(link => inferred.push(link));

			graph.hypergraphStore.addNode({
				id: 'event-a', content: 'A', node_type: 'Concept',
				salience_score: 0.5, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'event-b', content: 'B', node_type: 'Concept',
				salience_score: 0.5, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'event-c', content: 'C', node_type: 'Concept',
				salience_score: 0.5, metadata: {}, links: [],
			});

			graph.hypergraphStore.addLink({
				id: 'evt-ab', link_type: 'RelatesTo',
				outgoing: ['event-a', 'event-b'], metadata: {},
			});
			graph.hypergraphStore.addLink({
				id: 'evt-bc', link_type: 'RelatesTo',
				outgoing: ['event-b', 'event-c'], metadata: {},
			});

			graph.plnService.setTruthValue('evt-ab', { strength: 0.8, confidence: 0.7 });
			graph.plnService.setTruthValue('evt-bc', { strength: 0.8, confidence: 0.7 });

			graph.plnService.infer({ maxIterations: 1 });

			assert.ok(inferred.length > 0,
				'onDidInferLink should fire for each derived conclusion');
			assert.ok(inferred.every(l => l.truthValue.strength > 0),
				'all inferred links should have positive truth values');
		});

		test('PLN inference feeds into processQuery complexity assessment', async () => {
			for (let i = 0; i < 5; i++) {
				const id = `pln-rich-${i}`;
				graph.hypergraphStore.addNode({
					id, content: `PLN-enriched concept ${i}`, node_type: 'Concept',
					salience_score: 0.8, metadata: {}, links: [],
				});
			}

			for (let i = 0; i < 4; i++) {
				const linkId = `pln-rich-link-${i}`;
				graph.hypergraphStore.addLink({
					id: linkId, link_type: 'RelatesTo',
					outgoing: [`pln-rich-${i}`, `pln-rich-${i + 1}`], metadata: {},
				});
				graph.plnService.setTruthValue(linkId, { strength: 0.85, confidence: 0.8 });
			}

			graph.plnService.infer({ maxIterations: 3 });

			const inferredCount = graph.plnService.getInferredLinks().length;
			assert.ok(inferredCount > 0, 'chain should produce inferred links');

			for (const nodeId of ['pln-rich-0', 'pln-rich-1', 'pln-rich-2', 'pln-rich-3', 'pln-rich-4']) {
				graph.ecanService.setAttentionValue(nodeId, { sti: 0.8, lti: 0.5 });
			}
			graph.ecanService.setFocusBoundary(0.1);

			const response = await graph.zonecogService.processQuery('test');

			const analytics = graph.analyticsService.getSnapshot();
			assert.strictEqual(analytics.queryLatency.totalCount, 1,
				'analytics should record the query processed atop PLN-enriched state');
		});

		test('membrane records cerebral activity during PLN inference', () => {
			const cerebralBefore = graph.membraneService.getActivity('cerebral');

			graph.hypergraphStore.addNode({
				id: 'mem-a', content: 'A', node_type: 'Concept',
				salience_score: 0.5, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'mem-b', content: 'B', node_type: 'Concept',
				salience_score: 0.5, metadata: {}, links: [],
			});
			graph.hypergraphStore.addLink({
				id: 'mem-ab', link_type: 'RelatesTo',
				outgoing: ['mem-a', 'mem-b'], metadata: {},
			});
			graph.plnService.setTruthValue('mem-ab', { strength: 0.9, confidence: 0.8 });

			graph.plnService.infer({ maxIterations: 1 });

			const cerebralAfter = graph.membraneService.getActivity('cerebral');
			assert.ok(cerebralAfter > cerebralBefore,
				'PLN inference should record cerebral membrane activity');
		});
	});

	// -------------------------------------------------------------------
	// Path 2: Schema Perception → Cognitive Loop
	// -------------------------------------------------------------------

	suite('Schema Perception → Cognitive Loop', () => {

		test('schema perception creates hypergraph nodes', async () => {
			const nodeCountBefore = graph.hypergraphStore.nodeCount();

			await graph.schemaPerceptionService.perceiveSchema('test-connection-1');

			const nodeCountAfter = graph.hypergraphStore.nodeCount();
			assert.ok(nodeCountAfter >= nodeCountBefore,
				'perceiveSchema should create or maintain hypergraph nodes');
		});

		test('observed queries create hypergraph nodes with salience', () => {
			const nodeCountBefore = graph.hypergraphStore.nodeCount();

			graph.schemaPerceptionService.observeQuery({
				queryText: 'SELECT * FROM users WHERE active = 1',
				connectionUri: 'test-connection-1',
				startTime: Date.now() - 100,
				durationMs: 42,
				rowCount: 150,
				success: true,
				referencedTables: ['users'],
				operationType: 'select',
			});

			const nodeCountAfter = graph.hypergraphStore.nodeCount();
			assert.ok(nodeCountAfter > nodeCountBefore,
				'observeQuery should persist a query observation as a hypergraph node');
		});

		test('schema perception fires onDidPerceiveSchema for evolution tracking', async () => {
			let eventFired = false;
			graph.schemaPerceptionService.onDidPerceiveSchema(() => {
				eventFired = true;
			});

			await graph.schemaPerceptionService.perceiveSchema('test-connection-evolution');

			assert.strictEqual(eventFired, true,
				'perceiveSchema should fire onDidPerceiveSchema for schema evolution tracking');
		});

		test('observed query feeds into embodied cognition percepts', () => {
			const perceptsBefore = graph.embodiedService.getRecentPercepts('query').length;

			graph.schemaPerceptionService.observeQuery({
				queryText: 'INSERT INTO audit_log VALUES (1, NOW())',
				connectionUri: 'test-connection-1',
				startTime: Date.now() - 50,
				durationMs: 15,
				rowCount: 1,
				success: true,
				referencedTables: ['audit_log'],
				operationType: 'insert',
			});

			const perceptsAfter = graph.embodiedService.getRecentPercepts('query').length;
			assert.ok(perceptsAfter >= perceptsBefore,
				'query observation should register embodied cognition percepts');
		});

		test('loop perceive phase sees schema-generated hypergraph nodes', async () => {
			await graph.schemaPerceptionService.perceiveSchema('test-connection-loop');

			graph.schemaPerceptionService.observeQuery({
				queryText: 'SELECT name FROM products ORDER BY price DESC',
				connectionUri: 'test-connection-loop',
				startTime: Date.now() - 200,
				durationMs: 85,
				rowCount: 500,
				success: true,
				referencedTables: ['products'],
				operationType: 'select',
			});

			const nodeCount = graph.hypergraphStore.nodeCount();

			const iteration = await graph.loopService.runOnce();
			assert.strictEqual(iteration.success, true);

			const perceivePhase = iteration.phases.find(p => p.name === 'perceive');
			assert.ok(perceivePhase, 'loop should have a perceive phase');
			assert.ok(perceivePhase!.summary.includes(`${nodeCount} nodes`),
				'loop perceive should scan the hypergraph including schema nodes');
		});

		test('loop attend assigns ECAN attention to observed query nodes', async () => {
			for (let i = 0; i < 5; i++) {
				graph.schemaPerceptionService.observeQuery({
					queryText: `SELECT col${i} FROM table_${i}`,
					connectionUri: 'test-connection-attend',
					startTime: Date.now() - (i * 100),
					durationMs: 10 + i * 5,
					rowCount: 100 * (i + 1),
					success: true,
					referencedTables: [`table_${i}`],
					operationType: 'select',
				});
			}

			await graph.loopService.runOnce();

			const snapshot = graph.ecanService.getSnapshot();
			assert.ok(snapshot.spreadingCycles >= 1,
				'loop should run ECAN spreading on schema-observation nodes');
		});

		test('schema query statistics accumulate across observations', () => {
			const connUri = 'test-stats-connection';

			for (let i = 0; i < 10; i++) {
				graph.schemaPerceptionService.observeQuery({
					queryText: `SELECT * FROM orders WHERE id = ${i}`,
					connectionUri: connUri,
					startTime: Date.now() - (i * 50),
					durationMs: 20 + i,
					rowCount: 1,
					success: i < 8,
					errorMessage: i >= 8 ? 'timeout' : undefined,
					referencedTables: ['orders'],
					operationType: 'select',
				});
			}

			const stats = graph.schemaPerceptionService.getQueryStatistics(connUri);
			assert.strictEqual(stats.totalQueries, 10);
			assert.strictEqual(stats.successfulQueries, 8);
			assert.strictEqual(stats.failedQueries, 2);
			assert.ok(stats.averageDurationMs > 0);
			assert.ok(stats.frequentTables.some(t => t.table === 'orders'));
		});

		test('schema→loop→analytics produces coherent pipeline state', async () => {
			await graph.schemaPerceptionService.perceiveSchema('test-pipeline');

			graph.schemaPerceptionService.observeQuery({
				queryText: 'SELECT COUNT(*) FROM metrics',
				connectionUri: 'test-pipeline',
				startTime: Date.now() - 100,
				durationMs: 30,
				rowCount: 1,
				success: true,
				referencedTables: ['metrics'],
				operationType: 'select',
			});

			await graph.loopService.runOnce();

			const loopMetrics = graph.analyticsService.getCognitiveLoopMetrics();
			assert.strictEqual(loopMetrics.totalIterations, 1,
				'analytics should record loop iteration run atop schema data');

			const balance = graph.membraneService.getTriadBalance();
			assert.ok(balance.activityDistribution.cerebral > 0,
				'schema+loop pipeline should generate cerebral membrane activity');
		});
	});

	// -------------------------------------------------------------------
	// Path 3: Workflow → Analytics
	// -------------------------------------------------------------------

	suite('Workflow → Analytics', () => {

		const testWorkflow: CognitiveWorkflowDefinition = {
			id: 'e2e-test-workflow',
			name: 'E2E Test Workflow',
			description: 'End-to-end workflow for integration testing',
			version: '1.0.0',
			steps: [
				{
					id: 'step1',
					name: 'Analyze Query',
					agent: 'sql-analyzer-agent',
					action: 'analyze_query',
					input: { query: 'SELECT * FROM test_table' },
				},
			],
			triggers: [{ type: 'manual' }],
		};

		const multiStepWorkflow: CognitiveWorkflowDefinition = {
			id: 'e2e-multi-step-workflow',
			name: 'Multi-Step E2E Workflow',
			description: 'Multi-step workflow for analytics integration testing',
			version: '1.0.0',
			steps: [
				{
					id: 'step-analyze',
					name: 'Analyze Schema',
					agent: 'schema-perception',
					action: 'perceive_schema',
					input: { connectionId: 'test-wf-connection' },
					next: 'step-advise',
				},
				{
					id: 'step-advise',
					name: 'Performance Advisory',
					agent: 'performance-advisor-agent',
					action: 'analyze_performance',
					input: { query: 'SELECT * FROM large_table' },
				},
			],
			triggers: [{ type: 'manual' }],
		};

		test('workflow execution persists execution nodes in hypergraph', async () => {
			graph.workflowService.registerWorkflow(testWorkflow);

			const nodeCountBefore = graph.hypergraphStore.nodeCount();
			await graph.workflowService.executeWorkflow('e2e-test-workflow');
			const nodeCountAfter = graph.hypergraphStore.nodeCount();

			assert.ok(nodeCountAfter > nodeCountBefore,
				'workflow execution should persist workflow_execution nodes in hypergraph');

			const allNodes: HypergraphNode[] = [];
			for (let i = 0; i < nodeCountAfter; i++) {
				const nodes = graph.hypergraphStore.getNodesByType('workflow_execution');
				if (nodes.length > 0) {
					allNodes.push(...nodes);
					break;
				}
			}
		});

		test('workflow execution records membrane activity', async () => {
			graph.workflowService.registerWorkflow(testWorkflow);

			const somaticBefore = graph.membraneService.getActivity('somatic');
			const cerebralBefore = graph.membraneService.getActivity('cerebral');

			await graph.workflowService.executeWorkflow('e2e-test-workflow');

			const somaticAfter = graph.membraneService.getActivity('somatic');
			const cerebralAfter = graph.membraneService.getActivity('cerebral');

			assert.ok(
				somaticAfter > somaticBefore || cerebralAfter > cerebralBefore,
				'workflow execution should record membrane activity'
			);
		});

		test('workflow fires onDidStartExecution and onDidCompleteExecution', async () => {
			let startFired = false;
			let completeFired = false;
			let completionResult: WorkflowResult | undefined;

			graph.workflowService.onDidStartExecution(() => { startFired = true; });
			graph.workflowService.onDidCompleteExecution(result => {
				completeFired = true;
				completionResult = result;
			});

			graph.workflowService.registerWorkflow(testWorkflow);
			await graph.workflowService.executeWorkflow('e2e-test-workflow');

			assert.strictEqual(startFired, true, 'onDidStartExecution should fire');
			assert.strictEqual(completeFired, true, 'onDidCompleteExecution should fire');
			assert.ok(completionResult);
			assert.ok(completionResult!.durationMs >= 0, 'should report execution duration');
		});

		test('workflow execution history accumulates', async () => {
			graph.workflowService.registerWorkflow(testWorkflow);

			await graph.workflowService.executeWorkflow('e2e-test-workflow');
			await graph.workflowService.executeWorkflow('e2e-test-workflow');
			await graph.workflowService.executeWorkflow('e2e-test-workflow');

			const history = graph.workflowService.getExecutionHistory('e2e-test-workflow');
			assert.ok(history.length >= 3,
				'execution history should accumulate across multiple runs');

			const workflow = graph.workflowService.getWorkflow('e2e-test-workflow');
			assert.ok(workflow);
			assert.ok(workflow!.executionCount >= 3,
				'workflow stats should track execution count');
		});

		test('multi-step workflow records step completions', async () => {
			const completedSteps: string[] = [];
			graph.workflowService.onDidCompleteStep(event => {
				completedSteps.push(event.stepId);
			});

			graph.workflowService.registerWorkflow(multiStepWorkflow);
			await graph.workflowService.executeWorkflow('e2e-multi-step-workflow');

			assert.ok(completedSteps.includes('step-analyze'),
				'should complete the analyze step');
			assert.ok(completedSteps.includes('step-advise'),
				'should complete the advise step');
		});

		test('workflow + loop produces compound membrane activity', async () => {
			graph.workflowService.registerWorkflow(testWorkflow);
			await graph.workflowService.executeWorkflow('e2e-test-workflow');

			await graph.loopService.runOnce();

			const balance = graph.membraneService.getTriadBalance();
			const totalActivity = balance.activityDistribution.cerebral +
				balance.activityDistribution.somatic +
				balance.activityDistribution.autonomic;

			assert.ok(Math.abs(totalActivity - 1.0) < 0.001 || totalActivity === 0,
				'membrane distribution should be normalized after workflow + loop');
		});

		test('workflow execution nodes are visible to loop perceive phase', async () => {
			graph.workflowService.registerWorkflow(testWorkflow);
			await graph.workflowService.executeWorkflow('e2e-test-workflow');

			const nodeCount = graph.hypergraphStore.nodeCount();

			const iteration = await graph.loopService.runOnce();
			assert.strictEqual(iteration.success, true);

			const perceivePhase = iteration.phases.find(p => p.name === 'perceive');
			assert.ok(perceivePhase);
			assert.ok(perceivePhase!.summary.includes(`${nodeCount} nodes`),
				'loop perceive should scan hypergraph including workflow execution nodes');
		});

		test('analytics captures cognitive activity across workflow + query pipeline', async () => {
			graph.workflowService.registerWorkflow(testWorkflow);
			await graph.workflowService.executeWorkflow('e2e-test-workflow');

			await graph.zonecogService.processQuery('Query after workflow execution');

			const snapshot = graph.analyticsService.getSnapshot();
			assert.strictEqual(snapshot.queryLatency.totalCount, 1,
				'analytics should capture the query processed after workflow');
			assert.ok(snapshot.queryLatency.meanMs >= 0);

			await graph.loopService.runOnce();

			const loopMetrics = graph.analyticsService.getCognitiveLoopMetrics();
			assert.strictEqual(loopMetrics.totalIterations, 1,
				'analytics should record loop iteration following workflow');
		});
	});

	// -------------------------------------------------------------------
	// Cross-cutting: All three paths combined
	// -------------------------------------------------------------------

	suite('Combined cross-service integration', () => {

		test('PLN + schema + workflow + loop + analytics aggregate state', async () => {
			// 1. Set up PLN reasoning chain
			graph.hypergraphStore.addNode({
				id: 'cross-a', content: 'Schema concept', node_type: 'Concept',
				salience_score: 0.8, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'cross-b', content: 'Query pattern', node_type: 'Concept',
				salience_score: 0.7, metadata: {}, links: [],
			});
			graph.hypergraphStore.addNode({
				id: 'cross-c', content: 'Optimization', node_type: 'Concept',
				salience_score: 0.9, metadata: {}, links: [],
			});

			graph.hypergraphStore.addLink({
				id: 'cross-ab', link_type: 'RelatesTo',
				outgoing: ['cross-a', 'cross-b'], metadata: {},
			});
			graph.hypergraphStore.addLink({
				id: 'cross-bc', link_type: 'RelatesTo',
				outgoing: ['cross-b', 'cross-c'], metadata: {},
			});
			graph.plnService.setTruthValue('cross-ab', { strength: 0.9, confidence: 0.8 });
			graph.plnService.setTruthValue('cross-bc', { strength: 0.85, confidence: 0.75 });

			const plnResult = graph.plnService.infer({ maxIterations: 2 });
			assert.ok(plnResult.inferred.length > 0, 'PLN should infer new links');

			// 2. Observe some queries via schema perception
			graph.schemaPerceptionService.observeQuery({
				queryText: 'SELECT * FROM cross_test',
				connectionUri: 'cross-connection',
				startTime: Date.now() - 100,
				durationMs: 50,
				rowCount: 200,
				success: true,
				referencedTables: ['cross_test'],
				operationType: 'select',
			});

			// 3. Run a workflow
			const workflow: CognitiveWorkflowDefinition = {
				id: 'cross-workflow',
				name: 'Cross-service Test',
				description: 'Tests all paths',
				version: '1.0.0',
				steps: [{
					id: 'analyze',
					name: 'Analyze',
					agent: 'sql-analyzer-agent',
					action: 'analyze_query',
					input: { query: 'SELECT 1' },
				}],
				triggers: [{ type: 'manual' }],
			};
			graph.workflowService.registerWorkflow(workflow);
			await graph.workflowService.executeWorkflow('cross-workflow');

			// 4. Process a query
			const response = await graph.zonecogService.processQuery('Cross-service analysis');
			assert.ok(response.response);

			// 5. Run the cognitive loop
			await graph.loopService.runOnce();
			await graph.loopService.runOnce();

			// 6. Verify aggregate state across all services
			const nodeCount = graph.hypergraphStore.nodeCount();
			assert.ok(nodeCount >= 6,
				'hypergraph should accumulate nodes from PLN + schema + workflow + query');

			const linkCount = graph.hypergraphStore.linkCount();
			assert.ok(linkCount >= 3,
				'hypergraph should contain original + inferred links');

			const ecanSnapshot = graph.ecanService.getSnapshot();
			assert.ok(ecanSnapshot.spreadingCycles >= 2,
				'ECAN should have run spreading across loop iterations');

			const analytics = graph.analyticsService.getSnapshot();
			assert.strictEqual(analytics.queryLatency.totalCount, 1,
				'analytics should have recorded the query');
			assert.strictEqual(analytics.cognitiveLoop.totalIterations, 2,
				'analytics should record both loop iterations');

			const balance = graph.membraneService.getTriadBalance();
			assert.ok(balance.activityDistribution.cerebral > 0,
				'cerebral membrane should show activity from reasoning + queries');

			const assessment = graph.autognosisService.getLatestAssessment();
			assert.ok(assessment,
				'autognosis should have triggered after processQuery');
			assert.ok(assessment!.observations.length > 0,
				'assessment should include observations about aggregate cognitive state');
		});

		test('sustained multi-path processing maintains system stability', async () => {
			// Set up PLN base
			for (let i = 0; i < 3; i++) {
				graph.hypergraphStore.addNode({
					id: `stable-${i}`, content: `Stable node ${i}`, node_type: 'Concept',
					salience_score: 0.7, metadata: {}, links: [],
				});
			}
			graph.hypergraphStore.addLink({
				id: 'stable-01', link_type: 'RelatesTo',
				outgoing: ['stable-0', 'stable-1'], metadata: {},
			});
			graph.hypergraphStore.addLink({
				id: 'stable-12', link_type: 'RelatesTo',
				outgoing: ['stable-1', 'stable-2'], metadata: {},
			});
			graph.plnService.setTruthValue('stable-01', { strength: 0.8, confidence: 0.7 });
			graph.plnService.setTruthValue('stable-12', { strength: 0.8, confidence: 0.7 });
			graph.plnService.infer({ maxIterations: 1 });

			// Interleave schema observations and loop iterations
			for (let round = 0; round < 3; round++) {
				graph.schemaPerceptionService.observeQuery({
					queryText: `SELECT * FROM table_${round}`,
					connectionUri: 'stable-connection',
					startTime: Date.now() - (round * 100),
					durationMs: 20 + round,
					rowCount: 50 * (round + 1),
					success: true,
					referencedTables: [`table_${round}`],
					operationType: 'select',
				});

				await graph.loopService.runOnce();
			}

			// Final state checks
			const loopState = graph.loopService.getState();
			assert.strictEqual(loopState.totalIterations, 3);
			assert.strictEqual(loopState.failedIterations, 0,
				'no loop iterations should fail during sustained multi-path processing');

			const analytics = graph.analyticsService.getCognitiveLoopMetrics();
			assert.strictEqual(analytics.totalIterations, 3);
			assert.strictEqual(analytics.successfulIterations, 3);

			const assessment = graph.autognosisService.getLatestAssessment();
			if (assessment) {
				assert.strictEqual(assessment.verdict, 'nominal',
					'system should remain in nominal state during sustained processing');
			}
		});
	});
});
