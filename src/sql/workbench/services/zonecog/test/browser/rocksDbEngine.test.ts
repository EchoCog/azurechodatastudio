/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	RocksDbEngine,
	WasmBloomFilter,
	IRocksDbDurabilitySink,
	RocksDbEngineSnapshot,
	encodeJson,
	decodeJson,
	encodeUtf8,
	decodeUtf8,
	prefixSuccessor,
} from 'sql/workbench/services/zonecog/browser/rocksDbEngine';

class InMemoryDurabilitySink implements IRocksDbDurabilitySink {
	snapshot: RocksDbEngineSnapshot | undefined;
	saveCount = 0;

	async load(): Promise<RocksDbEngineSnapshot | undefined> {
		return this.snapshot;
	}

	async save(snapshot: RocksDbEngineSnapshot): Promise<void> {
		this.snapshot = snapshot;
		this.saveCount++;
	}

	async clear(): Promise<void> {
		this.snapshot = undefined;
	}
}

suite('RocksDbEngine', () => {

	// -----------------------------------------------------------------------
	// Encoding helpers
	// -----------------------------------------------------------------------

	suite('encoding helpers', () => {
		test('encodeUtf8 / decodeUtf8 round-trip', () => {
			const text = 'hello world éèê';
			const bytes = encodeUtf8(text);
			assert.strictEqual(decodeUtf8(bytes), text);
		});

		test('encodeJson / decodeJson round-trip', () => {
			const obj = { name: 'node-1', score: 0.75, tags: ['a', 'b'] };
			const bytes = encodeJson(obj);
			const decoded = decodeJson<typeof obj>(bytes);
			assert.deepStrictEqual(decoded, obj);
		});
	});

	// -----------------------------------------------------------------------
	// WasmBloomFilter
	// -----------------------------------------------------------------------

	suite('WasmBloomFilter', () => {
		test('reports inserted keys as possibly present', () => {
			const bloom = new WasmBloomFilter(100, 10, 4);
			bloom.add('alpha');
			bloom.add('beta');
			assert.ok(bloom.mightContain('alpha'));
			assert.ok(bloom.mightContain('beta'));
		});

		test('reports absent keys as definitely absent (low false-positive rate)', () => {
			const bloom = new WasmBloomFilter(1000, 10, 4);
			for (let i = 0; i < 100; i++) {
				bloom.add(`key-${i}`);
			}
			let falsePositives = 0;
			for (let i = 100; i < 200; i++) {
				if (bloom.mightContain(`key-${i}`)) {
					falsePositives++;
				}
			}
			assert.ok(falsePositives < 10, `Expected < 10% false positives, got ${falsePositives}%`);
		});

		test('tracks insert count', () => {
			const bloom = new WasmBloomFilter(50, 10, 4);
			assert.strictEqual(bloom.insertCount, 0);
			bloom.add('x');
			bloom.add('y');
			assert.strictEqual(bloom.insertCount, 2);
		});

		test('rebuild clears and re-inserts', () => {
			const bloom = new WasmBloomFilter(100, 10, 4);
			bloom.add('old-key');
			assert.ok(bloom.mightContain('old-key'));

			bloom.rebuild(['new-a', 'new-b']);
			assert.strictEqual(bloom.insertCount, 2);
			assert.ok(bloom.mightContain('new-a'));
			assert.ok(bloom.mightContain('new-b'));
		});

		test('exposes WebAssembly.Memory', () => {
			const bloom = new WasmBloomFilter(10, 10, 4);
			assert.ok(bloom.wasmMemory instanceof WebAssembly.Memory);
		});
	});

	// -----------------------------------------------------------------------
	// prefixSuccessor
	// -----------------------------------------------------------------------

	suite('prefixSuccessor', () => {
		test('increments last character', () => {
			assert.strictEqual(prefixSuccessor('abc'), 'abd');
		});

		test('empty prefix returns sentinel', () => {
			assert.strictEqual(prefixSuccessor(''), '￿');
		});

		test('handles trailing max code points', () => {
			const result = prefixSuccessor('a￿');
			assert.strictEqual(result, 'b');
		});

		test('all max code points returns sentinel suffix', () => {
			const result = prefixSuccessor('￿￿');
			assert.strictEqual(result, '￿￿￿');
		});
	});

	// -----------------------------------------------------------------------
	// Engine: basic CRUD
	// -----------------------------------------------------------------------

	suite('basic CRUD', () => {
		let engine: RocksDbEngine;

		setup(async () => {
			engine = new RocksDbEngine();
			await engine.open();
		});

		test('open sets ready = true', () => {
			assert.strictEqual(engine.ready, true);
		});

		test('put and get a value', async () => {
			await engine.put('nodes', 'n1', encodeJson({ id: 'n1' }));
			const result = await engine.get('nodes', 'n1');
			assert.ok(result);
			assert.deepStrictEqual(decodeJson(result), { id: 'n1' });
		});

		test('get missing key returns undefined', async () => {
			const result = await engine.get('nodes', 'nonexistent');
			assert.strictEqual(result, undefined);
		});

		test('delete removes a key', async () => {
			await engine.put('nodes', 'n1', encodeJson({ id: 'n1' }));
			await engine.delete('nodes', 'n1');
			const result = await engine.get('nodes', 'n1');
			assert.strictEqual(result, undefined);
		});

		test('put rejects empty values', async () => {
			await assert.rejects(
				() => engine.put('nodes', 'n1', new Uint8Array(0)),
				/tombstones/
			);
		});

		test('put overwrites existing key', async () => {
			await engine.put('nodes', 'n1', encodeJson({ v: 1 }));
			await engine.put('nodes', 'n1', encodeJson({ v: 2 }));
			const result = await engine.get('nodes', 'n1');
			assert.ok(result);
			assert.deepStrictEqual(decodeJson(result), { v: 2 });
		});

		test('operations on different column families are independent', async () => {
			await engine.put('nodes', 'k', encodeJson('nodes-val'));
			await engine.put('links', 'k', encodeJson('links-val'));
			const nodesVal = await engine.get('nodes', 'k');
			const linksVal = await engine.get('links', 'k');
			assert.ok(nodesVal);
			assert.ok(linksVal);
			assert.deepStrictEqual(decodeJson(nodesVal), 'nodes-val');
			assert.deepStrictEqual(decodeJson(linksVal), 'links-val');
		});
	});

	// -----------------------------------------------------------------------
	// Engine: range and prefix scans
	// -----------------------------------------------------------------------

	suite('range and prefix scans', () => {
		let engine: RocksDbEngine;

		setup(async () => {
			engine = new RocksDbEngine();
			await engine.open();
			for (const key of ['a1', 'a2', 'a3', 'b1', 'b2', 'c1']) {
				await engine.put('nodes', key, encodeJson(key));
			}
		});

		test('range scan returns sorted results', async () => {
			const results = await engine.range('nodes', 'a1', 'b1');
			const keys = results.map(([k]) => k);
			assert.deepStrictEqual(keys, ['a1', 'a2', 'a3']);
		});

		test('range scan with limit', async () => {
			const results = await engine.range('nodes', 'a1', undefined, 2);
			assert.strictEqual(results.length, 2);
			assert.strictEqual(results[0][0], 'a1');
			assert.strictEqual(results[1][0], 'a2');
		});

		test('prefix scan returns matching keys', async () => {
			const results = await engine.prefixScan('nodes', 'a');
			const keys = results.map(([k]) => k);
			assert.deepStrictEqual(keys, ['a1', 'a2', 'a3']);
		});

		test('prefix scan with limit', async () => {
			const results = await engine.prefixScan('nodes', 'a', 1);
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0][0], 'a1');
		});

		test('range scan excludes deleted keys', async () => {
			await engine.delete('nodes', 'a2');
			const results = await engine.range('nodes', 'a1', 'b1');
			const keys = results.map(([k]) => k);
			assert.deepStrictEqual(keys, ['a1', 'a3']);
		});
	});

	// -----------------------------------------------------------------------
	// Engine: keys and count
	// -----------------------------------------------------------------------

	suite('keys and count', () => {
		test('keys returns all non-tombstone keys sorted', async () => {
			const engine = new RocksDbEngine();
			await engine.open();
			await engine.put('nodes', 'z', encodeJson('z'));
			await engine.put('nodes', 'a', encodeJson('a'));
			await engine.put('nodes', 'm', encodeJson('m'));
			const keys = await engine.keys('nodes');
			assert.deepStrictEqual(keys, ['a', 'm', 'z']);
		});

		test('count reflects live entries', async () => {
			const engine = new RocksDbEngine();
			await engine.open();
			await engine.put('nodes', 'a', encodeJson('a'));
			await engine.put('nodes', 'b', encodeJson('b'));
			assert.strictEqual(await engine.count('nodes'), 2);
			await engine.delete('nodes', 'a');
			assert.strictEqual(await engine.count('nodes'), 1);
		});
	});

	// -----------------------------------------------------------------------
	// Engine: flush and compaction
	// -----------------------------------------------------------------------

	suite('flush and compaction', () => {
		test('memtable flushes to SSTable at threshold', async () => {
			const engine = new RocksDbEngine({ memtableFlushThreshold: 3 });
			await engine.open();

			await engine.put('nodes', 'k1', encodeJson(1));
			await engine.put('nodes', 'k2', encodeJson(2));
			const beforeFlush = engine.getStats();
			assert.strictEqual(beforeFlush.sstableCount, 0);

			await engine.put('nodes', 'k3', encodeJson(3));
			const afterFlush = engine.getStats();
			assert.ok(afterFlush.sstableCount >= 1, 'Expected at least 1 SSTable after flush');

			const v = await engine.get('nodes', 'k1');
			assert.ok(v);
			assert.deepStrictEqual(decodeJson(v), 1);
		});

		test('compaction merges SSTables', async () => {
			const engine = new RocksDbEngine({
				memtableFlushThreshold: 2,
				compactionSstThreshold: 3,
			});
			await engine.open();

			for (let i = 0; i < 8; i++) {
				await engine.put('nodes', `k${i}`, encodeJson(i));
			}

			const stats = engine.getStats();
			assert.ok(stats.compactionCount >= 1, 'Expected at least one compaction');
		});

		test('forced compact reduces to single SSTable', async () => {
			const engine = new RocksDbEngine({ memtableFlushThreshold: 2, compactionSstThreshold: 100 });
			await engine.open();

			for (let i = 0; i < 10; i++) {
				await engine.put('nodes', `k${i}`, encodeJson(i));
			}
			await engine.compact('nodes');

			for (let i = 0; i < 10; i++) {
				const v = await engine.get('nodes', `k${i}`);
				assert.ok(v, `Key k${i} should exist after compaction`);
				assert.deepStrictEqual(decodeJson(v), i);
			}
		});

		test('tombstones are removed during compaction', async () => {
			const engine = new RocksDbEngine({ memtableFlushThreshold: 2 });
			await engine.open();

			await engine.put('nodes', 'keep', encodeJson('yes'));
			await engine.put('nodes', 'remove', encodeJson('no'));
			await engine.delete('nodes', 'remove');

			await engine.compact('nodes');
			assert.strictEqual(await engine.get('nodes', 'remove'), undefined);
			const v = await engine.get('nodes', 'keep');
			assert.ok(v);
			assert.deepStrictEqual(decodeJson(v), 'yes');
		});
	});

	// -----------------------------------------------------------------------
	// Engine: bloom filter integration
	// -----------------------------------------------------------------------

	suite('bloom filter integration', () => {
		test('bloom filter stats are tracked', async () => {
			const engine = new RocksDbEngine({ memtableFlushThreshold: 2 });
			await engine.open();

			await engine.put('nodes', 'a', encodeJson('a'));
			await engine.put('nodes', 'b', encodeJson('b'));

			await engine.get('nodes', 'a');
			await engine.get('nodes', 'nonexistent');

			const stats = engine.getStats();
			assert.ok(
				stats.bloomFilterHits + stats.bloomFilterMisses > 0,
				'Expected bloom filter probes after SSTable reads'
			);
		});
	});

	// -----------------------------------------------------------------------
	// Engine: clear
	// -----------------------------------------------------------------------

	suite('clear', () => {
		test('clear single column family', async () => {
			const engine = new RocksDbEngine();
			await engine.open();
			await engine.put('nodes', 'n', encodeJson('n'));
			await engine.put('links', 'l', encodeJson('l'));
			await engine.clear('nodes');
			assert.strictEqual(await engine.get('nodes', 'n'), undefined);
			const l = await engine.get('links', 'l');
			assert.ok(l, 'links column family should be unaffected');
		});

		test('clear all column families', async () => {
			const engine = new RocksDbEngine();
			await engine.open();
			await engine.put('nodes', 'n', encodeJson('n'));
			await engine.put('links', 'l', encodeJson('l'));
			await engine.clear();
			assert.strictEqual(await engine.get('nodes', 'n'), undefined);
			assert.strictEqual(await engine.get('links', 'l'), undefined);
		});
	});

	// -----------------------------------------------------------------------
	// Engine: getStats
	// -----------------------------------------------------------------------

	suite('getStats', () => {
		test('returns valid stats object', async () => {
			const engine = new RocksDbEngine();
			await engine.open();
			const stats = engine.getStats();
			assert.ok(Array.isArray(stats.columnFamilies));
			assert.strictEqual(stats.columnFamilies.length, 10);
			assert.strictEqual(stats.ready, true);
			assert.strictEqual(typeof stats.memtableEntries, 'number');
			assert.strictEqual(typeof stats.estimatedBytes, 'number');
		});
	});

	// -----------------------------------------------------------------------
	// Engine: durability sink
	// -----------------------------------------------------------------------

	suite('durability sink', () => {
		test('persists state and restores on reopen', async () => {
			const sink = new InMemoryDurabilitySink();
			const engine1 = new RocksDbEngine({ memtableFlushThreshold: 2 }, sink);
			await engine1.open();

			await engine1.put('nodes', 'persistent-key', encodeJson({ saved: true }));
			await engine1.put('nodes', 'trigger-flush', encodeJson('flush'));

			assert.ok(sink.snapshot, 'Sink should have a snapshot after flush');
			assert.ok(sink.saveCount >= 1);

			const engine2 = new RocksDbEngine(undefined, sink);
			await engine2.open();
			const restored = await engine2.get('nodes', 'persistent-key');
			assert.ok(restored, 'Key should be restored from durability sink');
			assert.deepStrictEqual(decodeJson(restored), { saved: true });
		});

		test('clear wipes the durability sink', async () => {
			const sink = new InMemoryDurabilitySink();
			const engine = new RocksDbEngine({ memtableFlushThreshold: 2 }, sink);
			await engine.open();

			await engine.put('nodes', 'a', encodeJson('a'));
			await engine.put('nodes', 'b', encodeJson('b'));
			assert.ok(sink.snapshot);

			await engine.clear();
			assert.strictEqual(sink.snapshot, undefined);
		});
	});

	// -----------------------------------------------------------------------
	// Engine: idempotent open
	// -----------------------------------------------------------------------

	suite('idempotent open', () => {
		test('calling open twice does not reset state', async () => {
			const engine = new RocksDbEngine();
			await engine.open();
			await engine.put('nodes', 'k', encodeJson('v'));
			await engine.open();
			const v = await engine.get('nodes', 'k');
			assert.ok(v);
			assert.deepStrictEqual(decodeJson(v), 'v');
		});
	});
});
