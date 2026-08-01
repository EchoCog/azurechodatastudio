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
	/**
	 * API path for dynamically loading a LoRA adapter. Defaults to the
	 * vLLM-compatible `/v1/load_lora_adapter` that Aphrodite inherits from
	 * upstream; builds and forks that expose a different path (e.g.
	 * `/v1/lora/load`) can point this at theirs without a code change.
	 */
	loraLoadPath: string;
	/** API path for unloading a LoRA adapter. See {@link loraLoadPath}. */
	loraUnloadPath: string;
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
	/** Model description */
	description: string;
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
	/** LoRA adapter used (if any) */
	adapterId?: string;
	/**
	 * A/B test this request was routed through, if any. Variant IDs are only
	 * unique within a test, so results must be attributed by test *and*
	 * variant to avoid mixing counts across concurrently running tests.
	 */
	testId?: string;
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
	/** Time to first token in milliseconds (if measured) */
	timeToFirstTokenMs?: number;
	/** Total generation time in milliseconds (alias for latencyMs) */
	totalTimeMs?: number;
	/** Tokens generated per second */
	tokensPerSecond?: number;
	/** Whether speculative decoding was used */
	speculativeDecodingUsed?: boolean;
	/** Speculative decoding acceptance rate */
	speculativeAcceptanceRate?: number;
	/** Whether prompt cache was hit */
	promptCacheHit?: boolean;
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

/**
 * LoRA adapter information.
 */
export interface LoRAAdapterInfo {
	/** Adapter identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Adapter description */
	description: string;
	/** Adapter file path or URL */
	path: string;
	/** Scaling factor (typically 0.0-2.0) */
	scale: number;
	/** Whether the adapter is currently loaded */
	loaded: boolean;
	/** Number of trainable parameters */
	parameters: number;
	/** Base model this adapter is compatible with */
	baseModel: string;
}

/**
 * Aggregated performance metrics over a time window.
 */
export interface AphroditePerformanceMetrics {
	/** Time window in seconds */
	windowSeconds: number;
	/** Total requests in window */
	totalRequests: number;
	/** Successful requests */
	successfulRequests: number;
	/** Failed requests */
	failedRequests: number;
	/** Success rate (0-1) */
	successRate: number;
	/** Error rate (0-1) */
	errorRate: number;
	/** Average latency in ms */
	avgLatencyMs: number;
	/** P50 latency in ms */
	p50LatencyMs: number;
	/** P95 latency in ms */
	p95LatencyMs: number;
	/** P99 latency in ms */
	p99LatencyMs: number;
	/** Average time to first token in ms */
	avgTimeToFirstTokenMs: number;
	/** Average tokens per second */
	avgTokensPerSecond: number;
	/** Throughput in tokens per second */
	throughputTokensPerSec: number;
	/** Total tokens generated */
	totalTokensGenerated: number;
	/** Prompt cache hit rate */
	promptCacheHitRate: number;
	/** Speculative decoding usage rate */
	speculativeDecodingUsageRate: number;
	/** Average speculative acceptance rate */
	avgSpeculativeAcceptanceRate: number;
}

/**
 * A/B test variant configuration.
 */
export interface ABTestVariant {
	/** Variant identifier */
	id: string;
	/** Variant name */
	name: string;
	/** Model to use for this variant */
	model: string;
	/** LoRA adapter to use (optional) */
	adapterId?: string;
	/** Traffic weight (0-100) */
	weight: number;
	/** Variant-specific config overrides */
	configOverrides?: Partial<AphroditeConfig>;
}

/**
 * A/B test configuration.
 */
export interface ABTestConfig {
	/** Test identifier */
	testId: string;
	/** Test name */
	name: string;
	/** Test description */
	description: string;
	/** Variants in this test */
	variants: ABTestVariant[];
	/** Whether the test is active */
	active: boolean;
	/** Test start time */
	startTime: number;
	/** Test end time (optional) */
	endTime?: number;
}

/**
 * A/B test results.
 */
export interface ABTestResults {
	/** Test identifier */
	testId: string;
	/** Results per variant */
	variantResults: Map<string, AphroditePerformanceMetrics>;
	/** Statistical significance (p-value) for latency difference */
	latencySignificance?: number;
	/** Statistical significance for error rate difference */
	errorRateSignificance?: number;
	/** Recommended variant based on results */
	recommendedVariant?: string;
}

