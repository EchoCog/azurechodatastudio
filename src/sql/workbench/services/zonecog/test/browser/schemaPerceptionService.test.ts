/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ISchemaPerceptionService, ObservedQuery } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { SchemaPerceptionService } from 'sql/workbench/services/zonecog/browser/schemaPerceptionService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Schema Perception Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let schemaService: ISchemaPerceptionService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		schemaService = instantiationService.createInstance(SchemaPerceptionService);
	});

	// --- Initial State Tests ---

	test('should return empty perceived elements initially', () => {
		const elements = schemaService.getPerceivedElements('test-connection');
		assert.strictEqual(elements.length, 0);
	});

	test('should return undefined for non-existent element', () => {
		const element = schemaService.getElement('non-existent');
		assert.strictEqual(element, undefined);
	});

	test('should return false for isPerceiving initially', () => {
		assert.strictEqual(schemaService.isPerceiving('test-connection'), false);
	});

	// --- Schema Perception Tests ---

	test('should perceive schema and mark as active', async () => {
		await schemaService.perceiveSchema('test-connection');
		assert.strictEqual(schemaService.isPerceiving('test-connection'), true);
	});

	test('should fire onDidPerceiveSchema event on perception', async () => {
		let firedEvent = false;
		schemaService.onDidPerceiveSchema(() => { firedEvent = true; });

		await schemaService.perceiveSchema('test-connection');

		assert.strictEqual(firedEvent, true);
	});

	test('should get elements by type', async () => {
		await schemaService.perceiveSchema('test-connection');
		// Since we don't have actual database, this returns empty but should not throw
		const tables = schemaService.getElementsByType('test-connection', 'table');
		assert.ok(Array.isArray(tables));
	});

	test('should search elements by pattern', async () => {
		await schemaService.perceiveSchema('test-connection');
		const results = schemaService.searchElements('test-connection', 'user');
		assert.ok(Array.isArray(results));
	});

	// --- Query Observation Tests ---

	test('should observe a query', () => {
		const queryData: Omit<ObservedQuery, 'id'> = {
			queryText: 'SELECT * FROM users WHERE id = 1',
			connectionUri: 'test-connection',
			startTime: Date.now(),
			durationMs: 150,
			rowCount: 1,
			success: true,
			referencedTables: ['users'],
			operationType: 'select',
		};

		const observed = schemaService.observeQuery(queryData);

		assert.ok(observed.id);
		assert.strictEqual(observed.queryText, queryData.queryText);
		assert.strictEqual(observed.operationType, 'select');
	});

	test('should assign unique IDs to observed queries', () => {
		const query1 = schemaService.observeQuery({
			queryText: 'SELECT 1',
			connectionUri: 'test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: [],
			operationType: 'select',
		});

		const query2 = schemaService.observeQuery({
			queryText: 'SELECT 2',
			connectionUri: 'test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: [],
			operationType: 'select',
		});

		assert.notStrictEqual(query1.id, query2.id);
	});

	test('should fire onDidObserveQuery event', () => {
		let firedSalience: number | undefined;
		schemaService.onDidObserveQuery(ev => { firedSalience = ev.salienceScore; });

		schemaService.observeQuery({
			queryText: 'SELECT * FROM orders',
			connectionUri: 'test',
			startTime: Date.now(),
			durationMs: 100,
			rowCount: 10,
			success: true,
			referencedTables: ['orders'],
			operationType: 'select',
		});

		assert.ok(firedSalience !== undefined);
		assert.ok(firedSalience >= 0 && firedSalience <= 1);
	});

	test('should get recent queries', () => {
		for (let i = 0; i < 5; i++) {
			schemaService.observeQuery({
				queryText: `SELECT ${i}`,
				connectionUri: 'test-connection',
				startTime: Date.now(),
				durationMs: 10,
				rowCount: 1,
				success: true,
				referencedTables: [],
				operationType: 'select',
			});
		}

		const recent = schemaService.getRecentQueries('test-connection', 3);
		assert.strictEqual(recent.length, 3);
	});

	test('should get queries for table', () => {
		schemaService.observeQuery({
			queryText: 'SELECT * FROM users',
			connectionUri: 'test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: ['users'],
			operationType: 'select',
		});

		schemaService.observeQuery({
			queryText: 'SELECT * FROM orders',
			connectionUri: 'test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: ['orders'],
			operationType: 'select',
		});

		const userQueries = schemaService.getQueriesForTable('users');
		assert.strictEqual(userQueries.length, 1);
		assert.ok(userQueries[0].queryText.includes('users'));
	});

	// --- Query Statistics Tests ---

	test('should return empty statistics for new connection', () => {
		const stats = schemaService.getQueryStatistics('new-connection');

		assert.strictEqual(stats.totalQueries, 0);
		assert.strictEqual(stats.successfulQueries, 0);
		assert.strictEqual(stats.failedQueries, 0);
		assert.strictEqual(stats.averageDurationMs, 0);
	});

	test('should calculate query statistics', () => {
		// Add some queries
		schemaService.observeQuery({
			queryText: 'SELECT 1',
			connectionUri: 'stats-test',
			startTime: Date.now(),
			durationMs: 100,
			rowCount: 1,
			success: true,
			referencedTables: ['users'],
			operationType: 'select',
		});

		schemaService.observeQuery({
			queryText: 'INSERT INTO users',
			connectionUri: 'stats-test',
			startTime: Date.now(),
			durationMs: 50,
			rowCount: 1,
			success: true,
			referencedTables: ['users'],
			operationType: 'insert',
		});

		schemaService.observeQuery({
			queryText: 'SELECT * FROM orders',
			connectionUri: 'stats-test',
			startTime: Date.now(),
			durationMs: 150,
			rowCount: 0,
			success: false,
			errorMessage: 'Table not found',
			referencedTables: ['orders'],
			operationType: 'select',
		});

		const stats = schemaService.getQueryStatistics('stats-test');

		assert.strictEqual(stats.totalQueries, 3);
		assert.strictEqual(stats.successfulQueries, 2);
		assert.strictEqual(stats.failedQueries, 1);
		assert.strictEqual(stats.averageDurationMs, 100); // (100 + 50 + 150) / 3
		assert.strictEqual(stats.operationCounts.select, 2);
		assert.strictEqual(stats.operationCounts.insert, 1);
	});

	test('should track frequent tables', () => {
		for (let i = 0; i < 5; i++) {
			schemaService.observeQuery({
				queryText: 'SELECT * FROM users',
				connectionUri: 'freq-test',
				startTime: Date.now(),
				durationMs: 10,
				rowCount: 1,
				success: true,
				referencedTables: ['users'],
				operationType: 'select',
			});
		}

		for (let i = 0; i < 2; i++) {
			schemaService.observeQuery({
				queryText: 'SELECT * FROM orders',
				connectionUri: 'freq-test',
				startTime: Date.now(),
				durationMs: 10,
				rowCount: 1,
				success: true,
				referencedTables: ['orders'],
				operationType: 'select',
			});
		}

		const stats = schemaService.getQueryStatistics('freq-test');

		assert.ok(stats.frequentTables.length >= 2);
		assert.strictEqual(stats.frequentTables[0].table, 'users');
		assert.strictEqual(stats.frequentTables[0].accessCount, 5);
	});

	// --- Cognitive Integration Tests ---

	test('should register schema in hypergraph', async () => {
		await schemaService.perceiveSchema('hg-test');
		const nodesCreated = await schemaService.registerSchemaInHypergraph('hg-test');

		// Without actual schema elements, should be 0
		assert.strictEqual(nodesCreated, 0);
	});

	test('should calculate element salience', () => {
		// Observe queries to build up access counts
		schemaService.observeQuery({
			queryText: 'SELECT * FROM high_access',
			connectionUri: 'sal-test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: ['high_access'],
			operationType: 'select',
		});

		const highSalience = schemaService.getElementSalience('high_access');
		const lowSalience = schemaService.getElementSalience('no_access');

		assert.ok(highSalience > lowSalience);
	});

	test('should clear perception for connection', async () => {
		await schemaService.perceiveSchema('clear-test');

		schemaService.observeQuery({
			queryText: 'SELECT 1',
			connectionUri: 'clear-test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: [],
			operationType: 'select',
		});

		schemaService.clearPerception('clear-test');

		assert.strictEqual(schemaService.isPerceiving('clear-test'), false);
		assert.strictEqual(schemaService.getRecentQueries('clear-test').length, 0);
	});

	// --- Query Salience Tests ---

	test('should assign higher salience to failed queries', () => {
		let successSalience = 0;
		let failSalience = 0;

		schemaService.onDidObserveQuery(ev => {
			if (ev.query.success) {
				successSalience = ev.salienceScore;
			} else {
				failSalience = ev.salienceScore;
			}
		});

		schemaService.observeQuery({
			queryText: 'SELECT 1',
			connectionUri: 'sal-test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: [],
			operationType: 'select',
		});

		schemaService.observeQuery({
			queryText: 'SELECT 1',
			connectionUri: 'sal-test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 0,
			success: false,
			errorMessage: 'Error',
			referencedTables: [],
			operationType: 'select',
		});

		assert.ok(failSalience > successSalience);
	});

	test('should assign higher salience to DDL operations', () => {
		let selectSalience = 0;
		let createSalience = 0;

		schemaService.onDidObserveQuery(ev => {
			if (ev.query.operationType === 'select') {
				selectSalience = ev.salienceScore;
			} else if (ev.query.operationType === 'create') {
				createSalience = ev.salienceScore;
			}
		});

		schemaService.observeQuery({
			queryText: 'SELECT 1',
			connectionUri: 'sal-test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 1,
			success: true,
			referencedTables: [],
			operationType: 'select',
		});

		schemaService.observeQuery({
			queryText: 'CREATE TABLE test',
			connectionUri: 'sal-test',
			startTime: Date.now(),
			durationMs: 10,
			rowCount: 0,
			success: true,
			referencedTables: [],
			operationType: 'create',
		});

		assert.ok(createSalience > selectSalience);
	});

	// --- Query Parsing Helper Tests ---

	test('should parse query operation type', () => {
		const service = schemaService as SchemaPerceptionService;

		assert.strictEqual(service.parseQueryOperationType('SELECT * FROM users'), 'select');
		assert.strictEqual(service.parseQueryOperationType('INSERT INTO users'), 'insert');
		assert.strictEqual(service.parseQueryOperationType('UPDATE users SET'), 'update');
		assert.strictEqual(service.parseQueryOperationType('DELETE FROM users'), 'delete');
		assert.strictEqual(service.parseQueryOperationType('CREATE TABLE users'), 'create');
		assert.strictEqual(service.parseQueryOperationType('ALTER TABLE users'), 'alter');
		assert.strictEqual(service.parseQueryOperationType('DROP TABLE users'), 'drop');
		assert.strictEqual(service.parseQueryOperationType('TRUNCATE TABLE users'), 'truncate');
		assert.strictEqual(service.parseQueryOperationType('EXEC sp_help'), 'other');
	});

	test('should extract referenced tables from queries', () => {
		const service = schemaService as SchemaPerceptionService;

		let tables = service.extractReferencedTables('SELECT * FROM users');
		assert.ok(tables.includes('users'));

		tables = service.extractReferencedTables('SELECT * FROM users JOIN orders ON users.id = orders.user_id');
		assert.ok(tables.includes('users'));
		assert.ok(tables.includes('orders'));

		tables = service.extractReferencedTables('INSERT INTO products (name) VALUES (\'test\')');
		assert.ok(tables.includes('products'));

		tables = service.extractReferencedTables('UPDATE customers SET name = \'test\'');
		assert.ok(tables.includes('customers'));
	});
});
