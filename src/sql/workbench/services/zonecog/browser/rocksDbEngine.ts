/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RocksDB-compatible LSM-tree engine for the browser workbench.
 *
 * Provides the storage primitives the Phase E RocksDB backend needs without a
 * native addon:
 *   - Column families (independent key spaces)
 *   - Memtable + immutable SSTables
 *   - Bloom filters stored in WebAssembly linear memory ("via wasm")
 *   - Leveled compaction
 *   - Ordered range / prefix queries
 *   - Optional durability via a pluggable snapshot sink (typically IndexedDB)
 *
 * The engine is intentionally self-contained so it can later be swapped for a
 * true RocksDB WASM binary behind the same API without touching callers.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RocksDbColumnFamily =
	| 'nodes'
	| 'links'
	| 'indices'
	| 'archiveNodes'
	| 'archiveLinks'
	| 'warmNodes'
	| 'warmLinks'
	| 'snapshots'
	| 'changelog'
	| 'meta';

export const ROCKSDB_COLUMN_FAMILIES: readonly RocksDbColumnFamily[] = [
	'nodes',
	'links',
	'indices',
	'archiveNodes',
	'archiveLinks',
	'warmNodes',
	'warmLinks',
	'snapshots',
	'changelog',
	'meta',
] as const;

export interface RocksDbEngineOptions {
	/** Flush the memtable into an SSTable once it reaches this many entries. */
	memtableFlushThreshold?: number;
	/** Trigger compaction once a column family accumulates this many SSTables. */
	compactionSstThreshold?: number;
	/** Bloom filter bits per key (higher = fewer false positives, more memory). */
	bloomBitsPerKey?: number;
	/** Number of independent hash functions used by the bloom filter. */
	bloomHashFunctions?: number;
}

export interface RocksDbEngineStats {
	columnFamilies: RocksDbColumnFamily[];
	memtableEntries: number;
	sstableCount: number;
	bloomFilterBits: number;
	bloomFilterHits: number;
	bloomFilterMisses: number;
	compactionCount: number;
	estimatedBytes: number;
	/** True once {@link RocksDbEngine.open} has completed successfully. */
	ready: boolean;
}

/** Durable snapshot of one column family (JSON-serializable). */
export interface RocksDbColumnFamilySnapshot {
	name: RocksDbColumnFamily;
	/** Sorted [key, value] pairs (values are base64-encoded bytes). */
	entries: Array<[string, string]>;
}

/** Full engine snapshot used for durability round-trips. */
export interface RocksDbEngineSnapshot {
	version: 1;
	columnFamilies: RocksDbColumnFamilySnapshot[];
}

/**
 * Optional durability sink. The engine calls `save` after flushes/compactions
 * and `load` once during {@link RocksDbEngine.open}.
 */
