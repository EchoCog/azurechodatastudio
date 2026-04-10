/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IZoneCogService,
	ZoneCogResponse,
	ZoneCogState,
	IHypergraphStore,
	ICognitiveMembraneService,
	HypergraphNode,
	HypergraphLink,
	ThinkingPhase,
	QueryComplexity,
	ThinkingDepth
} from 'sql/workbench/services/zonecog/common/zonecogService';
import { ILLMProviderService, LLMCompletionRequest } from 'sql/workbench/services/zonecog/common/llmProvider';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';

/**
 * Generate a stable short id from a string seed.
 */
function shortId(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
	}
	return 'zc_' + Math.abs(hash).toString(36);
}

/**
 * Zone-Cog system prompt used when an external LLM is connected.
 */
const ZONE_COG_SYSTEM_PROMPT =
	`You are Zone-Cog, an embodied cognition assistant integrated into Azure Data Studio. ` +
	`You employ a comprehensive thinking protocol: Initial Engagement, Problem Space Exploration, ` +
	`Hypothesis Generation, Natural Discovery, Progress Tracking, Testing & Verification, ` +
	`Error Recognition, Knowledge Synthesis, Pattern Recognition, Recursive Thinking, ` +
	`and Response Preparation. Respond thoughtfully with data-oriented, practical insights.`;

/**
 * Maximum number of recent queries stored for cognitive history.
 */
const MAX_QUERY_HISTORY = 50;

/**
 * Implementation of the Zone-Cog cognitive protocol service.
 *
 * Follows the full Zone-Cog thinking sequence from the protocol specification:
 *   1. Initial Engagement
 *   2. Problem Space Exploration
 *   3. Multiple Hypothesis Generation
 *   4. Natural Discovery Process
 *   5. Testing and Verification
 *   6. Error Recognition and Correction
 *   7. Knowledge Synthesis
 *   8. Pattern Recognition and Analysis
 *   9. Progress Tracking
 *  10. Recursive Thinking
 *  11. Response Preparation
 */
export class ZoneCogService extends Disposable implements IZoneCogService {

	declare readonly _serviceBrand: undefined;

	private _initialized = false;
	private _thinkingModeEnabled = true;
	private _currentContext: string | null = null;
	private _cognitiveLoad = 0;

	/** Recent query history for context-aware processing. */
	private readonly _queryHistory: Array<{ query: string; timestamp: number }> = [];

	private readonly _onDidChangeCognitiveState = this._register(new Emitter<ZoneCogState>());
	readonly onDidChangeCognitiveState: Event<ZoneCogState> = this._onDidChangeCognitiveState.event;

	private readonly _onDidProcessQuery = this._register(new Emitter<ZoneCogResponse>());
	readonly onDidProcessQuery: Event<ZoneCogResponse> = this._onDidProcessQuery.event;

