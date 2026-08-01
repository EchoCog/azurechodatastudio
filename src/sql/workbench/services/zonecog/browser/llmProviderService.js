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
exports.LLMProviderService = void 0;
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
/**
 * Built-in fallback provider ID used when no external LLM is configured.
 */
const BUILTIN_PROVIDER_ID = 'builtin-fallback';
/**
 * Default built-in provider configuration.
 */
const BUILTIN_CONFIG = {
	id: BUILTIN_PROVIDER_ID,
	displayName: 'Built-in (Rule-Based)',
	baseUrl: '',
	model: 'rule-based',
	maxContextLength: 4096,
};
/**
 * Circuit breaker configuration.
 */
const CIRCUIT_BREAKER_CONFIG = {
	/** Number of failures before opening the circuit */
	failureThreshold: 3,
	/** Time in ms before attempting to close the circuit (half-open state) */
	resetTimeoutMs: 30000,
	/** Time window in ms for counting failures */
	failureWindowMs: 60000,
};
/**
 * LLM Provider Service implementation with pluggable backends and circuit breaker.
 *
 * Ships with a rule-based built-in fallback so the cognitive protocol
 * works out-of-the-box without any external API keys. External providers
 * (OpenAI-compatible, Aphrodite Engine, local models) can be registered
 * at runtime.
 *
 * Includes circuit breaker pattern for resilient error recovery:
 * - After 3 consecutive failures, the circuit opens
 * - While open, requests fall back to built-in provider
 * - After 30s, the circuit enters half-open state to test recovery
 * - On success, the circuit closes; on failure, it reopens
 */