/**
 * Model fallback chain configuration.
 */
export interface ModelFallbackConfig {
	/** Primary model */
	primary: string;
	/** Fallback models in priority order */
	fallbacks: string[];
	/** Number of retries before falling back */
	retriesBeforeFallback: number;
	/** Timeout before falling back (ms) */
	timeoutBeforeFallbackMs: number;
	/** Whether to automatically re-enable primary after success */
	autoReenablePrimary: boolean;
	/** Time to wait before retrying primary (ms) */
	primaryReenableDelayMs: number;
}

/**
 * Current model fallback state.
 */
export interface ModelFallbackState {
	/** Currently active model */
	activeModel: string;
	/** Whether using a fallback model */
	usingFallback: boolean;
	/** Alias for usingFallback for compatibility */
	isUsingFallback: boolean;
	/** Number of consecutive failures on primary */
	primaryFailureCount: number;
	/** Alias for primaryFailureCount */
	consecutiveFailures: number;
	/** Current fallback index (0 = primary) */
	currentFallbackIndex: number;
	/** Time when primary was disabled */
	primaryDisabledAt?: number;
	/** Time when primary will be re-enabled */
	primaryReenableAt?: number;
	/** Last failure time */
	lastFailureTime?: number;
	/** Next retry time for primary */
	nextRetryTime?: number;
}

/**
 * Structured output (JSON schema) constraints for completions.
 */
export interface StructuredOutputConfig {
	/** JSON schema for the expected output */
	jsonSchema: object;
	/** Whether to enforce strict schema validation */
	strict: boolean;
	/** Maximum retries on schema validation failure */
	maxRetries: number;
}

/**
 * Prompt cache entry.
 */
export interface PromptCacheEntry {
	/** Cache key (hash of prompt prefix) */
	key: string;
	/** Cached KV state identifier */
	kvStateId: string;
	/** Number of tokens in the cached prefix */
	tokenCount: number;
	/** Last access time */
	lastAccessTime: number;
	/** Number of times this cache entry was used */
	hitCount: number;
}

/**
 * Prompt cache statistics.
 */
export interface PromptCacheStats {
	/** Total entries in cache */
	totalEntries: number;
	/** Number of entries (alias for totalEntries) */
	entryCount: number;
	/** Maximum entries allowed */
	maxEntries: number;
	/** Total tokens cached */
	totalTokensCached: number;
	/** Cache hit rate (0-1) */
	hitRate: number;
	/** Total cache hits */
	totalHits: number;
	/** Alias for totalHits */
	hitCount: number;
	/** Total cache misses */
	totalMisses: number;
	/** Alias for totalMisses */
	missCount: number;
	/** Estimated memory usage in bytes */
	memoryUsageBytes: number;
}

/**
 * Speculative decoding configuration.
 */
export interface SpeculativeDecodingConfig {
	/** Whether speculative decoding is enabled */
	enabled: boolean;
	/** Draft model for speculation */
	draftModel: string;
	/** Number of tokens to speculate */
	speculationLength: number;
	/** Minimum acceptance rate before disabling */
	minAcceptanceRate: number;
}

/**
 * Streaming token with timing telemetry.
 */
export interface AphroditeStreamTokenWithTiming extends AphroditeStreamToken {
	/** Token index in the sequence */
	tokenIndex: number;
	/** Time since request start in ms */
	elapsedMs: number;
	/** Inter-token latency in ms */
	interTokenLatencyMs: number;
	/** Whether this token was from speculative decoding */
	fromSpeculation: boolean;
}

export const IAphroditeService = createDecorator<IAphroditeService>('aphroditeService');

/**
 * Service for interacting with the Aphrodite LLM inference engine.
 * Provides streaming completions, batch inference, embeddings, LoRA adapters,
 * performance telemetry, A/B testing, model fallback chains, structured output,
 * prompt caching, and speculative decoding.
 */