export interface IRocksDbDurabilitySink {
	load(): Promise<RocksDbEngineSnapshot | undefined>;
	save(snapshot: RocksDbEngineSnapshot): Promise<void>;
	clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeUtf8(value: string): Uint8Array {
	return textEncoder.encode(value);
}

export function decodeUtf8(bytes: Uint8Array): string {
	return textDecoder.decode(bytes);
}

export function encodeJson(value: unknown): Uint8Array {
	return encodeUtf8(JSON.stringify(value));
}

export function decodeJson<T>(bytes: Uint8Array): T {
	return JSON.parse(decodeUtf8(bytes)) as T;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Bloom filter backed by WebAssembly linear memory
// ---------------------------------------------------------------------------

/**
 * Bloom filter whose bitset lives in {@link WebAssembly.Memory}. Point-lookup
 * negatives are answered without scanning SSTables; false-positive rate is
 * tuned via bits-per-key and hash-function count.
 */
export class WasmBloomFilter {
	private readonly _memory: WebAssembly.Memory;
	private readonly _bits: Uint8Array;
	private readonly _bitCount: number;
	private readonly _hashCount: number;
	private _inserts = 0;

	constructor(expectedKeys: number, bitsPerKey: number, hashCount: number) {
		this._bitCount = Math.max(64, Math.ceil(expectedKeys * bitsPerKey));
		this._hashCount = Math.max(1, hashCount);
		// Grow WASM memory in 64 KiB pages to hold the bitset.
		const bytesNeeded = Math.ceil(this._bitCount / 8);
		const pages = Math.max(1, Math.ceil(bytesNeeded / 65536));
		this._memory = new WebAssembly.Memory({ initial: pages, maximum: Math.max(pages, 256) });
		this._bits = new Uint8Array(this._memory.buffer, 0, bytesNeeded);
	}

	get bitCount(): number { return this._bitCount; }
	get insertCount(): number { return this._inserts; }
	/** Expose the underlying WASM memory for diagnostics / future native hooks. */
	get wasmMemory(): WebAssembly.Memory { return this._memory; }

	add(key: string): void {
		const h1 = fnv1a32(key);
		const h2 = djb2(key) | 1; // force odd step so the probe sequence covers the filter
		for (let i = 0; i < this._hashCount; i++) {
			const bit = (h1 + i * h2) >>> 0;
			const idx = bit % this._bitCount;
			this._bits[idx >> 3] |= (1 << (idx & 7));
		}
		this._inserts++;
	}

	/** @returns false if the key is definitely absent; true if it may be present. */
	mightContain(key: string): boolean {
		const h1 = fnv1a32(key);
		const h2 = djb2(key) | 1;
		for (let i = 0; i < this._hashCount; i++) {
			const bit = (h1 + i * h2) >>> 0;
			const idx = bit % this._bitCount;
			if ((this._bits[idx >> 3] & (1 << (idx & 7))) === 0) {
				return false;
			}
		}
		return true;
	}

	/** Rebuild from a known key set (used after compaction). */
	rebuild(keys: Iterable<string>): void {
		this._bits.fill(0);
		this._inserts = 0;
		for (const key of keys) {
			this.add(key);
		}
	}
}

function fnv1a32(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		// Math.imul keeps the multiply in int32 space.
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function djb2(text: string): number {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
	}
	return hash >>> 0;
}

// ---------------------------------------------------------------------------
// SSTable (immutable sorted string table)
// ---------------------------------------------------------------------------

interface SSTable {
	/** Sorted ascending by key. */
	entries: Array<[string, Uint8Array]>;
	bloom: WasmBloomFilter;
}

function buildSSTable(entries: Array<[string, Uint8Array]>, bitsPerKey: number, hashCount: number): SSTable {
	const sorted = entries.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	// Collapse duplicate keys - last write wins (LSM semantics).
	const collapsed: Array<[string, Uint8Array]> = [];
	for (const [key, value] of sorted) {
		if (collapsed.length > 0 && collapsed[collapsed.length - 1][0] === key) {
			collapsed[collapsed.length - 1] = [key, value];
		} else {
			collapsed.push([key, value]);
		}
	}
	const bloom = new WasmBloomFilter(Math.max(collapsed.length, 1), bitsPerKey, hashCount);
	for (const [key] of collapsed) {
		bloom.add(key);
	}
	return { entries: collapsed, bloom };
}

function sstableGet(table: SSTable, key: string): { found: boolean; value?: Uint8Array; bloomMiss: boolean } {
	if (!table.bloom.mightContain(key)) {
		return { found: false, bloomMiss: true };
	}
	// Binary search over sorted entries.
	let lo = 0;
	let hi = table.entries.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const cmp = table.entries[mid][0] < key ? -1 : table.entries[mid][0] > key ? 1 : 0;
		if (cmp === 0) {
			const value = table.entries[mid][1];
			// Tombstone: empty payload means deleted.
			if (value.byteLength === 0) {
				return { found: true, value: undefined, bloomMiss: false };
			}
			return { found: true, value, bloomMiss: false };
		}
		if (cmp < 0) { lo = mid + 1; } else { hi = mid - 1; }
	}
	return { found: false, bloomMiss: false };
}

function sstableRange(table: SSTable, start: string, end: string, out: Map<string, Uint8Array>): void {
	for (const [key, value] of table.entries) {
		if (key < start) { continue; }
		if (key >= end) { break; }
		if (value.byteLength === 0) {
			out.delete(key);
		} else {
			out.set(key, value);
		}
	}
}

// ---------------------------------------------------------------------------
// Column family
// ---------------------------------------------------------------------------

class ColumnFamily {
	readonly name: RocksDbColumnFamily;
	/** Active memtable (newest writes). */
	memtable = new Map<string, Uint8Array>();
	/** Immutable SSTables, oldest first. Newer tables override older ones. */
	sstables: SSTable[] = [];
	bloomHits = 0;
	bloomMisses = 0;
	compactionCount = 0;

