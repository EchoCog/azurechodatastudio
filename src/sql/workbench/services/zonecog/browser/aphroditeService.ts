/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	IAphroditeService,
	AphroditeConfig,
	AphroditeStreamToken,
	AphroditeStreamTokenWithTiming,
	AphroditeCompletionRequest,
	AphroditeCompletionResponse,
	AphroditeBatchRequest,
	AphroditeBatchResponse,
	AphroditeEmbeddingRequest,
	AphroditeEmbeddingResponse,
	AphroditeModelInfo,
	AphroditeEngineStats,
	AphroditeAdapterInfo,
	AphroditeRequestTelemetry,
	AphroditeTelemetrySummary,
	AphroditeABTestConfig,
	AphroditeABTestVariant,
	AphroditeABTestResult,
	LoRAAdapterInfo,
	AphroditePerformanceMetrics,
	ABTestConfig,
	ABTestVariant,
	ABTestResults,
	ModelFallbackConfig,
	ModelFallbackState,
	StructuredOutputConfig,
	PromptCacheStats,
	PromptCacheEntry,
	SpeculativeDecodingConfig,
} from 'sql/workbench/services/zonecog/common/aphrodite';
import { ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';

/**
 * Default Aphrodite configuration.
 */
const DEFAULT_CONFIG: AphroditeConfig = {
	baseUrl: 'http://localhost:2242',
	apiKey: undefined,
	model: 'default',
	maxTokens: 2048,
	temperature: 0.7,
	topP: 0.95,
	topK: 40,
	frequencyPenalty: 0.0,
	presencePenalty: 0.0,
	timeoutMs: 60000,
	batchingEnabled: true,
	maxBatchSize: 16,
	loraLoadPath: '/v1/load_lora_adapter',
	loraUnloadPath: '/v1/unload_lora_adapter',
};

/** Maximum telemetry history entries to retain. */
const MAX_TELEMETRY_HISTORY = 1000;

/** Default performance metrics window in seconds. */
const DEFAULT_METRICS_WINDOW_SECONDS = 300;

/** Maximum prompt cache entries. */
const MAX_PROMPT_CACHE_ENTRIES = 100;

/**
 * Aphrodite Engine Service Implementation.
 * Provides streaming LLM inference via the Aphrodite engine with enhanced
 * model management, LoRA adapters, performance telemetry, A/B testing,
 * model fallback chains, structured output, prompt caching, and speculative decoding.
 */
export class AphroditeService extends Disposable implements IAphroditeService {
	readonly _serviceBrand: undefined;

	private _config: AphroditeConfig;
	private _connected: boolean = false;
	private _pendingRequests: Map<string, AbortController> = new Map();
	private _requestIdCounter: number = 0;

	private static readonly _MAX_TELEMETRY = 500;
	private _adapters: Map<string, AphroditeAdapterInfo> = new Map();
	private _telemetry: AphroditeRequestTelemetry[] = [];
	private _fallbackChain: string[] = [];
	private _abTests: Map<string, { config: AphroditeABTestConfig; active: boolean; startedAt: number }> = new Map();

	// Extended LoRA adapter state
	private _currentAdapter: LoRAAdapterInfo | undefined;
	private _availableAdapters: LoRAAdapterInfo[] = [];

	// Extended A/B testing state
	private _activeABTest: ABTestConfig | undefined;
	private _abTestTelemetry: Map<string, AphroditeRequestTelemetry[]> = new Map();

	// Extended model fallback state
	private _fallbackConfig: ModelFallbackConfig | undefined;
	private _fallbackState: ModelFallbackState = {
		activeModel: 'default',
		usingFallback: false,
		isUsingFallback: false,
		primaryFailureCount: 0,
		consecutiveFailures: 0,
		currentFallbackIndex: 0,
	};

	// Prompt cache
	private _promptCache: Map<string, PromptCacheEntry> = new Map();
	private _promptCacheHits: number = 0;
	private _promptCacheMisses: number = 0;

	// Speculative decoding config
	private _speculativeConfig: SpeculativeDecodingConfig | undefined;

	private readonly _onDidReceiveStreamToken = this._register(new Emitter<AphroditeStreamToken>());
	readonly onDidReceiveStreamToken: Event<AphroditeStreamToken> = this._onDidReceiveStreamToken.event;

	private readonly _onDidReceiveStreamTokenWithTiming = this._register(new Emitter<AphroditeStreamTokenWithTiming>());
	readonly onDidReceiveStreamTokenWithTiming: Event<AphroditeStreamTokenWithTiming> = this._onDidReceiveStreamTokenWithTiming.event;

	private readonly _onDidChangeConnectionStatus = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionStatus: Event<boolean> = this._onDidChangeConnectionStatus.event;

	private readonly _onDidUpdateStats = this._register(new Emitter<AphroditeEngineStats>());
	readonly onDidUpdateStats: Event<AphroditeEngineStats> = this._onDidUpdateStats.event;

	private readonly _onDidRecordTelemetry = this._register(new Emitter<AphroditeRequestTelemetry>());
	readonly onDidRecordTelemetry: Event<AphroditeRequestTelemetry> = this._onDidRecordTelemetry.event;

	private readonly _onDidChangeAdapters = this._register(new Emitter<AphroditeAdapterInfo[]>());
	readonly onDidChangeAdapters: Event<AphroditeAdapterInfo[]> = this._onDidChangeAdapters.event;

	private readonly _onDidChangeAdapter = this._register(new Emitter<LoRAAdapterInfo | undefined>());
	readonly onDidChangeAdapter: Event<LoRAAdapterInfo | undefined> = this._onDidChangeAdapter.event;

	private readonly _onDidChangeFallbackState = this._register(new Emitter<ModelFallbackState>());
	readonly onDidChangeFallbackState: Event<ModelFallbackState> = this._onDidChangeFallbackState.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this._config = { ...DEFAULT_CONFIG };
		this.logService.info('[AphroditeService] Initialized with default config');
	}

	async initialize(config: Partial<AphroditeConfig>): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		this._config = { ...this._config, ...config };
		this.logService.info(`[AphroditeService] Initializing with config: ${JSON.stringify(this._config)}`);

		// Test connection
		try {
			const healthy = await this.healthCheck();
			this._connected = healthy;
			this._onDidChangeConnectionStatus.fire(this._connected);

			if (this._connected) {
				this.logService.info('[AphroditeService] Successfully connected to Aphrodite engine');
			} else {
				this.logService.warn('[AphroditeService] Aphrodite engine not available');
			}
		} catch (error) {
			this.logService.error(`[AphroditeService] Connection failed: ${error}`);
			this._connected = false;
			this._onDidChangeConnectionStatus.fire(false);
		}
	}

	isConnected(): boolean {
		return this._connected;
	}

	getConfig(): AphroditeConfig {
		return { ...this._config };
	}

	updateConfig(config: Partial<AphroditeConfig>): void {
		this._config = { ...this._config, ...config };
		this.logService.info('[AphroditeService] Config updated');
	}

	async complete(request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse> {
		return this._completeInternal(request);
	}

	/**
	 * Shared completion implementation. `modelOverride` lets callers (the
	 * fallback chain and A/B test routing) target a specific model without
	 * mutating the service's persistent configuration; `testId`/`variantId`
	 * attribute the resulting telemetry entry to an A/B test variant.
	 */
	private async _completeInternal(request: AphroditeCompletionRequest, modelOverride?: string, testId?: string, variantId?: string): Promise<AphroditeCompletionResponse> {
		this.membraneService.recordActivity('cerebral');
		const requestId = request.requestId ?? this._generateRequestId();
		const model = modelOverride ?? this._config.model;
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);

		const startTime = Date.now();

		try {
			const response = await this._makeRequest('/v1/completions', {
				model,
				prompt: request.prompt,
				max_tokens: request.maxTokens ?? this._config.maxTokens,
				temperature: request.temperature ?? this._config.temperature,
				top_p: this._config.topP,
				top_k: this._config.topK,
				frequency_penalty: this._config.frequencyPenalty,
				presence_penalty: this._config.presencePenalty,
				stop: request.stopSequences,
				stream: false,
			}, abortController.signal);

			const generationTimeMs = Date.now() - startTime;
			this._pendingRequests.delete(requestId);

			const result: AphroditeCompletionResponse = {
				text: response.choices[0]?.text ?? '',
				promptTokens: response.usage?.prompt_tokens ?? 0,
				completionTokens: response.usage?.completion_tokens ?? 0,
				totalTokens: response.usage?.total_tokens ?? 0,
				finishReason: response.choices[0]?.finish_reason ?? 'stop',
				generationTimeMs,
				model: response.model ?? model,
			};

			this._recordTelemetry({
				requestId,
				model: result.model,
				testId,
				variantId,
				latencyMs: generationTimeMs,
				promptTokens: result.promptTokens,
				completionTokens: result.completionTokens,
				success: true,
				timestamp: Date.now(),
			});

			return result;
		} catch (error) {
			this._pendingRequests.delete(requestId);
			this._recordTelemetry({
				requestId,
				model,
				testId,
				variantId,
				latencyMs: Date.now() - startTime,
				promptTokens: 0,
				completionTokens: 0,
				success: false,
				errorMessage: error instanceof Error ? error.message : String(error),
				timestamp: Date.now(),
			});
			throw error;
		}
	}

	async completeWithFallback(request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse> {
		const chain = [this._config.model, ...this._fallbackChain.filter(m => m !== this._config.model)];
		const errors: string[] = [];

		for (const model of chain) {
			try {
				return await this._completeInternal(request, model);
			} catch (error) {
				errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		throw new Error(`All models in fallback chain failed: ${errors.join('; ')}`);
	}

	setFallbackChain(modelIds: string[]): void {
		this._fallbackChain = [...modelIds];
		this.logService.info(`[AphroditeService] Fallback chain set: ${modelIds.join(' -> ') || '(empty)'}`);
	}

	getFallbackChain(): string[] {
		return [...this._fallbackChain];
	}

	/**
	 * Complete with automatic fallback chain (extended, uses ModelFallbackConfig).
	 */
	private async _completeWithFallback(
		request: AphroditeCompletionRequest,
		model: string,
		signal: AbortSignal,
		config: AphroditeConfig
	): Promise<AphroditeCompletionResponse> {
		const modelsToTry = this._getModelsToTry(model);

		let lastError: Error | undefined;
		for (const tryModel of modelsToTry) {
			try {
				const response = await this._makeRequest('/v1/completions', {
					prompt: request.prompt,
					model: tryModel,
					max_tokens: request.maxTokens ?? config.maxTokens,
					temperature: request.temperature ?? config.temperature,
					top_p: config.topP,
					top_k: config.topK,
					frequency_penalty: config.frequencyPenalty,
					presence_penalty: config.presencePenalty,
					stop: request.stopSequences,
					stream: false,
				}, signal);

				const generationTimeMs = Date.now();

				return {
					text: response.choices[0]?.text ?? '',
					promptTokens: response.usage?.prompt_tokens ?? 0,
					completionTokens: response.usage?.completion_tokens ?? 0,
					totalTokens: response.usage?.total_tokens ?? 0,
					finishReason: response.choices[0]?.finish_reason ?? 'stop',
					generationTimeMs,
					model: response.model ?? tryModel,
				};
			} catch (err) {
				lastError = err as Error;
				this.logService.warn(`[AphroditeService] Model ${tryModel} failed, trying next...`);
			}
		}

		throw lastError ?? new Error('All models failed');
	}

	/**
	 * Get the list of models to try based on fallback config.
	 */
	private _getModelsToTry(primaryModel: string): string[] {
		if (!this._fallbackConfig) {
			return [primaryModel];
		}

		if (this._fallbackState.usingFallback) {
			// Check if we should try to re-enable primary
			if (this._fallbackConfig.autoReenablePrimary &&
				this._fallbackState.primaryReenableAt &&
				Date.now() >= this._fallbackState.primaryReenableAt) {
				return [this._fallbackConfig.primary, ...this._fallbackConfig.fallbacks];
			}
			return this._fallbackConfig.fallbacks;
		}

		return [this._fallbackConfig.primary, ...this._fallbackConfig.fallbacks];
	}

	async *streamComplete(request: AphroditeCompletionRequest): AsyncIterable<AphroditeStreamToken> {
		this.membraneService.recordActivity('cerebral');
		const requestId = request.requestId ?? this._generateRequestId();
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);

		try {
			const response = await fetch(`${this._config.baseUrl}/v1/completions`, {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify({
					prompt: request.prompt,
					max_tokens: request.maxTokens ?? this._config.maxTokens,
					temperature: request.temperature ?? this._config.temperature,
					top_p: this._config.topP,
					top_k: this._config.topK,
					frequency_penalty: this._config.frequencyPenalty,
					presence_penalty: this._config.presencePenalty,
					stop: request.stopSequences,
					stream: true,
				}),
				signal: abortController.signal,
			});

			if (!response.ok) {
				throw new Error(`Aphrodite API error: ${response.status}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body');
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						if (data === '[DONE]') {
							const token: AphroditeStreamToken = {
								text: '',
								finished: true,
								finishReason: 'stop',
							};
							this._onDidReceiveStreamToken.fire(token);
							yield token;
							return;
						}

						try {
							const parsed = JSON.parse(data);
							const choice = parsed.choices?.[0];
							if (choice) {
								const token: AphroditeStreamToken = {
									text: choice.text ?? '',
									logprob: choice.logprobs?.token_logprobs?.[0],
									tokenId: choice.logprobs?.tokens?.[0],
									finished: choice.finish_reason !== null,
									finishReason: choice.finish_reason,
								};
								this._onDidReceiveStreamToken.fire(token);
								yield token;
							}
						} catch {
							// Skip malformed JSON
						}
					}
				}
			}
		} finally {
			this._pendingRequests.delete(requestId);
		}
	}

	async *streamCompleteWithTiming(request: AphroditeCompletionRequest): AsyncIterable<AphroditeStreamTokenWithTiming> {
		this.membraneService.recordActivity('cerebral');
		const requestId = request.requestId ?? this._generateRequestId();
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);

		const startTime = Date.now();
		let tokenIndex = 0;
		let lastTokenTime = startTime;

		try {
			const response = await fetch(`${this._config.baseUrl}/v1/completions`, {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify({
					prompt: request.prompt,
					max_tokens: request.maxTokens ?? this._config.maxTokens,
					temperature: request.temperature ?? this._config.temperature,
					top_p: this._config.topP,
					top_k: this._config.topK,
					frequency_penalty: this._config.frequencyPenalty,
					presence_penalty: this._config.presencePenalty,
					stop: request.stopSequences,
					stream: true,
				}),
				signal: abortController.signal,
			});

			if (!response.ok) {
				throw new Error(`Aphrodite API error: ${response.status}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body');
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						if (data === '[DONE]') {
							const now = Date.now();
							const token: AphroditeStreamTokenWithTiming = {
								text: '',
								finished: true,
								finishReason: 'stop',
								tokenIndex,
								elapsedMs: now - startTime,
								interTokenLatencyMs: now - lastTokenTime,
								fromSpeculation: false,
							};
							this._onDidReceiveStreamTokenWithTiming.fire(token);
							yield token;
							return;
						}

						try {
							const parsed = JSON.parse(data);
							const choice = parsed.choices?.[0];
							if (choice) {
								const now = Date.now();
								const token: AphroditeStreamTokenWithTiming = {
									text: choice.text ?? '',
									logprob: choice.logprobs?.token_logprobs?.[0],
									tokenId: choice.logprobs?.tokens?.[0],
									finished: choice.finish_reason !== null,
									finishReason: choice.finish_reason,
									tokenIndex,
									elapsedMs: now - startTime,
									interTokenLatencyMs: now - lastTokenTime,
									fromSpeculation: parsed.speculative ?? false,
								};
								this._onDidReceiveStreamTokenWithTiming.fire(token);
								yield token;
								tokenIndex++;
								lastTokenTime = now;
							}
						} catch {
							// Skip malformed JSON
						}
					}
				}
			}
		} finally {
			this._pendingRequests.delete(requestId);
		}
	}

	async batchComplete(request: AphroditeBatchRequest): Promise<AphroditeBatchResponse> {
		this.membraneService.recordActivity('cerebral');
		const startTime = Date.now();
		const responses: AphroditeCompletionResponse[] = [];
		const errors: { index: number; error: string }[] = [];

		// Process in batches
		const batches = this._chunkArray(request.requests, this._config.maxBatchSize);

		for (const batch of batches) {
			const promises = batch.map(async (req, localIndex) => {
				const globalIndex = request.requests.indexOf(req);
				try {
					const response = await this.complete(req);
					responses[globalIndex] = response;
					request.onRequestComplete?.(globalIndex, response);
				} catch (error) {
					errors.push({ index: globalIndex, error: String(error) });
				}
			});

			await Promise.all(promises);
		}

		return {
			batchId: request.batchId,
			responses,
			totalTimeMs: Date.now() - startTime,
			errors,
		};
	}

	async embed(request: AphroditeEmbeddingRequest): Promise<AphroditeEmbeddingResponse> {
		this.membraneService.recordActivity('cerebral');

		const response = await this._makeRequest('/v1/embeddings', {
			input: request.texts,
			model: request.model ?? this._config.model,
		});

		const embeddings = response.data?.map((d: any) => d.embedding) ?? [];

		return {
			embeddings,
			dimension: embeddings[0]?.length ?? 0,
			model: response.model ?? this._config.model,
		};
	}

	async listModels(): Promise<AphroditeModelInfo[]> {
		const response = await this._makeRequest('/v1/models', undefined, undefined, 'GET');

		return (response.data ?? []).map((model: any) => ({
			id: model.id,
			name: model.id,
			description: model.description ?? '',
			contextLength: model.context_length ?? 4096,
			supportsEmbeddings: model.capabilities?.embeddings ?? false,
			loaded: model.status === 'loaded',
			memoryGb: (model.memory_usage ?? 0) / 1e9,
		}));
	}

	async getAvailableModels(): Promise<AphroditeModelInfo[]> {
		return this.listModels();
	}

	async getCurrentModel(): Promise<AphroditeModelInfo | undefined> {
		const models = await this.listModels();
		return models.find(m => m.loaded);
	}

	async switchModel(modelId: string): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		this._config.model = modelId;
		// In a real implementation, this would send a request to load the model
		this.logService.info(`[AphroditeService] Switched to model: ${modelId}`);
	}

	async getStats(): Promise<AphroditeEngineStats> {
		try {
			const response = await this._makeRequest('/v1/stats', undefined, undefined, 'GET');

			const stats: AphroditeEngineStats = {
				requestsPerSecond: response.requests_per_second ?? 0,
				tokensPerSecond: response.tokens_per_second ?? 0,
				activeRequests: response.active_requests ?? 0,
				queuedRequests: response.queued_requests ?? 0,
				gpuMemoryUsed: response.gpu_memory_used ?? 0,
				gpuMemoryTotal: response.gpu_memory_total ?? 0,
				gpuUtilization: response.gpu_utilization ?? 0,
				kvCacheSize: response.kv_cache_size ?? 0,
			};

			this._onDidUpdateStats.fire(stats);
			return stats;
		} catch {
			// Return zeroed stats on error
			return {
				requestsPerSecond: 0,
				tokensPerSecond: 0,
				activeRequests: 0,
				queuedRequests: 0,
				gpuMemoryUsed: 0,
				gpuMemoryTotal: 0,
				gpuUtilization: 0,
				kvCacheSize: 0,
			};
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			const response = await fetch(`${this._config.baseUrl}/health`, {
				method: 'GET',
				headers: this._getHeaders(),
				signal: AbortSignal.timeout(5000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	cancelRequest(requestId: string): void {
		const controller = this._pendingRequests.get(requestId);
		if (controller) {
			controller.abort();
			this._pendingRequests.delete(requestId);
			this.logService.info(`[AphroditeService] Cancelled request: ${requestId}`);
		}
	}

	cancelAllRequests(): void {
		for (const [requestId, controller] of this._pendingRequests) {
			controller.abort();
			this._pendingRequests.delete(requestId);
		}
		this.logService.info('[AphroditeService] Cancelled all requests');
	}

	// --- LoRA Adapter Management (A.1) ---

	async loadAdapter(adapterId: string, adapterPath: string): Promise<AphroditeAdapterInfo> {
		this.membraneService.recordActivity('cerebral');

		await this._makeRequest(this._config.loraLoadPath, {
			lora_name: adapterId,
			lora_path: adapterPath,
		});

		const info: AphroditeAdapterInfo = {
			id: adapterId,
			path: adapterPath,
			baseModel: this._config.model,
			loaded: true,
			loadedAt: Date.now(),
		};
		this._adapters.set(adapterId, info);
		this._onDidChangeAdapters.fire(this.listAdapters());
		this.logService.info(`[AphroditeService] Loaded LoRA adapter '${adapterId}' from ${adapterPath}`);

		return info;
	}

	async unloadAdapter(adapterId: string): Promise<void> {
		this.membraneService.recordActivity('cerebral');

		await this._makeRequest(this._config.loraUnloadPath, {
			lora_name: adapterId,
		});

		this._adapters.delete(adapterId);
		this._onDidChangeAdapters.fire(this.listAdapters());
		this.logService.info(`[AphroditeService] Unloaded LoRA adapter '${adapterId}'`);
	}

	listAdapters(): AphroditeAdapterInfo[] {
		return Array.from(this._adapters.values());
	}

	getCurrentAdapter(): LoRAAdapterInfo | undefined {
		return this._currentAdapter;
	}

	async swapAdapter(adapterId: string, scale: number = 1.0): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		await this._makeRequest('/v1/lora/swap', {
			adapter_id: adapterId,
			scale,
		});

		const adapter = this._availableAdapters.find(a => a.id === adapterId);
		this._currentAdapter = {
			id: adapterId,
			name: adapter?.name ?? adapterId,
			description: adapter?.description ?? '',
			path: adapter?.path ?? '',
			scale,
			loaded: true,
			parameters: adapter?.parameters ?? 0,
			baseModel: adapter?.baseModel ?? '',
		};

		this._onDidChangeAdapter.fire(this._currentAdapter);
		this.logService.info(`[AphroditeService] Swapped to LoRA adapter: ${adapterId} (scale: ${scale})`);
	}

	// --- Performance Telemetry (A.1) ---

	getTelemetry(limit?: number): AphroditeRequestTelemetry[] {
		const mostRecentFirst = [...this._telemetry].reverse();
		return limit !== undefined ? mostRecentFirst.slice(0, limit) : mostRecentFirst;
	}

	getTelemetrySummary(): AphroditeTelemetrySummary {
		const total = this._telemetry.length;
		if (total === 0) {
			return {
				totalRequests: 0,
				successCount: 0,
				errorCount: 0,
				successRate: 0,
				avgLatencyMs: 0,
				p95LatencyMs: 0,
				totalTokens: 0,
				byModel: {},
			};
		}

		const successCount = this._telemetry.filter(t => t.success).length;
		const sortedLatencies = this._telemetry.map(t => t.latencyMs).sort((a, b) => a - b);
		const avgLatencyMs = sortedLatencies.reduce((sum, l) => sum + l, 0) / total;
		const p95Index = Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * 0.95));
		const totalTokens = this._telemetry.reduce((sum, t) => sum + t.promptTokens + t.completionTokens, 0);

		const modelGroups = new Map<string, AphroditeRequestTelemetry[]>();
		for (const entry of this._telemetry) {
			const group = modelGroups.get(entry.model) ?? [];
			group.push(entry);
			modelGroups.set(entry.model, group);
		}

		const byModel: AphroditeTelemetrySummary['byModel'] = {};
		for (const [model, entries] of modelGroups) {
			const modelSuccesses = entries.filter(e => e.success).length;
			byModel[model] = {
				requests: entries.length,
				successRate: modelSuccesses / entries.length,
				avgLatencyMs: entries.reduce((sum, e) => sum + e.latencyMs, 0) / entries.length,
			};
		}

		return {
			totalRequests: total,
			successCount,
			errorCount: total - successCount,
			successRate: successCount / total,
			avgLatencyMs,
			p95LatencyMs: sortedLatencies[p95Index],
			totalTokens,
			byModel,
		};
	}

	getPerformanceMetrics(windowSeconds: number = DEFAULT_METRICS_WINDOW_SECONDS): AphroditePerformanceMetrics {
		const now = Date.now();
		const windowMs = windowSeconds * 1000;
		const windowStart = now - windowMs;

		const recentTelemetry = this._telemetry.filter(t => t.timestamp >= windowStart);

		if (recentTelemetry.length === 0) {
			return {
				windowSeconds,
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				successRate: 0,
				errorRate: 0,
				avgLatencyMs: 0,
				p50LatencyMs: 0,
				p95LatencyMs: 0,
				p99LatencyMs: 0,
				avgTimeToFirstTokenMs: 0,
				avgTokensPerSecond: 0,
				throughputTokensPerSec: 0,
				totalTokensGenerated: 0,
				promptCacheHitRate: 0,
				speculativeDecodingUsageRate: 0,
				avgSpeculativeAcceptanceRate: 0,
			};
		}

		const successful = recentTelemetry.filter(t => t.success);
		const failed = recentTelemetry.filter(t => !t.success);

		const latencies = successful.map(t => t.latencyMs).sort((a, b) => a - b);
		const p50Index = Math.floor(latencies.length * 0.5);
		const p95Index = Math.floor(latencies.length * 0.95);
		const p99Index = Math.floor(latencies.length * 0.99);

		const promptCacheHits = recentTelemetry.filter(t => t.promptCacheHit).length;
		const speculativeUsed = recentTelemetry.filter(t => t.speculativeDecodingUsed);
		const totalTokens = successful.reduce((a, t) => a + t.completionTokens, 0);
		const avgTps = successful.length > 0
			? successful.reduce((a, t) => a + (t.tokensPerSecond ?? 0), 0) / successful.length
			: 0;

		return {
			windowSeconds,
			totalRequests: recentTelemetry.length,
			successfulRequests: successful.length,
			failedRequests: failed.length,
			successRate: recentTelemetry.length > 0 ? successful.length / recentTelemetry.length : 0,
			errorRate: recentTelemetry.length > 0 ? failed.length / recentTelemetry.length : 0,
			avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
			p50LatencyMs: latencies[p50Index] ?? 0,
			p95LatencyMs: latencies[p95Index] ?? 0,
			p99LatencyMs: latencies[p99Index] ?? 0,
			avgTimeToFirstTokenMs: 0,
			avgTokensPerSecond: avgTps,
			throughputTokensPerSec: avgTps,
			totalTokensGenerated: totalTokens,
			promptCacheHitRate: recentTelemetry.length > 0 ? promptCacheHits / recentTelemetry.length : 0,
			speculativeDecodingUsageRate: recentTelemetry.length > 0 ? speculativeUsed.length / recentTelemetry.length : 0,
			avgSpeculativeAcceptanceRate: speculativeUsed.length > 0
				? speculativeUsed.reduce((a, t) => a + (t.speculativeAcceptanceRate ?? 0), 0) / speculativeUsed.length
				: 0,
		};
	}

	getRecentTelemetry(limit: number = 100): AphroditeRequestTelemetry[] {
		return this._telemetry.slice(-limit);
	}

	clearTelemetry(): void {
		this._telemetry = [];
	}

	// --- A/B Testing (A.1) ---

	startABTest(config: AphroditeABTestConfig): void {
		if (config.variants.length < 2) {
			throw new Error('An A/B test requires at least 2 variants');
		}
		this._abTests.set(config.testId, { config, active: true, startedAt: Date.now() });
		this.logService.info(`[AphroditeService] Started A/B test '${config.testId}' with ${config.variants.length} variants`);
	}

	stopABTest(testId: string): void {
		const test = this._abTests.get(testId);
		if (test) {
			test.active = false;
			this.logService.info(`[AphroditeService] Stopped A/B test '${testId}'`);
		}
	}

	isABTestActive(testId: string): boolean {
		return this._abTests.get(testId)?.active ?? false;
	}

	async completeViaABTest(testId: string, request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse> {
		const test = this._abTests.get(testId);
		if (!test || !test.active) {
			return this.complete(request);
		}

		const variant = this._selectVariant(test.config.variants);
		return this._completeInternal(request, variant.model, testId, variant.variantId);
	}

	getABTestResults(testId: string): AphroditeABTestResult[] {
		const test = this._abTests.get(testId);
		if (!test) {
			return [];
		}

		return test.config.variants.map(variant => {
			// Attribute by test *and* variant — variant IDs are only unique
			// within a test — and ignore entries predating the current run so a
			// restarted test reports only its own requests.
			const entries = this._telemetry.filter(t =>
				t.testId === testId
				&& t.variantId === variant.variantId
				&& t.timestamp >= test.startedAt);
			const successes = entries.filter(e => e.success).length;
			return {
				variantId: variant.variantId,
				model: variant.model,
				requestCount: entries.length,
				successRate: entries.length > 0 ? successes / entries.length : 0,
				avgLatencyMs: entries.length > 0 ? entries.reduce((sum, e) => sum + e.latencyMs, 0) / entries.length : 0,
			};
		});
	}

	getABTest(): ABTestConfig | undefined {
		return this._activeABTest;
	}

	// --- Extended Fallback Chain (A.1) ---

	setFallbackConfig(config: ModelFallbackConfig): void {
		this._fallbackConfig = config;
		this._fallbackState = {
			activeModel: config.primary,
			usingFallback: false,
			isUsingFallback: false,
			primaryFailureCount: 0,
			consecutiveFailures: 0,
			currentFallbackIndex: 0,
		};
		this.logService.info(`[AphroditeService] Configured fallback chain: ${config.primary} -> ${config.fallbacks.join(' -> ')}`);
	}

	getFallbackConfig(): ModelFallbackConfig | undefined {
		return this._fallbackConfig;
	}

	getFallbackState(): ModelFallbackState {
		return { ...this._fallbackState };
	}

	resetFallbackState(): void {
		if (this._fallbackConfig) {
			this._fallbackState = {
				activeModel: this._fallbackConfig.primary,
				usingFallback: false,
				isUsingFallback: false,
				primaryFailureCount: 0,
				consecutiveFailures: 0,
				currentFallbackIndex: 0,
			};
			this._onDidChangeFallbackState.fire(this._fallbackState);
			this.logService.info('[AphroditeService] Reset fallback state to primary model');
		}
	}

	// --- Structured Output (A.3) ---

	async completeStructured(request: AphroditeCompletionRequest, outputConfig: StructuredOutputConfig): Promise<AphroditeCompletionResponse> {
		this.membraneService.recordActivity('cerebral');

		let lastError: Error | undefined;
		for (let attempt = 0; attempt < outputConfig.maxRetries; attempt++) {
			try {
				const response = await this._makeRequest('/v1/completions', {
					prompt: request.prompt,
					max_tokens: request.maxTokens ?? this._config.maxTokens,
					temperature: request.temperature ?? this._config.temperature,
					top_p: this._config.topP,
					top_k: this._config.topK,
					frequency_penalty: this._config.frequencyPenalty,
					presence_penalty: this._config.presencePenalty,
					stop: request.stopSequences,
					stream: false,
					response_format: {
						type: 'json_object',
						schema: outputConfig.jsonSchema,
					},
				});

				const text = response.choices[0]?.text ?? '';

				// Validate against schema if strict mode
				if (outputConfig.strict) {
					try {
						JSON.parse(text);
					} catch {
						throw new Error('Response is not valid JSON');
					}
				}

				return {
					text,
					promptTokens: response.usage?.prompt_tokens ?? 0,
					completionTokens: response.usage?.completion_tokens ?? 0,
					totalTokens: response.usage?.total_tokens ?? 0,
					finishReason: response.choices[0]?.finish_reason ?? 'stop',
					generationTimeMs: 0,
					model: response.model ?? this._config.model,
				};
			} catch (err) {
				lastError = err as Error;
				this.logService.warn(`[AphroditeService] Structured output attempt ${attempt + 1} failed`);
			}
		}

		throw lastError ?? new Error('Structured output generation failed');
	}

	// --- Prompt Caching (A.3) ---

	getPromptCacheStats(): PromptCacheStats {
		let totalTokens = 0;
		let memoryUsage = 0;
		for (const entry of this._promptCache.values()) {
			totalTokens += entry.tokenCount;
			memoryUsage += entry.tokenCount * 4;
		}

		const totalAccesses = this._promptCacheHits + this._promptCacheMisses;

		return {
			totalEntries: this._promptCache.size,
			entryCount: this._promptCache.size,
			maxEntries: MAX_PROMPT_CACHE_ENTRIES,
			totalTokensCached: totalTokens,
			hitRate: totalAccesses > 0 ? this._promptCacheHits / totalAccesses : 0,
			totalHits: this._promptCacheHits,
			hitCount: this._promptCacheHits,
			totalMisses: this._promptCacheMisses,
			missCount: this._promptCacheMisses,
			memoryUsageBytes: memoryUsage,
		};
	}

	clearPromptCache(): void {
		this._promptCache.clear();
		this._promptCacheHits = 0;
		this._promptCacheMisses = 0;
		this.logService.info('[AphroditeService] Cleared prompt cache');
	}

	async preWarmPromptCache(promptPrefix: string): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		const cacheKey = this._computePromptCacheKey(promptPrefix);

		if (this._promptCache.has(cacheKey)) {
			this._touchPromptCache(cacheKey);
			return;
		}

		try {
			await this._makeRequest('/v1/cache/warm', {
				prompt: promptPrefix,
			});

			this._addToPromptCache(cacheKey, promptPrefix);
			this.logService.info(`[AphroditeService] Pre-warmed prompt cache for prefix (${promptPrefix.length} chars)`);
		} catch {
			// Ignore errors during pre-warming
		}
	}

	// --- Speculative Decoding (A.3) ---

	setSpeculativeDecodingConfig(config: SpeculativeDecodingConfig): void {
		this._speculativeConfig = config;
		this.logService.info(`[AphroditeService] Configured speculative decoding: ${config.enabled ? 'enabled' : 'disabled'}`);
	}

	getSpeculativeDecodingConfig(): SpeculativeDecodingConfig | undefined {
		return this._speculativeConfig;
	}

	async isSpeculativeDecodingAvailable(): Promise<boolean> {
		try {
			const response = await this._makeRequest('/v1/capabilities', undefined, undefined, 'GET');
			return response.speculative_decoding_available ?? false;
		} catch {
			return false;
		}
	}

	private _selectVariant(variants: AphroditeABTestVariant[]): AphroditeABTestVariant {
		const totalWeight = variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
		if (totalWeight <= 0) {
			return variants[0];
		}

		let roll = Math.random() * totalWeight;
		for (const variant of variants) {
			roll -= Math.max(0, variant.weight);
			if (roll <= 0) {
				return variant;
			}
		}
		return variants[variants.length - 1];
	}

	private _recordTelemetry(entry: AphroditeRequestTelemetry): void {
		this._telemetry.push(entry);
		if (this._telemetry.length > AphroditeService._MAX_TELEMETRY) {
			this._telemetry.shift();
		}
		this._onDidRecordTelemetry.fire(entry);
	}


	private _generateRequestId(): string {
		return `req_${++this._requestIdCounter}_${Date.now()}`;
	}

	private _getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this._config.apiKey) {
			headers['Authorization'] = 'Bearer ' + this._config.apiKey;
		}
		return headers;
	}

	private async _makeRequest(path: string, body?: any, signal?: AbortSignal, method: string = 'POST'): Promise<any> {
		const url = `${this._config.baseUrl}${path}`;
		const options: RequestInit = {
			method,
			headers: this._getHeaders(),
			signal: signal ?? AbortSignal.timeout(this._config.timeoutMs),
		};

		if (body && method !== 'GET') {
			options.body = JSON.stringify(body);
		}

		const response = await fetch(url, options);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Aphrodite API error ${response.status}: ${errorText}`);
		}

		return response.json();
	}

	private _chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	private _selectModelVariant(): { model: string; adapterId?: string; configOverrides?: Partial<AphroditeConfig> } {
		// If A/B test is active, select a variant based on weights
		if (this._activeABTest?.active) {
			const variant = this._selectABTestVariant();
			if (variant) {
				return {
					model: variant.model,
					adapterId: variant.adapterId,
					configOverrides: variant.configOverrides,
				};
			}
		}

		// Use current adapter if loaded
		const adapterId = this._currentAdapter?.id;

		// Use fallback state if configured
		if (this._fallbackConfig) {
			return {
				model: this._fallbackState.activeModel,
				adapterId,
			};
		}

		return {
			model: this._config.model,
			adapterId,
		};
	}

	private _selectABTestVariant(): ABTestVariant | undefined {
		if (!this._activeABTest?.active) {
			return undefined;
		}

		const totalWeight = this._activeABTest.variants.reduce((sum, v) => sum + v.weight, 0);
		const random = Math.random() * totalWeight;

		let cumulative = 0;
		for (const variant of this._activeABTest.variants) {
			cumulative += variant.weight;
			if (random < cumulative) {
				return variant;
			}
		}

		return this._activeABTest.variants[0];
	}

	private _recordModelSuccess(): void {
		if (!this._fallbackConfig) {
			return;
		}

		if (this._fallbackState.usingFallback) {
			return;
		}

		this._fallbackState.primaryFailureCount = 0;
	}

	private _recordModelFailure(): void {
		if (!this._fallbackConfig) {
			return;
		}

		if (this._fallbackState.usingFallback) {
			return;
		}

		this._fallbackState.primaryFailureCount++;

		if (this._fallbackState.primaryFailureCount >= this._fallbackConfig.retriesBeforeFallback) {
			this._fallbackState.usingFallback = true;
			this._fallbackState.activeModel = this._fallbackConfig.fallbacks[0] ?? this._fallbackConfig.primary;
			this._fallbackState.primaryDisabledAt = Date.now();
			this._fallbackState.primaryReenableAt = Date.now() + this._fallbackConfig.primaryReenableDelayMs;

			this._onDidChangeFallbackState.fire(this._fallbackState);
			this.logService.warn(`[AphroditeService] Switched to fallback model: ${this._fallbackState.activeModel}`);
		}
	}

	private _computePromptCacheKey(prompt: string): string {
		const prefix = prompt.substring(0, 1000);
		let hash = 0;
		for (let i = 0; i < prefix.length; i++) {
			const char = prefix.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return `cache_${hash.toString(16)}`;
	}

	private _touchPromptCache(key: string): void {
		const entry = this._promptCache.get(key);
		if (entry) {
			entry.lastAccessTime = Date.now();
			entry.hitCount++;
		}
	}

	private _addToPromptCache(key: string, prompt: string): void {
		// Evict LRU entries if at capacity
		if (this._promptCache.size >= MAX_PROMPT_CACHE_ENTRIES) {
			let lruKey: string | undefined;
			let lruTime = Infinity;
			for (const [k, entry] of this._promptCache) {
				if (entry.lastAccessTime < lruTime) {
					lruTime = entry.lastAccessTime;
					lruKey = k;
				}
			}
			if (lruKey) {
				this._promptCache.delete(lruKey);
			}
		}

		const entry: PromptCacheEntry = {
			key,
			kvStateId: `kv_${key}`,
			tokenCount: Math.ceil(prompt.length / 4),
			lastAccessTime: Date.now(),
			hitCount: 0,
		};
		this._promptCache.set(key, entry);
	}
}
