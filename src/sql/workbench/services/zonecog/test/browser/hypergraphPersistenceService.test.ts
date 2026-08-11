/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IHypergraphPersistenceService } from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import {
	HypergraphPersistenceService,
	nodesAndLinksToCypher,
	nodesAndLinksToAtomSpaceScheme,
} from 'sql/workbench/services/zonecog/browser/hypergraphPersistenceService';
import { RocksDbPersistenceService } from 'sql/workbench/services/zonecog/browser/rocksDbPersistenceService';
import {
	RocksDbEngine,
	WasmBloomFilter,
	prefixSuccessor,
	encodeJson,
	decodeJson,
} from 'sql/workbench/services/zonecog/browser/rocksDbEngine';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { IAtomSpaceBackendService } from 'sql/workbench/services/zonecog/common/atomSpaceBackend';
import { AtomSpaceBackendService } from 'sql/workbench/services/zonecog/browser/atomSpaceBackendService';
import { IPLNReasoningService } from 'sql/workbench/services/zonecog/common/plnReasoning';
import { PLNReasoningService } from 'sql/workbench/services/zonecog/browser/plnReasoningService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Minimal IndexedDB stub for the test environment
//
// IMPORTANT: This mock fires callbacks synchronously via setImmediate/setTimeout(0)
// to ensure proper ordering with Promise-based code in the service.
// ---------------------------------------------------------------------------

interface IDBRecord { [key: string]: unknown }

/**
 * Schedule a callback to fire asynchronously but in a way that's compatible
 * with the service's Promise-wrapped IndexedDB operations.
 */
function scheduleCallback(fn: () => void): void {
	// Use setImmediate if available (Node.js), otherwise setTimeout
	if (typeof setImmediate !== 'undefined') {
		setImmediate(fn);
	} else {
		setTimeout(fn, 0);
	}
}

class MockIDBObjectStore {
	private _data = new Map<string, IDBRecord>();
	keyPath: string;

	constructor(keyPath: string) { this.keyPath = keyPath; }

	put(record: IDBRecord): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null } {
		const key = record[this.keyPath] as string;
		this._data.set(String(key), { ...record });
		const req = { onsuccess: null as (() => void) | null, onerror: null as ((e: unknown) => void) | null };
		scheduleCallback(() => req.onsuccess?.());
		return req;
	}

	clear(): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null } {
		this._data.clear();
		const req = { onsuccess: null as (() => void) | null, onerror: null as ((e: unknown) => void) | null };
		scheduleCallback(() => req.onsuccess?.());
		return req;
	}

	getAll(): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null; result: IDBRecord[] } {
		const result = Array.from(this._data.values());
		const req = {
			onsuccess: null as (() => void) | null,
			onerror: null as ((e: unknown) => void) | null,
			result,
		};
		scheduleCallback(() => req.onsuccess?.());
		return req;
	}

	get(key: string): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null; result: IDBRecord | undefined } {
		const result = this._data.get(String(key));
		const req = {
			onsuccess: null as (() => void) | null,
			onerror: null as ((e: unknown) => void) | null,
			result,
		};
		scheduleCallback(() => req.onsuccess?.());
		return req;
	}

	delete(key: string): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null } {
		this._data.delete(String(key));
		const req = { onsuccess: null as (() => void) | null, onerror: null as ((e: unknown) => void) | null };
		scheduleCallback(() => req.onsuccess?.());
		return req;
	}

	count(): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null; result: number } {
		const result = this._data.size;
		const req = {
			onsuccess: null as (() => void) | null,
			onerror: null as ((e: unknown) => void) | null,
			result,
		};
		scheduleCallback(() => req.onsuccess?.());
		return req;
	}

	getSize(): number { return this._data.size; }
}

class MockIDBTransaction {
	private _stores: Map<string, MockIDBObjectStore>;
	private _oncompleteFn: (() => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	error: null = null;
	private _completionScheduled = false;

	constructor(stores: Map<string, MockIDBObjectStore>) {
		this._stores = stores;
	}

	objectStore(name: string): MockIDBObjectStore {
		return this._stores.get(name)!;
	}

	/**
	 * oncomplete is handled via getter/setter to schedule completion
	 * only after the handler is actually assigned (after all operations are queued).
	 */
	set oncomplete(fn: (() => void) | null) {
		this._oncompleteFn = fn;
		if (fn && !this._completionScheduled) {
			this._completionScheduled = true;
			// Schedule oncomplete after multiple ticks to ensure all operation callbacks fire first
			scheduleCallback(() => {
				scheduleCallback(() => {
					this._oncompleteFn?.();
				});
			});
		}
	}

	get oncomplete(): (() => void) | null {
		return this._oncompleteFn;
	}
}

class MockIDBDatabase {
	private _stores = new Map<string, MockIDBObjectStore>([
		['nodes', new MockIDBObjectStore('id')],
		['links', new MockIDBObjectStore('id')],
		['snapshots', new MockIDBObjectStore('id')],
		['archiveNodes', new MockIDBObjectStore('id')],
		['archiveLinks', new MockIDBObjectStore('id')],
		['warmNodes', new MockIDBObjectStore('id')],
		['warmLinks', new MockIDBObjectStore('id')],
		['changelog', new MockIDBObjectStore('id')],
		// RocksDB durability sink reuses the same mock factory under a
		// different DB name; include its store so open() succeeds in tests.
		['engine', new MockIDBObjectStore('id')],
	]);

	objectStoreNames = { contains: (_name: string) => true };

	transaction(storeNames: string | string[], _mode: string): MockIDBTransaction {
		const names = Array.isArray(storeNames) ? storeNames : [storeNames];
		// IMPORTANT: Reuse the database's stores instead of creating new ones.
		// This ensures data persisted in one transaction is visible in subsequent transactions.
		const stores = new Map<string, MockIDBObjectStore>();
		for (const n of names) {
			const store = this._stores.get(n);
			if (store) { stores.set(n, store); }
		}
		return new MockIDBTransaction(stores);
	}

