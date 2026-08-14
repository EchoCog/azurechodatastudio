/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

<<<<<<< HEAD
import {
	IHypergraphPersistenceService,
	HypergraphSnapshot,
	PersistenceStats,
	ArchiveStats,
	HypergraphBackup,
	BackupImportResult,
	HYPERGRAPH_BACKUP_FORMAT_VERSION,
	HypergraphPersistenceBackendKind,
	CloudStorageConfig,
	CloudBackupResult,
	RocksDbPersistenceStats,
} from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { IHypergraphStore, HypergraphNode, HypergraphLink, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
=======
>>>>>>> origin/main
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import {
<<<<<<< HEAD
	RocksDbEngine,
	IndexedDbRocksDbDurabilitySink,
	encodeJson,
	decodeJson,
	RocksDbColumnFamily,
} from 'sql/workbench/services/zonecog/browser/rocksDbEngine';
import {
	nodesAndLinksToCypher,
	nodesAndLinksToAtomSpaceScheme,
} from 'sql/workbench/services/zonecog/browser/hypergraphPersistenceService';
import {
	uploadBackupToCloud,
	downloadBackupFromCloud,
	listCloudBackups,
} from 'sql/workbench/services/zonecog/browser/cloudBackup';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_AUTO_SAVE_INTERVAL_MS = 10_000;
const DEFAULT_ARCHIVE_SALIENCE_THRESHOLD = 0.05;
const DEFAULT_WARM_SALIENCE_THRESHOLD = 0.25;
const AVG_NODE_SIZE_BYTES = 512;
const AVG_LINK_SIZE_BYTES = 128;

interface ChangeLogEntry {
	id: string;
	entityType: 'node' | 'link';
	entityId: string;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// RocksDB-backed Hypergraph Persistence Service
// ---------------------------------------------------------------------------

/**
 * Phase E.1 RocksDB backend for the Zone-Cog hypergraph.
 *
 * Implements {@link IHypergraphPersistenceService} on top of
 * {@link RocksDbEngine}: column families for nodes, links, indices, warm/cold
 * tiers, snapshots and the incremental-backup changelog; WASM-memory bloom
 * filters; leveled compaction; and ordered range/prefix queries.
 *
 * Durability across workbench restarts is provided by
 * {@link IndexedDbRocksDbDurabilitySink} (IndexedDB holds serialized SST
 * snapshots; the LSM engine governs access patterns). The service is a
 * drop-in alternative to the IndexedDB-native
 * {@link HypergraphPersistenceService} and is also used internally when that
 * service's pluggable backend is switched to `'rocksdb'`.
 */
export class RocksDbPersistenceService extends Disposable implements IHypergraphPersistenceService {

	declare readonly _serviceBrand: undefined;

	private readonly _engine: RocksDbEngine;
	private readonly _durability = new IndexedDbRocksDbDurabilitySink();
	private _ready = false;
	private _openPromise: Promise<void> | null = null;

	private _lastSaveTime = 0;
	private _lastLoadTime = 0;
	private _lastBackupTime = 0;
	private _autoSaveIntervalHandle: ReturnType<typeof setInterval> | null = null;
	private _autoSaveEnabled = false;
	private _suppressChangeTracking = false;
	private _changeLogCounter = 0;
	private _changeLogWriteQueue: Promise<unknown> = Promise.resolve();
	private _writeQueue: Promise<unknown> = Promise.resolve();
	private _cloudConfig: CloudStorageConfig | undefined;

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
		engine?: RocksDbEngine,
	) {
		super();
		this._engine = engine ?? new RocksDbEngine({
			memtableFlushThreshold: 128,
			compactionSstThreshold: 4,
			bloomBitsPerKey: 10,
			bloomHashFunctions: 4,
		}, this._durability);
		this._openPromise = this._engine.open()
			.then(() => {
				this._ready = true;
				this.logService.info('RocksDbPersistenceService: RocksDB engine opened');
			})
			.catch(err => {
				this._ready = false;
				this.logService.warn(`RocksDbPersistenceService: engine open failed - ${err}`);
				throw err;
			});
		this.membraneService.recordActivity('autonomic');
		this._register(this.hypergraphStore.onDidChangeNode(node => this._recordChange('node', node.id)));
		this._register(this.hypergraphStore.onDidChangeLink(link => this._recordChange('link', link.id)));
	}

	/** Expose the underlying engine for diagnostics and shared-backend use. */
	get engine(): RocksDbEngine { return this._engine; }

	// -------------------------------------------------------------------------
	// Core operations
	// -------------------------------------------------------------------------

	async save(label = 'manual'): Promise<HypergraphSnapshot> {
		return this._serialize(async () => {
			await this._ensureOpen();
			const { nodes, links } = this._collectGraph();
			const snapshot: HypergraphSnapshot = {
				id: Date.now(),
				timestamp: Date.now(),
				nodeCount: nodes.length,
				linkCount: links.length,
				label,
			};

			try {
				// Replace hot-tier column families atomically from the caller's
				// perspective: clear then rewrite. Individual puts still go
				// through the LSM write path (memtable → SST → compact).
				await this._engine.clear('nodes');
				await this._engine.clear('links');
				for (const node of nodes) {
					await this._engine.put('nodes', node.id, encodeJson(node));
					await this._indexNode(node);
				}
				for (const link of links) {
					await this._engine.put('links', link.id, encodeJson(link));
					await this._indexLink(link);
				}
				await this._engine.put('snapshots', String(snapshot.id), encodeJson(snapshot));

				this._lastSaveTime = Date.now();
				this.logService.info(
					`RocksDbPersistenceService: saved ${nodes.length} nodes, ${links.length} links (label="${label}")`
				);
				this._onDidSave.fire(snapshot);
				this.membraneService.recordActivity('autonomic');
				return snapshot;
			} catch (err) {
				const msg = String(err);
				this.logService.error(`RocksDbPersistenceService: save failed - ${msg}`);
				this._onDidError.fire({ operation: 'save', message: msg });
				throw err;
			}
		});
	}

	async load(): Promise<HypergraphSnapshot | undefined> {
		return this._serialize(async () => {
			await this._ensureOpen();
			const nodeEntries = await this._engine.range('nodes', '');
			const linkEntries = await this._engine.range('links', '');
			const nodes = nodeEntries.map(([, v]) => decodeJson<HypergraphNode>(v));
			const links = linkEntries.map(([, v]) => decodeJson<HypergraphLink>(v));

			if (nodes.length === 0 && links.length === 0) {
				this.logService.info('RocksDbPersistenceService: nothing stored to load');
				return undefined;
			}

			this._withChangeTrackingSuppressed(() => {
				this.hypergraphStore.clear();
				for (const node of nodes) { this.hypergraphStore.addNode(node); }
				for (const link of links) { this.hypergraphStore.addLink(link); }
			});

			const snapshots = (await this._engine.range('snapshots', ''))
				.map(([, v]) => decodeJson<HypergraphSnapshot>(v))
				.sort((a, b) => b.timestamp - a.timestamp);
			this._lastLoadTime = Date.now();
			this.membraneService.recordActivity('autonomic');

			const latest = snapshots[0] ?? {
				id: 0,
				timestamp: this._lastLoadTime,
				nodeCount: nodes.length,
				linkCount: links.length,
				label: 'restored',
			};
			this._onDidLoad.fire(latest);
			return latest;
		});
	}

	async clearStorage(): Promise<void> {
		return this._serialize(async () => {
			await this._ensureOpen();
			await this._engine.clear();
			this._lastBackupTime = 0;
			this.logService.info('RocksDbPersistenceService: storage cleared');
		});
	}

	async listSnapshots(): Promise<HypergraphSnapshot[]> {
		await this._ensureOpen();
		const snapshots = (await this._engine.range('snapshots', ''))
			.map(([, v]) => decodeJson<HypergraphSnapshot>(v));
		return snapshots.sort((a, b) => b.timestamp - a.timestamp);
	}

	// -------------------------------------------------------------------------
	// Auto-save
	// -------------------------------------------------------------------------

	enableAutoSave(intervalMs: number): void {
		const ms = Math.max(intervalMs, MIN_AUTO_SAVE_INTERVAL_MS);
		this.disableAutoSave();
		this._autoSaveEnabled = true;
		this._autoSaveIntervalHandle = setInterval(async () => {
			try { await this.save('auto-save'); }
			catch (err) { this.logService.warn(`RocksDbPersistenceService: auto-save failed - ${err}`); }
		}, ms);
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
		const rocks = this._toRocksStats();
		if (!this._ready) {
			return {
				databaseReady: false,
				storedNodeCount: 0,
				storedLinkCount: 0,
				snapshotCount: 0,
				lastSaveTime: this._lastSaveTime,
				lastLoadTime: this._lastLoadTime,
				estimatedBytes: 0,
				archivedNodeCount: 0,
				warmNodeCount: 0,
				lastBackupTime: this._lastBackupTime,
				backend: 'rocksdb',
				rocksDb: rocks,
			};
		}
		await this._ensureOpen();
		const [storedNodeCount, storedLinkCount, snapshotCount, archivedNodeCount, warmNodeCount] = await Promise.all([
			this._engine.count('nodes'),
			this._engine.count('links'),
			this._engine.count('snapshots'),
			this._engine.count('archiveNodes'),
			this._engine.count('warmNodes'),
		]);
		return {
			databaseReady: true,
			storedNodeCount,
			storedLinkCount,
			snapshotCount,
			lastSaveTime: this._lastSaveTime,
			lastLoadTime: this._lastLoadTime,
			estimatedBytes: storedNodeCount * AVG_NODE_SIZE_BYTES + storedLinkCount * AVG_LINK_SIZE_BYTES,
			archivedNodeCount,
			warmNodeCount,
			lastBackupTime: this._lastBackupTime,
			backend: 'rocksdb',
			rocksDb: this._toRocksStats(),
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
	// Cold tier
	// -------------------------------------------------------------------------

	async archiveLowSalienceNodes(threshold = DEFAULT_ARCHIVE_SALIENCE_THRESHOLD): Promise<ArchiveStats> {
		return this._serialize(async () => {
			await this._ensureOpen();
			const toArchive = this.hypergraphStore.getAllNodes().filter(n => n.salience_score < threshold);
			if (toArchive.length === 0) {
				return { archivedNodeCount: 0, archivedLinkCount: 0 };
			}
			const archiveIds = new Set(toArchive.map(n => n.id));
			const linksToArchive = this._linksFullyCoveredBy(archiveIds);

			for (const node of toArchive) {
				await this._engine.put('archiveNodes', node.id, encodeJson(node));
				await this._engine.delete('nodes', node.id);
				await this._engine.delete('warmNodes', node.id);
				await this._removeNodeIndex(node);
			}
			for (const link of linksToArchive) {
				await this._engine.put('archiveLinks', link.id, encodeJson(link));
				await this._engine.delete('links', link.id);
				await this._engine.delete('warmLinks', link.id);
				await this._removeLinkIndex(link);
			}
			for (const link of linksToArchive) { this.hypergraphStore.removeLink(link.id); }
			for (const node of toArchive) { this.hypergraphStore.removeNode(node.id); }

			this.membraneService.recordActivity('autonomic');
			return { archivedNodeCount: toArchive.length, archivedLinkCount: linksToArchive.length };
		});
	}

	async restoreArchivedNode(nodeId: string): Promise<HypergraphNode | undefined> {
		return this._serialize(async () => {
			await this._ensureOpen();
			const raw = await this._engine.get('archiveNodes', nodeId);
			if (!raw) { return undefined; }
			const node = decodeJson<HypergraphNode>(raw);
			const links: HypergraphLink[] = [];
			for (const linkId of node.links) {
				const linkRaw = await this._engine.get('archiveLinks', linkId);
				if (linkRaw) { links.push(decodeJson<HypergraphLink>(linkRaw)); }
			}

			const otherArchived = (await this._engine.range('archiveNodes', ''))
				.map(([, v]) => decodeJson<HypergraphNode>(v))
				.filter(n => n.id !== nodeId);
			const stillReferenced = new Set<string>();
			for (const other of otherArchived) {
				for (const lid of other.links) { stillReferenced.add(lid); }
			}

			this._withChangeTrackingSuppressed(() => {
				this.hypergraphStore.addNode(node);
				for (const link of links) {
					if (!this.hypergraphStore.getLink(link.id)) {
						this.hypergraphStore.addLink(link);
					}
				}
			});

			const hotLinks = links.filter(l => l.outgoing.every(id => this.hypergraphStore.getNode(id) !== undefined));
			await this._engine.put('nodes', node.id, encodeJson(node));
			await this._indexNode(node);
			for (const link of hotLinks) {
				await this._engine.put('links', link.id, encodeJson(link));
				await this._indexLink(link);
			}
			await this._engine.delete('archiveNodes', nodeId);
			for (const link of links) {
				if (!stillReferenced.has(link.id)) {
					await this._engine.delete('archiveLinks', link.id);
				}
			}
			this.membraneService.recordActivity('autonomic');
			return node;
		});
	}

	async listArchivedNodes(): Promise<HypergraphNode[]> {
		await this._ensureOpen();
		return (await this._engine.range('archiveNodes', '')).map(([, v]) => decodeJson<HypergraphNode>(v));
	}

	// -------------------------------------------------------------------------
	// Warm tier
	// -------------------------------------------------------------------------

	async demoteToWarmTier(threshold = DEFAULT_WARM_SALIENCE_THRESHOLD): Promise<ArchiveStats> {
		return this._serialize(async () => {
			await this._ensureOpen();
			// Warm band: [coldThreshold, warmThreshold). Colder nodes stay for cold archival.
			const toWarm = this.hypergraphStore.getAllNodes().filter(
				n => n.salience_score < threshold && n.salience_score >= DEFAULT_ARCHIVE_SALIENCE_THRESHOLD
			);
			if (toWarm.length === 0) {
				return { archivedNodeCount: 0, archivedLinkCount: 0 };
			}
			const warmIds = new Set(toWarm.map(n => n.id));
			const linksToWarm = this._linksFullyCoveredBy(warmIds);

			for (const node of toWarm) {
				await this._engine.put('warmNodes', node.id, encodeJson(node));
				await this._engine.delete('nodes', node.id);
				await this._removeNodeIndex(node);
			}
			for (const link of linksToWarm) {
				await this._engine.put('warmLinks', link.id, encodeJson(link));
				await this._engine.delete('links', link.id);
				await this._removeLinkIndex(link);
			}
			for (const link of linksToWarm) { this.hypergraphStore.removeLink(link.id); }
			for (const node of toWarm) { this.hypergraphStore.removeNode(node.id); }

			this.membraneService.recordActivity('autonomic');
			return { archivedNodeCount: toWarm.length, archivedLinkCount: linksToWarm.length };
		});
	}

	async restoreWarmNode(nodeId: string): Promise<HypergraphNode | undefined> {
		return this._serialize(async () => {
			await this._ensureOpen();
			const raw = await this._engine.get('warmNodes', nodeId);
			if (!raw) { return undefined; }
			const node = decodeJson<HypergraphNode>(raw);
			const links: HypergraphLink[] = [];
			for (const linkId of node.links) {
				const linkRaw = await this._engine.get('warmLinks', linkId);
				if (linkRaw) { links.push(decodeJson<HypergraphLink>(linkRaw)); }
			}

			this._withChangeTrackingSuppressed(() => {
				this.hypergraphStore.addNode(node);
				for (const link of links) {
					if (!this.hypergraphStore.getLink(link.id)) {
						this.hypergraphStore.addLink(link);
					}
				}
			});

			await this._engine.put('nodes', node.id, encodeJson(node));
			await this._indexNode(node);
			for (const link of links) {
				if (link.outgoing.every(id => this.hypergraphStore.getNode(id) !== undefined)) {
					await this._engine.put('links', link.id, encodeJson(link));
					await this._indexLink(link);
				}
			}
			await this._engine.delete('warmNodes', nodeId);
			for (const link of links) {
				await this._engine.delete('warmLinks', link.id);
			}
			this.membraneService.recordActivity('autonomic');
			return node;
		});
	}

	async listWarmNodes(): Promise<HypergraphNode[]> {
		await this._ensureOpen();
		return (await this._engine.range('warmNodes', '')).map(([, v]) => decodeJson<HypergraphNode>(v));
	}

	// -------------------------------------------------------------------------
	// Backup
	// -------------------------------------------------------------------------

	async createBackup(sinceTimestamp?: number): Promise<HypergraphBackup> {
		await this._changeLogWriteQueue;
		const full = sinceTimestamp === undefined;
		let nodes: HypergraphNode[];
		let links: HypergraphLink[];

		if (full) {
			({ nodes, links } = this._collectGraph());
		} else {
			await this._ensureOpen();
			const changelog = (await this._engine.range('changelog', ''))
				.map(([, v]) => decodeJson<ChangeLogEntry>(v));
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
		this.membraneService.recordActivity('autonomic');
		return backup;
	}

	async exportBackupJson(sinceTimestamp?: number): Promise<string> {
		return JSON.stringify(await this.createBackup(sinceTimestamp));
	}

	async importBackup(backup: HypergraphBackup): Promise<BackupImportResult> {
		return this._serialize(async () => {
			await this._ensureOpen();
			for (const node of backup.nodes) { this.hypergraphStore.addNode(node); }
			for (const link of backup.links) { this.hypergraphStore.addLink(link); }
			for (const node of backup.nodes) {
				await this._engine.put('nodes', node.id, encodeJson(node));
				await this._indexNode(node);
			}
			for (const link of backup.links) {
				await this._engine.put('links', link.id, encodeJson(link));
				await this._indexLink(link);
			}
			this.membraneService.recordActivity('autonomic');
			return { nodesUpserted: backup.nodes.length, linksUpserted: backup.links.length };
		});
	}

	async importBackupJson(json: string): Promise<BackupImportResult> {
		return this.importBackup(JSON.parse(json) as HypergraphBackup);
	}

	// -------------------------------------------------------------------------
	// Backend selection (this service is always the rocksdb backend)
	// -------------------------------------------------------------------------

	async setBackend(kind: HypergraphPersistenceBackendKind): Promise<void> {
		if (kind !== 'rocksdb') {
			throw new Error(`RocksDbPersistenceService only supports the 'rocksdb' backend (requested '${kind}')`);
		}
	}

	getBackend(): HypergraphPersistenceBackendKind { return 'rocksdb'; }

	getAvailableBackends(): HypergraphPersistenceBackendKind[] { return ['rocksdb']; }

	// -------------------------------------------------------------------------
	// Range queries / compaction
	// -------------------------------------------------------------------------

	async rangeQueryNodes(prefix: string, limit?: number): Promise<HypergraphNode[]> {
		await this._ensureOpen();
		const pairs = await this._engine.prefixScan('nodes', prefix, limit);
		return pairs.map(([, v]) => decodeJson<HypergraphNode>(v));
	}

	async compactStorage(): Promise<void> {
		await this._ensureOpen();
		await this._engine.compact();
		this.membraneService.recordActivity('autonomic');
		this.logService.info('RocksDbPersistenceService: compaction complete');
	}

	// -------------------------------------------------------------------------
	// Cloud storage
	// -------------------------------------------------------------------------

	configureCloudStorage(config: CloudStorageConfig | undefined): void {
		this._cloudConfig = config ? { ...config } : undefined;
	}

	getCloudStorageConfig(): CloudStorageConfig | undefined {
		return this._cloudConfig ? { ...this._cloudConfig } : undefined;
	}

	async uploadBackupToCloud(sinceTimestamp?: number, remoteName?: string): Promise<CloudBackupResult> {
		const result = await uploadBackupToCloud(this, this._cloudConfig, sinceTimestamp, remoteName, msg => this.logService.warn(msg));
		if (result.success) {
			this.membraneService.recordActivity('autonomic');
		}
		return result;
	}

	async downloadBackupFromCloud(remotePath: string): Promise<BackupImportResult> {
		const result = await downloadBackupFromCloud(this, this._cloudConfig, remotePath);
		this.membraneService.recordActivity('autonomic');
		return result;
	}

	async listCloudBackups(): Promise<string[]> {
		return listCloudBackups(this._cloudConfig);
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	override dispose(): void {
		this.disableAutoSave();
		this._durability.close();
		super.dispose();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async _ensureOpen(): Promise<void> {
		if (this._ready) { return; }
		if (this._openPromise) {
			await this._openPromise;
			return;
		}
		await this._engine.open();
		this._ready = true;
	}

	private _serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this._writeQueue.then(operation, operation);
		this._writeQueue = result.then(() => undefined, () => undefined);
		return result;
	}

	private _withChangeTrackingSuppressed(fn: () => void): void {
		const previous = this._suppressChangeTracking;
		this._suppressChangeTracking = true;
		try { fn(); }
		finally { this._suppressChangeTracking = previous; }
	}

	private _recordChange(entityType: 'node' | 'link', entityId: string): void {
		if (this._suppressChangeTracking) { return; }
		const entry: ChangeLogEntry = {
			id: `${entityType}:${entityId}:${Date.now()}:${this._changeLogCounter++}`,
			entityType,
			entityId,
			timestamp: Date.now(),
		};
		this._changeLogWriteQueue = this._changeLogWriteQueue
			.then(() => this._ensureOpen())
			.then(() => this._engine.put('changelog', entry.id, encodeJson(entry)))
			.catch(err => this.logService.warn(`RocksDbPersistenceService: failed to record changelog entry - ${err}`));
	}

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

	private _linksFullyCoveredBy(nodeIds: Set<string>): HypergraphLink[] {
		const candidateLinkIds = new Set<string>();
		for (const id of nodeIds) {
			const node = this.hypergraphStore.getNode(id);
			if (!node) { continue; }
			for (const lid of node.links) { candidateLinkIds.add(lid); }
		}
		const out: HypergraphLink[] = [];
		for (const lid of candidateLinkIds) {
			const link = this.hypergraphStore.getLink(lid);
			if (link && link.outgoing.every(id => nodeIds.has(id))) {
				out.push(link);
			}
		}
		return out;
	}

	/** Secondary index: type → node ids (prefix-scannable). */
	private async _indexNode(node: HypergraphNode): Promise<void> {
		const typeKey = `nodeType:${node.node_type}:${node.id}`;
		const salienceKey = `nodeSalience:${salienceKeyPart(node.salience_score)}:${node.id}`;
		await this._engine.put('indices', typeKey, encodeJson({ id: node.id }));
		await this._engine.put('indices', salienceKey, encodeJson({ id: node.id, salience: node.salience_score }));
	}

	private async _removeNodeIndex(node: HypergraphNode): Promise<void> {
		await this._engine.delete('indices', `nodeType:${node.node_type}:${node.id}`);
		// Salience key includes the score; scan the type-adjacent salience prefix for this id.
		const matches = await this._engine.prefixScan('indices', 'nodeSalience:');
		for (const [key] of matches) {
			if (key.endsWith(`:${node.id}`)) {
				await this._engine.delete('indices', key);
			}
		}
	}

	private async _indexLink(link: HypergraphLink): Promise<void> {
		await this._engine.put('indices', `linkType:${link.link_type}:${link.id}`, encodeJson({ id: link.id }));
	}

	private async _removeLinkIndex(link: HypergraphLink): Promise<void> {
		await this._engine.delete('indices', `linkType:${link.link_type}:${link.id}`);
	}

	private _toRocksStats(): RocksDbPersistenceStats {
		const s = this._engine.getStats();
		return {
			columnFamilies: [...s.columnFamilies],
			memtableEntries: s.memtableEntries,
			sstableCount: s.sstableCount,
			bloomFilterBits: s.bloomFilterBits,
			bloomFilterHits: s.bloomFilterHits,
			bloomFilterMisses: s.bloomFilterMisses,
			compactionCount: s.compactionCount,
			estimatedBytes: s.estimatedBytes,
			ready: s.ready,
		};
	}
}

function salienceKeyPart(score: number): string {
	// Fixed-width zero-padded so lexicographic order matches numeric order.
	const clamped = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
	return Math.round(clamped * 1_000_000).toString().padStart(7, '0');
}

/** Re-export column family type for tests and diagnostics. */
export type { RocksDbColumnFamily };
=======
	IRocksDbPersistenceService,
	RocksDbConfig,
	RocksDbColumnFamily,
	RangeQueryOptions,
	RangeQueryResult,
	BatchWriteOperation,
	RocksDbStats,
	CompactionStatus,
	IndexDefinition,
	DEFAULT_ROCKSDB_CONFIG
} from '../common/rocksDbPersistence';
import { HypergraphNode, HypergraphLink } from '../common/zonecogService';
import { ICognitiveMembraneService } from '../common/zonecogService';

/**
 * In-memory emulation of RocksDB column family storage.
 * In a full implementation, this would use RocksDB WASM bindings.
 */
interface ColumnFamilyStore {
	data: Map<string, string>;
	indices: Map<string, Set<string>>; // secondary indices
}

/**
 * RocksDB-backed persistence service for hypergraph storage.
 *
 * This implementation provides a high-performance storage backend using
 * an in-memory store that emulates RocksDB semantics. In production, this
 * would be backed by RocksDB WASM bindings (e.g., via @aspect-build/rules_js
 * or a custom WASM compilation of RocksDB).
 *
 * Key features:
 * - Column families for data organization (nodes, links, indices, metadata)
 * - Efficient range queries using sorted key iteration
 * - Bloom filter emulation for fast existence checks
 * - Batch write operations with atomic semantics
 * - Secondary index support for efficient queries
 * - Compaction and statistics tracking
 */
export class RocksDbPersistenceService extends Disposable implements IRocksDbPersistenceService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnectionState = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionState: Event<boolean> = this._onDidChangeConnectionState.event;

	private readonly _onDidCompleteCompaction = this._register(new Emitter<{ columnFamily?: RocksDbColumnFamily; durationMs: number }>());
	readonly onDidCompleteCompaction: Event<{ columnFamily?: RocksDbColumnFamily; durationMs: number }> = this._onDidCompleteCompaction.event;

	private readonly _onDidBackupOrRestore = this._register(new Emitter<{ operation: 'backup' | 'restore'; path: string; success: boolean }>());
	readonly onDidBackupOrRestore: Event<{ operation: 'backup' | 'restore'; path: string; success: boolean }> = this._onDidBackupOrRestore.event;

	private _config: RocksDbConfig = { ...DEFAULT_ROCKSDB_CONFIG };
	private _initialized = false;

	// Column family stores
	private readonly _columnFamilies: Map<RocksDbColumnFamily, ColumnFamilyStore> = new Map();

	// Bloom filter emulation (set of known keys for fast negative lookups)
	private readonly _bloomFilters: Map<RocksDbColumnFamily, Set<string>> = new Map();

	// Snapshot management
	private readonly _snapshots: Map<string, Map<RocksDbColumnFamily, Map<string, string>>> = new Map();

	// Index definitions
	private readonly _indexDefinitions: Map<string, IndexDefinition> = new Map();

	// Separate backup storage (not part of column families to prevent restore from deleting backups)
	private readonly _backups: Map<string, { timestamp: number; data: Record<string, Record<string, string>>; indices: Record<string, Record<string, string[]>> }> = new Map();

	// Statistics
	private _writeCount = 0;
	private _readCount = 0;
	private _lastCompactionTime?: number;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this.logService.info('[RocksDbPersistenceService] Service instantiated');
	}

	// --- Lifecycle ---

	async initialize(config?: Partial<RocksDbConfig>): Promise<void> {
		if (this._initialized) {
			this.logService.warn('[RocksDbPersistenceService] Already initialized');
			return;
		}

		this._config = { ...DEFAULT_ROCKSDB_CONFIG, ...config };

		// Initialize column families
		const families: RocksDbColumnFamily[] = ['nodes', 'links', 'indices', 'metadata'];
		for (const family of families) {
			this._columnFamilies.set(family, {
				data: new Map(),
				indices: new Map()
			});
			if (this._config.enableBloomFilters) {
				this._bloomFilters.set(family, new Set());
			}
		}

		this._initialized = true;
		this.membraneService.recordActivity('autonomic');
		this.logService.info('[RocksDbPersistenceService] Initialized with config:', this._config.dbPath);
		this._onDidChangeConnectionState.fire(true);
	}

	isInitialized(): boolean {
		return this._initialized;
	}

	async close(): Promise<void> {
		if (!this._initialized) {
			return;
		}

		// Clear all data
		this._columnFamilies.clear();
		this._bloomFilters.clear();
		this._snapshots.clear();
		this._indexDefinitions.clear();
		this._backups.clear();

		this._initialized = false;
		this.logService.info('[RocksDbPersistenceService] Database closed');
		this._onDidChangeConnectionState.fire(false);
	}

	// --- Node Operations ---

	async putNode(node: HypergraphNode): Promise<void> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		const key = node.id;

		// Remove old index entries if updating an existing node
		const existingValue = cf.data.get(key);
		if (existingValue) {
			const existingNode = JSON.parse(existingValue) as HypergraphNode;
			this._removeFromIndex('nodes', `type:${existingNode.node_type}`, key);
		}

		const value = JSON.stringify(node);
		cf.data.set(key, value);
		this._updateBloomFilter('nodes', key);
		this._updateIndices('nodes', key, node);
		this._writeCount++;

		this.membraneService.recordActivity('somatic');
	}

	async getNode(id: string): Promise<HypergraphNode | undefined> {
		this._ensureInitialized();
		this._readCount++;

		// Fast negative lookup via bloom filter
		if (!this._checkBloomFilter('nodes', id)) {
			return undefined;
		}

		const cf = this._getColumnFamily('nodes');
		const value = cf.data.get(id);

		if (!value) {
			return undefined;
		}

		return JSON.parse(value) as HypergraphNode;
	}

	async deleteNode(id: string): Promise<boolean> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		const existed = cf.data.has(id);

		if (existed) {
			cf.data.delete(id);
			this._removeFromIndices('nodes', id);
			this._writeCount++;
			this.membraneService.recordActivity('somatic');
		}

		return existed;
	}

	async hasNode(id: string): Promise<boolean> {
		this._ensureInitialized();

		// Fast negative lookup via bloom filter
		if (!this._checkBloomFilter('nodes', id)) {
			return false;
		}

		const cf = this._getColumnFamily('nodes');
		return cf.data.has(id);
	}

	async getAllNodes(options?: { limit?: number; offset?: number }): Promise<HypergraphNode[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		let nodes: HypergraphNode[] = [];

		for (const value of cf.data.values()) {
			nodes.push(JSON.parse(value) as HypergraphNode);
		}

		// Apply pagination
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? nodes.length;

		return nodes.slice(offset, offset + limit);
	}

	async getNodesByType(nodeType: string, options?: { limit?: number; offset?: number }): Promise<HypergraphNode[]> {
		this._ensureInitialized();

		// Check for type index
		const indexKey = `type:${nodeType}`;
		const cf = this._getColumnFamily('nodes');
		const typeIndex = cf.indices.get(indexKey);

		let nodes: HypergraphNode[];

		if (typeIndex) {
			// Use index for efficient retrieval
			nodes = [];
			for (const id of typeIndex) {
				const value = cf.data.get(id);
				if (value) {
					nodes.push(JSON.parse(value) as HypergraphNode);
				}
			}
		} else {
			// Full scan
			nodes = [];
			for (const value of cf.data.values()) {
				const node = JSON.parse(value) as HypergraphNode;
				if (node.node_type === nodeType) {
					nodes.push(node);
				}
			}
		}

		// Apply pagination
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? nodes.length;

		return nodes.slice(offset, offset + limit);
	}

	async getNodesBySalienceRange(minSalience: number, maxSalience: number, options?: { limit?: number }): Promise<HypergraphNode[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('nodes');
		const nodes: HypergraphNode[] = [];

		for (const value of cf.data.values()) {
			const node = JSON.parse(value) as HypergraphNode;
			if (node.salience_score >= minSalience && node.salience_score <= maxSalience) {
				nodes.push(node);
			}
		}

		// Sort by salience descending
		nodes.sort((a, b) => b.salience_score - a.salience_score);

		// Apply limit
		const limit = options?.limit ?? nodes.length;
		return nodes.slice(0, limit);
	}

	// --- Link Operations ---

	async putLink(link: HypergraphLink): Promise<void> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		const key = link.id;

		// Remove old index entries if updating an existing link
		const existingValue = cf.data.get(key);
		if (existingValue) {
			const existingLink = JSON.parse(existingValue) as HypergraphLink;
			// Defensive: handle malformed links that may have been batch-written without outgoing array
			if (Array.isArray(existingLink.outgoing)) {
				for (const nodeId of existingLink.outgoing) {
					this._removeFromIndex('links', `outgoing:${nodeId}`, key);
				}
			}
		}

		const value = JSON.stringify(link);
		cf.data.set(key, value);
		this._updateBloomFilter('links', key);

		// Index by all nodes in the outgoing array
		if (Array.isArray(link.outgoing)) {
			for (const nodeId of link.outgoing) {
				this._addToIndex('links', `outgoing:${nodeId}`, key);
			}
		}

		this._writeCount++;
		this.membraneService.recordActivity('somatic');
	}

	async getLink(id: string): Promise<HypergraphLink | undefined> {
		this._ensureInitialized();
		this._readCount++;

		if (!this._checkBloomFilter('links', id)) {
			return undefined;
		}

		const cf = this._getColumnFamily('links');
		const value = cf.data.get(id);

		if (!value) {
			return undefined;
		}

		return JSON.parse(value) as HypergraphLink;
	}

	async deleteLink(id: string): Promise<boolean> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		const existed = cf.data.has(id);

		if (existed) {
			const value = cf.data.get(id);
			if (value) {
				const link = JSON.parse(value) as HypergraphLink;
				// Defensive: handle malformed links that may have been batch-written without outgoing array
				if (Array.isArray(link.outgoing)) {
					for (const nodeId of link.outgoing) {
						this._removeFromIndex('links', `outgoing:${nodeId}`, id);
					}
				}
			}
			cf.data.delete(id);
			this._writeCount++;
			this.membraneService.recordActivity('somatic');
		}

		return existed;
	}

	async getLinksForNode(nodeId: string): Promise<HypergraphLink[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		// Look up links that include this node in their outgoing array
		const outgoingIndex = cf.indices.get(`outgoing:${nodeId}`) ?? new Set();

		const links: HypergraphLink[] = [];

		for (const id of outgoingIndex) {
			const value = cf.data.get(id);
			if (value) {
				links.push(JSON.parse(value) as HypergraphLink);
			}
		}

		return links;
	}

	async getAllLinks(options?: { limit?: number; offset?: number }): Promise<HypergraphLink[]> {
		this._ensureInitialized();

		const cf = this._getColumnFamily('links');
		let links: HypergraphLink[] = [];

		for (const value of cf.data.values()) {
			links.push(JSON.parse(value) as HypergraphLink);
		}

		// Apply pagination
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? links.length;

		return links.slice(offset, offset + limit);
	}

	// --- Range Queries ---

	async rangeQuery<T>(options: RangeQueryOptions): Promise<RangeQueryResult<T>> {
		this._ensureInitialized();

		const cf = this._getColumnFamily(options.columnFamily);
		let keys = Array.from(cf.data.keys()).sort();

		// Apply prefix filter
		if (options.prefix) {
			keys = keys.filter(k => k.startsWith(options.prefix!));
		}

		// Apply range bounds
		if (options.startKey) {
			keys = keys.filter(k => k >= options.startKey!);
		}
		if (options.endKey) {
			keys = keys.filter(k => k < options.endKey!);
		}

		// Apply reverse
		if (options.reverse) {
			keys.reverse();
		}

		// Apply pagination
		const offset = options.offset ?? 0;
		const limit = options.limit ?? keys.length;
		const hasMore = offset + limit < keys.length;
		const paginatedKeys = keys.slice(offset, offset + limit);

		// Retrieve values
		const items: T[] = [];
		for (const key of paginatedKeys) {
			const value = cf.data.get(key);
			if (value) {
				items.push(JSON.parse(value) as T);
			}
		}

		return {
			items,
			totalCount: keys.length,
			hasMore,
			nextCursor: hasMore ? String(offset + limit) : undefined
		};
	}

	async iteratePrefix(columnFamily: RocksDbColumnFamily, prefix: string, callback: (key: string, value: string) => boolean | void): Promise<void> {
		this._ensureInitialized();

		const cf = this._getColumnFamily(columnFamily);
		const keys = Array.from(cf.data.keys())
			.filter(k => k.startsWith(prefix))
			.sort();

		for (const key of keys) {
			const value = cf.data.get(key);
			if (value) {
				const shouldContinue = callback(key, value);
				if (shouldContinue === false) {
					break;
				}
			}
		}
	}

	// --- Batch Operations ---

	async batchWrite(operations: BatchWriteOperation[]): Promise<void> {
		this._ensureInitialized();

		// Create snapshot for rollback on failure
		const snapshots = new Map<RocksDbColumnFamily, { data: Map<string, string>; indices: Map<string, Set<string>> }>();
		const affectedFamilies = new Set(operations.map(op => op.columnFamily));

		for (const family of affectedFamilies) {
			const cf = this._getColumnFamily(family);
			snapshots.set(family, {
				data: new Map(cf.data),
				indices: new Map(Array.from(cf.indices.entries()).map(([k, v]) => [k, new Set(v)]))
			});
		}

		try {
			// Execute all operations
			for (const op of operations) {
				const cf = this._getColumnFamily(op.columnFamily);

				switch (op.type) {
					case 'put':
						if (op.value !== undefined) {
							// Remove old index entries before put
							const existingValue = cf.data.get(op.key);
							if (existingValue) {
								this._removeIndexEntriesForValue(op.columnFamily, op.key, existingValue);
							}
							cf.data.set(op.key, op.value);
							this._updateBloomFilter(op.columnFamily, op.key);
							// Add new index entries
							this._addIndexEntriesForValue(op.columnFamily, op.key, op.value);
						}
						break;
					case 'delete':
						const existingValue = cf.data.get(op.key);
						if (existingValue) {
							this._removeIndexEntriesForValue(op.columnFamily, op.key, existingValue);
						}
						cf.data.delete(op.key);
						break;
					case 'merge':
						if (op.value !== undefined) {
							const existing = cf.data.get(op.key);
							// Remove old index entries
							if (existing) {
								this._removeIndexEntriesForValue(op.columnFamily, op.key, existing);
							}
							const merged = existing
								? { ...JSON.parse(existing), ...JSON.parse(op.value) }
								: JSON.parse(op.value);
							const mergedStr = JSON.stringify(merged);
							cf.data.set(op.key, mergedStr);
							this._updateBloomFilter(op.columnFamily, op.key);
							// Add new index entries
							this._addIndexEntriesForValue(op.columnFamily, op.key, mergedStr);
						}
						break;
				}
			}

			this._writeCount += operations.length;
			this.membraneService.recordActivity('somatic');
		} catch (error) {
			// Rollback on failure
			for (const [family, snapshot] of snapshots) {
				const cf = this._getColumnFamily(family);
				cf.data.clear();
				for (const [k, v] of snapshot.data) {
					cf.data.set(k, v);
				}
				cf.indices.clear();
				for (const [k, v] of snapshot.indices) {
					cf.indices.set(k, new Set(v));
				}
			}
			throw error;
		}
	}

	async bulkPutNodes(nodes: HypergraphNode[]): Promise<{ inserted: number; updated: number }> {
		this._ensureInitialized();

		let inserted = 0;
		let updated = 0;

		const cf = this._getColumnFamily('nodes');

		for (const node of nodes) {
			const existingValue = cf.data.get(node.id);
			const existed = !!existingValue;

			// Remove old index entries if updating
			if (existingValue) {
				const existingNode = JSON.parse(existingValue) as HypergraphNode;
				this._removeFromIndex('nodes', `type:${existingNode.node_type}`, node.id);
			}

			cf.data.set(node.id, JSON.stringify(node));
			this._updateBloomFilter('nodes', node.id);
			this._updateIndices('nodes', node.id, node);

			if (existed) {
				updated++;
			} else {
				inserted++;
			}
		}

		this._writeCount += nodes.length;
		this.membraneService.recordActivity('somatic');

		return { inserted, updated };
	}

	async bulkPutLinks(links: HypergraphLink[]): Promise<{ inserted: number; updated: number }> {
		this._ensureInitialized();

		let inserted = 0;
		let updated = 0;

		const cf = this._getColumnFamily('links');

		for (const link of links) {
			const existingValue = cf.data.get(link.id);
			const existed = !!existingValue;

			// Remove old index entries if updating
			if (existingValue) {
				const existingLink = JSON.parse(existingValue) as HypergraphLink;
				for (const nodeId of existingLink.outgoing) {
					this._removeFromIndex('links', `outgoing:${nodeId}`, link.id);
				}
			}

			cf.data.set(link.id, JSON.stringify(link));
			this._updateBloomFilter('links', link.id);
			for (const nodeId of link.outgoing) {
				this._addToIndex('links', `outgoing:${nodeId}`, link.id);
			}

			if (existed) {
				updated++;
			} else {
				inserted++;
			}
		}

		this._writeCount += links.length;
		this.membraneService.recordActivity('somatic');

		return { inserted, updated };
	}

	// --- Index Management ---

	async createIndex(definition: IndexDefinition): Promise<void> {
		this._ensureInitialized();

		this._indexDefinitions.set(definition.name, definition);

		// Build the index
		await this.rebuildIndex(definition.name);

		this.logService.info('[RocksDbPersistenceService] Created index:', definition.name);
	}

	async dropIndex(indexName: string): Promise<void> {
		this._ensureInitialized();

		this._indexDefinitions.delete(indexName);

		// Remove index data
		const cf = this._getColumnFamily('indices');
		const keysToDelete: string[] = [];
		for (const key of cf.data.keys()) {
			if (key.startsWith(`${indexName}:`)) {
				keysToDelete.push(key);
			}
		}
		for (const key of keysToDelete) {
			cf.data.delete(key);
		}

		this.logService.info('[RocksDbPersistenceService] Dropped index:', indexName);
	}

	async listIndices(): Promise<IndexDefinition[]> {
		return Array.from(this._indexDefinitions.values());
	}

	async rebuildIndex(indexName: string): Promise<void> {
		this._ensureInitialized();

		const definition = this._indexDefinitions.get(indexName);
		if (!definition) {
			throw new Error(`Index not found: ${indexName}`);
		}

		const sourceCf = this._getColumnFamily(definition.sourceColumnFamily);
		const indexCf = this._getColumnFamily('indices');

		// Clear existing index entries
		const keysToDelete: string[] = [];
		for (const key of indexCf.data.keys()) {
			if (key.startsWith(`${indexName}:`)) {
				keysToDelete.push(key);
			}
		}
		for (const key of keysToDelete) {
			indexCf.data.delete(key);
		}

		// Rebuild index
		for (const [key, value] of sourceCf.data) {
			const doc = JSON.parse(value);
			// Execute key extractor (simplified - in production would use a sandboxed evaluator)
			const indexKey = this._extractIndexKey(definition.keyExtractor, doc);
			if (indexKey !== null || !definition.sparse) {
				const fullKey = `${indexName}:${indexKey}`;
				const existing = indexCf.data.get(fullKey);
				if (existing) {
					const ids = JSON.parse(existing) as string[];
					if (!ids.includes(key)) {
						ids.push(key);
						indexCf.data.set(fullKey, JSON.stringify(ids));
					}
				} else {
					indexCf.data.set(fullKey, JSON.stringify([key]));
				}
			}
		}

		this.logService.info('[RocksDbPersistenceService] Rebuilt index:', indexName);
	}

	// --- Compaction & Maintenance ---

	async compact(columnFamily?: RocksDbColumnFamily): Promise<void> {
		this._ensureInitialized();

		const startTime = Date.now();

		// In a real RocksDB implementation, this would trigger compaction.
		// For our emulation, we just record the event.
		await new Promise(resolve => setTimeout(resolve, 10)); // Simulate work

		this._lastCompactionTime = Date.now();
		const durationMs = Date.now() - startTime;

		this.membraneService.recordActivity('autonomic');
		this._onDidCompleteCompaction.fire({ columnFamily, durationMs });

		this.logService.info('[RocksDbPersistenceService] Compaction completed in', durationMs, 'ms');
	}

	async getCompactionStatus(): Promise<CompactionStatus> {
		return {
			isRunning: false,
			currentLevel: undefined,
			progress: undefined,
			estimatedCompletionMs: undefined,
			lastCompactionTime: this._lastCompactionTime
		};
	}

	async flush(): Promise<void> {
		this._ensureInitialized();

		// In a real implementation, this would flush write buffers to disk.
		// For our emulation, this is a no-op.
		this.logService.debug('[RocksDbPersistenceService] Flush completed');
	}

	// --- Statistics ---

	async getStats(): Promise<RocksDbStats> {
		this._ensureInitialized();

		const entryCounts: Record<RocksDbColumnFamily, number> = {
			nodes: this._getColumnFamily('nodes').data.size,
			links: this._getColumnFamily('links').data.size,
			indices: this._getColumnFamily('indices').data.size,
			metadata: this._getColumnFamily('metadata').data.size
		};

		// Estimate size
		let totalSize = 0;
		for (const cf of this._columnFamilies.values()) {
			for (const [key, value] of cf.data) {
				totalSize += key.length * 2 + value.length * 2; // UTF-16 estimate
			}
		}

		return {
			dbSizeBytes: totalSize,
			sstFileCount: 0, // Emulation doesn't have SST files
			entryCounts,
			writeAmplification: 1.0,
			readAmplification: 1.0,
			pendingCompactionBytes: 0,
			memoryUsage: {
				blockCache: 0,
				writeBuffer: totalSize,
				indexAndFilter: 0
			}
		};
	}

	async getEntryCount(columnFamily: RocksDbColumnFamily): Promise<number> {
		this._ensureInitialized();
		return this._getColumnFamily(columnFamily).data.size;
	}

	async estimateSize(): Promise<number> {
		const stats = await this.getStats();
		return stats.dbSizeBytes;
	}

	// --- Snapshots & Backup ---

	async createSnapshot(): Promise<string> {
		this._ensureInitialized();

		const snapshotId = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const snapshotData = new Map<RocksDbColumnFamily, Map<string, string>>();

		for (const [family, store] of this._columnFamilies) {
			snapshotData.set(family, new Map(store.data));
		}

		this._snapshots.set(snapshotId, snapshotData);

		this.logService.info('[RocksDbPersistenceService] Created snapshot:', snapshotId);
		return snapshotId;
	}

	async releaseSnapshot(snapshotId: string): Promise<void> {
		this._snapshots.delete(snapshotId);
		this.logService.info('[RocksDbPersistenceService] Released snapshot:', snapshotId);
	}

	async createBackup(backupPath: string): Promise<void> {
		this._ensureInitialized();

		try {
			// Serialize data and indices for all column families
			const data: Record<string, Record<string, string>> = {};
			const indices: Record<string, Record<string, string[]>> = {};

			for (const [family, store] of this._columnFamilies) {
				data[family] = Object.fromEntries(store.data);
				// Serialize indices as arrays for JSON compatibility
				const familyIndices: Record<string, string[]> = {};
				for (const [key, idSet] of store.indices) {
					familyIndices[key] = Array.from(idSet);
				}
				indices[family] = familyIndices;
			}

			// Store backup separately from column families
			this._backups.set(backupPath, {
				timestamp: Date.now(),
				data,
				indices
			});

			this._onDidBackupOrRestore.fire({ operation: 'backup', path: backupPath, success: true });
			this.logService.info('[RocksDbPersistenceService] Backup created:', backupPath);
		} catch (error) {
			this._onDidBackupOrRestore.fire({ operation: 'backup', path: backupPath, success: false });
			throw error;
		}
	}

	async restoreFromBackup(backupPath: string): Promise<void> {
		this._ensureInitialized();

		try {
			const backup = this._backups.get(backupPath);

			if (!backup) {
				this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: false });
				throw new Error(`Backup not found: ${backupPath}`);
			}

			const { data, indices } = backup;

			// Restore each column family's data and indices
			for (const [family, entries] of Object.entries(data)) {
				const cf = this._getColumnFamily(family as RocksDbColumnFamily);
				cf.data.clear();
				cf.indices.clear();

				// Restore data
				for (const [key, value] of Object.entries(entries)) {
					cf.data.set(key, value);
					this._updateBloomFilter(family as RocksDbColumnFamily, key);
				}

				// Restore indices
				const familyIndices = indices[family];
				if (familyIndices) {
					for (const [indexKey, ids] of Object.entries(familyIndices)) {
						cf.indices.set(indexKey, new Set(ids));
					}
				}
			}

			this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: true });
			this.logService.info('[RocksDbPersistenceService] Restored from backup:', backupPath);
		} catch (error) {
			if (!(error instanceof Error && error.message.includes('Backup not found'))) {
				this._onDidBackupOrRestore.fire({ operation: 'restore', path: backupPath, success: false });
			}
			throw error;
		}
	}

	// --- Private Helpers ---

	private _ensureInitialized(): void {
		if (!this._initialized) {
			throw new Error('RocksDbPersistenceService is not initialized. Call initialize() first.');
		}
	}

	private _getColumnFamily(family: RocksDbColumnFamily): ColumnFamilyStore {
		const cf = this._columnFamilies.get(family);
		if (!cf) {
			throw new Error(`Column family not found: ${family}`);
		}
		return cf;
	}

	private _updateBloomFilter(family: RocksDbColumnFamily, key: string): void {
		if (this._config.enableBloomFilters) {
			const filter = this._bloomFilters.get(family);
			if (filter) {
				filter.add(key);
			}
		}
	}

	private _checkBloomFilter(family: RocksDbColumnFamily, key: string): boolean {
		if (!this._config.enableBloomFilters) {
			return true; // No filter, assume key might exist
		}
		const filter = this._bloomFilters.get(family);
		return filter ? filter.has(key) : true;
	}

	private _updateIndices(family: RocksDbColumnFamily, key: string, doc: unknown): void {
		if (family === 'nodes') {
			const node = doc as HypergraphNode;
			this._addToIndex(family, `type:${node.node_type}`, key);
		}
	}

	private _removeFromIndices(family: RocksDbColumnFamily, key: string): void {
		const cf = this._getColumnFamily(family);
		for (const [indexKey, ids] of cf.indices) {
			ids.delete(key);
			if (ids.size === 0) {
				cf.indices.delete(indexKey);
			}
		}
	}

	private _removeIndexEntriesForValue(family: RocksDbColumnFamily, key: string, value: string): void {
		try {
			const doc = JSON.parse(value);
			if (family === 'nodes') {
				const node = doc as HypergraphNode;
				this._removeFromIndex(family, `type:${node.node_type}`, key);
			} else if (family === 'links') {
				const link = doc as HypergraphLink;
				// Defensive: handle malformed links without outgoing array
				if (Array.isArray(link.outgoing)) {
					for (const nodeId of link.outgoing) {
						this._removeFromIndex(family, `outgoing:${nodeId}`, key);
					}
				}
			}
		} catch {
			// If we can't parse the value, we can't remove index entries
		}
	}

	private _addIndexEntriesForValue(family: RocksDbColumnFamily, key: string, value: string): void {
		try {
			const doc = JSON.parse(value);
			if (family === 'nodes') {
				const node = doc as HypergraphNode;
				this._addToIndex(family, `type:${node.node_type}`, key);
			} else if (family === 'links') {
				const link = doc as HypergraphLink;
				// Defensive: handle malformed links without outgoing array
				if (Array.isArray(link.outgoing)) {
					for (const nodeId of link.outgoing) {
						this._addToIndex(family, `outgoing:${nodeId}`, key);
					}
				}
			}
		} catch {
			// If we can't parse the value, we can't add index entries
		}
	}

	private _addToIndex(family: RocksDbColumnFamily, indexKey: string, docKey: string): void {
		const cf = this._getColumnFamily(family);
		let ids = cf.indices.get(indexKey);
		if (!ids) {
			ids = new Set();
			cf.indices.set(indexKey, ids);
		}
		ids.add(docKey);
	}

	private _removeFromIndex(family: RocksDbColumnFamily, indexKey: string, docKey: string): void {
		const cf = this._getColumnFamily(family);
		const ids = cf.indices.get(indexKey);
		if (ids) {
			ids.delete(docKey);
			if (ids.size === 0) {
				cf.indices.delete(indexKey);
			}
		}
	}

	private _extractIndexKey(extractor: string, doc: unknown): string | null {
		// Simplified key extraction - supports dot notation
		// e.g., "node_type" or "metadata.category"
		try {
			const parts = extractor.split('.');
			let value: unknown = doc;
			for (const part of parts) {
				if (value && typeof value === 'object' && part in value) {
					value = (value as Record<string, unknown>)[part];
				} else {
					return null;
				}
			}
			return value != null ? String(value) : null;
		} catch {
			return null;
		}
	}
}
>>>>>>> origin/main
