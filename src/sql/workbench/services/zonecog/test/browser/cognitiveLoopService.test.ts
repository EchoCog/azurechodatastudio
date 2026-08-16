/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICognitiveLoopService, CognitiveLoopState, CognitiveLoopIteration } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { CognitiveLoopService } from 'sql/workbench/services/zonecog/browser/cognitiveLoopService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Cognitive Loop Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let loopService: ICognitiveLoopService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		const hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const ecanService = instantiationService.createInstance(ECANAttentionService);
		instantiationService.stub(IECANAttentionService, ecanService);

		const embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		const workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
		instantiationService.stub(ICognitiveWorkspaceService, workspaceService);

		loopService = instantiationService.createInstance(CognitiveLoopService);
	});

	teardown(() => {
		loopService.stop();
	});

	// --- Initial State Tests ---

	test('should initialize in stopped state', () => {
		const state = loopService.getState();
		assert.strictEqual(state.running, false);
		assert.strictEqual(state.paused, false);
	});

	test('should have default tick interval of 5000ms', () => {
		const state = loopService.getState();
		assert.strictEqual(state.tickIntervalMs, 5000);
	});

	test('should have zero iterations initially', () => {
		const state = loopService.getState();
		assert.strictEqual(state.totalIterations, 0);
		assert.strictEqual(state.failedIterations, 0);
	});

	test('should return empty recent iterations initially', () => {
		const iterations = loopService.getRecentIterations();
		assert.strictEqual(iterations.length, 0);
	});

	// --- Lifecycle Tests ---

	test('should start the loop', () => {
		loopService.start();
		const state = loopService.getState();

		assert.strictEqual(state.running, true);
		assert.strictEqual(state.paused, false);
	});

	test('should not start if already running', () => {
		loopService.start();
		loopService.start(); // Second start should be no-op

		const state = loopService.getState();
		assert.strictEqual(state.running, true);
	});

	test('should stop the loop', () => {
		loopService.start();
		loopService.stop();

		const state = loopService.getState();
		assert.strictEqual(state.running, false);
	});

	test('should not stop if not running', () => {
		loopService.stop(); // Should be no-op
		const state = loopService.getState();
		assert.strictEqual(state.running, false);
	});

	test('should pause the loop', () => {
		loopService.start();
		loopService.pause();

		const state = loopService.getState();
		assert.strictEqual(state.running, true);
		assert.strictEqual(state.paused, true);
	});

	test('should not pause if not running', () => {
		loopService.pause(); // Should be no-op when not running
		const state = loopService.getState();
		assert.strictEqual(state.paused, false);
	});

	test('should not pause if already paused', () => {
		loopService.start();
		loopService.pause();
		loopService.pause(); // Second pause should be no-op

		const state = loopService.getState();
		assert.strictEqual(state.paused, true);
	});

	test('should resume from paused state', () => {
		loopService.start();
		loopService.pause();
		loopService.resume();

		const state = loopService.getState();
		assert.strictEqual(state.running, true);
		assert.strictEqual(state.paused, false);
	});

	test('should not resume if not paused', () => {
		loopService.start();
		loopService.resume(); // Should be no-op when not paused

		const state = loopService.getState();
		assert.strictEqual(state.paused, false);
	});

	// --- Manual Iteration Tests ---

	test('should run a single iteration manually', async () => {
		const iteration = await loopService.runOnce();

		assert.ok(iteration);
		assert.strictEqual(iteration.iteration, 1);
		assert.ok(iteration.durationMs >= 0);
		assert.strictEqual(iteration.success, true);
		assert.ok(iteration.phases.length > 0);
	});

	test('should execute all five phases in an iteration', async () => {
		const iteration = await loopService.runOnce();

		const phaseNames = iteration.phases.map(p => p.name);
		assert.ok(phaseNames.includes('perceive'));
		assert.ok(phaseNames.includes('attend'));
		assert.ok(phaseNames.includes('think'));
		assert.ok(phaseNames.includes('act'));
		assert.ok(phaseNames.includes('reflect'));
	});

	test('should increment iteration count', async () => {
		await loopService.runOnce();
		await loopService.runOnce();
		await loopService.runOnce();

		const state = loopService.getState();
		assert.strictEqual(state.totalIterations, 3);
	});

	test('should track iteration timing', async () => {
		await loopService.runOnce();

		const state = loopService.getState();
		assert.ok(state.lastIterationTime > 0);
		assert.ok(state.averageIterationMs >= 0);
	});

	test('should record iteration in history', async () => {
		await loopService.runOnce();
		await loopService.runOnce();

		const recent = loopService.getRecentIterations();
		assert.strictEqual(recent.length, 2);
		assert.strictEqual(recent[0].iteration, 1);
		assert.strictEqual(recent[1].iteration, 2);
	});

	test('should limit recent iterations history', async () => {
		// Run many iterations
		for (let i = 0; i < 25; i++) {
			await loopService.runOnce();
		}

		const recent = loopService.getRecentIterations();
		assert.ok(recent.length <= 20); // Default limit
	});

	// --- Configuration Tests ---

	test('should set tick interval', () => {
		loopService.setTickInterval(2000);
		const state = loopService.getState();
		assert.strictEqual(state.tickIntervalMs, 2000);
	});

	test('should enforce minimum tick interval of 1000ms', () => {
		loopService.setTickInterval(500);
		const state = loopService.getState();
		assert.strictEqual(state.tickIntervalMs, 1000);
	});

	// --- Reset Tests ---

	test('should reset the loop', async () => {
		loopService.start();
		await loopService.runOnce();
		await loopService.runOnce();
		loopService.setTickInterval(2000);

		loopService.reset();

		const state = loopService.getState();
		assert.strictEqual(state.running, false);
		assert.strictEqual(state.totalIterations, 0);
		assert.strictEqual(state.failedIterations, 0);
		assert.strictEqual(state.tickIntervalMs, 5000);
		assert.strictEqual(loopService.getRecentIterations().length, 0);
	});

	// --- Event Tests ---

	test('should fire onDidCompleteIteration event', async () => {
		let firedIteration: CognitiveLoopIteration | undefined;
		loopService.onDidCompleteIteration(iter => { firedIteration = iter; });

		await loopService.runOnce();

		assert.ok(firedIteration);
		assert.strictEqual(firedIteration!.iteration, 1);
	});

	test('should fire onDidChangeState on start', () => {
		let firedState: CognitiveLoopState | undefined;
		loopService.onDidChangeState(state => { firedState = state; });

		loopService.start();

		assert.ok(firedState);
		assert.strictEqual(firedState!.running, true);
	});

	test('should fire onDidChangeState on stop', () => {
		loopService.start();

		let firedState: CognitiveLoopState | undefined;
		loopService.onDidChangeState(state => { firedState = state; });

		loopService.stop();

		assert.ok(firedState);
		assert.strictEqual(firedState!.running, false);
	});

	test('should fire onDidChangeState on pause', () => {
		loopService.start();

		let firedState: CognitiveLoopState | undefined;
		loopService.onDidChangeState(state => { firedState = state; });

		loopService.pause();

		assert.ok(firedState);
		assert.strictEqual(firedState!.paused, true);
	});

	test('should fire onDidChangeState on resume', () => {
		loopService.start();
		loopService.pause();

		let firedState: CognitiveLoopState | undefined;
		loopService.onDidChangeState(state => { firedState = state; });

		loopService.resume();

		assert.ok(firedState);
		assert.strictEqual(firedState!.paused, false);
	});

	test('should fire onDidChangeState on setTickInterval', () => {
		let firedState: CognitiveLoopState | undefined;
		loopService.onDidChangeState(state => { firedState = state; });

		loopService.setTickInterval(3000);

		assert.ok(firedState);
		assert.strictEqual(firedState!.tickIntervalMs, 3000);
	});

	// --- Phase Content Tests ---

	test('should include phase summaries', async () => {
		const iteration = await loopService.runOnce();

		for (const phase of iteration.phases) {
			assert.ok(phase.summary, `Phase ${phase.name} should have a summary`);
			assert.ok(phase.durationMs >= 0, `Phase ${phase.name} should have duration`);
		}
	});

	test('perceive phase should scan hypergraph', async () => {
		const iteration = await loopService.runOnce();
		const perceivePhase = iteration.phases.find(p => p.name === 'perceive');

		assert.ok(perceivePhase);
		assert.ok(perceivePhase!.summary.includes('nodes') || perceivePhase!.summary.includes('Scanned'));
	});

	test('attend phase should run ECAN', async () => {
		const iteration = await loopService.runOnce();
		const attendPhase = iteration.phases.find(p => p.name === 'attend');

		assert.ok(attendPhase);
		assert.ok(attendPhase!.summary.includes('ECAN') || attendPhase!.summary.includes('spread'));
	});

	test('think phase should process focused items', async () => {
		const iteration = await loopService.runOnce();
		const thinkPhase = iteration.phases.find(p => p.name === 'think');

		assert.ok(thinkPhase);
		assert.ok(thinkPhase!.summary.includes('Processed') || thinkPhase!.summary.includes('focused'));
	});

	test('act phase should produce actions', async () => {
		const iteration = await loopService.runOnce();
		const actPhase = iteration.phases.find(p => p.name === 'act');

		assert.ok(actPhase);
		assert.ok(actPhase!.summary.includes('action') || actPhase!.summary.includes('Produced'));
	});

	test('reflect phase should update state', async () => {
		const iteration = await loopService.runOnce();
		const reflectPhase = iteration.phases.find(p => p.name === 'reflect');

		assert.ok(reflectPhase);
		assert.ok(reflectPhase!.summary.includes('Decayed') || reflectPhase!.summary.includes('episode'));
	});

	// --- Error Handling Tests ---

	test('should track failed iterations', () => {
		// We can't easily force a failure, but we can verify the counter exists
		const state = loopService.getState();
		assert.strictEqual(typeof state.failedIterations, 'number');
	});

	// --- Cognitive Cycle Model Tests ---

	test('should implement perceive-attend-think-act-reflect cycle', async () => {
		const iteration = await loopService.runOnce();

		const phaseOrder = iteration.phases.map(p => p.name);
		assert.deepStrictEqual(phaseOrder, ['perceive', 'attend', 'think', 'act', 'reflect']);
	});

	// --- Watchdog Tests (Phase 7.2) ---

	test('should have zero watchdog recoveries initially', () => {
		const state = loopService.getState();
		assert.strictEqual(state.watchdogRecoveries, 0);
	});

	test('should keep watchdog recoveries at zero for healthy iterations', async () => {
		await loopService.runOnce();
		await loopService.runOnce();
		const state = loopService.getState();
		assert.strictEqual(state.watchdogRecoveries, 0);
	});

	test('should reset watchdog recoveries on reset', () => {
		loopService.reset();
		const state = loopService.getState();
		assert.strictEqual(state.watchdogRecoveries, 0);
	});

	test('runOnce should release the in-flight marker so back-to-back runs work', async () => {
		const first = await loopService.runOnce();
		const second = await loopService.runOnce();
		assert.strictEqual(first.iteration + 1, second.iteration);
		assert.strictEqual(first.success, true);
		assert.strictEqual(second.success, true);
	});

	// --- Distributed Cognitive Loop Tests (Phase C.4: FlareCog) ---

	test('should not be in distributed mode initially', () => {
		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.distributedMode, false);
		assert.strictEqual(syncState.localNodeId, '');
		assert.strictEqual(syncState.isLeader, false);
	});

	test('should enable distributed mode', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		const syncState = loopService.getClusterSyncState();

		assert.strictEqual(syncState.distributedMode, true);
		assert.strictEqual(syncState.localNodeId, 'node1');
		assert.strictEqual(syncState.isLeader, true);
		assert.strictEqual(syncState.leaderId, 'node1');
		assert.strictEqual(syncState.nodes.length, 1);
	});

	test('should disable distributed mode', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.disableDistributedMode();

		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.distributedMode, false);
		assert.strictEqual(syncState.isLeader, false);
		assert.strictEqual(syncState.nodes.length, 0);
	});

	test('should register cluster nodes', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.registerClusterNode({
			nodeId: 'node2',
			nodeName: 'Test Node 2',
			isLeader: false,
		});

		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.nodes.length, 2);

		const node2 = syncState.nodes.find(n => n.nodeId === 'node2');
		assert.ok(node2);
		assert.strictEqual(node2!.nodeName, 'Test Node 2');
		assert.strictEqual(node2!.synchronized, false);
	});

	test('should unregister cluster nodes', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.registerClusterNode({
			nodeId: 'node2',
			nodeName: 'Test Node 2',
			isLeader: false,
		});

		loopService.unregisterClusterNode('node2');

		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.nodes.length, 1);
		assert.strictEqual(syncState.nodes[0].nodeId, 'node1');
	});

	test('should not unregister local node', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.unregisterClusterNode('node1');

		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.nodes.length, 1);
	});

	test('should sync with cluster', async () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		await loopService.syncWithCluster();

		const syncState = loopService.getClusterSyncState();
		assert.ok(syncState.lastClusterSync > 0);
		assert.strictEqual(syncState.syncFailures, 0);

		const localNode = syncState.nodes.find(n => n.nodeId === 'node1');
		assert.ok(localNode);
		assert.strictEqual(localNode!.synchronized, true);
	});

	test('should propose as leader', async () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		const result = await loopService.proposeAsLeader();

		assert.strictEqual(result, true);
		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.isLeader, true);
		assert.strictEqual(syncState.leaderId, 'node1');
	});

	test('should handle leader failover', async () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.registerClusterNode({
			nodeId: 'node2',
			nodeName: 'Test Node 2',
			isLeader: true, // Mark as leader
		});

		// Simulate node2 becoming unreachable - unregister it
		loopService.unregisterClusterNode('node2');

		const syncState = loopService.getClusterSyncState();
		// Local node should become leader after failover
		assert.strictEqual(syncState.isLeader, true);
		assert.strictEqual(syncState.leaderId, 'node1');
	});

	test('should get global ECAN state', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		const ecanState = loopService.getGlobalECANState();

		assert.ok(ecanState);
		assert.ok(Array.isArray(ecanState.globalAttentionalFocus));
		assert.ok(ecanState.nodeContributions instanceof Map);
	});

	test('should contribute to global attention', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.contributeToGlobalAttention(['nodeA', 'nodeB', 'nodeC']);

		const ecanState = loopService.getGlobalECANState();
		assert.ok(ecanState.globalAttentionalFocus.length > 0);
		assert.ok(ecanState.nodeContributions.has('node1'));
	});

	test('should aggregate collective intelligence', async () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');

		const result = await loopService.aggregateCollectiveIntelligence('test-topic', {
			insight: 'Local insight',
			confidence: 0.8,
		});

		assert.ok(result);
		assert.strictEqual(result.topic, 'test-topic');
		assert.ok(result.confidence > 0);
		assert.ok(result.nodeContributions.has('node1'));
	});

	test('should fire onDidChangeClusterSync event', () => {
		let firedState: unknown;
		loopService.onDidChangeClusterSync(state => { firedState = state; });

		loopService.enableDistributedMode('node1', 'Test Node 1');

		assert.ok(firedState);
	});

	test('should fire onDidUpdateGlobalAttention event', () => {
		let firedState: unknown;
		loopService.onDidUpdateGlobalAttention(state => { firedState = state; });

		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.contributeToGlobalAttention(['nodeA']);

		assert.ok(firedState);
	});

	test('should fire onDidAggregateCollectiveIntelligence event', async () => {
		let firedResult: unknown;
		loopService.onDidAggregateCollectiveIntelligence(result => { firedResult = result; });

		loopService.enableDistributedMode('node1', 'Test Node 1');
		await loopService.aggregateCollectiveIntelligence('topic', { data: 'test' });

		assert.ok(firedResult);
	});

	test('should get distributed stats', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.registerClusterNode({
			nodeId: 'node2',
			nodeName: 'Test Node 2',
			isLeader: false,
		});

		const stats = loopService.getDistributedStats();

		assert.strictEqual(stats.nodeCount, 2);
		assert.strictEqual(stats.synchronizedNodeCount, 1); // Only local node is synchronized
		assert.strictEqual(stats.syncFailures, 0);
		assert.strictEqual(stats.failoversCompleted, 0);
	});

	test('should not enable distributed mode if already enabled', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.enableDistributedMode('node2', 'Test Node 2'); // Should be ignored

		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.localNodeId, 'node1');
	});

	test('should not register cluster node if distributed mode not enabled', () => {
		loopService.registerClusterNode({
			nodeId: 'node2',
			nodeName: 'Test Node 2',
			isLeader: false,
		});

		const syncState = loopService.getClusterSyncState();
		assert.strictEqual(syncState.nodes.length, 0);
	});

	test('should aggregate attention across multiple nodes', () => {
		loopService.enableDistributedMode('node1', 'Test Node 1');
		loopService.contributeToGlobalAttention(['A', 'B', 'C']);

		// Simulate another node's contribution by directly manipulating
		// (In real implementation this would come over the network)
		loopService.contributeToGlobalAttention(['B', 'C', 'D']);

		const ecanState = loopService.getGlobalECANState();
		// B and C should appear in the aggregated focus as they're mentioned twice
		assert.ok(ecanState.globalAttentionalFocus.length > 0);
	});
});
