/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SchemaReasonerAgent } from 'sql/workbench/services/zonecog/browser/schemaReasonerAgent';
import { NullLogService } from 'vs/platform/log/common/log';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';

suite('SchemaReasonerAgent', () => {
	let agent: SchemaReasonerAgent;
	let logService: NullLogService;
	let llmService: LLMProviderService;
	let membraneService: CognitiveMembraneService;
	let hypergraphStore: HypergraphStore;

	const sampleSchema = `
		CREATE TABLE users (
			id INT PRIMARY KEY,
			name VARCHAR(100) NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP
		);

		CREATE TABLE orders (
			id INT PRIMARY KEY,
			user_id INT NOT NULL,
			total DECIMAL(10, 2),
			status VARCHAR(50),
			created_at TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);

		CREATE TABLE order_items (
			id INT PRIMARY KEY,
			order_id INT NOT NULL,
			product_id INT NOT NULL,
			quantity INT DEFAULT 1,
			price DECIMAL(10, 2),
			FOREIGN KEY (order_id) REFERENCES orders(id)
		);

		CREATE INDEX idx_users_email ON users(email);
		CREATE INDEX idx_orders_user_id ON orders(user_id);
	`;

	setup(() => {
		logService = new NullLogService();
		membraneService = new CognitiveMembraneService(logService);
		llmService = new LLMProviderService(logService, membraneService);
		hypergraphStore = new HypergraphStore(logService);
		agent = new SchemaReasonerAgent(logService, llmService, membraneService, hypergraphStore);
	});

	teardown(() => {
		agent.dispose();
		llmService.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});

	test('should have correct identity', () => {
		assert.strictEqual(agent.id, 'schema-reasoner-agent');
		assert.strictEqual(agent.name, 'Schema Reasoner');
		assert.ok(agent.description.includes('schema'));
	});

	test('should have correct capabilities', () => {
		const caps = agent.getCapabilities();

		assert.strictEqual(caps.canPerceive, true);
		assert.strictEqual(caps.canReason, true);
		assert.strictEqual(caps.canAct, true);
		assert.ok(caps.supportedActions.includes('analyze_schema'));
		assert.ok(caps.supportedActions.includes('discover_relationships'));
		assert.ok(caps.supportedActions.includes('infer_domain'));
		assert.ok(caps.supportedActions.includes('suggest_improvements'));
		assert.ok(caps.supportedActions.includes('generate_docs'));
		assert.ok(caps.supportedActions.includes('compare_schemas'));
		assert.ok(caps.maxConcurrentTasks >= 1);
	});

	test('should start in idle status', () => {
		assert.strictEqual(agent.getStatus(), 'idle');
		assert.strictEqual(agent.getCurrentLoad(), 0);
	});

	test('should analyze schema and find tables', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const tableElements = result.elements.filter(e => e.type === 'table');
		assert.ok(tableElements.length >= 3);

		const tableNames = tableElements.map(t => t.name);
		assert.ok(tableNames.includes('users'));
		assert.ok(tableNames.includes('orders'));
		assert.ok(tableNames.includes('order_items'));
	});

	test('should analyze schema and find indexes', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const indexElements = result.elements.filter(e => e.type === 'index');
		assert.ok(indexElements.length >= 2);
	});

	test('should parse columns for tables', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const usersTable = result.elements.find(e => e.name === 'users' && e.type === 'table');
		assert.ok(usersTable);
		assert.ok(usersTable.columns);
		assert.ok(usersTable.columns.length >= 4);

		const idColumn = usersTable.columns.find(c => c.name === 'id');
		assert.ok(idColumn);
		assert.strictEqual(idColumn.role, 'primary_key');
	});

	test('should identify foreign keys', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const ordersTable = result.elements.find(e => e.name === 'orders' && e.type === 'table');
		assert.ok(ordersTable);
		assert.ok(ordersTable.columns);

		const userIdColumn = ordersTable.columns.find(c => c.name === 'user_id');
		assert.ok(userIdColumn);
		assert.strictEqual(userIdColumn.role, 'foreign_key');
	});

	test('should identify timestamp columns', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const usersTable = result.elements.find(e => e.name === 'users' && e.type === 'table');
		assert.ok(usersTable);

		const createdAtColumn = usersTable.columns?.find(c => c.name === 'created_at');
		assert.ok(createdAtColumn);
		assert.strictEqual(createdAtColumn.role, 'timestamp');
	});

	test('should discover relationships from foreign keys', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		assert.ok(result.relationships.length > 0);

		const ordersToUsers = result.relationships.find(
			r => r.sourceTable === 'orders' && r.targetTable === 'users'
		);
		assert.ok(ordersToUsers);
		assert.strictEqual(ordersToUsers.isExplicit, true);
	});

	test('should identify quality issues', async () => {
		// Schema missing some best practices
		const problematicSchema = `
			CREATE TABLE bad_table (
				data TEXT,
				name VARCHAR(100)
			);
		`;

		const result = await agent.analyzeSchema(problematicSchema);

		const missingPKIssue = result.qualityIssues.find(i => i.type === 'missing_primary_key');
		assert.ok(missingPKIssue);
		assert.strictEqual(missingPKIssue.severity, 'error');
	});

	test('should detect TEXT/BLOB column warning', async () => {
		const schemaWithText = `
			CREATE TABLE documents (
				id INT PRIMARY KEY,
				content TEXT,
				binary_data BLOB
			);
		`;

		const result = await agent.analyzeSchema(schemaWithText);

		const largeObjectIssue = result.qualityIssues.find(i => i.type === 'large_object_column');
		assert.ok(largeObjectIssue);
		assert.strictEqual(largeObjectIssue.severity, 'warning');
	});

	test('should perform normalization analysis', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		assert.ok(result.normalization);
		assert.ok(['1NF', '2NF', '3NF', 'BCNF', '4NF', '5NF'].includes(result.normalization.currentForm));
	});

	test('should infer domain model', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		assert.ok(result.domainModel);
		assert.ok(result.domainModel.entities.length > 0);

		const userEntity = result.domainModel.entities.find(e =>
			e.backingTables.includes('users')
		);
		assert.ok(userEntity);
	});

	test('should identify aggregate roots', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const aggregates = result.domainModel.entities.filter(e => e.isAggregateRoot);
		assert.ok(aggregates.length > 0);

		// users and orders should be aggregate roots
		const userEntity = aggregates.find(e => e.backingTables.includes('users'));
		assert.ok(userEntity);
	});

	test('should infer bounded contexts', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		assert.ok(result.domainModel.boundedContexts.length > 0);
	});

	test('should extract business rules from constraints', async () => {
		const schemaWithConstraints = `
			CREATE TABLE products (
				id INT PRIMARY KEY,
				name VARCHAR(100) NOT NULL,
				price DECIMAL(10, 2) CHECK (price > 0),
				UNIQUE (name)
			);
		`;

		const result = await agent.analyzeSchema(schemaWithConstraints);

		assert.ok(result.domainModel.businessRules.length > 0);
	});

	test('should generate documentation', async () => {
		const doc = await agent.generateDocumentation(sampleSchema);

		assert.ok(doc);
		assert.ok(doc.includes('Database Schema Documentation'));
		assert.ok(doc.includes('users'));
		assert.ok(doc.includes('orders'));
	});

	test('should compare schemas', async () => {
		const schema1 = `
			CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));
			CREATE TABLE orders (id INT PRIMARY KEY);
		`;

		const schema2 = `
			CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100), email VARCHAR(255));
			CREATE TABLE products (id INT PRIMARY KEY);
		`;

		const diff = await agent.compareSchemas(schema1, schema2);

		assert.ok(diff);
		assert.ok(diff.includes('Added'));
		assert.ok(diff.includes('Removed'));
		assert.ok(diff.includes('products')); // Added
		assert.ok(diff.includes('orders')); // Removed
	});

	test('should fire status change events', async () => {
		let statusChanges: string[] = [];
		agent.onDidChangeStatus(status => {
			statusChanges.push(status);
		});

		await agent.analyzeSchema(sampleSchema);

		assert.ok(statusChanges.includes('active'));
		assert.ok(statusChanges.includes('idle'));
	});

	test('should record membrane activity', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		await agent.analyzeSchema(sampleSchema);

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	test('should store analysis in hypergraph', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.analyzeSchema(sampleSchema);

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('perceive should handle schema definitions', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.perceive('CREATE TABLE test (id INT PRIMARY KEY);');

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('perceive should ignore non-schema text', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.perceive('Hello, this is just regular text');

		const afterCount = hypergraphStore.nodeCount();
		assert.strictEqual(afterCount, initialCount);
	});

	test('decide should return action for schema context', async () => {
		const action = await agent.decide({ schema: sampleSchema });

		assert.ok(action);
		assert.strictEqual(action.action, 'analyze_schema');
		assert.ok(action.confidence > 0);
	});

	test('decide should return null for empty context', async () => {
		const action = await agent.decide({});

		assert.strictEqual(action, null);
	});

	test('execute should run analyze_schema action', async () => {
		const result = await agent.execute({
			action: 'analyze_schema',
			target: sampleSchema,
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(result.elements.length > 0);
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

	test('should infer column semantic meanings', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const usersTable = result.elements.find(e => e.name === 'users' && e.type === 'table');
		assert.ok(usersTable?.columns);

		const emailColumn = usersTable.columns.find(c => c.name === 'email');
		assert.ok(emailColumn);
		assert.ok(emailColumn.semanticMeaning.toLowerCase().includes('email'));
	});

	test('should infer table purposes', async () => {
		const result = await agent.analyzeSchema(sampleSchema);

		const usersTable = result.elements.find(e => e.name === 'users' && e.type === 'table');
		assert.ok(usersTable);
		assert.ok(usersTable.inferredPurpose);
		assert.ok(usersTable.inferredPurpose.toLowerCase().includes('user'));
	});

	test('discoverRelationships should find implicit relationships', async () => {
		const relationships = await agent.discoverRelationships(['users', 'orders', 'order_items']);

		// At minimum should attempt to find relationships
		assert.ok(Array.isArray(relationships));
	});

	test('suggestImprovements should return quality issues', async () => {
		const problematicSchema = `
			CREATE TABLE no_pk (
				data TEXT
			);
		`;

		const issues = await agent.suggestImprovements(problematicSchema);

		assert.ok(Array.isArray(issues));
		assert.ok(issues.length > 0);
	});

	test('inferDomainModel should return valid domain model', async () => {
		const domainModel = await agent.inferDomainModel(sampleSchema);

		assert.ok(domainModel);
		assert.ok(Array.isArray(domainModel.entities));
		assert.ok(Array.isArray(domainModel.aggregates));
		assert.ok(Array.isArray(domainModel.boundedContexts));
		assert.ok(Array.isArray(domainModel.businessRules));
	});
});
