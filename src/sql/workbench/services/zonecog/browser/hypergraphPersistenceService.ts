/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IHypergraphPersistenceService,
	HypergraphSnapshot,
	PersistenceStats,
	ArchiveStats,
	HypergraphBackup,
	BackupImportResult,
	HYPERGRAPH_BACKUP_FORMAT_VERSION,
} from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { IHypergraphStore, HypergraphNode, HypergraphLink, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'zonecog-hypergraph';
const DB_VERSION = 3;

const STORE_NODES = 'nodes';
const STORE_LINKS = 'links';
const STORE_SNAPSHOTS = 'snapshots';
/** Cold tier: nodes archived out of the live hypergraph by salience. */
const STORE_ARCHIVE_NODES = 'archiveNodes';
/** Cold tier: links archived alongside fully-archived nodes. */
const STORE_ARCHIVE_LINKS = 'archiveLinks';
/** Append-only log of node/link upserts, used to compute incremental backup deltas. */
const STORE_CHANGELOG = 'changelog';

/**
 * One entry in the append-only changelog: "this node/link was upserted at
 * this time". Used to compute which records belong in an incremental backup
 * delta - see {@link HypergraphBackup}.
 */
interface ChangeLogEntry {
	id: string;
	entityType: 'node' | 'link';
	entityId: string;
	timestamp: number;
}

const MIN_AUTO_SAVE_INTERVAL_MS = 10_000;

/** Nodes with salience strictly below this are eligible for archival by default. */
const DEFAULT_ARCHIVE_SALIENCE_THRESHOLD = 0.05;

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
			if (!db.objectStoreNames.contains(STORE_ARCHIVE_NODES)) {
				db.createObjectStore(STORE_ARCHIVE_NODES, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORE_ARCHIVE_LINKS)) {
				db.createObjectStore(STORE_ARCHIVE_LINKS, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORE_CHANGELOG)) {
				db.createObjectStore(STORE_CHANGELOG, { keyPath: 'id' });
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

function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
	return new Promise<T | undefined>((resolve, reject) => {
		const tx = db.transaction(storeName, 'readonly');
		const store = tx.objectStore(storeName);
		const req = store.get(key);
		req.onsuccess = () => resolve(req.result as T | undefined);
		req.onerror = () => reject(req.error);
	});
}

function idbDelete(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const req = store.delete(key);
		req.onsuccess = () => resolve();
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
// Export format helpers (pure, no IndexedDB access - unit-testable directly)
// ---------------------------------------------------------------------------

function cypherEscape(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function cypherPropertyLiteral(value: unknown): string {
	if (typeof value === 'string') { return `'${cypherEscape(value)}'`; }
	if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
	if (value === null || value === undefined) { return 'null'; }
	return `'${cypherEscape(JSON.stringify(value))}'`;
}

/** Sanitize a raw string into a valid Cypher label/relationship-type identifier. */
function cypherIdentifier(raw: string): string {
	const cleaned = (raw || 'HypergraphNode').replace(/[^A-Za-z0-9_]/g, '_');
	return /^[A-Za-z_]/.test(cleaned) ? cleaned : `N_${cleaned}`;
}

/**
 * Render a hypergraph as a Neo4j Cypher import script.
 *
 * Nodes become `CREATE` statements labeled with their `node_type`. Because
 * Cypher relationships are strictly binary but a `HypergraphLink` can
 * connect any number of nodes via `outgoing`, every link is reified as its
 * own `:HyperLink` node with ordered `:PARTICIPATES` edges to each of its
 * outgoing nodes, rather than special-casing 2-ary links as direct
 * relationships.
 */
export function nodesAndLinksToCypher(nodes: ReadonlyArray<HypergraphNode>, links: ReadonlyArray<HypergraphLink>): string {
	const lines: string[] = [
		'// Zone-Cog hypergraph export - Neo4j Cypher',
		`// ${nodes.length} node(s), ${links.length} link(s)`,
		'',
	];

	for (const node of nodes) {
		const props = [
			`id: ${cypherPropertyLiteral(node.id)}`,
			`content: ${cypherPropertyLiteral(node.content)}`,
			`salience_score: ${cypherPropertyLiteral(node.salience_score)}`,
			...Object.entries(node.metadata ?? {}).map(([key, value]) => `${cypherIdentifier(key)}: ${cypherPropertyLiteral(value)}`),
		];
		lines.push(`CREATE (:${cypherIdentifier(node.node_type)} {${props.join(', ')}});`);
	}

	for (const link of links) {
		const relType = cypherIdentifier(link.link_type).toUpperCase();
		lines.push(`CREATE (:HyperLink:${relType} {id: ${cypherPropertyLiteral(link.id)}});`);
		link.outgoing.forEach((targetId, position) => {
			lines.push(
				`MATCH (l {id: ${cypherPropertyLiteral(link.id)}}), (t {id: ${cypherPropertyLiteral(targetId)}}) ` +
				`CREATE (l)-[:PARTICIPATES {position: ${position}}]->(t);`
			);
		});
	}

	return lines.join('\n');
}

function schemeEscape(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Collapse any line breaks out of text destined for a Scheme `;` line
 * comment. Scheme comments run to the end of the physical line, so embedded
 * newlines (common in query/SQL/response node content) would otherwise
 * spill out of the comment as live, likely-invalid Scheme on import.
 */
function schemeCommentSafe(value: string): string {
	return value.replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * Render a hypergraph as OpenCog AtomSpace Scheme.
 *
 * Mirrors the generic Node/Link atom mapping already used by
 * `IAtomSpaceTransportService`'s bridge sync (which passes `node_type`/
 * `link_type` through as-is rather than remapping to canonical OpenCog atom
 * names such as `ConceptNode`): each node becomes `(<node_type> "id" (stv
 * salience 1.0))`, each link becomes `(<link_type> (stv 1.0 1.0) ...)` over
 * typed references to its outgoing node ids - using each target's own
 * `node_type` (falling back to `ConceptNode` only for a dangling reference
 * with no corresponding exported node), since in Atomese an atom's identity
 * is its type *and* name together, so a mistyped reference would silently
 * fail to resolve to the exported node.
 */
export function nodesAndLinksToAtomSpaceScheme(nodes: ReadonlyArray<HypergraphNode>, links: ReadonlyArray<HypergraphLink>): string {
	const lines: string[] = [
		'; Zone-Cog hypergraph export - AtomSpace Scheme',
		`; ${nodes.length} node(s), ${links.length} link(s)`,
		'',
	];

	const nodeTypeById = new Map<string, string>();
	for (const node of nodes) {
		nodeTypeById.set(node.id, node.node_type || 'ConceptNode');
	}

	for (const node of nodes) {
		const atomType = node.node_type || 'ConceptNode';
		const strength = Number.isFinite(node.salience_score) ? node.salience_score : 0;
		const comment = node.content.length > 0 ? ` ; ${schemeEscape(schemeCommentSafe(node.content)).slice(0, 120)}` : '';
		lines.push(`(${atomType} "${schemeEscape(node.id)}" (stv ${strength} 1.0))${comment}`);
	}

	if (links.length > 0) {
		lines.push('');
	}

	for (const link of links) {
		const atomType = link.link_type || 'Link';
		const outgoing = link.outgoing
			.map(id => `(${nodeTypeById.get(id) ?? 'ConceptNode'} "${schemeEscape(id)}")`)
			.join('\n    ');
		lines.push(outgoing.length > 0
			? `(${atomType} (stv 1.0 1.0)\n    ${outgoing})`
			: `(${atomType} (stv 1.0 1.0))`);
	}

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Hypergraph Persistence Service implementation
// ---------------------------------------------------------------------------

/**
 * Hypergraph Persistence Service - stores the Zone-Cog knowledge graph in
 * the browser's built-in IndexedDB for durable cross-session persistence.
 *
 * IndexedDB schema:
 *   DB: "zonecog-hypergraph" (version 3)
 *   - nodes        -> HypergraphNode records keyed by id (hot tier)
 *   - links        -> HypergraphLink records keyed by id (hot tier)
 *   - snapshots    -> HypergraphSnapshot metadata keyed by id
 *   - archiveNodes -> HypergraphNode records keyed by id (cold tier)
 *   - archiveLinks -> HypergraphLink records keyed by id (cold tier)
 *   - changelog    -> ChangeLogEntry records keyed by id, tracking node/link
 *                     upserts for incremental backup deltas
 */
export class HypergraphPersistenceService extends Disposable implements IHypergraphPersistenceService {

	declare readonly _serviceBrand: undefined;

	/** Resolved when the DB is first opened. */
	private _db: IDBDatabase | null = null;
	private _dbOpenPromise: Promise<IDBDatabase> | null = null;
	private _dbAvailable = false;

	private _lastSaveTime = 0;
	private _lastLoadTime = 0;
	private _lastBackupTime = 0;
	private _autoSaveIntervalHandle: ReturnType<typeof setInterval> | null = null;
	private _autoSaveEnabled = false;

	/**
	 * While true, `onDidChangeNode`/`onDidChangeLink` firings are not
	 * recorded to the changelog. Set around bulk restorations (`load()`,
	 * `restoreArchivedNode()`) so replaying already-known state back into
	 * `IHypergraphStore` isn't mistaken for a fresh change worth including in
	 * the next incremental backup delta.
	 */
	private _suppressChangeTracking = false;

	/** Disambiguates changelog entry ids created within the same millisecond. */
	private _changeLogCounter = 0;

	/**
	 * FIFO chain of in-flight changelog writes. `_recordChange` appends to
	 * this synchronously (before any `await`), so any write queued by a
	 * change event that fired before a given `createBackup()` call is always
	 * part of the chain that call awaits - closing the race where an
	 * in-flight, not-yet-persisted changelog put would otherwise be silently
	 * missed by that backup and, since `_lastBackupTime` advances past it
	 * regardless, by every later incremental delta too.
	 */
	private _changeLogWriteQueue: Promise<unknown> = Promise.resolve();

	/**
	 * FIFO chain serializing every operation that reads or mutates the
	 * hot/cold IndexedDB tiers against the in-memory hypergraph (save, load,
	 * clearStorage, archiveLowSalienceNodes, restoreArchivedNode). Without
	 * this, e.g. an auto-save could snapshot the in-memory graph before a
	 * concurrent archive finishes and then write that stale snapshot back
	 * over the hot tier, resurrecting nodes the archive just removed.
	 */
	private _writeQueue: Promise<unknown> = Promise.resolve();

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
				this.logService.warn(`HypergraphPersistenceService: IndexedDB not available - ${err}`);
				throw err;
			});
		this.membraneService.recordActivity('autonomic');

		this._register(this.hypergraphStore.onDidChangeNode(node => this._recordChange('node', node.id)));
		this._register(this.hypergraphStore.onDidChangeLink(link => this._recordChange('link', link.id)));
	}

	// -------------------------------------------------------------------------
	// Core operations
	// -------------------------------------------------------------------------

	async save(label = 'manual'): Promise<HypergraphSnapshot> {
		return this._serialize(async () => {
			const db = await this._getDb();
			const { nodes, links } = this._collectGraph();

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
				this.logService.error(`HypergraphPersistenceService: save failed - ${msg}`);
				this._onDidError.fire({ operation: 'save', message: msg });
				throw err;
			}
		});
	}

	async load(): Promise<HypergraphSnapshot | undefined> {
		return this._serialize(async () => {
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
			this._withChangeTrackingSuppressed(() => {
				this.hypergraphStore.clear();
				for (const node of nodes) { this.hypergraphStore.addNode(node); }
				for (const link of links) { this.hypergraphStore.addLink(link); }
			});

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
		});
	}

	async clearStorage(): Promise<void> {
		return this._serialize(async () => {
			const db = await this._getDb();
			const tx = db.transaction([STORE_NODES, STORE_LINKS, STORE_SNAPSHOTS, STORE_ARCHIVE_NODES, STORE_ARCHIVE_LINKS, STORE_CHANGELOG], 'readwrite');
			await Promise.all([
				idbClear(tx.objectStore(STORE_NODES)),
				idbClear(tx.objectStore(STORE_LINKS)),
				idbClear(tx.objectStore(STORE_SNAPSHOTS)),
				idbClear(tx.objectStore(STORE_ARCHIVE_NODES)),
				idbClear(tx.objectStore(STORE_ARCHIVE_LINKS)),
				idbClear(tx.objectStore(STORE_CHANGELOG)),
			]);
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			// The changelog backing incremental deltas was just wiped, so any
			// previously reported checkpoint no longer has history behind it -
			// a caller requesting "since last backup" against the stale value
			// would read an empty changelog and silently miss everything.
			this._lastBackupTime = 0;
			this.logService.info('HypergraphPersistenceService: storage cleared');
		});
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
				this.logService.warn(`HypergraphPersistenceService: auto-save failed - ${err}`);
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
				archivedNodeCount: 0,
				lastBackupTime: this._lastBackupTime,
			};
		}

		const db = await this._getDb();
		const [nodeCount, linkCount, snapshotCount, archivedNodeCount] = await Promise.all([
			idbCount(db, STORE_NODES),
			idbCount(db, STORE_LINKS),
			idbCount(db, STORE_SNAPSHOTS),
			idbCount(db, STORE_ARCHIVE_NODES),
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
			archivedNodeCount,
			lastBackupTime: this._lastBackupTime,
		};
	}

	// -------------------------------------------------------------------------
	// Export
	// -------------------------------------------------------------------------

	exportToCypher(): string {
		const { nodes, links } = this._collectGraph();
		this.membraneService.recordActivity('autonomic');
		return nodesAndLinksToCypher(nodes, links);
	}

	exportToAtomSpaceScheme(): string {
		const { nodes, links } = this._collectGraph();
		this.membraneService.recordActivity('autonomic');
		return nodesAndLinksToAtomSpaceScheme(nodes, links);
	}

	// -------------------------------------------------------------------------
	// Tiered storage (hybrid hot/cold hypergraph)
	// -------------------------------------------------------------------------

	async archiveLowSalienceNodes(threshold = DEFAULT_ARCHIVE_SALIENCE_THRESHOLD): Promise<ArchiveStats> {
		return this._serialize(async () => {
			const db = await this._getDb();
			const toArchive = this.hypergraphStore.getAllNodes().filter(n => n.salience_score < threshold);
			if (toArchive.length === 0) {
				return { archivedNodeCount: 0, archivedLinkCount: 0 };
			}

			const archiveIds = new Set(toArchive.map(n => n.id));

			// Only archive a link when every one of its outgoing nodes is also
			// being archived in this pass, so links with a remaining hot endpoint
			// stay live rather than dangling.
			const candidateLinkIds = new Set<string>();
			for (const node of toArchive) {
				for (const lid of node.links) { candidateLinkIds.add(lid); }
			}
			const linksToArchive: HypergraphLink[] = [];
			for (const lid of candidateLinkIds) {
				const link = this.hypergraphStore.getLink(lid);
				if (link && link.outgoing.every(id => archiveIds.has(id))) {
					linksToArchive.push(link);
				}
			}

			// Move the records: write into the cold tier and delete from the hot
			// tier in the same transaction, so a later load() (which rebuilds
			// memory from the hot IndexedDB stores) can't resurrect them.
			const tx = db.transaction([STORE_NODES, STORE_LINKS, STORE_ARCHIVE_NODES, STORE_ARCHIVE_LINKS], 'readwrite');
			const nodeStore = tx.objectStore(STORE_NODES);
			const linkStore = tx.objectStore(STORE_LINKS);
			const archiveNodeStore = tx.objectStore(STORE_ARCHIVE_NODES);
			const archiveLinkStore = tx.objectStore(STORE_ARCHIVE_LINKS);
			for (const node of toArchive) {
				await idbPut(archiveNodeStore, node);
				await idbDelete(nodeStore, node.id);
			}
			for (const link of linksToArchive) {
				await idbPut(archiveLinkStore, link);
				await idbDelete(linkStore, link.id);
			}
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			for (const link of linksToArchive) { this.hypergraphStore.removeLink(link.id); }
			for (const node of toArchive) { this.hypergraphStore.removeNode(node.id); }

			this.logService.info(
				`HypergraphPersistenceService: archived ${toArchive.length} node(s), ` +
				`${linksToArchive.length} link(s) below salience ${threshold}`
			);
			this.membraneService.recordActivity('autonomic');
			return { archivedNodeCount: toArchive.length, archivedLinkCount: linksToArchive.length };
		});
	}

	async restoreArchivedNode(nodeId: string): Promise<HypergraphNode | undefined> {
		return this._serialize(async () => {
			const db = await this._getDb();
			const node = await idbGet<HypergraphNode>(db, STORE_ARCHIVE_NODES, nodeId);
			if (!node) { return undefined; }

			const links: HypergraphLink[] = [];
			for (const linkId of node.links) {
				const link = await idbGet<HypergraphLink>(db, STORE_ARCHIVE_LINKS, linkId);
				if (link) { links.push(link); }
			}

			// A link is only safe to drop from cold storage once no *other*
			// still-archived node references it - otherwise that other node
			// would lose its only durable copy of a link it hasn't been
			// restored alongside.
			const otherArchivedNodes = (await idbGetAll<HypergraphNode>(db, STORE_ARCHIVE_NODES)).filter(n => n.id !== nodeId);
			const stillReferencedInArchive = new Set<string>();
			for (const other of otherArchivedNodes) {
				for (const lid of other.links) { stillReferencedInArchive.add(lid); }
			}
			const linksToDropFromArchive = links.filter(l => !stillReferencedInArchive.has(l.id));

			this._withChangeTrackingSuppressed(() => {
				this.hypergraphStore.addNode(node);
				for (const link of links) {
					if (!this.hypergraphStore.getLink(link.id)) {
						this.hypergraphStore.addLink(link);
					}
				}
			});

			// A link only belongs in the hot tier once every one of its
			// outgoing nodes is actually live - otherwise it would sit in hot
			// storage referencing a still-archived node. If that stale
			// endpoint (this restored node, still below the salience
			// threshold) gets archived again later, archiveLowSalienceNodes()
			// only pulls a link out of the hot tier when *all* of its
			// outgoing ids are in that pass; a link whose other endpoint was
			// never live wouldn't qualify, leaving it permanently orphaned in
			// hot storage. Links with a still-cold endpoint stay purely
			// in-memory for this session instead (an explicit save() while
			// all endpoints happen to be live will persist it normally).
			const hotLinks = links.filter(l => l.outgoing.every(id => this.hypergraphStore.getNode(id) !== undefined));

			// Write the restored records into the hot tier and remove the node
			// (plus any link no other archived node still needs) from the cold
			// tier, so the restore is durable without requiring a separate
			// save() call before the next load().
			const tx = db.transaction([STORE_NODES, STORE_LINKS, STORE_ARCHIVE_NODES, STORE_ARCHIVE_LINKS], 'readwrite');
			await idbPut(tx.objectStore(STORE_NODES), node);
			for (const link of hotLinks) { await idbPut(tx.objectStore(STORE_LINKS), link); }
			await idbDelete(tx.objectStore(STORE_ARCHIVE_NODES), nodeId);
			for (const link of linksToDropFromArchive) { await idbDelete(tx.objectStore(STORE_ARCHIVE_LINKS), link.id); }
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.logService.info(
				`HypergraphPersistenceService: restored archived node "${nodeId}" ` +
				`(${links.length} link(s), ${linksToDropFromArchive.length} removed from cold storage)`
			);
			this.membraneService.recordActivity('autonomic');
			return node;
		});
	}

	async listArchivedNodes(): Promise<HypergraphNode[]> {
		const db = await this._getDb();
		return idbGetAll<HypergraphNode>(db, STORE_ARCHIVE_NODES);
	}

	// -------------------------------------------------------------------------
	// Incremental backup / restore
	// -------------------------------------------------------------------------

	async createBackup(sinceTimestamp?: number): Promise<HypergraphBackup> {
		// Wait for every changelog write queued by a change event that fired
		// before this call to actually land, so an in-flight put can't be
		// missed by this backup and then permanently excluded from later
		// deltas once the checkpoint moves past it. See _changeLogWriteQueue.
		await this._changeLogWriteQueue;

		const full = sinceTimestamp === undefined;
		let nodes: HypergraphNode[];
		let links: HypergraphLink[];

		if (full) {
			({ nodes, links } = this._collectGraph());
		} else {
			const db = await this._getDb();
			const changelog = await idbGetAll<ChangeLogEntry>(db, STORE_CHANGELOG);
			const changedNodeIds = new Set(changelog.filter(e => e.entityType === 'node' && e.timestamp > sinceTimestamp).map(e => e.entityId));
			const changedLinkIds = new Set(changelog.filter(e => e.entityType === 'link' && e.timestamp > sinceTimestamp).map(e => e.entityId));
			nodes = [...changedNodeIds].map(id => this.hypergraphStore.getNode(id)).filter((n): n is HypergraphNode => n !== undefined);
			links = [...changedLinkIds].map(id => this.hypergraphStore.getLink(id)).filter((l): l is HypergraphLink => l !== undefined);
		}

		const backup: HypergraphBackup = {
			formatVersion: HYPERGRAPH_BACKUP_FORMAT_VERSION,
			createdAt: Date.now(),
			full,
			sinceTimestamp,
			nodes,
			links,
		};

		this._lastBackupTime = backup.createdAt;
		this.logService.info(
			`HypergraphPersistenceService: created ${full ? 'full' : 'incremental'} backup - ` +
			`${nodes.length} node(s), ${links.length} link(s)`
		);
		this.membraneService.recordActivity('autonomic');
		return backup;
	}

	async exportBackupJson(sinceTimestamp?: number): Promise<string> {
		return JSON.stringify(await this.createBackup(sinceTimestamp));
	}

	async importBackup(backup: HypergraphBackup): Promise<BackupImportResult> {
		return this._serialize(async () => {
			const db = await this._getDb();

			for (const node of backup.nodes) { this.hypergraphStore.addNode(node); }
			for (const link of backup.links) { this.hypergraphStore.addLink(link); }

			const tx = db.transaction([STORE_NODES, STORE_LINKS], 'readwrite');
			const nodeStore = tx.objectStore(STORE_NODES);
			const linkStore = tx.objectStore(STORE_LINKS);
			for (const node of backup.nodes) { await idbPut(nodeStore, node); }
			for (const link of backup.links) { await idbPut(linkStore, link); }
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.logService.info(
				`HypergraphPersistenceService: imported ${backup.full ? 'full' : 'incremental'} backup - ` +
				`${backup.nodes.length} node(s), ${backup.links.length} link(s) upserted`
			);
			this.membraneService.recordActivity('autonomic');
			return { nodesUpserted: backup.nodes.length, linksUpserted: backup.links.length };
		});
	}

	async importBackupJson(json: string): Promise<BackupImportResult> {
		const backup = JSON.parse(json) as HypergraphBackup;
		return this.importBackup(backup);
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

	/**
	 * Run `operation` only after every previously-queued operation has
	 * settled, so hot/cold-tier reads and writes never interleave.
	 */
	private _serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this._writeQueue.then(operation, operation);
		this._writeQueue = result.then(() => undefined, () => undefined);
		return result;
	}

	/**
	 * Run `fn` synchronously with changelog recording disabled, then restore
	 * the previous suppression state. Used to keep bulk restorations
	 * (`load()`, `restoreArchivedNode()`) out of the incremental backup
	 * changelog - see {@link _suppressChangeTracking}.
	 */
	private _withChangeTrackingSuppressed(fn: () => void): void {
		const previous = this._suppressChangeTracking;
		this._suppressChangeTracking = true;
		try {
			fn();
		} finally {
			this._suppressChangeTracking = previous;
		}
	}

	/**
	 * Best-effort append to the changelog store backing incremental backup
	 * deltas. Failures are logged, not thrown - a missed changelog entry only
	 * means that record falls back to being covered by the next full backup,
	 * not a hard failure of whatever operation triggered the node/link change.
	 */
	private _recordChange(entityType: 'node' | 'link', entityId: string): void {
		if (this._suppressChangeTracking) { return; }
		const entry: ChangeLogEntry = {
			id: `${entityType}:${entityId}:${Date.now()}:${this._changeLogCounter++}`,
			entityType,
			entityId,
			timestamp: Date.now(),
		};
		// Chain onto _changeLogWriteQueue (synchronously, before any await) so
		// this write is always part of what a subsequent createBackup() awaits
		// - see the field doc for why that ordering matters.
		this._changeLogWriteQueue = this._changeLogWriteQueue
			.then(() => this._getDb())
			.then(db => {
				const tx = db.transaction([STORE_CHANGELOG], 'readwrite');
				return idbPut(tx.objectStore(STORE_CHANGELOG), entry);
			})
			.catch(err => this.logService.warn(`HypergraphPersistenceService: failed to record changelog entry - ${err}`));
	}

	/**
	 * Collect the full in-memory hypergraph: every node, plus every link
	 * referenced by at least one node's `links` list (deduplicated).
	 */
	private _collectGraph(): { nodes: HypergraphNode[]; links: HypergraphLink[] } {
		const nodes = this.hypergraphStore.getAllNodes();
		const links: HypergraphLink[] = [];

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

		return { nodes, links };
	}
}
