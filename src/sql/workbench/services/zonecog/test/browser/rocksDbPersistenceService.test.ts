/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { RocksDbPersistenceService } from '../../browser/rocksDbPersistenceService';
import { NullLogService } from 'vs/platform/log/common/log';
import { HypergraphNode, HypergraphLink } from '../../common/zonecogService';
import { IndexDefinition } from '../../common/rocksDbPersistence';

// Mock CognitiveMembraneService
class MockCognitiveMembraneService {
	private _activities: string[] = [];

	recordActivity(triad: 'cerebral' | 'somatic' | 'autonomic'): void {
		this._activities.push(triad);
	}

	getActivities(): string[] {
		return this._activities;
	}

	clear(): void {
		this._activities = [];
	}
}

function createTestNode(id: string, nodeType: string, salience = 0.5): HypergraphNode {
	return {
		id,
		node_type: nodeType,
		content: `Content for ${id}`,
		links: [],
		metadata: { test: true },
		salience_score: salience
	};
}

function createTestLink(id: string, ...nodeIds: string[]): HypergraphLink {
	return {
		id,
		link_type: 'TestLink',
		outgoing: nodeIds,
		metadata: {}
	};
}

suite('RocksDbPersistenceService', () => {
	let service: RocksDbPersistenceService;
	let mockMembrane: MockCognitiveMembraneService;

	setup(async () => {
		mockMembrane = new MockCognitiveMembraneService();
		service = new RocksDbPersistenceService(
			new NullLogService(),
			mockMembrane as any
		);
		await service.initialize();
	});

	teardown(async () => {
		await service.close();
		service.dispose();
	});

	suite('Lifecycle', () => {
		test('initializes with default config', async () => {
			const newService = new RocksDbPersistenceService(
				new NullLogService(),
				mockMembrane as any
			);

			assert.strictEqual(newService.isInitialized(), false);
			await newService.initialize();
			assert.strictEqual(newService.isInitialized(), true);

			await newService.close();
			assert.strictEqual(newService.isInitialized(), false);
			newService.dispose();
		});

		test('initializes with custom config', async () => {
			const newService = new RocksDbPersistenceService(
				new NullLogService(),
				mockMembrane as any
			);

			await newService.initialize({
				dbPath: 'custom-db',
				enableBloomFilters: false,
				compression: 'zstd'
			});

			assert.strictEqual(newService.isInitialized(), true);
			await newService.close();
			newService.dispose();
		});

		test('fires connection state events', async () => {
			const newService = new RocksDbPersistenceService(
				new NullLogService(),
				mockMembrane as any
			);

			const states: boolean[] = [];
			newService.onDidChangeConnectionState(state => states.push(state));

			await newService.initialize();
			assert.deepStrictEqual(states, [true]);

			await newService.close();
			assert.deepStrictEqual(states, [true, false]);
			newService.dispose();
		});

		test('throws when operations called before initialization', async () => {
			const newService = new RocksDbPersistenceService(
				new NullLogService(),
				mockMembrane as any
			);

			await assert.rejects(
				async () => newService.getNode('test'),
				/not initialized/
			);
			newService.dispose();
		});
	});

	suite('Node Operations', () => {
		test('stores and retrieves a node', async () => {
			const node = createTestNode('node-1', 'TestNode');
			await service.putNode(node);

			const retrieved = await service.getNode('node-1');
			assert.deepStrictEqual(retrieved, node);
		});

		test('returns undefined for non-existent node', async () => {
			const retrieved = await service.getNode('non-existent');
			assert.strictEqual(retrieved, undefined);
		});

		test('hasNode returns correct value', async () => {
			const node = createTestNode('node-1', 'TestNode');
			await service.putNode(node);

			assert.strictEqual(await service.hasNode('node-1'), true);
			assert.strictEqual(await service.hasNode('non-existent'), false);
		});

		test('deletes a node', async () => {
			const node = createTestNode('node-1', 'TestNode');
			await service.putNode(node);

			const deleted = await service.deleteNode('node-1');
			assert.strictEqual(deleted, true);
			assert.strictEqual(await service.hasNode('node-1'), false);

			const deletedAgain = await service.deleteNode('node-1');
			assert.strictEqual(deletedAgain, false);
		});

		test('getAllNodes returns all nodes with pagination', async () => {
			for (let i = 0; i < 10; i++) {
				await service.putNode(createTestNode(`node-${i}`, 'TestNode'));
			}

			const all = await service.getAllNodes();
			assert.strictEqual(all.length, 10);

			const page1 = await service.getAllNodes({ limit: 3, offset: 0 });
			assert.strictEqual(page1.length, 3);

			const page2 = await service.getAllNodes({ limit: 3, offset: 3 });
			assert.strictEqual(page2.length, 3);

			const page3 = await service.getAllNodes({ limit: 5, offset: 7 });
			assert.strictEqual(page3.length, 3);
		});

		test('getNodesByType filters correctly', async () => {
			await service.putNode(createTestNode('node-1', 'TypeA'));
			await service.putNode(createTestNode('node-2', 'TypeB'));
			await service.putNode(createTestNode('node-3', 'TypeA'));

			const typeA = await service.getNodesByType('TypeA');
			assert.strictEqual(typeA.length, 2);
			assert.ok(typeA.every(n => n.node_type === 'TypeA'));

			const typeB = await service.getNodesByType('TypeB');
			assert.strictEqual(typeB.length, 1);
		});

		test('getNodesBySalienceRange filters correctly', async () => {
			await service.putNode(createTestNode('node-1', 'Test', 0.2));
			await service.putNode(createTestNode('node-2', 'Test', 0.5));
			await service.putNode(createTestNode('node-3', 'Test', 0.8));
			await service.putNode(createTestNode('node-4', 'Test', 0.9));

			const mid = await service.getNodesBySalienceRange(0.4, 0.85);
			assert.strictEqual(mid.length, 2);

			const high = await service.getNodesBySalienceRange(0.7, 1.0);
			assert.strictEqual(high.length, 2);
			assert.strictEqual(high[0].salience_score, 0.9); // Sorted desc
		});

		test('updates existing node', async () => {
			const node1 = createTestNode('node-1', 'TestNode', 0.3);
			await service.putNode(node1);

			const node2 = { ...node1, salience_score: 0.9, content: 'Updated' };
			await service.putNode(node2);

			const retrieved = await service.getNode('node-1');
			assert.strictEqual(retrieved?.salience_score, 0.9);
			assert.strictEqual(retrieved?.content, 'Updated');
		});
	});

	suite('Link Operations', () => {
		test('stores and retrieves a link', async () => {
			const link = createTestLink('link-1', 'node-a', 'node-b');
			await service.putLink(link);

			const retrieved = await service.getLink('link-1');
			assert.deepStrictEqual(retrieved, link);
		});

		test('returns undefined for non-existent link', async () => {
			const retrieved = await service.getLink('non-existent');
			assert.strictEqual(retrieved, undefined);
		});

		test('deletes a link', async () => {
			const link = createTestLink('link-1', 'node-a', 'node-b');
			await service.putLink(link);

			const deleted = await service.deleteLink('link-1');
			assert.strictEqual(deleted, true);
			assert.strictEqual(await service.getLink('link-1'), undefined);
		});

		test('getLinksForNode returns all links for a node', async () => {
			await service.putLink(createTestLink('link-1', 'node-a', 'node-b'));
			await service.putLink(createTestLink('link-2', 'node-a', 'node-c'));
			await service.putLink(createTestLink('link-3', 'node-d', 'node-a'));
			await service.putLink(createTestLink('link-4', 'node-b', 'node-c'));

			const linksForA = await service.getLinksForNode('node-a');
			assert.strictEqual(linksForA.length, 3); // 3 links include node-a in outgoing

			const linksForB = await service.getLinksForNode('node-b');
			assert.strictEqual(linksForB.length, 2);
		});

		test('getAllLinks returns all links with pagination', async () => {
			for (let i = 0; i < 5; i++) {
				await service.putLink(createTestLink(`link-${i}`, 'src', `tgt-${i}`));
			}

			const all = await service.getAllLinks();
			assert.strictEqual(all.length, 5);

			const page = await service.getAllLinks({ limit: 2, offset: 2 });
			assert.strictEqual(page.length, 2);
		});
	});

	suite('Range Queries', () => {
		test('rangeQuery with prefix filter', async () => {
			await service.putNode(createTestNode('user:alice', 'User'));
			await service.putNode(createTestNode('user:bob', 'User'));
			await service.putNode(createTestNode('system:config', 'Config'));

			const result = await service.rangeQuery<HypergraphNode>({
				columnFamily: 'nodes',
				prefix: 'user:'
			});

			assert.strictEqual(result.items.length, 2);
			assert.ok(result.items.every(n => n.id.startsWith('user:')));
		});

		test('rangeQuery with start/end bounds', async () => {
			await service.putNode(createTestNode('a-node', 'Test'));
			await service.putNode(createTestNode('b-node', 'Test'));
			await service.putNode(createTestNode('c-node', 'Test'));
			await service.putNode(createTestNode('d-node', 'Test'));

			const result = await service.rangeQuery<HypergraphNode>({
				columnFamily: 'nodes',
				startKey: 'b',
				endKey: 'd'
			});

			assert.strictEqual(result.items.length, 2);
			assert.ok(result.items.some(n => n.id === 'b-node'));
			assert.ok(result.items.some(n => n.id === 'c-node'));
		});

		test('rangeQuery with pagination', async () => {
			for (let i = 0; i < 10; i++) {
				await service.putNode(createTestNode(`node-${String(i).padStart(2, '0')}`, 'Test'));
			}

			const page1 = await service.rangeQuery<HypergraphNode>({
				columnFamily: 'nodes',
				limit: 3,
				offset: 0
			});

			assert.strictEqual(page1.items.length, 3);
			assert.strictEqual(page1.hasMore, true);
			assert.strictEqual(page1.totalCount, 10);

			const page2 = await service.rangeQuery<HypergraphNode>({
				columnFamily: 'nodes',
				limit: 3,
				offset: parseInt(page1.nextCursor!)
			});

			assert.strictEqual(page2.items.length, 3);
			assert.strictEqual(page2.hasMore, true);
		});

		test('rangeQuery with reverse order', async () => {
			await service.putNode(createTestNode('a-node', 'Test'));
			await service.putNode(createTestNode('b-node', 'Test'));
			await service.putNode(createTestNode('c-node', 'Test'));

			const result = await service.rangeQuery<HypergraphNode>({
				columnFamily: 'nodes',
				reverse: true
			});

			assert.strictEqual(result.items[0].id, 'c-node');
			assert.strictEqual(result.items[2].id, 'a-node');
		});

		test('iteratePrefix calls callback for matching keys', async () => {
			await service.putNode(createTestNode('prefix:1', 'Test'));
			await service.putNode(createTestNode('prefix:2', 'Test'));
			await service.putNode(createTestNode('other:1', 'Test'));

			const found: string[] = [];
			await service.iteratePrefix('nodes', 'prefix:', (key) => {
				found.push(key);
			});

			assert.strictEqual(found.length, 2);
			assert.ok(found.every(k => k.startsWith('prefix:')));
		});

		test('iteratePrefix stops when callback returns false', async () => {
			for (let i = 0; i < 10; i++) {
				await service.putNode(createTestNode(`item:${i}`, 'Test'));
			}

			const found: string[] = [];
			await service.iteratePrefix('nodes', 'item:', (key) => {
				found.push(key);
				return found.length < 3; // Stop after 3
			});

			assert.strictEqual(found.length, 3);
		});
	});

	suite('Batch Operations', () => {
		test('batchWrite executes multiple operations atomically', async () => {
			await service.batchWrite([
				{ type: 'put', columnFamily: 'nodes', key: 'node-1', value: JSON.stringify(createTestNode('node-1', 'Test')) },
				{ type: 'put', columnFamily: 'nodes', key: 'node-2', value: JSON.stringify(createTestNode('node-2', 'Test')) },
				{ type: 'put', columnFamily: 'links', key: 'link-1', value: JSON.stringify(createTestLink('link-1', 'node-1', 'node-2')) }
			]);

			assert.ok(await service.hasNode('node-1'));
			assert.ok(await service.hasNode('node-2'));
			assert.ok(await service.getLink('link-1'));
		});

		test('batchWrite handles delete operations', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));
			await service.putNode(createTestNode('node-2', 'Test'));

			await service.batchWrite([
				{ type: 'delete', columnFamily: 'nodes', key: 'node-1' },
				{ type: 'put', columnFamily: 'nodes', key: 'node-3', value: JSON.stringify(createTestNode('node-3', 'Test')) }
			]);

			assert.strictEqual(await service.hasNode('node-1'), false);
			assert.strictEqual(await service.hasNode('node-2'), true);
			assert.strictEqual(await service.hasNode('node-3'), true);
		});

		test('batchWrite handles merge operations', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));

			await service.batchWrite([
				{ type: 'merge', columnFamily: 'nodes', key: 'node-1', value: JSON.stringify({ salience_score: 0.99 }) }
			]);

			const node = await service.getNode('node-1');
			assert.strictEqual(node?.salience_score, 0.99);
		});

		test('bulkPutNodes inserts multiple nodes efficiently', async () => {
			const nodes = Array.from({ length: 100 }, (_, i) =>
				createTestNode(`bulk-node-${i}`, i % 2 === 0 ? 'TypeA' : 'TypeB')
			);

			const result = await service.bulkPutNodes(nodes);

			assert.strictEqual(result.inserted, 100);
			assert.strictEqual(result.updated, 0);

			const all = await service.getAllNodes();
			assert.strictEqual(all.length, 100);
		});

		test('bulkPutNodes counts updates correctly', async () => {
			await service.putNode(createTestNode('bulk-node-0', 'Test'));
			await service.putNode(createTestNode('bulk-node-1', 'Test'));

			const nodes = Array.from({ length: 5 }, (_, i) =>
				createTestNode(`bulk-node-${i}`, 'NewType')
			);

			const result = await service.bulkPutNodes(nodes);

			assert.strictEqual(result.inserted, 3);
			assert.strictEqual(result.updated, 2);
		});

		test('bulkPutLinks inserts multiple links efficiently', async () => {
			const links = Array.from({ length: 50 }, (_, i) =>
				createTestLink(`bulk-link-${i}`, `src-${i}`, `tgt-${i}`)
			);

			const result = await service.bulkPutLinks(links);

			assert.strictEqual(result.inserted, 50);
			assert.strictEqual(result.updated, 0);

			const all = await service.getAllLinks();
			assert.strictEqual(all.length, 50);
		});
	});

	suite('Index Management', () => {
		test('creates and uses secondary index', async () => {
			const indexDef: IndexDefinition = {
				name: 'by-content',
				sourceColumnFamily: 'nodes',
				keyExtractor: 'content',
				unique: false,
				sparse: false
			};

			await service.createIndex(indexDef);

			const indices = await service.listIndices();
			assert.strictEqual(indices.length, 1);
			assert.strictEqual(indices[0].name, 'by-content');
		});

		test('drops an index', async () => {
			await service.createIndex({
				name: 'temp-index',
				sourceColumnFamily: 'nodes',
				keyExtractor: 'node_type',
				unique: false,
				sparse: false
			});

			await service.dropIndex('temp-index');

			const indices = await service.listIndices();
			assert.strictEqual(indices.length, 0);
		});

		test('rebuilds an index', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));
			await service.putNode(createTestNode('node-2', 'Test'));

			await service.createIndex({
				name: 'type-index',
				sourceColumnFamily: 'nodes',
				keyExtractor: 'node_type',
				unique: false,
				sparse: false
			});

			// Rebuild should not throw
			await service.rebuildIndex('type-index');
		});

		test('throws when rebuilding non-existent index', async () => {
			await assert.rejects(
				async () => service.rebuildIndex('non-existent'),
				/Index not found/
			);
		});
	});

	suite('Compaction & Maintenance', () => {
		test('compact triggers compaction event', async () => {
			let compactionEvent: { columnFamily?: string; durationMs: number } | undefined;
			service.onDidCompleteCompaction(e => { compactionEvent = e; });

			await service.compact('nodes');

			assert.ok(compactionEvent);
			assert.strictEqual(compactionEvent?.columnFamily, 'nodes');
			assert.ok(compactionEvent?.durationMs >= 0);
		});

		test('getCompactionStatus returns status', async () => {
			const status = await service.getCompactionStatus();

			assert.strictEqual(status.isRunning, false);
			assert.strictEqual(status.lastCompactionTime, undefined);

			await service.compact();
			const status2 = await service.getCompactionStatus();
			assert.ok(status2.lastCompactionTime);
		});

		test('flush completes without error', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));
			await service.flush(); // Should not throw
		});
	});

	suite('Statistics', () => {
		test('getStats returns accurate counts', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));
			await service.putNode(createTestNode('node-2', 'Test'));
			await service.putLink(createTestLink('link-1', 'node-1', 'node-2'));

			const stats = await service.getStats();

			assert.strictEqual(stats.entryCounts.nodes, 2);
			assert.strictEqual(stats.entryCounts.links, 1);
			assert.ok(stats.dbSizeBytes > 0);
		});

		test('getEntryCount returns correct count', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));
			await service.putNode(createTestNode('node-2', 'Test'));

			const count = await service.getEntryCount('nodes');
			assert.strictEqual(count, 2);
		});

		test('estimateSize returns positive value', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));

			const size = await service.estimateSize();
			assert.ok(size > 0);
		});
	});

	suite('Snapshots & Backup', () => {
		test('creates and releases snapshot', async () => {
			await service.putNode(createTestNode('node-1', 'Test'));

			const snapshotId = await service.createSnapshot();
			assert.ok(snapshotId.startsWith('snapshot-'));

			// Should not throw
			await service.releaseSnapshot(snapshotId);
		});

		test('creates backup and restores', async () => {
			let backupEvents: Array<{ operation: string; path: string; success: boolean }> = [];
			service.onDidBackupOrRestore(e => backupEvents.push(e));

			await service.putNode(createTestNode('node-1', 'Original'));
			await service.putNode(createTestNode('node-2', 'Original'));

			await service.createBackup('backup-test');
			assert.strictEqual(backupEvents.length, 1);
			assert.strictEqual(backupEvents[0].operation, 'backup');
			assert.strictEqual(backupEvents[0].success, true);

			// Modify data
			await service.deleteNode('node-1');
			await service.putNode(createTestNode('node-3', 'New'));

			// Restore
			await service.restoreFromBackup('backup-test');
			assert.strictEqual(backupEvents.length, 2);
			assert.strictEqual(backupEvents[1].operation, 'restore');

			// Verify restored state
			assert.ok(await service.hasNode('node-1'));
			assert.ok(await service.hasNode('node-2'));
			assert.strictEqual(await service.hasNode('node-3'), false);
		});

		test('restore from non-existent backup throws', async () => {
			let restoreEvent: { success: boolean } | undefined;
			service.onDidBackupOrRestore(e => { if (e.operation === 'restore') restoreEvent = e; });

			await assert.rejects(
				async () => service.restoreFromBackup('non-existent'),
				/Backup not found/
			);
			assert.strictEqual(restoreEvent?.success, false);
		});
	});

	suite('Membrane Activity Recording', () => {
		test('records somatic activity on writes', async () => {
			mockMembrane.clear();

			await service.putNode(createTestNode('node-1', 'Test'));
			await service.putLink(createTestLink('link-1', 'a', 'b'));
			await service.deleteNode('node-1');

			const activities = mockMembrane.getActivities();
			assert.ok(activities.filter(a => a === 'somatic').length >= 3);
		});

		test('records autonomic activity on maintenance ops', async () => {
			mockMembrane.clear();

			await service.compact();

			const activities = mockMembrane.getActivities();
			assert.ok(activities.includes('autonomic'));
		});
	});

	suite('Bloom Filter Optimization', () => {
		test('bloom filter enables fast negative lookups', async () => {
			// Add some nodes
			for (let i = 0; i < 100; i++) {
				await service.putNode(createTestNode(`node-${i}`, 'Test'));
			}

			// Non-existent keys should be fast (bloom filter returns false)
			const start = Date.now();
			for (let i = 0; i < 1000; i++) {
				await service.hasNode(`non-existent-${i}`);
			}
			const duration = Date.now() - start;

			// Should be very fast (< 100ms for 1000 lookups)
			assert.ok(duration < 1000, `Bloom filter lookups took ${duration}ms`);
		});

		test('works correctly with bloom filters disabled', async () => {
			const newService = new RocksDbPersistenceService(
				new NullLogService(),
				mockMembrane as any
			);

			await newService.initialize({ enableBloomFilters: false });

			await newService.putNode(createTestNode('node-1', 'Test'));
			assert.strictEqual(await newService.hasNode('node-1'), true);
			assert.strictEqual(await newService.hasNode('non-existent'), false);

			await newService.close();
			newService.dispose();
		});
	});

	suite('Index Consistency', () => {
		test('node type index updates when node type changes', async () => {
			// Insert node with TypeA
			await service.putNode(createTestNode('node-1', 'TypeA'));
			let typeA = await service.getNodesByType('TypeA');
			assert.strictEqual(typeA.length, 1);

			// Update same node to TypeB
			await service.putNode(createTestNode('node-1', 'TypeB'));
			typeA = await service.getNodesByType('TypeA');
			const typeB = await service.getNodesByType('TypeB');

			// TypeA should be empty, TypeB should have the node
			assert.strictEqual(typeA.length, 0, 'Old type index should be cleared');
			assert.strictEqual(typeB.length, 1, 'New type index should have the node');
		});

		test('link index updates when link outgoing nodes change', async () => {
			// Insert link connecting node-a and node-b
			await service.putLink(createTestLink('link-1', 'node-a', 'node-b'));
			let linksForA = await service.getLinksForNode('node-a');
			let linksForB = await service.getLinksForNode('node-b');
			assert.strictEqual(linksForA.length, 1);
			assert.strictEqual(linksForB.length, 1);

			// Update link to connect node-c and node-d instead
			await service.putLink({ id: 'link-1', link_type: 'TestLink', outgoing: ['node-c', 'node-d'], metadata: {} });
			linksForA = await service.getLinksForNode('node-a');
			linksForB = await service.getLinksForNode('node-b');
			const linksForC = await service.getLinksForNode('node-c');
			const linksForD = await service.getLinksForNode('node-d');

			assert.strictEqual(linksForA.length, 0, 'Old node-a index should be cleared');
			assert.strictEqual(linksForB.length, 0, 'Old node-b index should be cleared');
			assert.strictEqual(linksForC.length, 1, 'New node-c index should have the link');
			assert.strictEqual(linksForD.length, 1, 'New node-d index should have the link');
		});

		test('batch writes maintain node type indexes', async () => {
			await service.batchWrite([
				{ type: 'put', columnFamily: 'nodes', key: 'node-1', value: JSON.stringify(createTestNode('node-1', 'TypeA')) },
				{ type: 'put', columnFamily: 'nodes', key: 'node-2', value: JSON.stringify(createTestNode('node-2', 'TypeA')) },
				{ type: 'put', columnFamily: 'nodes', key: 'node-3', value: JSON.stringify(createTestNode('node-3', 'TypeB')) }
			]);

			const typeA = await service.getNodesByType('TypeA');
			const typeB = await service.getNodesByType('TypeB');

			assert.strictEqual(typeA.length, 2);
			assert.strictEqual(typeB.length, 1);
		});

		test('batch writes maintain link indexes', async () => {
			await service.batchWrite([
				{ type: 'put', columnFamily: 'links', key: 'link-1', value: JSON.stringify(createTestLink('link-1', 'node-a', 'node-b')) },
				{ type: 'put', columnFamily: 'links', key: 'link-2', value: JSON.stringify(createTestLink('link-2', 'node-a', 'node-c')) }
			]);

			const linksForA = await service.getLinksForNode('node-a');
			assert.strictEqual(linksForA.length, 2);
		});

		test('batch write delete removes index entries', async () => {
			await service.putNode(createTestNode('node-1', 'TypeA'));
			assert.strictEqual((await service.getNodesByType('TypeA')).length, 1);

			await service.batchWrite([
				{ type: 'delete', columnFamily: 'nodes', key: 'node-1' }
			]);

			assert.strictEqual((await service.getNodesByType('TypeA')).length, 0);
		});
	});

	suite('Batch Write Atomicity', () => {
		test('batch write rolls back on failure', async () => {
			// Insert initial data
			await service.putNode(createTestNode('node-1', 'TypeA'));

			// Attempt batch with invalid merge that will fail
			try {
				await service.batchWrite([
					{ type: 'put', columnFamily: 'nodes', key: 'node-2', value: JSON.stringify(createTestNode('node-2', 'TypeB')) },
					{ type: 'merge', columnFamily: 'nodes', key: 'node-3', value: 'invalid json {{{' }
				]);
				assert.fail('Should have thrown');
			} catch {
				// Expected
			}

			// Original data should be intact
			assert.ok(await service.hasNode('node-1'), 'Original node should still exist');
			// Partial batch should have been rolled back
			assert.strictEqual(await service.hasNode('node-2'), false, 'Partial batch should be rolled back');
		});
	});

	suite('Backup and Restore Consistency', () => {
		test('restoring multiple times from same backup works', async () => {
			await service.putNode(createTestNode('node-1', 'Original'));
			await service.createBackup('backup-1');

			// First restore after modifications
			await service.deleteNode('node-1');
			await service.putNode(createTestNode('node-2', 'New'));
			await service.restoreFromBackup('backup-1');
			assert.ok(await service.hasNode('node-1'));
			assert.strictEqual(await service.hasNode('node-2'), false);

			// Second restore should still work
			await service.putNode(createTestNode('node-3', 'Another'));
			await service.restoreFromBackup('backup-1');
			assert.ok(await service.hasNode('node-1'));
			assert.strictEqual(await service.hasNode('node-3'), false);
		});

		test('indexes are correct after restore', async () => {
			await service.putNode(createTestNode('node-1', 'TypeA'));
			await service.putNode(createTestNode('node-2', 'TypeA'));
			await service.putLink(createTestLink('link-1', 'node-1', 'node-2'));
			await service.createBackup('backup-indexes');

			// Modify data
			await service.deleteNode('node-1');
			await service.deleteNode('node-2');
			await service.deleteLink('link-1');
			await service.putNode(createTestNode('node-3', 'TypeB'));

			// Restore
			await service.restoreFromBackup('backup-indexes');

			// Verify indexes work correctly
			const typeA = await service.getNodesByType('TypeA');
			const typeB = await service.getNodesByType('TypeB');
			const linksForNode1 = await service.getLinksForNode('node-1');

			assert.strictEqual(typeA.length, 2, 'TypeA index should be restored');
			assert.strictEqual(typeB.length, 0, 'TypeB index should not exist after restore');
			assert.strictEqual(linksForNode1.length, 1, 'Link index should be restored');
		});
	});
});
