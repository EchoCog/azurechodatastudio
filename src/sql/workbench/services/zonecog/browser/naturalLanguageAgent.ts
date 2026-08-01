/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	INaturalLanguageAgent,
	NLTranslationResult,
	NLIntentClassification,
	NLIntent,
	NLEntityReference,
} from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { AgentCapabilities, AgentStatus, AgentAction } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { ICognitiveMembraneService, IHypergraphStore, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

/** Keyword signal sets used for lexical intent classification. */
const INTENT_SIGNALS: { intent: NLIntent; keywords: RegExp[] }[] = [
	{
		intent: 'data_mutation',
		keywords: [/\b(insert|add|create a? ?(new )?(row|record)|update|change|modify|set)\b/i, /\b(delete|remove|drop the (row|record))\b/i],
	},
	{
		intent: 'schema_definition',
		keywords: [/\b(create|define|design|add) (a |an |the )?(table|view|index|schema|column|database)\b/i, /\b(alter|migrate) (the )?(table|schema)\b/i],
	},
	{
		intent: 'optimization',
		keywords: [/\b(optimi[sz]e|speed up|faster|slow|performance|tune|index suggestion)\b/i],
	},
	{
		intent: 'explanation',
		keywords: [/\b(explain|what does|describe|meaning of|understand)\b/i],
	},
	{
		intent: 'data_query',
		keywords: [/\b(show|list|find|get|count|how many|total|average|sum|select|top|report|which|who|where|when)\b/i],
	},
];

/**
 * Natural Language Agent Implementation.
 *
 * The fifth cognitive agent of the AAR multi-agent extension set: translates
 * natural language into SQL (and back) via the LLM provider, grounded with
 * lexical intent classification and entity extraction so that translations
 * carry structured cognitive metadata into the hypergraph.
 */
export class NaturalLanguageAgent extends Disposable implements INaturalLanguageAgent {
	readonly _serviceBrand: undefined;

	readonly id: string = 'natural-language-agent';
	readonly name: string = 'Natural Language Translator';
	readonly description: string = 'Natural language to SQL translation via LLM';

	private _status: AgentStatus = 'idle';
	private _currentLoad: number = 0;

	private readonly _onDidChangeStatus = this._register(new Emitter<AgentStatus>());
	readonly onDidChangeStatus: Event<AgentStatus> = this._onDidChangeStatus.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILLMProviderService private readonly llmService: ILLMProviderService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super();
		this.logService.info('[NaturalLanguageAgent] Initialized');
	}

	getCapabilities(): AgentCapabilities {
		return {
			canPerceive: true,
			canReason: true,
			canAct: true,
			supportedActions: ['translate_to_sql', 'explain_sql', 'classify_intent', 'extract_entities'],
			maxConcurrentTasks: 3,
		};
	}

	getStatus(): AgentStatus {
		return this._status;
	}

	getCurrentLoad(): number {
		return this._currentLoad;
	}

	async perceive(input: any): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		if (typeof input === 'string' && input.trim().length > 0) {
			const classification = this.classifyIntent(input);
			const node: Omit<HypergraphNode, 'id'> = {
				node_type: 'nl_utterance',
				content: input,
				links: [],
				metadata: {
					perceived_at: Date.now(),
					agent: this.id,
					intent: classification.intent,
					intent_confidence: classification.confidence,
				},
				salience_score: Math.min(1, 0.4 + classification.confidence * 0.4),
			};
			await this.hypergraphStore.addNode(node);
		}
	}

	async decide(context: any): Promise<AgentAction | null> {
		this.membraneService.recordActivity('cerebral');

		if (context && typeof context.utterance === 'string' && context.utterance.trim().length > 0) {
			const classification = this.classifyIntent(context.utterance);
			if (classification.intent === 'explanation' && typeof context.sql === 'string') {
				return {
					action: 'explain_sql',
					target: context.sql,
					parameters: {},
					confidence: classification.confidence,
				};
			}
			return {
				action: 'translate_to_sql',
				target: context.utterance,
				parameters: {
					schemaContext: typeof context.schemaContext === 'string' ? context.schemaContext : undefined,
				},
				confidence: classification.confidence,
			};
		}

		return null;
	}

	async execute(action: AgentAction): Promise<any> {
		this.membraneService.recordActivity('somatic');
		this._status = 'active';
		this._currentLoad += 0.33;
		this._onDidChangeStatus.fire(this._status);

		try {
			switch (action.action) {
				case 'translate_to_sql':
					return await this.translateToSQL(
						action.target,
						typeof action.parameters?.schemaContext === 'string' ? action.parameters.schemaContext : undefined
					);
				case 'explain_sql':
					return await this.explainSQL(action.target);
				case 'classify_intent':
					return this.classifyIntent(action.target);
				case 'extract_entities':
					return this.extractEntities(
						action.target,
						Array.isArray(action.parameters?.knownTables) ? action.parameters.knownTables : undefined
					);
				default:
					throw new Error(`Unknown action: ${action.action}`);
			}
		} finally {
			this._currentLoad = Math.max(0, this._currentLoad - 0.33);
			this._status = this._currentLoad > 0 ? 'active' : 'idle';
			this._onDidChangeStatus.fire(this._status);
		}
	}

	async translateToSQL(description: string, schemaContext?: string): Promise<NLTranslationResult> {
		this.membraneService.recordActivity('cerebral');
		this.logService.info(`[NaturalLanguageAgent] Translating: ${description.substring(0, 100)}...`);

		const intent = this.classifyIntent(description);
		const knownTables = schemaContext ? this._tablesFromSchemaContext(schemaContext) : undefined;
		const entities = this.extractEntities(description, knownTables);

		let prompt = `Convert the following natural language description to SQL:\n\n"${description}"\n`;
		if (schemaContext) {
			prompt += `\nAvailable schema:\n${schemaContext}\n`;
		}
		if (entities.length > 0) {
			prompt += `\nEntities referenced: ${entities.map(e => `${e.kind}:${e.normalized}`).join(', ')}\n`;
		}
		prompt += '\nReturn only the SQL query, no explanations.';

		const sql = await this.llmService.complete(prompt);

		const node: Omit<HypergraphNode, 'id'> = {
			node_type: 'nl_translation',
			content: sql,
			links: [],
			metadata: {
				translated_at: Date.now(),
				agent: this.id,
				description,
				intent: intent.intent,
				intent_confidence: intent.confidence,
				entity_count: entities.length,
				used_schema_context: !!schemaContext,
			},
			salience_score: 0.7,
		};
		await this.hypergraphStore.addNode(node);

		return {
			sql,
			intent,
			entities,
			usedSchemaContext: !!schemaContext,
		};
	}

	async explainSQL(query: string): Promise<string> {
		this.membraneService.recordActivity('cerebral');

		const prompt = `Explain what this SQL query does in plain English:

${query}

Provide a clear, concise explanation that a non-technical person could understand.`;

		return await this.llmService.complete(prompt);
	}

	classifyIntent(utterance: string): NLIntentClassification {
		this.membraneService.recordActivity('cerebral');

		const signals: string[] = [];
		for (const candidate of INTENT_SIGNALS) {
			for (const keyword of candidate.keywords) {
				const match = utterance.match(keyword);
				if (match) {
					signals.push(match[0].toLowerCase());
				}
			}
			if (signals.length > 0) {
				return {
					intent: candidate.intent,
					confidence: Math.min(1, 0.6 + signals.length * 0.15),
					signals,
				};
			}
		}

		return { intent: 'other', confidence: 0.3, signals: [] };
	}

	extractEntities(utterance: string, knownTables?: string[]): NLEntityReference[] {
		this.membraneService.recordActivity('cerebral');

		const entities: NLEntityReference[] = [];
		const seen = new Set<string>();

		// Known table references (exact and plural/singular variants)
		if (knownTables) {
			const lower = utterance.toLowerCase();
			for (const table of knownTables) {
				const bare = this._bareTableName(table).toLowerCase();
				const variants = [bare, `${bare}s`, bare.endsWith('s') ? bare.slice(0, -1) : bare];
				for (const variant of variants) {
					if (variant.length > 1 && new RegExp(`\\b${this._escapeRegExp(variant)}\\b`, 'i').test(lower)) {
						const key = `table:${table.toLowerCase()}`;
						if (!seen.has(key)) {
							seen.add(key);
							entities.push({ kind: 'table', text: variant, normalized: table, confidence: variant === bare ? 0.9 : 0.7 });
						}
						break;
					}
				}
			}
		}

		// Quoted literals are value references
		const quoted = utterance.match(/'([^']+)'|"([^"]+)"/g) ?? [];
		for (const q of quoted) {
			const text = q.slice(1, -1);
			const key = `value:${text.toLowerCase()}`;
			if (!seen.has(key)) {
				seen.add(key);
				entities.push({ kind: 'value', text, normalized: text, confidence: 0.8 });
			}
		}

		// snake_case or dotted identifiers look like column references
		const identifiers = utterance.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|_[a-zA-Z0-9_]+)\b/g) ?? [];
		for (const ident of identifiers) {
			const key = `column:${ident.toLowerCase()}`;
			if (!seen.has(key) && !seen.has(`table:${ident.toLowerCase()}`)) {
				seen.add(key);
				entities.push({ kind: 'column', text: ident, normalized: ident.toLowerCase(), confidence: 0.6 });
			}
		}

		return entities;
	}

	// -- Private helpers -----------------------------------------------------

	private _tablesFromSchemaContext(schemaContext: string): string[] {
		return schemaContext
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(line => line.length > 0 && /^[\w.[\]"]+$/.test(line));
	}

	private _bareTableName(qualifiedName: string): string {
		const parts = qualifiedName.split('.');
		return parts[parts.length - 1].replace(/[[\]"]/g, '');
	}

	private _escapeRegExp(text: string): string {
		return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
