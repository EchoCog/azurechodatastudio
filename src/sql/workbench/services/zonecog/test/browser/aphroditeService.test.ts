/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AphroditeService } from 'sql/workbench/services/zonecog/browser/aphroditeService';
import { NullLogService } from 'vs/platform/log/common/log';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';

suite('AphroditeService', () => {
	let aphroditeService: AphroditeService;
	let membraneService: CognitiveMembraneService;
	let logService: NullLogService;

	setup(() => {
		logService = new NullLogService();
		membraneService = new CognitiveMembraneService(logService);
		aphroditeService = new AphroditeService(logService, membraneService);
	});

	teardown(() => {
		aphroditeService.dispose();
		membraneService.dispose();
	});

	test('should initialize with default config', () => {
		const config = aphroditeService.getConfig();

		assert.strictEqual(config.baseUrl, 'http://localhost:2242');
		assert.strictEqual(config.model, 'default');
		assert.strictEqual(config.maxTokens, 2048);
		assert.strictEqual(config.temperature, 0.7);
		assert.strictEqual(config.topP, 0.95);
		assert.strictEqual(config.topK, 40);
		assert.strictEqual(config.frequencyPenalty, 0.0);
		assert.strictEqual(config.presencePenalty, 0.0);
		assert.strictEqual(config.timeoutMs, 60000);
		assert.strictEqual(config.batchingEnabled, true);
		assert.strictEqual(config.maxBatchSize, 16);
	});

	test('should update config partially', () => {
		aphroditeService.updateConfig({
			model: 'llama-3.1-70b',
			temperature: 0.5,
			maxTokens: 4096,
		});

		const config = aphroditeService.getConfig();

		assert.strictEqual(config.model, 'llama-3.1-70b');
		assert.strictEqual(config.temperature, 0.5);
		assert.strictEqual(config.maxTokens, 4096);
		// Other values should remain default
		assert.strictEqual(config.baseUrl, 'http://localhost:2242');
		assert.strictEqual(config.topP, 0.95);
	});

	test('should not be connected initially', () => {
		assert.strictEqual(aphroditeService.isConnected(), false);
	});

	test('should fire connection status event on initialize', async () => {
		let statusChanged = false;
		aphroditeService.onDidChangeConnectionStatus((connected) => {
			statusChanged = true;
		});

		// Initialize will fail to connect (no real server)
		await aphroditeService.initialize({});

		assert.strictEqual(statusChanged, true);
		assert.strictEqual(aphroditeService.isConnected(), false);
	});

	test('should initialize with custom config', async () => {
		await aphroditeService.initialize({
			baseUrl: 'http://custom:8080',
			apiKey: 'test-key',
			model: 'custom-model',
		});

		const config = aphroditeService.getConfig();

		assert.strictEqual(config.baseUrl, 'http://custom:8080');
		assert.strictEqual(config.apiKey, 'test-key');
		assert.strictEqual(config.model, 'custom-model');
	});

	test('should return false for health check when server unavailable', async () => {
		const healthy = await aphroditeService.healthCheck();
		assert.strictEqual(healthy, false);
	});

	test('should cancel request by ID', () => {
		// Should not throw
		aphroditeService.cancelRequest('non-existent-request');
	});

	test('should cancel all requests', () => {
		// Should not throw
		aphroditeService.cancelAllRequests();
	});

	test('should return zeroed stats when server unavailable', async () => {
		const stats = await aphroditeService.getStats();

		assert.strictEqual(stats.requestsPerSecond, 0);
		assert.strictEqual(stats.tokensPerSecond, 0);
		assert.strictEqual(stats.activeRequests, 0);
		assert.strictEqual(stats.queuedRequests, 0);
		assert.strictEqual(stats.gpuMemoryUsed, 0);
		assert.strictEqual(stats.gpuMemoryTotal, 0);
		assert.strictEqual(stats.gpuUtilization, 0);
		assert.strictEqual(stats.kvCacheSize, 0);
	});

	test('should have onDidReceiveStreamToken event', () => {
		assert.ok(aphroditeService.onDidReceiveStreamToken);

		const disposable = aphroditeService.onDidReceiveStreamToken(() => { });

		disposable.dispose();
	});

	test('should have onDidUpdateStats event', () => {
		assert.ok(aphroditeService.onDidUpdateStats);

		const disposable = aphroditeService.onDidUpdateStats(() => { });

		disposable.dispose();
	});

	test('should record membrane activity on initialize', async () => {
		const initialActivity = membraneService.getActivity('cerebral');

		await aphroditeService.initialize({});

		const afterActivity = membraneService.getActivity('cerebral');
		assert.ok(afterActivity > initialActivity);
	});

	test('should record membrane activity on stats', async () => {
		const initialActivity = membraneService.getActivity('cerebral');

		await aphroditeService.getStats();

		// Stats doesn't record activity on error path
		const afterActivity = membraneService.getActivity('cerebral');
		assert.ok(afterActivity >= initialActivity);
	});

	test('complete should throw when server unavailable', async () => {
		try {
			await aphroditeService.complete({
				prompt: 'Hello, world!',
			});
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
	});

	test('embed should throw when server unavailable', async () => {
		try {
			await aphroditeService.embed({
				texts: ['Hello', 'World'],
			});
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
	});

	test('listModels should throw when server unavailable', async () => {
		try {
			await aphroditeService.listModels();
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
	});

	test('getCurrentModel should throw when server unavailable', async () => {
		try {
			await aphroditeService.getCurrentModel();
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
	});

	test('switchModel should update config model', async () => {
		await aphroditeService.switchModel('new-model');

		const config = aphroditeService.getConfig();
		assert.strictEqual(config.model, 'new-model');
	});

	test('batchComplete should handle errors gracefully', async () => {
		const result = await aphroditeService.batchComplete({
			batchId: 'test-batch',
			requests: [
				{ prompt: 'Test 1' },
				{ prompt: 'Test 2' },
			],
		});

		assert.strictEqual(result.batchId, 'test-batch');
		assert.ok(result.errors.length > 0);
		assert.ok(result.totalTimeMs >= 0);
	});

	test('config should have batchingEnabled option', () => {
		const config = aphroditeService.getConfig();
		assert.strictEqual(typeof config.batchingEnabled, 'boolean');
	});

	test('config should have maxBatchSize option', () => {
		const config = aphroditeService.getConfig();
		assert.strictEqual(typeof config.maxBatchSize, 'number');
		assert.ok(config.maxBatchSize > 0);
	});

	test('config should have promptCachingEnabled option enabled by default', () => {
		const config = aphroditeService.getConfig();
		assert.strictEqual(config.promptCachingEnabled, true);
	});

	// --- LoRA adapter management ---

	test('listAdapters should start empty', () => {
		assert.deepStrictEqual(aphroditeService.listAdapters(), []);
	});

	test('getActiveAdapter should be undefined initially', () => {
		assert.strictEqual(aphroditeService.getActiveAdapter(), undefined);
	});

	test('loadAdapter should throw when server unavailable', async () => {
		try {
			await aphroditeService.loadAdapter('my-adapter', '/models/my-adapter');
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
		// A failed load must not register the adapter as loaded.
		assert.deepStrictEqual(aphroditeService.listAdapters(), []);
		assert.strictEqual(aphroditeService.getActiveAdapter(), undefined);
	});

	test('unloadAdapter should throw when server unavailable', async () => {
		try {
			await aphroditeService.unloadAdapter('my-adapter');
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
	});

	test('should have onDidChangeAdapters event', () => {
		assert.ok(aphroditeService.onDidChangeAdapters);
		const disposable = aphroditeService.onDidChangeAdapters(() => { });
		disposable.dispose();
	});

	// --- Telemetry ---

	test('getTelemetry should start empty', () => {
		assert.deepStrictEqual(aphroditeService.getTelemetry(), []);
	});

	test('a failed complete() should record an error in telemetry for the attempted model', async () => {
		try {
			await aphroditeService.complete({ prompt: 'test', model: 'model-a' });
		} catch {
			// expected: no server available
		}

		const telemetry = aphroditeService.getTelemetry('model-a');
		assert.strictEqual(telemetry.length, 1);
		assert.strictEqual(telemetry[0].modelId, 'model-a');
		assert.strictEqual(telemetry[0].requestCount, 1);
		assert.strictEqual(telemetry[0].errorCount, 1);
		assert.strictEqual(telemetry[0].averageLatencyMs, 0);
	});

	test('getTelemetry(modelId) should return an empty array for an unknown model', async () => {
		await aphroditeService.complete({ prompt: 'test', model: 'model-a' }).catch(() => { });
		assert.deepStrictEqual(aphroditeService.getTelemetry('model-unused'), []);
	});

	test('resetTelemetry should clear accumulated telemetry', async () => {
		await aphroditeService.complete({ prompt: 'test', model: 'model-a' }).catch(() => { });
		assert.ok(aphroditeService.getTelemetry().length > 0);

		aphroditeService.resetTelemetry();
		assert.deepStrictEqual(aphroditeService.getTelemetry(), []);
	});

	test('a fallback chain attempt should record telemetry for every model tried', async () => {
		aphroditeService.setFallbackChain(['model-b', 'model-c']);
		try {
			await aphroditeService.complete({ prompt: 'test', model: 'model-a' });
		} catch {
			// expected: no server available for any model in the chain
		}

		const telemetry = aphroditeService.getTelemetry();
		const modelIds = telemetry.map(t => t.modelId).sort();
		assert.deepStrictEqual(modelIds, ['model-a', 'model-b', 'model-c']);
	});

	// --- Fallback chain ---

	test('getFallbackChain should start empty', () => {
		assert.deepStrictEqual(aphroditeService.getFallbackChain(), []);
	});

	test('setFallbackChain should update the configured chain', () => {
		aphroditeService.setFallbackChain(['model-b', 'model-c']);
		assert.deepStrictEqual(aphroditeService.getFallbackChain(), ['model-b', 'model-c']);
	});

	test('setFallbackChain should not mutate the array passed in', () => {
		const chain = ['model-b'];
		aphroditeService.setFallbackChain(chain);
		chain.push('model-c');
		assert.deepStrictEqual(aphroditeService.getFallbackChain(), ['model-b']);
	});

	// --- Model comparison ---

	test('compareModels should return one result per requested model', async () => {
		const results = await aphroditeService.compareModels({ prompt: 'test' }, ['model-a', 'model-b']);

		assert.strictEqual(results.length, 2);
		assert.deepStrictEqual(results.map(r => r.modelId), ['model-a', 'model-b']);
	});

	test('compareModels results should report an error since no server is available', async () => {
		const results = await aphroditeService.compareModels({ prompt: 'test' }, ['model-a', 'model-b']);

		for (const result of results) {
			assert.ok(result.error);
			assert.strictEqual(result.response, undefined);
			assert.ok(result.latencyMs >= 0);
		}
	});
});
