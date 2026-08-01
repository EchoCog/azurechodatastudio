/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ISchemaEvolutionService, SchemaEvolutionEvent } from 'sql/workbench/services/zonecog/common/schemaEvolution';
import { SchemaEvolutionService } from 'sql/workbench/services/zonecog/browser/schemaEvolutionService';
import { ISchemaPerceptionService, PerceivedSchemaElement } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { SchemaPerceptionService } from 'sql/workbench/services/zonecog/browser/schemaPerceptionService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Schema Evolution Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let evolutionService: ISchemaEvolutionService;
	let hypergraphStore: IHypergraphStore;

	const CONNECTION = 'mssql://localhost/TestDB';

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		const schemaPerceptionService = instantiationService.createInstance(SchemaPerceptionService);
		instantiationService.stub(ISchemaPerceptionService, schemaPerceptionService);

		evolutionService = instantiationService.createInstance(SchemaEvolutionService);
	});

	function element(id: string, name: string, overrides: Partial<PerceivedSchemaElement> = {}): PerceivedSchemaElement {
		return {
			id,
			elementType: 'table',
			name,
			qualifiedName: `dbo.${name}`,
			parentId: null,
			connectionUri: CONNECTION,
			metadata: {},
			perceivedAt: Date.now(),
			...overrides
		};
	}

	// --- Baseline snapshot ---

	test('should start with no tracked connections', () => {
		assert.deepStrictEqual(evolutionService.getTrackedConnections(), []);
		assert.strictEqual(evolutionService.getSnapshotInfo(CONNECTION), undefined);
		assert.deepStrictEqual(evolutionService.getChangeHistory(CONNECTION), []);
	});

	test('first snapshot should establish a baseline with no changes', () => {
		const changes = evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);
		assert.deepStrictEqual(changes, []);

		const info = evolutionService.getSnapshotInfo(CONNECTION);
		assert.ok(info);
		assert.strictEqual(info!.elementCount, 1);
		assert.strictEqual(info!.snapshotCount, 1);
		assert.deepStrictEqual(evolutionService.getTrackedConnections(), [CONNECTION]);
	});

	// --- Change detection ---

	test('should detect added elements', () => {
		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);
		const changes = evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users'), element('t2', 'Orders')]);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].changeType, 'added');
		assert.strictEqual(changes[0].elementId, 't2');
		assert.strictEqual(changes[0].qualifiedName, 'dbo.Orders');
	});

	test('should detect removed elements', () => {
		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users'), element('t2', 'Orders')]);
		const changes = evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].changeType, 'removed');
		assert.strictEqual(changes[0].elementId, 't2');
	});

	test('should detect modified elements', () => {
		evolutionService.recordSnapshot(CONNECTION, [element('c1', 'email', { elementType: 'column', metadata: { dataType: 'varchar(50)' } })]);
		const changes = evolutionService.recordSnapshot(CONNECTION, [element('c1', 'email', { elementType: 'column', metadata: { dataType: 'varchar(255)' } })]);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].changeType, 'modified');
		assert.ok(changes[0].before!.includes('varchar(50)'));
		assert.ok(changes[0].after!.includes('varchar(255)'));
	});

	test('should not report changes when only perceivedAt differs', () => {
		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users', { perceivedAt: 1000 })]);
		const changes = evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users', { perceivedAt: 2000 })]);
		assert.deepStrictEqual(changes, []);
	});

	test('should fire the evolution event when changes are detected', () => {
		let fired: SchemaEvolutionEvent | undefined;
		evolutionService.onDidDetectSchemaChanges(e => fired = e);

		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);
		assert.strictEqual(fired, undefined);

		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users'), element('t2', 'Orders')]);
		assert.ok(fired);
		assert.strictEqual(fired!.connectionUri, CONNECTION);
		assert.strictEqual(fired!.changes.length, 1);
	});

	test('should persist changes as SchemaChange hypergraph nodes', () => {
		evolutionService.recordSnapshot(CONNECTION, []);
		const changes = evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);

		const node = hypergraphStore.getNode(changes[0].id);
		assert.ok(node);
		assert.strictEqual(node!.node_type, 'SchemaChange');
		assert.strictEqual(node!.metadata['changeType'], 'added');
		assert.strictEqual(node!.metadata['connectionUri'], CONNECTION);
	});

	test('should track connections independently', () => {
		const other = 'mssql://localhost/OtherDB';
		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);
		evolutionService.recordSnapshot(other, []);

		const changes = evolutionService.recordSnapshot(CONNECTION, []);
		assert.strictEqual(changes.length, 1);
		assert.deepStrictEqual(evolutionService.getChangeHistory(other), []);
	});

	// --- Change history ---

	test('change history should return most recent changes first and honor limit', () => {
		evolutionService.recordSnapshot(CONNECTION, []);
		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);
		evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users'), element('t2', 'Orders')]);

		const history = evolutionService.getChangeHistory(CONNECTION);
		assert.strictEqual(history.length, 2);
		assert.strictEqual(history[0].elementId, 't2');
		assert.strictEqual(history[1].elementId, 't1');

		assert.strictEqual(evolutionService.getChangeHistory(CONNECTION, 1).length, 1);
	});

	test('should bound the retained change history at 500 per connection', () => {
		evolutionService.recordSnapshot(CONNECTION, []);
		let elements: PerceivedSchemaElement[] = [];
		for (let batch = 0; batch < 11; batch++) {
			elements = elements.concat(
				Array.from({ length: 50 }, (_, i) => element(`t-${batch}-${i}`, `Table${batch}_${i}`))
			);
			evolutionService.recordSnapshot(CONNECTION, elements);
		}
		assert.strictEqual(evolutionService.getChangeHistory(CONNECTION).length, 500);
	});

	// --- Lifecycle ---

	test('clear should remove tracking and persisted change nodes for a connection', () => {
		evolutionService.recordSnapshot(CONNECTION, []);
		const changes = evolutionService.recordSnapshot(CONNECTION, [element('t1', 'Users')]);
		assert.ok(hypergraphStore.getNode(changes[0].id));

		evolutionService.clear(CONNECTION);

		assert.deepStrictEqual(evolutionService.getTrackedConnections(), []);
		assert.strictEqual(hypergraphStore.getNode(changes[0].id), undefined);
	});

	test('clear without a connection should remove all tracking', () => {
		evolutionService.recordSnapshot(CONNECTION, []);
		evolutionService.recordSnapshot('other', []);

		evolutionService.clear();

		assert.deepStrictEqual(evolutionService.getTrackedConnections(), []);
	});
});
