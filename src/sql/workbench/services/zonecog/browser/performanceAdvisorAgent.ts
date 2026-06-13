/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	IPerformanceAdvisorAgent,
	SQLPerformanceIssue,
	SQLIndexSuggestion,
} from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { AgentCapabilities, AgentStatus, AgentAction } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IHypergraphStore, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

/**
 * Performance Advisor Agent Implementation.
 * Provides query optimization suggestions and performance analysis.
 */
export class PerformanceAdvisorAgent extends Disposable implements IPerformanceAdvisorAgent {
	readonly _serviceBrand: undefined;

	readonly id: string = 'performance-advisor-agent';
	readonly name: string = 'Performance Advisor';
	readonly description: string = 'Query optimization and performance analysis';

	private _status: AgentStatus = 'idle';
	private _currentLoad: number = 0;

	private readonly _onDidChangeStatus = this._register(new Emitter<AgentStatus>());
	readonly onDidChangeStatus: Event<AgentStatus> = this._onDidChangeStatus.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILLMProviderService private readonly llmService: ILLMProviderService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super();
		this.logService.info('[PerformanceAdvisorAgent] Initialized');
	}

	getCapabilities(): AgentCapabilities {
		return {
			canPerceive: true,
			canReason: true,
			canAct: true,
			supportedActions: ['analyze_performance', 'suggest_indexes', 'identify_antipatterns', 'generate_report'],
			maxConcurrentTasks: 2,
		};
	}

	getStatus(): AgentStatus {
		return this._status;
	}

	getCurrentLoad(): number {
		return this._currentLoad;
	}

	async perceive(input: any): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		// Store performance observations in hypergraph
		if (typeof input === 'object' && input.executionTime !== undefined) {
			const node: Omit<HypergraphNode, 'id'> = {
				node_type: 'performance_observation',
				content: JSON.stringify(input),
				links: [],
				metadata: {
					perceived_at: Date.now(),
					agent: this.id,
				},
				salience_score: input.executionTime > 1000 ? 0.9 : 0.5,
			};
			await this.hypergraphStore.addNode(node);
		}
	}

	async decide(context: any): Promise<AgentAction | null> {
		this.membraneService.recordActivity('cerebral');

		if (context.query && context.executionPlan) {
			return {
				action: 'analyze_performance',
				target: context.query,
				parameters: { executionPlan: context.executionPlan },
				confidence: 0.9,
			};
		}

		if (context.queries && Array.isArray(context.queries)) {
			return {
				action: 'suggest_indexes',
				target: JSON.stringify(context.queries),
				parameters: {},
				confidence: 0.85,
			};
		}

		return null;
	}

	async execute(action: AgentAction): Promise<any> {
		this.membraneService.recordActivity('somatic');
		this._status = 'active';
		this._currentLoad += 0.5;
		this._onDidChangeStatus.fire(this._status);

		try {
			switch (action.action) {
				case 'analyze_performance':
					return await this.analyzePerformance(action.target, action.parameters?.executionPlan);
				case 'suggest_indexes':
					return await this.suggestIndexes(JSON.parse(action.target));
				case 'identify_antipatterns':
					return await this.identifyAntiPatterns(action.target);
				case 'generate_report':
					return await this.generateReport(JSON.parse(action.target));
				default:
					throw new Error(`Unknown action: ${action.action}`);
			}
		} finally {
			this._currentLoad = Math.max(0, this._currentLoad - 0.5);
			this._status = this._currentLoad > 0 ? 'active' : 'idle';
			this._onDidChangeStatus.fire(this._status);
		}
	}

	async analyzePerformance(query: string, executionPlan?: string): Promise<SQLPerformanceIssue[]> {
		this.membraneService.recordActivity('cerebral');
		this.logService.info('[PerformanceAdvisorAgent] Analyzing query performance...');

		const issues: SQLPerformanceIssue[] = [];

		// Analyze the query structure
		issues.push(...this._analyzeQueryStructure(query));

		// Analyze execution plan if provided
		if (executionPlan) {
			issues.push(...this._analyzeExecutionPlan(executionPlan));
		}

		// Store analysis results
		await this._storeAnalysis(query, issues);

		return issues;
	}

	async suggestIndexes(queries: string[]): Promise<SQLIndexSuggestion[]> {
		this.membraneService.recordActivity('cerebral');
		this.logService.info(`[PerformanceAdvisorAgent] Suggesting indexes for ${queries.length} queries...`);

		const suggestions: SQLIndexSuggestion[] = [];
		const columnUsage = new Map<string, Map<string, number>>();

		// Analyze each query for column usage patterns
		for (const query of queries) {
			this._extractColumnUsage(query, columnUsage);
		}

		// Generate index suggestions based on usage patterns
		for (const [table, columns] of columnUsage) {
			const sortedColumns = Array.from(columns.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3);

			if (sortedColumns.length > 0) {
				suggestions.push({
					tableName: table,
					columns: sortedColumns.map(([col]) => col),
					indexType: 'btree',
					estimatedImprovement: this._estimateImprovement(sortedColumns[0][1], queries.length),
					reasoning: `Columns frequently used in WHERE/JOIN clauses across ${queries.length} queries`,
				});
			}
		}

		return suggestions;
	}

	async identifyAntiPatterns(query: string): Promise<string[]> {
		this.membraneService.recordActivity('cerebral');
		this.logService.info('[PerformanceAdvisorAgent] Identifying anti-patterns...');

		const antiPatterns: string[] = [];

		// SELECT *
		if (/SELECT\s+\*/i.test(query)) {
			antiPatterns.push('SELECT * (retrieves unnecessary columns)');
		}

		// NOT IN with subquery
		if (/NOT\s+IN\s*\(\s*SELECT/i.test(query)) {
			antiPatterns.push('NOT IN with subquery (consider using NOT EXISTS or LEFT JOIN)');
		}

		// Multiple table scans via UNION
		if ((query.match(/\bUNION\b/gi) || []).length > 2) {
			antiPatterns.push('Excessive UNION operations (consider alternative approaches)');
		}

		// Nested subqueries
		const subqueryDepth = (query.match(/\(\s*SELECT/gi) || []).length;
		if (subqueryDepth > 2) {
			antiPatterns.push(`Deeply nested subqueries (depth: ${subqueryDepth}, consider CTEs or joins)`);
		}

		// DISTINCT without necessity
		if (/SELECT\s+DISTINCT/i.test(query) && !/GROUP\s+BY/i.test(query)) {
			antiPatterns.push('DISTINCT without GROUP BY (may indicate join issues)');
		}

		// ORDER BY RAND()
		if (/ORDER\s+BY\s+(RAND|RANDOM)\s*\(\)/i.test(query)) {
			antiPatterns.push('ORDER BY RAND() (very expensive, consider alternative randomization)');
		}

		// LIKE without leading wildcard is fine, but with leading wildcard
		if (/LIKE\s+['"]%/i.test(query)) {
			antiPatterns.push('LIKE with leading wildcard (prevents index usage)');
		}

		// IN with large list
		const inMatches = query.match(/\bIN\s*\([^)]+\)/gi) || [];
		for (const inMatch of inMatches) {
			const itemCount = (inMatch.match(/,/g) || []).length + 1;
			if (itemCount > 100) {
				antiPatterns.push(`IN clause with ${itemCount} items (consider using a temp table or join)`);
			}
		}

		// Functions on indexed columns
		if (/WHERE.*\b(DATE|YEAR|MONTH|UPPER|LOWER|TRIM|SUBSTRING)\s*\(/i.test(query)) {
			antiPatterns.push('Function applied to column in WHERE (prevents index usage)');
		}

		// Cross join (implicit or explicit)
		if (/CROSS\s+JOIN/i.test(query) || /FROM\s+\w+\s*,\s*\w+[^)]*WHERE/i.test(query)) {
			if (!/WHERE/i.test(query) || /FROM\s+\w+\s*,\s*\w+\s*[;\s]*$/i.test(query)) {
				antiPatterns.push('Cartesian product (CROSS JOIN or missing join condition)');
			}
		}

		return antiPatterns;
	}

	async generateReport(queries: string[]): Promise<string> {
		this.membraneService.recordActivity('cerebral');
		this.logService.info(`[PerformanceAdvisorAgent] Generating report for ${queries.length} queries...`);

		let report = `# Query Performance Report\n\n`;
		report += `**Analyzed Queries:** ${queries.length}\n`;
		report += `**Generated:** ${new Date().toISOString()}\n\n`;

		// Analyze each query
		let totalIssues = 0;
		let totalAntiPatterns = 0;

		report += `## Query Analysis\n\n`;

		for (let i = 0; i < queries.length; i++) {
			const query = queries[i];
			const issues = await this.analyzePerformance(query);
			const antiPatterns = await this.identifyAntiPatterns(query);

			totalIssues += issues.length;
			totalAntiPatterns += antiPatterns.length;

			report += `### Query ${i + 1}\n\n`;
			report += '```sql\n' + query.substring(0, 200) + (query.length > 200 ? '...' : '') + '\n```\n\n';

			if (issues.length > 0) {
				report += `**Performance Issues (${issues.length}):**\n`;
				for (const issue of issues) {
					report += `- [${issue.severity.toUpperCase()}] ${issue.description}\n`;
				}
				report += '\n';
			}

			if (antiPatterns.length > 0) {
				report += `**Anti-patterns (${antiPatterns.length}):**\n`;
				for (const pattern of antiPatterns) {
					report += `- ${pattern}\n`;
				}
				report += '\n';
			}
		}

		// Index suggestions
		const indexSuggestions = await this.suggestIndexes(queries);

		if (indexSuggestions.length > 0) {
			report += `## Index Recommendations\n\n`;
			for (const suggestion of indexSuggestions) {
				report += `### ${suggestion.tableName}\n`;
				report += `- **Columns:** ${suggestion.columns.join(', ')}\n`;
				report += `- **Type:** ${suggestion.indexType}\n`;
				report += `- **Expected Improvement:** ${suggestion.estimatedImprovement}\n`;
				report += `- **Reasoning:** ${suggestion.reasoning}\n\n`;
			}
		}

		// Summary
		report += `## Summary\n\n`;
		report += `| Metric | Value |\n`;
		report += `|--------|-------|\n`;
		report += `| Total Queries | ${queries.length} |\n`;
		report += `| Performance Issues | ${totalIssues} |\n`;
		report += `| Anti-patterns | ${totalAntiPatterns} |\n`;
		report += `| Index Recommendations | ${indexSuggestions.length} |\n`;

		return report;
	}

	private _analyzeQueryStructure(query: string): SQLPerformanceIssue[] {
		const issues: SQLPerformanceIssue[] = [];

		// Same checks as SQLAnalyzerAgent but focused on performance
		if (/SELECT\s+\*/i.test(query)) {
			issues.push({
				severity: 'medium',
				type: 'select_star',
				description: 'SELECT * retrieves all columns which may transfer unnecessary data',
				suggestedFix: 'List only required columns explicitly',
			});
		}

		if (/LIKE\s+['"]%/i.test(query)) {
			issues.push({
				severity: 'high',
				type: 'leading_wildcard',
				description: 'Leading wildcard in LIKE prevents index usage',
				suggestedFix: 'Use full-text search or restructure the query',
			});
		}

		// Check for correlated subqueries
		if (/WHERE.*\(\s*SELECT.*\bOUTER\b/i.test(query) ||
			/WHERE.*EXISTS\s*\(\s*SELECT.*WHERE.*\.\w+\s*=\s*\w+\.\w+/i.test(query)) {
			issues.push({
				severity: 'high',
				type: 'correlated_subquery',
				description: 'Correlated subquery executes once per row of outer query',
				suggestedFix: 'Consider using a JOIN or window function instead',
			});
		}

		// Check for implicit type conversion
		if (/=\s*['"]\d+['"]|=\s*\d+['"]/i.test(query)) {
			issues.push({
				severity: 'low',
				type: 'implicit_conversion',
				description: 'Implicit type conversion may prevent index usage',
				suggestedFix: 'Use matching data types in comparisons',
			});
		}

		return issues;
	}

	private _analyzeExecutionPlan(plan: string): SQLPerformanceIssue[] {
		const issues: SQLPerformanceIssue[] = [];

		// Look for common execution plan issues
		if (/Table Scan|Seq Scan|Full Table Scan/i.test(plan)) {
			issues.push({
				severity: 'high',
				type: 'table_scan',
				description: 'Full table scan detected - no index being used',
				suggestedFix: 'Add an appropriate index on the filtered columns',
			});
		}

		if (/Sort|filesort/i.test(plan)) {
			issues.push({
				severity: 'medium',
				type: 'sort_operation',
				description: 'Sort operation in execution plan',
				suggestedFix: 'Consider adding an index to support the ORDER BY',
			});
		}

		if (/Using temporary|Temporary Table/i.test(plan)) {
			issues.push({
				severity: 'medium',
				type: 'temp_table',
				description: 'Temporary table created during query execution',
				suggestedFix: 'Optimize the query to avoid materializing intermediate results',
			});
		}

		if (/Nested Loop/i.test(plan)) {
			issues.push({
				severity: 'low',
				type: 'nested_loop',
				description: 'Nested loop join detected - may be slow for large datasets',
				location: 'Join operation',
				suggestedFix: 'Ensure join columns are indexed',
			});
		}

		return issues;
	}

	private _extractColumnUsage(query: string, usage: Map<string, Map<string, number>>): void {
		// Extract table.column patterns from WHERE and JOIN clauses
		const patterns = [
			/WHERE\s+(\w+)\.(\w+)\s*(?:=|<|>|<=|>=|<>|!=|LIKE|IN)/gi,
			/ON\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/gi,
			/AND\s+(\w+)\.(\w+)\s*(?:=|<|>|<=|>=|<>|!=|LIKE|IN)/gi,
		];

		for (const pattern of patterns) {
			let match;
			while ((match = pattern.exec(query)) !== null) {
				const table = match[1];
				const column = match[2];

				if (!usage.has(table)) {
					usage.set(table, new Map());
				}
				const tableUsage = usage.get(table)!;
				tableUsage.set(column, (tableUsage.get(column) || 0) + 1);
			}
		}
	}

	private _estimateImprovement(usageCount: number, totalQueries: number): string {
		const percentage = (usageCount / totalQueries) * 100;

		if (percentage > 50) {
			return 'High - would benefit majority of queries';
		} else if (percentage > 20) {
			return 'Medium - would benefit significant portion of queries';
		} else {
			return 'Low - would benefit some queries';
		}
	}

	private async _storeAnalysis(query: string, issues: SQLPerformanceIssue[]): Promise<void> {
		const node: Omit<HypergraphNode, 'id'> = {
			node_type: 'performance_analysis',
			content: JSON.stringify({ query: query.substring(0, 500), issues }),
			links: [],
			metadata: {
				issue_count: issues.length,
				high_severity_count: issues.filter(i => i.severity === 'high' || i.severity === 'critical').length,
				analyzed_at: Date.now(),
				agent: this.id,
			},
			salience_score: 0.5 + (issues.length * 0.1),
		};
		await this.hypergraphStore.addNode(node);
	}
}
