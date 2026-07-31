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
	AphroditeCompletionRequest,
	AphroditeCompletionResponse,
	AphroditeBatchRequest,
	AphroditeBatchResponse,
	AphroditeEmbeddingRequest,
	AphroditeEmbeddingResponse,
	AphroditeModelInfo,
	AphroditeEngineStats,
	AphroditeAdapterInfo,
	AphroditeModelTelemetry,
	AphroditeModelComparisonResult,
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
	promptCachingEnabled: true,
};

/** Rolling telemetry accumulator for a single model. */
interface TelemetryAccumulator {
	requestCount: number;
	errorCount: number;
	totalLatencyMs: number;
	totalTokensPerSecond: number;
	lastUsed: number;
}

/** A cached completion response, valid until `expiresAt`. */
interface PromptCacheEntry {
	response: AphroditeCompletionResponse;
	expiresAt: number;
}

const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;
const PROMPT_CACHE_MAX_ENTRIES = 100;

/**
 * Aphrodite Engine Service Implementation.
 * Provides streaming LLM inference via the Aphrodite engine.
 */
export class AphroditeService extends Disposable implements IAphroditeService {
	readonly _serviceBrand: undefined;

	private _config: AphroditeConfig;
	private _connected: boolean = false;
	private _pendingRequests: Map<string, AbortController> = new Map();
	private _requestIdCounter: number = 0;
	private readonly _adapters: Map<string, AphroditeAdapterInfo> = new Map();
	private _activeAdapterId: string | undefined;
	private readonly _telemetry: Map<string, TelemetryAccumulator> = new Map();
	private _fallbackChain: string[] = [];
	private readonly _promptCache: Map<string, PromptCacheEntry> = new Map();

	private readonly _onDidReceiveStreamToken = this._register(new Emitter<AphroditeStreamToken>());
	readonly onDidReceiveStreamToken: Event<AphroditeStreamToken> = this._onDidReceiveStreamToken.event;

	private readonly _onDidChangeConnectionStatus = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionStatus: Event<boolean> = this._onDidChangeConnectionStatus.event;

	private readonly _onDidUpdateStats = this._register(new Emitter<AphroditeEngineStats>());
	readonly onDidUpdateStats: Event<AphroditeEngineStats> = this._onDidUpdateStats.event;

	private readonly _onDidChangeAdapters = this._register(new Emitter<AphroditeAdapterInfo[]>());
	readonly onDidChangeAdapters: Event<AphroditeAdapterInfo[]> = this._onDidChangeAdapters.event;

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

