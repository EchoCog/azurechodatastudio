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
	/** Models to try in order if the primary model's completion request fails */
	fallbackModels?: string[];
	/** Max number of request telemetry samples retained in memory (ring buffer) */
	maxTelemetrySamples?: number;
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
	/** Structured output format; passed through as `guided_json` when set */
	responseFormat?: {
		type: 'json_schema';
		/** JSON schema the completion must conform to */
		schema: Record<string, unknown>;
	};
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
 * Information about a loaded (or loadable) LoRA adapter.
 */
export interface AphroditeAdapterInfo {
	/** Adapter ID (also used as its `lora_name`) */
	id: string;
	/** Human-readable name */
	name: string;
	/** Path the adapter was loaded from */
	path: string;
	/** Whether the adapter is currently loaded */
	loaded: boolean;
	/** Base model the adapter was trained against, if known */
	baseModel?: string;
}

/**
 * A single request's telemetry sample.
 */
export interface AphroditeRequestTelemetry {
	/** Request ID this sample corresponds to */
	requestId: string;
	/** Model used for the request */
	model: string;
	/** End-to-end latency in milliseconds */
	latencyMs: number;
	/** Number of prompt tokens */
	promptTokens: number;
	/** Number of completion tokens */
	completionTokens: number;
	/** Whether the request succeeded */
	success: boolean;
	/** Epoch milliseconds when the sample was recorded */
	timestamp: number;
}

/**
 * Aggregate telemetry summary computed from recorded request samples.
 */
export interface AphroditeTelemetrySummary {
	/** Total number of recorded requests */
	requestCount: number;
	/** Number of requests that failed */
	errorCount: number;
	/** Mean latency across all recorded requests, in milliseconds */
	averageLatencyMs: number;
	/** Aggregate completion tokens per second across successful requests */
	tokensPerSecond: number;
	/** Fraction of recorded requests that failed (0-1) */
	errorRate: number;
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
	 * Event fired when request telemetry updates.
	 */
	readonly onDidUpdateTelemetry: Event<AphroditeTelemetrySummary>;

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
	 * Load a LoRA adapter into the engine.
	 */
	loadAdapter(adapter: { id: string; path: string; name?: string; baseModel?: string }): Promise<AphroditeAdapterInfo>;

	/**
	 * Unload a previously loaded LoRA adapter.
	 */
	unloadAdapter(adapterId: string): Promise<void>;

	/**
	 * List locally tracked LoRA adapters. Resolves synchronously against local
	 * state (there is no dedicated list endpoint) but returns a Promise for
	 * API consistency with the other adapter-management methods.
	 */
	listAdapters(): Promise<AphroditeAdapterInfo[]>;

	/**
	 * Get the currently active LoRA adapter, if any.
	 */
	getActiveAdapter(): AphroditeAdapterInfo | undefined;

	/**
	 * Get the aggregate request telemetry summary.
	 */
	getTelemetry(): AphroditeTelemetrySummary;

	/**
	 * Get a copy of the recorded per-request telemetry samples.
	 */
	getTelemetrySamples(): AphroditeRequestTelemetry[];
}