	constructor(name: RocksDbColumnFamily) {
		this.name = name;
	}

	get entryCount(): number {
		let n = this.memtable.size;
		for (const t of this.sstables) { n += t.entries.length; }
		return n;
	}

	estimatedBytes(): number {
		let bytes = 0;
		for (const [k, v] of this.memtable) { bytes += k.length + v.byteLength; }
		for (const t of this.sstables) {
			for (const [k, v] of t.entries) { bytes += k.length + v.byteLength; }
		}
		return bytes;
	}
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const TOMBSTONE = new Uint8Array(0);

const DEFAULT_OPTIONS: Required<RocksDbEngineOptions> = {
	memtableFlushThreshold: 256,
	compactionSstThreshold: 4,
	bloomBitsPerKey: 10,
	bloomHashFunctions: 4,
};

/**
 * In-process RocksDB-compatible engine.
 *
 * Write path: put/delete → memtable → (threshold) flush to SSTable →
 * (threshold) leveled compaction. Read path: memtable → newest SSTable → …
 * with bloom short-circuit on each table. Range scans merge the same layers
 * in key order.
 */
export class RocksDbEngine {
	private readonly _options: Required<RocksDbEngineOptions>;
	private readonly _families = new Map<RocksDbColumnFamily, ColumnFamily>();
	private readonly _sink: IRocksDbDurabilitySink | undefined;
	private _ready = false;
	private _openPromise: Promise<void> | null = null;
	/** Serializes durability writes so concurrent flushes don't clobber each other. */
	private _persistQueue: Promise<unknown> = Promise.resolve();

	constructor(options?: RocksDbEngineOptions, durabilitySink?: IRocksDbDurabilitySink) {
		this._options = { ...DEFAULT_OPTIONS, ...options };
		this._sink = durabilitySink;
		for (const name of ROCKSDB_COLUMN_FAMILIES) {
			this._families.set(name, new ColumnFamily(name));
		}
	}

	/** Open the engine, reloading any durable snapshot from the sink. */
	open(): Promise<void> {
		if (this._ready) { return Promise.resolve(); }
		if (this._openPromise) { return this._openPromise; }
		this._openPromise = (async () => {
			if (this._sink) {
				const snapshot = await this._sink.load();
				if (snapshot) {
					this._restoreSnapshot(snapshot);
				}
			}
			this._ready = true;
		})();
		return this._openPromise;
	}

	get ready(): boolean { return this._ready; }

	/**
	 * Put a value into a column family. Empty values are rejected - use
	 * {@link delete} for removals (which write a tombstone).
	 */
	async put(cf: RocksDbColumnFamily, key: string, value: Uint8Array): Promise<void> {
		await this._ensureOpen();
		if (value.byteLength === 0) {
			throw new Error('RocksDbEngine.put: empty values are reserved for tombstones; use delete()');
		}
		const family = this._family(cf);
		// Clone so callers cannot mutate the stored buffer.
		family.memtable.set(key, value.slice());
		await this._maybeFlushAndCompact(family);
	}

	async delete(cf: RocksDbColumnFamily, key: string): Promise<void> {
		await this._ensureOpen();
		const family = this._family(cf);
		family.memtable.set(key, TOMBSTONE);
		await this._maybeFlushAndCompact(family);
	}

