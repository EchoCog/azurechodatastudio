/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ILLMProviderService, LLMProviderConfig, LLMCompletionRequest, LLMRequestTelemetry, APHRODITE_PROVIDER_ID } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import {
	IAphroditeService,
	AphroditeConfig,
	AphroditeCompletionRequest,
	AphroditeCompletionResponse,
	AphroditeStreamToken,
	AphroditeBatchResponse,
	AphroditeEmbeddingResponse,
	AphroditeModelInfo,
	AphroditeEngineStats
} from 'sql/workbench/services/zonecog/common/aphrodite';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { Event } from 'vs/base/common/event';

const FAKE_APHRODITE_CONFIG: AphroditeConfig = {
	baseUrl: 'http://localhost:2242',
	model: 'test-model',
	maxTokens: 2048,
	temperature: 0.7,
	topP: 0.95,
	topK: 40,
	frequencyPenalty: 0,
	presencePenalty: 0,
	timeoutMs: 60000,
	batchingEnabled: true,
	maxBatchSize: 16,
};

/**
 * Minimal fake `IAphroditeService` for exercising `LLMProviderService`'s
 * Aphrodite-routing path without any real network access.
 */
class FakeAphroditeService implements IAphroditeService {
	declare readonly _serviceBrand: undefined;
	readonly onDidReceiveStreamToken = Event.None;
	readonly onDidChangeConnectionStatus = Event.None;
	readonly onDidUpdateStats = Event.None;

	connected = false;
	completeResponse: AphroditeCompletionResponse | undefined;
	streamTokens: AphroditeStreamToken[] = [];
	lastCompleteRequest: AphroditeCompletionRequest | undefined;
	lastStreamRequest: AphroditeCompletionRequest | undefined;

	async initialize(): Promise<void> { }
	isConnected(): boolean { return this.connected; }
	getConfig(): AphroditeConfig { return FAKE_APHRODITE_CONFIG; }
	updateConfig(): void { }

