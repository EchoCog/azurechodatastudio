/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { NaturalLanguageAgent } from 'sql/workbench/services/zonecog/browser/naturalLanguageAgent';
import { NullLogService } from 'vs/platform/log/common/log';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';

suite('NaturalLanguageAgent', () => {
	let agent: NaturalLanguageAgent;
	let logService: NullLogService;
	let llmService: LLMProviderService;
	let membraneService: CognitiveMembraneService;
	let hypergraphStore: HypergraphStore;

	setup(() => {
		logService = new NullLogService();
		membraneService = new CognitiveMembraneService(logService);
		llmService = new LLMProviderService(logService, membraneService);
		hypergraphStore = new HypergraphStore(logService);
		agent = new NaturalLanguageAgent(logService, llmService, membraneService, hypergraphStore);
	});

	teardown(() => {
		agent.dispose();
		llmService.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});

	// --- Identity Tests ---

	test('should have correct identity', () => {
		assert.strictEqual(agent.id, 'natural-language-agent');
		assert.strictEqual(agent.name, 'Natural Language Translator');
		assert.ok(agent.description.includes('Natural language'));
	});

	test('should have correct capabilities', () => {
		const caps = agent.getCapabilities();

		assert.strictEqual(caps.canPerceive, true);
		assert.strictEqual(caps.canReason, true);
		assert.strictEqual(caps.canAct, true);
		assert.ok(caps.supportedActions.includes('translate_to_sql'));
		assert.ok(caps.supportedActions.includes('explain_sql'));
		assert.ok(caps.supportedActions.includes('classify_intent'));
		assert.ok(caps.supportedActions.includes('extract_entities'));
		assert.ok(caps.maxConcurrentTasks >= 1);
	});

	test('should start in idle status', () => {
		assert.strictEqual(agent.getStatus(), 'idle');
		assert.strictEqual(agent.getCurrentLoad(), 0);
	});

	// --- Intent Classification Tests ---

	test('should classify data query intent', () => {
		const result = agent.classifyIntent('Show me all customers from Germany');

		assert.strictEqual(result.intent, 'data_query');
		assert.ok(result.confidence > 0.5);
		assert.ok(result.signals.length > 0);
	});

	test('should classify data mutation intent', () => {
		const result = agent.classifyIntent('Update the status of order 42 to shipped');

		assert.strictEqual(result.intent, 'data_mutation');
		assert.ok(result.confidence > 0.5);
	});

	test('should classify schema definition intent', () => {
		const result = agent.classifyIntent('Create a table for tracking invoices');

		assert.strictEqual(result.intent, 'schema_definition');
		assert.ok(result.confidence > 0.5);
	});

	test('should classify optimization intent', () => {
		const result = agent.classifyIntent('This report is slow, can you optimize it?');

		assert.strictEqual(result.intent, 'optimization');
	});

	test('should classify explanation intent', () => {
		const result = agent.classifyIntent('Explain this query to me');

		assert.strictEqual(result.intent, 'explanation');
	});

	test('should fall back to other intent', () => {
		const result = agent.classifyIntent('hello there');

		assert.strictEqual(result.intent, 'other');
		assert.ok(result.confidence < 0.5);
		assert.strictEqual(result.signals.length, 0);
	});

	// --- Entity Extraction Tests ---

	test('should extract known table references', () => {
		const entities = agent.extractEntities('list all rows in customers', ['dbo.Customers']);

		const tables = entities.filter(e => e.kind === 'table');
		assert.strictEqual(tables.length, 1);
		assert.strictEqual(tables[0].normalized, 'dbo.Customers');
	});

	test('should extract singular/plural table variants', () => {
		const entities = agent.extractEntities('find the latest order', ['dbo.Orders']);

		const tables = entities.filter(e => e.kind === 'table');
		assert.strictEqual(tables.length, 1);
		assert.strictEqual(tables[0].normalized, 'dbo.Orders');
	});

	test('should extract quoted values', () => {
		const entities = agent.extractEntities(`show customers where country is 'Germany'`);

		const values = entities.filter(e => e.kind === 'value');
		assert.strictEqual(values.length, 1);
		assert.strictEqual(values[0].text, 'Germany');
	});

	test('should extract snake_case column references', () => {
		const entities = agent.extractEntities('sort by created_at descending');

		const columns = entities.filter(e => e.kind === 'column');
		assert.ok(columns.some(c => c.normalized === 'created_at'));
	});

	test('should not duplicate entities', () => {
		const entities = agent.extractEntities(`orders and orders and 'x' and 'x'`, ['dbo.Orders']);

		assert.strictEqual(entities.filter(e => e.kind === 'table').length, 1);
		assert.strictEqual(entities.filter(e => e.kind === 'value').length, 1);
	});

	test('should return empty entities for empty utterance', () => {
		const entities = agent.extractEntities('');
		assert.strictEqual(entities.length, 0);
	});

	// --- Translation Tests (built-in LLM fallback) ---

	test('should translate natural language to SQL', async () => {
		const result = await agent.translateToSQL('show all customers');

		assert.ok(typeof result.sql === 'string');
		assert.ok(result.sql.length > 0);
		assert.strictEqual(result.intent.intent, 'data_query');
		assert.strictEqual(result.usedSchemaContext, false);
	});

	test('should use schema context during translation', async () => {
		const result = await agent.translateToSQL('count all orders', 'dbo.Orders\ndbo.Customers');

		assert.ok(result.sql.length > 0);
		assert.strictEqual(result.usedSchemaContext, true);
		assert.ok(result.entities.some(e => e.kind === 'table' && e.normalized === 'dbo.Orders'));
	});

	test('should persist translation into the hypergraph', async () => {
		await agent.translateToSQL('show all customers');

		const nodes = hypergraphStore.getNodesByType('nl_translation');
		assert.strictEqual(nodes.length, 1);
		assert.strictEqual(nodes[0].metadata['agent'], 'natural-language-agent');
	});

	test('should explain SQL in natural language', async () => {
		const explanation = await agent.explainSQL('SELECT * FROM customers');

		assert.ok(typeof explanation === 'string');
		assert.ok(explanation.length > 0);
	});

	// --- Perceive / Decide / Execute Tests ---

	test('should persist perceived utterances into the hypergraph', async () => {
		await agent.perceive('show all customers');

		const nodes = hypergraphStore.getNodesByType('nl_utterance');
		assert.strictEqual(nodes.length, 1);
		assert.strictEqual(nodes[0].metadata['intent'], 'data_query');
	});

	test('should ignore non-string perception input', async () => {
		await agent.perceive({ some: 'object' });

		const nodes = hypergraphStore.getNodesByType('nl_utterance');
		assert.strictEqual(nodes.length, 0);
	});

	test('should decide to translate when given an utterance', async () => {
		const action = await agent.decide({ utterance: 'show all customers' });

		assert.ok(action);
		assert.strictEqual(action!.action, 'translate_to_sql');
		assert.strictEqual(action!.target, 'show all customers');
	});

	test('should decide to explain when given SQL and an explanation intent', async () => {
		const action = await agent.decide({ utterance: 'explain this query', sql: 'SELECT 1' });

		assert.ok(action);
		assert.strictEqual(action!.action, 'explain_sql');
		assert.strictEqual(action!.target, 'SELECT 1');
	});

	test('should return null decision for empty context', async () => {
		const action = await agent.decide({});
		assert.strictEqual(action, null);
	});

	test('should execute translate_to_sql action', async () => {
		const result = await agent.execute({
			action: 'translate_to_sql',
			target: 'show all customers',
			parameters: {},
			confidence: 0.9,
		});

		assert.ok(result.sql.length > 0);
	});

	test('should execute classify_intent action', async () => {
		const result = await agent.execute({
			action: 'classify_intent',
			target: 'show all customers',
			parameters: {},
			confidence: 0.9,
		});

		assert.strictEqual(result.intent, 'data_query');
	});

	test('should reject unknown actions', async () => {
		await assert.rejects(agent.execute({
			action: 'unknown_action',
			target: '',
			parameters: {},
			confidence: 0.5,
		}));
	});

	test('should return to idle status after execution', async () => {
		await agent.execute({
			action: 'classify_intent',
			target: 'show all customers',
			parameters: {},
			confidence: 0.9,
		});

		assert.strictEqual(agent.getStatus(), 'idle');
		assert.strictEqual(agent.getCurrentLoad(), 0);
	});
});
