/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICognitiveProvenanceService, CognitiveDecision } from 'sql/workbench/services/zonecog/common/cognitiveProvenance';
import { CognitiveProvenanceService } from 'sql/workbench/services/zonecog/browser/cognitiveProvenanceService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Cognitive Provenance Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let provenanceService: ICognitiveProvenanceService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		provenanceService = instantiationService.createInstance(CognitiveProvenanceService);
	});

	function addEvidenceNode(id: string, nodeType: string = 'CognitiveState', content: string = 'evidence'): void {
		hypergraphStore.addNode({
			id,
			node_type: nodeType,
			content,
			links: [],
			metadata: {},
			salience_score: 0.5
		});
	}

	// --- Decision recording ---

	test('should start with an empty audit trail', () => {
		assert.strictEqual(provenanceService.getDecisionCount(), 0);
		assert.deepStrictEqual(provenanceService.getAuditTrail(), []);
	});

	test('should record a decision and fire the decision event', () => {
		let fired: CognitiveDecision | undefined;
		provenanceService.onDidRecordDecision(d => fired = d);

		const decision = provenanceService.recordDecision({
			actor: 'zonecogService',
			decisionType: 'thinking-depth-selection',
			summary: 'Selected deep thinking for complex query',
			confidence: 0.8
		});

		assert.strictEqual(provenanceService.getDecisionCount(), 1);
		assert.strictEqual(fired?.id, decision.id);
		assert.strictEqual(decision.actor, 'zonecogService');
		assert.strictEqual(decision.confidence, 0.8);
	});

	test('should persist decisions as CognitiveDecision hypergraph nodes', () => {
		const decision = provenanceService.recordDecision({
			actor: 'ecanAttentionService',
			decisionType: 'attention-allocation',
			summary: 'Allocated attention to schema nodes'
		});

		const node = hypergraphStore.getNode(decision.id);
		assert.ok(node);
		assert.strictEqual(node!.node_type, 'CognitiveDecision');
		assert.strictEqual(node!.content, 'Allocated attention to schema nodes');
		assert.strictEqual(node!.metadata['actor'], 'ecanAttentionService');
	});

	test('should clamp confidence into [0, 1] and default it to 0.5', () => {
		const high = provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: 's', confidence: 2 });
		const low = provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: 's', confidence: -1 });
		const defaulted = provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: 's' });
		assert.strictEqual(high.confidence, 1);
		assert.strictEqual(low.confidence, 0);
		assert.strictEqual(defaulted.confidence, 0.5);
	});

	test('should create EvidencedBy links for existing evidence nodes', () => {
		addEvidenceNode('evidence-1');
		addEvidenceNode('evidence-2');

		const decision = provenanceService.recordDecision({
			actor: 'zonecogService',
			decisionType: 'response-generation',
			summary: 'Generated response from working memory',
			evidenceNodeIds: ['evidence-1', 'evidence-2']
		});

		assert.deepStrictEqual(decision.evidenceNodeIds, ['evidence-1', 'evidence-2']);
		const links = hypergraphStore.getLinksForNode(decision.id)
			.filter(l => l.link_type === 'EvidencedBy');
		assert.strictEqual(links.length, 2);
		assert.deepStrictEqual(links.map(l => l.outgoing[1]).sort(), ['evidence-1', 'evidence-2']);
	});

	test('should drop evidence ids that do not resolve to stored nodes', () => {
		addEvidenceNode('evidence-real');
		const decision = provenanceService.recordDecision({
			actor: 'a',
			decisionType: 't',
			summary: 's',
			evidenceNodeIds: ['evidence-real', 'evidence-ghost']
		});
		assert.deepStrictEqual(decision.evidenceNodeIds, ['evidence-real']);
	});

	// --- Audit trail ---

	test('audit trail should return decisions most recent first', () => {
		provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: 'first', timestamp: 1000 });
		provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: 'second', timestamp: 2000 });
		provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: 'third', timestamp: 3000 });

		const trail = provenanceService.getAuditTrail();
		assert.deepStrictEqual(trail.map(d => d.summary), ['third', 'second', 'first']);
	});

	test('audit trail should filter by actor, decisionType, and time range', () => {
		provenanceService.recordDecision({ actor: 'alpha', decisionType: 'x', summary: 'a-x', timestamp: 1000 });
		provenanceService.recordDecision({ actor: 'beta', decisionType: 'x', summary: 'b-x', timestamp: 2000 });
		provenanceService.recordDecision({ actor: 'alpha', decisionType: 'y', summary: 'a-y', timestamp: 3000 });

		assert.deepStrictEqual(provenanceService.getAuditTrail({ actor: 'alpha' }).map(d => d.summary), ['a-y', 'a-x']);
		assert.deepStrictEqual(provenanceService.getAuditTrail({ decisionType: 'x' }).map(d => d.summary), ['b-x', 'a-x']);
		assert.deepStrictEqual(provenanceService.getAuditTrail({ since: 1500, until: 2500 }).map(d => d.summary), ['b-x']);
	});

	test('audit trail should honor the limit', () => {
		for (let i = 0; i < 5; i++) {
			provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: `d-${i}`, timestamp: i });
		}
		assert.strictEqual(provenanceService.getAuditTrail({ limit: 2 }).length, 2);
	});

	test('should bound the retained audit trail at 1000 decisions', () => {
		for (let i = 0; i < 1010; i++) {
			provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: `d-${i}` });
		}
		assert.strictEqual(provenanceService.getDecisionCount(), 1000);
	});

	// --- Provenance chains ---

	test('should resolve a direct provenance chain', () => {
		addEvidenceNode('evidence-1', 'UserBehaviorPattern', 'pattern evidence');
		const decision = provenanceService.recordDecision({
			actor: 'a',
			decisionType: 't',
			summary: 's',
			evidenceNodeIds: ['evidence-1']
		});

		const chain = provenanceService.getProvenanceChain(decision.id);
		assert.strictEqual(chain.length, 1);
		assert.strictEqual(chain[0].nodeId, 'evidence-1');
		assert.strictEqual(chain[0].nodeType, 'UserBehaviorPattern');
		assert.strictEqual(chain[0].depth, 1);
	});

	test('should resolve transitive chains across decisions', () => {
		addEvidenceNode('base-evidence');
		const inner = provenanceService.recordDecision({
			actor: 'a',
			decisionType: 'inner',
			summary: 'inner decision',
			evidenceNodeIds: ['base-evidence']
		});
		const outer = provenanceService.recordDecision({
			actor: 'a',
			decisionType: 'outer',
			summary: 'outer decision',
			evidenceNodeIds: [inner.id]
		});

		const chain = provenanceService.getProvenanceChain(outer.id);
		assert.strictEqual(chain.length, 2);
		assert.strictEqual(chain.find(e => e.nodeId === inner.id)?.depth, 1);
		assert.strictEqual(chain.find(e => e.nodeId === 'base-evidence')?.depth, 2);
	});

	test('should respect maxDepth when resolving chains', () => {
		addEvidenceNode('base-evidence');
		const inner = provenanceService.recordDecision({
			actor: 'a', decisionType: 'inner', summary: 'inner', evidenceNodeIds: ['base-evidence']
		});
		const outer = provenanceService.recordDecision({
			actor: 'a', decisionType: 'outer', summary: 'outer', evidenceNodeIds: [inner.id]
		});

		const chain = provenanceService.getProvenanceChain(outer.id, 1);
		assert.strictEqual(chain.length, 1);
		assert.strictEqual(chain[0].nodeId, inner.id);
	});

	test('should return an empty chain for unknown decisions', () => {
		assert.deepStrictEqual(provenanceService.getProvenanceChain('nope'), []);
	});

	// --- Lifecycle ---

	test('clear should remove decisions and their persisted nodes', () => {
		const decision = provenanceService.recordDecision({ actor: 'a', decisionType: 't', summary: 's' });
		assert.ok(hypergraphStore.getNode(decision.id));

		provenanceService.clear();

		assert.strictEqual(provenanceService.getDecisionCount(), 0);
		assert.strictEqual(hypergraphStore.getNode(decision.id), undefined);
	});
});
