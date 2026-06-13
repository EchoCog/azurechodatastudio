/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SQLAnalyzerAgent } from 'sql/workbench/services/zonecog/browser/sqlAnalyzerAgent';
import { NullLogService } from 'vs/platform/log/common/log';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';

suite('SQLAnalyzerAgent', () => {
	let agent: SQLAnalyzerAgent;
	let logService: NullLogService;
	let llmService: LLMProviderService;
	let membraneService: CognitiveMembraneService;
	let hypergraphStore: HypergraphStore;

	setup(() => {
		logService = new NullLogService();
		membraneService = new CognitiveMembraneService(logService);
		llmService = new LLMProviderService(logService, membraneService);
		hypergraphStore = new HypergraphStore(logService);
		agent = new SQLAnalyzerAgent(logService, llmService, membraneService, hypergraphStore);
	});

	teardown(() => {
		agent.dispose();
		llmService.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});

	test('should have correct identity', () => {
		assert.strictEqual(agent.id, 'sql-analyzer-agent');
		assert.strictEqual(agent.name, 'SQL Analyzer');
		assert.ok(agent.description.includes('SQL'));
	});

	test('should have correct capabilities', () => {
		const caps = agent.getCapabilities();

		assert.strictEqual(caps.canPerceive, true);
		assert.strictEqual(caps.canReason, true);
		assert.strictEqual(caps.canAct, true);
		assert.ok(caps.supportedActions.includes('analyze_query'));
		assert.ok(caps.supportedActions.includes('optimize_query'));
		assert.ok(caps.supportedActions.includes('explain_plan'));
		assert.ok(caps.supportedActions.includes('nl_to_sql'));
		assert.ok(caps.supportedActions.includes('sql_to_nl'));
		assert.ok(caps.maxConcurrentTasks >= 1);
	});

	test('should start in idle status', () => {
		assert.strictEqual(agent.getStatus(), 'idle');
		assert.strictEqual(agent.getCurrentLoad(), 0);
	});

	test('should detect SELECT query type', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users WHERE id = 1');

		assert.strictEqual(result.queryType, 'SELECT');
	});

	test('should detect INSERT query type', async () => {
		const result = await agent.analyzeQuery('INSERT INTO users (name, email) VALUES (\'John\', \'john@example.com\')');

		assert.strictEqual(result.queryType, 'INSERT');
	});

	test('should detect UPDATE query type', async () => {
		const result = await agent.analyzeQuery('UPDATE users SET name = \'Jane\' WHERE id = 1');

		assert.strictEqual(result.queryType, 'UPDATE');
	});

	test('should detect DELETE query type', async () => {
		const result = await agent.analyzeQuery('DELETE FROM users WHERE id = 1');

		assert.strictEqual(result.queryType, 'DELETE');
	});

	test('should detect CREATE query type', async () => {
		const result = await agent.analyzeQuery('CREATE TABLE users (id INT PRIMARY KEY)');

		assert.strictEqual(result.queryType, 'CREATE');
	});

	test('should extract tables from SELECT query', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users JOIN orders ON users.id = orders.user_id');

		assert.ok(result.tablesReferenced.includes('users'));
		assert.ok(result.tablesReferenced.includes('orders'));
	});

	test('should extract tables from UPDATE query', async () => {
		const result = await agent.analyzeQuery('UPDATE products SET price = 100 WHERE category = \'electronics\'');

		assert.ok(result.tablesReferenced.includes('products'));
	});

	test('should detect joins', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id');

		assert.ok(result.joins.length > 0);
		assert.strictEqual(result.joins[0].type, 'INNER');
		assert.strictEqual(result.joins[0].rightTable, 'orders');
	});

	test('should detect LEFT join', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id');

		assert.ok(result.joins.length > 0);
		assert.strictEqual(result.joins[0].type, 'LEFT');
	});

	test('should detect aggregations', async () => {
		const result = await agent.analyzeQuery('SELECT COUNT(*), SUM(amount), AVG(price) FROM orders GROUP BY category');

		assert.ok(result.aggregations.includes('COUNT'));
		assert.ok(result.aggregations.includes('SUM'));
		assert.ok(result.aggregations.includes('AVG'));
	});

	test('should calculate complexity', async () => {
		const simpleResult = await agent.analyzeQuery('SELECT * FROM users');
		const complexResult = await agent.analyzeQuery(`
			SELECT u.name, COUNT(o.id), SUM(o.amount)
			FROM users u
			INNER JOIN orders o ON u.id = o.user_id
			LEFT JOIN products p ON o.product_id = p.id
			WHERE u.active = 1
			GROUP BY u.name
			HAVING COUNT(o.id) > 5
			ORDER BY SUM(o.amount) DESC
		`);

		assert.ok(complexResult.complexity > simpleResult.complexity);
		assert.ok(complexResult.complexity <= 10);
		assert.ok(simpleResult.complexity >= 1);
	});

	test('should detect SELECT * performance issue', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users WHERE id = 1');

		const selectStarIssue = result.performanceIssues.find(i => i.type === 'select_star');
		assert.ok(selectStarIssue);
		assert.strictEqual(selectStarIssue.severity, 'medium');
	});

	test('should detect leading wildcard LIKE performance issue', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users WHERE name LIKE \'%john%\'');

		const wildcardIssue = result.performanceIssues.find(i => i.type === 'leading_wildcard');
		assert.ok(wildcardIssue);
		assert.strictEqual(wildcardIssue.severity, 'high');
	});

	test('should detect missing WHERE clause', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users');

		const missingWhereIssue = result.performanceIssues.find(i => i.type === 'missing_where');
		assert.ok(missingWhereIssue);
	});

	test('should detect OR condition issue', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users WHERE name = \'John\' OR email = \'john@example.com\'');

		const orIssue = result.performanceIssues.find(i => i.type === 'or_condition');
		assert.ok(orIssue);
	});

	test('should detect function on column in WHERE', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users WHERE UPPER(name) = \'JOHN\'');

		const funcIssue = result.performanceIssues.find(i => i.type === 'function_on_column');
		assert.ok(funcIssue);
	});

	test('should detect implicit type conversion', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users WHERE id = \'123\'');

		const conversionIssue = result.performanceIssues.find(i => i.type === 'implicit_conversion');
		assert.ok(conversionIssue);
	});

	test('should suggest indexes based on WHERE clause', async () => {
		const result = await agent.analyzeQuery('SELECT * FROM users WHERE email = \'test@example.com\' AND status = 1');

		assert.ok(result.suggestedIndexes.length > 0);
		assert.strictEqual(result.suggestedIndexes[0].indexType, 'btree');
	});

	test('should have semantic intent', async () => {
		const result = await agent.analyzeQuery('SELECT name, email FROM users WHERE active = 1');

		assert.ok(result.semanticIntent);
		assert.ok(result.semanticIntent.length > 0);
	});

	test('should fire status change events', async () => {
		let statusChanges: string[] = [];
		agent.onDidChangeStatus(status => {
			statusChanges.push(status);
		});

		await agent.analyzeQuery('SELECT * FROM users');

		assert.ok(statusChanges.includes('active'));
		assert.ok(statusChanges.includes('idle'));
	});

	test('should record membrane activity', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		await agent.analyzeQuery('SELECT * FROM users');

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	test('should store analysis in hypergraph', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.analyzeQuery('SELECT * FROM users');

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('perceive should handle SQL queries', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.perceive('SELECT * FROM users WHERE id = 1');

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('perceive should ignore non-SQL text', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.perceive('Hello, this is just regular text');

		const afterCount = hypergraphStore.nodeCount();
		assert.strictEqual(afterCount, initialCount);
	});

	test('decide should return action for query context', async () => {
		const action = await agent.decide({ query: 'SELECT * FROM users' });

		assert.ok(action);
		assert.strictEqual(action.action, 'analyze_query');
		assert.strictEqual(action.target, 'SELECT * FROM users');
		assert.ok(action.confidence > 0);
	});

	test('decide should return null for empty context', async () => {
		const action = await agent.decide({});

		assert.strictEqual(action, null);
	});

	test('execute should run analyze_query action', async () => {
		const result = await agent.execute({
			action: 'analyze_query',
			target: 'SELECT * FROM users',
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.strictEqual(result.queryType, 'SELECT');
	});

	test('execute should throw for unknown action', async () => {
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

	test('should detect subqueries', async () => {
		const result = await agent.analyzeQuery(`
			SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)
		`);

		assert.ok(result.subqueries.length > 0);
	});

	test('should detect window functions', async () => {
		const result = await agent.analyzeQuery(`
			SELECT name, ROW_NUMBER() OVER (ORDER BY created_at) FROM users
		`);

		assert.ok(result.windowFunctions.includes('ROW_NUMBER'));
	});
});