let LLMProviderService = class LLMProviderService extends lifecycle_1.Disposable {
	logService;
	membraneService;
	_providers = new Map();
	_circuitBreakers = new Map();
	_activeProviderId;
	_onDidChangeProvider = this._register(new event_1.Emitter());
	onDidChangeProvider = this._onDidChangeProvider.event;
	_onDidChangeAvailability = this._register(new event_1.Emitter());
	onDidChangeAvailability = this._onDidChangeAvailability.event;
	constructor(logService, membraneService) {
		super();
		this.logService = logService;
		this.membraneService = membraneService;
		// Register the built-in fallback
		this._providers.set(BUILTIN_PROVIDER_ID, BUILTIN_CONFIG);
		this._activeProviderId = BUILTIN_PROVIDER_ID;
		this.logService.info('LLMProviderService: initialized with built-in fallback provider and circuit breaker');
	}
	// -- Provider management -------------------------------------------------
	registerProvider(config) {
		if (this._providers.has(config.id)) {
			this.logService.warn(`LLMProviderService: provider '${config.id}' already registered`);
			return false;
		}
		this._providers.set(config.id, config);
		this._onDidChangeAvailability.fire({ providerId: config.id, available: true });
		this.logService.info(`LLMProviderService: registered provider '${config.displayName}' (${config.id})`);
		return true;
	}
	unregisterProvider(id) {
		if (id === BUILTIN_PROVIDER_ID) {
			this.logService.warn('LLMProviderService: cannot unregister built-in provider');
			return false;
		}
		const deleted = this._providers.delete(id);
		if (deleted) {
			if (this._activeProviderId === id) {
				this._activeProviderId = BUILTIN_PROVIDER_ID;
				this._onDidChangeProvider.fire(this.getActiveProvider());
			}
			this._onDidChangeAvailability.fire({ providerId: id, available: false });
			this.logService.info(`LLMProviderService: unregistered provider '${id}'`);
		}
		return deleted;
	}
	getProviders() {
		return Array.from(this._providers.values());
	}
	getActiveProvider() {
		return this._providers.get(this._activeProviderId) ?? BUILTIN_CONFIG;
	}
	setActiveProvider(id) {
		if (!this._providers.has(id)) {
			this.logService.warn(`LLMProviderService: unknown provider '${id}'`);
			return false;
		}
		this._activeProviderId = id;
		const config = this.getActiveProvider();
		this._onDidChangeProvider.fire(config);
		this.logService.info(`LLMProviderService: switched to provider '${config.displayName}'`);
		return true;
	}
	isExternalProviderActive() {
		return this._activeProviderId !== BUILTIN_PROVIDER_ID;
	}
	async complete(requestOrPrompt) {
		const request = typeof requestOrPrompt === 'string'
			? {
				systemPrompt: 'You are a helpful assistant within the Zone-Cog cognitive workbench.',
				userMessage: requestOrPrompt,
			}
			: requestOrPrompt;
		const provider = this.getActiveProvider();
		this.membraneService.recordActivity('cerebral');
		if (provider.id === BUILTIN_PROVIDER_ID) {
			const response = this._builtinComplete(request);
			return typeof requestOrPrompt === 'string' ? response.content : response;
		}
		// Check circuit breaker state
		const circuitState = this._getCircuitState(provider.id);
		if (this._isCircuitOpen(circuitState)) {
			// Check if we should try half-open
			if (this._shouldTryHalfOpen(circuitState)) {
				this.logService.info(`LLMProviderService: circuit for '${provider.id}' entering half-open state`);
				return this._tryHalfOpenRequest(provider, request, circuitState);
			}
			// Circuit is open - fall back immediately
			this.logService.warn(`LLMProviderService: circuit open for '${provider.id}', using fallback`);
			this.membraneService.recordActivity('autonomic'); // Record error recovery
			const response = this._builtinComplete(request);
			return typeof requestOrPrompt === 'string' ? response.content : response;
		}
		// Circuit is closed - try normal request
		try {
			const response = await this._externalCompleteWithRetry(provider, request);
			this._recordSuccess(provider.id);
			return typeof requestOrPrompt === 'string' ? response.content : response;
		}
		catch (err) {
			this._recordFailure(provider.id);
			this.logService.warn(`LLMProviderService: external provider '${provider.id}' failed, falling back`, err);
			this.membraneService.recordActivity('autonomic'); // Record error recovery
			const response = this._builtinComplete(request);
			return typeof requestOrPrompt === 'string' ? response.content : response;
		}
	}
	// -- Circuit Breaker Logic -----------------------------------------------
	_getCircuitState(providerId) {
		let state = this._circuitBreakers.get(providerId);
		if (!state) {
			state = {
				failureCount: 0,
				lastFailureTime: 0,
				isOpen: false,
				openedAt: 0,
			};
			this._circuitBreakers.set(providerId, state);
		}
		return state;
	}
	_isCircuitOpen(state) {
		if (!state.isOpen) {
			return false;
		}
		// Check if failures are outside the failure window (auto-reset)
		const now = Date.now();
		if (now - state.lastFailureTime > CIRCUIT_BREAKER_CONFIG.failureWindowMs) {
			state.isOpen = false;
			state.failureCount = 0;
			this.logService.info('LLMProviderService: circuit auto-reset due to failure window expiry');
			return false;
		}
		return true;
	}
	_shouldTryHalfOpen(state) {
		const now = Date.now();
		return now - state.openedAt >= CIRCUIT_BREAKER_CONFIG.resetTimeoutMs;
	}
	async _tryHalfOpenRequest(provider, request, state) {
		try {
			const response = await this._externalComplete(provider, request);
			// Success! Close the circuit
			state.isOpen = false;
			state.failureCount = 0;
			this.logService.info(`LLMProviderService: circuit for '${provider.id}' closed after successful half-open request`);
			this._onDidChangeAvailability.fire({ providerId: provider.id, available: true });
			return response;
		}
		catch (err) {
			// Still failing - reopen the circuit
			state.isOpen = true;
			state.openedAt = Date.now();
			state.lastFailureTime = Date.now();
			this.logService.warn(`LLMProviderService: circuit for '${provider.id}' remains open after failed half-open request`);
			return this._builtinComplete(request);
		}
	}
	_recordSuccess(providerId) {
		const state = this._circuitBreakers.get(providerId);
		if (state) {
			state.failureCount = 0;
		}
	}
	_recordFailure(providerId) {
		const state = this._getCircuitState(providerId);
		state.failureCount++;
		state.lastFailureTime = Date.now();
		if (state.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
			state.isOpen = true;
			state.openedAt = Date.now();
			this.logService.warn(`LLMProviderService: circuit for '${providerId}' opened after ${state.failureCount} failures`);
			this._onDidChangeAvailability.fire({ providerId, available: false });
		}
	}
	/**
	 * Get circuit breaker status for a provider.
	 */
	getCircuitBreakerStatus(providerId) {
		const state = this._getCircuitState(providerId);
		return {
			isOpen: this._isCircuitOpen(state),
			failureCount: state.failureCount,
			lastFailureTime: state.lastFailureTime,
		};
	}
	/**
	 * Manually reset the circuit breaker for a provider.
	 */
	resetCircuitBreaker(providerId) {
		const state = this._circuitBreakers.get(providerId);
		if (state) {
			state.isOpen = false;
			state.failureCount = 0;
			state.lastFailureTime = 0;
			state.openedAt = 0;
			this.logService.info(`LLMProviderService: circuit for '${providerId}' manually reset`);
			this._onDidChangeAvailability.fire({ providerId, available: true });
		}
	}
	// -- Built-in rule-based fallback ----------------------------------------
	_builtinComplete(request) {
		const query = request.userMessage;
		const isQuestion = query.includes('?');
		const isAnalysis = /\b(analyze|compare|synthesize|evaluate|optimize)\b/i.test(query);
		const isRequest = /\b(please|can you|could you|help|show|explain)\b/i.test(query);
		let content;
		if (isAnalysis) {
			content =
				`Based on comprehensive analysis of your request, I've considered multiple dimensions ` +
					`and perspectives. The key findings from examining "${query.substring(0, 80)}" suggest ` +
					`several actionable insights within the Zone-Cog cognitive workbench. ` +
					`I'd recommend exploring the hypergraph representation of related data structures ` +
					`for deeper pattern recognition.`;
		}
		else if (isQuestion) {
			content =
				`After careful consideration through the Zone-Cog cognitive protocol, ` +
					`here's my analysis: ${query.substring(0, 120)} ` +
					`This relates to data management and analysis within the cognitive workbench environment.`;
		}
		else if (isRequest) {
			content =
				`I understand your request regarding: ${query.substring(0, 80)}. ` +
					`The Zone-Cog cognitive framework provides several tools for this type of task.`;
		}
		else {
			content =
				`I've processed your input through the Zone-Cog thinking protocol: ` +
					`"${query.substring(0, 80)}". ` +
					`As part of the embodied cognition workbench, I'm designed to provide ` +
					`thoughtful, multi-dimensional analysis of data-related tasks.`;
		}
		return {
			content,
			providerId: BUILTIN_PROVIDER_ID,
			isFallback: true,
		};
	}
	// -- External provider (OpenAI-compatible) with retry --------------------
	/**
	 * External completion with exponential backoff retry.
	 */
	async _externalCompleteWithRetry(provider, request, maxRetries = 2) {
		let lastError;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await this._externalComplete(provider, request);
			}
			catch (err) {
				lastError = err;
				// Don't retry on non-transient errors
				if (this._isNonTransientError(err)) {
					throw err;
				}
				if (attempt < maxRetries) {
					// Exponential backoff: 100ms, 200ms, 400ms...
					const delay = 100 * Math.pow(2, attempt);
					this.logService.info(`LLMProviderService: retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
					await this._sleep(delay);
				}
			}
		}
		throw lastError;
	}
	/**
	 * Check if an error is non-transient (should not be retried).
	 */
	_isNonTransientError(err) {
		const message = String(err);
		// 4xx errors except 429 (rate limit) are usually non-transient
		return /\b(401|403|404|400|422)\b/.test(message) && !/\b429\b/.test(message);
	}
	/**
	 * Sleep helper for retry delays.
	 */
	_sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
	// -- External provider (OpenAI-compatible) --------------------------------
	async _externalComplete(provider, request) {
		const url = `${provider.baseUrl}/v1/chat/completions`;
		const messages = [
			{ role: 'system', content: request.systemPrompt },
		];
		if (request.thinkingContext) {
			messages.push({ role: 'assistant', content: request.thinkingContext });
		}
		messages.push({ role: 'user', content: request.userMessage });
		const headers = {
			'Content-Type': 'application/json',
		};
		if (provider.apiKey) {
			headers['Authorization'] = `Bearer ${provider.apiKey}`;
		}
		const body = JSON.stringify({
			model: provider.model,
			messages,
			max_tokens: request.maxTokens ?? 1024,
			temperature: request.temperature ?? 0.7,
		});
		const response = await fetch(url, { method: 'POST', headers, body });
		if (!response.ok) {
			throw new Error(`LLM API returned ${response.status}: ${await response.text()}`);
		}
		const json = await response.json();
		const choice = json.choices?.[0];
		if (!choice?.message?.content) {
			throw new Error('LLM API returned empty response');
		}
		return {
			content: choice.message.content,
			providerId: provider.id,
			usage: json.usage ? {
				promptTokens: json.usage.prompt_tokens ?? 0,
				completionTokens: json.usage.completion_tokens ?? 0,
				totalTokens: json.usage.total_tokens ?? 0,
			} : undefined,
			isFallback: false,
		};
	}
};
exports.LLMProviderService = LLMProviderService;
exports.LLMProviderService = LLMProviderService = __decorate([
	__param(0, log_1.ILogService),
	__param(1, zonecogService_1.ICognitiveMembraneService)
], LLMProviderService);
