/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IAAROrchestrationService, AARRelationType } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { AAROrchestrationService, BUILTIN_AGENT_IDS } from 'sql/workbench/services/zonecog/browser/aarOrchestrationService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { ICognitiveLoopService } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { CognitiveLoopService } from 'sql/workbench/services/zonecog/browser/cognitiveLoopService';
import { IZoneCogService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('AAR Orchestration Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let aarService: IAAROrchestrationService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		const hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const llmService = instantiationService.createInstance(LLMProviderService);
		instantiationService.stub(ILLMProviderService, llmService);

		const embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		const ecanService = instantiationService.createInstance(ECANAttentionService);
		instantiationService.stub(IECANAttentionService, ecanService);

		const workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
		instantiationService.stub(ICognitiveWorkspaceService, workspaceService);

		const loopService = instantiationService.createInstance(CognitiveLoopService);
		instantiationService.stub(ICognitiveLoopService, loopService);

		const zonecogService = instantiationService.createInstance(ZoneCogService);
		instantiationService.stub(IZoneCogService, zonecogService);

		aarService = instantiationService.createInstance(AAROrchestrationService);
	});

	test('should register 6 built-in agents at startup', () => {
		const agents = aarService.getAllAgents();
		assert.strictEqual(agents.length, 6, 'Should have 6 built-in agents');

		const agentIds = agents.map(a => a.id);
		assert.ok(agentIds.includes(BUILTIN_AGENT_IDS.PERCEIVER));
		assert.ok(agentIds.includes(BUILTIN_AGENT_IDS.ATTENDER));
		assert.ok(agentIds.includes(BUILTIN_AGENT_IDS.THINKER));
		assert.ok(agentIds.includes(BUILTIN_AGENT_IDS.ACTOR));
		assert.ok(agentIds.includes(BUILTIN_AGENT_IDS.REFLECTOR));
		assert.ok(agentIds.includes(BUILTIN_AGENT_IDS.ORCHESTRATOR));
	});

	test('should have pre-wired relations for the default pipeline', () => {
		const perceiverRelations = aarService.getRelationsFrom(BUILTIN_AGENT_IDS.PERCEIVER);
		assert.ok(perceiverRelations.length > 0, 'Perceiver should have outgoing relations');
		assert.ok(
			perceiverRelations.some(r => r.targetAgentId === BUILTIN_AGENT_IDS.ATTENDER),
			'Perceiver should feed into Attender'
		);
	});

	test('should register and retrieve a custom agent', () => {
		const ok = aarService.registerAgent({
			id: 'custom-test-agent',
			name: 'Custom Test Agent',
			role: 'custom',
			capabilities: ['test', 'custom'],
			active: true,
		});
		assert.ok(ok);

		const agent = aarService.getAgent('custom-test-agent');
		assert.ok(agent);
		assert.strictEqual(agent!.name, 'Custom Test Agent');
		assert.strictEqual(agent!.totalTasksProcessed, 0);
	});

	test('should not register duplicate agents', () => {
		const ok1 = aarService.registerAgent({
			id: 'dup-agent', name: 'Dup', role: 'custom', capabilities: [], active: true,
		});
		const ok2 = aarService.registerAgent({
			id: 'dup-agent', name: 'Dup2', role: 'custom', capabilities: [], active: true,
		});
		assert.ok(ok1);
		assert.ok(!ok2);
	});

	test('should define and remove relations', () => {
		aarService.registerAgent({ id: 'src', name: 'Src', role: 'custom', capabilities: [], active: true });
		aarService.registerAgent({ id: 'tgt', name: 'Tgt', role: 'custom', capabilities: [], active: true });

		const ok = aarService.defineRelation({
			id: 'src→tgt',
			sourceAgentId: 'src',
			targetAgentId: 'tgt',
			relationType: 'feeds-into' as AARRelationType,
			weight: 0.8,
			active: true,
		});
		assert.ok(ok);

		const rels = aarService.getRelationsFrom('src');
		assert.ok(rels.some(r => r.targetAgentId === 'tgt'));

		const removed = aarService.removeRelation('src→tgt');
		assert.ok(removed);
		assert.strictEqual(aarService.getRelationsFrom('src').length, 0);
	});

	test('should orchestrate a task through the default pipeline', async () => {
		const result = await aarService.orchestrate({
			description: 'Test orchestration task',
			payload: 'Hello from the test',
			requiredCapabilities: [],
			priority: 0.5,
		});

		assert.ok(result.success, `Task should succeed; error: ${result.error}`);
		assert.ok(result.agentPath.length > 0, 'Should have an agent path');
		assert.ok(result.totalDurationMs >= 0);
		assert.ok(result.task.id.startsWith('aar-task-'));
	});

	test('should increment agent task counters after orchestration', async () => {
		await aarService.orchestrate({
			description: 'Counter test',
			payload: 'test payload',
			requiredCapabilities: [],
			priority: 0.3,
		});

		// At least one agent in the pipeline should have processed the task
		const agents = aarService.getAllAgents();
		const totalProcessed = agents.reduce((s, a) => s + a.totalTasksProcessed, 0);
		assert.ok(totalProcessed > 0, 'At least one agent should have processed the task');
	});

	test('should track arena state counters', async () => {
		const before = aarService.getArenaState();
		await aarService.orchestrate({
			description: 'Arena counter test',
			payload: 'test',
			requiredCapabilities: [],
			priority: 0.5,
		});
		const after = aarService.getArenaState();

		assert.strictEqual(after.totalTasksOrchestrated, before.totalTasksOrchestrated + 1);
		assert.ok(after.successfulTasks >= before.successfulTasks);
	});

	test('should set and get shared Arena context', () => {
		aarService.setSharedContext('test-key', { value: 42 });
		const val = aarService.getSharedContext('test-key') as { value: number };
		assert.strictEqual(val.value, 42);
	});

	test('should reset arena counters and shared context', async () => {
		await aarService.orchestrate({
			description: 'Pre-reset task',
			payload: 'x',
			requiredCapabilities: [],
			priority: 0.5,
		});
		aarService.setSharedContext('x', 'y');

		aarService.reset();
		const state = aarService.getArenaState();
		assert.strictEqual(state.totalTasksOrchestrated, 0);
		assert.strictEqual(state.sharedContextKeys.length, 0);
	});

	test('should fire onDidCompleteTask event', async () => {
		let eventFired = false;
		aarService.onDidCompleteTask(() => { eventFired = true; });

		await aarService.orchestrate({
			description: 'Event test',
			payload: 'event payload',
			requiredCapabilities: [],
			priority: 0.5,
		});

		assert.ok(eventFired, 'onDidCompleteTask should fire after orchestration');
	});

	test('should set agent active status', () => {
		aarService.setAgentActive(BUILTIN_AGENT_IDS.PERCEIVER, false);
		const agent = aarService.getAgent(BUILTIN_AGENT_IDS.PERCEIVER);
		assert.strictEqual(agent!.active, false);

		aarService.setAgentActive(BUILTIN_AGENT_IDS.PERCEIVER, true);
		assert.strictEqual(aarService.getAgent(BUILTIN_AGENT_IDS.PERCEIVER)!.active, true);
	});

	test('should expire task if deadline is in the past', async () => {
		const result = await aarService.orchestrate({
			description: 'Expired task',
			payload: 'past deadline',
			requiredCapabilities: [],
			priority: 0.5,
			deadline: Date.now() - 1000, // already expired
		});

		assert.ok(!result.success, 'Expired task should fail');
		assert.ok(result.error?.includes('expired'));
	});

	// --- Distributed AAR Orchestration Tests (Phase C.3: FlareCog) ---

	function remoteNode(id: string, name: string, address: string, online = true) {
		return {
			id,
			name,
			address,
			online,
			lastHeartbeat: Date.now(),
			maxAgents: 10,
		};
	}

	test('should have empty remote nodes initially', () => {
		const nodes = aarService.getRemoteNodes();
		assert.strictEqual(nodes.length, 0);
	});

	test('should register remote cognitive node', () => {
		const ok = aarService.registerRemoteNode(remoteNode('remote-node-1', 'Remote Node 1', 'remote-host:8765'));
		assert.ok(ok);

		const nodes = aarService.getRemoteNodes();
		assert.strictEqual(nodes.length, 1);
		assert.strictEqual(nodes[0].id, 'remote-node-1');
		assert.strictEqual(nodes[0].name, 'Remote Node 1');
		assert.strictEqual(nodes[0].online, true);
		assert.deepStrictEqual(nodes[0].hostedAgents, []);
		assert.strictEqual(nodes[0].load, 0);
	});

	test('should not register duplicate remote nodes', () => {
		const node = remoteNode('remote-node-1', 'Remote Node 1', 'remote-host:8765');
		assert.ok(aarService.registerRemoteNode(node));
		assert.ok(!aarService.registerRemoteNode(node));
		assert.strictEqual(aarService.getRemoteNodes().length, 1);
	});

	test('should unregister remote cognitive node', () => {
		aarService.registerRemoteNode(remoteNode('remote-node-1', 'Remote Node 1', 'remote-host:8765'));
		assert.ok(aarService.unregisterRemoteNode('remote-node-1'));
		assert.strictEqual(aarService.getRemoteNodes().length, 0);
	});

	test('should spawn remote agent', async () => {
		aarService.registerRemoteNode(remoteNode('remote-node-1', 'Remote Node 1', 'remote-host:8765'));

		const result = await aarService.spawnRemoteAgent({
			targetNodeId: 'remote-node-1',
			priority: 0.7,
			agent: {
				id: 'remote-agent-1',
				name: 'Remote Agent 1',
				role: 'custom',
				capabilities: ['test'],
				active: true,
			},
		});

		assert.ok(result.success);
		assert.ok(result.agent);
		assert.strictEqual(result.agent!.id, 'remote-agent-1');
		assert.strictEqual(result.agent!.hostNodeId, 'remote-node-1');
		assert.strictEqual(result.nodeId, 'remote-node-1');
	});

	test('should fail when spawning agent on unknown node', async () => {
		const result = await aarService.spawnRemoteAgent({
			targetNodeId: 'unknown-node',
			priority: 0.5,
			agent: {
				id: 'remote-agent-1',
				name: 'Remote Agent 1',
				role: 'custom',
				capabilities: ['test'],
				active: true,
			},
		});

		assert.strictEqual(result.success, false);
		assert.ok(result.error);
	});

	test('should fail when spawning agent on offline node', async () => {
		aarService.registerRemoteNode(remoteNode('offline-node', 'Offline', 'host:1', false));
		const result = await aarService.spawnRemoteAgent({
			targetNodeId: 'offline-node',
			priority: 0.5,
			agent: {
				id: 'remote-agent-1',
				name: 'Remote Agent 1',
				role: 'custom',
				capabilities: [],
				active: true,
			},
		});
		assert.strictEqual(result.success, false);
	});

	test('should get remote agents', async () => {
		aarService.registerRemoteNode(remoteNode('remote-node-1', 'Remote Node 1', 'remote-host:8765'));

		await aarService.spawnRemoteAgent({
			targetNodeId: 'remote-node-1',
			priority: 0.5,
			agent: {
				id: 'remote-agent-1',
				name: 'Remote Agent 1',
				role: 'custom',
				capabilities: [],
				active: true,
			},
		});

		const agents = aarService.getRemoteAgents();
		assert.strictEqual(agents.length, 1);
		assert.strictEqual(agents[0].id, 'remote-agent-1');
		assert.strictEqual(agents[0].hostNodeId, 'remote-node-1');
	});

	test('should migrate agent between nodes', async () => {
		aarService.registerRemoteNode(remoteNode('node-1', 'Node 1', 'host1:8765'));
		aarService.registerRemoteNode(remoteNode('node-2', 'Node 2', 'host2:8766'));

		await aarService.spawnRemoteAgent({
			targetNodeId: 'node-1',
			priority: 0.5,
			agent: {
				id: 'migrating-agent',
				name: 'Migrating Agent',
				role: 'custom',
				capabilities: [],
				active: true,
			},
		});

		const result = await aarService.migrateAgent({
			agentId: 'migrating-agent',
			sourceNodeId: 'node-1',
			targetNodeId: 'node-2',
			reason: 'load-balancing',
		});

		assert.ok(result.success);
		assert.strictEqual(result.agentId, 'migrating-agent');
		assert.strictEqual(result.sourceNodeId, 'node-1');
		assert.strictEqual(result.targetNodeId, 'node-2');

		const agents = aarService.getRemoteAgents();
		assert.strictEqual(agents[0].hostNodeId, 'node-2');
	});

	test('should fail migration for unknown agent', async () => {
		aarService.registerRemoteNode(remoteNode('node-1', 'Node 1', 'host1:8765'));
		aarService.registerRemoteNode(remoteNode('node-2', 'Node 2', 'host2:8766'));

		const result = await aarService.migrateAgent({
			agentId: 'unknown-agent',
			sourceNodeId: 'node-1',
			targetNodeId: 'node-2',
			reason: 'manual',
		});

		assert.strictEqual(result.success, false);
		assert.ok(result.error);
	});

	test('should send message to remote agent', async () => {
		aarService.registerRemoteNode(remoteNode('remote-node-1', 'Remote Node 1', 'remote-host:8765'));

		await aarService.spawnRemoteAgent({
			targetNodeId: 'remote-node-1',
			priority: 0.5,
			agent: {
				id: 'remote-agent-1',
				name: 'Remote Agent 1',
				role: 'custom',
				capabilities: [],
				active: true,
			},
		});

		await aarService.sendAgentMessage({
			fromAgentId: BUILTIN_AGENT_IDS.ORCHESTRATOR,
			toAgentId: 'remote-agent-1',
			type: 'request',
			payload: { action: 'test' },
		});

		const stats = aarService.getDistributedStats();
		assert.ok(stats.messagesSent >= 1);
		assert.ok(stats.messagesReceived >= 1);
	});

	test('should propose consensus and accept votes', async () => {
		const voters = [BUILTIN_AGENT_IDS.THINKER, BUILTIN_AGENT_IDS.ACTOR];
		const proposal = await aarService.proposeConsensus(
			'decision',
			{ topic: 'test-decision', options: ['option-a', 'option-b'] },
			voters,
			0.5,
			5000
		);

		assert.ok(proposal.id.length > 0);
		assert.strictEqual(proposal.status, 'pending');
		assert.strictEqual(proposal.type, 'decision');
		assert.deepStrictEqual(proposal.voters, voters);
		assert.ok(proposal.votes instanceof Map);

		const pending = aarService.getPendingConsensusProposals();
		assert.ok(pending.some(p => p.id === proposal.id));

		assert.ok(aarService.voteOnConsensus(proposal.id, BUILTIN_AGENT_IDS.THINKER, true));
		assert.ok(aarService.voteOnConsensus(proposal.id, BUILTIN_AGENT_IDS.ACTOR, true));

		const resolvedPending = aarService.getPendingConsensusProposals();
		assert.ok(!resolvedPending.some(p => p.id === proposal.id));
	});

	test('should reject unauthorized consensus votes', async () => {
		const proposal = await aarService.proposeConsensus(
			'action',
			{ action: 'deploy' },
			[BUILTIN_AGENT_IDS.THINKER],
			1.0,
			5000
		);

		assert.strictEqual(
			aarService.voteOnConsensus(proposal.id, BUILTIN_AGENT_IDS.ACTOR, true),
			false
		);
	});

	test('should get distributed orchestration stats', () => {
		aarService.registerRemoteNode(remoteNode('remote-node-1', 'Remote Node 1', 'remote-host:8765'));

		const stats = aarService.getDistributedStats();
		assert.strictEqual(stats.remoteNodeCount, 1);
		assert.strictEqual(stats.onlineNodeCount, 1);
		assert.strictEqual(typeof stats.remoteAgentCount, 'number');
		assert.strictEqual(typeof stats.messagesSent, 'number');
		assert.strictEqual(typeof stats.consensusProposalsResolved, 'number');
	});

	test('should fire onDidChangeRemoteNode event', () => {
		let firedNode: unknown;
		aarService.onDidChangeRemoteNode(node => { firedNode = node; });

		aarService.registerRemoteNode(remoteNode('event-test-node', 'Event Test Node', 'event-host:8765'));
		assert.ok(firedNode);
	});

	test('should fire onDidChangeAgent when spawning remote agent', async () => {
		let firedAgent: unknown;
		aarService.onDidChangeAgent(agent => { firedAgent = agent; });

		aarService.registerRemoteNode(remoteNode('spawn-event-node', 'Spawn Event Node', 'spawn-host:8765'));

		await aarService.spawnRemoteAgent({
			targetNodeId: 'spawn-event-node',
			priority: 0.5,
			agent: {
				id: 'spawn-event-agent',
				name: 'Spawn Event Agent',
				role: 'custom',
				capabilities: [],
				active: true,
			},
		});

		assert.ok(firedAgent);
	});

	test('should fire onDidResolveConsensus event', async () => {
		let firedResult: unknown;
		aarService.onDidResolveConsensus(result => { firedResult = result; });

		const proposal = await aarService.proposeConsensus(
			'decision',
			{ topic: 'event-test' },
			[BUILTIN_AGENT_IDS.THINKER],
			1.0,
			5000
		);

		aarService.voteOnConsensus(proposal.id, BUILTIN_AGENT_IDS.THINKER, true);
		assert.ok(firedResult);
	});

	test('should fire onDidMigrateAgent event', async () => {
		let firedMigration: unknown;
		aarService.onDidMigrateAgent(result => { firedMigration = result; });

		aarService.registerRemoteNode(remoteNode('node-a', 'Node A', 'a:1'));
		aarService.registerRemoteNode(remoteNode('node-b', 'Node B', 'b:2'));

		await aarService.spawnRemoteAgent({
			targetNodeId: 'node-a',
			priority: 0.5,
			agent: {
				id: 'migrate-event-agent',
				name: 'Migrate Event Agent',
				role: 'custom',
				capabilities: [],
				active: true,
			},
		});

		await aarService.migrateAgent({
			agentId: 'migrate-event-agent',
			sourceNodeId: 'node-a',
			targetNodeId: 'node-b',
			reason: 'optimization',
		});

		assert.ok(firedMigration);
	});

	test('should list online remote nodes only', () => {
		aarService.registerRemoteNode(remoteNode('online-node', 'Online', 'on:1', true));
		aarService.registerRemoteNode(remoteNode('offline-node', 'Offline', 'off:1', false));

		const online = aarService.getOnlineRemoteNodes();
		assert.strictEqual(online.length, 1);
		assert.strictEqual(online[0].id, 'online-node');
	});
});
