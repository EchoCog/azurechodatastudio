/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IHypergraphSemanticSearchService } from 'sql/workbench/services/zonecog/common/hypergraphSemanticSearch';
import { HypergraphSemanticSearchService } from 'sql/workbench/services/zonecog/browser/hypergraphSemanticSearchService';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { IAphroditeService } from 'sql/workbench/services/zonecog/common/aphrodite';
import { AphroditeService } from 'sql/workbench/services/zonecog/browser/aphroditeService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Hypergraph Semantic Search Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let searchService: IHypergraphSemanticSearchService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const aphroditeService = instantiationService.createInstance(AphroditeService);
		instantiationService.stub(IAphroditeService, aphroditeService);

		searchService = instantiationService.createInstance(HypergraphSemanticSearchService);
	});

	function addNode(id: string, node_type: string, content: string): HypergraphNode {
		hypergraphStore.addNode({ id, node_type, content, links: [], metadata: {}, salience_score: 0.5 });
		return hypergraphStore.getNode(id)!;
	}

	// --- Indexing ---

	test('should start with an empty index', () => {
		assert.strictEqual(searchService.getIndexedCount(), 0);
	});

	test('indexNode should return false for an unknown node', async () => {
		const result = await searchService.indexNode('missing');
		assert.strictEqual(result, false);
		assert.strictEqual(searchService.getIndexedCount(), 0);
	});

	test('indexNode should embed and index a known node', async () => {
		addNode('n1', 'TableNode', 'Customer orders table with shipping address');
		const result = await searchService.indexNode('n1');
		assert.strictEqual(result, true);
		assert.strictEqual(searchService.getIndexedCount(), 1);
		assert.strictEqual(searchService.isIndexed('n1'), true);
	});

	test('indexNode should fire onDidIndexNode', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		let fired: string | undefined;
		searchService.onDidIndexNode(id => fired = id);

		await searchService.indexNode('n1');
		assert.strictEqual(fired, 'n1');
	});

	test('indexAll should index every node and return the count indexed', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		addNode('n2', 'TableNode', 'Product inventory table');
		addNode('n3', 'ThinkingPhase', 'Initial engagement phase');

		const count = await searchService.indexAll();
		assert.strictEqual(count, 3);
		assert.strictEqual(searchService.getIndexedCount(), 3);
	});

	test('indexAll should restrict to the given node types', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		addNode('n2', 'ThinkingPhase', 'Initial engagement phase');

		const count = await searchService.indexAll(['TableNode']);
		assert.strictEqual(count, 1);
		assert.strictEqual(searchService.isIndexed('n1'), true);
		assert.strictEqual(searchService.isIndexed('n2'), false);
	});

	test('indexAll should not re-embed unchanged nodes on a second pass', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		assert.strictEqual(await searchService.indexAll(), 1);
		assert.strictEqual(await searchService.indexAll(), 0);
	});

	test('a node content change should invalidate its index entry', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		await searchService.indexNode('n1');
		assert.strictEqual(searchService.isIndexed('n1'), true);

		hypergraphStore.updateNode('n1', { content: 'Completely different content' });
		assert.strictEqual(searchService.isIndexed('n1'), false);
	});

	// --- Search ---

	test('search should return an empty array against an empty hypergraph', async () => {
		const results = await searchService.search('orders');
		assert.deepStrictEqual(results, []);
	});

	test('search should return an empty array for a blank query', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		const results = await searchService.search('   ');
		assert.deepStrictEqual(results, []);
	});

	test('search should rank a lexically closer node higher', async () => {
		addNode('n1', 'TableNode', 'Customer orders and shipping addresses');
		addNode('n2', 'TableNode', 'Employee payroll and tax withholding');

		const results = await searchService.search('customer shipping orders');
		assert.ok(results.length >= 1);
		assert.strictEqual(results[0].node.id, 'n1');
		assert.ok(results[0].score > 0);
	});

	test('search should auto-index unindexed matching nodes', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		assert.strictEqual(searchService.getIndexedCount(), 0);

		await searchService.search('orders');
		assert.strictEqual(searchService.getIndexedCount(), 1);
	});

	test('search should honor topK', async () => {
		for (let i = 0; i < 5; i++) {
			addNode(`n${i}`, 'TableNode', `Orders table variant ${i}`);
		}
		const results = await searchService.search('orders', 2);
		assert.strictEqual(results.length, 2);
	});

	test('search should restrict candidates to the given node types', async () => {
		addNode('n1', 'TableNode', 'Orders table');
		addNode('n2', 'ThinkingPhase', 'Orders discussion phase');

		const results = await searchService.search('orders', 10, ['TableNode']);
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].node.id, 'n1');
	});

	test('search results should be sorted by descending score', async () => {
		addNode('n1', 'TableNode', 'orders orders orders shipping');
		addNode('n2', 'TableNode', 'orders shipping unrelated content here');
		addNode('n3', 'TableNode', 'completely unrelated payroll tax data');

		const results = await searchService.search('orders shipping');
		for (let i = 1; i < results.length; i++) {
			assert.ok(results[i - 1].score >= results[i].score);
		}
	});

	// --- Lifecycle ---

	test('clear should drop the entire index', async () => {
		addNode('n1', 'TableNode', 'Customer orders table');
		await searchService.indexAll();
		assert.strictEqual(searchService.getIndexedCount(), 1);

		searchService.clear();
		assert.strictEqual(searchService.getIndexedCount(), 0);
		assert.strictEqual(searchService.isIndexed('n1'), false);
	});
});
