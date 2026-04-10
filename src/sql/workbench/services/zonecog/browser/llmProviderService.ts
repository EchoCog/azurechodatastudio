/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ILLMProviderService,
	LLMProviderConfig,
	LLMCompletionRequest,
	LLMCompletionResponse
} from 'sql/workbench/services/zonecog/common/llmProvider';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Built-in fallback provider ID used when no external LLM is configured.
 */
const BUILTIN_PROVIDER_ID = 'builtin-fallback';

/**
 * Default built-in provider configuration.
 */
const BUILTIN_CONFIG: LLMProviderConfig = {
	id: BUILTIN_PROVIDER_ID,
	displayName: 'Built-in (Rule-Based)',
	baseUrl: '',
	model: 'rule-based',
	maxContextLength: 4096,
};

/**
 * LLM Provider Service implementation with pluggable backends.
 *
 * Ships with a rule-based built-in fallback so the cognitive protocol
 * works out-of-the-box without any external API keys. External providers
 * (OpenAI-compatible, Aphrodite Engine, local models) can be registered
 * at runtime.
 */
export class LLMProviderService extends Disposable implements ILLMProviderService {

	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, LLMProviderConfig>();
	private _activeProviderId: string;

	private readonly _onDidChangeProvider = this._register(new Emitter<LLMProviderConfig>());
	readonly onDidChangeProvider: Event<LLMProviderConfig> = this._onDidChangeProvider.event;

	private readonly _onDidChangeAvailability = this._register(new Emitter<{ providerId: string; available: boolean }>());
	readonly onDidChangeAvailability: Event<{ providerId: string; available: boolean }> = this._onDidChangeAvailability.event;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Register the built-in fallback
		this._providers.set(BUILTIN_PROVIDER_ID, BUILTIN_CONFIG);
		this._activeProviderId = BUILTIN_PROVIDER_ID;

		this.logService.info('LLMProviderService: initialized with built-in fallback provider');
	}

	// -- Provider management -------------------------------------------------

	registerProvider(config: LLMProviderConfig): boolean {
		if (this._providers.has(config.id)) {
			this.logService.warn(`LLMProviderService: provider '${config.id}' already registered`);
			return false;
		}
		this._providers.set(config.id, config);
		this._onDidChangeAvailability.fire({ providerId: config.id, available: true });
		this.logService.info(`LLMProviderService: registered provider '${config.displayName}' (${config.id})`);
		return true;
	}

	unregisterProvider(id: string): boolean {
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

	getProviders(): LLMProviderConfig[] {
		return Array.from(this._providers.values());
	}

	getActiveProvider(): LLMProviderConfig {
		return this._providers.get(this._activeProviderId) ?? BUILTIN_CONFIG;
	}

	setActiveProvider(id: string): boolean {
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

	isExternalProviderActive(): boolean {
		return this._activeProviderId !== BUILTIN_PROVIDER_ID;
	}

	// -- Completion ----------------------------------------------------------

	async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
		const provider = this.getActiveProvider();

		if (provider.id === BUILTIN_PROVIDER_ID) {
			return this._builtinComplete(request);
		}

		try {
			return await this._externalComplete(provider, request);
		} catch (err) {
			this.logService.warn(`LLMProviderService: external provider '${provider.id}' failed, falling back`, err);
			return this._builtinComplete(request);
		}
	}

	// -- Built-in rule-based fallback ----------------------------------------

	private _builtinComplete(request: LLMCompletionRequest): LLMCompletionResponse {
		const query = request.userMessage;
		const isQuestion = query.includes('?');
		const isAnalysis = /\b(analyze|compare|synthesize|evaluate|optimize)\b/i.test(query);
		const isRequest = /\b(please|can you|could you|help|show|explain)\b/i.test(query);

		let content: string;
		if (isAnalysis) {
			content =
				`Based on comprehensive analysis of your request, I've considered multiple dimensions ` +
				`and perspectives. The key findings from examining "${query.substring(0, 80)}" suggest ` +
				`several actionable insights within the Zone-Cog cognitive workbench. ` +
				`I'd recommend exploring the hypergraph representation of related data structures ` +
				`for deeper pattern recognition.`;
		} else if (isQuestion) {
			content =
				`After careful consideration through the Zone-Cog cognitive protocol, ` +
				`here's my analysis: ${query.substring(0, 120)} ` +
				`This relates to data management and analysis within the cognitive workbench environment.`;
		} else if (isRequest) {
			content =
				`I understand your request regarding: ${query.substring(0, 80)}. ` +
				`The Zone-Cog cognitive framework provides several tools for this type of task.`;
		} else {
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

	// -- External provider (OpenAI-compatible) --------------------------------

	private async _externalComplete(
		provider: LLMProviderConfig,
		request: LLMCompletionRequest
	): Promise<LLMCompletionResponse> {
		const url = `${provider.baseUrl}/v1/chat/completions`;

		const messages: Array<{ role: string; content: string }> = [
			{ role: 'system', content: request.systemPrompt },
		];
		if (request.thinkingContext) {
			messages.push({ role: 'assistant', content: request.thinkingContext });
		}
		messages.push({ role: 'user', content: request.userMessage });

		const headers: Record<string, string> = {
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
}