	async complete(request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse> {
		this.lastCompleteRequest = request;
		if (!this.completeResponse) {
			throw new Error('FakeAphroditeService: no stubbed complete() response');
		}
		return this.completeResponse;
	}

	async *streamComplete(request: AphroditeCompletionRequest): AsyncIterable<AphroditeStreamToken> {
		this.lastStreamRequest = request;
		for (const token of this.streamTokens) {
			yield token;
		}
	}

	async batchComplete(): Promise<AphroditeBatchResponse> { throw new Error('not implemented'); }
	async embed(): Promise<AphroditeEmbeddingResponse> { throw new Error('not implemented'); }
	async listModels(): Promise<AphroditeModelInfo[]> { return []; }
	async getCurrentModel(): Promise<AphroditeModelInfo | undefined> { return undefined; }
	async switchModel(): Promise<void> { }
	async getStats(): Promise<AphroditeEngineStats> { throw new Error('not implemented'); }
	async healthCheck(): Promise<boolean> { return this.connected; }
	cancelRequest(): void { }
	cancelAllRequests(): void { }
}

suite('LLM Provider Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let llmService: ILLMProviderService;
	let membraneService: CognitiveMembraneService;
	let aphroditeService: FakeAphroditeService;
	const originalFetch = globalThis.fetch;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		aphroditeService = new FakeAphroditeService();
		instantiationService.stub(IAphroditeService, aphroditeService);

		llmService = instantiationService.createInstance(LLMProviderService);
	});

	teardown(() => {
		membraneService.dispose();
		globalThis.fetch = originalFetch;
	});

	/** Register and activate the Aphrodite provider for a test. */
	function activateAphroditeProvider(): void {
		llmService.registerProvider({
			id: APHRODITE_PROVIDER_ID,
			displayName: 'Aphrodite Engine',
			baseUrl: 'http://localhost:2242',
			model: 'test-model',
			maxContextLength: 4096,
		});
		llmService.setActiveProvider(APHRODITE_PROVIDER_ID);
	}

	/** Register and activate an external SSE-streaming provider for a test. */
	function activateExternalProvider(id: string = 'sse-provider'): void {
		llmService.registerProvider({
			id,
			displayName: 'SSE Provider',
			baseUrl: 'http://localhost:9999',
			model: 'test-model',
			maxContextLength: 2048,
		});
		llmService.setActiveProvider(id);
	}

	/** Build a fetch stub that streams the given raw SSE payload chunks. */
	function stubStreamingFetch(chunks: string[]): void {
		const encoder = new TextEncoder();
		let index = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (index < chunks.length) {
					controller.enqueue(encoder.encode(chunks[index++]));
				} else {
					controller.close();
				}
			},
		});
		globalThis.fetch = (async () => ({ ok: true, status: 200, body }) as unknown as Response) as typeof fetch;
	}

	/** Build a fetch stub whose stream emits one chunk, then errors on the next read. */
	function stubFailingMidStreamFetch(firstChunk: string, failure: Error): void {
		const encoder = new TextEncoder();
		let pullCount = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pullCount++;
				if (pullCount === 1) {
					controller.enqueue(encoder.encode(firstChunk));
				} else {
					controller.error(failure);
				}
			},
		});
		globalThis.fetch = (async () => ({ ok: true, status: 200, body }) as unknown as Response) as typeof fetch;
	}

	// --- Initial State Tests ---

	test('should initialize with built-in fallback provider', () => {
		const providers = llmService.getProviders();
		assert.ok(providers.length >= 1);

		const builtin = providers.find(p => p.id === 'builtin-fallback');
		assert.ok(builtin, 'Should have built-in fallback provider');
		assert.strictEqual(builtin!.displayName, 'Built-in (Rule-Based)');
	});

	test('should have built-in provider as active by default', () => {
		const active = llmService.getActiveProvider();
		assert.strictEqual(active.id, 'builtin-fallback');
	});

	test('should not report external provider as active initially', () => {
		assert.strictEqual(llmService.isExternalProviderActive(), false);
	});

	// --- Provider Registration Tests ---

	test('should register a new provider', () => {
		const config: LLMProviderConfig = {
			id: 'test-provider',
			displayName: 'Test Provider',
			baseUrl: 'http://localhost:8080',
			model: 'test-model',
			maxContextLength: 2048,
		};

		const result = llmService.registerProvider(config);
		assert.strictEqual(result, true);

		const providers = llmService.getProviders();
		const registered = providers.find(p => p.id === 'test-provider');
		assert.ok(registered);
		assert.strictEqual(registered!.displayName, 'Test Provider');
	});

	test('should not register duplicate provider', () => {
		const config: LLMProviderConfig = {
			id: 'duplicate-provider',
			displayName: 'First',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		const first = llmService.registerProvider(config);
		assert.strictEqual(first, true);

		const duplicate: LLMProviderConfig = {
			id: 'duplicate-provider',
			displayName: 'Second',
			baseUrl: 'http://other',
			model: 'other-model',
			maxContextLength: 2048,
		};

		const second = llmService.registerProvider(duplicate);
		assert.strictEqual(second, false);

		// Verify original is unchanged
		const providers = llmService.getProviders();
		const found = providers.find(p => p.id === 'duplicate-provider');
		assert.strictEqual(found!.displayName, 'First');
	});

	test('should unregister a provider', () => {
		const config: LLMProviderConfig = {
			id: 'unregister-me',
			displayName: 'Temporary',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		llmService.registerProvider(config);
		assert.ok(llmService.getProviders().find(p => p.id === 'unregister-me'));

		const result = llmService.unregisterProvider('unregister-me');
		assert.strictEqual(result, true);
		assert.ok(!llmService.getProviders().find(p => p.id === 'unregister-me'));
	});

	test('should not unregister built-in provider', () => {
		const result = llmService.unregisterProvider('builtin-fallback');
		assert.strictEqual(result, false);

		const providers = llmService.getProviders();
		assert.ok(providers.find(p => p.id === 'builtin-fallback'));
	});

	test('should return false when unregistering non-existent provider', () => {
		const result = llmService.unregisterProvider('non-existent');
		assert.strictEqual(result, false);
	});

	test('should fall back to built-in when active provider is unregistered', () => {
		const config: LLMProviderConfig = {
			id: 'active-provider',
			displayName: 'Active',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		llmService.registerProvider(config);
		llmService.setActiveProvider('active-provider');
		assert.strictEqual(llmService.getActiveProvider().id, 'active-provider');

		llmService.unregisterProvider('active-provider');
		assert.strictEqual(llmService.getActiveProvider().id, 'builtin-fallback');
	});

	// --- Active Provider Tests ---

	test('should switch active provider', () => {
		const config: LLMProviderConfig = {
			id: 'switchable',
			displayName: 'Switchable',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		llmService.registerProvider(config);
		const result = llmService.setActiveProvider('switchable');

		assert.strictEqual(result, true);
		assert.strictEqual(llmService.getActiveProvider().id, 'switchable');
		assert.strictEqual(llmService.isExternalProviderActive(), true);
	});

	test('should not switch to non-existent provider', () => {
		const result = llmService.setActiveProvider('non-existent');
		assert.strictEqual(result, false);
		assert.strictEqual(llmService.getActiveProvider().id, 'builtin-fallback');
	});

	test('should switch back to built-in provider', () => {
		const config: LLMProviderConfig = {
			id: 'external',
			displayName: 'External',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		llmService.registerProvider(config);
		llmService.setActiveProvider('external');
		assert.strictEqual(llmService.isExternalProviderActive(), true);

		llmService.setActiveProvider('builtin-fallback');
		assert.strictEqual(llmService.isExternalProviderActive(), false);
	});

	// --- Completion Tests (Built-in Fallback) ---

	test('should complete with built-in provider', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Hello, how are you?',
		};

		const response = await llmService.complete(request);

		assert.ok(response.content);
		assert.strictEqual(response.providerId, 'builtin-fallback');
		assert.strictEqual(response.isFallback, true);
	});

	test('should handle question queries', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'What is data visualization?',
		};

		const response = await llmService.complete(request);

		assert.ok(response.content);
		assert.ok(response.content.includes('Zone-Cog'));
	});

	test('should handle analysis queries', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Please analyze the database performance metrics.',
		};

		const response = await llmService.complete(request);

		assert.ok(response.content);
		assert.ok(response.content.includes('analysis') || response.content.includes('insights'));
	});

	test('should handle request queries', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Can you help me with query optimization?',
		};

		const response = await llmService.complete(request);

		assert.ok(response.content);
		assert.ok(response.content.includes('Zone-Cog') || response.content.includes('request'));
	});

	test('should handle generic statements', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Database connections are important.',
		};

		const response = await llmService.complete(request);

		assert.ok(response.content);
		assert.ok(response.content.includes('Zone-Cog'));
	});

	// --- Event Tests ---

	test('should fire onDidChangeProvider when switching providers', () => {
		const config: LLMProviderConfig = {
			id: 'event-provider',
			displayName: 'Event Provider',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		llmService.registerProvider(config);

		let firedConfig: LLMProviderConfig | undefined;
		llmService.onDidChangeProvider(cfg => { firedConfig = cfg; });

		llmService.setActiveProvider('event-provider');

		assert.ok(firedConfig);
		assert.strictEqual(firedConfig!.id, 'event-provider');
	});

	test('should fire onDidChangeAvailability when registering provider', () => {
		let firedEvent: { providerId: string; available: boolean } | undefined;
		llmService.onDidChangeAvailability(ev => { firedEvent = ev; });

		const config: LLMProviderConfig = {
			id: 'availability-provider',
			displayName: 'Availability Provider',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		llmService.registerProvider(config);

		assert.ok(firedEvent);
		assert.strictEqual(firedEvent!.providerId, 'availability-provider');
		assert.strictEqual(firedEvent!.available, true);
	});

	test('should fire onDidChangeAvailability when unregistering provider', () => {
		const config: LLMProviderConfig = {
			id: 'remove-provider',
			displayName: 'Remove Provider',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 1024,
		};

		llmService.registerProvider(config);

		let firedEvent: { providerId: string; available: boolean } | undefined;
		llmService.onDidChangeAvailability(ev => { firedEvent = ev; });

		llmService.unregisterProvider('remove-provider');

		assert.ok(firedEvent);
		assert.strictEqual(firedEvent!.providerId, 'remove-provider');
		assert.strictEqual(firedEvent!.available, false);
	});

	test('should fire onDidCompleteRequest with telemetry after a completion', async () => {
		let telemetry: LLMRequestTelemetry | undefined;
		llmService.onDidCompleteRequest(t => { telemetry = t; });

		await llmService.complete('telemetry test prompt');

		assert.ok(telemetry, 'telemetry event should have fired');
		assert.strictEqual(telemetry!.providerId, 'builtin-fallback');
		assert.strictEqual(telemetry!.isFallback, true);
		assert.strictEqual(telemetry!.streamed, false);
		assert.ok(telemetry!.latencyMs >= 0);
		assert.ok(telemetry!.timestamp > 0);
	});

	test('should fire onDidCompleteRequest with streamed=true for streaming completions', async () => {
		let telemetry: LLMRequestTelemetry | undefined;
		llmService.onDidCompleteRequest(t => { telemetry = t; });

		await llmService.completeStream({
			systemPrompt: 'system',
			userMessage: 'stream telemetry test',
		}, () => { /* consume tokens */ });

		assert.ok(telemetry, 'telemetry event should have fired');
		assert.strictEqual(telemetry!.streamed, true);
	});

	// --- Provider Configuration Tests ---

	test('should support provider with API key', () => {
		const config: LLMProviderConfig = {
			id: 'api-key-provider',
			displayName: 'API Key Provider',
			baseUrl: 'http://localhost',
			model: 'model',
			maxContextLength: 4096,
			apiKey: 'test-api-key',
		};

		llmService.registerProvider(config);

		const providers = llmService.getProviders();
		const found = providers.find(p => p.id === 'api-key-provider');
		assert.ok(found);
		assert.strictEqual(found!.apiKey, 'test-api-key');
	});

	test('should support provider without API key', () => {
		const config: LLMProviderConfig = {
			id: 'no-key-provider',
			displayName: 'No Key Provider',
			baseUrl: 'http://localhost',
			model: 'local-model',
			maxContextLength: 2048,
		};

		llmService.registerProvider(config);

		const providers = llmService.getProviders();
		const found = providers.find(p => p.id === 'no-key-provider');
		assert.ok(found);
		assert.strictEqual(found!.apiKey, undefined);
	});

	// --- Completion Request Options Tests ---

	test('should accept optional thinking context', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Test query',
			thinkingContext: 'Previous thinking: I considered multiple approaches...',
		};

		const response = await llmService.complete(request);
		assert.ok(response.content);
	});

	test('should accept optional max tokens', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Test query',
			maxTokens: 256,
		};

		const response = await llmService.complete(request);
		assert.ok(response.content);
	});

	test('should accept optional temperature', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Test query',
			temperature: 0.5,
		};

		const response = await llmService.complete(request);
		assert.ok(response.content);
	});

	// --- Circuit Breaker Tests ---

	test('should initialize with circuit closed', () => {
		const config: LLMProviderConfig = {
			id: 'circuit-test-provider',
			displayName: 'Circuit Test',
			baseUrl: 'http://localhost:9999',
			model: 'test',
			maxContextLength: 1024,
		};
		llmService.registerProvider(config);

		const status = llmService.getCircuitBreakerStatus('circuit-test-provider');
		assert.strictEqual(status.isOpen, false);
		assert.strictEqual(status.failureCount, 0);
	});

	test('should be able to reset circuit breaker', () => {
		const config: LLMProviderConfig = {
			id: 'reset-test-provider',
			displayName: 'Reset Test',
			baseUrl: 'http://localhost:9999',
			model: 'test',
			maxContextLength: 1024,
		};
		llmService.registerProvider(config);

		// Reset should not throw
		llmService.resetCircuitBreaker('reset-test-provider');

		const status = llmService.getCircuitBreakerStatus('reset-test-provider');
		assert.strictEqual(status.isOpen, false);
		assert.strictEqual(status.failureCount, 0);
	});

	test('should record membrane activity during completion', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Test membrane activity',
		};

		await llmService.complete(request);

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	// --- Streaming Completion Tests (Built-in Fallback) ---

	test('should stream tokens that reassemble the built-in response', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Please analyze the database performance metrics.',
		};

		const tokens: string[] = [];
		const response = await llmService.completeStream(request, token => { tokens.push(token); });

		assert.ok(tokens.length > 1, 'Should emit more than one token');
		assert.strictEqual(tokens.join(''), response.content);
		assert.strictEqual(response.providerId, 'builtin-fallback');
		assert.strictEqual(response.isFallback, true);
	});

	test('should stream tokens in order before resolving', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'What is data visualization?',
		};

		let tokensAtResolution = -1;
		let tokenCount = 0;
		const response = await llmService.completeStream(request, () => { tokenCount++; });
		tokensAtResolution = tokenCount;

		assert.ok(tokensAtResolution > 0);
		assert.ok(response.content.length > 0);
	});

	test('should record membrane activity during streaming completion', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Test streaming membrane activity',
		};

		await llmService.completeStream(request, () => { });

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	test('should produce the same content streaming as non-streaming for the same query', async () => {
		const request: LLMCompletionRequest = {
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Can you help me with query optimization?',
		};

		const nonStreamed = await llmService.complete(request);

		let streamedContent = '';
		const streamed = await llmService.completeStream(request, token => { streamedContent += token; });

		assert.strictEqual(streamedContent, nonStreamed.content);
		assert.strictEqual(streamed.content, nonStreamed.content);
	});

	// --- Streaming Completion Tests (External SSE Provider) ---

	test('should process a trailing SSE frame with no terminating blank line', async () => {
		activateExternalProvider();
		stubStreamingFetch([
			'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":" world"}}]}',
		]);

		const tokens: string[] = [];
		const response = await llmService.completeStream(
			{ systemPrompt: 'sys', userMessage: 'test' },
			token => { tokens.push(token); }
		);

		assert.strictEqual(tokens.join(''), 'Hello world');
		assert.strictEqual(response.content, 'Hello world');
		assert.strictEqual(response.isFallback, false);
	});

	test('should reject rather than replay a fallback after tokens have already streamed', async () => {
		activateExternalProvider();
		stubFailingMidStreamFetch(
			'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
			new Error('connection reset mid-stream')
		);

		const tokens: string[] = [];
		await assert.rejects(
			llmService.completeStream(
				{ systemPrompt: 'sys', userMessage: 'test' },
				token => { tokens.push(token); }
			)
		);

		assert.deepStrictEqual(tokens, ['Partial']);
	});

	test('should retry a streaming failure that emitted no tokens, then fall back to built-in', async () => {
		activateExternalProvider();
		globalThis.fetch = (async () => { throw new Error('network unreachable'); }) as unknown as typeof fetch;

		const tokens: string[] = [];
		const response = await llmService.completeStream(
			{ systemPrompt: 'sys', userMessage: 'test' },
			token => { tokens.push(token); }
		);

		assert.ok(response.isFallback);
		assert.strictEqual(tokens.join(''), response.content);
	});

	// --- Aphrodite Engine Integration Tests ---

	test('should route completions through Aphrodite when its provider is active and connected', async () => {
		aphroditeService.connected = true;
		aphroditeService.completeResponse = {
			text: 'Aphrodite says hello',
			promptTokens: 12,
			completionTokens: 4,
			totalTokens: 16,
			finishReason: 'stop',
			generationTimeMs: 42,
			model: 'test-model',
		};
		activateAphroditeProvider();

		const response = await llmService.complete({
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Hello, how are you?',
		});

		assert.strictEqual(response.content, 'Aphrodite says hello');
		assert.strictEqual(response.providerId, APHRODITE_PROVIDER_ID);
		assert.strictEqual(response.isFallback, false);
		assert.deepStrictEqual(response.usage, { promptTokens: 12, completionTokens: 4, totalTokens: 16 });
	});

	test('should fold system prompt, thinking context and user message into a single Aphrodite prompt', async () => {
		aphroditeService.connected = true;
		aphroditeService.completeResponse = {
			text: 'ok', promptTokens: 0, completionTokens: 0, totalTokens: 0,
			finishReason: 'stop', generationTimeMs: 1, model: 'test-model',
		};
		activateAphroditeProvider();

		await llmService.complete({
			systemPrompt: 'SYS',
			thinkingContext: 'CTX',
			userMessage: 'USER',
		});

		assert.strictEqual(aphroditeService.lastCompleteRequest?.prompt, 'SYS\n\nCTX\n\nUSER');
	});

	test('should fall back to built-in when Aphrodite provider is active but not connected', async () => {
		aphroditeService.connected = false;
		activateAphroditeProvider();

		const response = await llmService.complete({
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Hello?',
		});

		assert.strictEqual(response.isFallback, true);
		assert.strictEqual(response.providerId, 'builtin-fallback');
	});

	test('should stream tokens through Aphrodite when its provider is active', async () => {
		aphroditeService.connected = true;
		aphroditeService.streamTokens = [
			{ text: 'Hello', finished: false },
			{ text: ' world', finished: true, finishReason: 'stop' },
		];
		activateAphroditeProvider();

		const tokens: string[] = [];
		const response = await llmService.completeStream(
			{ systemPrompt: 'sys', userMessage: 'test' },
			token => { tokens.push(token); }
		);

		assert.strictEqual(tokens.join(''), 'Hello world');
		assert.strictEqual(response.content, 'Hello world');
		assert.strictEqual(response.providerId, APHRODITE_PROVIDER_ID);
		assert.strictEqual(response.isFallback, false);
	});

	test('should fall back to built-in when streaming through a disconnected Aphrodite provider', async () => {
		aphroditeService.connected = false;
		activateAphroditeProvider();

		const tokens: string[] = [];
		const response = await llmService.completeStream(
			{ systemPrompt: 'sys', userMessage: 'test' },
			token => { tokens.push(token); }
		);

		assert.strictEqual(response.isFallback, true);
		assert.strictEqual(tokens.join(''), response.content);
	});

	test('should fall back to built-in when Aphrodite returns an empty completion', async () => {
		aphroditeService.connected = true;
		aphroditeService.completeResponse = {
			text: '', promptTokens: 5, completionTokens: 0, totalTokens: 5,
			finishReason: 'stop', generationTimeMs: 1, model: 'test-model',
		};
		activateAphroditeProvider();

		const response = await llmService.complete({
			systemPrompt: 'You are a helpful assistant.',
			userMessage: 'Hello?',
		});

		assert.strictEqual(response.isFallback, true);
		assert.strictEqual(response.providerId, 'builtin-fallback');
	});

	test('should reset a provider circuit breaker via resetCircuitBreaker', async () => {
		activateExternalProvider();
		globalThis.fetch = (async () => { throw new Error('network unreachable'); }) as unknown as typeof fetch;

		// Drive enough failures to open the circuit.
		for (let i = 0; i < 3; i++) {
			await llmService.complete({ systemPrompt: 'sys', userMessage: 'fail' });
		}
		assert.strictEqual(llmService.getCircuitBreakerStatus('sse-provider').isOpen, true);

		llmService.resetCircuitBreaker('sse-provider');

		const status = llmService.getCircuitBreakerStatus('sse-provider');
		assert.strictEqual(status.isOpen, false);
		assert.strictEqual(status.failureCount, 0);
	});
});
