/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	ICognitiveWorkflowAutomationService,
	CognitiveWorkflowDefinition,
	WorkflowStep,
	WorkflowCondition,
	WorkflowExecution,
	WorkflowError,
	WorkflowResult,
	RegisteredWorkflow,
	EXAMPLE_WORKFLOWS,
} from 'sql/workbench/services/zonecog/common/cognitiveWorkflowAutomation';
import { ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IHypergraphStore, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IAAROrchestrationService } from 'sql/workbench/services/zonecog/common/aarOrchestration';

/**
 * Cognitive Workflow Automation Service Implementation.
 * Enables defining and executing custom cognitive workflows.
 */
export class CognitiveWorkflowAutomationService extends Disposable implements ICognitiveWorkflowAutomationService {
	readonly _serviceBrand: undefined;

	private readonly _workflows: Map<string, RegisteredWorkflow> = new Map();
	private readonly _activeExecutions: Map<string, WorkflowExecution> = new Map();
	private readonly _executionHistory: WorkflowExecution[] = [];
	private readonly _maxHistorySize = 100;
	private _executionIdCounter = 0;

	private readonly _onDidStartExecution = this._register(new Emitter<WorkflowExecution>());
	readonly onDidStartExecution: Event<WorkflowExecution> = this._onDidStartExecution.event;

	private readonly _onDidCompleteStep = this._register(new Emitter<{ executionId: string; stepId: string; output: any }>());
	readonly onDidCompleteStep: Event<{ executionId: string; stepId: string; output: any }> = this._onDidCompleteStep.event;

	private readonly _onDidCompleteExecution = this._register(new Emitter<WorkflowResult>());
	readonly onDidCompleteExecution: Event<WorkflowResult> = this._onDidCompleteExecution.event;

