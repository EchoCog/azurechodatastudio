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
	AphroditeLoraAdapter,
	AphroditeRequestTelemetryEntry,
	AphroditeTelemetrySummary,
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
};

/** Maximum number of telemetry entries retained (oldest evicted first). */
const MAX_TELEMETRY_ENTRIES = 500;

/** Trailing window, in milliseconds, used to compute request throughput. */
const THROUGHPUT_WINDOW_MS = 60_000;

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
	private readonly _adapters: Map<string, AphroditeLoraAdapter> = new Map();
	private _activeAdapterId: string | undefined;
	private _fallbackChain: string[] = [];
	/** Whether the caller has ever explicitly set a model (vs. the untouched `DEFAULT_CONFIG.model` placeholder). */
	private _modelExplicitlySet: boolean = false;
	private readonly _telemetry: AphroditeRequestTelemetryEntry[] = [];

	private readonly _onDidReceiveStreamToken = this._register(new Emitter<AphroditeStreamToken>());
	readonly onDidReceiveStreamToken: Event<AphroditeStreamToken> = this._onDidReceiveStreamToken.event;

	private readonly _onDidChangeConnectionStatus = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionStatus: Event<boolean> = this._onDidChangeConnectionStatus.event;

	private readonly _onDidUpdateStats = this._register(new Emitter<AphroditeEngineStats>());
	readonly onDidUpdateStats: Event<AphroditeEngineStats> = this._onDidUpdateStats.event;

	private readonly _onDidRecordTelemetry = this._register(new Emitter<AphroditeRequestTelemetryEntry>());
	readonly onDidRecordTelemetry: Event<AphroditeRequestTelemetryEntry> = this._onDidRecordTelemetry.event;

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
		if (config.model !== undefined) {
			this._modelExplicitlySet = true;
		}
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
		if (config.model !== undefined) {
			this._modelExplicitlySet = true;
		}
		this._config = { ...this._config, ...config };
		this.logService.info('[AphroditeService] Config updated');
	}

	async complete(request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse> {
		this.membraneService.recordActivity('cerebral');

		// A loaded LoRA adapter is itself the "model" the engine dispatches on, so it takes
		// priority over the base config model when present.
		const primaryModel = this._activeAdapterId ?? this._config.model;
		const modelsToTry = [primaryModel, ...this._fallbackChain.filter(m => m !== primaryModel)];
		let lastError: unknown;

		for (const model of modelsToTry) {
			const startTime = Date.now();
			try {
				const response = await this._completeWithModel(request, model);
				const generationTimeMs = Date.now() - startTime;
				this._recordTelemetry(model, generationTimeMs, true);
				return { ...response, generationTimeMs };
			} catch (error) {
				lastError = error;
				this._recordTelemetry(model, Date.now() - startTime, false, error);
				if (this._isAbortError(error)) {
					// User-initiated cancellation (cancelRequest/cancelAllRequests) must end the
					// whole operation, not just the in-flight attempt against this one model.
					throw error;
				}
				if (model !== modelsToTry[modelsToTry.length - 1]) {
					this.logService.warn(`[AphroditeService] Model '${model}' failed, falling back to next model in chain`);
				}
			}
		}

		throw lastError;
	}

	private async _completeWithModel(request: AphroditeCompletionRequest, model: string): Promise<AphroditeCompletionResponse> {
		const requestId = request.requestId ?? this._generateRequestId();
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);

		try {
			const response = await this._makeRequest('/v1/completions', {
				model: this._resolveWireModel(model),
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

			return {
				text: response.choices[0]?.text ?? '',
				promptTokens: response.usage?.prompt_tokens ?? 0,
				completionTokens: response.usage?.completion_tokens ?? 0,
				totalTokens: response.usage?.total_tokens ?? 0,
				finishReason: response.choices[0]?.finish_reason ?? 'stop',
				generationTimeMs: 0,
				model: response.model ?? model,
			};
		} finally {
			this._pendingRequests.delete(requestId);
		}
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
					model: this._resolveWireModel(this._activeAdapterId ?? this._config.model),
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
		this._modelExplicitlySet = true;
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

	async loadAdapter(request: { id: string; path: string; name?: string }): Promise<AphroditeLoraAdapter> {
		this.membraneService.recordActivity('cerebral');

		await this._makeRequest('/v1/load_lora_adapter', {
			lora_name: request.id,
			lora_path: request.path,
		});

		const adapter: AphroditeLoraAdapter = {
			id: request.id,
			name: request.name ?? request.id,
			path: request.path,
			loaded: true,
		};
		this._adapters.set(adapter.id, adapter);
		this._activeAdapterId = adapter.id;
		this.logService.info(`[AphroditeService] Loaded LoRA adapter: ${adapter.id}`);
		return adapter;
	}

	async unloadAdapter(adapterId: string): Promise<void> {
		this.membraneService.recordActivity('cerebral');

		await this._makeRequest('/v1/unload_lora_adapter', {
			lora_name: adapterId,
		});

		this._adapters.delete(adapterId);
		if (this._activeAdapterId === adapterId) {
			this._activeAdapterId = undefined;
		}
		this.logService.info(`[AphroditeService] Unloaded LoRA adapter: ${adapterId}`);
	}

	listAdapters(): AphroditeLoraAdapter[] {
		return Array.from(this._adapters.values());
	}

	getActiveAdapter(): AphroditeLoraAdapter | undefined {
		return this._activeAdapterId ? this._adapters.get(this._activeAdapterId) : undefined;
	}

	setFallbackChain(modelIds: string[]): void {
		this._fallbackChain = [...modelIds];
		this.logService.info(`[AphroditeService] Fallback chain set: ${modelIds.join(', ') || '(empty)'}`);
	}

	getFallbackChain(): string[] {
		return [...this._fallbackChain];
	}

	getRecentTelemetry(limit: number = 50): AphroditeRequestTelemetryEntry[] {
		return this._telemetry.slice(-limit);
	}

	getTelemetrySummary(): AphroditeTelemetrySummary {
		const now = Date.now();
		const totalRequests = this._telemetry.length;
		const successEntries = this._telemetry.filter(e => e.success);
		const errorCount = totalRequests - successEntries.length;

		const latencies = successEntries.map(e => e.latencyMs).sort((a, b) => a - b);
		const avgLatencyMs = latencies.length > 0
			? latencies.reduce((sum, v) => sum + v, 0) / latencies.length
			: 0;
		const p95Index = latencies.length > 0 ? Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95)) : 0;
		const p95LatencyMs = latencies.length > 0 ? latencies[p95Index] : 0;

		const recentCount = this._telemetry.filter(e => now - e.timestamp <= THROUGHPUT_WINDOW_MS).length;

		return {
			totalRequests,
			successCount: successEntries.length,
			errorCount,
			errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
			avgLatencyMs,
			p95LatencyMs,
			throughputPerSecond: recentCount / (THROUGHPUT_WINDOW_MS / 1000),
			lastUpdated: now,
		};
	}

	private _recordTelemetry(model: string, latencyMs: number, success: boolean, error?: unknown): void {
		const entry: AphroditeRequestTelemetryEntry = {
			timestamp: Date.now(),
			model,
			latencyMs,
			success,
			errorMessage: success ? undefined : (error instanceof Error ? error.message : String(error)),
		};

		this._telemetry.push(entry);
		if (this._telemetry.length > MAX_TELEMETRY_ENTRIES) {
			this._telemetry.shift();
		}

		this._onDidRecordTelemetry.fire(entry);
	}

	private _generateRequestId(): string {
		return `req_${++this._requestIdCounter}_${Date.now()}`;
	}

	/**
	 * Resolve the model identifier to send on the wire. The untouched `DEFAULT_CONFIG.model`
	 * placeholder is never sent (letting the engine pick its own default, matching prior
	 * behavior) unless the caller has explicitly configured a model or there's an active LoRA
	 * adapter, since Aphrodite validates `model` against served names and would otherwise
	 * reject the literal placeholder as an unknown model.
	 */
	private _resolveWireModel(model: string): string | undefined {
		if (model === this._config.model && !this._modelExplicitlySet && this._activeAdapterId === undefined) {
			return undefined;
		}
		return model;
	}

	private _isAbortError(error: unknown): boolean {
		return error instanceof Error && error.name === 'AbortError';
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
