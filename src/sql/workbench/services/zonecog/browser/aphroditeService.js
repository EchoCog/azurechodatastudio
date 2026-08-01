"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
	var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
	else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
	return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
	return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AphroditeService = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
/**
 * Default Aphrodite configuration.
 */
const DEFAULT_CONFIG = {
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
let AphroditeService = class AphroditeService extends lifecycle_1.Disposable {
	logService;
	membraneService;
	_serviceBrand;
	_config;
	_connected = false;
	_pendingRequests = new Map();
	_requestIdCounter = 0;
	_onDidReceiveStreamToken = this._register(new event_1.Emitter());
	onDidReceiveStreamToken = this._onDidReceiveStreamToken.event;
	_onDidChangeConnectionStatus = this._register(new event_1.Emitter());
	onDidChangeConnectionStatus = this._onDidChangeConnectionStatus.event;
	_onDidUpdateStats = this._register(new event_1.Emitter());
	onDidUpdateStats = this._onDidUpdateStats.event;
	constructor(logService, membraneService) {
		super();
		this.logService = logService;
		this.membraneService = membraneService;
		this._config = { ...DEFAULT_CONFIG };
		this.logService.info('[AphroditeService] Initialized with default config');
	}
	async initialize(config) {
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
			}
			else {
				this.logService.warn('[AphroditeService] Aphrodite engine not available');
			}
		}
		catch (error) {
			this.logService.error(`[AphroditeService] Connection failed: ${error}`);
			this._connected = false;
			this._onDidChangeConnectionStatus.fire(false);
		}
	}
	isConnected() {
		return this._connected;
	}
	getConfig() {
		return { ...this._config };
	}
	updateConfig(config) {
		this._config = { ...this._config, ...config };
		this.logService.info('[AphroditeService] Config updated');
	}
	async complete(request) {
		this.membraneService.recordActivity('cerebral');
		const requestId = request.requestId ?? this._generateRequestId();
		const abortController = new AbortController();
		this._pendingRequests.set(requestId, abortController);
		const startTime = Date.now();
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
			}, abortController.signal);
			const generationTimeMs = Date.now() - startTime;
			this._pendingRequests.delete(requestId);
			return {
				text: response.choices[0]?.text ?? '',
				promptTokens: response.usage?.prompt_tokens ?? 0,
				completionTokens: response.usage?.completion_tokens ?? 0,
				totalTokens: response.usage?.total_tokens ?? 0,
				finishReason: response.choices[0]?.finish_reason ?? 'stop',
				generationTimeMs,
				model: response.model ?? this._config.model,
			};
		}
		catch (error) {
			this._pendingRequests.delete(requestId);
			throw error;
		}
	}
	async *streamComplete(request) {
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
							const token = {
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
								const token = {
									text: choice.text ?? '',
									logprob: choice.logprobs?.token_logprobs?.[0],
									tokenId: choice.logprobs?.tokens?.[0],
									finished: choice.finish_reason !== null,
									finishReason: choice.finish_reason,
								};
								this._onDidReceiveStreamToken.fire(token);
								yield token;
							}
						}
						catch {
							// Skip malformed JSON
						}
					}
				}
			}
		}
		finally {
			this._pendingRequests.delete(requestId);
		}
	}
	async batchComplete(request) {
		this.membraneService.recordActivity('cerebral');
		const startTime = Date.now();
		const responses = [];
		const errors = [];
		// Process in batches
		const batches = this._chunkArray(request.requests, this._config.maxBatchSize);
		for (const batch of batches) {
			const promises = batch.map(async (req, localIndex) => {
				const globalIndex = request.requests.indexOf(req);
				try {
					const response = await this.complete(req);
					responses[globalIndex] = response;
					request.onRequestComplete?.(globalIndex, response);
				}
				catch (error) {
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
	async embed(request) {
		this.membraneService.recordActivity('cerebral');
		const response = await this._makeRequest('/v1/embeddings', {
			input: request.texts,
			model: request.model ?? this._config.model,
		});
		const embeddings = response.data?.map((d) => d.embedding) ?? [];
		return {
			embeddings,
			dimension: embeddings[0]?.length ?? 0,
			model: response.model ?? this._config.model,
		};
	}
	async listModels() {
		const response = await this._makeRequest('/v1/models', undefined, undefined, 'GET');
		return (response.data ?? []).map((model) => ({
			id: model.id,
			name: model.id,
			contextLength: model.context_length ?? 4096,
			supportsEmbeddings: model.capabilities?.embeddings ?? false,
			loaded: model.status === 'loaded',
			memoryGb: (model.memory_usage ?? 0) / 1e9,
		}));
	}
	async getCurrentModel() {
		const models = await this.listModels();
		return models.find(m => m.loaded);
	}
	async switchModel(modelId) {
		this.membraneService.recordActivity('cerebral');
		this._config.model = modelId;
		// In a real implementation, this would send a request to load the model
		this.logService.info(`[AphroditeService] Switched to model: ${modelId}`);
	}
	async getStats() {
		try {
			const response = await this._makeRequest('/v1/stats', undefined, undefined, 'GET');
			const stats = {
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
		}
		catch {
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
	async healthCheck() {
		try {
			const response = await fetch(`${this._config.baseUrl}/health`, {
				method: 'GET',
				headers: this._getHeaders(),
				signal: AbortSignal.timeout(5000),
			});
			return response.ok;
		}
		catch {
			return false;
		}
	}
	cancelRequest(requestId) {
		const controller = this._pendingRequests.get(requestId);
		if (controller) {
			controller.abort();
			this._pendingRequests.delete(requestId);
			this.logService.info(`[AphroditeService] Cancelled request: ${requestId}`);
		}
	}
	cancelAllRequests() {
		for (const [requestId, controller] of this._pendingRequests) {
			controller.abort();
			this._pendingRequests.delete(requestId);
		}
		this.logService.info('[AphroditeService] Cancelled all requests');
	}
	_generateRequestId() {
		return `req_${++this._requestIdCounter}_${Date.now()}`;
	}
	_getHeaders() {
		const headers = {
			'Content-Type': 'application/json',
		};
		if (this._config.apiKey) {
			headers['Authorization'] = `Bearer ${this._config.apiKey}`;
		}
		return headers;
	}
	async _makeRequest(path, body, signal, method = 'POST') {
		const url = `${this._config.baseUrl}${path}`;
		const options = {
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
	_chunkArray(array, size) {
		const chunks = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}
};
exports.AphroditeService = AphroditeService;
exports.AphroditeService = AphroditeService = __decorate([
	__param(0, log_1.ILogService),
	__param(1, zonecogService_1.ICognitiveMembraneService)
], AphroditeService);
