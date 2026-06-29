"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CognitiveWorkflowAutomationService = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
const cognitiveWorkflowAutomation_1 = require("sql/workbench/services/zonecog/common/cognitiveWorkflowAutomation");
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const zonecogService_2 = require("sql/workbench/services/zonecog/common/zonecogService");
const aarOrchestration_1 = require("sql/workbench/services/zonecog/common/aarOrchestration");
/**
 * Cognitive Workflow Automation Service Implementation.
 * Enables defining and executing custom cognitive workflows.
 */
let CognitiveWorkflowAutomationService = class CognitiveWorkflowAutomationService extends lifecycle_1.Disposable {
    logService;
    membraneService;
    hypergraphStore;
    aarService;
    _serviceBrand;
    _workflows = new Map();
    _activeExecutions = new Map();
    _executionHistory = [];
    _maxHistorySize = 100;
    _executionIdCounter = 0;
    _onDidStartExecution = this._register(new event_1.Emitter());
    onDidStartExecution = this._onDidStartExecution.event;
    _onDidCompleteStep = this._register(new event_1.Emitter());
    onDidCompleteStep = this._onDidCompleteStep.event;
    _onDidCompleteExecution = this._register(new event_1.Emitter());
    onDidCompleteExecution = this._onDidCompleteExecution.event;
    _onDidFailExecution = this._register(new event_1.Emitter());
    onDidFailExecution = this._onDidFailExecution.event;
    constructor(logService, membraneService, hypergraphStore, aarService) {
        super();
        this.logService = logService;
        this.membraneService = membraneService;
        this.hypergraphStore = hypergraphStore;
        this.aarService = aarService;
        this.logService.info('[CognitiveWorkflowAutomationService] Initialized');
        // Register example workflows
        for (const workflow of cognitiveWorkflowAutomation_1.EXAMPLE_WORKFLOWS) {
            this.registerWorkflow(workflow);
        }
    }
    registerWorkflow(definition) {
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
    unregisterWorkflow(workflowId) {
        this._workflows.delete(workflowId);
        this.logService.info(`[CognitiveWorkflowAutomationService] Unregistered workflow: ${workflowId}`);
    }
    getWorkflows() {
        return Array.from(this._workflows.values());
    }
    getWorkflow(workflowId) {
        return this._workflows.get(workflowId);
    }
    setWorkflowEnabled(workflowId, enabled) {
        const workflow = this._workflows.get(workflowId);
        if (workflow) {
            workflow.enabled = enabled;
            this.logService.info(`[CognitiveWorkflowAutomationService] Workflow ${workflowId} ${enabled ? 'enabled' : 'disabled'}`);
        }
    }
    async executeWorkflow(workflowId, input) {
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
        const execution = {
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
            const result = {
                executionId,
                success: true,
                outputs: execution.outputs,
                durationMs: execution.endTime - execution.startTime,
                summary: this._generateSummary(execution),
            };
            this._onDidCompleteExecution.fire(result);
            await this._storeExecution(execution);
            return result;
        }
        catch (error) {
            // Mark as failed
            execution.status = 'failed';
            execution.endTime = Date.now();
            const workflowError = {
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
            const result = {
                executionId,
                success: false,
                outputs: execution.outputs,
                durationMs: execution.endTime - execution.startTime,
                summary: `Workflow failed: ${workflowError.message}`,
            };
            return result;
        }
        finally {
            this._activeExecutions.delete(executionId);
            this._addToHistory(execution);
        }
    }
    cancelExecution(executionId) {
        const execution = this._activeExecutions.get(executionId);
        if (execution) {
            execution.status = 'cancelled';
            execution.endTime = Date.now();
            this._activeExecutions.delete(executionId);
            this._addToHistory(execution);
            this.logService.info(`[CognitiveWorkflowAutomationService] Cancelled execution: ${executionId}`);
        }
    }
    getActiveExecutions() {
        return Array.from(this._activeExecutions.values());
    }
    getExecutionHistory(workflowId, limit) {
        let history = this._executionHistory;
        if (workflowId) {
            history = history.filter(e => e.workflowId === workflowId);
        }
        if (limit) {
            history = history.slice(0, limit);
        }
        return history;
    }
    parseWorkflowDefinition(content, format) {
        if (format === 'json') {
            return JSON.parse(content);
        }
        else {
            // Simple YAML-like parsing (basic support)
            return this._parseSimpleYAML(content);
        }
    }
    validateWorkflow(definition) {
        const errors = [];
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
        const stepIds = new Set();
        for (const step of definition.steps || []) {
            if (!step.id) {
                errors.push('Each step must have an ID');
            }
            else if (stepIds.has(step.id)) {
                errors.push(`Duplicate step ID: ${step.id}`);
            }
            else {
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
    async _executeSteps(definition, execution, input) {
        // Build step map for quick lookup
        const stepMap = new Map();
        for (const step of definition.steps) {
            stepMap.set(step.id, step);
        }
        // Find entry points (steps not referenced by any next)
        const referencedSteps = new Set();
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
        const context = { trigger: input, steps: {} };
        for (const entryStep of entryPoints) {
            await this._executeStep(entryStep, stepMap, execution, context);
        }
    }
    async _executeStep(step, stepMap, execution, context) {
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
        let output;
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
            }
            catch (error) {
                retryCount++;
                const workflowError = {
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
    async _executeNextSteps(step, stepMap, execution, context) {
        if (!step.next) {
            return;
        }
        const nextSteps = Array.isArray(step.next) ? step.next : [step.next];
        // Execute next steps (potentially in parallel for arrays)
        await Promise.all(nextSteps.map(async (nextId) => {
            const nextStep = stepMap.get(nextId);
            if (nextStep) {
                await this._executeStep(nextStep, stepMap, execution, context);
            }
        }));
    }
    async _executeAgentAction(agent, action, input) {
        // Route to the appropriate agent via AAR orchestration
        const agentAction = {
            action,
            target: JSON.stringify(input),
            parameters: input,
            confidence: 1.0,
        };
        return await this.aarService.dispatchAction(agent, agentAction);
    }
    _evaluateCondition(condition, context) {
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
    _evaluateExpression(expression, context) {
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
        }
        catch {
            return false;
        }
    }
    _evaluateOutputCheck(condition, context) {
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
    _resolveInput(input, context) {
        const resolved = {};
        for (const [key, value] of Object.entries(input)) {
            if (typeof value === 'string') {
                resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_, path) => {
                    return this._resolveContextPath(path, context);
                });
            }
            else if (typeof value === 'object' && value !== null) {
                resolved[key] = this._resolveInput(value, context);
            }
            else {
                resolved[key] = value;
            }
        }
        return resolved;
    }
    _resolveContextPath(path, context) {
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
    _generateExecutionId() {
        return `exec_${++this._executionIdCounter}_${Date.now()}`;
    }
    _generateSummary(execution) {
        const duration = (execution.endTime || Date.now()) - execution.startTime;
        return `Completed ${execution.completedSteps.length} steps in ${duration}ms`;
    }
    _addToHistory(execution) {
        this._executionHistory.unshift(execution);
        if (this._executionHistory.length > this._maxHistorySize) {
            this._executionHistory.pop();
        }
    }
    async _storeExecution(execution) {
        const node = {
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
    _parseSimpleYAML(content) {
        // Very basic YAML-like parsing for workflow definitions
        // In production, would use a proper YAML parser
        const lines = content.split('\n');
        const result = {};
        const stack = [{ obj: result, indent: -1 }];
        let currentKey = '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
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
                }
                else {
                    parent[key] = {};
                    stack.push({ obj: parent[key], indent });
                    currentKey = key;
                }
            }
            else if (trimmed.startsWith('- ')) {
                // Array item
                const parent = stack[stack.length - 1].obj;
                if (!Array.isArray(parent[currentKey])) {
                    parent[currentKey] = [];
                }
                const item = trimmed.substring(2).trim();
                parent[currentKey].push(item);
            }
        }
        return result;
    }
};
exports.CognitiveWorkflowAutomationService = CognitiveWorkflowAutomationService;
exports.CognitiveWorkflowAutomationService = CognitiveWorkflowAutomationService = __decorate([
    __param(0, log_1.ILogService),
    __param(1, zonecogService_1.ICognitiveMembraneService),
    __param(2, zonecogService_2.IHypergraphStore),
    __param(3, aarOrchestration_1.IAAROrchestrationService)
], CognitiveWorkflowAutomationService);