	async get(cf: RocksDbColumnFamily, key: string): Promise<Uint8Array | undefined> {
		await this._ensureOpen();
		const family = this._family(cf);

		if (family.memtable.has(key)) {
			const v = family.memtable.get(key)!;
			return v.byteLength === 0 ? undefined : v.slice();
		}

		// Probe SSTables newest-first so later writes win.
		for (let i = family.sstables.length - 1; i >= 0; i--) {
			const result = sstableGet(family.sstables[i], key);
			if (result.bloomMiss) {
				family.bloomMisses++;
				continue;
			}
			family.bloomHits++;
			if (result.found) {
				return result.value ? result.value.slice() : undefined;
			}
		}
		return undefined;
	}

	/**
	 * Inclusive-start / exclusive-end range scan. Results are sorted by key.
	 * When `end` is omitted, scans from `start` to the end of the keyspace.
	 * When `prefix` mode is desired, pass `end = prefixSuccessor(start)`.
	 */
	async range(
		cf: RocksDbColumnFamily,
		start: string,
		end?: string,
		limit?: number,
	): Promise<Array<[string, Uint8Array]>> {
		await this._ensureOpen();
		const family = this._family(cf);
		const endKey = end ?? '\uffff';
		const merged = new Map<string, Uint8Array>();

		// Oldest SSTables first, then newer, then memtable - so later writes win.
		for (const table of family.sstables) {
			sstableRange(table, start, endKey, merged);
		}
		for (const [key, value] of family.memtable) {
			if (key < start || key >= endKey) { continue; }
			if (value.byteLength === 0) {
				merged.delete(key);
			} else {
				merged.set(key, value);
			}
		}

		const keys = [...merged.keys()].sort();
		const out: Array<[string, Uint8Array]> = [];
		for (const key of keys) {
			out.push([key, merged.get(key)!.slice()]);
			if (limit !== undefined && out.length >= limit) { break; }
		}
		return out;
	}

	/** Prefix scan convenience - every key starting with `prefix`. */
	async prefixScan(
		cf: RocksDbColumnFamily,
		prefix: string,
		limit?: number,
	): Promise<Array<[string, Uint8Array]>> {
		return this.range(cf, prefix, prefixSuccessor(prefix), limit);
	}

	async clear(cf?: RocksDbColumnFamily): Promise<void> {
		await this._ensureOpen();
		if (cf) {
			const family = this._family(cf);
			family.memtable.clear();
			family.sstables = [];
		} else {
			for (const family of this._families.values()) {
				family.memtable.clear();
				family.sstables = [];
			}
			if (this._sink) {
				await this._sink.clear();
			}
		}
		await this._persist();
	}

	/** Force-flush every memtable and compact every column family. */
	async compact(cf?: RocksDbColumnFamily): Promise<void> {
		await this._ensureOpen();
		const families = cf ? [this._family(cf)] : [...this._families.values()];
		for (const family of families) {
			if (family.memtable.size > 0) {
				this._flushMemtable(family);
			}
			this._compactFamily(family, /* force */ true);
		}
		await this._persist();
	}

	getStats(): RocksDbEngineStats {
		let memtableEntries = 0;
		let sstableCount = 0;
		let bloomFilterBits = 0;
		let bloomFilterHits = 0;
		let bloomFilterMisses = 0;
		let compactionCount = 0;
		let estimatedBytes = 0;

		for (const family of this._families.values()) {
			memtableEntries += family.memtable.size;
			sstableCount += family.sstables.length;
			bloomFilterHits += family.bloomHits;
			bloomFilterMisses += family.bloomMisses;
			compactionCount += family.compactionCount;
			estimatedBytes += family.estimatedBytes();
			for (const t of family.sstables) {
				bloomFilterBits += t.bloom.bitCount;
			}
		}

		return {
			columnFamilies: [...ROCKSDB_COLUMN_FAMILIES],
			memtableEntries,
			sstableCount,
			bloomFilterBits,
			bloomFilterHits,
			bloomFilterMisses,
			compactionCount,
			estimatedBytes,
			ready: this._ready,
		};
	}