	private readonly _onDidFailExecution = this._register(new Emitter<{ executionId: string; error: WorkflowError }>());
	readonly onDidFailExecution: Event<{ executionId: string; error: WorkflowError }> = this._onDidFailExecution.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@IAAROrchestrationService private readonly aarService: IAAROrchestrationService
	) {
		super();
		this.logService.info('[CognitiveWorkflowAutomationService] Initialized');

		// Register example workflows
		for (const workflow of EXAMPLE_WORKFLOWS) {
			this.registerWorkflow(workflow);
		}
	}

	registerWorkflow(definition: CognitiveWorkflowDefinition): void {
		this.membraneService.recordActivity('cerebral');

		const validation = this.validateWorkflow(definition);
		if (!validation.valid) {
			this.logService.error(`[CognitiveWorkflowAutomationService] Invalid workflow: ${validation.errors.join(', ')}`);
			throw new Error(`Invalid workflow: ${validation.errors.join(', ')}`);
		}

		this._workflows.set(definition.id, {
			definition,
			enabled: true,
			executionCount: 0,
			successCount: 0,
		});

		this.logService.info(`[CognitiveWorkflowAutomationService] Registered workflow: ${definition.id}`);
	}

	unregisterWorkflow(workflowId: string): void {
		this._workflows.delete(workflowId);
		this.logService.info(`[CognitiveWorkflowAutomationService] Unregistered workflow: ${workflowId}`);
	}

	getWorkflows(): RegisteredWorkflow[] {
		return Array.from(this._workflows.values());
	}

	getWorkflow(workflowId: string): RegisteredWorkflow | undefined {
		return this._workflows.get(workflowId);
	}

	setWorkflowEnabled(workflowId: string, enabled: boolean): void {
		const workflow = this._workflows.get(workflowId);
		if (workflow) {
			workflow.enabled = enabled;
			this.logService.info(`[CognitiveWorkflowAutomationService] Workflow ${workflowId} ${enabled ? 'enabled' : 'disabled'}`);
		}
	}

	async executeWorkflow(workflowId: string, input?: Record<string, any>): Promise<WorkflowResult> {
		this.membraneService.recordActivity('somatic');

		const workflow = this._workflows.get(workflowId);
		if (!workflow) {
			throw new Error(`Workflow not found: ${workflowId}`);
		}

		if (!workflow.enabled) {
			throw new Error(`Workflow is disabled: ${workflowId}`);
		}

		// Create execution context
		const executionId = this._generateExecutionId();
		const execution: WorkflowExecution = {
			executionId,
			workflowId,
			startTime: Date.now(),
			status: 'running',
			completedSteps: [],
			outputs: {},
			errors: [],
			trigger: { type: 'manual' },
		};

		this._activeExecutions.set(executionId, execution);
		this._onDidStartExecution.fire(execution);

		this.logService.info(`[CognitiveWorkflowAutomationService] Starting execution ${executionId} of workflow ${workflowId}`);

		try {
			// Execute workflow steps
			await this._executeSteps(workflow.definition, execution, input || {});

			// Mark as completed
			execution.status = 'completed';
			execution.endTime = Date.now();

			// Update stats
			workflow.executionCount++;
			workflow.successCount++;
			workflow.lastExecutionTime = execution.endTime;

			const result: WorkflowResult = {
				executionId,
				success: true,
				outputs: execution.outputs,
				durationMs: execution.endTime - execution.startTime,
				summary: this._generateSummary(execution),
			};

			this._onDidCompleteExecution.fire(result);
			await this._storeExecution(execution);

			return result;

		} catch (error) {
			// Mark as failed
			execution.status = 'failed';
			execution.endTime = Date.now();

			const workflowError: WorkflowError = {
				stepId: execution.currentStep || 'unknown',
				message: String(error),
				timestamp: Date.now(),
				retryCount: 0,
			};
			execution.errors.push(workflowError);

			// Update stats
			workflow.executionCount++;
			workflow.lastExecutionTime = execution.endTime;

			this._onDidFailExecution.fire({ executionId, error: workflowError });
			await this._storeExecution(execution);

			const result: WorkflowResult = {
				executionId,
				success: false,
				outputs: execution.outputs,
				durationMs: execution.endTime - execution.startTime,
				summary: `Workflow failed: ${workflowError.message}`,
			};

			return result;

		} finally {
			this._activeExecutions.delete(executionId);
			this._addToHistory(execution);
		}
	}

	cancelExecution(executionId: string): void {
		const execution = this._activeExecutions.get(executionId);
		if (execution) {
			execution.status = 'cancelled';
			execution.endTime = Date.now();
			this._activeExecutions.delete(executionId);
			this._addToHistory(execution);
			this.logService.info(`[CognitiveWorkflowAutomationService] Cancelled execution: ${executionId}`);
		}
	}

	getActiveExecutions(): WorkflowExecution[] {
		return Array.from(this._activeExecutions.values());
	}

	getExecutionHistory(workflowId?: string, limit?: number): WorkflowExecution[] {
		let history = this._executionHistory;

		if (workflowId) {
			history = history.filter(e => e.workflowId === workflowId);
		}

		if (limit) {
			history = history.slice(0, limit);
		}

		return history;
	}

	parseWorkflowDefinition(content: string, format: 'yaml' | 'json'): CognitiveWorkflowDefinition {
		if (format === 'json') {
			return JSON.parse(content);
		} else {
			// Simple YAML-like parsing (basic support)
			return this._parseSimpleYAML(content);
		}
	}

	validateWorkflow(definition: CognitiveWorkflowDefinition): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		// Required fields
		if (!definition.id) {
			errors.push('Workflow ID is required');
		}
		if (!definition.name) {
			errors.push('Workflow name is required');
		}
		if (!definition.steps || definition.steps.length === 0) {
			errors.push('Workflow must have at least one step');
		}

		// Validate steps
		const stepIds = new Set<string>();
		for (const step of definition.steps || []) {
			if (!step.id) {
				errors.push('Each step must have an ID');
			} else if (stepIds.has(step.id)) {
				errors.push(`Duplicate step ID: ${step.id}`);
			} else {
				stepIds.add(step.id);
			}

			if (!step.agent) {
				errors.push(`Step ${step.id}: agent is required`);
			}
			if (!step.action) {
				errors.push(`Step ${step.id}: action is required`);
			}

			// Validate next references
			if (step.next) {
				const nextSteps = Array.isArray(step.next) ? step.next : [step.next];
				for (const nextId of nextSteps) {
					const exists = definition.steps.some(s => s.id === nextId);
					if (!exists) {
						errors.push(`Step ${step.id}: references unknown next step '${nextId}'`);
					}
				}
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	private async _executeSteps(
		definition: CognitiveWorkflowDefinition,
		execution: WorkflowExecution,
		input: Record<string, any>
	): Promise<void> {
		// Build step map for quick lookup
		const stepMap = new Map<string, WorkflowStep>();
		for (const step of definition.steps) {
			stepMap.set(step.id, step);
		}

		// Find entry points (steps not referenced by any next)
		const referencedSteps = new Set<string>();
		for (const step of definition.steps) {
			if (step.next) {
				const nextSteps = Array.isArray(step.next) ? step.next : [step.next];
				nextSteps.forEach(id => referencedSteps.add(id));
			}
		}

		const entryPoints = definition.steps.filter(s => !referencedSteps.has(s.id));
		if (entryPoints.length === 0 && definition.steps.length > 0) {
			// Fallback to first step
			entryPoints.push(definition.steps[0]);
		}

		// Execute from entry points
		const context = { trigger: input, steps: {} as Record<string, { output: any }> };

		for (const entryStep of entryPoints) {
			await this._executeStep(entryStep, stepMap, execution, context);
		}
	}

	private async _executeStep(
		step: WorkflowStep,
		stepMap: Map<string, WorkflowStep>,
		execution: WorkflowExecution,
		context: { trigger: any; steps: Record<string, { output: any }> }
	): Promise<void> {
		// Check if already executed
		if (execution.completedSteps.includes(step.id)) {
			return;
		}

		// Check if cancelled
		if (execution.status === 'cancelled') {
			return;
		}

		execution.currentStep = step.id;

		// Check condition
		if (step.condition && !this._evaluateCondition(step.condition, context)) {
			this.logService.info(`[CognitiveWorkflowAutomationService] Skipping step ${step.id} (condition not met)`);
			// Still proceed to next steps
			await this._executeNextSteps(step, stepMap, execution, context);
			return;
		}

		// Resolve input parameters
		const resolvedInput = this._resolveInput(step.input, context);

		// Execute the step action
		let output: any;
		let retryCount = 0;
		const maxRetries = step.maxRetries || 0;

		while (true) {
			try {
				this.logService.info(`[CognitiveWorkflowAutomationService] Executing step ${step.id} (agent: ${step.agent}, action: ${step.action})`);

				// Route to appropriate agent
				output = await this._executeAgentAction(step.agent, step.action, resolvedInput);

				// Store output
				context.steps[step.id] = { output };
				execution.outputs[step.id] = output;
				execution.completedSteps.push(step.id);

				this._onDidCompleteStep.fire({ executionId: execution.executionId, stepId: step.id, output });

				break;

			} catch (error) {
				retryCount++;

				const workflowError: WorkflowError = {
					stepId: step.id,
					message: String(error),
					timestamp: Date.now(),
					retryCount,
				};
				execution.errors.push(workflowError);

				if (step.onError === 'continue') {
					this.logService.warn(`[CognitiveWorkflowAutomationService] Step ${step.id} failed, continuing: ${error}`);
					break;
				}

				if (retryCount > maxRetries) {
					if (step.onError === 'stop') {
						throw error;
					}
					break;
				}

				this.logService.warn(`[CognitiveWorkflowAutomationService] Retrying step ${step.id} (${retryCount}/${maxRetries})`);
			}
		}

		// Execute next steps
		await this._executeNextSteps(step, stepMap, execution, context);
	}

	private async _executeNextSteps(
		step: WorkflowStep,
		stepMap: Map<string, WorkflowStep>,
		execution: WorkflowExecution,
		context: { trigger: any; steps: Record<string, { output: any }> }
	): Promise<void> {
		if (!step.next) {
			return;
		}

		const nextSteps = Array.isArray(step.next) ? step.next : [step.next];

		// Execute next steps (potentially in parallel for arrays)
		await Promise.all(
			nextSteps.map(async (nextId) => {
				const nextStep = stepMap.get(nextId);
				if (nextStep) {
					await this._executeStep(nextStep, stepMap, execution, context);
				}
			})
		);
	}

	private async _executeAgentAction(agent: string, action: string, input: any): Promise<any> {
		// Route to the appropriate agent via AAR orchestration
		const agentAction = {
			action,
			target: JSON.stringify(input),
			parameters: input,
			confidence: 1.0,
		};

		try {
			return await this.aarService.dispatchAction(agent, agentAction);
		} catch (err) {
			const message = String(err);
			if (message.includes('unknown agent')) {
				this.logService.warn(
					`[CognitiveWorkflowAutomationService] Agent '${agent}' not registered in AAR, returning empty result`
				);
				return {};
			}
			throw err;
		}
	}

	private _evaluateCondition(condition: WorkflowCondition, context: any): boolean {
		switch (condition.type) {
			case 'always':
				return true;
			case 'never':
				return false;
			case 'expression':
				return this._evaluateExpression(condition.expression || '', context);
			case 'output_check':
				return this._evaluateOutputCheck(condition, context);
			default:
				return true;
		}
	}

	private _evaluateExpression(expression: string, context: any): boolean {
		// Simple expression evaluation (for safety, only support basic comparisons)
		try {
			// Replace context references
			let resolved = expression.replace(/\$\{([^}]+)\}/g, (_, path) => {
				return String(this._resolveContextPath(path, context));
			});

			// Evaluate simple comparisons
			const comparisonMatch = resolved.match(/^(.+?)\s*(>=|<=|>|<|==|!=)\s*(.+)$/);
			if (comparisonMatch) {
				const left = parseFloat(comparisonMatch[1].trim());
				const op = comparisonMatch[2];
				const right = parseFloat(comparisonMatch[3].trim());

				switch (op) {
					case '>': return left > right;
					case '<': return left < right;
					case '>=': return left >= right;
					case '<=': return left <= right;
					case '==': return left === right;
					case '!=': return left !== right;
				}
			}

			return Boolean(resolved);
		} catch {
			return false;
		}
	}

	private _evaluateOutputCheck(condition: WorkflowCondition, context: any): boolean {
		const stepOutput = context.steps[condition.stepId || '']?.output;
		if (stepOutput === undefined) {
			return false;
		}

		const value = condition.field ? stepOutput[condition.field] : stepOutput;
		const compareValue = condition.value;

		switch (condition.operator) {
			case 'eq': return value === compareValue;
			case 'ne': return value !== compareValue;
			case 'gt': return value > compareValue;
			case 'lt': return value < compareValue;
			case 'gte': return value >= compareValue;
			case 'lte': return value <= compareValue;
			case 'contains': return String(value).includes(String(compareValue));
			case 'exists': return value !== undefined && value !== null;
			default: return false;
		}
	}

	private _resolveInput(input: Record<string, any>, context: any): Record<string, any> {
		const resolved: Record<string, any> = {};

		for (const [key, value] of Object.entries(input)) {
			if (typeof value === 'string') {
				resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_, path) => {
					return this._resolveContextPath(path, context);
				});
			} else if (typeof value === 'object' && value !== null) {
				resolved[key] = this._resolveInput(value, context);
			} else {
				resolved[key] = value;
			}
		}

		return resolved;
	}

	private _resolveContextPath(path: string, context: any): any {
		const parts = path.split('.');
		let current = context;

		for (const part of parts) {
			if (current === undefined || current === null) {
				return undefined;
			}
			current = current[part];
		}

		return current;
	}

	private _generateExecutionId(): string {
		return `exec_${++this._executionIdCounter}_${Date.now()}`;
	}

	private _generateSummary(execution: WorkflowExecution): string {
		const duration = (execution.endTime || Date.now()) - execution.startTime;
		return `Completed ${execution.completedSteps.length} steps in ${duration}ms`;
	}

	private _addToHistory(execution: WorkflowExecution): void {
		this._executionHistory.unshift(execution);
		if (this._executionHistory.length > this._maxHistorySize) {
			this._executionHistory.pop();
		}
	}

	private async _storeExecution(execution: WorkflowExecution): Promise<void> {
		const node: Omit<HypergraphNode, 'id'> = {
			node_type: 'workflow_execution',
			content: JSON.stringify(execution),
			links: [],
			metadata: {
				workflowId: execution.workflowId,
				executionId: execution.executionId,
				status: execution.status,
				duration: (execution.endTime || Date.now()) - execution.startTime,
				timestamp: Date.now(),
			},
			salience_score: execution.status === 'failed' ? 0.9 : 0.5,
		};
		await this.hypergraphStore.addNode(node);
	}

	private _parseSimpleYAML(content: string): CognitiveWorkflowDefinition {
		// Very basic YAML-like parsing for workflow definitions
		// In production, would use a proper YAML parser
		const lines = content.split('\n');
		const result: any = {};
		const stack: { obj: any; indent: number }[] = [{ obj: result, indent: -1 }];
		let currentKey = '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;

			const indent = line.search(/\S/);
			const colonIndex = trimmed.indexOf(':');

			if (colonIndex > 0) {
				const key = trimmed.substring(0, colonIndex).trim();
				const value = trimmed.substring(colonIndex + 1).trim();

				// Find correct parent
				while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
					stack.pop();
				}

				const parent = stack[stack.length - 1].obj;

				if (value) {
					parent[key] = value;
				} else {
					parent[key] = {};
					stack.push({ obj: parent[key], indent });
					currentKey = key;
				}
			} else if (trimmed.startsWith('- ')) {
				// Array item
				const parent = stack[stack.length - 1].obj;
				if (!Array.isArray(parent[currentKey])) {
					parent[currentKey] = [];
				}
				const item = trimmed.substring(2).trim();
				parent[currentKey].push(item);
			}
		}

		return result as CognitiveWorkflowDefinition;
	}
}