		// A fresh connection may be to a different (or restarted) engine process, which would
		// not actually have any LoRA adapters previously loaded resident - forget local state so
		// loadAdapter() issues a real load instead of reactivating a now-stale entry.
		if (this._adapters.size > 0) {
			this._adapters.clear();
			this._activeAdapterId = undefined;
			this._onDidChangeAdapters.fire(this.listAdapters());
		}

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
		return this._completeInternal(request, false);
	}

	/**
	 * @param request The completion request.
	 * @param bypassFallback When true, only the resolved primary model is tried - used by
	 * `compareModels()` so a failing variant is reported as failed instead of silently
	 * succeeding via another model through the fallback chain.
	 */
	private async _completeInternal(request: AphroditeCompletionRequest, bypassFallback: boolean): Promise<AphroditeCompletionResponse> {
		this.membraneService.recordActivity('cerebral');
		const requestId = request.requestId ?? this._generateRequestId();
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);

		const primaryModel = request.model ?? this.getActiveAdapter()?.id ?? this._config.model;

		if (this._config.promptCachingEnabled) {
			const cacheKey = this._promptCacheKey(request, primaryModel);
			const cached = this._promptCache.get(cacheKey);
			if (cached && cached.expiresAt > Date.now()) {
				this._pendingRequests.delete(requestId);
				this.logService.trace(`[AphroditeService] Prompt cache hit for model ${primaryModel}`);
				return cached.response;
			}
		}

		const modelsToTry = bypassFallback
			? [primaryModel]
			: [primaryModel, ...this._fallbackChain.filter(m => m !== primaryModel)];
		let lastError: unknown;

		try {
			for (const modelId of modelsToTry) {
				const startTime = Date.now();
				try {
					const response = await this._makeRequest('/v1/completions', {
						model: modelId,
						prompt: request.prompt,
						max_tokens: request.maxTokens ?? this._config.maxTokens,
						temperature: request.temperature ?? this._config.temperature,
						top_p: this._config.topP,
						top_k: this._config.topK,
						frequency_penalty: this._config.frequencyPenalty,
						presence_penalty: this._config.presencePenalty,
						stop: request.stopSequences,
						guided_json: request.responseSchema,
						stream: false,
					}, abortController.signal);

					const generationTimeMs = Date.now() - startTime;
					const completionTokens = response.usage?.completion_tokens ?? 0;
					this._recordTelemetry(modelId, generationTimeMs, completionTokens, generationTimeMs, true);

					const result: AphroditeCompletionResponse = {
						text: response.choices[0]?.text ?? '',
						promptTokens: response.usage?.prompt_tokens ?? 0,
						completionTokens,
						totalTokens: response.usage?.total_tokens ?? 0,
						finishReason: response.choices[0]?.finish_reason ?? 'stop',
						generationTimeMs,
						model: response.model ?? modelId,
					};

					if (this._config.promptCachingEnabled) {
						this._setPromptCacheEntry(this._promptCacheKey(request, primaryModel), result);
					}

					return result;
				} catch (error) {
					if (abortController.signal.aborted) {
						// Cancelled by the caller: stop the fallback chain immediately instead of
						// churning through (and mis-recording telemetry for) the remaining models.
						throw error;
					}
					this._recordTelemetry(modelId, Date.now() - startTime, 0, 0, false);
					lastError = error;
					if (modelId !== modelsToTry[modelsToTry.length - 1]) {
						this.logService.warn(`[AphroditeService] Model '${modelId}' failed, trying fallback: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
			}
			throw lastError;
		} finally {
			this._pendingRequests.delete(requestId);
		}
	}

	async *streamComplete(request: AphroditeCompletionRequest): AsyncIterable<AphroditeStreamToken> {
		this.membraneService.recordActivity('cerebral');
		const requestId = request.requestId ?? this._generateRequestId();
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);

		const modelId = request.model ?? this.getActiveAdapter()?.id ?? this._config.model;
		const startTime = Date.now();
		let tokenCount = 0;

		try {
			const response = await fetch(`${this._config.baseUrl}/v1/completions`, {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify({
					model: modelId,
					prompt: request.prompt,
					max_tokens: request.maxTokens ?? this._config.maxTokens,
					temperature: request.temperature ?? this._config.temperature,
					top_p: this._config.topP,
					top_k: this._config.topK,
					frequency_penalty: this._config.frequencyPenalty,
					presence_penalty: this._config.presencePenalty,
					stop: request.stopSequences,
					guided_json: request.responseSchema,
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
							this._recordTelemetry(modelId, Date.now() - startTime, tokenCount, Date.now() - startTime, true);
							this._onDidReceiveStreamToken.fire(token);
							yield token;
							return;
						}

						try {
							const parsed = JSON.parse(data);
							const choice = parsed.choices?.[0];
							if (choice) {
								tokenCount++;
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
			this._recordTelemetry(modelId, Date.now() - startTime, tokenCount, Date.now() - startTime, true);
		} catch (error) {
			this._recordTelemetry(modelId, Date.now() - startTime, tokenCount, 0, false);
			throw error;
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
			contextLength: model.context_length ?? 4096,
			supportsEmbeddings: model.capabilities?.embeddings ?? false,
			loaded: model.status === 'loaded',
			memoryGb: (model.memory_usage ?? 0) / 1e9,
		}));
	}

	async getCurrentModel(): Promise<AphroditeModelInfo | undefined> {
		const models = await this.listModels();
		return models.find(m => m.loaded);
	}

	async switchModel(modelId: string): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		this._config.model = modelId;
		if (this._activeAdapterId !== undefined) {
			// A LoRA adapter is bound to a specific base model, so switching the base model
			// deactivates it - otherwise complete()/streamComplete() would keep routing to the
			// old adapter's id and this call would silently have no effect.
			this._activeAdapterId = undefined;
			this._onDidChangeAdapters.fire(this.listAdapters());
		}
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

	async loadAdapter(adapterId: string, path: string, baseModel?: string): Promise<AphroditeAdapterInfo> {
		this.membraneService.recordActivity('somatic');

		const existing = this._adapters.get(adapterId);
		if (existing && existing.path === path) {
			// Already resident on the engine under this same path (e.g. deactivated by a
			// switchModel() call) - reissuing /v1/load_lora_adapter would fail since vLLM
			// rejects a duplicate lora_name. Just reactivate it locally instead of re-loading.
			// A different path for the same id is a genuinely different adapter, so that falls
			// through to a real load below.
			this._activeAdapterId = adapterId;
			this._onDidChangeAdapters.fire(this.listAdapters());
			this.logService.info(`[AphroditeService] Reactivated already-loaded LoRA adapter '${adapterId}'`);
			return existing;
		}

		await this._makeRequest('/v1/load_lora_adapter', { lora_name: adapterId, lora_path: path });

		const info: AphroditeAdapterInfo = { id: adapterId, path, baseModel, loaded: true };
		this._adapters.set(adapterId, info);
		this._activeAdapterId = adapterId;
		this._onDidChangeAdapters.fire(this.listAdapters());
		this.logService.info(`[AphroditeService] Loaded LoRA adapter '${adapterId}' from ${path}`);
		return info;
	}

	async unloadAdapter(adapterId: string): Promise<void> {
		this.membraneService.recordActivity('somatic');
		try {
			await this._makeRequest('/v1/unload_lora_adapter', { lora_name: adapterId });
		} finally {
			// Forget local state even if the request failed (e.g. the engine already doesn't
			// have it, such as after a restart) - otherwise loadAdapter()'s reactivation
			// short-circuit would get permanently stuck believing a no-longer-resident adapter
			// is still loaded.
			this._adapters.delete(adapterId);
			if (this._activeAdapterId === adapterId) {
				this._activeAdapterId = undefined;
			}
			this._onDidChangeAdapters.fire(this.listAdapters());
		}
		this.logService.info(`[AphroditeService] Unloaded LoRA adapter '${adapterId}'`);
	}

	listAdapters(): AphroditeAdapterInfo[] {
		return Array.from(this._adapters.values());
	}

	getActiveAdapter(): AphroditeAdapterInfo | undefined {
		return this._activeAdapterId ? this._adapters.get(this._activeAdapterId) : undefined;
	}

	getTelemetry(modelId?: string): AphroditeModelTelemetry[] {
		const entries = modelId
			? (this._telemetry.has(modelId) ? [[modelId, this._telemetry.get(modelId)!] as const] : [])
			: Array.from(this._telemetry.entries());

		return entries.map(([id, acc]) => {
			const successCount = acc.requestCount - acc.errorCount;
			return {
				modelId: id,
				requestCount: acc.requestCount,
				errorCount: acc.errorCount,
				averageLatencyMs: successCount > 0 ? acc.totalLatencyMs / successCount : 0,
				averageTokensPerSecond: successCount > 0 ? acc.totalTokensPerSecond / successCount : 0,
				lastUsed: acc.lastUsed,
			};
		});
	}

	resetTelemetry(): void {
		this._telemetry.clear();
	}

	async compareModels(request: AphroditeCompletionRequest, modelIds: string[]): Promise<AphroditeModelComparisonResult[]> {
		this.membraneService.recordActivity('cerebral');
		return Promise.all(modelIds.map(async (modelId): Promise<AphroditeModelComparisonResult> => {
			const startTime = Date.now();
			try {
				// bypassFallback: true so a variant that genuinely fails is reported as failed,
				// rather than silently succeeding via another model in the fallback chain.
				const response = await this._completeInternal({ ...request, model: modelId, requestId: undefined }, true);
				return { modelId, response, latencyMs: Date.now() - startTime };
			} catch (error) {
				return { modelId, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - startTime };
			}
		}));
	}

	setFallbackChain(modelIds: string[]): void {
		this._fallbackChain = [...modelIds];
		this.logService.info(`[AphroditeService] Fallback chain set: ${modelIds.join(' -> ') || '(none)'}`);
	}

	getFallbackChain(): string[] {
		return [...this._fallbackChain];
	}

	private _recordTelemetry(modelId: string, latencyMs: number, completionTokens: number, generationTimeMs: number, success: boolean): void {
		let acc = this._telemetry.get(modelId);
		if (!acc) {
			acc = { requestCount: 0, errorCount: 0, totalLatencyMs: 0, totalTokensPerSecond: 0, lastUsed: 0 };
			this._telemetry.set(modelId, acc);
		}
		acc.requestCount++;
		acc.lastUsed = Date.now();
		if (success) {
			acc.totalLatencyMs += latencyMs;
			acc.totalTokensPerSecond += generationTimeMs > 0 ? completionTokens / (generationTimeMs / 1000) : 0;
		} else {
			acc.errorCount++;
		}
	}

	private _promptCacheKey(request: AphroditeCompletionRequest, modelId: string): string {
		return JSON.stringify({
			model: modelId,
			prompt: request.prompt,
			systemPrompt: request.systemPrompt,
			maxTokens: request.maxTokens ?? this._config.maxTokens,
			temperature: request.temperature ?? this._config.temperature,
			stopSequences: request.stopSequences,
			responseSchema: request.responseSchema,
		});
	}

	private _setPromptCacheEntry(key: string, response: AphroditeCompletionResponse): void {
		if (this._promptCache.size >= PROMPT_CACHE_MAX_ENTRIES) {
			// Evict the oldest entry (Map preserves insertion order).
			const oldestKey = this._promptCache.keys().next().value;
			if (oldestKey !== undefined) {
				this._promptCache.delete(oldestKey);
			}
		}
		this._promptCache.set(key, { response, expiresAt: Date.now() + PROMPT_CACHE_TTL_MS });
	}

	private _generateRequestId(): string {
		return `req_${++this._requestIdCounter}_${Date.now()}`;
	}

	private _getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this._config.apiKey) {
			headers['Authorization'] = `Bearer ${this._config.apiKey}`;
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
}
