/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

/**
 * Cognitive workflow definition using YAML/JSON DSL.
 */
export interface CognitiveWorkflowDefinition {
	/** Unique workflow ID */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of what the workflow does */
	description: string;
	/** Version number */
	version: string;
	/** Workflow steps */
	steps: WorkflowStep[];
	/** Trigger conditions */
	triggers: WorkflowTrigger[];
	/** Global workflow settings */
	settings?: WorkflowSettings;
}

/**
 * Individual step in a cognitive workflow.
 */
export interface WorkflowStep {
	/** Step ID */
	id: string;
	/** Step name */
	name: string;
	/** Agent to execute this step */
	agent: string;
	/** Action to perform */
	action: string;
	/** Input parameters (can reference outputs from previous steps) */
	input: Record<string, any>;
	/** Condition for executing this step */
	condition?: WorkflowCondition;
	/** Error handling */
	onError?: 'stop' | 'continue' | 'retry';
	/** Maximum retries */
	maxRetries?: number;
	/** Timeout in milliseconds */
	timeout?: number;
	/** Next step(s) to execute */
	next?: string | string[];
}

/**
 * Condition for step execution.
 */
export interface WorkflowCondition {
	/** Type of condition */
	type: 'expression' | 'always' | 'never' | 'output_check';
	/** Expression to evaluate (for 'expression' type) */
	expression?: string;
	/** Step output to check (for 'output_check' type) */
	stepId?: string;
	/** Output field to check */
	field?: string;
	/** Comparison operator */
	operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists';
	/** Value to compare against */
	value?: any;
}

/**
 * Trigger for starting a workflow.
 */
export interface WorkflowTrigger {
	/** Trigger type */
	type: 'manual' | 'event' | 'schedule' | 'schema_change' | 'query_execution';
	/** Event name (for 'event' type) */
	event?: string;
	/** Cron expression (for 'schedule' type) */
	schedule?: string;
	/** Additional trigger conditions */
	conditions?: WorkflowCondition[];
}

/**
 * Global workflow settings.
 */
export interface WorkflowSettings {
	/** Maximum concurrent executions */
	maxConcurrent?: number;
	/** Default timeout for steps */
	defaultTimeout?: number;
	/** Whether to persist workflow state */
	persistState?: boolean;
	/** Log level */
	logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Workflow execution state.
 */
export interface WorkflowExecution {
	/** Execution ID */
	executionId: string;
	/** Workflow ID */
	workflowId: string;
	/** Start time */
	startTime: number;
	/** End time (if completed) */
	endTime?: number;
	/** Current status */
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	/** Current step */
	currentStep?: string;
	/** Completed steps */
	completedSteps: string[];
	/** Step outputs */
	outputs: Record<string, any>;
	/** Errors encountered */
	errors: WorkflowError[];
	/** Trigger that started this execution */
	trigger: WorkflowTrigger;
}

/**
 * Workflow error information.
 */
export interface WorkflowError {
	/** Step that failed */
	stepId: string;
	/** Error message */
	message: string;
	/** Error timestamp */
	timestamp: number;
	/** Stack trace (if available) */
	stack?: string;
	/** Retry count */
	retryCount: number;
}

/**
 * Workflow execution result.
 */
export interface WorkflowResult {
	/** Execution ID */
	executionId: string;
	/** Whether execution succeeded */
	success: boolean;
	/** Final outputs */
	outputs: Record<string, any>;
	/** Execution duration in ms */
	durationMs: number;
	/** Summary of what was done */
	summary: string;
}

/**
 * Registered workflow.
 */
export interface RegisteredWorkflow {
	/** Workflow definition */
	definition: CognitiveWorkflowDefinition;
	/** Whether workflow is enabled */
	enabled: boolean;
	/** Last execution time */
	lastExecutionTime?: number;
	/** Total executions */
	executionCount: number;
	/** Success count */
	successCount: number;
}

export const ICognitiveWorkflowAutomationService = createDecorator<ICognitiveWorkflowAutomationService>('cognitiveWorkflowAutomationService');

/**
 * Service for cognitive workflow automation.
 * Allows defining and executing custom cognitive workflows.
 */
export interface ICognitiveWorkflowAutomationService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when a workflow execution starts.
	 */
	readonly onDidStartExecution: Event<WorkflowExecution>;

	/**
	 * Event fired when a workflow step completes.
	 */
	readonly onDidCompleteStep: Event<{ executionId: string; stepId: string; output: any }>;

	/**
	 * Event fired when a workflow execution completes.
	 */
	readonly onDidCompleteExecution: Event<WorkflowResult>;

	/**
	 * Event fired when a workflow execution fails.
	 */
	readonly onDidFailExecution: Event<{ executionId: string; error: WorkflowError }>;