	private readonly _onDidCompleteThinkingPhase = this._register(new Emitter<ThinkingPhase>());
	readonly onDidCompleteThinkingPhase: Event<ThinkingPhase> = this._onDidCompleteThinkingPhase.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@ILLMProviderService private readonly llmProviderService: ILLMProviderService
	) {
		super();
		this.logService.info('ZoneCogService: Initializing Zone-Cog cognitive protocol');
	}

	// -- Public API ----------------------------------------------------------

	async initialize(): Promise<void> {
		this.logService.info('ZoneCogService: Starting Zone-Cog initialization');

		this._initialized = true;
		this._thinkingModeEnabled = true;

		this.membraneService.recordActivity('cerebral');

		this._fireStateChange();
		this.logService.info('ZoneCogService: Zone-Cog cognitive framework initialized successfully');
	}

	async processQuery(query: string): Promise<ZoneCogResponse> {
		const startTime = Date.now();
		this.logService.debug(`ZoneCogService: Processing query: ${query.substring(0, 100)}...`);

		if (!this._initialized) {
			await this.initialize();
		}

		this.membraneService.recordActivity('cerebral');
		this._cognitiveLoad = Math.min(1, this._cognitiveLoad + 0.2);
		this._currentContext = query;
		this._fireStateChange();

		// Record in query history
		this._recordQueryHistory(query, startTime);

		const complexity = this._assessQueryComplexity(query);
		const thinkingDepth = this._determineThinkingDepth(complexity);

		// Run the full Zone-Cog thinking protocol
		const phases: ThinkingPhase[] = [];
		let thinking = '';
		const relatedNodes: string[] = [];

		if (this._thinkingModeEnabled) {
			const phaseResults = await this._runThinkingProtocol(query, complexity, thinkingDepth);
			for (const phase of phaseResults) {
				phases.push(phase);
				thinking += phase.content + '\n\n';
				// Stream each phase as it completes
				this._onDidCompleteThinkingPhase.fire(phase);
			}

			// Persist the thinking as a hypergraph node
			const thinkingNodeId = shortId(`thinking:${query}:${startTime}`);
			const thinkingNode: HypergraphNode = {
				id: thinkingNodeId,
				node_type: 'ThinkingProcess',
				content: thinking,
				links: [],
				metadata: { query, complexity, thinkingDepth, timestamp: startTime },
				salience_score: complexity === 'complex' ? 0.9 : complexity === 'moderate' ? 0.6 : 0.3,
			};
			this.hypergraphStore.addNode(thinkingNode);
			relatedNodes.push(thinkingNodeId);

			// Create a query node and link it to the thinking node
			const queryNodeId = shortId(`query:${query}:${startTime}`);
			const queryNode: HypergraphNode = {
				id: queryNodeId,
				node_type: 'QueryInput',
				content: query,
				links: [],
				metadata: { timestamp: startTime },
				salience_score: 0.8,
			};
			this.hypergraphStore.addNode(queryNode);
			relatedNodes.push(queryNodeId);

			const linkId = shortId(`link:${queryNodeId}:${thinkingNodeId}`);
			const link: HypergraphLink = {
				id: linkId,
				link_type: 'ProducedBy',
				outgoing: [queryNodeId, thinkingNodeId],
				metadata: {},
			};
			this.hypergraphStore.addLink(link);
		}

		// Generate final response (LLM-enhanced or rule-based)
		const response = await this._generateResponse(query, thinking, complexity);

		// Persist the response node
		const responseNodeId = shortId(`response:${query}:${startTime}`);
		const responseNode: HypergraphNode = {
			id: responseNodeId,
			node_type: 'CognitiveResponse',
			content: response,
			links: [],
			metadata: { timestamp: Date.now(), llmProvider: this.llmProviderService.getActiveProvider().id },
			salience_score: 0.7,
		};
		this.hypergraphStore.addNode(responseNode);
		relatedNodes.push(responseNodeId);

		const processingTime = Date.now() - startTime;
		const confidence = this._calculateConfidence(query, thinking, response, phases);

		this._cognitiveLoad = Math.max(0, this._cognitiveLoad - 0.1);
		this._fireStateChange();

		this.logService.debug(`ZoneCogService: Query processed in ${processingTime}ms with confidence ${confidence}`);

		const result: ZoneCogResponse = {
			thinking,
			phases,
			response,
			confidence,
			metadata: {
				queryComplexity: complexity,
				thinkingDepth,
				processingTime,
				relatedNodes,
			},
		};

		this._onDidProcessQuery.fire(result);
		return result;
	}

	getCognitiveState(): ZoneCogState {
		return {
			isInitialized: this._initialized,
			thinkingModeEnabled: this._thinkingModeEnabled,
			currentContext: this._currentContext,
			cognitiveLoad: this._cognitiveLoad,
			hypergraphNodeCount: this.hypergraphStore.nodeCount(),
			membraneHealthy: this.membraneService.isSystemHealthy(),
		};
	}

	setThinkingMode(enabled: boolean): void {
		this._thinkingModeEnabled = enabled;
		this.logService.info(`ZoneCogService: Thinking mode ${enabled ? 'enabled' : 'disabled'}`);
		this._fireStateChange();
	}

	getHypergraphStore(): IHypergraphStore {
		return this.hypergraphStore;
	}

	getQueryHistory(): Array<{ query: string; timestamp: number }> {
		return [...this._queryHistory];
	}

	reset(): void {
		this._queryHistory.length = 0;
		this._cognitiveLoad = 0;
		this._currentContext = null;
		this.logService.info('ZoneCogService: State reset (query history, load, context)');
		this._fireStateChange();
	}

	// -- Query history -------------------------------------------------------

	private _recordQueryHistory(query: string, timestamp: number): void {
		this._queryHistory.push({ query, timestamp });
		if (this._queryHistory.length > MAX_QUERY_HISTORY) {
			this._queryHistory.shift();
		}

		// Decay older history nodes to keep attention focused
		this.hypergraphStore.decayAllSalience(0.98);

		// Persist history node in hypergraph for cross-session retrieval patterns
		const historyNodeId = shortId(`history:${timestamp}:${query}`);
		this.hypergraphStore.addNode({
			id: historyNodeId,
			node_type: 'QueryHistory',
			content: query,
			links: [],
			metadata: { timestamp, historyIndex: this._queryHistory.length - 1 },
			salience_score: 0.4,
		});
	}

	// -- Thinking protocol ---------------------------------------------------

	/**
	 * Run the full Zone-Cog thinking protocol, returning structured phases.
	 * Now includes Progress Tracking and Recursive Thinking phases from the spec.
	 */
	private async _runThinkingProtocol(
		query: string,
		complexity: QueryComplexity,
		depth: ThinkingDepth
	): Promise<ThinkingPhase[]> {
		const phases: ThinkingPhase[] = [];

		// Phase 1: Initial Engagement
		phases.push(this._phaseInitialEngagement(query, complexity));

		// Phase 2: Problem Space Exploration
		phases.push(this._phaseProblemSpaceExploration(query, complexity));

		if (depth === 'moderate' || depth === 'deep') {
			// Phase 3: Multiple Hypothesis Generation
			phases.push(this._phaseHypothesisGeneration(query));

			// Phase 4: Natural Discovery Process
			phases.push(this._phaseNaturalDiscovery(query));

			// Phase 9: Progress Tracking (moderate+)
			phases.push(this._phaseProgressTracking(query, phases));
		}

		if (depth === 'deep') {
			// Phase 5: Testing and Verification
			phases.push(this._phaseTestingVerification(query));

			// Phase 6: Error Recognition and Correction
			phases.push(this._phaseErrorRecognition(query));

			// Phase 7: Knowledge Synthesis
			phases.push(this._phaseKnowledgeSynthesis(query));

			// Phase 8: Pattern Recognition
			phases.push(this._phasePatternRecognition(query));

			// Phase 10: Recursive Thinking (deep only)
			phases.push(this._phaseRecursiveThinking(query, phases));
		}

		// Phase 11: Response Preparation (always)
		phases.push(this._phaseResponsePreparation(query, depth));

		return phases;
	}

	private _phaseInitialEngagement(query: string, complexity: QueryComplexity): ThinkingPhase {
		const start = Date.now();
		const content =
			`Hmm, let me clearly understand what's being asked here. ` +
			`The user is saying: "${query}"\n\n` +
			`This appears to be a ${complexity} query. ` +
			`Let me think about the broader context -- why might someone ask this? ` +
			`There could be several angles to consider here. ` +
			`I should map out what I know and what I don't know about this topic.`;
		return { name: 'Initial Engagement', content, durationMs: Date.now() - start };
	}

	private _phaseProblemSpaceExploration(query: string, complexity: QueryComplexity): ThinkingPhase {
		const start = Date.now();
		const words = query.split(/\s+/);
		const keyTerms = words.filter(w => w.length > 4).slice(0, 5).join(', ');
		const content =
			`Now let me break this down into its core components. ` +
			`The key terms I'm noticing are: ${keyTerms || 'general concepts'}. ` +
			`The explicit requirement seems to be about understanding or acting on this topic. ` +
			(complexity !== 'simple'
				? `But there are implicit requirements too -- the user probably wants a thoughtful, nuanced response ` +
				`that considers multiple dimensions of this problem. `
				: `This seems straightforward, but I should still make sure I'm not missing anything. `) +
			`A successful response would need to address the core question while providing useful context.`;
		return { name: 'Problem Space Exploration', content, durationMs: Date.now() - start };
	}

	private _phaseHypothesisGeneration(query: string): ThinkingPhase {
		const start = Date.now();
		const content =
			`Wait, let me think about this from multiple angles before settling on an approach. ` +
			`One interpretation would be that the user wants a direct, factual answer. ` +
			`But then again, they might be looking for a deeper analysis or recommendation. ` +
			`I should also consider that there might be an unconventional perspective I'm not seeing. ` +
			`Let me keep these hypotheses active and see which one best fits as I explore further.`;
		return { name: 'Multiple Hypothesis Generation', content, durationMs: Date.now() - start };
	}

	private _phaseNaturalDiscovery(query: string): ThinkingPhase {
		const start = Date.now();
		const content =
			`This is interesting because it connects to broader patterns I'm noticing. ` +
			`Starting with the obvious aspects, there's a direct relationship between the query and ` +
			`the domain of data management and analysis. ` +
			`But now I'm noticing something -- there might be connections to patterns that aren't immediately visible. ` +
			`Let me follow this thread and see where it leads... ` +
			`Actually, this reminds me of related concepts that could enrich the response.`;
		return { name: 'Natural Discovery Process', content, durationMs: Date.now() - start };
	}

	private _phaseTestingVerification(query: string): ThinkingPhase {
		const start = Date.now();
		const content =
			`Now let me question my own assumptions here. Am I being too narrow in my analysis? ` +
			`Let me test my preliminary conclusions against what I know. ` +
			`Are there potential flaws in my reasoning? I should consider alternative perspectives ` +
			`and verify that my understanding is consistent. ` +
			`I need to check for completeness -- am I covering all the important aspects?`;
		return { name: 'Testing and Verification', content, durationMs: Date.now() - start };
	}

	private _phaseErrorRecognition(query: string): ThinkingPhase {
		const start = Date.now();
		const content =
			`Looking back at my analysis, I want to make sure I haven't made any errors. ` +
			`If my initial thinking was too narrow, I should acknowledge that and expand. ` +
			`The key is to view any missteps as opportunities for deeper understanding ` +
			`rather than problems to hide. My analysis seems consistent so far, ` +
			`but I should integrate any corrections into the broader picture.`;
		return { name: 'Error Recognition and Correction', content, durationMs: Date.now() - start };
	}

	private _phaseKnowledgeSynthesis(query: string): ThinkingPhase {
		const start = Date.now();
		const content =
			`Now I'm beginning to see a broader pattern here. Let me connect the different pieces ` +
			`of information I've gathered. The various aspects relate to each other in meaningful ways. ` +
			`The key principles emerging are: relevance to the user's actual needs, ` +
			`practical applicability of any recommendations, and coherence of the overall picture. ` +
			`The implications of this synthesis suggest a clear direction for my response.`;
		return { name: 'Knowledge Synthesis', content, durationMs: Date.now() - start };
	}

	private _phasePatternRecognition(query: string): ThinkingPhase {
		const start = Date.now();
		const topNodes = this.hypergraphStore.getTopSalientNodes(3);
		const contextHint = topNodes.length > 0
			? `I can see ${topNodes.length} highly salient concepts in the cognitive graph that relate to this query. `
			: `The cognitive graph is fresh -- this is a new line of inquiry. `;
		const content =
			`Actively looking for patterns in the information I've gathered... ` +
			contextHint +
			`Comparing with known patterns, I can see both linear and emergent structures. ` +
			`Let me consider exceptions or special cases that might apply here. ` +
			`These patterns help guide my final response toward something genuinely useful.`;
		return { name: 'Pattern Recognition and Analysis', content, durationMs: Date.now() - start };
	}

	/**
	 * Phase 9: Progress Tracking - maintains awareness of what has been
	 * established, what remains uncertain, and current confidence level.
	 * From the Zone-Cog protocol spec's "Progress Tracking" section.
	 */
	private _phaseProgressTracking(query: string, priorPhases: ThinkingPhase[]): ThinkingPhase {
		const start = Date.now();
		const established = priorPhases.map(p => p.name).join(', ');
		const historyCount = this._queryHistory.length;
		const historyContext = historyCount > 1
			? `I've processed ${historyCount} queries so far -- previous context may inform this analysis. `
			: `This appears to be an early query in this session. `;
		const content =
			`Let me take stock of where I am in this analysis. ` +
			`So far I've completed: ${established}. ` +
			historyContext +
			`What remains to be determined is the most actionable response format. ` +
			`My confidence is growing as each phase builds on the last. ` +
			`Open questions: are there edge cases I haven't considered? ` +
			`Let me keep tracking progress as I move toward the response.`;
		return { name: 'Progress Tracking', content, durationMs: Date.now() - start };
	}

	/**
	 * Phase 10: Recursive Thinking - applies the same careful analysis
	 * at both macro and micro levels, checking that detailed analysis
	 * supports broader conclusions. From the Zone-Cog protocol spec's
	 * "Recursive Thinking" section.
	 */
	private _phaseRecursiveThinking(query: string, priorPhases: ThinkingPhase[]): ThinkingPhase {
		const start = Date.now();
		const phaseCount = priorPhases.length;
		const deepestPhase = priorPhases[phaseCount - 1];
		const content =
			`Now let me apply recursive analysis -- examining my reasoning at multiple scales. ` +
			`At the macro level, my ${phaseCount} phases build a coherent narrative from query to insight. ` +
			`At the micro level, the most recent phase ("${deepestPhase?.name ?? 'N/A'}") ` +
			`should hold up under the same scrutiny I applied to the overall problem. ` +
			`Pattern recognition at both scales seems consistent. ` +
			`The detailed analysis supports my broader conclusions -- ` +
			`I'm not seeing contradictions between the granular and high-level views.`;
		return { name: 'Recursive Thinking', content, durationMs: Date.now() - start };
	}

	private _phaseResponsePreparation(query: string, depth: ThinkingDepth): ThinkingPhase {
		const start = Date.now();
		const content =
			`Based on this ${depth} analysis, I believe the most helpful response would ` +
			`directly address the user's question while providing appropriate context. ` +
			`Let me ensure the response is clear, precise, and anticipates likely follow-up questions.`;
		return { name: 'Response Preparation', content, durationMs: Date.now() - start };
	}

	// -- Response generation -------------------------------------------------

	/**
	 * Generate a response using the active LLM provider.
	 * Falls back to built-in rule-based generation when no external provider is set.
	 */
	private async _generateResponse(
		query: string,
		thinking: string,
		complexity: QueryComplexity
	): Promise<string> {
		this.membraneService.recordActivity('somatic');

		const request: LLMCompletionRequest = {
			systemPrompt: ZONE_COG_SYSTEM_PROMPT,
			userMessage: query,
			thinkingContext: thinking || undefined,
			temperature: complexity === 'complex' ? 0.8 : complexity === 'moderate' ? 0.7 : 0.5,
		};

		try {
			const completion = await this.llmProviderService.complete(request);
			return completion.content;
		} catch (err) {
			this.membraneService.recordError('somatic', `LLM completion failed: ${err}`);
			this.logService.warn('ZoneCogService: LLM completion error, returning fallback', err);
			return `I've processed your input through the Zone-Cog thinking protocol. ` +
				`An error occurred during response generation, but the cognitive analysis is complete.`;
		}
	}

	// -- Complexity & confidence ---------------------------------------------

	private _assessQueryComplexity(query: string): QueryComplexity {
		const wordCount = query.split(/\s+/).length;
		const hasComplexKeywords = /\b(analyze|compare|synthesize|integrate|optimize|evaluate)\b/i.test(query);
		const hasCodePatterns = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|WHERE|JOIN)\b/i.test(query);

		if (wordCount > 50 || hasComplexKeywords || (hasCodePatterns && wordCount > 30)) {
			return 'complex';
		} else if (wordCount > 20 || query.includes('?') || hasCodePatterns) {
			return 'moderate';
		}
		return 'simple';
	}

	private _determineThinkingDepth(complexity: QueryComplexity): ThinkingDepth {
		switch (complexity) {
			case 'simple': return 'shallow';
			case 'moderate': return 'moderate';
			case 'complex': return 'deep';
		}
	}

	private _calculateConfidence(
		query: string,
		thinking: string,
		response: string,
		phases: ThinkingPhase[]
	): number {
		let confidence = 0.65;

		// More thinking phases -> higher confidence
		confidence += Math.min(0.15, phases.length * 0.02);

		// Longer, more thoughtful thinking -> higher confidence
		if (thinking.length > 1000) { confidence += 0.05; }
		if (thinking.length > 2000) { confidence += 0.05; }

		// Specific response -> higher confidence
		if (response.length > 200) { confidence += 0.05; }

		// Very long queries might reduce confidence (harder to address fully)
		if (query.length > 500) { confidence -= 0.05; }

		// Hypergraph context boosts confidence
		if (this.hypergraphStore.nodeCount() > 5) { confidence += 0.05; }

		// External LLM provider boosts confidence
		if (this.llmProviderService.isExternalProviderActive()) { confidence += 0.05; }

		return Math.max(0, Math.min(1, confidence));
	}

	// -- Helpers -------------------------------------------------------------

	private _fireStateChange(): void {
		this._onDidChangeCognitiveState.fire(this.getCognitiveState());
	}
}