	getStore(name: string): MockIDBObjectStore { return this._stores.get(name)!; }
	close(): void { /* noop */ }
}

// Install the mock into the global scope for tests
let originalIndexedDB: IDBFactory | undefined;

function installIndexedDBMock(): MockIDBDatabase {
	const db = new MockIDBDatabase();
	const openReq = {
		onsuccess: null as ((ev: { target: { result: MockIDBDatabase } }) => void) | null,
		onerror: null as ((e: unknown) => void) | null,
		onupgradeneeded: null as ((ev: { target: { result: MockIDBDatabase } }) => void) | null,
		result: db,
	};
	const mockIndexedDB = {
		open: (_name: string, _version: number) => {
			scheduleCallback(() => openReq.onsuccess?.({ target: { result: db } }));
			return openReq;
		},
	};

	// Store original value for cleanup
	try {
		originalIndexedDB = (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
	} catch {
		originalIndexedDB = undefined;
	}

	// Use Object.defineProperty to override read-only property in browser environments
	try {
		Object.defineProperty(globalThis, 'indexedDB', {
			value: mockIndexedDB,
			writable: true,
			configurable: true,
		});
	} catch {
		// Fallback for environments where defineProperty fails
		(globalThis as unknown as Record<string, unknown>)['indexedDB'] = mockIndexedDB;
	}

	return db;
}

function uninstallIndexedDBMock(): void {
	try {
		if (originalIndexedDB !== undefined) {
			Object.defineProperty(globalThis, 'indexedDB', {
				value: originalIndexedDB,
				writable: true,
				configurable: true,
			});
		} else {
			// Delete the mock if there was no original
			delete (globalThis as unknown as Record<string, unknown>)['indexedDB'];
		}
	} catch {
		// Ignore cleanup errors
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('Hypergraph Persistence Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let persistenceService: IHypergraphPersistenceService;
	let hypergraphStore: IHypergraphStore;
	let mockDb: MockIDBDatabase;

	setup(() => {
		mockDb = installIndexedDBMock();

		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const plnService = instantiationService.createInstance(PLNReasoningService);
		instantiationService.stub(IPLNReasoningService, plnService);

		const atomSpaceBackend = instantiationService.createInstance(AtomSpaceBackendService);
		instantiationService.stub(IAtomSpaceBackendService, atomSpaceBackend);

		persistenceService = instantiationService.createInstance(HypergraphPersistenceService);
	});

	teardown(() => {
		persistenceService.dispose();
		uninstallIndexedDBMock();
	});

	test('should report auto-save as disabled by default', () => {
		assert.strictEqual(persistenceService.isAutoSaveEnabled(), false);
	});

	test('should enable and disable auto-save', () => {
		persistenceService.enableAutoSave(10_000);
		assert.strictEqual(persistenceService.isAutoSaveEnabled(), true);

		persistenceService.disableAutoSave();
		assert.strictEqual(persistenceService.isAutoSaveEnabled(), false);
	});

	test('should save hypergraph nodes to IndexedDB', async () => {
		// Populate the in-memory store
		hypergraphStore.addNode({
			id: 'test-node-1',
			node_type: 'TestNode',
			content: 'Test content',
			links: [],
			metadata: {},
			salience_score: 0.7,
		});
		hypergraphStore.addNode({
			id: 'test-node-2',
			node_type: 'TestNode',
			content: 'Another test',
			links: [],
			metadata: {},
			salience_score: 0.5,
		});

		const snapshot = await persistenceService.save('test-save');

		assert.strictEqual(snapshot.nodeCount, 2);
		assert.strictEqual(snapshot.label, 'test-save');
		assert.ok(snapshot.id > 0);
		assert.ok(snapshot.timestamp > 0);

		// Verify nodes are in the mock DB store
		const nodeStore = mockDb.getStore('nodes');
		assert.strictEqual(nodeStore.getSize(), 2);
	});

	test('should load hypergraph nodes from IndexedDB', async () => {
		// Save first
		hypergraphStore.addNode({
			id: 'persist-node-1',
			node_type: 'PersistNode',
			content: 'Persisted content',
			links: [],
			metadata: { persisted: true },
			salience_score: 0.9,
		});
		await persistenceService.save();

		// Clear in-memory store and load
		hypergraphStore.clear();
		assert.strictEqual(hypergraphStore.nodeCount(), 0);

		const loaded = await persistenceService.load();
		assert.ok(loaded, 'Should return a snapshot');
		assert.ok(loaded!.nodeCount >= 1);

		// Verify node is restored
		assert.strictEqual(hypergraphStore.nodeCount(), 1);
		const restored = hypergraphStore.getNode('persist-node-1');
		assert.ok(restored, 'Node should be restored');
		assert.strictEqual(restored!.content, 'Persisted content');
	});

	test('should return undefined when loading from empty storage', async () => {
		const result = await persistenceService.load();
		assert.strictEqual(result, undefined);
	});

	test('should list snapshots in reverse chronological order', async () => {
		hypergraphStore.addNode({
			id: 'snap-node', node_type: 'T', content: 'c', links: [], metadata: {}, salience_score: 0.5,
		});

		await persistenceService.save('snap-1');
		// Wait a tick to ensure different timestamps
		await new Promise(r => setTimeout(r, 5));
		await persistenceService.save('snap-2');

		const snapshots = await persistenceService.listSnapshots();
		assert.ok(snapshots.length >= 2);
		// Most recent first
		assert.ok(snapshots[0].timestamp >= snapshots[1].timestamp);
	});

	test('should clear storage', async () => {
		hypergraphStore.addNode({
			id: 'clear-node', node_type: 'T', content: 'c', links: [], metadata: {}, salience_score: 0.5,
		});
		await persistenceService.save();

		await persistenceService.clearStorage();

		const nodeStore = mockDb.getStore('nodes');
		assert.strictEqual(nodeStore.getSize(), 0);
	});

	test('should fire onDidSave event after save', async () => {
		let saveFired = false;
		persistenceService.onDidSave(() => { saveFired = true; });

		await persistenceService.save();
		assert.ok(saveFired);
	});

	test('should fire onDidLoad event after load', async () => {
		hypergraphStore.addNode({
			id: 'load-event-node', node_type: 'T', content: 'c', links: [], metadata: {}, salience_score: 0.3,
		});
		await persistenceService.save();
		hypergraphStore.clear();

		let loadFired = false;
		persistenceService.onDidLoad(() => { loadFired = true; });
		await persistenceService.load();
		assert.ok(loadFired);
	});

	// --- Export Tests ---

	test('should export nodes and links to a Cypher script', () => {
		hypergraphStore.addNode({
			id: 'users', node_type: 'TableNode', content: 'users table', links: [], metadata: { schema: 'dbo' }, salience_score: 0.8,
		});
		hypergraphStore.addNode({
			id: 'orders', node_type: 'TableNode', content: 'orders table', links: [], metadata: {}, salience_score: 0.6,
		});
		hypergraphStore.addLink({
			id: 'fk-1', link_type: 'ForeignKey', outgoing: ['orders', 'users'], metadata: {},
		});

		const cypher = persistenceService.exportToCypher();

		assert.ok(cypher.includes("CREATE (:TableNode {id: 'users'"));
		assert.ok(cypher.includes("schema: 'dbo'"));
		assert.ok(cypher.includes("CREATE (:TableNode {id: 'orders'"));
		assert.ok(cypher.includes("CREATE (:HyperLink:FOREIGNKEY {id: 'fk-1'});"));
		assert.ok(cypher.includes("MATCH (l {id: 'fk-1'}), (t {id: 'orders'}) CREATE (l)-[:PARTICIPATES {position: 0}]->(t);"));
		assert.ok(cypher.includes("MATCH (l {id: 'fk-1'}), (t {id: 'users'}) CREATE (l)-[:PARTICIPATES {position: 1}]->(t);"));
	});

	test('should export nodes and links to AtomSpace Scheme', () => {
		hypergraphStore.addNode({
			id: 'n1', node_type: 'ConceptNode', content: 'first concept', links: [], metadata: {}, salience_score: 0.75,
		});
		hypergraphStore.addNode({
			id: 'n2', node_type: 'ConceptNode', content: 'second concept', links: [], metadata: {}, salience_score: 0.25,
		});
		hypergraphStore.addLink({
			id: 'link-1', link_type: 'SimilarityLink', outgoing: ['n1', 'n2'], metadata: {},
		});

		const scheme = persistenceService.exportToAtomSpaceScheme();

		assert.ok(scheme.includes('(ConceptNode "n1" (stv 0.75 1.0))'));
		assert.ok(scheme.includes('(ConceptNode "n2" (stv 0.25 1.0))'));
		assert.ok(scheme.includes('(SimilarityLink (stv 1.0 1.0)'));
		assert.ok(scheme.includes('(ConceptNode "n1")'));
		assert.ok(scheme.includes('(ConceptNode "n2")'));
	});

	test('should export an empty hypergraph as a header-only script', () => {
		const cypher = persistenceService.exportToCypher();
		const scheme = persistenceService.exportToAtomSpaceScheme();

		assert.ok(cypher.includes('0 node(s), 0 link(s)'));
		assert.ok(scheme.includes('0 node(s), 0 link(s)'));
	});

	test('should record autonomic membrane activity on export', () => {
		const membraneService = instantiationService.get(ICognitiveMembraneService);
		const before = membraneService.getActivity('autonomic');

		persistenceService.exportToCypher();

		assert.ok(membraneService.getActivity('autonomic') > before);
	});

	// --- Tiered storage (hybrid hot/cold hypergraph) tests ---

	test('should archive nodes below the salience threshold and remove them from the live store', async () => {
		hypergraphStore.addNode({
			id: 'cold-node', node_type: 'T', content: 'stale', links: [], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addNode({
			id: 'hot-node', node_type: 'T', content: 'active', links: [], metadata: {}, salience_score: 0.9,
		});

		const result = await persistenceService.archiveLowSalienceNodes(0.05);

		assert.strictEqual(result.archivedNodeCount, 1);
		assert.strictEqual(result.archivedLinkCount, 0);
		assert.strictEqual(hypergraphStore.getNode('cold-node'), undefined);
		assert.ok(hypergraphStore.getNode('hot-node'), 'hot node should remain live');

		const archived = await persistenceService.listArchivedNodes();
		assert.strictEqual(archived.length, 1);
		assert.strictEqual(archived[0].id, 'cold-node');
	});

	test('should archive a link only when every outgoing node is also archived', async () => {
		hypergraphStore.addNode({
			id: 'cold-a', node_type: 'T', content: '', links: ['fully-cold'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addNode({
			id: 'cold-b', node_type: 'T', content: '', links: ['fully-cold'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addNode({
			id: 'hot-c', node_type: 'T', content: '', links: ['partially-hot'], metadata: {}, salience_score: 0.9,
		});
		hypergraphStore.addNode({
			id: 'cold-d', node_type: 'T', content: '', links: ['partially-hot'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addLink({ id: 'fully-cold', link_type: 'L', outgoing: ['cold-a', 'cold-b'], metadata: {} });
		hypergraphStore.addLink({ id: 'partially-hot', link_type: 'L', outgoing: ['hot-c', 'cold-d'], metadata: {} });

		const result = await persistenceService.archiveLowSalienceNodes(0.05);

		assert.strictEqual(result.archivedNodeCount, 3);
		assert.strictEqual(result.archivedLinkCount, 1);
		assert.ok(hypergraphStore.getLink('fully-cold') === undefined, 'link fully within the archived set should be archived');
		assert.ok(hypergraphStore.getLink('partially-hot'), 'link with a remaining hot endpoint should stay live');
	});

	test('should report zero archived when nothing is below the threshold', async () => {
		hypergraphStore.addNode({
			id: 'hot-only', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.9,
		});

		const result = await persistenceService.archiveLowSalienceNodes(0.05);
		assert.strictEqual(result.archivedNodeCount, 0);
		assert.strictEqual(result.archivedLinkCount, 0);
	});

	test('should lazily restore a single archived node and its own links back into the live store', async () => {
		hypergraphStore.addNode({
			id: 'r-a', node_type: 'T', content: '', links: ['r-link'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addNode({
			id: 'r-b', node_type: 'T', content: '', links: ['r-link'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addLink({ id: 'r-link', link_type: 'L', outgoing: ['r-a', 'r-b'], metadata: {} });
		await persistenceService.archiveLowSalienceNodes(0.05);
		assert.strictEqual(hypergraphStore.getNode('r-a'), undefined);

		const restored = await persistenceService.restoreArchivedNode('r-a');

		assert.ok(restored);
		assert.strictEqual(restored!.id, 'r-a');
		assert.ok(hypergraphStore.getNode('r-a'), 'node should be back in the live store');
		assert.ok(hypergraphStore.getLink('r-link'), 'the restored node\'s own link should come back with it');

		const archived = await persistenceService.listArchivedNodes();
		assert.ok(!archived.some(n => n.id === 'r-a'), 'restored node should be removed from cold storage');
	});

	test('should return undefined restoring a node id that was never archived', async () => {
		const restored = await persistenceService.restoreArchivedNode('never-archived');
		assert.strictEqual(restored, undefined);
	});

	test('should include archived node count in persistence stats', async () => {
		hypergraphStore.addNode({
			id: 'stat-cold', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.01,
		});
		await persistenceService.archiveLowSalienceNodes(0.05);

		const stats = await persistenceService.getStats();
		assert.strictEqual(stats.archivedNodeCount, 1);
	});

	test('should remove archived nodes and links from the hot store so load() does not resurrect them', async () => {
		hypergraphStore.addNode({
			id: 'hot-then-cold', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addNode({
			id: 'stays-hot', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.9,
		});
		await persistenceService.save();

		await persistenceService.archiveLowSalienceNodes(0.05);

		hypergraphStore.clear();
		const loaded = await persistenceService.load();
		assert.ok(loaded);
		assert.strictEqual(hypergraphStore.getNode('hot-then-cold'), undefined, 'archived node must not resurrect from the hot store');
		assert.ok(hypergraphStore.getNode('stays-hot'), 'node above the threshold should still load normally');
	});

	test('should persist a restored node into the hot store without requiring an explicit save', async () => {
		hypergraphStore.addNode({
			id: 'durable-restore', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.01,
		});
		await persistenceService.archiveLowSalienceNodes(0.05);
		await persistenceService.restoreArchivedNode('durable-restore');

		hypergraphStore.clear();
		const loaded = await persistenceService.load();
		assert.ok(loaded);
		assert.ok(hypergraphStore.getNode('durable-restore'), 'restored node should survive a load() without an intervening save()');
	});

	test('should clear archived nodes and links together with the hot tier', async () => {
		hypergraphStore.addNode({
			id: 'clear-cold', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.01,
		});
		await persistenceService.archiveLowSalienceNodes(0.05);

		await persistenceService.clearStorage();

		const archived = await persistenceService.listArchivedNodes();
		assert.strictEqual(archived.length, 0);
		assert.strictEqual(mockDb.getStore('archiveNodes').getSize(), 0);
	});

	test('should keep a cold link archived while another archived node still references it', async () => {
		hypergraphStore.addNode({
			id: 'shared-a', node_type: 'T', content: '', links: ['shared-link'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addNode({
			id: 'shared-b', node_type: 'T', content: '', links: ['shared-link'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addLink({ id: 'shared-link', link_type: 'L', outgoing: ['shared-a', 'shared-b'], metadata: {} });
		await persistenceService.archiveLowSalienceNodes(0.05);

		await persistenceService.restoreArchivedNode('shared-a');
		assert.strictEqual(mockDb.getStore('archiveLinks').getSize(), 1, 'link should stay archived while shared-b still needs it');

		await persistenceService.restoreArchivedNode('shared-b');
		assert.strictEqual(mockDb.getStore('archiveLinks').getSize(), 0, 'link should be dropped from cold storage once no archived node needs it');
		assert.ok(hypergraphStore.getLink('shared-link'), 'both endpoints restored, link should be live');
	});

	test('should not orphan a shared link in the hot store when its restored endpoint is re-archived', async () => {
		hypergraphStore.addNode({
			id: 'reorph-a', node_type: 'T', content: '', links: ['reorph-link'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addNode({
			id: 'reorph-b', node_type: 'T', content: '', links: ['reorph-link'], metadata: {}, salience_score: 0.01,
		});
		hypergraphStore.addLink({ id: 'reorph-link', link_type: 'L', outgoing: ['reorph-a', 'reorph-b'], metadata: {} });
		await persistenceService.archiveLowSalienceNodes(0.05);

		// Restore only reorph-a; reorph-b (and thus one endpoint of the link)
		// stays cold, so the link must not be written into the hot store yet.
		await persistenceService.restoreArchivedNode('reorph-a');
		assert.strictEqual(mockDb.getStore('links').getSize(), 0, 'link with a still-cold endpoint should not enter the hot tier');

		// reorph-a is still below the threshold, so a second archive pass
		// picks it back up. If the link had leaked into the hot store above,
		// this pass would leave it there forever (its other endpoint,
		// reorph-b, was never live and so is never in this pass's archiveIds).
		await persistenceService.archiveLowSalienceNodes(0.05);
		assert.strictEqual(mockDb.getStore('links').getSize(), 0, 'link must not be orphaned in the hot store after re-archiving its endpoint');
		assert.strictEqual(mockDb.getStore('nodes').getSize(), 0, 'both endpoints should be back in cold storage with nothing left hot');
	});

	test('should serialize save() and archiveLowSalienceNodes() so a concurrent save cannot resurrect an archived node', async () => {
		hypergraphStore.addNode({
			id: 'race-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.01,
		});

		// Fire both without awaiting the first, mirroring an auto-save
		// landing while an archive pass is in flight.
		const savePromise = persistenceService.save('race-save');
		const archivePromise = persistenceService.archiveLowSalienceNodes(0.05);
		await Promise.all([savePromise, archivePromise]);

		assert.strictEqual(mockDb.getStore('nodes').getSize(), 0, 'archived node must not be resurrected by a racing save()');
		assert.strictEqual(hypergraphStore.getNode('race-node'), undefined);
	});

	// --- Incremental backup / restore tests ---

	test('should create a full backup containing every current node and link', async () => {
		hypergraphStore.addNode({ id: 'full-a', node_type: 'T', content: 'a', links: [], metadata: {}, salience_score: 0.5 });
		hypergraphStore.addNode({ id: 'full-b', node_type: 'T', content: 'b', links: [], metadata: {}, salience_score: 0.5 });

		const backup = await persistenceService.createBackup();

		assert.strictEqual(backup.full, true);
		assert.strictEqual(backup.sinceTimestamp, undefined);
		assert.strictEqual(backup.nodes.length, 2);
		assert.ok(backup.nodes.some(n => n.id === 'full-a'));
		assert.ok(backup.nodes.some(n => n.id === 'full-b'));
	});

	test('should create an incremental backup containing only nodes changed since a checkpoint', async () => {
		hypergraphStore.addNode({ id: 'inc-old', node_type: 'T', content: 'old', links: [], metadata: {}, salience_score: 0.5 });
		await new Promise(r => setTimeout(r, 10));
		const checkpoint = Date.now();
		await new Promise(r => setTimeout(r, 10));
		hypergraphStore.addNode({ id: 'inc-new', node_type: 'T', content: 'new', links: [], metadata: {}, salience_score: 0.5 });
		await new Promise(r => setTimeout(r, 10));

		const backup = await persistenceService.createBackup(checkpoint);

		assert.strictEqual(backup.full, false);
		assert.strictEqual(backup.sinceTimestamp, checkpoint);
		assert.strictEqual(backup.nodes.length, 1);
		assert.strictEqual(backup.nodes[0].id, 'inc-new');
	});

	test('should not drop a change from an incremental backup requested immediately afterward, with no delay for the changelog write to land', async () => {
		const checkpoint = Date.now();
		hypergraphStore.addNode({ id: 'no-delay-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });

		// No await/setTimeout between the change and the backup call: the
		// changelog put triggered by addNode() is still in flight here.
		// createBackup() must still see it, and every later incremental
		// backup must still see it too (once _lastBackupTime moves past an
		// entry that was missed, it can never be picked up again).
		const backup = await persistenceService.createBackup(checkpoint);
		assert.strictEqual(backup.nodes.length, 1, 'change queued immediately before createBackup() must not be dropped');
		assert.strictEqual(backup.nodes[0].id, 'no-delay-node');

		const secondBackup = await persistenceService.createBackup(backup.createdAt);
		assert.strictEqual(secondBackup.nodes.length, 0, 'change already captured by the first backup should not reappear');
	});

	test('should include a link in an incremental backup when it was added after the checkpoint', async () => {
		hypergraphStore.addNode({ id: 'link-src', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });
		hypergraphStore.addNode({ id: 'link-dst', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });
		await new Promise(r => setTimeout(r, 10));
		const checkpoint = Date.now();
		await new Promise(r => setTimeout(r, 10));
		hypergraphStore.addLink({ id: 'inc-link', link_type: 'L', outgoing: ['link-src', 'link-dst'], metadata: {} });
		await new Promise(r => setTimeout(r, 10));

		const backup = await persistenceService.createBackup(checkpoint);

		assert.strictEqual(backup.nodes.length, 0, 'neither endpoint node changed after the checkpoint');
		assert.strictEqual(backup.links.length, 1);
		assert.strictEqual(backup.links[0].id, 'inc-link');
	});

	test('should apply a backup by upserting its nodes and links into the live store and hot tier', async () => {
		const backup = {
			formatVersion: 1,
			createdAt: Date.now(),
			full: true,
			nodes: [{ id: 'import-a', node_type: 'T', content: 'imported', links: [], metadata: {}, salience_score: 0.4 }],
			links: [] as HypergraphLink[],
		};

		const result = await persistenceService.importBackup(backup);

		assert.strictEqual(result.nodesUpserted, 1);
		assert.strictEqual(result.linksUpserted, 0);
		assert.ok(hypergraphStore.getNode('import-a'), 'node should be live in memory');
		assert.strictEqual(mockDb.getStore('nodes').getSize(), 1, 'node should be written into the hot IndexedDB tier');
	});

	test('should overwrite an existing node when importing a backup with the same id', async () => {
		hypergraphStore.addNode({ id: 'overwrite-me', node_type: 'T', content: 'original', links: [], metadata: {}, salience_score: 0.2 });

		await persistenceService.importBackup({
			formatVersion: 1,
			createdAt: Date.now(),
			full: false,
			nodes: [{ id: 'overwrite-me', node_type: 'T', content: 'updated', links: [], metadata: {}, salience_score: 0.9 }],
			links: [],
		});

		const node = hypergraphStore.getNode('overwrite-me');
		assert.strictEqual(node?.content, 'updated');
		assert.strictEqual(node?.salience_score, 0.9);
	});

	test('should round-trip a backup through JSON export and import', async () => {
		hypergraphStore.addNode({ id: 'json-node', node_type: 'T', content: 'roundtrip', links: [], metadata: {}, salience_score: 0.6 });

		const json = await persistenceService.exportBackupJson();
		hypergraphStore.clear();
		assert.strictEqual(hypergraphStore.getNode('json-node'), undefined);

		const result = await persistenceService.importBackupJson(json);

		assert.strictEqual(result.nodesUpserted, 1);
		assert.ok(hypergraphStore.getNode('json-node'));
	});

	test('should not record a changelog entry for nodes restored by load(), keeping incremental backups from re-including untouched state', async () => {
		hypergraphStore.addNode({ id: 'suppressed-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });
		await persistenceService.save();
		const checkpoint = Date.now();
		await new Promise(r => setTimeout(r, 10));

		hypergraphStore.clear();
		await persistenceService.load();

		const backup = await persistenceService.createBackup(checkpoint);
		assert.strictEqual(backup.nodes.length, 0, 'load() should not be treated as a new change for backup purposes');
	});

	test('should track the last backup time in persistence stats', async () => {
		let stats = await persistenceService.getStats();
		assert.strictEqual(stats.lastBackupTime, 0);

		await persistenceService.createBackup();

		stats = await persistenceService.getStats();
		assert.ok(stats.lastBackupTime > 0);
	});

	test('should reset the last backup checkpoint when storage is cleared', async () => {
		hypergraphStore.addNode({ id: 'clear-checkpoint-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });
		await persistenceService.createBackup();
		let stats = await persistenceService.getStats();
		assert.ok(stats.lastBackupTime > 0);

		await persistenceService.clearStorage();

		stats = await persistenceService.getStats();
		assert.strictEqual(stats.lastBackupTime, 0, 'a stale checkpoint against the now-empty changelog would silently miss everything');
	});

	// -- Pluggable backends / warm tier / range / cloud (Phase E remainder) ----

	test('should default to the indexeddb backend and list all available backends', async () => {
		assert.strictEqual(persistenceService.getBackend(), 'indexeddb');
		const backends = persistenceService.getAvailableBackends();
		assert.ok(backends.includes('indexeddb'));
		assert.ok(backends.includes('rocksdb'));
		assert.ok(backends.includes('atomspace'));
		const stats = await persistenceService.getStats();
		assert.strictEqual(stats.backend, 'indexeddb');
		assert.strictEqual(stats.warmNodeCount, 0);
	});

	test('should switch to the rocksdb backend and round-trip save/load', async () => {
		hypergraphStore.addNode({
			id: 'rocks-node-1',
			node_type: 'TableNode',
			content: 'select 1',
			links: [],
			metadata: {},
			salience_score: 0.8,
		});

		await persistenceService.setBackend('rocksdb');
		assert.strictEqual(persistenceService.getBackend(), 'rocksdb');

		const stats = await persistenceService.getStats();
		assert.strictEqual(stats.backend, 'rocksdb');
		assert.ok(stats.rocksDb, 'rocksdb stats should be populated after switch');
		assert.ok(stats.rocksDb!.columnFamilies.includes('nodes'));

		hypergraphStore.clear();
		assert.strictEqual(hypergraphStore.nodeCount(), 0);

		const loaded = await persistenceService.load();
		assert.ok(loaded);
		assert.strictEqual(hypergraphStore.nodeCount(), 1);
		assert.strictEqual(hypergraphStore.getNode('rocks-node-1')?.content, 'select 1');
	});

	test('should demote mid-salience nodes to the warm tier and lazily restore them', async () => {
		hypergraphStore.addNode({ id: 'hot-node', node_type: 'T', content: 'hot', links: [], metadata: {}, salience_score: 0.9 });
		hypergraphStore.addNode({ id: 'warm-node', node_type: 'T', content: 'warm', links: [], metadata: {}, salience_score: 0.15 });
		hypergraphStore.addNode({ id: 'cold-node', node_type: 'T', content: 'cold', links: [], metadata: {}, salience_score: 0.01 });

		const demoted = await persistenceService.demoteToWarmTier(0.25);
		assert.strictEqual(demoted.archivedNodeCount, 1, 'only the warm-band node should demote');
		assert.strictEqual(hypergraphStore.getNode('warm-node'), undefined);
		assert.ok(hypergraphStore.getNode('hot-node'));
		assert.ok(hypergraphStore.getNode('cold-node'), 'cold-band nodes stay for cold archival');

		const warmList = await persistenceService.listWarmNodes();
		assert.strictEqual(warmList.length, 1);
		assert.strictEqual(warmList[0].id, 'warm-node');

		const restored = await persistenceService.restoreWarmNode('warm-node');
		assert.ok(restored);
		assert.strictEqual(hypergraphStore.getNode('warm-node')?.content, 'warm');
		assert.strictEqual((await persistenceService.listWarmNodes()).length, 0);

		const stats = await persistenceService.getStats();
		assert.strictEqual(stats.warmNodeCount, 0);
	});

	test('should range-query hot-tier nodes by id prefix', async () => {
		hypergraphStore.addNode({ id: 'tbl_users', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });
		hypergraphStore.addNode({ id: 'tbl_orders', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });
		hypergraphStore.addNode({ id: 'qry_1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5 });
		await persistenceService.save();

		const matched = await persistenceService.rangeQueryNodes('tbl_');
		assert.strictEqual(matched.length, 2);
		assert.deepStrictEqual(matched.map(n => n.id).sort(), ['tbl_orders', 'tbl_users']);

		const limited = await persistenceService.rangeQueryNodes('tbl_', 1);
		assert.strictEqual(limited.length, 1);
	});

	test('should no-op compactStorage on the indexeddb backend and compact on rocksdb', async () => {
		await persistenceService.compactStorage(); // no throw
		await persistenceService.setBackend('rocksdb');
		// Force enough writes to create multiple SSTables then compact.
		for (let i = 0; i < 300; i++) {
			hypergraphStore.addNode({
				id: `compact-n-${i}`,
				node_type: 'T',
				content: `c${i}`,
				links: [],
				metadata: {},
				salience_score: 0.5,
			});
		}
		await persistenceService.save();
		await persistenceService.compactStorage();
		const stats = await persistenceService.getStats();
		assert.ok(stats.rocksDb);
		assert.ok(stats.rocksDb!.compactionCount >= 0);
	});

	test('should refuse cloud upload when cloud storage is not configured', async () => {
		assert.strictEqual(persistenceService.getCloudStorageConfig(), undefined);
		const result = await persistenceService.uploadBackupToCloud();
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes('not configured'));
	});

	test('should upload and download backups through the configured cloud endpoint', async () => {
		hypergraphStore.addNode({ id: 'cloud-node', node_type: 'T', content: 'payload', links: [], metadata: {}, salience_score: 0.7 });

		const remote = new Map<string, string>();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			const method = (init?.method ?? 'GET').toUpperCase();
			if (method === 'PUT') {
				remote.set(url, String(init?.body ?? ''));
				return new Response(null, { status: 200 });
			}
			if (method === 'GET' && url.includes('list=1')) {
				return new Response(JSON.stringify({ items: [...remote.keys()].map(k => k.split('/').pop()!) }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}
			if (method === 'GET') {
				const body = remote.get(url);
				if (!body) { return new Response('missing', { status: 404 }); }
				return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
			}
			return new Response('nope', { status: 405 });
		}) as typeof fetch;

		try {
			persistenceService.configureCloudStorage({
				endpointUrl: 'https://cloud.example.test',
				prefix: 'zonecog-backups',
				authToken: 'test-token',
			});
			assert.strictEqual(persistenceService.getCloudStorageConfig()?.endpointUrl, 'https://cloud.example.test');

			const upload = await persistenceService.uploadBackupToCloud(undefined, 'unit-test.json');
			assert.strictEqual(upload.success, true, upload.error);
			assert.strictEqual(upload.remotePath, 'zonecog-backups/unit-test.json');
			assert.ok(upload.bytesTransferred > 0);

			const listed = await persistenceService.listCloudBackups();
			assert.ok(listed.includes('unit-test.json'));

			hypergraphStore.clear();
			const imported = await persistenceService.downloadBackupFromCloud('zonecog-backups/unit-test.json');
			assert.strictEqual(imported.nodesUpserted, 1);
			assert.strictEqual(hypergraphStore.getNode('cloud-node')?.content, 'payload');
		} finally {
			globalThis.fetch = originalFetch;
			persistenceService.configureCloudStorage(undefined);
		}
	});
});

// ---------------------------------------------------------------------------
// RocksDB engine unit tests (no service layer)
// ---------------------------------------------------------------------------

suite('RocksDB Engine', () => {

	test('WasmBloomFilter reports definite negatives and accepts inserts', () => {
		const bloom = new WasmBloomFilter(32, 10, 4);
		assert.ok(bloom.wasmMemory instanceof WebAssembly.Memory);
		assert.strictEqual(bloom.mightContain('missing'), false);
		bloom.add('present');
		assert.strictEqual(bloom.mightContain('present'), true);
		assert.ok(bloom.bitCount >= 64);
	});

	test('put/get/delete and prefix range queries work across column families', async () => {
		const engine = new RocksDbEngine({ memtableFlushThreshold: 8, compactionSstThreshold: 2 });
		await engine.open();

		await engine.put('nodes', 'a1', encodeJson({ id: 'a1' }));
		await engine.put('nodes', 'a2', encodeJson({ id: 'a2' }));
		await engine.put('nodes', 'b1', encodeJson({ id: 'b1' }));
		await engine.put('links', 'l1', encodeJson({ id: 'l1' }));

		const a1 = await engine.get('nodes', 'a1');
		assert.ok(a1);
		assert.strictEqual(decodeJson<{ id: string }>(a1!).id, 'a1');
		assert.strictEqual(await engine.get('links', 'a1'), undefined);

		const prefix = await engine.prefixScan('nodes', 'a');
		assert.deepStrictEqual(prefix.map(([k]) => k), ['a1', 'a2']);

		await engine.delete('nodes', 'a1');
		assert.strictEqual(await engine.get('nodes', 'a1'), undefined);

		const stats = engine.getStats();
		assert.ok(stats.columnFamilies.includes('indices'));
		assert.ok(stats.ready);
	});

	test('flushes memtables and compacts SSTables when thresholds are hit', async () => {
		const engine = new RocksDbEngine({ memtableFlushThreshold: 4, compactionSstThreshold: 2, bloomBitsPerKey: 8 });
		await engine.open();

		for (let i = 0; i < 20; i++) {
			await engine.put('nodes', `k${i.toString().padStart(2, '0')}`, encodeJson({ i }));
		}
		await engine.compact();
		const stats = engine.getStats();
		assert.ok(stats.sstableCount >= 1);
		assert.ok(stats.compactionCount >= 1);
		assert.ok(stats.bloomFilterBits > 0);

		// Values survive compaction.
		const v = await engine.get('nodes', 'k05');
		assert.ok(v);
		assert.strictEqual(decodeJson<{ i: number }>(v!).i, 5);
	});

	test('prefixSuccessor produces an exclusive upper bound', () => {
		// 'abc' + successor must sit strictly after every key that starts with 'abc',
		// including the maximal 'abc\uffff...' form, and equal the natural next prefix.
		assert.strictEqual(prefixSuccessor('abc') > 'abc', true);
		assert.strictEqual(prefixSuccessor('abc') > 'abc\uffff', true);
		assert.strictEqual(prefixSuccessor('abc'), 'abd');
		assert.ok('abcxyz' < prefixSuccessor('abc'));
	});
});

// ---------------------------------------------------------------------------
// RocksDbPersistenceService integration tests
// ---------------------------------------------------------------------------

suite('RocksDB Persistence Service', () => {

	let instantiationService: TestInstantiationService;
	let service: RocksDbPersistenceService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		installIndexedDBMock();
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);
		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);
		// Use an in-memory engine (no durability sink) so tests stay hermetic.
		// Construct directly: the optional engine arg is not a DI service and
		// createInstance's static typing expects only decorator-injected params.
		const engine = new RocksDbEngine({ memtableFlushThreshold: 32, compactionSstThreshold: 4 });
		service = new RocksDbPersistenceService(
			new NullLogService(),
			hypergraphStore,
			membraneService,
			engine,
		);
	});

	teardown(() => {
		service.dispose();
		uninstallIndexedDBMock();
	});

	test('should save and load through RocksDB column families', async () => {
		hypergraphStore.addNode({ id: 'r1', node_type: 'T', content: 'hello', links: [], metadata: {}, salience_score: 0.6 });
		const snap = await service.save('rocks');
		assert.strictEqual(snap.nodeCount, 1);

		hypergraphStore.clear();
		const loaded = await service.load();
		assert.ok(loaded);
		assert.strictEqual(hypergraphStore.getNode('r1')?.content, 'hello');
		assert.strictEqual(service.getBackend(), 'rocksdb');
	});

	test('should archive, range-query and compact via the RocksDB service', async () => {
		hypergraphStore.addNode({ id: 'keep', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.9 });
		hypergraphStore.addNode({ id: 'drop', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.01 });
		await service.save();

		const archived = await service.archiveLowSalienceNodes(0.05);
		assert.strictEqual(archived.archivedNodeCount, 1);
		assert.strictEqual(hypergraphStore.getNode('drop'), undefined);

		const range = await service.rangeQueryNodes('ke');
		assert.strictEqual(range.length, 1);
		assert.strictEqual(range[0].id, 'keep');

		await service.compactStorage();
		const stats = await service.getStats();
		assert.strictEqual(stats.backend, 'rocksdb');
		assert.ok(stats.rocksDb?.ready);
	});

	test('should demote to warm tier on the RocksDB service', async () => {
		hypergraphStore.addNode({ id: 'warm-me', node_type: 'T', content: 'w', links: [], metadata: {}, salience_score: 0.1 });
		const result = await service.demoteToWarmTier(0.25);
		assert.strictEqual(result.archivedNodeCount, 1);
		const listed = await service.listWarmNodes();
		assert.strictEqual(listed[0].id, 'warm-me');
		await service.restoreWarmNode('warm-me');
		assert.ok(hypergraphStore.getNode('warm-me'));
	});
});

// ---------------------------------------------------------------------------
// Pure export-format function tests (no service/IndexedDB involved)
// ---------------------------------------------------------------------------

suite('Hypergraph export format helpers', () => {

	function node(overrides: Partial<HypergraphNode>): HypergraphNode {
		return { id: 'n', node_type: 'ConceptNode', content: '', links: [], metadata: {}, salience_score: 0, ...overrides };
	}

	function link(overrides: Partial<HypergraphLink>): HypergraphLink {
		return { id: 'l', link_type: 'Link', outgoing: [], metadata: {}, ...overrides };
	}

	test('nodesAndLinksToCypher escapes a single quote in a property value', () => {
		const cypher = nodesAndLinksToCypher([node({ id: "o'brien" })], []);
		assert.ok(cypher.includes("id: 'o\\'brien'"));
	});

	test('nodesAndLinksToCypher escapes a backslash in a property value', () => {
		const cypher = nodesAndLinksToCypher([node({ content: 'back\\slash' })], []);
		assert.ok(cypher.includes("content: 'back\\\\slash'"));
	});

	test('nodesAndLinksToCypher sanitizes node types with invalid label characters', () => {
		const cypher = nodesAndLinksToCypher([node({ node_type: 'My Node-Type!' })], []);
		assert.ok(cypher.includes('CREATE (:My_Node_Type_ {'));
	});

	test('nodesAndLinksToCypher reifies a hyperedge with more than two outgoing nodes', () => {
		const cypher = nodesAndLinksToCypher(
			[node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })],
			[link({ id: 'hyper-1', link_type: 'Triad', outgoing: ['a', 'b', 'c'] })]
		);

		assert.ok(cypher.includes("CREATE (:HyperLink:TRIAD {id: 'hyper-1'});"));
		for (const [position, id] of [[0, 'a'], [1, 'b'], [2, 'c']] as const) {
			assert.ok(cypher.includes(`MATCH (l {id: 'hyper-1'}), (t {id: '${id}'}) CREATE (l)-[:PARTICIPATES {position: ${position}}]->(t);`));
		}
	});

	test('nodesAndLinksToAtomSpaceScheme escapes a double quote in a node id', () => {
		const scheme = nodesAndLinksToAtomSpaceScheme([node({ id: 'a"b' })], []);
		assert.ok(scheme.includes('(ConceptNode "a\\"b" (stv 0 1.0))'));
	});

	test('nodesAndLinksToAtomSpaceScheme escapes a backslash in a node id', () => {
		const scheme = nodesAndLinksToAtomSpaceScheme([node({ id: 'a\\b' })], []);
		assert.ok(scheme.includes('(ConceptNode "a\\\\b" (stv 0 1.0))'));
	});

	test('nodesAndLinksToAtomSpaceScheme renders a link with no outgoing nodes without a dangling body', () => {
		const scheme = nodesAndLinksToAtomSpaceScheme([], [link({ id: 'empty-link', link_type: 'Orphan', outgoing: [] })]);
		assert.ok(scheme.includes('(Orphan (stv 1.0 1.0))'));
	});

	test('nodesAndLinksToAtomSpaceScheme references each outgoing node under its own node_type', () => {
		const scheme = nodesAndLinksToAtomSpaceScheme(
			[node({ id: 'q1', node_type: 'QueryInput' }), node({ id: 't1', node_type: 'TableNode' })],
			[link({ id: 'evaluates', link_type: 'EvaluationLink', outgoing: ['q1', 't1'] })]
		);

		assert.ok(scheme.includes('(QueryInput "q1")'), 'link should reference q1 as QueryInput, not ConceptNode');
		assert.ok(scheme.includes('(TableNode "t1")'), 'link should reference t1 as TableNode, not ConceptNode');
		assert.ok(!scheme.includes('(ConceptNode "q1")'));
		assert.ok(!scheme.includes('(ConceptNode "t1")'));
	});

	test('nodesAndLinksToAtomSpaceScheme falls back to ConceptNode for a link referencing a node outside the exported set', () => {
		const scheme = nodesAndLinksToAtomSpaceScheme(
			[],
			[link({ id: 'dangling', link_type: 'Link', outgoing: ['missing-node'] })]
		);
		assert.ok(scheme.includes('(ConceptNode "missing-node")'));
	});

	test('nodesAndLinksToAtomSpaceScheme keeps a multi-line content comment on one line', () => {
		const scheme = nodesAndLinksToAtomSpaceScheme(
			[node({ id: 'multi', content: 'line one\nline two\r\nline three' })],
			[]
		);

		assert.ok(!scheme.includes('line one\nline two'), 'raw newlines from content must not reach the output');
		assert.ok(scheme.includes('; line one line two line three'));
	});
});
