/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IAgiStudioService, StudioRun } from 'sql/workbench/services/zonecog/common/agiStudio';
import { AgiStudioService } from 'sql/workbench/services/zonecog/browser/agiStudioService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { ISQLAnalyzerAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { SQLAnalyzerAgent } from 'sql/workbench/services/zonecog/browser/sqlAnalyzerAgent';
import { ISchemaReasonerAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { SchemaReasonerAgent } from 'sql/workbench/services/zonecog/browser/schemaReasonerAgent';
import { IPerformanceAdvisorAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { PerformanceAdvisorAgent } from 'sql/workbench/services/zonecog/browser/performanceAdvisorAgent';
import { IDataPatternAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { DataPatternAgent } from 'sql/workbench/services/zonecog/browser/dataPatternAgent';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

suite('AGI Studio Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let service: IAgiStudioService;

	/** Helper: wait for a run to reach a terminal status via the event. */
	function waitForRunComplete(runId: string, timeoutMs = 10000): Promise<StudioRun> {
		return new Promise<StudioRun>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`Run ${runId} did not complete within ${timeoutMs}ms`)), timeoutMs);
			service.onDidChangeRun(run => {
				if (run.id === runId && (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped')) {
					clearTimeout(timer);
					resolve(run);
				}
			});
		});
	}

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		// Register real dependency instances (not mocks)
		const hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const llmService = instantiationService.createInstance(LLMProviderService);
		instantiationService.stub(ILLMProviderService, llmService);

		const workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
		instantiationService.stub(ICognitiveWorkspaceService, workspaceService);

		const sqlAgent = instantiationService.createInstance(SQLAnalyzerAgent);
		instantiationService.stub(ISQLAnalyzerAgent, sqlAgent);

		const schemaAgent = instantiationService.createInstance(SchemaReasonerAgent);
		instantiationService.stub(ISchemaReasonerAgent, schemaAgent);

		const perfAgent = instantiationService.createInstance(PerformanceAdvisorAgent);
		instantiationService.stub(IPerformanceAdvisorAgent, perfAgent);

		const dataAgent = instantiationService.createInstance(DataPatternAgent);
		instantiationService.stub(IDataPatternAgent, dataAgent);

		service = instantiationService.createInstance(AgiStudioService);
	});

	// -- Test 1: Service initialization --------------------------------------

	test('service should initialise with 7 built-in tools', () => {
		const tools = service.getTools();
		assert.ok(tools.length >= 7, `Expected ≥7 tools, got ${tools.length}`);

		const toolIds = tools.map(t => t.id);
		assert.ok(toolIds.includes('sql-analyze'), 'sql-analyze tool should be registered');
		assert.ok(toolIds.includes('schema-reason'), 'schema-reason tool should be registered');
		assert.ok(toolIds.includes('perf-advise'), 'perf-advise tool should be registered');
		assert.ok(toolIds.includes('data-pattern'), 'data-pattern tool should be registered');
		assert.ok(toolIds.includes('llm-reason'), 'llm-reason tool should be registered');
		assert.ok(toolIds.includes('memory-save'), 'memory-save tool should be registered');
		assert.ok(toolIds.includes('memory-recall'), 'memory-recall tool should be registered');
	});

	test('service should start with no active run', () => {
		assert.strictEqual(service.getActiveRun(), undefined, 'No active run expected initially');
		assert.strictEqual(service.getRuns().length, 0, 'No runs expected initially');
	});

	// -- Test 2: Tool registry -----------------------------------------------

	test('should support registering custom tools', () => {
		const initialCount = service.getTools().length;

		service.registerTool({
			id: 'custom-test-tool',
			name: 'Custom Test Tool',
			description: 'A test tool',
			invoke: async () => 'custom-result',
		});

		assert.strictEqual(service.getTools().length, initialCount + 1, 'Custom tool should be registered');

		// Registering the same ID again should be a no-op
		service.registerTool({
			id: 'custom-test-tool',
			name: 'Duplicate',
			description: 'Duplicate tool',
			invoke: async () => 'ignored',
		});

		assert.strictEqual(service.getTools().length, initialCount + 1, 'Duplicate tool should not increase count');
	});

	// -- Test 3: Run lifecycle -----------------------------------------------

	test('should complete a run with non-empty result', async () => {
		const completedP = waitForRunComplete('', 10000);
		let capturedRunId = '';

		const runStarted = new Promise<void>(resolve => {
			service.onDidSpawnAgent(() => resolve());
		});

		const run = await service.startRun('analyze sql query performance patterns');
		capturedRunId = run.id;

		assert.ok(run.id, 'Run should have an ID');
		assert.strictEqual(run.status, 'running', 'Run should start in running state');
		assert.strictEqual(run.goal, 'analyze sql query performance patterns');
		assert.ok(run.rootAgentId, 'Run should have a root agent ID');

		// Replace placeholder promise with actual run ID
		const completedRun = await waitForRunComplete(run.id, 10000);

		assert.strictEqual(completedRun.id, run.id, 'Completed run should have same ID');
		assert.strictEqual(completedRun.status, 'completed', 'Run should complete successfully');
		assert.ok(completedRun.result, 'Run should have a non-empty result');
		assert.ok(completedRun.result.length > 0, 'Result should have content');
		assert.ok(completedRun.endTime !== undefined, 'End time should be set');
		assert.ok(completedRun.endTime! >= run.startTime, 'End time should be after start time');

		// Suppress unused variable warning
		void runStarted;
		void capturedRunId;
		void completedP;
	});

	test('should return run in getRuns after completion', async () => {
		const run = await service.startRun('test run for history');
		await waitForRunComplete(run.id);

		const runs = service.getRuns();
		assert.ok(runs.length >= 1, 'getRuns should return at least one run');
		assert.ok(runs.some(r => r.id === run.id), 'The run should appear in getRuns');
	});

	// -- Test 4: Hierarchical spawning ---------------------------------------

	test('should spawn subordinate agents with correct superiorId and depth', async () => {
		const run = await service.startRun('analyze sql schema relationships in database');
		await waitForRunComplete(run.id);

		const agents = service.getAgents(run.id);
		assert.ok(agents.length >= 2, `Expected ≥2 agents, got ${agents.length}`);

		const root = agents.find(a => a.superiorId === undefined);
		assert.ok(root, 'Root agent with no superiorId should exist');
		assert.strictEqual(root!.depth, 0, 'Root agent should be at depth 0');
		assert.strictEqual(root!.role, 'orchestrator', 'Root agent should have orchestrator role');

		const subordinates = agents.filter(a => a.superiorId === root!.id);
		assert.ok(subordinates.length >= 1, 'At least one subordinate should be spawned');

		for (const sub of subordinates) {
			assert.strictEqual(sub.superiorId, root!.id, 'Subordinate should reference root as superior');
			assert.strictEqual(sub.depth, 1, 'Subordinates should be at depth 1');
		}
	});

	test('should enforce max total agent cap (8) per run', async () => {
		const run = await service.startRun('very complex analysis involving sql schema performance data patterns');
		await waitForRunComplete(run.id);

		const agents = service.getAgents(run.id);
		assert.ok(agents.length <= 8, `Agent count ${agents.length} should not exceed MAX_AGENTS_PER_RUN=8`);
	});

	// -- Test 5: Inter-agent messaging ---------------------------------------

	test('should produce task-assignment and result-report messages', async () => {
		const run = await service.startRun('analyze performance of SQL queries');
		await waitForRunComplete(run.id);

		const messages = service.getMessages(run.id);
		assert.ok(messages.length >= 2, `Expected ≥2 messages, got ${messages.length}`);

		const taskAssignments = messages.filter(m => m.messageType === 'task-assignment');
		const resultReports = messages.filter(m => m.messageType === 'result-report');

		assert.ok(taskAssignments.length >= 1, 'At least one task-assignment message expected');
		assert.ok(resultReports.length >= 1, 'At least one result-report message expected');

		// Task assignments should be from root to subordinates
		const agents = service.getAgents(run.id);
		const root = agents.find(a => a.superiorId === undefined);
		assert.ok(root, 'Root agent must exist');

		for (const ta of taskAssignments) {
			assert.strictEqual(ta.fromAgentId, root!.id, 'Task assignment from should be root');
			assert.ok(ta.content.length > 0, 'Task assignment content should not be empty');
		}

		// Result reports should be from subordinates to root
		for (const rr of resultReports) {
			assert.strictEqual(rr.toAgentId, root!.id, 'Result report to should be root');
			assert.ok(rr.content.length > 0, 'Result report content should not be empty');
		}
	});

	// -- Test 6: Tool calls --------------------------------------------------

	test('should record tool calls for agent tasks', async () => {
		const run = await service.startRun('analyze sql query structure and performance');
		await waitForRunComplete(run.id);

		const toolCalls = service.getToolCalls(run.id);
		assert.ok(toolCalls.length >= 2, `Expected ≥2 tool calls, got ${toolCalls.length}`);

		for (const tc of toolCalls) {
			assert.ok(tc.toolId, 'Tool call should have toolId');
			assert.ok(tc.agentId, 'Tool call should have agentId');
			assert.ok(tc.input.length > 0, 'Tool call input should not be empty');
			assert.ok(tc.output.length > 0, 'Tool call output should not be empty');
			assert.ok(tc.durationMs >= 0, 'Duration should be non-negative');
			assert.ok(tc.timestamp > 0, 'Timestamp should be set');
		}
	});

	// -- Test 7: Agent-local memory ------------------------------------------

	test('should save and recall agent-local memory via memory tools', async () => {
		const memSaveTool = service.getTools().find(t => t.id === 'memory-save');
		const memRecallTool = service.getTools().find(t => t.id === 'memory-recall');

		assert.ok(memSaveTool, 'memory-save tool should exist');
		assert.ok(memRecallTool, 'memory-recall tool should exist');

		// Create a mock agent
		const mockAgent = {
			id: 'test-agent-memory',
			name: 'Test Agent',
			role: 'llm-reasoner' as const,
			superiorId: undefined,
			subordinateIds: [],
			status: 'idle' as const,
			depth: 0,
			systemPrompt: 'test',
			createdAt: Date.now(),
			localMemory: [],
		};

		// Save a key-value pair
		const saveResult = await memSaveTool!.invoke('analysis-result::SQL performance degradation detected', mockAgent);
		assert.ok(saveResult.includes('Saved'), 'Save should confirm success');

		// Verify the agent's local memory was updated
		assert.ok(mockAgent.localMemory.length >= 1, 'Agent local memory should have one entry');
		assert.strictEqual(mockAgent.localMemory[0].key, 'analysis-result', 'Key should match');
		assert.ok(mockAgent.localMemory[0].value.includes('SQL'), 'Value should contain saved content');

		// Recall by keyword
		const recallResult = await memRecallTool!.invoke('analysis', mockAgent);
		assert.ok(recallResult.length > 0, 'Recall should return non-empty result');
		assert.ok(!recallResult.startsWith('No memories found'), 'Should find memory by keyword');
	});

	// -- Test 8: Hypergraph persistence -------------------------------------

	test('should persist run, agent, and message nodes to hypergraph', async () => {
		const hypergraphStore = instantiationService.get(IHypergraphStore);
		const nodesBefore = hypergraphStore.getAllNodes().length;

		const run = await service.startRun('schema analysis for persistence test');
		await waitForRunComplete(run.id);

		const allNodes = hypergraphStore.getAllNodes();
		assert.ok(allNodes.length > nodesBefore, 'Nodes should be added to hypergraph');

		const runNodes = hypergraphStore.getNodesByType('agiStudio.run');
		const agentNodes = hypergraphStore.getNodesByType('agiStudio.agent');
		const messageNodes = hypergraphStore.getNodesByType('agiStudio.message');
		const toolCallNodes = hypergraphStore.getNodesByType('agiStudio.toolCall');

		assert.ok(runNodes.length >= 1, 'At least one agiStudio.run node expected');
		assert.ok(agentNodes.length >= 2, 'At least two agiStudio.agent nodes expected');
		assert.ok(messageNodes.length >= 2, 'At least two agiStudio.message nodes expected');
		assert.ok(toolCallNodes.length >= 1, 'At least one agiStudio.toolCall node expected');

		// Verify run node metadata
		const runNode = runNodes.find(n => n.metadata['runId'] === run.id);
		assert.ok(runNode, 'Run node should have runId in metadata');
		assert.strictEqual(runNode!.metadata['status'], 'completed', 'Run node status should be completed');

		// Verify agent node metadata
		const agentNode = agentNodes.find(n => n.metadata['runId'] === run.id);
		assert.ok(agentNode, 'Agent node should reference runId');
		assert.ok(agentNode!.metadata['role'], 'Agent node should have role in metadata');
	});

	// -- Test 9: Membrane activity ------------------------------------------

	test('should record membrane activity during run', async () => {
		const membraneService = instantiationService.get(ICognitiveMembraneService);

		const cerebralBefore = membraneService.getActivity('cerebral');
		const somaticBefore = membraneService.getActivity('somatic');

		const run = await service.startRun('test membrane activity recording');
		await waitForRunComplete(run.id);

		const cerebralAfter = membraneService.getActivity('cerebral');
		const somaticAfter = membraneService.getActivity('somatic');

		assert.ok(cerebralAfter > cerebralBefore, 'Cerebral membrane should have activity > before');
		assert.ok(somaticAfter > somaticBefore, 'Somatic membrane should have activity > before');
	});

	// -- Test 10: Event firing -----------------------------------------------

	test('should fire onDidSpawnAgent for each spawned agent', async () => {
		const spawnedAgentIds: string[] = [];
		service.onDidSpawnAgent(agent => spawnedAgentIds.push(agent.id));

		const run = await service.startRun('analyze data patterns in schema');
		await waitForRunComplete(run.id);

		const agents = service.getAgents(run.id);
		assert.ok(spawnedAgentIds.length >= 2, `Expected ≥2 spawned events, got ${spawnedAgentIds.length}`);

		// All spawned agent IDs should match actual agents
		for (const id of spawnedAgentIds) {
			assert.ok(agents.some(a => a.id === id), `Spawned agent ${id} should be in agent list`);
		}
	});

	test('should fire onDidSendMessage for each inter-agent message', async () => {
		const receivedMessages: Array<{ from: string; to: string; type: string }> = [];
		service.onDidSendMessage(msg => receivedMessages.push({
			from: msg.fromAgentId,
			to: msg.toAgentId,
			type: msg.messageType,
		}));

		const run = await service.startRun('analyze sql query structure');
		await waitForRunComplete(run.id);

		assert.ok(receivedMessages.length >= 2, `Expected ≥2 message events, got ${receivedMessages.length}`);

		const hasTaskAssignment = receivedMessages.some(m => m.type === 'task-assignment');
		const hasResultReport = receivedMessages.some(m => m.type === 'result-report');

		assert.ok(hasTaskAssignment, 'onDidSendMessage should fire for task-assignment');
		assert.ok(hasResultReport, 'onDidSendMessage should fire for result-report');
	});

	// -- Test 11: stopRun behavior -------------------------------------------

	test('should mark run as stopped immediately when stopRun is called', async () => {
		// Collect events
		const stateChanges: string[] = [];
		service.onDidChangeRun(run => stateChanges.push(run.status));

		const run = await service.startRun('long analysis task to be stopped');

		// Stop immediately (before async execution can complete)
		service.stopRun(run.id);

		// The run should already be marked stopped
		const runs = service.getRuns();
		const stoppedRun = runs.find(r => r.id === run.id);
		assert.ok(stoppedRun, 'Run should still exist after stopping');
		assert.strictEqual(stoppedRun!.status, 'stopped', 'Run should be stopped immediately');

		// Active run should be cleared
		assert.strictEqual(service.getActiveRun(), undefined, 'No active run after stop');

		// Events should include 'stopped' state
		assert.ok(stateChanges.includes('stopped'), 'stopped event should be fired');
	});

	test('stopRun on non-existent ID should be a no-op', () => {
		assert.doesNotThrow(() => service.stopRun('non-existent-run-id'), 'Should not throw for unknown run');
		assert.doesNotThrow(() => service.stopRun(), 'Should not throw when no active run');
	});

	test('stopped run must never be resurrected to completed or failed', async () => {
		const run = await service.startRun('long analysis task stopped mid-flight');
		service.stopRun(run.id);

		// Let the in-flight async executor fully settle past synthesis/error paths
		await new Promise<void>(resolve => setTimeout(resolve, 250));

		const settled = service.getRuns().find(r => r.id === run.id);
		assert.ok(settled, 'Run should still exist after executor settles');
		assert.strictEqual(settled!.status, 'stopped', 'Status must remain stopped after executor settles');
		assert.strictEqual(service.getActiveRun(), undefined, 'No active run after stop');

		// A subsequent run must start cleanly despite the earlier stop
		const next = await service.startRun('follow-up goal after stop');
		const completed = await waitForRunComplete(next.id);
		assert.strictEqual(completed.status, 'completed', 'Follow-up run should complete normally');
	});

	// -- Test 12: Multiple runs ----------------------------------------------

	test('should handle multiple sequential runs and maintain history', async () => {
		const run1 = await service.startRun('first analysis goal');
		await waitForRunComplete(run1.id);

		const run2 = await service.startRun('second analysis goal');
		await waitForRunComplete(run2.id);

		const allRuns = service.getRuns();
		assert.ok(allRuns.length >= 2, 'Should have at least 2 runs in history');
		assert.ok(allRuns.some(r => r.id === run1.id), 'First run should be in history');
		assert.ok(allRuns.some(r => r.id === run2.id), 'Second run should be in history');

		// Messages from different runs should be separate
		const msgs1 = service.getMessages(run1.id);
		const msgs2 = service.getMessages(run2.id);
		assert.ok(msgs1.length >= 1, 'First run should have messages');
		assert.ok(msgs2.length >= 1, 'Second run should have messages');

		// No cross-contamination of messages
		for (const m1 of msgs1) {
			assert.ok(!msgs2.some(m2 => m2.id === m1.id), 'Messages should not overlap between runs');
		}
	});
});
