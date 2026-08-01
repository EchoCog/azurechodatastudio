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
exports.SQLAnalyzerAgent = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
const llmProvider_1 = require("sql/workbench/services/zonecog/common/llmProvider");
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const zonecogService_2 = require("sql/workbench/services/zonecog/common/zonecogService");
/**
 * SQL Analyzer Agent Implementation.
 * Provides deep SQL query analysis using LLM and pattern matching.
 */
let SQLAnalyzerAgent = class SQLAnalyzerAgent extends lifecycle_1.Disposable {
	logService;
	llmService;
	membraneService;
	hypergraphStore;
	_serviceBrand;
	id = 'sql-analyzer-agent';
	name = 'SQL Analyzer';
	description = 'Deep SQL query analysis and optimization';
	_status = 'idle';
	_currentLoad = 0;
	_onDidChangeStatus = this._register(new event_1.Emitter());
	onDidChangeStatus = this._onDidChangeStatus.event;
	constructor(logService, llmService, membraneService, hypergraphStore) {
		super();
		this.logService = logService;
		this.llmService = llmService;
		this.membraneService = membraneService;
		this.hypergraphStore = hypergraphStore;
		this.logService.info('[SQLAnalyzerAgent] Initialized');
	}
	getCapabilities() {
		return {
			canPerceive: true,
			canReason: true,
			canAct: true,
			supportedActions: ['analyze_query', 'optimize_query', 'explain_plan', 'nl_to_sql', 'sql_to_nl'],
			maxConcurrentTasks: 3,
		};
	}
	getStatus() {
		return this._status;
	}
	getCurrentLoad() {
		return this._currentLoad;
	}
	async perceive(input) {
		this.membraneService.recordActivity('cerebral');
		if (typeof input === 'string' && this._looksLikeSQL(input)) {
			// Store perceived query in hypergraph
			const node = {
				node_type: 'sql_query',
				content: input,
				links: [],
				metadata: {
					perceived_at: Date.now(),
					agent: this.id,
				},
				salience_score: 0.6,
			};
			await this.hypergraphStore.addNode(node);
		}
	}
	async decide(context) {
		this.membraneService.recordActivity('cerebral');
		if (context.query && typeof context.query === 'string') {
			return {
				action: 'analyze_query',
				target: context.query,
				parameters: {},
				confidence: 0.9,
			};
		}
		return null;
	}
	async execute(action) {
		this.membraneService.recordActivity('somatic');
		this._status = 'active';
		this._currentLoad += 0.33;
		this._onDidChangeStatus.fire(this._status);
		try {
			switch (action.action) {
				case 'analyze_query':
					return await this.analyzeQuery(action.target);
				case 'optimize_query':
					return await this.optimizeQuery(action.target);
				case 'explain_plan':
					return await this.explainPlan(action.target);
				case 'nl_to_sql':
					return await this.naturalLanguageToSQL(action.target, typeof action.parameters?.schemaContext === 'string' ? action.parameters.schemaContext : undefined);
				case 'sql_to_nl':
					return await this.sqlToNaturalLanguage(action.target);
				default:
					throw new Error(`Unknown action: ${action.action}`);
			}
		}
		finally {
			this._currentLoad = Math.max(0, this._currentLoad - 0.33);
			this._status = this._currentLoad > 0 ? 'active' : 'idle';
			this._onDidChangeStatus.fire(this._status);
		}
	}
	async analyzeQuery(query) {
		this.membraneService.recordActivity('cerebral');
		this.logService.info(`[SQLAnalyzerAgent] Analyzing query: ${query.substring(0, 100)}...`);
		// Parse query structure
		const queryType = this._detectQueryType(query);
		const tablesReferenced = this._extractTables(query);
		const columnsReferenced = this._extractColumns(query);
		const joins = this._extractJoins(query);
		const aggregations = this._extractAggregations(query);
		const windowFunctions = this._extractWindowFunctions(query);
		const subqueries = this._extractSubqueries(query);
		// Calculate complexity
		const complexity = this._calculateComplexity(query, joins.length, subqueries.length, aggregations.length);
		// Detect performance issues
		const performanceIssues = await this._detectPerformanceIssues(query, tablesReferenced, joins);
		// Suggest indexes
		const suggestedIndexes = this._suggestIndexes(query, tablesReferenced, columnsReferenced);
		// Get semantic understanding via LLM
		const semanticIntent = await this._getSemanticIntent(query);
		const result = {
			queryText: query,
			queryType,
			tablesReferenced,
			columnsReferenced,
			joins,
			subqueries,
			aggregations,
			windowFunctions,
			complexity,
			performanceIssues,
			suggestedIndexes,
			semanticIntent,
		};
		// Store analysis in hypergraph
		await this._storeAnalysis(query, result);
		return result;
	}
	async explainPlan(query) {
		this.membraneService.recordActivity('cerebral');
		const prompt = `Explain the likely execution plan for this SQL query in simple terms:

${query}

Describe:
1. The order of operations
2. Which tables are scanned first
3. How joins are likely processed
4. Any potential bottlenecks

Keep the explanation concise and actionable.`;
		return await this.llmService.complete(prompt);
	}
	async optimizeQuery(query) {
		this.membraneService.recordActivity('cerebral');
		// First analyze the query
		const analysis = await this.analyzeQuery(query);
		// Build optimization context
		let optimizationContext = `Original query:\n${query}\n\nIssues found:\n`;
		for (const issue of analysis.performanceIssues) {
			optimizationContext += `- ${issue.description}\n`;
		}
		const prompt = `${optimizationContext}

Please provide an optimized version of this SQL query that addresses the issues above.
Only return the optimized SQL query, no explanations.`;
		return await this.llmService.complete(prompt);
	}
	async naturalLanguageToSQL(description, schemaContext) {
		this.membraneService.recordActivity('cerebral');
		let prompt = `Convert the following natural language description to SQL:\n\n"${description}"\n`;
		if (schemaContext) {
			prompt += `\nAvailable schema:\n${schemaContext}\n`;
		}
		prompt += '\nReturn only the SQL query, no explanations.';
		return await this.llmService.complete(prompt);
	}
	async sqlToNaturalLanguage(query) {
		this.membraneService.recordActivity('cerebral');
		const prompt = `Explain what this SQL query does in plain English:

${query}

Provide a clear, concise explanation that a non-technical person could understand.`;
		return await this.llmService.complete(prompt);
	}
	_looksLikeSQL(text) {
		const sqlKeywords = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|ORDER BY|GROUP BY)\b/i;
		return sqlKeywords.test(text);
	}
	_detectQueryType(query) {
		const normalized = query.trim().toUpperCase();
		if (normalized.startsWith('SELECT'))
			return 'SELECT';
		if (normalized.startsWith('INSERT'))
			return 'INSERT';
		if (normalized.startsWith('UPDATE'))
			return 'UPDATE';
		if (normalized.startsWith('DELETE'))
			return 'DELETE';
		if (normalized.startsWith('CREATE'))
			return 'CREATE';
		if (normalized.startsWith('ALTER'))
			return 'ALTER';
		if (normalized.startsWith('DROP'))
			return 'DROP';
		return 'OTHER';
	}
	_extractTables(query) {
		const tables = [];
		const tablePatterns = [
			/FROM\s+(\w+)/gi,
			/JOIN\s+(\w+)/gi,
			/INTO\s+(\w+)/gi,
			/UPDATE\s+(\w+)/gi,
		];
		for (const pattern of tablePatterns) {
			let match;
			while ((match = pattern.exec(query)) !== null) {
				if (!tables.includes(match[1])) {
					tables.push(match[1]);
				}
			}
		}
		return tables;
	}
	_extractColumns(query) {
		const columns = [];
		// Simple column extraction from SELECT clause
		const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/is);
		if (selectMatch) {
			const columnsPart = selectMatch[1];
			const columnMatches = columnsPart.match(/(\w+(?:\.\w+)?)/g);
			if (columnMatches) {
				for (const col of columnMatches) {
					if (!['AS', 'DISTINCT', 'ALL'].includes(col.toUpperCase()) && !columns.includes(col)) {
						columns.push(col);
					}
				}
			}
		}
		return columns;
	}
	_extractJoins(query) {
		const joins = [];
		const joinPattern = /(INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\s+(\w+)\s+(?:AS\s+\w+\s+)?ON\s+(\w+(?:\.\w+)?)\s*=\s*(\w+(?:\.\w+)?)/gi;
		let match;
		while ((match = joinPattern.exec(query)) !== null) {
			const joinType = (match[1] || 'INNER').toUpperCase();
			const rightTable = match[2];
			const leftCol = match[3];
			const rightCol = match[4];
			const leftTable = leftCol.includes('.') ? leftCol.split('.')[0] : '';
			joins.push({
				type: joinType,
				leftTable,
				rightTable,
				condition: `${leftCol} = ${rightCol}`,
			});
		}
		return joins;
	}
	_extractAggregations(query) {
		const aggregations = [];
		const aggFunctions = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'STRING_AGG'];
		for (const func of aggFunctions) {
			const pattern = new RegExp(`\\b${func}\\s*\\(`, 'gi');
			if (pattern.test(query)) {
				aggregations.push(func);
			}
		}
		return aggregations;
	}
	_extractWindowFunctions(query) {
		const windowFuncs = [];
		const windowPattern = /(\w+)\s*\(\s*\)\s*OVER\s*\(/gi;
		let match;
		while ((match = windowPattern.exec(query)) !== null) {
			if (!windowFuncs.includes(match[1].toUpperCase())) {
				windowFuncs.push(match[1].toUpperCase());
			}
		}
		return windowFuncs;
	}
	_extractSubqueries(query) {
		const subqueries = [];
		for (let i = 0; i < query.length; i++) {
			if (query[i] === '(' && query.substring(i).match(/^\(\s*SELECT/i)) {
				// Find matching closing paren
				let parenCount = 1;
				let j = i + 1;
				while (j < query.length && parenCount > 0) {
					if (query[j] === '(')
						parenCount++;
					if (query[j] === ')')
						parenCount--;
					j++;
				}
				const subquery = query.substring(i + 1, j - 1).trim();
				subqueries.push({
					query: subquery,
					location: this._detectSubqueryLocation(query, i),
					isCorrelated: /\bOUTER\b/i.test(subquery) || this._hasCorrelatedReference(subquery, query),
				});
			}
		}
		return subqueries;
	}
	_detectSubqueryLocation(query, position) {
		const before = query.substring(0, position).toUpperCase();
		if (before.lastIndexOf('SELECT') > before.lastIndexOf('FROM'))
			return 'SELECT';
		if (before.lastIndexOf('FROM') > before.lastIndexOf('WHERE'))
			return 'FROM';
		if (before.lastIndexOf('WHERE') > before.lastIndexOf('HAVING'))
			return 'WHERE';
		return 'HAVING';
	}
	_hasCorrelatedReference(subquery, parentQuery) {
		// Simplified correlation detection
		const parentTables = this._extractTables(parentQuery);
		for (const table of parentTables) {
			if (new RegExp(`\\b${table}\\.`, 'i').test(subquery)) {
				return true;
			}
		}
		return false;
	}
	_calculateComplexity(query, joinCount, subqueryCount, aggCount) {
		let complexity = 1;
		// Length factor
		complexity += Math.min(3, Math.floor(query.length / 500));
		// Join complexity
		complexity += Math.min(3, joinCount);
		// Subquery complexity
		complexity += subqueryCount * 2;
		// Aggregation complexity
		complexity += Math.min(2, aggCount);
		// UNION/INTERSECT/EXCEPT
		if (/\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/i.test(query)) {
			complexity += 1;
		}
		return Math.min(10, complexity);
	}
	async _detectPerformanceIssues(query, tables, joins) {
		const issues = [];
		// SELECT *
		if (/SELECT\s+\*/i.test(query)) {
			issues.push({
				severity: 'medium',
				type: 'select_star',
				description: 'SELECT * retrieves all columns, which may be inefficient',
				suggestedFix: 'Specify only the columns you need',
			});
		}
		// No WHERE clause on large operations
		if (!/ WHERE /i.test(query) && tables.length > 0) {
			issues.push({
				severity: 'medium',
				type: 'missing_where',
				description: 'Query has no WHERE clause - may scan entire table(s)',
				suggestedFix: 'Add filtering conditions if possible',
			});
		}
		// OR in WHERE (can prevent index usage)
		if (/WHERE.*\bOR\b/i.test(query)) {
			issues.push({
				severity: 'low',
				type: 'or_condition',
				description: 'OR conditions may prevent index usage',
				suggestedFix: 'Consider using UNION or restructuring the query',
			});
		}
		// LIKE with leading wildcard
		if (/LIKE\s+['"]%/i.test(query)) {
			issues.push({
				severity: 'high',
				type: 'leading_wildcard',
				description: 'LIKE pattern starting with % cannot use indexes',
				suggestedFix: 'Use full-text search or restructure the search',
			});
		}
		// Function on indexed column in WHERE
		if (/WHERE.*\b(UPPER|LOWER|TRIM|SUBSTRING|DATE|YEAR|MONTH)\s*\(/i.test(query)) {
			issues.push({
				severity: 'medium',
				type: 'function_on_column',
				description: 'Functions on columns in WHERE may prevent index usage',
				suggestedFix: 'Store computed values or use functional indexes',
			});
		}
		// Implicit type conversion
		if (/=\s*['"]\d+['"]/i.test(query)) {
			issues.push({
				severity: 'low',
				type: 'implicit_conversion',
				description: 'Possible implicit type conversion (number as string)',
				suggestedFix: 'Use correct data types in comparisons',
			});
		}
		// Cartesian product (CROSS JOIN or missing join condition)
		if (tables.length > 1 && joins.length === 0 && /FROM\s+\w+\s*,\s*\w+/i.test(query)) {
			issues.push({
				severity: 'critical',
				type: 'cartesian_product',
				description: 'Possible cartesian product - missing JOIN condition',
				suggestedFix: 'Add proper JOIN conditions between tables',
			});
		}
		// ORDER BY with LIMIT but no index
		if (/ORDER BY.*LIMIT/i.test(query)) {
			issues.push({
				severity: 'low',
				type: 'order_limit',
				description: 'ORDER BY with LIMIT may require full sort if no supporting index',
				suggestedFix: 'Ensure indexes support the ORDER BY columns',
			});
		}
		return issues;
	}
	_suggestIndexes(query, tables, columns) {
		const suggestions = [];
		// Extract WHERE clause columns
		const whereMatch = query.match(/WHERE\s+(.+?)(?:ORDER BY|GROUP BY|HAVING|LIMIT|$)/is);
		if (whereMatch) {
			const whereClause = whereMatch[1];
			const whereColumns = whereClause.match(/(\w+)\s*(?:=|<|>|<=|>=|<>|!=|LIKE|IN)/gi);
			if (whereColumns) {
				const uniqueCols = [...new Set(whereColumns.map(c => c.split(/\s+/)[0]))];
				if (uniqueCols.length > 0 && tables.length > 0) {
					suggestions.push({
						tableName: tables[0],
						columns: uniqueCols,
						indexType: 'btree',
						estimatedImprovement: 'Significant for filtered queries',
						reasoning: 'Columns used in WHERE clause filtering',
					});
				}
			}
		}
		// Extract ORDER BY columns
		const orderMatch = query.match(/ORDER BY\s+(.+?)(?:LIMIT|$)/is);
		if (orderMatch) {
			const orderCols = orderMatch[1].split(',').map(c => c.trim().split(/\s+/)[0]);
			if (orderCols.length > 0 && tables.length > 0) {
				suggestions.push({
					tableName: tables[0],
					columns: orderCols,
					indexType: 'btree',
					estimatedImprovement: 'Eliminates sort operation',
					reasoning: 'Columns used in ORDER BY clause',
				});
			}
		}
		return suggestions;
	}
	async _getSemanticIntent(query) {
		try {
			const prompt = `In one sentence, describe what this SQL query is trying to accomplish:\n\n${query}`;
			return await this.llmService.complete(prompt);
		}
		catch {
			return 'Unable to determine semantic intent';
		}
	}
	async _storeAnalysis(query, result) {
		const node = {
			node_type: 'sql_analysis',
			content: JSON.stringify(result),
			links: [],
			metadata: {
				query_hash: this._hashQuery(query),
				complexity: result.complexity,
				issue_count: result.performanceIssues.length,
				analyzed_at: Date.now(),
			},
			salience_score: 0.5 + (result.complexity / 20),
		};
		await this.hypergraphStore.addNode(node);
	}
	_hashQuery(query) {
		// Simple hash for query deduplication
		let hash = 0;
		for (let i = 0; i < query.length; i++) {
			const char = query.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return hash.toString(16);
	}
};
exports.SQLAnalyzerAgent = SQLAnalyzerAgent;
exports.SQLAnalyzerAgent = SQLAnalyzerAgent = __decorate([
	__param(0, log_1.ILogService),
	__param(1, llmProvider_1.ILLMProviderService),
	__param(2, zonecogService_1.ICognitiveMembraneService),
	__param(3, zonecogService_2.IHypergraphStore)
], SQLAnalyzerAgent);
