/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { PerformanceAdvisorAgent } from 'sql/workbench/services/zonecog/browser/performanceAdvisorAgent';
import { NullLogService } from 'vs/platform/log/common/log';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';

suite('PerformanceAdvisorAgent', () => {
	let agent: PerformanceAdvisorAgent;
	let logService: NullLogService;
	let llmService: LLMProviderService;
	let membraneService: CognitiveMembraneService;
	let hypergraphStore: HypergraphStore;

	setup(() => {
		logService = new NullLogService();
		membraneService = new CognitiveMembraneService(logService);
		llmService = new LLMProviderService(logService, membraneService);
		hypergraphStore = new HypergraphStore(logService);
		agent = new PerformanceAdvisorAgent(logService, llmService, membraneService, hypergraphStore);
	});

	teardown(() => {
		agent.dispose();
		llmService.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});

	// --- Identity Tests ---

	test('should have correct identity', () => {
		assert.strictEqual(agent.id, 'performance-advisor-agent');
		assert.strictEqual(agent.name, 'Performance Advisor');
		assert.ok(agent.description.includes('performance'));
	});

	test('should have correct capabilities', () => {
		const caps = agent.getCapabilities();

		assert.strictEqual(caps.canPerceive, true);
		assert.strictEqual(caps.canReason, true);
		assert.strictEqual(caps.canAct, true);
		assert.ok(caps.supportedActions.includes('analyze_performance'));
		assert.ok(caps.supportedActions.includes('suggest_indexes'));
		assert.ok(caps.supportedActions.includes('identify_antipatterns'));
		assert.ok(caps.supportedActions.includes('generate_report'));
		assert.ok(caps.maxConcurrentTasks >= 1);
	});

	test('should start in idle status', () => {
		assert.strictEqual(agent.getStatus(), 'idle');
		assert.strictEqual(agent.getCurrentLoad(), 0);
	});

	// --- Performance Analysis Tests ---

	test('should detect SELECT * performance issue', async () => {
		const issues = await agent.analyzePerformance('SELECT * FROM users WHERE id = 1');

		const selectStarIssue = issues.find(i => i.type === 'select_star');
		assert.ok(selectStarIssue);
		assert.strictEqual(selectStarIssue.severity, 'medium');
	});

	test('should detect leading wildcard LIKE performance issue', async () => {
		const issues = await agent.analyzePerformance('SELECT name FROM users WHERE name LIKE \'%john%\'');

		const wildcardIssue = issues.find(i => i.type === 'leading_wildcard');
		assert.ok(wildcardIssue);
		assert.strictEqual(wildcardIssue.severity, 'high');
	});

	test('should detect implicit type conversion', async () => {
		const issues = await agent.analyzePerformance('SELECT * FROM users WHERE id = \'123\'');

		const conversionIssue = issues.find(i => i.type === 'implicit_conversion');
		assert.ok(conversionIssue);
	});

	test('should detect issues in execution plan', async () => {
		const issues = await agent.analyzePerformance(
			'SELECT * FROM users',
			'Table Scan: users, Rows: 10000'
		);

		const tableScanIssue = issues.find(i => i.type === 'table_scan');
		assert.ok(tableScanIssue);
		assert.strictEqual(tableScanIssue.severity, 'high');
	});

	test('should detect sort operation in execution plan', async () => {
		const issues = await agent.analyzePerformance(
			'SELECT * FROM users ORDER BY name',
			'Sort operation detected using filesort'
		);

		const sortIssue = issues.find(i => i.type === 'sort_operation');
		assert.ok(sortIssue);
		assert.strictEqual(sortIssue.severity, 'medium');
	});

	test('should detect temporary table usage in execution plan', async () => {
		const issues = await agent.analyzePerformance(
			'SELECT DISTINCT * FROM users',
			'Using temporary table for distinct operation'
		);

		const tempTableIssue = issues.find(i => i.type === 'temp_table');
		assert.ok(tempTableIssue);
	});

	// --- Index Suggestion Tests ---

	test('should suggest indexes based on WHERE clause patterns', async () => {
		const queries = [
			'SELECT * FROM users WHERE email = \'test@example.com\'',
			'SELECT * FROM users WHERE email = \'another@example.com\'',
			'SELECT * FROM users WHERE email = \'third@example.com\'',
		];

		const suggestions = await agent.suggestIndexes(queries);

		assert.ok(suggestions.length > 0);
		const emailIndex = suggestions.find(s => s.columns.includes('email'));
		assert.ok(emailIndex);
		assert.strictEqual(emailIndex.indexType, 'btree');
	});

	test('should suggest indexes based on JOIN patterns', async () => {
		const queries = [
			'SELECT * FROM orders o JOIN users u ON o.user_id = u.id',
			'SELECT * FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = \'pending\'',
		];

		const suggestions = await agent.suggestIndexes(queries);

		assert.ok(Array.isArray(suggestions));
	});

	test('should attribute subquery predicates to the subquery table', async () => {
		const queries = [
			'SELECT * FROM orders WHERE status = \'pending\' AND customer_id IN (SELECT id FROM customers WHERE region = \'EU\')',
		];

		const suggestions = await agent.suggestIndexes(queries);

		const ordersSuggestion = suggestions.find(s => s.tableName === 'orders');
		assert.ok(ordersSuggestion);
		assert.ok(ordersSuggestion.columns.includes('status'));
		assert.ok(!ordersSuggestion.columns.includes('region'));

		const customersSuggestion = suggestions.find(s => s.tableName === 'customers');
		assert.ok(customersSuggestion);
		assert.ok(customersSuggestion.columns.includes('region'));
	});

	// --- Anti-pattern Detection Tests ---

	test('should detect SELECT * anti-pattern', async () => {
		const antiPatterns = await agent.identifyAntiPatterns('SELECT * FROM users');

		assert.ok(antiPatterns.some(p => p.includes('SELECT *')));
	});

	test('should detect NOT IN with subquery anti-pattern', async () => {
		const antiPatterns = await agent.identifyAntiPatterns(
			'SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned_users)'
		);

		assert.ok(antiPatterns.some(p => p.includes('NOT IN')));
	});

	test('should detect leading wildcard LIKE anti-pattern', async () => {
		const antiPatterns = await agent.identifyAntiPatterns(
			'SELECT * FROM users WHERE name LIKE \'%john%\''
		);

		assert.ok(antiPatterns.some(p => p.includes('leading wildcard')));
	});

	test('should detect ORDER BY RAND() anti-pattern', async () => {
		const antiPatterns = await agent.identifyAntiPatterns(
			'SELECT * FROM users ORDER BY RAND() LIMIT 10'
		);

		assert.ok(antiPatterns.some(p => p.includes('RAND')));
	});

	test('should detect excessive UNION anti-pattern', async () => {
		const antiPatterns = await agent.identifyAntiPatterns(
			'SELECT * FROM a UNION SELECT * FROM b UNION SELECT * FROM c UNION SELECT * FROM d'
		);

		assert.ok(antiPatterns.some(p => p.includes('UNION')));
	});

	test('should detect deeply nested subqueries', async () => {
		const antiPatterns = await agent.identifyAntiPatterns(
			'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE product_id IN (SELECT id FROM products WHERE price > (SELECT AVG(price) FROM products)))'
		);

		assert.ok(antiPatterns.some(p => p.includes('nested')));
	});

	test('should detect function on column anti-pattern', async () => {
		const antiPatterns = await agent.identifyAntiPatterns(
			'SELECT * FROM users WHERE UPPER(name) = \'JOHN\''
		);

		assert.ok(antiPatterns.some(p => p.includes('Function')));
	});

	test('should detect DISTINCT without GROUP BY', async () => {
		const antiPatterns = await agent.identifyAntiPatterns(
			'SELECT DISTINCT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id'
		);

		assert.ok(antiPatterns.some(p => p.includes('DISTINCT')));
	});

	// --- Report Generation Tests ---

	test('should generate performance report', async () => {
		const queries = [
			'SELECT * FROM users WHERE id = 1',
			'SELECT * FROM orders WHERE user_id IN (SELECT id FROM users WHERE active = 1)',
		];

		const report = await agent.generateReport(queries);

		assert.ok(report);
		assert.ok(report.includes('Query Performance Report'));
		assert.ok(report.includes('Query 1'));
		assert.ok(report.includes('Query 2'));
		assert.ok(report.includes('Summary'));
	});

	test('should include index recommendations in report', async () => {
		const queries = [
			'SELECT * FROM orders o WHERE o.user_id = 1',
			'SELECT * FROM orders o WHERE o.user_id = 2',
		];

		const report = await agent.generateReport(queries);

		// Report should include some analysis
		assert.ok(report.includes('Analyzed Queries'));
	});

	// --- Perceive Tests ---

	test('should perceive performance observations', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.perceive({ executionTime: 1500, query: 'SELECT * FROM large_table' });

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('should assign high salience to slow queries', async () => {
		await agent.perceive({ executionTime: 2000, query: 'SELECT * FROM users' });

		const nodes = hypergraphStore.findNodesByType('performance_observation');
		const slowQueryNode = nodes.find(n => JSON.parse(n.content).executionTime > 1000);
		assert.ok(slowQueryNode);
		assert.ok(slowQueryNode.salience_score > 0.8);
	});

	// --- Decide Tests ---

	test('should decide to analyze performance when query and plan provided', async () => {
		const action = await agent.decide({
			query: 'SELECT * FROM users',
			executionPlan: 'Table Scan',
		});

		assert.ok(action);
		assert.strictEqual(action.action, 'analyze_performance');
		assert.ok(action.confidence > 0);
	});

	test('should decide to suggest indexes when queries array provided', async () => {
		const action = await agent.decide({
			queries: ['SELECT * FROM users WHERE id = 1', 'SELECT * FROM users WHERE email = \'x\''],
		});

		assert.ok(action);
		assert.strictEqual(action.action, 'suggest_indexes');
	});

	test('should return null for empty context', async () => {
		const action = await agent.decide({});

		assert.strictEqual(action, null);
	});

	// --- Execute Tests ---

	test('should execute analyze_performance action', async () => {
		const result = await agent.execute({
			action: 'analyze_performance',
			target: 'SELECT * FROM users WHERE name LIKE \'%test%\'',
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(Array.isArray(result));
	});

	test('should execute suggest_indexes action', async () => {
		const result = await agent.execute({
			action: 'suggest_indexes',
			target: JSON.stringify(['SELECT * FROM users WHERE email = \'x\'']),
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(Array.isArray(result));
	});

	test('should execute identify_antipatterns action', async () => {
		const result = await agent.execute({
			action: 'identify_antipatterns',
			target: 'SELECT * FROM users ORDER BY RAND()',
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(Array.isArray(result));
	});

	test('should execute generate_report action', async () => {
		const result = await agent.execute({
			action: 'generate_report',
			target: JSON.stringify(['SELECT * FROM users']),
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(typeof result === 'string');
		assert.ok(result.includes('Query Performance Report'));
	});

	test('should throw for unknown action', async () => {
		try {
			await agent.execute({
				action: 'unknown_action',
				target: '',
				parameters: {},
				confidence: 1.0,
			});
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
	});

	// --- Event Tests ---

	test('should fire status change events', async () => {
		let statusChanges: string[] = [];
		agent.onDidChangeStatus(status => {
			statusChanges.push(status);
		});

		await agent.analyzePerformance('SELECT * FROM users');

		assert.ok(statusChanges.includes('active'));
		assert.ok(statusChanges.includes('idle'));
	});

	// --- Membrane Activity Tests ---

	test('should record membrane activity on perceive', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		await agent.perceive({ executionTime: 100 });

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	test('should record membrane activity on analyze', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		await agent.analyzePerformance('SELECT * FROM users');

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	// --- Hypergraph Storage Tests ---

	test('should store analysis in hypergraph', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.analyzePerformance('SELECT * FROM users WHERE name LIKE \'%test%\'');

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('should store performance analysis with correct node type', async () => {
		await agent.analyzePerformance('SELECT * FROM orders');

		const nodes = hypergraphStore.findNodesByType('performance_analysis');
		assert.ok(nodes.length > 0);
	});
});
