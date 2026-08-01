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

<<<<<<< HEAD
	// --- Adapters ---

	test('should start with no active adapter', () => {
		assert.strictEqual(aphroditeService.getActiveAdapter(), undefined);
	});

	test('listAdapters should start empty', async () => {
		const adapters = await aphroditeService.listAdapters();
		assert.deepStrictEqual(adapters, []);
	});

	test('loadAdapter should throw when server unavailable', async () => {
		try {
			await aphroditeService.loadAdapter({ id: 'my-adapter', path: '/models/adapters/my-adapter' });
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}

		// A failed load should not register the adapter locally.
		assert.strictEqual(aphroditeService.getActiveAdapter(), undefined);
		assert.deepStrictEqual(await aphroditeService.listAdapters(), []);
	});

	test('unloadAdapter should clear local state even when the network call fails', async () => {
		// Should not throw even though there is no server and nothing was loaded.
		await aphroditeService.unloadAdapter('non-existent-adapter');
		assert.strictEqual(aphroditeService.getActiveAdapter(), undefined);
	});

	// --- Telemetry ---

	test('should start with zeroed telemetry', () => {
		const telemetry = aphroditeService.getTelemetry();
		assert.strictEqual(telemetry.requestCount, 0);
		assert.strictEqual(telemetry.errorCount, 0);
		assert.strictEqual(telemetry.averageLatencyMs, 0);
		assert.strictEqual(telemetry.tokensPerSecond, 0);
		assert.strictEqual(telemetry.errorRate, 0);
		assert.deepStrictEqual(aphroditeService.getTelemetrySamples(), []);
	});

	test('should have onDidUpdateTelemetry event', () => {
		assert.ok(aphroditeService.onDidUpdateTelemetry);

		const disposable = aphroditeService.onDidUpdateTelemetry(() => { });

		disposable.dispose();
	});

	test('complete should record a telemetry sample and fire onDidUpdateTelemetry on failure', async () => {
		let fired: ReturnType<typeof aphroditeService.getTelemetry> | undefined;
		aphroditeService.onDidUpdateTelemetry(summary => fired = summary);

		try {
			await aphroditeService.complete({ prompt: 'Hello, world!' });
		} catch {
			// Expected: no server available.
		}

		const telemetry = aphroditeService.getTelemetry();
		assert.strictEqual(telemetry.requestCount, 1);
		assert.strictEqual(telemetry.errorCount, 1);
		assert.strictEqual(telemetry.errorRate, 1);
		assert.ok(fired);
		assert.strictEqual(fired!.requestCount, 1);

		const samples = aphroditeService.getTelemetrySamples();
		assert.strictEqual(samples.length, 1);
		assert.strictEqual(samples[0].success, false);
		assert.strictEqual(samples[0].model, 'default');
	});

	test('complete should try each fallback model and throw an error mentioning all attempted models', async () => {
		aphroditeService.updateConfig({ model: 'primary-model', fallbackModels: ['fallback-a', 'fallback-b'] });

		try {
			await aphroditeService.complete({ prompt: 'Hello, world!' });
			assert.fail('Should have thrown');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			assert.ok(message.includes('primary-model'));
			assert.ok(message.includes('fallback-a'));
			assert.ok(message.includes('fallback-b'));
		}

		// One telemetry sample should have been recorded per attempted model.
		const samples = aphroditeService.getTelemetrySamples();
		assert.strictEqual(samples.length, 3);
		assert.deepStrictEqual(samples.map(s => s.model), ['primary-model', 'fallback-a', 'fallback-b']);
		assert.ok(samples.every(s => s.success === false));

		const telemetry = aphroditeService.getTelemetry();
		assert.strictEqual(telemetry.requestCount, 3);
		assert.strictEqual(telemetry.errorCount, 3);
	});

	test('embed should not record completion telemetry', async () => {
		try {
			await aphroditeService.complete({ prompt: 'first' });
		} catch { /* expected: offline */ }
		try {
			await aphroditeService.embed({ texts: ['second'] });
		} catch { /* expected: offline, embed does not record telemetry */ }

		// Only the complete() call above should have produced a sample.
		const telemetry = aphroditeService.getTelemetry();
		assert.strictEqual(telemetry.requestCount, 1);
		assert.strictEqual(telemetry.errorCount, 1);
	});

	test('streamComplete should record a telemetry sample on failure', async () => {
		try {
			for await (const _token of aphroditeService.streamComplete({ prompt: 'Hello, world!' })) {
				// no-op: no server available, so this should never yield
			}
		} catch {
			// Expected: no server available.
		}

		const telemetry = aphroditeService.getTelemetry();
		assert.strictEqual(telemetry.requestCount, 1);
		assert.strictEqual(telemetry.errorCount, 1);
	});

	// --- Adapter routing, streaming model field, and cancellation ---
	// (regression coverage for Cursor Bugbot findings on PR #90)

	function withMockFetch<T>(handler: (url: string, options: any) => any, fn: () => Promise<T>): Promise<T> {
		const original = (globalThis as any).fetch;
		(globalThis as any).fetch = async (url: string, options: any) => handler(url, options);
		return fn().finally(() => {
			(globalThis as any).fetch = original;
		});
	}

	test('loadAdapter should call the vLLM-compatible /v1/load_lora_adapter endpoint', async () => {
		const calls: { url: string; body: any }[] = [];
		await withMockFetch(
			(url, options) => {
				calls.push({ url, body: JSON.parse(options.body) });
				return { ok: true, json: async () => ({}) };
			},
			() => aphroditeService.loadAdapter({ id: 'my-adapter', path: '/models/my-adapter' })
		);

		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].url.endsWith('/v1/load_lora_adapter'));
		assert.deepStrictEqual(calls[0].body, { lora_name: 'my-adapter', lora_path: '/models/my-adapter' });
	});

	test('unloadAdapter should call the vLLM-compatible /v1/unload_lora_adapter endpoint', async () => {
		const calls: { url: string; body: any }[] = [];
		await withMockFetch(
			(url, options) => {
				calls.push({ url, body: JSON.parse(options.body) });
				return { ok: true, json: async () => ({}) };
			},
			() => aphroditeService.unloadAdapter('my-adapter')
		);

		assert.strictEqual(calls.length, 1);
		assert.ok(calls[0].url.endsWith('/v1/unload_lora_adapter'));
		assert.deepStrictEqual(calls[0].body, { lora_name: 'my-adapter' });
	});

	test('complete should route through the active adapter as the model field', async () => {
		await withMockFetch(
			() => ({ ok: true, json: async () => ({}) }),
			() => aphroditeService.loadAdapter({ id: 'my-adapter', path: '/models/my-adapter' })
		);
		assert.strictEqual(aphroditeService.getActiveAdapter()?.id, 'my-adapter');

		const calls: any[] = [];
		await withMockFetch(
			(_url, options) => {
				calls.push(JSON.parse(options.body));
				return {
					ok: true,
					json: async () => ({ choices: [{ text: 'hi', finish_reason: 'stop' }], usage: {}, model: 'my-adapter' }),
				};
			},
			() => aphroditeService.complete({ prompt: 'hello' })
		);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].model, 'my-adapter');
	});

	test('streamComplete should include the resolved model in the request body', async () => {
		const calls: any[] = [];
		try {
			await withMockFetch(
				(_url, options) => {
					calls.push(JSON.parse(options.body));
					return { ok: false, status: 500 };
				},
				async () => {
					for await (const _token of aphroditeService.streamComplete({ prompt: 'hello' })) {
						// no-op: the mock returns a non-ok response before any tokens
					}
				}
			);
		} catch {
			// Expected: mock fetch returns a non-ok response.
		}

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].model, 'default');
	});

	test('complete should stop immediately on cancellation instead of trying fallback models', async () => {
		aphroditeService.updateConfig({ fallbackModels: ['fallback-a', 'fallback-b'] });

		const requestId = 'cancel-me';
		const completePromise = withMockFetch(
			(_url, options) => new Promise((_resolve, reject) => {
				const signal: AbortSignal | undefined = options?.signal;
				signal?.addEventListener('abort', () => {
					const err = new Error('The operation was aborted.');
					err.name = 'AbortError';
					reject(err);
				});
			}),
			() => aphroditeService.complete({ prompt: 'hello', requestId })
		);

		aphroditeService.cancelRequest(requestId);

		try {
			await completePromise;
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error instanceof Error);
			assert.strictEqual((error as Error).name, 'AbortError');
		}

		// Only the cancelled attempt should have been recorded - the fallback
		// chain must not have been tried after cancellation.
		const samples = aphroditeService.getTelemetrySamples();
		assert.strictEqual(samples.length, 1);
=======
	suite('telemetry', () => {
		test('should start with no telemetry recorded', () => {
			assert.strictEqual(aphroditeService.getTelemetry().length, 0);
			const summary = aphroditeService.getTelemetrySummary();
			assert.strictEqual(summary.totalRequests, 0);
			assert.strictEqual(summary.successRate, 0);
		});

		test('should record a failed telemetry entry when complete() throws', async () => {
			try {
				await aphroditeService.complete({ prompt: 'test' });
			} catch {
				// expected: no server available
			}

			const telemetry = aphroditeService.getTelemetry();
			assert.strictEqual(telemetry.length, 1);
			assert.strictEqual(telemetry[0].success, false);
			assert.ok(telemetry[0].errorMessage);
			assert.strictEqual(telemetry[0].model, 'default');
		});

		test('should fire onDidRecordTelemetry on a completion attempt', async () => {
			let fired = false;
			aphroditeService.onDidRecordTelemetry(() => { fired = true; });

			try {
				await aphroditeService.complete({ prompt: 'test' });
			} catch {
				// expected
			}

			assert.strictEqual(fired, true);
		});

		test('getTelemetrySummary should aggregate failures', async () => {
			try { await aphroditeService.complete({ prompt: 'one' }); } catch { /* expected */ }
			try { await aphroditeService.complete({ prompt: 'two' }); } catch { /* expected */ }

			const summary = aphroditeService.getTelemetrySummary();
			assert.strictEqual(summary.totalRequests, 2);
			assert.strictEqual(summary.errorCount, 2);
			assert.strictEqual(summary.successCount, 0);
			assert.strictEqual(summary.successRate, 0);
			assert.ok(summary.avgLatencyMs >= 0);
			assert.ok('default' in summary.byModel);
			assert.strictEqual(summary.byModel['default'].requests, 2);
		});

		test('getTelemetry should return most-recent-first and respect limit', async () => {
			try { await aphroditeService.complete({ prompt: 'one', requestId: 'r1' }); } catch { /* expected */ }
			try { await aphroditeService.complete({ prompt: 'two', requestId: 'r2' }); } catch { /* expected */ }

			const all = aphroditeService.getTelemetry();
			assert.strictEqual(all[0].requestId, 'r2');
			assert.strictEqual(all[1].requestId, 'r1');

			const limited = aphroditeService.getTelemetry(1);
			assert.strictEqual(limited.length, 1);
			assert.strictEqual(limited[0].requestId, 'r2');
		});

		test('clearTelemetry should empty the telemetry log', async () => {
			try { await aphroditeService.complete({ prompt: 'test' }); } catch { /* expected */ }
			assert.ok(aphroditeService.getTelemetry().length > 0);

			aphroditeService.clearTelemetry();

			assert.strictEqual(aphroditeService.getTelemetry().length, 0);
			assert.strictEqual(aphroditeService.getTelemetrySummary().totalRequests, 0);
		});
	});

	suite('fallback chain', () => {
		test('should start with an empty fallback chain', () => {
			assert.deepStrictEqual(aphroditeService.getFallbackChain(), []);
		});

		test('setFallbackChain should update the configured chain', () => {
			aphroditeService.setFallbackChain(['model-b', 'model-c']);
			assert.deepStrictEqual(aphroditeService.getFallbackChain(), ['model-b', 'model-c']);
		});

		test('completeWithFallback should try every model in the chain and then throw', async () => {
			aphroditeService.setFallbackChain(['model-b', 'model-c']);

			try {
				await aphroditeService.completeWithFallback({ prompt: 'test' });
				assert.fail('Should have thrown after exhausting the fallback chain');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				assert.ok(message.includes('default'));
				assert.ok(message.includes('model-b'));
				assert.ok(message.includes('model-c'));
			}

			// One telemetry entry per attempted model.
			const telemetry = aphroditeService.getTelemetry();
			assert.strictEqual(telemetry.length, 3);
		});

		test('completeWithFallback should not duplicate the primary model in the chain', async () => {
			aphroditeService.setFallbackChain(['default', 'model-b']);

			try {
				await aphroditeService.completeWithFallback({ prompt: 'test' });
			} catch {
				// expected
			}

			const telemetry = aphroditeService.getTelemetry();
			assert.strictEqual(telemetry.length, 2);
		});

		test('cancelling a request should stop the fallback chain instead of trying the next model', async () => {
			aphroditeService.setFallbackChain(['model-b', 'model-c']);

			const promise = aphroditeService.completeWithFallback({ prompt: 'test', requestId: 'cancel-me' });
			// The synchronous portion of _completeInternal() (including pending-request
			// registration) runs before the underlying fetch call suspends, so this
			// reliably cancels the in-flight attempt rather than racing it.
			aphroditeService.cancelRequest('cancel-me');

			try {
				await promise;
				assert.fail('Should have thrown');
			} catch (error) {
				assert.ok(error);
			}

			// Cancellation must end the whole operation: only the aborted attempt is
			// recorded, the fallback chain must not have been walked further.
			const telemetry = aphroditeService.getTelemetry();
			assert.strictEqual(telemetry.length, 1);
			assert.strictEqual(telemetry[0].model, 'default');
			assert.strictEqual(telemetry[0].success, false);
		});
	});

	suite('LoRA adapters', () => {
		test('should start with no adapters loaded', () => {
			assert.deepStrictEqual(aphroditeService.listAdapters(), []);
		});

		test('loadAdapter should throw when server unavailable and not register the adapter', async () => {
			try {
				await aphroditeService.loadAdapter('my-adapter', '/models/my-adapter');
				assert.fail('Should have thrown');
			} catch (error) {
				assert.ok(error);
			}

			assert.deepStrictEqual(aphroditeService.listAdapters(), []);
		});

		test('should have onDidChangeAdapters event', () => {
			assert.ok(aphroditeService.onDidChangeAdapters);
			const disposable = aphroditeService.onDidChangeAdapters(() => { });
			disposable.dispose();
		});
	});

	suite('A/B testing', () => {
		test('startABTest should throw with fewer than 2 variants', () => {
			assert.throws(() => aphroditeService.startABTest({
				testId: 'single-variant',
				variants: [{ variantId: 'a', model: 'model-a', weight: 1 }],
			}));
		});

		test('startABTest should activate a test with 2+ variants', () => {
			aphroditeService.startABTest({
				testId: 'ab-1',
				variants: [
					{ variantId: 'a', model: 'model-a', weight: 1 },
					{ variantId: 'b', model: 'model-b', weight: 1 },
				],
			});

			assert.strictEqual(aphroditeService.isABTestActive('ab-1'), true);
		});

		test('stopABTest should deactivate a running test', () => {
			aphroditeService.startABTest({
				testId: 'ab-2',
				variants: [
					{ variantId: 'a', model: 'model-a', weight: 1 },
					{ variantId: 'b', model: 'model-b', weight: 1 },
				],
			});

			aphroditeService.stopABTest('ab-2');

			assert.strictEqual(aphroditeService.isABTestActive('ab-2'), false);
		});

		test('isABTestActive should be false for an unknown test', () => {
			assert.strictEqual(aphroditeService.isABTestActive('never-started'), false);
		});

		test('completeViaABTest should route through a variant and record attributed telemetry', async () => {
			aphroditeService.startABTest({
				testId: 'ab-3',
				variants: [
					{ variantId: 'a', model: 'model-a', weight: 1 },
					{ variantId: 'b', model: 'model-b', weight: 1 },
				],
			});

			try {
				await aphroditeService.completeViaABTest('ab-3', { prompt: 'test' });
			} catch {
				// expected: no server available
			}

			const results = aphroditeService.getABTestResults('ab-3');
			assert.strictEqual(results.length, 2);
			const totalRequests = results.reduce((sum, r) => sum + r.requestCount, 0);
			assert.strictEqual(totalRequests, 1);
			for (const result of results) {
				assert.ok(['model-a', 'model-b'].includes(result.model));
			}
		});

		test('completeViaABTest should fall back to complete() when the test is inactive', async () => {
			try {
				await aphroditeService.completeViaABTest('never-started', { prompt: 'test', requestId: 'inactive-test-req' });
			} catch {
				// expected
			}

			const telemetry = aphroditeService.getTelemetry();
			assert.strictEqual(telemetry[0].requestId, 'inactive-test-req');
			assert.strictEqual(telemetry[0].model, 'default');
			assert.strictEqual(telemetry[0].variantId, undefined);
		});

		test('getABTestResults should return an empty array for an unknown test', () => {
			assert.deepStrictEqual(aphroditeService.getABTestResults('unknown'), []);
		});

		test('results should not leak across tests that reuse variant IDs', async () => {
			// Both tests use variant IDs 'a'/'b'; attribution must be per-test.
			aphroditeService.startABTest({
				testId: 'test-x',
				variants: [
					{ variantId: 'a', model: 'x-model-a', weight: 1 },
					{ variantId: 'b', model: 'x-model-b', weight: 1 },
				],
			});
			aphroditeService.startABTest({
				testId: 'test-y',
				variants: [
					{ variantId: 'a', model: 'y-model-a', weight: 1 },
					{ variantId: 'b', model: 'y-model-b', weight: 1 },
				],
			});

			try { await aphroditeService.completeViaABTest('test-x', { prompt: 'one' }); } catch { /* expected */ }
			try { await aphroditeService.completeViaABTest('test-x', { prompt: 'two' }); } catch { /* expected */ }
			try { await aphroditeService.completeViaABTest('test-y', { prompt: 'three' }); } catch { /* expected */ }

			const xTotal = aphroditeService.getABTestResults('test-x').reduce((sum, r) => sum + r.requestCount, 0);
			const yTotal = aphroditeService.getABTestResults('test-y').reduce((sum, r) => sum + r.requestCount, 0);

			assert.strictEqual(xTotal, 2, 'test-x should only count its own requests');
			assert.strictEqual(yTotal, 1, 'test-y should only count its own requests');
		});

		test('telemetry should carry the routing testId', async () => {
			aphroditeService.startABTest({
				testId: 'test-z',
				variants: [
					{ variantId: 'a', model: 'z-model-a', weight: 1 },
					{ variantId: 'b', model: 'z-model-b', weight: 1 },
				],
			});

			try { await aphroditeService.completeViaABTest('test-z', { prompt: 'test' }); } catch { /* expected */ }

			const entry = aphroditeService.getTelemetry(1)[0];
			assert.strictEqual(entry.testId, 'test-z');
			assert.ok(['a', 'b'].includes(entry.variantId!));
		});

		test('restarting a test should exclude the previous run\'s requests', async () => {
			const config = {
				testId: 'test-restart',
				variants: [
					{ variantId: 'a', model: 'r-model-a', weight: 1 },
					{ variantId: 'b', model: 'r-model-b', weight: 1 },
				],
			};

			aphroditeService.startABTest(config);
			try { await aphroditeService.completeViaABTest('test-restart', { prompt: 'before' }); } catch { /* expected */ }
			assert.strictEqual(
				aphroditeService.getABTestResults('test-restart').reduce((sum, r) => sum + r.requestCount, 0), 1);

			// Ensure the restart lands on a strictly later millisecond than the
			// request above, so the run boundary is unambiguous.
			await new Promise(resolve => setTimeout(resolve, 5));

			// Restart: prior requests belong to the previous run, not this one.
			aphroditeService.startABTest(config);

			assert.strictEqual(
				aphroditeService.getABTestResults('test-restart').reduce((sum, r) => sum + r.requestCount, 0), 0);
		});
	});

	suite('configurable LoRA endpoints', () => {
		test('should default to the vLLM-compatible adapter paths', () => {
			const config = aphroditeService.getConfig();
			assert.strictEqual(config.loraLoadPath, '/v1/load_lora_adapter');
			assert.strictEqual(config.loraUnloadPath, '/v1/unload_lora_adapter');
		});

		test('should allow overriding the adapter paths for forks that differ', () => {
			aphroditeService.updateConfig({
				loraLoadPath: '/v1/lora/load',
				loraUnloadPath: '/v1/lora/unload',
			});

			const config = aphroditeService.getConfig();
			assert.strictEqual(config.loraLoadPath, '/v1/lora/load');
			assert.strictEqual(config.loraUnloadPath, '/v1/lora/unload');
		});
>>>>>>> origin/main
	});
});