	/** Enumerate every live (non-tombstone) key in a column family, sorted. */
	async keys(cf: RocksDbColumnFamily): Promise<string[]> {
		const pairs = await this.range(cf, '', undefined);
		return pairs.map(([k]) => k);
	}

	async count(cf: RocksDbColumnFamily): Promise<number> {
		return (await this.keys(cf)).length;
	}

	// -----------------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------------

	private _family(cf: RocksDbColumnFamily): ColumnFamily {
		const family = this._families.get(cf);
		if (!family) {
			throw new Error(`Unknown column family: ${cf}`);
		}
		return family;
	}

	private async _ensureOpen(): Promise<void> {
		if (!this._ready) {
			await this.open();
		}
	}

	private async _maybeFlushAndCompact(family: ColumnFamily): Promise<void> {
		if (family.memtable.size >= this._options.memtableFlushThreshold) {
			this._flushMemtable(family);
			this._compactFamily(family, /* force */ false);
			await this._persist();
		}
	}

	private _flushMemtable(family: ColumnFamily): void {
		if (family.memtable.size === 0) { return; }
		const entries = [...family.memtable.entries()];
		family.memtable = new Map();
		family.sstables.push(buildSSTable(
			entries,
			this._options.bloomBitsPerKey,
			this._options.bloomHashFunctions,
		));
	}

	/**
	 * Leveled compaction: when the SSTable count exceeds the threshold (or
	 * `force` is set and there is more than one table), merge all tables into
	 * a single compacted table with a rebuilt bloom filter.
	 */
	private _compactFamily(family: ColumnFamily, force: boolean): void {
		const threshold = this._options.compactionSstThreshold;
		if (family.sstables.length <= 1) { return; }
		if (!force && family.sstables.length < threshold) { return; }

		const merged = new Map<string, Uint8Array>();
		for (const table of family.sstables) {
			for (const [key, value] of table.entries) {
				if (value.byteLength === 0) {
					merged.delete(key);
				} else {
					merged.set(key, value);
				}
			}
		}
		const entries = [...merged.entries()];
		family.sstables = entries.length > 0
			? [buildSSTable(entries, this._options.bloomBitsPerKey, this._options.bloomHashFunctions)]
			: [];
		family.compactionCount++;
	}

	private async _persist(): Promise<void> {
		if (!this._sink) { return; }
		const snapshot = this._captureSnapshot();
		// Chain so concurrent flush/compact callers share one durable write.
		this._persistQueue = this._persistQueue
			.then(() => this._sink!.save(snapshot))
			.catch(() => undefined);
		await this._persistQueue;
	}

	private _captureSnapshot(): RocksDbEngineSnapshot {
		const columnFamilies: RocksDbColumnFamilySnapshot[] = [];
		for (const family of this._families.values()) {
			// Materialize the merged live view so the snapshot has no tombstones.
			const merged = new Map<string, Uint8Array>();
			for (const table of family.sstables) {
				for (const [key, value] of table.entries) {
					if (value.byteLength === 0) { merged.delete(key); }
					else { merged.set(key, value); }
				}
			}
			for (const [key, value] of family.memtable) {
				if (value.byteLength === 0) { merged.delete(key); }
				else { merged.set(key, value); }
			}
			const entries: Array<[string, string]> = [...merged.entries()]
				.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
				.map(([k, v]) => [k, bytesToBase64(v)]);
			columnFamilies.push({ name: family.name, entries });
		}
		return { version: 1, columnFamilies };
	}

