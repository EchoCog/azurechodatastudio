/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IHypergraphPersistenceService,
	HypergraphSnapshot,
	PersistenceStats,
} from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { IHypergraphStore, HypergraphNode, HypergraphLink, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'zonecog-hypergraph';
const DB_VERSION = 1;

const STORE_NODES = 'nodes';
const STORE_LINKS = 'links';
const STORE_SNAPSHOTS = 'snapshots';

const MIN_AUTO_SAVE_INTERVAL_MS = 10_000;

/**
 * Rough per-record size estimates used for `estimatedBytes` in storage stats.
 * These are conservative averages; actual size depends on content length.
 */
const AVG_NODE_SIZE_BYTES = 512;
const AVG_LINK_SIZE_BYTES = 128;

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDatabase(): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is not available in this environment'));
			return;
		}
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NODES)) {
				db.createObjectStore(STORE_NODES, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORE_LINKS)) {
				db.createObjectStore(STORE_LINKS, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
				db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
	});
}

function idbPut<T>(store: IDBObjectStore, record: T): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const req = store.put(record);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

function idbClear(store: IDBObjectStore): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const req = store.clear();
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
	return new Promise<T[]>((resolve, reject) => {
		const tx = db.transaction(storeName, 'readonly');
		const store = tx.objectStore(storeName);
		const req = store.getAll();
		req.onsuccess = () => resolve(req.result as T[]);
		req.onerror = () => reject(req.error);
	});
}

function idbCount(db: IDBDatabase, storeName: string): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const tx = db.transaction(storeName, 'readonly');
		const store = tx.objectStore(storeName);
		const req = store.count();
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

// ---------------------------------------------------------------------------
// Hypergraph Persistence Service implementation
// ---------------------------------------------------------------------------

/**
 * Hypergraph Persistence Service — stores the Zone-Cog knowledge graph in
 * the browser's built-in IndexedDB for durable cross-session persistence.
 *
 * IndexedDB schema:
 *   DB: "zonecog-hypergraph" (version 1)
 *   - nodes     → HypergraphNode records keyed by id
 *   - links     → HypergraphLink records keyed by id
 *   - snapshots → HypergraphSnapshot metadata keyed by id
 */
export class HypergraphPersistenceService extends Disposable implements IHypergraphPersistenceService {

	declare readonly _serviceBrand: undefined;

	/** Resolved when the DB is first opened. */
	private _db: IDBDatabase | null = null;
	private _dbOpenPromise: Promise<IDBDatabase> | null = null;
	private _dbAvailable = false;

	private _lastSaveTime = 0;
	private _lastLoadTime = 0;
	private _autoSaveIntervalHandle: ReturnType<typeof setInterval> | null = null;
	private _autoSaveEnabled = false;

	private readonly _onDidSave = this._register(new Emitter<HypergraphSnapshot>());
	readonly onDidSave: Event<HypergraphSnapshot> = this._onDidSave.event;

	private readonly _onDidLoad = this._register(new Emitter<HypergraphSnapshot>());
	readonly onDidLoad: Event<HypergraphSnapshot> = this._onDidLoad.event;

