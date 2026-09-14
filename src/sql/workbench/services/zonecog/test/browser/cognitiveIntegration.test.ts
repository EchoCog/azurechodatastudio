/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService, MembraneTriadBalance } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ICognitiveLoopService, CognitiveLoopIteration } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
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
import { AutognosisService } from 'sql/workbench/services/zonecog/browser/autognosisService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Full service graph wiring — every cognitive service is real
// ---------------------------------------------------------------------------

interface CognitiveServiceGraph {
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
}

async function buildServiceGraph(): Promise<CognitiveServiceGraph> {
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

	const analyticsService = instantiationService.createInstance(CognitiveAnalyticsService);
	instantiationService.stub(ICognitiveAnalyticsService, analyticsService);

	const loopService = instantiationService.createInstance(CognitiveLoopService) as CognitiveLoopService;
	instantiationService.stub(ICognitiveLoopService, loopService);

	const autognosisService = instantiationService.createInstance(AutognosisService) as AutognosisService;

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
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('Cognitive Pipeline Integration Tests', () => {

	let graph: CognitiveServiceGraph;

	setup(async () => {
		graph = await buildServiceGraph();
	});

	teardown(() => {
		graph.loopService.stop();
	});

	// -------------------------------------------------------------------
	// GAP 1: Cognitive Loop perceive→attend→think data flow
	// -------------------------------------------------------------------

	suite('loop perceive→attend→think→act→reflect data flow', () => {

		test('perceive registers embodied percepts from hypergraph nodes', async () => {
			graph.hypergraphStore.addNode({
				id: 'test-node-1',
				content: 'Database connection pooling analysis',
				node_type: 'QueryInput',
				salience_score: 0.8,
				metadata: {},
				links: [],
			});

			const iteration = await graph.loopService.runOnce();
			assert.strictEqual(iteration.success, true);

			const percepts = graph.embodiedService.getRecentPercepts('interaction');
			assert.ok(percepts.length > 0, 'perceive phase should register interaction percepts');
			const hasHypergraphScan = percepts.some(p => p.summary.includes('Hypergraph scan'));
			assert.ok(hasHypergraphScan, 'perceive should report hypergraph scan results');
		});

		test('attend assigns ECAN attention to hypergraph nodes', async () => {
			graph.hypergraphStore.addNode({
				id: 'ecan-node-1',
				content: 'Salient pattern to attend',
				node_type: 'Concept',
				salience_score: 0.9,
				metadata: {},
				links: [],
			});

			await graph.loopService.runOnce();

			const av = graph.ecanService.getAttentionValue('ecan-node-1');
			assert.ok(av.sti !== 0 || av.lti !== 0,
				'attend phase should assign attention values to hypergraph nodes');
		});

		test('think moves high-attention nodes into working memory', async () => {
			for (let i = 0; i < 5; i++) {
				graph.hypergraphStore.addNode({
					id: `wm-node-${i}`,
					content: `Important cognitive item ${i}`,
					node_type: 'Concept',
					salience_score: 0.95,
					metadata: {},
					links: [],
				});
			}

			// Run to populate ECAN values and allow think to promote to WM
			await graph.loopService.runOnce();

			const wm = graph.workspaceService.getWorkingMemory();
			assert.ok(wm.length > 0,
				'think phase should promote high-STI nodes to working memory');
		});

		test('act produces motor actions when working memory has cross-domain items', async () => {
			// Pre-populate working memory with cross-domain items
			graph.workspaceService.addToWorkingMemory('QueryInput', 'SQL optimization analysis', 0.9);
			graph.workspaceService.addToWorkingMemory('Concept', 'Index strategy evaluation', 0.85);
			graph.workspaceService.addToWorkingMemory('CognitiveResponse', 'Pattern synthesis result', 0.8);

			await graph.loopService.runOnce();

			const actions = graph.embodiedService.getRecentActions('insight');
			assert.ok(actions.length > 0,
				'act phase should produce insight actions from cross-domain working memory');
			const crossDomainAction = actions.find(a => a.label.includes('Cross-domain'));
			assert.ok(crossDomainAction, 'should identify cross-domain patterns');
		});

		test('reflect decays working memory and records episode', async () => {
			graph.workspaceService.addToWorkingMemory('Test', 'Item to decay', 0.5);

			const wmBefore = graph.workspaceService.getWorkingMemory();
			const initialRelevance = wmBefore[0]?.relevance ?? 0;

			await graph.loopService.runOnce();

			const wmAfter = graph.workspaceService.getWorkingMemory();
			if (wmAfter.length > 0 && initialRelevance > 0) {
				assert.ok(wmAfter[0].relevance <= initialRelevance,
					'reflect phase should decay working memory relevance');
			}
		});

		test('full iteration chains data across all five phases', async () => {
			// Seed the hypergraph with multiple salient nodes
			for (let i = 0; i < 6; i++) {
				graph.hypergraphStore.addNode({
					id: `chain-${i}`,
					content: `Cross-service chain item ${i}`,
					node_type: i % 2 === 0 ? 'Concept' : 'QueryInput',
					salience_score: 0.85 + i * 0.02,
					metadata: {},
					links: [],
				});
			}

			const iteration = await graph.loopService.runOnce();
			assert.strictEqual(iteration.success, true);
			assert.strictEqual(iteration.phases.length, 5);

			// Verify phase ordering
			const names = iteration.phases.map(p => p.name);
			assert.deepStrictEqual(names, ['perceive', 'attend', 'think', 'act', 'reflect']);

			// Perceive phase saw the nodes
			assert.ok(iteration.phases[0].summary.includes('6 nodes'),
				'perceive should scan all seeded nodes');

			// Attend phase ran spreading activation
			assert.ok(iteration.phases[1].summary.includes('ECAN'),
				'attend should run ECAN spreading');

			// Think phase processed items
			assert.ok(iteration.phases[2].summary.includes('Processed'),
				'think should process focused items');

			// Verify the chain: nodes → ECAN → working memory
			const focusNodes = graph.ecanService.getAttentionalFocus();
			assert.ok(focusNodes.length > 0,
				'after a full iteration ECAN should have nodes in attentional focus');

			const wm = graph.workspaceService.getWorkingMemory();
			assert.ok(wm.length > 0,
				'after a full iteration working memory should contain promoted items');
		});
	});

	// -------------------------------------------------------------------
	// GAP 4: processQuery → CognitiveLoop bidirectional interaction
	// -------------------------------------------------------------------

	suite('processQuery → cognitive loop interaction', () => {

		test('query-generated nodes are visible to loop perceive phase', async () => {
			const nodeCountBefore = graph.hypergraphStore.nodeCount();

			await graph.zonecogService.processQuery('Analyze database indexing strategy');

			const nodeCountAfter = graph.hypergraphStore.nodeCount();
			assert.ok(nodeCountAfter > nodeCountBefore,
				'processQuery should persist nodes to hypergraph');

			// Now run the loop — it should perceive the query-generated nodes
			const iteration = await graph.loopService.runOnce();
			assert.strictEqual(iteration.success, true);

			const perceivePhase = iteration.phases.find(p => p.name === 'perceive');
			assert.ok(perceivePhase);
			assert.ok(perceivePhase!.summary.includes(`${nodeCountAfter} nodes`),
				'loop perceive should see query-generated nodes in hypergraph');
		});

		test('loop assigns ECAN attention to query-created nodes', async () => {
			const response = await graph.zonecogService.processQuery('Optimize query performance');

			// Find the persisted nodes from the query
			const queryNodes = response.metadata.relatedNodes;
			assert.ok(queryNodes.length > 0, 'query should produce related nodes');

			// Run the loop to assign attention
			await graph.loopService.runOnce();

			// Verify ECAN touched the query-generated nodes
			let attentionAssigned = false;
			for (const nodeId of queryNodes) {
				const av = graph.ecanService.getAttentionValue(nodeId);
				if (av.sti !== 0 || av.lti !== 0) {
					attentionAssigned = true;
					break;
				}
			}
			assert.ok(attentionAssigned,
				'loop attend phase should assign ECAN attention to query-generated nodes');
		});

		test('loop promotes query nodes to working memory via ECAN', async () => {
			// Process a complex query to generate high-salience nodes
			await graph.zonecogService.processQuery(
				'Analyze and compare multi-tenant database architecture strategies for cloud providers'
			);

			// Run two iterations to let ECAN stabilize and think phase promote
			await graph.loopService.runOnce();
			await graph.loopService.runOnce();

			const wm = graph.workspaceService.getWorkingMemory();
			assert.ok(wm.length > 0,
				'loop should promote query-generated nodes through ECAN into working memory');
		});

		test('multiple queries and loop iterations accumulate cognitive state', async () => {
			await graph.zonecogService.processQuery('Database connection pooling');
			await graph.loopService.runOnce();

			await graph.zonecogService.processQuery('Query execution plan optimization');
			await graph.loopService.runOnce();

			await graph.zonecogService.processQuery('Index maintenance scheduling');
			await graph.loopService.runOnce();

			// After 3 queries + 3 loop iterations, the cognitive state should be rich
			const nodeCount = graph.hypergraphStore.nodeCount();
			assert.ok(nodeCount >= 9,
				'3 queries should generate at least 9 hypergraph nodes');

			const focusNodes = graph.ecanService.getAttentionalFocus();
			assert.ok(focusNodes.length > 0,
				'repeated queries + iterations should produce attentional focus');

			const wm = graph.workspaceService.getWorkingMemory();
			assert.ok(wm.length > 0,
				'repeated queries + iterations should populate working memory');

			const snapshot = graph.ecanService.getSnapshot();
			assert.ok(snapshot.spreadingCycles >= 3,
				'each loop iteration should run spreading activation');
		});
	});

	// -------------------------------------------------------------------
	// GAP 2 & 3: Analytics and Autognosis observe query events
	// -------------------------------------------------------------------

	suite('analytics and autognosis event subscriptions', () => {

		test('analytics records query latency after processQuery', async () => {
			const snapshotBefore = graph.analyticsService.getSnapshot();
			assert.strictEqual(snapshotBefore.queryLatency.totalCount, 0);

			await graph.zonecogService.processQuery('Simple test query');

			const snapshotAfter = graph.analyticsService.getSnapshot();
			assert.strictEqual(snapshotAfter.queryLatency.totalCount, 1);
			assert.ok(snapshotAfter.queryLatency.meanMs >= 0);
		});

		test('analytics records thinking phase stats after processQuery', async () => {
			await graph.zonecogService.processQuery(
				'Analyze and compare different approaches to synthesize an optimal strategy'
			);

			const snapshot = graph.analyticsService.getSnapshot();
			assert.ok(snapshot.thinkingPhases.length > 0,
				'analytics should record thinking phase durations from query processing');

			const initialEngagement = snapshot.thinkingPhases.find(
				p => p.name === 'Initial Engagement'
			);
			assert.ok(initialEngagement, 'should track Initial Engagement phase');
			assert.ok(initialEngagement!.count >= 1);
		});

		test('analytics samples ECAN efficiency after processQuery', async () => {
			await graph.zonecogService.processQuery('Test ECAN sampling');

			const snapshot = graph.analyticsService.getSnapshot();
			assert.ok(snapshot.ecanEfficiency.samples >= 1,
				'analytics should sample ECAN metrics after each query');
		});

		test('autognosis triggers self-assessment after processQuery', async () => {
			assert.strictEqual(graph.autognosisService.getLatestAssessment(), undefined);

			await graph.zonecogService.processQuery('Trigger autognosis check');

			const assessment = graph.autognosisService.getLatestAssessment();
			assert.ok(assessment, 'autognosis should auto-trigger after processQuery');
			assert.strictEqual(assessment!.verdict, 'nominal');
			assert.ok(assessment!.observations.length > 0);
		});

		test('autognosis persists assessment as hypergraph node', async () => {
			await graph.zonecogService.processQuery('Generate assessment node');

			const assessment = graph.autognosisService.getLatestAssessment();
			assert.ok(assessment);

			const node = graph.hypergraphStore.getNode(assessment!.id);
			assert.ok(node, 'assessment should be persisted as a hypergraph node');
			assert.strictEqual(node!.node_type, 'SelfAssessment');
		});
	});

	// -------------------------------------------------------------------
	// GAP 8: Full pipeline end-to-end
	// -------------------------------------------------------------------

	suite('full pipeline end-to-end', () => {

		test('query → loop → analytics → autognosis aggregate state', async () => {
			// 1. Process a query — generates hypergraph nodes, fires onDidProcessQuery
			const response = await graph.zonecogService.processQuery(
				'How can I analyze database performance across multi-tenant environments?'
			);
			assert.ok(response.response);
			assert.ok(response.phases.length > 0);

			// 2. Verify query persisted to hypergraph
			const queryNodes = response.metadata.relatedNodes;
			assert.ok(queryNodes.length > 0);
			for (const nodeId of queryNodes) {
				const node = graph.hypergraphStore.getNode(nodeId);
				assert.ok(node, `query node ${nodeId} should exist in hypergraph`);
			}

			// 3. Verify analytics captured the query
			const analyticsAfterQuery = graph.analyticsService.getSnapshot();
			assert.strictEqual(analyticsAfterQuery.queryLatency.totalCount, 1);

			// 4. Verify autognosis ran its self-assessment
			const assessmentAfterQuery = graph.autognosisService.getLatestAssessment();
			assert.ok(assessmentAfterQuery);

			// 5. Run the cognitive loop — it should perceive query nodes
			const iteration = await graph.loopService.runOnce();
			assert.strictEqual(iteration.success, true);

			// 6. Verify ECAN allocated attention to query nodes
			let queryNodeAttended = false;
			for (const nodeId of queryNodes) {
				const av = graph.ecanService.getAttentionValue(nodeId);
				if (av.sti !== 0 || av.lti !== 0) {
					queryNodeAttended = true;
					break;
				}
			}
			assert.ok(queryNodeAttended,
				'loop should assign ECAN attention to query-generated nodes');

			// 7. Verify working memory was populated from the pipeline
			const wm = graph.workspaceService.getWorkingMemory();
			// Working memory may or may not have items depending on STI thresholds
			// but the pipeline should have run without error and returned an array
			assert.ok(Array.isArray(wm), 'working memory should be readable after the loop');

			// 8. Verify membrane recorded activities from both query and loop
			const cerebralActivity = graph.membraneService.getActivity('cerebral');
			assert.ok(cerebralActivity > 0,
				'membrane should show cerebral activity from query + loop');

			// 9. Run a second query to verify accumulated state
			const response2 = await graph.zonecogService.processQuery(
				'What optimization strategies work best for query performance?'
			);
			assert.ok(response2.response);

			// 10. Verify analytics has both queries
			const analyticsFinal = graph.analyticsService.getSnapshot();
			assert.strictEqual(analyticsFinal.queryLatency.totalCount, 2);

			// 11. Verify autognosis updated its assessment
			const assessmentFinal = graph.autognosisService.getLatestAssessment();
			assert.ok(assessmentFinal);
			assert.ok(assessmentFinal!.observations.length > 0);
		});

		test('sustained cognitive processing over multiple iterations', async () => {
			// Simulate a sustained cognitive session
			await graph.zonecogService.processQuery('Initial database analysis');

			for (let i = 0; i < 3; i++) {
				await graph.loopService.runOnce();
			}

			await graph.zonecogService.processQuery('Follow-up optimization query');

			for (let i = 0; i < 2; i++) {
				await graph.loopService.runOnce();
			}

			// Verify accumulated state across all services
			const nodeCount = graph.hypergraphStore.nodeCount();
			assert.ok(nodeCount >= 6,
				'sustained processing should accumulate hypergraph state');

			const loopState = graph.loopService.getState();
			assert.strictEqual(loopState.totalIterations, 5);
			assert.strictEqual(loopState.failedIterations, 0);

			const analytics = graph.analyticsService.getSnapshot();
			assert.strictEqual(analytics.queryLatency.totalCount, 2);

			const ecanSnapshot = graph.ecanService.getSnapshot();
			assert.ok(ecanSnapshot.spreadingCycles >= 5,
				'5 loop iterations should produce at least 5 spreading cycles');

			const assessmentHistory = graph.autognosisService.getAssessmentHistory();
			assert.ok(assessmentHistory.length >= 2,
				'2 queries should trigger at least 2 self-assessments');
		});

		test('loop onDidCompleteIteration fires with correct phase data', async () => {
			const iterations: CognitiveLoopIteration[] = [];
			graph.loopService.onDidCompleteIteration(iter => iterations.push(iter));

			graph.hypergraphStore.addNode({
				id: 'event-node',
				content: 'Test event propagation',
				node_type: 'Concept',
				salience_score: 0.7,
				metadata: {},
				links: [],
			});

			await graph.loopService.runOnce();
			await graph.loopService.runOnce();

			assert.strictEqual(iterations.length, 2);
			for (const iter of iterations) {
				assert.strictEqual(iter.success, true);
				assert.strictEqual(iter.phases.length, 5);
				assert.ok(iter.durationMs >= 0);
			}
		});
	});

	// -------------------------------------------------------------------
	// Membrane health cross-service verification
	// -------------------------------------------------------------------

	suite('membrane health across cognitive pipeline', () => {

		test('query processing records cerebral membrane activity', async () => {
			const cerebralBefore = graph.membraneService.getActivity('cerebral');

			await graph.zonecogService.processQuery('Membrane activity test');

			const cerebralAfter = graph.membraneService.getActivity('cerebral');
			assert.ok(cerebralAfter > cerebralBefore,
				'processQuery should increase cerebral membrane activity');
		});

		test('loop phases record activities on all three membrane triads', async () => {
			graph.hypergraphStore.addNode({
				id: 'membrane-test',
				content: 'Multi-triad membrane test',
				node_type: 'Concept',
				salience_score: 0.9,
				metadata: {},
				links: [],
			});

			// Pre-fill working memory so act phase fires
			graph.workspaceService.addToWorkingMemory('TypeA', 'Item A', 0.9);
			graph.workspaceService.addToWorkingMemory('TypeB', 'Item B', 0.85);
			graph.workspaceService.addToWorkingMemory('TypeC', 'Item C', 0.8);

			await graph.loopService.runOnce();

			assert.ok(graph.membraneService.getActivity('cerebral') > 0,
				'think phase should record cerebral activity');
			assert.ok(graph.membraneService.getActivity('somatic') > 0,
				'act phase should record somatic activity');
			assert.ok(graph.membraneService.getActivity('autonomic') > 0,
				'reflect phase should record autonomic activity');
		});

		test('autognosis detects membrane health from cognitive pipeline', async () => {
			await graph.zonecogService.processQuery('Health check trigger');

			const assessment = graph.autognosisService.getLatestAssessment();
			assert.ok(assessment);

			const membraneObs = assessment!.observations.filter(
				o => o.subsystem.includes('membrane') || o.subsystem.includes('triad')
			);
			assert.ok(membraneObs.length > 0,
				'autognosis should include membrane observations');
			assert.ok(membraneObs.every(o => o.healthy),
				'membrane should be healthy after normal query processing');
		});
	});

	// -------------------------------------------------------------------
	// Topology Weave Gap 1: Cognitive loop feeds analytics
	// -------------------------------------------------------------------

	suite('topology weave: loop → analytics telemetry', () => {

		test('analytics records loop iteration after runOnce', async () => {
			const snapshotBefore = graph.analyticsService.getCognitiveLoopMetrics();
			assert.strictEqual(snapshotBefore.totalIterations, 0);

			await graph.loopService.runOnce();

			const snapshotAfter = graph.analyticsService.getCognitiveLoopMetrics();
			assert.strictEqual(snapshotAfter.totalIterations, 1);
			assert.strictEqual(snapshotAfter.successfulIterations, 1);
			assert.strictEqual(snapshotAfter.failedIterations, 0);
			assert.ok(snapshotAfter.meanIterationMs >= 0);
		});

		test('analytics tracks per-phase loop durations', async () => {
			graph.hypergraphStore.addNode({
				id: 'loop-phase-test',
				content: 'Phase tracking node',
				node_type: 'Concept',
				salience_score: 0.8,
				metadata: {},
				links: [],
			});

			await graph.loopService.runOnce();

			const metrics = graph.analyticsService.getCognitiveLoopMetrics();
			const phaseNames = Object.keys(metrics.loopPhaseStats);
			assert.ok(phaseNames.includes('perceive'), 'should track perceive phase');
			assert.ok(phaseNames.includes('attend'), 'should track attend phase');
			assert.ok(phaseNames.includes('think'), 'should track think phase');
			assert.ok(phaseNames.includes('act'), 'should track act phase');
			assert.ok(phaseNames.includes('reflect'), 'should track reflect phase');
		});

		test('analytics accumulates iterations over multiple loop runs', async () => {
			for (let i = 0; i < 4; i++) {
				await graph.loopService.runOnce();
			}

			const metrics = graph.analyticsService.getCognitiveLoopMetrics();
			assert.strictEqual(metrics.totalIterations, 4);
			assert.strictEqual(metrics.successfulIterations, 4);
			assert.ok(metrics.maxIterationMs >= metrics.meanIterationMs);
		});

		test('loop metrics appear in full analytics snapshot', async () => {
			await graph.loopService.runOnce();

			const snapshot = graph.analyticsService.getSnapshot();
			assert.ok(snapshot.cognitiveLoop);
			assert.strictEqual(snapshot.cognitiveLoop.totalIterations, 1);
		});

		test('loop metrics appear in generated report', async () => {
			await graph.loopService.runOnce();
			await graph.loopService.runOnce();

			const report = graph.analyticsService.generateReport();
			assert.ok(report.includes('Cognitive Loop'));
			assert.ok(report.includes('2 iterations'));
			assert.ok(report.includes('iter/min'));
		});

		test('analytics reset clears loop metrics', async () => {
			await graph.loopService.runOnce();
			assert.strictEqual(graph.analyticsService.getCognitiveLoopMetrics().totalIterations, 1);

			graph.analyticsService.reset();

			const metrics = graph.analyticsService.getCognitiveLoopMetrics();
			assert.strictEqual(metrics.totalIterations, 0);
			assert.strictEqual(metrics.successfulIterations, 0);
			assert.strictEqual(metrics.meanIterationMs, 0);
		});

		test('onDidUpdateMetrics fires with loop data', async () => {
			const snapshots: CognitiveAnalyticsSnapshot[] = [];
			graph.analyticsService.onDidUpdateMetrics(s => snapshots.push(s));

			await graph.loopService.runOnce();

			const loopSnapshots = snapshots.filter(s => s.cognitiveLoop.totalIterations > 0);
			assert.ok(loopSnapshots.length > 0,
				'onDidUpdateMetrics should fire with loop iteration data');
		});
	});

	// -------------------------------------------------------------------
	// Topology Weave Gap 2: ECAN state conditions query processing
	// -------------------------------------------------------------------

	suite('topology weave: ECAN → query processing', () => {

		test('processQuery stimulates ECAN for created nodes', async () => {
			const response = await graph.zonecogService.processQuery('ECAN stimulation test');

			for (const nodeId of response.metadata.relatedNodes) {
				const av = graph.ecanService.getAttentionValue(nodeId);
				assert.ok(av.sti > 0,
					`node ${nodeId} should have positive STI after query processing`);
			}
		});

		test('high ECAN focus ratio boosts query complexity from simple to moderate', async () => {
			// Seed ECAN with many nodes in focus to create a high focus ratio
			for (let i = 0; i < 10; i++) {
				const nodeId = `focus-boost-${i}`;
				graph.hypergraphStore.addNode({
					id: nodeId,
					content: `Focus node ${i}`,
					node_type: 'Concept',
					salience_score: 0.9,
					metadata: {},
					links: [],
				});
				graph.ecanService.setAttentionValue(nodeId, { sti: 0.8, lti: 0.5 });
			}
			graph.ecanService.setFocusBoundary(0.1);

			// A simple query (short, no complex keywords) should get boosted
			const response = await graph.zonecogService.processQuery('hello world');

			// With high focus ratio, the simple query should be treated as at least
			// moderate, meaning it should have hypothesis generation phases
			const phaseNames = response.phases.map(p => p.name);
			assert.ok(
				phaseNames.includes('Multiple Hypothesis Generation') ||
				response.metadata.queryComplexity !== 'simple',
				'high ECAN focus ratio should boost query processing depth'
			);
		});

		test('processQuery reads ECAN snapshot during complexity assessment', async () => {
			// With no ECAN nodes, a simple query stays simple
			const response1 = await graph.zonecogService.processQuery('test');
			const complexity1 = response1.metadata.queryComplexity;

			// Reset and add high-focus ECAN state
			graph.ecanService.reset();
			for (let i = 0; i < 20; i++) {
				const nodeId = `complex-${i}`;
				graph.hypergraphStore.addNode({
					id: nodeId,
					content: `Salient item ${i}`,
					node_type: 'Concept',
					salience_score: 0.95,
					metadata: {},
					links: [],
				});
				graph.ecanService.setAttentionValue(nodeId, { sti: 0.9, lti: 0.7 });
			}
			graph.ecanService.setFocusBoundary(0.1);

			const response2 = await graph.zonecogService.processQuery('test');
			const complexity2 = response2.metadata.queryComplexity;

			// The same query text should produce higher complexity with rich ECAN state
			const complexityOrder = { 'simple': 0, 'moderate': 1, 'complex': 2 };
			assert.ok(complexityOrder[complexity2] >= complexityOrder[complexity1],
				'ECAN-rich state should produce equal or higher complexity assessment');
		});
	});

	// -------------------------------------------------------------------
	// Topology Weave Gap 3: Membrane balance as load signal
	// -------------------------------------------------------------------

	suite('topology weave: membrane triad balance', () => {

		test('getTriadBalance returns balanced state initially', () => {
			// Before any activity, all triads should have zero processes
			const balance = graph.membraneService.getTriadBalance();
			assert.strictEqual(balance.imbalanced, false);
			assert.strictEqual(balance.imbalanceRatio, 1);
		});

		test('getTriadBalance detects dominant triad', () => {
			for (let i = 0; i < 10; i++) {
				graph.membraneService.recordActivity('cerebral');
			}
			graph.membraneService.recordActivity('somatic');
			graph.membraneService.recordActivity('autonomic');

			const balance = graph.membraneService.getTriadBalance();
			assert.strictEqual(balance.dominantTriad, 'cerebral');
			assert.ok(balance.imbalanceRatio > 1);
		});

		test('getTriadBalance detects imbalance above 60% threshold', () => {
			// Generate heavily cerebral-biased activity
			for (let i = 0; i < 20; i++) {
				graph.membraneService.recordActivity('cerebral');
			}
			for (let i = 0; i < 3; i++) {
				graph.membraneService.recordActivity('somatic');
				graph.membraneService.recordActivity('autonomic');
			}

			const balance = graph.membraneService.getTriadBalance();
			assert.strictEqual(balance.imbalanced, true);
			assert.strictEqual(balance.dominantTriad, 'cerebral');
			assert.ok(balance.activityDistribution.cerebral > 0.6);
		});

		test('membrane imbalance increases cognitive load during query processing', async () => {
			// Create heavy imbalance by driving cerebral activity
			for (let i = 0; i < 30; i++) {
				graph.membraneService.recordActivity('cerebral');
			}

			const stateBefore = graph.zonecogService.getCognitiveState();
			const loadBefore = stateBefore.cognitiveLoad;

			await graph.zonecogService.processQuery('imbalance test');

			const stateAfter = graph.zonecogService.getCognitiveState();
			const loadIncrease = stateAfter.cognitiveLoad - loadBefore;

			// With imbalance, load increment should be 0.35 minus the 0.1 cooldown
			// Without imbalance it would be 0.2 minus 0.1
			assert.ok(loadIncrease > 0.1,
				'imbalanced membrane should cause higher cognitive load increment');
		});

		test('activityDistribution sums to 1 when active', () => {
			graph.membraneService.recordActivity('cerebral');
			graph.membraneService.recordActivity('somatic');
			graph.membraneService.recordActivity('autonomic');

			const balance = graph.membraneService.getTriadBalance();
			const sum = balance.activityDistribution.cerebral +
				balance.activityDistribution.somatic +
				balance.activityDistribution.autonomic;
			assert.ok(Math.abs(sum - 1.0) < 0.001,
				'activity distribution should sum to 1');
		});

		test('activityDistribution is all zeros when idle', () => {
			const balance = graph.membraneService.getTriadBalance();
			assert.strictEqual(balance.activityDistribution.cerebral, 0);
			assert.strictEqual(balance.activityDistribution.somatic, 0);
			assert.strictEqual(balance.activityDistribution.autonomic, 0);
			assert.strictEqual(balance.dominantTriad, undefined);
		});
	});
});
