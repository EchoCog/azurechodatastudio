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
 * A LoRA adapter known to the Aphrodite engine.
 */
export interface AphroditeAdapterInfo {
	/** Adapter identifier (the `lora_name` Aphrodite was given on load) */
	id: string;
	/** Filesystem or hub path the adapter was loaded from */
	path: string;
	/** Base model the adapter was loaded against */
	baseModel: string;
	/** Whether the adapter is currently loaded in the engine */
	loaded: boolean;
	/** Timestamp (ms) the adapter was loaded, if loaded */
	loadedAt?: number;
}

/**
 * Per-request telemetry captured for every completion attempt.
 */
export interface AphroditeRequestTelemetry {
	/** Request ID this telemetry entry corresponds to */
	requestId: string;
	/** Model (or adapter-qualified model) used for this attempt */
	model: string;
	/** A/B test variant ID this request was attributed to, if any */
	variantId?: string;
	/** End-to-end latency in milliseconds */
	latencyMs: number;
	/** Prompt tokens consumed, if known */
	promptTokens: number;
	/** Completion tokens generated, if known */
	completionTokens: number;
	/** Whether the attempt succeeded */
	success: boolean;
	/** Error message, if the attempt failed */
	errorMessage?: string;
	/** Timestamp (ms) the attempt completed */
	timestamp: number;
}

/**
 * Aggregated telemetry summary, overall and broken down by model.
 */
export interface AphroditeTelemetrySummary {
	/** Total completion attempts recorded */
	totalRequests: number;
	/** Attempts that succeeded */
	successCount: number;
	/** Attempts that failed */
	errorCount: number;
	/** Success rate in [0, 1]; 0 when no requests recorded */
	successRate: number;
	/** Mean latency across recorded attempts (ms) */
	avgLatencyMs: number;
	/** 95th percentile latency across recorded attempts (ms) */
	p95LatencyMs: number;
	/** Sum of prompt + completion tokens across recorded attempts */
	totalTokens: number;
	/** Per-model breakdown */
	byModel: Record<string, { requests: number; successRate: number; avgLatencyMs: number }>;
}

/**
 * A single variant in an A/B test: a candidate model/adapter and its
 * selection weight relative to the other variants in the same test.
 */
export interface AphroditeABTestVariant {
	/** Variant identifier, unique within the test */
	variantId: string;
	/** Model (or adapter) ID to route this variant's requests to */
	model: string;
	/** Relative selection weight (weights are normalized across variants) */
	weight: number;
}

/**
 * An A/B test comparing completion quality/performance across model variants.
 */
export interface AphroditeABTestConfig {
	/** Test identifier */
	testId: string;
	/** Candidate variants; at least 2 required for a meaningful comparison */
	variants: AphroditeABTestVariant[];
}

/**
 * Aggregated results for a single variant of a running or completed A/B test.
 */
export interface AphroditeABTestResult {
	/** Variant identifier */
	variantId: string;
	/** Model (or adapter) the variant routed to */
	model: string;
	/** Requests attributed to this variant */
	requestCount: number;
	/** Fraction of this variant's requests that succeeded, in [0, 1] */
	successRate: number;
	/** Mean latency for this variant's requests (ms) */
	avgLatencyMs: number;
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
	 * Event fired whenever a completion attempt's telemetry is recorded.
	 */
	readonly onDidRecordTelemetry: Event<AphroditeRequestTelemetry>;

	/**
	 * Event fired when the set of loaded LoRA adapters changes.
	 */
	readonly onDidChangeAdapters: Event<AphroditeAdapterInfo[]>;

	/**
	 * Dynamically load a LoRA adapter into the running engine.
	 */
	loadAdapter(adapterId: string, adapterPath: string): Promise<AphroditeAdapterInfo>;

	/**
	 * Unload a previously loaded LoRA adapter.
	 */
	unloadAdapter(adapterId: string): Promise<void>;

	/**
	 * List LoRA adapters known to this service (loaded this session).
	 */
	listAdapters(): AphroditeAdapterInfo[];

	/**
	 * Get recorded per-request telemetry, most recent first.
	 */
	getTelemetry(limit?: number): AphroditeRequestTelemetry[];

	/**
	 * Get aggregated telemetry statistics (latency, throughput, error rate).
	 */
	getTelemetrySummary(): AphroditeTelemetrySummary;

	/**
	 * Clear recorded telemetry.
	 */
	clearTelemetry(): void;

	/**
	 * Configure the ordered list of model IDs to try, in order, when a
	 * completion attempt fails. The currently configured model is always
	 * tried first regardless of this list.
	 */
	setFallbackChain(modelIds: string[]): void;

	/**
	 * Get the currently configured fallback chain.
	 */
	getFallbackChain(): string[];

	/**
	 * Complete a prompt, automatically retrying against the configured
	 * fallback chain if the primary model attempt fails. Every attempt is
	 * recorded as telemetry; throws only if every attempt fails.
	 */
	completeWithFallback(request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse>;

	/**
	 * Register and activate an A/B test comparing model/adapter variants.
	 */
	startABTest(config: AphroditeABTestConfig): void;

	/**
	 * Deactivate a running A/B test. Recorded results remain queryable.
	 */
	stopABTest(testId: string): void;

	/**
	 * Whether the given A/B test is currently active.
	 */
	isABTestActive(testId: string): boolean;

	/**
	 * Complete a prompt routed through an active A/B test's variant
	 * selection. Falls back to the configured default model if the test is
	 * unknown or inactive.
	 */
	completeViaABTest(testId: string, request: AphroditeCompletionRequest): Promise<AphroditeCompletionResponse>;

	/**
	 * Get aggregated per-variant results for an A/B test.
	 */
	getABTestResults(testId: string): AphroditeABTestResult[];
}
