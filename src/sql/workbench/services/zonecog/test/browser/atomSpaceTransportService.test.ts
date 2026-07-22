/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AtomSpaceTransportService } from 'sql/workbench/services/zonecog/browser/atomSpaceTransportService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { NullLogService } from 'vs/platform/log/common/log';

suite('AtomSpaceTransportService', () => {
	let transportService: AtomSpaceTransportService;
	let hypergraphStore: HypergraphStore;
	let membraneService: CognitiveMembraneService;
	let logService: NullLogService;

	setup(() => {
		logService = new NullLogService();
		hypergraphStore = new HypergraphStore(logService);
		membraneService = new CognitiveMembraneService(logService);
		transportService = new AtomSpaceTransportService(logService, hypergraphStore, membraneService);
	});

	teardown(() => {
		transportService.dispose();
		hypergraphStore.dispose();
		membraneService.dispose();
	});

	test('should initialize with default config', () => {
		const config = transportService.getConfig();
		assert.strictEqual(config.baseUrl, 'http://127.0.0.1:7807');
		assert.strictEqual(config.timeoutMs, 10000);
		assert.strictEqual(config.authToken, undefined);
	});

	test('should update config partially via configure()', () => {
		transportService.configure({ baseUrl: 'http://custom-bridge:9000', authToken: 'tok-123' });
		const config = transportService.getConfig();
		assert.strictEqual(config.baseUrl, 'http://custom-bridge:9000');
		assert.strictEqual(config.authToken, 'tok-123');
		assert.strictEqual(config.timeoutMs, 10000);
	});

	test('should not be connected initially', () => {
		assert.strictEqual(transportService.isConnected(), false);
	});

	test('healthCheck should return false when bridge unreachable', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		const healthy = await transportService.healthCheck();
		assert.strictEqual(healthy, false);
		assert.strictEqual(transportService.isConnected(), false);
	});

	test('healthCheck should fire onDidChangeConnectionStatus on status change', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		let fired = false;
		transportService.onDidChangeConnectionStatus(() => { fired = true; });
		await transportService.healthCheck();
		assert.strictEqual(fired, true);
	});

	test('syncHypergraph should report failure result when bridge unreachable', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });

		const result = await transportService.syncHypergraph(
			[{ id: 'n1', node_type: 'TableNode', content: 'orders' }],
			[]
		);

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.nodeCount, 1);
		assert.strictEqual(result.linkCount, 0);
		assert.ok(result.error);
		assert.ok(result.durationMs >= 0);
		assert.ok(result.requestId.startsWith('atomspace-sync-'));
	});

	test('syncHypergraph should never throw even on failure', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		await assert.doesNotReject(async () => {
			await transportService.syncHypergraph([], []);
		});
	});

	test('syncHypergraph should fire onDidSync with the result', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		let observed: any;
		transportService.onDidSync(result => { observed = result; });

		const result = await transportService.syncHypergraph([], []);

		assert.ok(observed);
		assert.strictEqual(observed.requestId, result.requestId);
	});

	test('syncHypergraph should append to sync history', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });

		assert.strictEqual(transportService.getSyncHistory().length, 0);
		await transportService.syncHypergraph([], []);
		assert.strictEqual(transportService.getSyncHistory().length, 1);
		await transportService.syncHypergraph([], []);
		assert.strictEqual(transportService.getSyncHistory().length, 2);
	});

	test('clearHistory should empty the sync history', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		await transportService.syncHypergraph([], []);
		assert.strictEqual(transportService.getSyncHistory().length, 1);

		transportService.clearHistory();
		assert.strictEqual(transportService.getSyncHistory().length, 0);
	});

	test('syncHypergraph should persist an AtomSpaceSyncRecord hypergraph node', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });

		const before = hypergraphStore.getNodesByType('AtomSpaceSyncRecord').length;
		await transportService.syncHypergraph([{ id: 'n1', node_type: 'TableNode', content: 'orders' }], []);
		const after = hypergraphStore.getNodesByType('AtomSpaceSyncRecord');

		assert.strictEqual(after.length, before + 1);
		assert.strictEqual(after[after.length - 1].metadata.success, false);
		assert.strictEqual(after[after.length - 1].metadata.nodeCount, 1);
	});

	test('syncHypergraph should record somatic membrane activity', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		const initialActivity = membraneService.getActivity('somatic');

		await transportService.syncHypergraph([], []);

		const afterActivity = membraneService.getActivity('somatic');
		assert.ok(afterActivity > initialActivity);
	});

	test('healthCheck should record somatic membrane activity', async () => {
		transportService.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		const initialActivity = membraneService.getActivity('somatic');

		await transportService.healthCheck();

		const afterActivity = membraneService.getActivity('somatic');
		assert.ok(afterActivity > initialActivity);
	});

	test('should have onDidSync event', () => {
		assert.ok(transportService.onDidSync);
		const disposable = transportService.onDidSync(() => { });
		disposable.dispose();
	});

	test('should have onDidChangeConnectionStatus event', () => {
		assert.ok(transportService.onDidChangeConnectionStatus);
		const disposable = transportService.onDidChangeConnectionStatus(() => { });
		disposable.dispose();
	});
});
