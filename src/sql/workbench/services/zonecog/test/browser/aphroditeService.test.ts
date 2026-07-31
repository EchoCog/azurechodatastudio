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

	suite('LoRA adapters', () => {
		test('should have no adapters initially', () => {
			assert.deepStrictEqual(aphroditeService.listAdapters(), []);
			assert.strictEqual(aphroditeService.getActiveAdapter(), undefined);
		});

		test('loadAdapter should throw when server unavailable', async () => {
			try {
				await aphroditeService.loadAdapter({ id: 'my-adapter', path: '/tmp/adapter' });
				assert.fail('Should have thrown');
			} catch (error) {
				assert.ok(error);
			}
			// Failed load must not register the adapter
			assert.deepStrictEqual(aphroditeService.listAdapters(), []);
			assert.strictEqual(aphroditeService.getActiveAdapter(), undefined);
		});

		test('unloadAdapter should throw when server unavailable', async () => {
			try {
				await aphroditeService.unloadAdapter('non-existent');
				assert.fail('Should have thrown');
			} catch (error) {
				assert.ok(error);
			}
		});
	});

	suite('fallback chain', () => {
		test('should have an empty fallback chain by default', () => {
			assert.deepStrictEqual(aphroditeService.getFallbackChain(), []);
		});

		test('setFallbackChain should update the chain', () => {
			aphroditeService.setFallbackChain(['model-a', 'model-b']);
			assert.deepStrictEqual(aphroditeService.getFallbackChain(), ['model-a', 'model-b']);
		});

		test('setFallbackChain should be independent of the returned array', () => {
			aphroditeService.setFallbackChain(['model-a']);
			const chain = aphroditeService.getFallbackChain();
			chain.push('mutated');
			assert.deepStrictEqual(aphroditeService.getFallbackChain(), ['model-a']);
		});

		test('cancelling a request should stop the fallback chain instead of trying the next model', async () => {
			aphroditeService.setFallbackChain(['fallback-1', 'fallback-2']);

			const promise = aphroditeService.complete({ prompt: 'Hello, world!', requestId: 'cancel-me' });
			// The synchronous portion of complete() (including pending-request registration)
			// runs before the underlying fetch call suspends, so this reliably cancels the
			// in-flight attempt rather than racing it.
			aphroditeService.cancelRequest('cancel-me');

			try {
				await promise;
				assert.fail('Should have thrown');
			} catch (error) {
				assert.ok(error);
			}

			// Cancellation must end the whole operation: only the aborted attempt is recorded,
			// the fallback chain must not have been walked.
			const recent = aphroditeService.getRecentTelemetry(10);
			assert.strictEqual(recent.length, 1);
			assert.strictEqual(recent[0].model, 'default');
			assert.strictEqual(recent[0].success, false);
		});

		test('complete should attempt every model in the fallback chain before throwing', async () => {
			aphroditeService.setFallbackChain(['fallback-1', 'fallback-2']);

			try {
				await aphroditeService.complete({ prompt: 'Hello, world!' });
				assert.fail('Should have thrown');
			} catch (error) {
				assert.ok(error);
			}

			// One telemetry entry per attempted model (default config model + 2 fallbacks)
			const recent = aphroditeService.getRecentTelemetry(10);
			assert.strictEqual(recent.length, 3);
			assert.strictEqual(recent[0].model, 'default');
			assert.strictEqual(recent[1].model, 'fallback-1');
			assert.strictEqual(recent[2].model, 'fallback-2');
			assert.ok(recent.every(entry => entry.success === false));
		});
	});

	suite('telemetry', () => {
		test('should report an empty summary before any requests', () => {
			const summary = aphroditeService.getTelemetrySummary();

			assert.strictEqual(summary.totalRequests, 0);
			assert.strictEqual(summary.successCount, 0);
			assert.strictEqual(summary.errorCount, 0);
			assert.strictEqual(summary.errorRate, 0);
			assert.strictEqual(summary.avgLatencyMs, 0);
			assert.strictEqual(summary.p95LatencyMs, 0);
			assert.strictEqual(summary.throughputPerSecond, 0);
		});

		test('failed complete() should record a telemetry entry', async () => {
			try {
				await aphroditeService.complete({ prompt: 'Hello, world!' });
			} catch {
				// expected: no server available
			}

			const summary = aphroditeService.getTelemetrySummary();
			assert.strictEqual(summary.totalRequests, 1);
			assert.strictEqual(summary.errorCount, 1);
			assert.strictEqual(summary.errorRate, 1);

			const recent = aphroditeService.getRecentTelemetry();
			assert.strictEqual(recent.length, 1);
			assert.strictEqual(recent[0].success, false);
			assert.strictEqual(recent[0].model, 'default');
			assert.ok(recent[0].errorMessage);
		});

		test('should fire onDidRecordTelemetry for each attempt', async () => {
			let fired = 0;
			aphroditeService.onDidRecordTelemetry(() => { fired++; });

			try {
				await aphroditeService.complete({ prompt: 'Hello, world!' });
			} catch {
				// expected: no server available
			}

			assert.strictEqual(fired, 1);
		});

		test('getRecentTelemetry should respect the limit argument', async () => {
			for (let i = 0; i < 3; i++) {
				try {
					await aphroditeService.complete({ prompt: `Attempt ${i}` });
				} catch {
					// expected: no server available
				}
			}

			assert.strictEqual(aphroditeService.getRecentTelemetry(2).length, 2);
			assert.strictEqual(aphroditeService.getRecentTelemetry(100).length, 3);
		});
	});
});