	private _restoreSnapshot(snapshot: RocksDbEngineSnapshot): void {
		for (const cfSnap of snapshot.columnFamilies) {
			const family = this._families.get(cfSnap.name);
			if (!family) { continue; }
			family.memtable.clear();
			family.sstables = [];
			if (cfSnap.entries.length === 0) { continue; }
			const entries: Array<[string, Uint8Array]> = cfSnap.entries.map(
				([k, b64]) => [k, base64ToBytes(b64)]
			);
			family.sstables.push(buildSSTable(
				entries,
				this._options.bloomBitsPerKey,
				this._options.bloomHashFunctions,
			));
		}
	}
}

/**
 * Compute the shortest string strictly greater than every key with the given
 * prefix, used as the exclusive end bound for prefix scans. Falls back to a
 * high code-point sentinel when the prefix is empty or cannot be incremented.
 */
export function prefixSuccessor(prefix: string): string {
	if (prefix.length === 0) {
		return '\uffff';
	}
	// Increment the last character code; if it would overflow, truncate and
	// retry so "foo\uffff" still yields a usable exclusive bound.
	for (let i = prefix.length - 1; i >= 0; i--) {
		const code = prefix.charCodeAt(i);
		if (code < 0xffff) {
			return prefix.slice(0, i) + String.fromCharCode(code + 1);
		}
	}
	return prefix + '\uffff';
}

// ---------------------------------------------------------------------------
// IndexedDB durability sink (keeps RocksDB state across workbench restarts)
// ---------------------------------------------------------------------------

const ROCKS_DB_NAME = 'zonecog-rocksdb';
const ROCKS_DB_VERSION = 1;
const ROCKS_STORE = 'engine';
const ROCKS_SNAPSHOT_KEY = 'snapshot';

/**
 * Persists {@link RocksDbEngineSnapshot} documents in a dedicated IndexedDB
 * database so the LSM engine survives page reloads. The RocksDB logical
 * structure (column families, bloom filters, compaction) still governs
 * in-process access patterns; IndexedDB is only the durability medium.
 */
export class IndexedDbRocksDbDurabilitySink implements IRocksDbDurabilitySink {
	private _db: IDBDatabase | null = null;
	private _openPromise: Promise<IDBDatabase> | null = null;

	private _open(): Promise<IDBDatabase> {
		if (this._db) { return Promise.resolve(this._db); }
		if (this._openPromise) { return this._openPromise; }
		this._openPromise = new Promise<IDBDatabase>((resolve, reject) => {
			if (typeof indexedDB === 'undefined') {
				reject(new Error('IndexedDB is not available in this environment'));
				return;
			}
			const req = indexedDB.open(ROCKS_DB_NAME, ROCKS_DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(ROCKS_STORE)) {
					db.createObjectStore(ROCKS_STORE, { keyPath: 'id' });
				}
			};
			req.onsuccess = () => {
				this._db = req.result;
				resolve(req.result);
			};
			req.onerror = () => reject(req.error ?? new Error('Failed to open RocksDB durability store'));
		});
		return this._openPromise;
	}

	async load(): Promise<RocksDbEngineSnapshot | undefined> {
		const db = await this._open();
		return new Promise<RocksDbEngineSnapshot | undefined>((resolve, reject) => {
			const tx = db.transaction(ROCKS_STORE, 'readonly');
			const req = tx.objectStore(ROCKS_STORE).get(ROCKS_SNAPSHOT_KEY);
			req.onsuccess = () => {
				const row = req.result as { id: string; snapshot: RocksDbEngineSnapshot } | undefined;
				resolve(row?.snapshot);
			};
			req.onerror = () => reject(req.error);
		});
	}

	async save(snapshot: RocksDbEngineSnapshot): Promise<void> {
		const db = await this._open();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction(ROCKS_STORE, 'readwrite');
			tx.objectStore(ROCKS_STORE).put({ id: ROCKS_SNAPSHOT_KEY, snapshot });
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async clear(): Promise<void> {
		const db = await this._open();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction(ROCKS_STORE, 'readwrite');
			tx.objectStore(ROCKS_STORE).clear();
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	close(): void {
		if (this._db) {
			this._db.close();
			this._db = null;
			this._openPromise = null;
		}
	}
}
