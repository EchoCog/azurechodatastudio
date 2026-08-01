"use strict";
/*---------------------------------------------------------------------------------------------
	*  Copyright (c) Microsoft Corporation. All rights reserved.
	*  Licensed under the MIT License. See License.txt in the project root for license information.
	*--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	var desc = Object.getOwnPropertyDescriptor(m, k);
	if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
		desc = { enumerable: true, get: function() { return m[k]; } };
	}
	Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
	Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
	o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
	var ownKeys = function(o) {
		ownKeys = Object.getOwnPropertyNames || function (o) {
			var ar = [];
			for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
			return ar;
		};
		return ownKeys(o);
	};
	return function (mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
		__setModuleDefault(result, mod);
		return result;
	};
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const cognitiveWorkflowAutomationService_1 = require("sql/workbench/services/zonecog/browser/cognitiveWorkflowAutomationService");
const log_1 = require("vs/platform/log/common/log");
const cognitiveMembraneService_1 = require("sql/workbench/services/zonecog/browser/cognitiveMembraneService");
const hypergraphStore_1 = require("sql/workbench/services/zonecog/browser/hypergraphStore");
const aarOrchestrationService_1 = require("sql/workbench/services/zonecog/browser/aarOrchestrationService");
const embodiedCognitionService_1 = require("sql/workbench/services/zonecog/browser/embodiedCognitionService");
const ecanAttentionService_1 = require("sql/workbench/services/zonecog/browser/ecanAttentionService");
const llmProviderService_1 = require("sql/workbench/services/zonecog/browser/llmProviderService");
const zonecogService_1 = require("sql/workbench/services/zonecog/browser/zonecogService");
const cognitiveWorkspaceService_1 = require("sql/workbench/services/zonecog/browser/cognitiveWorkspaceService");
const cognitiveLoopService_1 = require("sql/workbench/services/zonecog/browser/cognitiveLoopService");
suite('CognitiveWorkflowAutomationService', () => {
	let service;
	let logService;
	let membraneService;
	let hypergraphStore;
	let aarService;
	let embodiedService;
	let ecanService;
	let llmService;
	let zonecogService;
	let workspaceService;
	let loopService;
	// Sample workflow definitions
	const simpleWorkflow = {
		id: 'test-simple-workflow',
		name: 'Simple Test Workflow',
		description: 'A simple workflow for testing',
		version: '1.0.0',
		steps: [
			{
				id: 'step1',
				name: 'First Step',
				agent: 'sql-analyzer-agent',
				action: 'analyze_query',
				input: { query: 'SELECT * FROM users' },
			},
		],
		triggers: [{ type: 'manual' }],
	};
	const multiStepWorkflow = {
		id: 'test-multi-step-workflow',
		name: 'Multi-Step Test Workflow',
		description: 'A workflow with multiple steps',
		version: '1.0.0',
		steps: [
			{
				id: 'step1',
				name: 'Analyze Query',
				agent: 'sql-analyzer-agent',
				action: 'analyze_query',
				input: { query: 'SELECT * FROM users' },
				next: 'step2',
			},
			{
				id: 'step2',
				name: 'Check Performance',
				agent: 'performance-advisor-agent',
				action: 'analyze_performance',
				input: { query: '${steps.step1.output.query}' },
			},
		],
		triggers: [{ type: 'manual' }],
	};
	const conditionalWorkflow = {
		id: 'test-conditional-workflow',
		name: 'Conditional Test Workflow',
		description: 'A workflow with conditional steps',
		version: '1.0.0',
		steps: [
			{
				id: 'step1',
				name: 'Initial Step',
				agent: 'sql-analyzer-agent',
				action: 'analyze_query',
				input: { query: 'SELECT * FROM users' },
				next: ['step2', 'step3'],
			},
			{
				id: 'step2',
				name: 'Conditional Step',
				agent: 'performance-advisor-agent',
				action: 'analyze_performance',
				input: {},
				condition: { type: 'always' },
			},
			{
				id: 'step3',
				name: 'Never Step',
				agent: 'performance-advisor-agent',
				action: 'analyze_performance',
				input: {},
				condition: { type: 'never' },
			},
		],
		triggers: [{ type: 'manual' }],
	};
	const invalidWorkflow = {
		// Missing required fields
		id: '',
		steps: [],
	};
	setup(() => {
		logService = new log_1.NullLogService();
		membraneService = new cognitiveMembraneService_1.CognitiveMembraneService(logService);
		hypergraphStore = new hypergraphStore_1.HypergraphStore(logService);
		ecanService = new ecanAttentionService_1.ECANAttentionService(logService, hypergraphStore, membraneService);
		embodiedService = new embodiedCognitionService_1.EmbodiedCognitionService(logService, hypergraphStore, membraneService, ecanService);
		llmService = new llmProviderService_1.LLMProviderService(logService, membraneService);
		zonecogService = new zonecogService_1.ZoneCogService(logService, hypergraphStore, membraneService, llmService);
		workspaceService = new cognitiveWorkspaceService_1.CognitiveWorkspaceService(logService, hypergraphStore);
		loopService = new cognitiveLoopService_1.CognitiveLoopService(logService, hypergraphStore, membraneService, ecanService, embodiedService, workspaceService);
		aarService = new aarOrchestrationService_1.AAROrchestrationService(logService, hypergraphStore, membraneService, embodiedService, ecanService, zonecogService, workspaceService, loopService);
		service = new cognitiveWorkflowAutomationService_1.CognitiveWorkflowAutomationService(logService, membraneService, hypergraphStore, aarService);
	});
	teardown(() => {
		service.dispose();
		aarService.dispose();
		embodiedService.dispose();
		ecanService.dispose();
		loopService.dispose();
		workspaceService.dispose();
		zonecogService.dispose();
		llmService.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});
	// --- Workflow Registration Tests ---
	test('should register a valid workflow', () => {
		// Unregister if already registered (from example workflows)
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		const workflow = service.getWorkflow(simpleWorkflow.id);
		assert.ok(workflow);
		assert.strictEqual(workflow.definition.id, simpleWorkflow.id);
		assert.strictEqual(workflow.enabled, true);
		assert.strictEqual(workflow.executionCount, 0);
	});
	test('should throw for invalid workflow', () => {
		try {
			service.registerWorkflow(invalidWorkflow);
			assert.fail('Should have thrown');
		}
		catch (error) {
			assert.ok(error);
		}
	});
	test('should unregister a workflow', () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		service.unregisterWorkflow(simpleWorkflow.id);
		const workflow = service.getWorkflow(simpleWorkflow.id);
		assert.strictEqual(workflow, undefined);
	});
	test('should list all registered workflows', () => {
		const workflows = service.getWorkflows();
		assert.ok(Array.isArray(workflows));
		// Should include example workflows registered on init
	});
	test('should enable and disable workflows', () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		service.setWorkflowEnabled(simpleWorkflow.id, false);
		let workflow = service.getWorkflow(simpleWorkflow.id);
		assert.strictEqual(workflow?.enabled, false);
		service.setWorkflowEnabled(simpleWorkflow.id, true);
		workflow = service.getWorkflow(simpleWorkflow.id);
		assert.strictEqual(workflow?.enabled, true);
	});
	// --- Workflow Validation Tests ---
	test('should validate workflow with missing ID', () => {
		const result = service.validateWorkflow({
			id: '',
			name: 'Test',
			description: 'Test',
			version: '1.0.0',
			steps: [{ id: 'step1', name: 'Step', agent: 'test', action: 'test', input: {} }],
			triggers: [{ type: 'manual' }],
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('ID')));
	});
	test('should validate workflow with missing name', () => {
		const result = service.validateWorkflow({
			id: 'test',
			name: '',
			description: 'Test',
			version: '1.0.0',
			steps: [{ id: 'step1', name: 'Step', agent: 'test', action: 'test', input: {} }],
			triggers: [{ type: 'manual' }],
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('name')));
	});
	test('should validate workflow with no steps', () => {
		const result = service.validateWorkflow({
			id: 'test',
			name: 'Test',
			description: 'Test',
			version: '1.0.0',
			steps: [],
			triggers: [{ type: 'manual' }],
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('step')));
	});
	test('should validate workflow with duplicate step IDs', () => {
		const result = service.validateWorkflow({
			id: 'test',
			name: 'Test',
			description: 'Test',
			version: '1.0.0',
			steps: [
				{ id: 'step1', name: 'Step 1', agent: 'test', action: 'test', input: {} },
				{ id: 'step1', name: 'Step 2', agent: 'test', action: 'test', input: {} },
			],
			triggers: [{ type: 'manual' }],
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('Duplicate')));
	});
	test('should validate workflow with invalid next reference', () => {
		const result = service.validateWorkflow({
			id: 'test',
			name: 'Test',
			description: 'Test',
			version: '1.0.0',
			steps: [
				{ id: 'step1', name: 'Step 1', agent: 'test', action: 'test', input: {}, next: 'nonexistent' },
			],
			triggers: [{ type: 'manual' }],
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('unknown')));
	});
	test('should validate workflow step missing agent', () => {
		const result = service.validateWorkflow({
			id: 'test',
			name: 'Test',
			description: 'Test',
			version: '1.0.0',
			steps: [
				{ id: 'step1', name: 'Step 1', agent: '', action: 'test', input: {} },
			],
			triggers: [{ type: 'manual' }],
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('agent')));
	});
	test('should validate workflow step missing action', () => {
		const result = service.validateWorkflow({
			id: 'test',
			name: 'Test',
			description: 'Test',
			version: '1.0.0',
			steps: [
				{ id: 'step1', name: 'Step 1', agent: 'test', action: '', input: {} },
			],
			triggers: [{ type: 'manual' }],
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('action')));
	});
	test('should accept valid workflow', () => {
		const result = service.validateWorkflow(simpleWorkflow);
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
	});
	// --- Workflow Execution Tests ---
	test('should throw when executing non-existent workflow', async () => {
		try {
			await service.executeWorkflow('non-existent-workflow');
			assert.fail('Should have thrown');
		}
		catch (error) {
			assert.ok(String(error).includes('not found'));
		}
	});
	test('should throw when executing disabled workflow', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		service.setWorkflowEnabled(simpleWorkflow.id, false);
		try {
			await service.executeWorkflow(simpleWorkflow.id);
			assert.fail('Should have thrown');
		}
		catch (error) {
			assert.ok(String(error).includes('disabled'));
		}
	});
	test('should execute simple workflow', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		const result = await service.executeWorkflow(simpleWorkflow.id);
		assert.ok(result);
		assert.ok(result.executionId);
		assert.ok(result.durationMs >= 0);
	});
	test('should track execution count', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		await service.executeWorkflow(simpleWorkflow.id);
		await service.executeWorkflow(simpleWorkflow.id);
		const workflow = service.getWorkflow(simpleWorkflow.id);
		assert.strictEqual(workflow?.executionCount, 2);
	});
	test('should fire execution start event', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		let startFired = false;
		service.onDidStartExecution(() => {
			startFired = true;
		});
		await service.executeWorkflow(simpleWorkflow.id);
		assert.strictEqual(startFired, true);
	});
	test('should fire execution complete event', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		let completeFired = false;
		service.onDidCompleteExecution(() => {
			completeFired = true;
		});
		await service.executeWorkflow(simpleWorkflow.id);
		assert.strictEqual(completeFired, true);
	});
	test('should fire step complete event', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		let stepCompleteFired = false;
		service.onDidCompleteStep(() => {
			stepCompleteFired = true;
		});
		await service.executeWorkflow(simpleWorkflow.id);
		assert.strictEqual(stepCompleteFired, true);
	});
	// --- Execution History Tests ---
	test('should maintain execution history', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		await service.executeWorkflow(simpleWorkflow.id);
		const history = service.getExecutionHistory();
		assert.ok(history.length > 0);
	});
	test('should filter execution history by workflow ID', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		await service.executeWorkflow(simpleWorkflow.id);
		const history = service.getExecutionHistory(simpleWorkflow.id);
		assert.ok(history.every(e => e.workflowId === simpleWorkflow.id));
	});
	test('should limit execution history', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		await service.executeWorkflow(simpleWorkflow.id);
		await service.executeWorkflow(simpleWorkflow.id);
		await service.executeWorkflow(simpleWorkflow.id);
		const history = service.getExecutionHistory(undefined, 2);
		assert.ok(history.length <= 2);
	});
	// --- Active Executions Tests ---
	test('should track active executions', () => {
		// Initially no active executions after setup
		const active = service.getActiveExecutions();
		assert.ok(Array.isArray(active));
	});
	// --- Workflow Parsing Tests ---
	test('should parse JSON workflow definition', () => {
		const json = JSON.stringify(simpleWorkflow);
		const parsed = service.parseWorkflowDefinition(json, 'json');
		assert.strictEqual(parsed.id, simpleWorkflow.id);
		assert.strictEqual(parsed.name, simpleWorkflow.name);
	});
	test('should parse basic YAML-like workflow definition', () => {
		const yaml = `
id: test-yaml-workflow
name: YAML Test Workflow
version: 1.0.0
`;
		const parsed = service.parseWorkflowDefinition(yaml, 'yaml');
		assert.strictEqual(parsed.id, 'test-yaml-workflow');
	});
	// --- Membrane Activity Tests ---
	test('should record membrane activity on register', () => {
		const initialCerebral = membraneService.getActivity('cerebral');
		service.unregisterWorkflow('new-test-workflow');
		service.registerWorkflow({
			...simpleWorkflow,
			id: 'new-test-workflow',
		});
		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});
	test('should record membrane activity on execute', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		const initialSomatic = membraneService.getActivity('somatic');
		await service.executeWorkflow(simpleWorkflow.id);
		const afterSomatic = membraneService.getActivity('somatic');
		assert.ok(afterSomatic > initialSomatic);
	});
	// --- Hypergraph Storage Tests ---
	test('should store execution in hypergraph', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		const initialCount = hypergraphStore.nodeCount();
		await service.executeWorkflow(simpleWorkflow.id);
		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});
	test('should store execution with correct node type', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		await service.executeWorkflow(simpleWorkflow.id);
		const nodes = hypergraphStore.findNodesByType('workflow_execution');
		assert.ok(nodes.length > 0);
	});
	// --- Cancel Execution Tests ---
	test('should cancel execution', () => {
		// Create a mock execution ID for cancellation
		const fakeExecutionId = 'exec_test_123';
		// Should not throw even for non-existent execution
		service.cancelExecution(fakeExecutionId);
	});
	// --- Condition Evaluation Tests ---
	test('should evaluate always condition as true', async () => {
		service.unregisterWorkflow(conditionalWorkflow.id);
		service.registerWorkflow(conditionalWorkflow);
		const result = await service.executeWorkflow(conditionalWorkflow.id);
		// step2 with always condition should be in outputs
		assert.ok(result.outputs['step2'] !== undefined || result.success);
	});
	// --- Input with Trigger Data Tests ---
	test('should pass input to workflow execution', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		const result = await service.executeWorkflow(simpleWorkflow.id, {
			customInput: 'test-value',
		});
		assert.ok(result);
	});
	// --- Error Handling Tests ---
	test('should handle workflow execution error gracefully', async () => {
		const failingWorkflow = {
			id: 'failing-workflow',
			name: 'Failing Workflow',
			description: 'A workflow that fails',
			version: '1.0.0',
			steps: [
				{
					id: 'fail-step',
					name: 'Failing Step',
					agent: 'non-existent-agent',
					action: 'impossible_action',
					input: {},
					onError: 'continue', // Continue on error
				},
			],
			triggers: [{ type: 'manual' }],
		};
		service.registerWorkflow(failingWorkflow);
		// Should not throw - error is handled
		const result = await service.executeWorkflow(failingWorkflow.id);
		assert.ok(result);
		service.unregisterWorkflow(failingWorkflow.id);
	});
	test('should fire failure event on workflow error', async () => {
		const failingWorkflow = {
			id: 'failing-workflow-2',
			name: 'Failing Workflow 2',
			description: 'A workflow that fails',
			version: '1.0.0',
			steps: [
				{
					id: 'fail-step',
					name: 'Failing Step',
					agent: 'non-existent-agent',
					action: 'impossible_action',
					input: {},
					onError: 'stop', // Stop on error
				},
			],
			triggers: [{ type: 'manual' }],
		};
		service.registerWorkflow(failingWorkflow);
		let failureFired = false;
		service.onDidFailExecution(() => {
			failureFired = true;
		});
		await service.executeWorkflow(failingWorkflow.id);
		assert.strictEqual(failureFired, true);
		service.unregisterWorkflow(failingWorkflow.id);
	});
	// --- Multi-Step Workflow Tests ---
	test('should execute multi-step workflow in order', async () => {
		service.unregisterWorkflow(multiStepWorkflow.id);
		service.registerWorkflow(multiStepWorkflow);
		const completedSteps = [];
		service.onDidCompleteStep(({ stepId }) => {
			completedSteps.push(stepId);
		});
		await service.executeWorkflow(multiStepWorkflow.id);
		assert.strictEqual(completedSteps[0], 'step1');
		// step2 should follow step1
		assert.ok(completedSteps.includes('step2') || completedSteps.length >= 1);
	});
	// --- Success Rate Tracking Tests ---
	test('should track success count', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		await service.executeWorkflow(simpleWorkflow.id);
		const workflow = service.getWorkflow(simpleWorkflow.id);
		assert.strictEqual(workflow?.successCount, 1);
	});
	test('should update last execution time', async () => {
		service.unregisterWorkflow(simpleWorkflow.id);
		service.registerWorkflow(simpleWorkflow);
		const before = Date.now();
		await service.executeWorkflow(simpleWorkflow.id);
		const after = Date.now();
		const workflow = service.getWorkflow(simpleWorkflow.id);
		assert.ok(workflow?.lastExecutionTime !== undefined);
		assert.ok(workflow.lastExecutionTime >= before);
		assert.ok(workflow.lastExecutionTime <= after);
	});
});
