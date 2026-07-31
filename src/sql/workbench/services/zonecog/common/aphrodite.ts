/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

/**
 * Aphrodite Engine configuration options.
 */
export interface AphroditeConfig {
	/** Base URL for Aphrodite API (default: http://localhost:2242) */
	baseUrl: string;
	/** API key for authentication */
	apiKey?: string;
	/** Model name to use */
	model: string;
	/** Max tokens for generation */
	maxTokens: number;
	/** Temperature for sampling */
	temperature: number;
	/** Top-p for nucleus sampling */
	topP: number;
	/** Top-k for sampling */
	topK: number;
	/** Frequency penalty */
	frequencyPenalty: number;
	/** Presence penalty */
	presencePenalty: number;
	/** Request timeout in milliseconds */
	timeoutMs: number;
	/** Enable batch processing */
	batchingEnabled: boolean;
	/** Max batch size */
	maxBatchSize: number;
}

/**
 * Streaming token from Aphrodite.
 */
export interface AphroditeStreamToken {
	/** Generated token text */
	text: string;
	/** Token log probability */
	logprob?: number;
	/** Token ID */
	tokenId?: number;
	/** Whether this is the final token */
	finished: boolean;
	/** Finish reason if finished */
	finishReason?: 'length' | 'stop' | 'eos';
}

/**
 * Aphrodite completion request.
 */
export interface AphroditeCompletionRequest {
	/** Input prompt */
	prompt: string;
	/** Optional system prompt */
	systemPrompt?: string;
	/** Override max tokens */
	maxTokens?: number;
	/** Override temperature */
	temperature?: number;
	/** Stop sequences */
	stopSequences?: string[];
	/** Enable streaming */
	stream?: boolean;
	/** Request priority (0-10, higher = more important) */
	priority?: number;
	/** Request ID for tracking */
	requestId?: string;
}

/**
 * Aphrodite completion response.
 */
export interface AphroditeCompletionResponse {
	/** Generated text */
	text: string;
	/** Number of prompt tokens */
	promptTokens: number;
	/** Number of completion tokens */
	completionTokens: number;
	/** Total tokens */
	totalTokens: number;
	/** Finish reason */
	finishReason: 'length' | 'stop' | 'eos';
	/** Generation time in milliseconds */
	generationTimeMs: number;
	/** Model used */
	model: string;
}

/**
 * Batch inference request.
 */
export interface AphroditeBatchRequest {
	/** Batch ID */
	batchId: string;
	/** Requests in the batch */
	requests: AphroditeCompletionRequest[];
	/** Callback when individual request completes */
	onRequestComplete?: (index: number, response: AphroditeCompletionResponse) => void;
}

/**
 * Batch inference response.
 */
export interface AphroditeBatchResponse {
	/** Batch ID */
	batchId: string;
	/** Responses in order */
	responses: AphroditeCompletionResponse[];
	/** Total batch time in milliseconds */
	totalTimeMs: number;
	/** Any errors */
	errors: { index: number; error: string }[];
}

/**
 * Embedding request.
 */
export interface AphroditeEmbeddingRequest {
	/** Texts to embed */
	texts: string[];
	/** Model for embeddings (if different from chat model) */
	model?: string;
}

/**
 * Embedding response.
 */
export interface AphroditeEmbeddingResponse {
	/** Embeddings as 2D array */
	embeddings: number[][];
	/** Dimension of embeddings */
	dimension: number;
	/** Model used */
	model: string;
}

/**
 * Model information from Aphrodite.
 */
export interface AphroditeModelInfo {
	/** Model ID */
	id: string;
	/** Human-readable name */
	name: string;
	/** Context window size */
	contextLength: number;
	/** Whether model supports embeddings */
	supportsEmbeddings: boolean;
	/** Whether model is loaded */
	loaded: boolean;
	/** Memory usage in GB */
	memoryGb: number;
}

/**
 * Engine statistics.
 */
export interface AphroditeEngineStats {
	/** Requests per second */
	requestsPerSecond: number;
	/** Tokens per second */
	tokensPerSecond: number;
	/** Active requests */
	activeRequests: number;
	/** Queued requests */
	queuedRequests: number;
	/** GPU memory used (bytes) */
	gpuMemoryUsed: number;
	/** GPU memory total (bytes) */
	gpuMemoryTotal: number;
	/** GPU utilization percentage */
	gpuUtilization: number;
	/** Model cache size */
	kvCacheSize: number;
}

/**
 * A LoRA (Low-Rank Adaptation) adapter that can be dynamically loaded
 * into the Aphrodite engine without restarting or reloading the base model.
 */
export interface AphroditeLoraAdapter {
	/** Unique adapter identifier (also used as the LoRA name for requests) */
	id: string;
	/** Human-readable name */
	name: string;
	/** Filesystem or remote path the adapter was loaded from */
	path: string;
	/** Whether the adapter is currently loaded in the engine */
	loaded: boolean;
}

/**
 * Telemetry for a single inference request, used to build performance
 * dashboards and drive the automatic model fallback chain.
 */