	private readonly _onDidError = this._register(new Emitter<{ operation: string; message: string }>());
	readonly onDidError: Event<{ operation: string; message: string }> = this._onDidError.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
	) {
		super();
		// Eagerly open the DB in the background; callers await _getDb().
		this._dbOpenPromise = openDatabase()
			.then(db => {
				this._db = db;
				this._dbAvailable = true;
				this.logService.info('HypergraphPersistenceService: IndexedDB opened successfully');
				return db;
			})
			.catch(err => {
				this._dbAvailable = false;
				this.logService.warn(`HypergraphPersistenceService: IndexedDB not available — ${err}`);
				throw err;
			});
		this.membraneService.recordActivity('autonomic');
	}

	// -------------------------------------------------------------------------
	// Core operations
	// -------------------------------------------------------------------------

	async save(label = 'manual'): Promise<HypergraphSnapshot> {
		const db = await this._getDb();
		const nodes = this.hypergraphStore.getAllNodes();
		const links: HypergraphLink[] = [];

		// Collect links referenced by any node in the graph
		const linkIds = new Set<string>();
		for (const node of nodes) {
			for (const lid of node.links) {
				if (!linkIds.has(lid)) {
					linkIds.add(lid);
					const l = this.hypergraphStore.getLink(lid);
					if (l) { links.push(l); }
				}
			}
		}

		const snapshot: HypergraphSnapshot = {
			id: Date.now(),
			timestamp: Date.now(),
			nodeCount: nodes.length,
			linkCount: links.length,
			label,
		};

		try {
			// Write nodes, links, snapshot in a single transaction
			const tx = db.transaction([STORE_NODES, STORE_LINKS, STORE_SNAPSHOTS], 'readwrite');
			const nodeStore = tx.objectStore(STORE_NODES);
			const linkStore = tx.objectStore(STORE_LINKS);
			const snapshotStore = tx.objectStore(STORE_SNAPSHOTS);

			await idbClear(nodeStore);
			await idbClear(linkStore);

			for (const node of nodes) { await idbPut(nodeStore, node); }
			for (const link of links) { await idbPut(linkStore, link); }
			await idbPut(snapshotStore, snapshot);

			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this._lastSaveTime = Date.now();
			this.logService.info(
				`HypergraphPersistenceService: saved ${nodes.length} nodes, ` +
				`${links.length} links (label="${label}")`
			);
			this._onDidSave.fire(snapshot);
			this.membraneService.recordActivity('autonomic');
			return snapshot;
		} catch (err) {
			const msg = String(err);
			this.logService.error(`HypergraphPersistenceService: save failed — ${msg}`);
			this._onDidError.fire({ operation: 'save', message: msg });
			throw err;
		}
	}

	async load(): Promise<HypergraphSnapshot | undefined> {
		const db = await this._getDb();

		const [nodes, links, snapshots] = await Promise.all([
			idbGetAll<HypergraphNode>(db, STORE_NODES),
			idbGetAll<HypergraphLink>(db, STORE_LINKS),
			idbGetAll<HypergraphSnapshot>(db, STORE_SNAPSHOTS),
		]);

		if (nodes.length === 0 && links.length === 0) {
			this.logService.info('HypergraphPersistenceService: nothing stored to load');
			return undefined;
		}

		// Restore into in-memory store
		this.hypergraphStore.clear();
		for (const node of nodes) { this.hypergraphStore.addNode(node); }
		for (const link of links) { this.hypergraphStore.addLink(link); }

		const latestSnapshot = snapshots.sort((a, b) => b.timestamp - a.timestamp)[0];
		this._lastLoadTime = Date.now();

		this.logService.info(
			`HypergraphPersistenceService: loaded ${nodes.length} nodes, ${links.length} links`
		);
		this.membraneService.recordActivity('autonomic');

		if (latestSnapshot) {
			this._onDidLoad.fire(latestSnapshot);
			return latestSnapshot;
		}

		// Synthesise a snapshot record if none exists
		const synthetic: HypergraphSnapshot = {
			id: 0,
			timestamp: this._lastLoadTime,
			nodeCount: nodes.length,
			linkCount: links.length,
			label: 'restored',
		};
		this._onDidLoad.fire(synthetic);
		return synthetic;
	}

	async clearStorage(): Promise<void> {
		const db = await this._getDb();
		const tx = db.transaction([STORE_NODES, STORE_LINKS, STORE_SNAPSHOTS], 'readwrite');
		await Promise.all([
			idbClear(tx.objectStore(STORE_NODES)),
			idbClear(tx.objectStore(STORE_LINKS)),
			idbClear(tx.objectStore(STORE_SNAPSHOTS)),
		]);
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		this.logService.info('HypergraphPersistenceService: storage cleared');
	}

	async listSnapshots(): Promise<HypergraphSnapshot[]> {
		const db = await this._getDb();
		const all = await idbGetAll<HypergraphSnapshot>(db, STORE_SNAPSHOTS);
		return all.sort((a, b) => b.timestamp - a.timestamp);
	}

	// -------------------------------------------------------------------------
	// Auto-save
	// -------------------------------------------------------------------------

	enableAutoSave(intervalMs: number): void {
		const ms = Math.max(intervalMs, MIN_AUTO_SAVE_INTERVAL_MS);
		this.disableAutoSave();
		this._autoSaveEnabled = true;
		this._autoSaveIntervalHandle = setInterval(async () => {
			try {
				await this.save('auto-save');
			} catch (err) {
				this.logService.warn(`HypergraphPersistenceService: auto-save failed — ${err}`);
			}
		}, ms);
		this.logService.info(`HypergraphPersistenceService: auto-save enabled (interval=${ms}ms)`);
	}

	disableAutoSave(): void {
		if (this._autoSaveIntervalHandle !== null) {
			clearInterval(this._autoSaveIntervalHandle);
			this._autoSaveIntervalHandle = null;
		}
		this._autoSaveEnabled = false;
	}

	isAutoSaveEnabled(): boolean { return this._autoSaveEnabled; }

	// -------------------------------------------------------------------------
	// Diagnostics
	// -------------------------------------------------------------------------

	async getStats(): Promise<PersistenceStats> {
		if (!this._dbAvailable) {
			return {
				databaseReady: false,
				storedNodeCount: 0,
				storedLinkCount: 0,
				snapshotCount: 0,
				lastSaveTime: this._lastSaveTime,
				lastLoadTime: this._lastLoadTime,
				estimatedBytes: 0,
			};
		}

		const db = await this._getDb();
		const [nodeCount, linkCount, snapshotCount] = await Promise.all([
			idbCount(db, STORE_NODES),
			idbCount(db, STORE_LINKS),
			idbCount(db, STORE_SNAPSHOTS),
		]);

		// Rough size estimate based on average record sizes
		const estimatedBytes = nodeCount * AVG_NODE_SIZE_BYTES + linkCount * AVG_LINK_SIZE_BYTES;

		return {
			databaseReady: true,
			storedNodeCount: nodeCount,
			storedLinkCount: linkCount,
			snapshotCount,
			lastSaveTime: this._lastSaveTime,
			lastLoadTime: this._lastLoadTime,
			estimatedBytes,
		};
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	override dispose(): void {
		this.disableAutoSave();
		if (this._db) {
			this._db.close();
			this._db = null;
		}
		super.dispose();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async _getDb(): Promise<IDBDatabase> {
		if (this._db) { return this._db; }
		if (this._dbOpenPromise) { return this._dbOpenPromise; }
		this._dbOpenPromise = openDatabase().then(db => {
			this._db = db;
			this._dbAvailable = true;
			return db;
		});
		return this._dbOpenPromise;
	}
}
