/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IHypergraphPersistenceService } from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { HypergraphPersistenceService } from 'sql/workbench/services/zonecog/browser/hypergraphPersistenceService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Minimal IndexedDB stub for the test environment
// ---------------------------------------------------------------------------

interface IDBRecord { [key: string]: unknown }

class MockIDBObjectStore {
	private _data = new Map<string, IDBRecord>();
	keyPath: string;

	constructor(keyPath: string) { this.keyPath = keyPath; }

	put(record: IDBRecord): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null } {
		const key = record[this.keyPath] as string;
		this._data.set(String(key), { ...record });
		const req = { onsuccess: null as (() => void) | null, onerror: null as ((e: unknown) => void) | null };
		Promise.resolve().then(() => req.onsuccess?.());
		return req;
	}

	clear(): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null } {
		this._data.clear();
		const req = { onsuccess: null as (() => void) | null, onerror: null as ((e: unknown) => void) | null };
		Promise.resolve().then(() => req.onsuccess?.());
		return req;
	}

	getAll(): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null; result: IDBRecord[] } {
		const result = Array.from(this._data.values());
		const req = {
			onsuccess: null as (() => void) | null,
			onerror: null as ((e: unknown) => void) | null,
			result,
		};
		Promise.resolve().then(() => req.onsuccess?.());
		return req;
	}

	count(): { onsuccess: (() => void) | null; onerror: ((e: unknown) => void) | null; result: number } {
		const result = this._data.size;
		const req = {
			onsuccess: null as (() => void) | null,
			onerror: null as ((e: unknown) => void) | null,
			result,
		};
		Promise.resolve().then(() => req.onsuccess?.());
		return req;
	}

	getSize(): number { return this._data.size; }
}

class MockIDBTransaction {
	private _stores: Map<string, MockIDBObjectStore>;
	oncomplete: (() => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	error: null = null;

	constructor(stores: Map<string, MockIDBObjectStore>) {
		this._stores = stores;
		Promise.resolve().then(() => this.oncomplete?.());
	}

	objectStore(name: string): MockIDBObjectStore {
		return this._stores.get(name)!;
	}
}

class MockIDBDatabase {
	private _stores = new Map<string, MockIDBObjectStore>([
		['nodes', new MockIDBObjectStore('id')],
		['links', new MockIDBObjectStore('id')],
		['snapshots', new MockIDBObjectStore('id')],
	]);

	objectStoreNames = { contains: (_name: string) => true };

	transaction(storeNames: string | string[], _mode: string): MockIDBTransaction {
		const names = Array.isArray(storeNames) ? storeNames : [storeNames];
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
function installIndexedDBMock(): MockIDBDatabase {
	const db = new MockIDBDatabase();
	const openReq = {
		onsuccess: null as ((ev: { target: { result: MockIDBDatabase } }) => void) | null,
		onerror: null as ((e: unknown) => void) | null,
		onupgradeneeded: null as ((ev: { target: { result: MockIDBDatabase } }) => void) | null,
		result: db,
	};
	(global as unknown as Record<string, unknown>)['indexedDB'] = {
		open: (_name: string, _version: number) => {
			Promise.resolve().then(() => openReq.onsuccess?.({ target: { result: db } }));
			return openReq;
		},
	};
	return db;
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
});