export interface AphroditeRequestTelemetryEntry {
	/** When the request completed (epoch ms) */
	timestamp: number;
	/** Model that served (or attempted to serve) the request */
	model: string;
	/** Wall-clock latency in milliseconds */
	latencyMs: number;
	/** Whether the request succeeded */
	success: boolean;
	/** Error message when `success` is false */
	errorMessage?: string;
}

/**
 * Aggregated performance telemetry across recorded requests.
 */
export interface AphroditeTelemetrySummary {
	/** Total requests recorded (bounded ring buffer) */
	totalRequests: number;
	/** Successful requests */
	successCount: number;
	/** Failed requests */
	errorCount: number;
	/** errorCount / totalRequests, 0 when no requests recorded */
	errorRate: number;
	/** Average latency across successful requests, in milliseconds */
	avgLatencyMs: number;
	/** 95th percentile latency across successful requests, in milliseconds */
	p95LatencyMs: number;
	/** Requests per second over the trailing 60-second window */
	throughputPerSecond: number;
	/** When this summary was computed (epoch ms) */
	lastUpdated: number;
}

export const IAphroditeService = createDecorator<IAphroditeService>('aphroditeService');

/**
 * Service for interacting with the Aphrodite LLM inference engine.
 * Provides streaming completions, batch inference, and embeddings.
 */
export interface IAphroditeService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when a streaming token is received.
	 */
	readonly onDidReceiveStreamToken: Event<AphroditeStreamToken>;

	/**
	 * Event fired when connection status changes.
	 */
	readonly onDidChangeConnectionStatus: Event<boolean>;

	/**
	 * Event fired when engine stats update.
	 */
	readonly onDidUpdateStats: Event<AphroditeEngineStats>;

	/**
	 * Event fired after each inference request completes (success or failure),
	 * carrying the telemetry entry that was recorded for it.
	 */
	readonly onDidRecordTelemetry: Event<AphroditeRequestTelemetryEntry>;

	/**
	 * Initialize the service and connect to Aphrodite.
	 */
	initialize(config: Partial<AphroditeConfig>): Promise<void>;

	/**
	 * Check if connected to Aphrodite engine.
	 */
	isConnected(): boolean;

	/**
	 * Get current configuration.
	 */
	getConfig(): AphroditeConfig;

	/**
	 * Update configuration.
	 */
	updateConfig(config: Partial<AphroditeConfig>): void;

	/**
	 * Complete a prompt (non-streaming).
	 */
	complete(request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse>;

	/**
	 * Complete a prompt with streaming.
	 * Returns an async iterator of tokens.
	 */
	streamComplete(request: AphroditeCompletionRequest): AsyncIterable<AphroditeStreamToken>;

	/**
	 * Execute batch inference.
	 * More efficient for multiple requests.
	 */
	batchComplete(request: AphroditeBatchRequest): Promise<AphroditeBatchResponse>;

	/**
	 * Generate embeddings for texts.
	 */
	embed(request: AphroditeEmbeddingRequest): Promise<AphroditeEmbeddingResponse>;

	/**
	 * List available models.
	 */
	listModels(): Promise<AphroditeModelInfo[]>;

	/**
	 * Get current model info.
	 */
	getCurrentModel(): Promise<AphroditeModelInfo | undefined>;

	/**
	 * Switch to a different model.
	 */
	switchModel(modelId: string): Promise<void>;

	/**
	 * Get engine statistics.
	 */
	getStats(): Promise<AphroditeEngineStats>;

	/**
	 * Health check.
	 */
	healthCheck(): Promise<boolean>;

	/**
	 * Cancel a pending request.
	 */
	cancelRequest(requestId: string): void;

	/**
	 * Cancel all pending requests.
	 */
	cancelAllRequests(): void;

	/**
	 * Dynamically load a LoRA adapter into the running engine without
	 * reloading the base model. Becomes the active adapter on success.
	 */
	loadAdapter(request: { id: string; path: string; name?: string }): Promise<AphroditeLoraAdapter>;

	/**
	 * Unload a previously loaded LoRA adapter.
	 */
	unloadAdapter(adapterId: string): Promise<void>;

	/**
	 * List LoRA adapters loaded during this session.
	 */
	listAdapters(): AphroditeLoraAdapter[];

	/**
	 * Get the currently active LoRA adapter, if any.
	 */
	getActiveAdapter(): AphroditeLoraAdapter | undefined;

	/**
	 * Configure an ordered fallback chain of model IDs. When `complete()`
	 * fails against the configured model, subsequent models in the chain
	 * are attempted in order before the call fails.
	 */
	setFallbackChain(modelIds: string[]): void;

	/**
	 * Get the currently configured fallback chain.
	 */
	getFallbackChain(): string[];

	/**
	 * Get the most recently recorded request telemetry entries, most recent last.
	 */
	getRecentTelemetry(limit?: number): AphroditeRequestTelemetryEntry[];

	/**
	 * Get aggregated performance telemetry (latency, throughput, error rate).
	 */
	getTelemetrySummary(): AphroditeTelemetrySummary;
}
