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
	AphroditeABTestConfig,
	AphroditeABTestVariant,
	AphroditeABTestResult,
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

	private static readonly _MAX_TELEMETRY = 500;
	private _adapters: Map<string, AphroditeAdapterInfo> = new Map();
	private _telemetry: AphroditeRequestTelemetry[] = [];
	private _fallbackChain: string[] = [];
	private _abTests: Map<string, { config: AphroditeABTestConfig; active: boolean }> = new Map();

	private readonly _onDidReceiveStreamToken = this._register(new Emitter<AphroditeStreamToken>());
	readonly onDidReceiveStreamToken: Event<AphroditeStreamToken> = this._onDidReceiveStreamToken.event;

	private readonly _onDidChangeConnectionStatus = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionStatus: Event<boolean> = this._onDidChangeConnectionStatus.event;

	private readonly _onDidUpdateStats = this._register(new Emitter<AphroditeEngineStats>());
	readonly onDidUpdateStats: Event<AphroditeEngineStats> = this._onDidUpdateStats.event;

	private readonly _onDidRecordTelemetry = this._register(new Emitter<AphroditeRequestTelemetry>());
	readonly onDidRecordTelemetry: Event<AphroditeRequestTelemetry> = this._onDidRecordTelemetry.event;

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
	 * mutating the service's persistent configuration; `variantId` attributes
	 * the resulting telemetry entry to an A/B test variant.
	 */
	private async _completeInternal(request: AphroditeCompletionRequest, modelOverride?: string, variantId?: string): Promise<AphroditeCompletionResponse> {
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

	async loadAdapter(adapterId: string, adapterPath: string): Promise<AphroditeAdapterInfo> {
		this.membraneService.recordActivity('cerebral');

		await this._makeRequest('/v1/load_lora_adapter', {
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

		await this._makeRequest('/v1/unload_lora_adapter', {
			lora_name: adapterId,
		});

		this._adapters.delete(adapterId);
		this._onDidChangeAdapters.fire(this.listAdapters());
		this.logService.info(`[AphroditeService] Unloaded LoRA adapter '${adapterId}'`);
	}

	listAdapters(): AphroditeAdapterInfo[] {
		return Array.from(this._adapters.values());
	}

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

	clearTelemetry(): void {
		this._telemetry = [];
	}

	startABTest(config: AphroditeABTestConfig): void {
		if (config.variants.length < 2) {
			throw new Error('An A/B test requires at least 2 variants');
		}
		this._abTests.set(config.testId, { config, active: true });
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
		return this._completeInternal(request, variant.model, variant.variantId);
	}

	getABTestResults(testId: string): AphroditeABTestResult[] {
		const test = this._abTests.get(testId);
		if (!test) {
			return [];
		}

		return test.config.variants.map(variant => {
			const entries = this._telemetry.filter(t => t.variantId === variant.variantId);
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
