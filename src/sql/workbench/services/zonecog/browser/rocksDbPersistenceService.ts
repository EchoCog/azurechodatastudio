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
	HypergraphPersistenceBackendKind,
	CloudStorageConfig,
	CloudBackupResult,
	RocksDbPersistenceStats,
} from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { IHypergraphStore, HypergraphNode, HypergraphLink, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import {
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