	/**
	 * Register a workflow definition.
	 */
	registerWorkflow(definition: CognitiveWorkflowDefinition): void;

	/**
	 * Unregister a workflow.
	 */
	unregisterWorkflow(workflowId: string): void;

	/**
	 * Get all registered workflows.
	 */
	getWorkflows(): RegisteredWorkflow[];

	/**
	 * Get a specific workflow.
	 */
	getWorkflow(workflowId: string): RegisteredWorkflow | undefined;

	/**
	 * Enable or disable a workflow.
	 */
	setWorkflowEnabled(workflowId: string, enabled: boolean): void;

	/**
	 * Execute a workflow manually.
	 */
	executeWorkflow(workflowId: string, input?: Record<string, any>): Promise<WorkflowResult>;

	/**
	 * Cancel a running workflow execution.
	 */
	cancelExecution(executionId: string): void;

	/**
	 * Get current executions.
	 */
	getActiveExecutions(): WorkflowExecution[];

	/**
	 * Get execution history.
	 */
	getExecutionHistory(workflowId?: string, limit?: number): WorkflowExecution[];

	/**
	 * Parse a workflow definition from YAML or JSON string.
	 */
	parseWorkflowDefinition(content: string, format: 'yaml' | 'json'): CognitiveWorkflowDefinition;

	/**
	 * Validate a workflow definition.
	 */
	validateWorkflow(definition: CognitiveWorkflowDefinition): { valid: boolean; errors: string[] };
}

/**
 * Example workflow definitions.
 */
export const EXAMPLE_WORKFLOWS: CognitiveWorkflowDefinition[] = [
	{
		id: 'analyze-new-schema',
		name: 'Analyze New Database Schema',
		description: 'Automatically analyze newly connected database schemas',
		version: '1.0.0',
		steps: [
			{
				id: 'perceive-schema',
				name: 'Perceive Schema',
				agent: 'schema-perception',
				action: 'perceive_schema',
				input: { connectionId: '${trigger.connectionId}' },
				next: 'analyze-schema',
			},
			{
				id: 'analyze-schema',
				name: 'Analyze Schema',
				agent: 'schema-reasoner',
				action: 'analyze_schema',
				input: { schema: '${steps.perceive-schema.output}' },
				next: 'suggest-improvements',
			},
			{
				id: 'suggest-improvements',
				name: 'Suggest Improvements',
				agent: 'schema-reasoner',
				action: 'suggest_improvements',
				input: { schema: '${steps.perceive-schema.output}' },
			},
		],
		triggers: [
			{ type: 'event', event: 'connection.established' },
			{ type: 'manual' },
		],
	},
	{
		id: 'optimize-slow-query',
		name: 'Optimize Slow Query',
		description: 'Automatically analyze and optimize slow queries',
		version: '1.0.0',
		steps: [
			{
				id: 'analyze-query',
				name: 'Analyze Query',
				agent: 'sql-analyzer',
				action: 'analyze_query',
				input: { query: '${trigger.query}' },
				next: 'check-issues',
			},
			{
				id: 'check-issues',
				name: 'Check for Issues',
				agent: 'performance-advisor',
				action: 'analyze_performance',
				input: { query: '${trigger.query}' },
				condition: {
					type: 'output_check',
					stepId: 'analyze-query',
					field: 'complexity',
					operator: 'gt',
					value: 5,
				},
				next: 'optimize-query',
			},
			{
				id: 'optimize-query',
				name: 'Generate Optimized Query',
				agent: 'sql-analyzer',
				action: 'optimize_query',
				input: { query: '${trigger.query}' },
			},
		],
		triggers: [
			{ type: 'query_execution', conditions: [{ type: 'expression', expression: 'executionTime > 1000' }] },
			{ type: 'manual' },
		],
	},
	{
		id: 'analyze-query-results',
		name: 'Analyze Query Results',
		description: 'Detect patterns and anomalies in query results',
		version: '1.0.0',
		steps: [
			{
				id: 'detect-patterns',
				name: 'Detect Patterns',
				agent: 'data-pattern',
				action: 'detect_patterns',
				input: { data: '${trigger.results}' },
				next: ['identify-anomalies', 'generate-summary'],
			},
			{
				id: 'identify-anomalies',
				name: 'Identify Anomalies',
				agent: 'data-pattern',
				action: 'identify_anomalies',
				input: { data: '${trigger.results}' },
			},
			{
				id: 'generate-summary',
				name: 'Generate Summary',
				agent: 'data-pattern',
				action: 'generate_summary',
				input: { data: '${trigger.results}' },
			},
		],
		triggers: [
			{ type: 'event', event: 'query.completed' },
			{ type: 'manual' },
		],
	},
];
