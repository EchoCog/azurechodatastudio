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
	AphroditeRequestTelemetry,
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
	fallbackModels: [],
	maxTelemetrySamples: 200,
};

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

	private readonly _telemetry: AphroditeRequestTelemetry[] = [];

	private readonly _onDidReceiveStreamToken = this._register(new Emitter<AphroditeStreamToken>());
	readonly onDidReceiveStreamToken: Event<AphroditeStreamToken> = this._onDidReceiveStreamToken.event;

	private readonly _onDidChangeConnectionStatus = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionStatus: Event<boolean> = this._onDidChangeConnectionStatus.event;

	private readonly _onDidUpdateStats = this._register(new Emitter<AphroditeEngineStats>());
	readonly onDidUpdateStats: Event<AphroditeEngineStats> = this._onDidUpdateStats.event;

	private readonly _onDidUpdateTelemetry = this._register(new Emitter<AphroditeTelemetrySummary>());
	readonly onDidUpdateTelemetry: Event<AphroditeTelemetrySummary> = this._onDidUpdateTelemetry.event;

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
		this.membraneService.recordActivity('cerebral');

		const modelsToTry = this._buildModelAttemptList();
		let lastError: unknown;

		for (const model of modelsToTry) {
			const requestId = request.requestId ?? this._generateRequestId();
			const abortController = new AbortController();
			this._pendingRequests.set(requestId, abortController);

			const startTime = Date.now();

			try {
				const body: Record<string, unknown> = {
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
				};
				if (request.responseFormat?.type === 'json_schema') {
					body['guided_json'] = request.responseFormat.schema;
				}

				const response = await this._makeRequest('/v1/completions', body, abortController.signal);

				const generationTimeMs = Date.now() - startTime;
				this._pendingRequests.delete(requestId);

				const completionResponse: AphroditeCompletionResponse = {
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
					model,
					latencyMs: generationTimeMs,
					promptTokens: completionResponse.promptTokens,
					completionTokens: completionResponse.completionTokens,
					success: true,
					timestamp: Date.now(),
				});

				return completionResponse;
			} catch (error) {
				this._pendingRequests.delete(requestId);
				this._recordTelemetry({
					requestId,
					model,
					latencyMs: Date.now() - startTime,
					promptTokens: 0,
					completionTokens: 0,
					success: false,
					timestamp: Date.now(),
				});
				// A caller-initiated cancellation (cancelRequest/cancelAllRequests)
				// should stop the request outright, not fall through to the next
				// fallback model.
				if (error instanceof Error && error.name === 'AbortError') {
					throw error;
				}
				lastError = error;
			}
		}

		const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError);
		throw new Error(`Aphrodite completion failed for model(s) [${modelsToTry.join(', ')}]: ${lastErrorMessage}`);
	}

	async *streamComplete(request: AphroditeCompletionRequest): AsyncIterable<AphroditeStreamToken> {
		this.membraneService.recordActivity('cerebral');
		const requestId = request.requestId ?? this._generateRequestId();
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);

		const startTime = Date.now();
		// A loaded LoRA adapter is applied by sending its ID as the `model`
		// field, matching the priority used by complete()'s fallback chain.
		const model = this._activeAdapterId ?? this._config.model;
		let completionTokens = 0;
		let success = false;

		try {
			const body: Record<string, unknown> = {
				model,
				prompt: request.prompt,
				max_tokens: request.maxTokens ?? this._config.maxTokens,
				temperature: request.temperature ?? this._config.temperature,
				top_p: this._config.topP,
				top_k: this._config.topK,
				frequency_penalty: this._config.frequencyPenalty,
				presence_penalty: this._config.presencePenalty,
				stop: request.stopSequences,
				stream: true,
			};
			if (request.responseFormat?.type === 'json_schema') {
				body['guided_json'] = request.responseFormat.schema;
			}

			const response = await fetch(`${this._config.baseUrl}/v1/completions`, {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify(body),
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
							success = true;
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
								completionTokens++;
								this._onDidReceiveStreamToken.fire(token);
								yield token;
							}
						} catch {
							// Skip malformed JSON
						}
					}
				}
			}
			success = true;
		} finally {
			this._pendingRequests.delete(requestId);
			this._recordTelemetry({
				requestId,
				model,
				latencyMs: Date.now() - startTime,
				promptTokens: 0,
				completionTokens,
				success,
				timestamp: Date.now(),
			});
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

	async loadAdapter(adapter: { id: string; path: string; name?: string; baseModel?: string }): Promise<AphroditeAdapterInfo> {
		this.membraneService.recordActivity('cerebral');

		// vLLM-compatible dynamic LoRA endpoint (Aphrodite implements the same
		// OpenAI-compatible server surface); NOT `/v1/lora_adapters`, which
		// does not exist on either engine.
		await this._makeRequest('/v1/load_lora_adapter', {
			lora_name: adapter.id,
			lora_path: adapter.path,
		});

		const info: AphroditeAdapterInfo = {
			id: adapter.id,
			name: adapter.name ?? adapter.id,
			path: adapter.path,
			loaded: true,
			baseModel: adapter.baseModel,
		};
		this._adapters.set(adapter.id, info);
		this._activeAdapterId = adapter.id;
		this.logService.info(`[AphroditeService] Loaded adapter: ${adapter.id}`);
		return info;
	}

	async unloadAdapter(adapterId: string): Promise<void> {
		try {
			await this._makeRequest('/v1/unload_lora_adapter', { lora_name: adapterId });
		} catch (error) {
			// Unloading is a local-state operation first; log but do not
			// propagate a failed best-effort network call.
			this.logService.warn(`[AphroditeService] Failed to unload adapter '${adapterId}' on the engine: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this._adapters.delete(adapterId);
			if (this._activeAdapterId === adapterId) {
				this._activeAdapterId = undefined;
			}
		}
	}

	async listAdapters(): Promise<AphroditeAdapterInfo[]> {
		return Array.from(this._adapters.values());
	}

	getActiveAdapter(): AphroditeAdapterInfo | undefined {
		return this._activeAdapterId ? this._adapters.get(this._activeAdapterId) : undefined;
	}

	getTelemetry(): AphroditeTelemetrySummary {
		const samples = this._telemetry;
		const requestCount = samples.length;
		const errorCount = samples.filter(s => !s.success).length;
		const averageLatencyMs = requestCount > 0
			? samples.reduce((sum, s) => sum + s.latencyMs, 0) / requestCount
			: 0;

		const successfulSamples = samples.filter(s => s.success);
		const totalCompletionTokens = successfulSamples.reduce((sum, s) => sum + s.completionTokens, 0);
		const totalSuccessLatencySeconds = successfulSamples.reduce((sum, s) => sum + s.latencyMs, 0) / 1000;
		const tokensPerSecond = totalSuccessLatencySeconds > 0 ? totalCompletionTokens / totalSuccessLatencySeconds : 0;

		const errorRate = requestCount > 0 ? errorCount / requestCount : 0;

		return { requestCount, errorCount, averageLatencyMs, tokensPerSecond, errorRate };
	}

	getTelemetrySamples(): AphroditeRequestTelemetry[] {
		return [...this._telemetry];
	}

	private _buildModelAttemptList(): string[] {
		// A loaded LoRA adapter is applied by sending its ID as the `model`
		// field, so an active adapter takes priority over the base model,
		// falling back to the base model (and its own fallback chain) if the
		// adapter-routed request fails.
		const raw = [
			...(this._activeAdapterId ? [this._activeAdapterId] : []),
			this._config.model,
			...(this._config.fallbackModels ?? []),
		];
		const models: string[] = [];
		for (const model of raw) {
			if (models.length === 0 || models[models.length - 1] !== model) {
				models.push(model);
			}
		}
		return models;
	}

	private _recordTelemetry(sample: AphroditeRequestTelemetry): void {
		this._telemetry.push(sample);
		const maxSamples = this._config.maxTelemetrySamples ?? 200;
		while (this._telemetry.length > maxSamples) {
			this._telemetry.shift();
		}
		this._onDidUpdateTelemetry.fire(this.getTelemetry());
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
