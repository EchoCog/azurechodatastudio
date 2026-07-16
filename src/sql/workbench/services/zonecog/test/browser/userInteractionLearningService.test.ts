/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserInteractionLearningService, BehaviorPattern, PolicyUpdate } from 'sql/workbench/services/zonecog/common/userInteractionLearning';
import { UserInteractionLearningService } from 'sql/workbench/services/zonecog/browser/userInteractionLearningService';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('User Interaction Learning Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let learningService: IUserInteractionLearningService;
	let hypergraphStore: IHypergraphStore;
	let zonecogService: IZoneCogService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const llmProviderService = instantiationService.createInstance(LLMProviderService);
		instantiationService.stub(ILLMProviderService, llmProviderService);

		zonecogService = instantiationService.createInstance(ZoneCogService);
		instantiationService.stub(IZoneCogService, zonecogService);

		learningService = instantiationService.createInstance(UserInteractionLearningService);
	});

	// --- Interaction recording ---

	test('should start with an empty history', () => {
		assert.strictEqual(learningService.getInteractionCount(), 0);
	});

	test('should record interactions and fire the interaction event', () => {
		let fired = 0;
		learningService.onDidRecordInteraction(() => fired++);

		learningService.recordInteraction({ action: 'run-query', context: 'sql-editor', success: true });
		learningService.recordInteraction({ action: 'open-dashboard', context: 'dashboard' });

		assert.strictEqual(learningService.getInteractionCount(), 2);
		assert.strictEqual(fired, 2);
	});

	test('should bound the retained history at 500 interactions', () => {
		for (let i = 0; i < 520; i++) {
			learningService.recordInteraction({ action: `a-${i}`, context: 'ctx' });
		}
		assert.strictEqual(learningService.getInteractionCount(), 500);
	});

	// --- Behavioral profile ---

	test('profile should count frequent actions in descending order', () => {
		for (let i = 0; i < 6; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'sql-editor', success: true });
		}
		learningService.recordInteraction({ action: 'open-dashboard', context: 'dashboard', success: true });

		const profile = learningService.getProfile();
		assert.strictEqual(profile.totalInteractions, 7);
		assert.strictEqual(profile.frequentActions[0].action, 'run-query');
		assert.strictEqual(profile.frequentActions[0].count, 6);
	});

	test('profile should compute error rate and error-prone contexts', () => {
		for (let i = 0; i < 3; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'complex-join', success: false });
		}
		learningService.recordInteraction({ action: 'run-query', context: 'simple-select', success: true });

		const profile = learningService.getProfile();
		assert.strictEqual(profile.errorRate, 0.75);
		assert.strictEqual(profile.errorProneContexts[0].context, 'complex-join');
		assert.strictEqual(profile.errorProneContexts[0].errorCount, 3);
		assert.strictEqual(profile.errorProneContexts[0].errorRate, 1);
	});

	test('profile should report positive learning velocity when success improves', () => {
		for (let i = 0; i < 5; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: false });
		}
		for (let i = 0; i < 5; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		const profile = learningService.getProfile();
		assert.strictEqual(profile.learningVelocity, 1);
	});

	test('profile should track per-action EMA success rate', () => {
		learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		const afterSuccess = learningService.getProfile().frequentActions.find(a => a.action === 'run-query')!;
		assert.strictEqual(afterSuccess.successRate, 1);

		learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: false });
		const afterFailure = learningService.getProfile().frequentActions.find(a => a.action === 'run-query')!;
		// EMA: 1 * 0.8 + 0 * 0.2 = 0.8
		assert.ok(Math.abs(afterFailure.successRate - 0.8) < 1e-9);
	});

	// --- Pattern mining ---

	test('should mine a frequent-action pattern with sufficient support and share', () => {
		for (let i = 0; i < 8; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		const patterns = learningService.minePatterns();
		const frequent = patterns.find(p => p.kind === 'frequent-action' && p.key === 'run-query');
		assert.ok(frequent, 'expected a frequent-action pattern for run-query');
		assert.strictEqual(frequent!.support, 8);
		assert.ok(frequent!.confidence > 0.5);
	});

	test('should not mine frequent-action patterns below the support threshold', () => {
		learningService.recordInteraction({ action: 'rare-action', context: 'ctx' });
		const patterns = learningService.minePatterns();
		assert.strictEqual(patterns.filter(p => p.kind === 'frequent-action').length, 0);
	});

	test('should mine an error-prone-context pattern from repeated failures', () => {
		for (let i = 0; i < 4; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'flaky-linked-server', success: false });
		}
		const patterns = learningService.minePatterns();
		const errorPattern = patterns.find(p => p.kind === 'error-prone-context');
		assert.ok(errorPattern, 'expected an error-prone-context pattern');
		assert.strictEqual(errorPattern!.key, 'flaky-linked-server');
		assert.strictEqual(errorPattern!.support, 4);
	});

	test('should mine a skill-trend pattern when success rate shifts', () => {
		for (let i = 0; i < 6; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: false });
		}
		for (let i = 0; i < 6; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		const patterns = learningService.minePatterns();
		const trend = patterns.find(p => p.kind === 'skill-trend');
		assert.ok(trend, 'expected a skill-trend pattern');
		assert.strictEqual(trend!.key, 'improving');
	});

	test('should persist mined patterns as UserBehaviorPattern hypergraph nodes', () => {
		for (let i = 0; i < 8; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		learningService.minePatterns();

		const nodes = hypergraphStore.getNodesByType('UserBehaviorPattern');
		assert.ok(nodes.length >= 1);
		const node = nodes.find(n => n.id === 'uilp-frequent-action-run-query');
		assert.ok(node, 'expected a deterministic pattern node id');
		assert.strictEqual(node!.metadata['kind'], 'frequent-action');
		assert.strictEqual(node!.salience_score, node!.metadata['confidence']);
	});

	test('re-mining should update pattern nodes in place, not duplicate them', () => {
		for (let i = 0; i < 8; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		learningService.minePatterns();
		const countAfterFirst = hypergraphStore.getNodesByType('UserBehaviorPattern').length;

		for (let i = 0; i < 4; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		learningService.minePatterns();
		const countAfterSecond = hypergraphStore.getNodesByType('UserBehaviorPattern').length;

		assert.strictEqual(countAfterSecond, countAfterFirst);
	});

	test('should auto-mine patterns every 10 interactions', () => {
		let patternEvents = 0;
		learningService.onDidUpdatePatterns(() => patternEvents++);

		for (let i = 0; i < 10; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		assert.strictEqual(patternEvents, 1);
	});

	test('stale patterns should be removed when no longer supported', () => {
		for (let i = 0; i < 4; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'flaky-server', success: false });
		}
		learningService.minePatterns();
		assert.ok(learningService.getPatterns().some(p => p.kind === 'error-prone-context'));

		// Flood with successes so the bounded history (500) evicts all 4 old failures.
		for (let i = 0; i < 500; i++) {
			learningService.recordInteraction({ action: 'other', context: 'healthy', success: true });
		}
		learningService.minePatterns();
		assert.strictEqual(learningService.getPatterns().filter(p => p.kind === 'error-prone-context').length, 0);
		assert.strictEqual(hypergraphStore.getNodesByType('UserBehaviorPattern').filter(n => (n.metadata['kind']) === 'error-prone-context').length, 0);
	});

	// --- Q-learning strategy selection ---

	test('Q-values should start at zero', () => {
		assert.strictEqual(learningService.getQValue('simple', 'shallow'), 0);
	});

	test('recordOutcome should apply the Q-learning update rule', () => {
		// Q <- 0 + 0.1 * (1 - 0) = 0.1 (bandit form: no successor context)
		const q1 = learningService.recordOutcome('simple', 'shallow', 1);
		assert.ok(Math.abs(q1 - 0.1) < 1e-9);

		// Q <- 0.1 + 0.1 * (1 - 0.1) = 0.19
		const q2 = learningService.recordOutcome('simple', 'shallow', 1);
		assert.ok(Math.abs(q2 - 0.19) < 1e-9);
	});

	test('recordOutcome should bootstrap from the successor context when provided', () => {
		learningService.recordOutcome('phase-2', 'deep', 1); // Q(phase-2, deep) = 0.1
		// Q(phase-1, shallow) <- 0 + 0.1 * (0.5 + 0.9 * 0.1 - 0) = 0.059
		const q = learningService.recordOutcome('phase-1', 'shallow', 0.5, 'phase-2');
		assert.ok(Math.abs(q - 0.059) < 1e-9);
	});

	test('recordOutcome should clamp rewards to [-1, 1] and fire the policy event', () => {
		let update: PolicyUpdate | undefined;
		learningService.onDidUpdatePolicy(u => update = u);

		learningService.recordOutcome('simple', 'shallow', 5);
		assert.ok(update);
		assert.strictEqual(update!.reward, 1);
	});

	test('recommendAction should pick the highest-Q candidate greedily', () => {
		learningService.recordOutcome('complex', 'deep', 1);
		learningService.recordOutcome('complex', 'shallow', -1);

		const recommendation = learningService.recommendAction('complex', ['shallow', 'moderate', 'deep']);
		assert.ok(recommendation);
		assert.strictEqual(recommendation!.action, 'deep');
		assert.strictEqual(recommendation!.explored, false);
	});

	test('recommendAction should break ties by candidate order', () => {
		const recommendation = learningService.recommendAction('unseen', ['first', 'second']);
		assert.strictEqual(recommendation!.action, 'first');
	});

	test('recommendAction should return undefined for empty candidates', () => {
		assert.strictEqual(learningService.recommendAction('ctx', []), undefined);
	});

	// --- Reward derivation ---

	test('deriveReward should reward confident fast successes above slow unconfident ones', () => {
		const fastConfident = learningService.deriveReward({ success: true, confidence: 0.9, durationMs: 100 });
		const slowUnsure = learningService.deriveReward({ success: true, confidence: 0.4, durationMs: 60000 });
		assert.ok(fastConfident > slowUnsure);
		assert.ok(fastConfident <= 1 && fastConfident >= -1);
	});

	test('deriveReward should penalize failures', () => {
		const failure = learningService.deriveReward({ success: false, confidence: 0.2 });
		assert.ok(failure < 0);
	});

	// --- Cognitive protocol wiring ---

	test('processed queries should be recorded and reinforce the depth strategy', async () => {
		await zonecogService.initialize();
		const response = await zonecogService.processQuery('What tables exist in this schema?');

		assert.strictEqual(learningService.getInteractionCount(), 1);
		const profile = learningService.getProfile();
		assert.strictEqual(profile.frequentActions[0].action, 'zonecog.processQuery');

		const q = learningService.getQValue(response.metadata.queryComplexity, response.metadata.thinkingDepth);
		assert.notStrictEqual(q, 0);
	});

	// --- Reset ---

	test('reset should clear history, patterns, pattern nodes, and Q-values', () => {
		for (let i = 0; i < 8; i++) {
			learningService.recordInteraction({ action: 'run-query', context: 'ctx', success: true });
		}
		learningService.minePatterns();
		learningService.recordOutcome('simple', 'shallow', 1);

		learningService.reset();

		assert.strictEqual(learningService.getInteractionCount(), 0);
		assert.strictEqual(learningService.getPatterns().length, 0);
		assert.strictEqual(learningService.getQValue('simple', 'shallow'), 0);
		assert.strictEqual(hypergraphStore.getNodesByType('UserBehaviorPattern').length, 0);
	});
});