export interface IAphroditeService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when a streaming token is received.
	 */
	readonly onDidReceiveStreamToken: Event<AphroditeStreamToken>;

	/**
	 * Event fired when a streaming token with timing telemetry is received.
	 */
	readonly onDidReceiveStreamTokenWithTiming: Event<AphroditeStreamTokenWithTiming>;

	/**
	 * Event fired when connection status changes.
	 */
	readonly onDidChangeConnectionStatus: Event<boolean>;

	/**
	 * Event fired when engine stats update.
	 */
	readonly onDidUpdateStats: Event<AphroditeEngineStats>;

	/**
	 * Event fired when request telemetry is recorded.
	 */
	readonly onDidRecordTelemetry: Event<AphroditeRequestTelemetry>;

	/**
	 * Event fired when a LoRA adapter is loaded or unloaded.
	 */
	readonly onDidChangeAdapter: Event<LoRAAdapterInfo | undefined>;

	/**
	 * Event fired when the model fallback state changes.
	 */
	readonly onDidChangeFallbackState: Event<ModelFallbackState>;

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
	 * Complete a prompt with streaming and token-level timing telemetry.
	 * Returns an async iterator of tokens with timing information.
	 */
	streamCompleteWithTiming(request: AphroditeCompletionRequest): AsyncIterable<AphroditeStreamTokenWithTiming>;

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
	 * Get all available models (alias for listModels).
	 */
	getAvailableModels(): Promise<AphroditeModelInfo[]>;

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
	 * Event fired when the set of loaded LoRA adapters changes.
	 */
	readonly onDidChangeAdapters: Event<AphroditeAdapterInfo[]>;

	// --- LoRA Adapter Management (A.1) ---

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
	 * Get the currently loaded LoRA adapter info (most recently loaded).
	 */
	getCurrentAdapter(): LoRAAdapterInfo | undefined;

	/**
	 * Swap the current LoRA adapter with a new one atomically.
	 */
	swapAdapter(adapterId: string, scale?: number): Promise<void>;

	// --- Performance Telemetry (A.1) ---

	/**
	 * Get recorded per-request telemetry, most recent first.
	 */
	getTelemetry(limit?: number): AphroditeRequestTelemetry[];

	/**
	 * Get aggregated telemetry statistics (latency, throughput, error rate).
	 */
	getTelemetrySummary(): AphroditeTelemetrySummary;

	/**
	 * Get performance metrics over a time window.
	 */
	getPerformanceMetrics(windowSeconds?: number): AphroditePerformanceMetrics;

	/**
	 * Get recent request telemetry records.
	 */
	getRecentTelemetry(limit?: number): AphroditeRequestTelemetry[];

	/**
	 * Clear recorded telemetry.
	 */
	clearTelemetry(): void;

	// --- Model Fallback (A.1) ---

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

	// --- A/B Testing (A.1) ---

	/**
	 * Register and activate an A/B test comparing model/adapter variants.
	 */
	startABTest(config: AphroditeABTestConfig): void;

	/**
	 * Deactivate a running A/B test. Recorded results remain queryable.
	 */
	stopABTest(testId: string): void;

	/**
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

	// --- Extended Fallback Chain (A.1) ---

	/**
	 * Configure the model fallback chain with extended options.
	 */
	setFallbackConfig(config: ModelFallbackConfig): void;

	/**
	 * Get the current fallback configuration.
	 */
	getFallbackConfig(): ModelFallbackConfig | undefined;

	/**
	 * Get the current fallback state.
	 */
	getFallbackState(): ModelFallbackState;

	/**
	 * Manually reset the fallback state to use the primary model.
	 */
	resetFallbackState(): void;

	// --- Structured Output (A.3) ---

	/**
	 * Complete with structured output (JSON schema constraints).
	 */
	completeStructured(request: AphroditeCompletionRequest, outputConfig: StructuredOutputConfig): Promise<AphroditeCompletionResponse>;

	// --- Prompt Caching (A.3) ---

	/**
	 * Get prompt cache statistics.
	 */
	getPromptCacheStats(): PromptCacheStats;

	/**
	 * Clear the prompt cache.
	 */
	clearPromptCache(): void;

	/**
	 * Pre-warm the prompt cache with a prompt prefix.
	 */
	preWarmPromptCache(promptPrefix: string): Promise<void>;

	// --- Speculative Decoding (A.3) ---

	/**
	 * Configure speculative decoding.
	 */
	setSpeculativeDecodingConfig(config: SpeculativeDecodingConfig): void;

	/**
	 * Get the current speculative decoding configuration.
	 */
	getSpeculativeDecodingConfig(): SpeculativeDecodingConfig | undefined;

	/**
	 * Check if speculative decoding is available.
	 */
	isSpeculativeDecodingAvailable(): Promise<boolean>;
}
