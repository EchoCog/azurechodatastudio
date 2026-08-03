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
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
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
