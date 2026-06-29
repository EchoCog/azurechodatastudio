"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXAMPLE_WORKFLOWS = exports.ICognitiveWorkflowAutomationService = void 0;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
exports.ICognitiveWorkflowAutomationService = (0, instantiation_1.createDecorator)('cognitiveWorkflowAutomationService');
/**
 * Example workflow definitions.
 */
exports.EXAMPLE_WORKFLOWS = [
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
