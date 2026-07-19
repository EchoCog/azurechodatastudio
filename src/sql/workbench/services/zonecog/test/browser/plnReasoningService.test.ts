/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IPLNReasoningService, InferredLink } from 'sql/workbench/services/zonecog/common/plnReasoning';
import { PLNReasoningService } from 'sql/workbench/services/zonecog/browser/plnReasoningService';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('PLN Reasoning Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let plnService: IPLNReasoningService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		plnService = instantiationService.createInstance(PLNReasoningService);
	});

	function node(id: string, salience: number = 0.5): HypergraphNode {
		return { id, node_type: 'TestNode', content: id, links: [], metadata: {}, salience_score: salience };
	}

	function link(id: string, from: string, to: string): HypergraphLink {
		return { id, link_type: 'RelatesTo', outgoing: [from, to], metadata: {} };
	}

	// --- Truth values ---

	test('should have no truth value assigned by default', () => {
		assert.strictEqual(plnService.getTruthValue('l1'), undefined);
	});

	test('should store and retrieve an assigned truth value, clamped to [0,1]', () => {
		plnService.setTruthValue('l1', { strength: 1.5, confidence: -0.2 });
		assert.deepStrictEqual(plnService.getTruthValue('l1'), { strength: 1, confidence: 0 });
	});

	// --- Deduction ---

	test('should derive A->C from A->B and B->C via deduction', () => {
		hypergraphStore.addNode(node('A', 0.5));
		hypergraphStore.addNode(node('B', 0.5));
		hypergraphStore.addNode(node('C', 0.5));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		hypergraphStore.addLink(link('bc', 'B', 'C'));
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.8 });
		plnService.setTruthValue('bc', { strength: 0.9, confidence: 0.8 });

		const result = plnService.infer({ maxIterations: 1 });

		const deduced = result.inferred.find(l => l.rule === 'deduction' && l.from === 'A' && l.to === 'C');
		assert.ok(deduced, 'expected a deduced A->C link');
		assert.ok(deduced!.truthValue.strength > 0 && deduced!.truthValue.strength <= 1);
		assert.ok(deduced!.truthValue.confidence < 0.8, 'confidence should be discounted below either premise');
	});

	test('should not deduce a trivial A->B->A cycle back to itself', () => {
		hypergraphStore.addNode(node('A'));
		hypergraphStore.addNode(node('B'));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		hypergraphStore.addLink(link('ba', 'B', 'A'));

		const result = plnService.infer({ maxIterations: 1 });
		assert.strictEqual(result.inferred.find(l => l.rule === 'deduction' && l.from === 'A' && l.to === 'A'), undefined);
	});

	// --- Inversion ---

	test('should derive B->A from A->B via inversion', () => {
		hypergraphStore.addNode(node('A', 0.5));
		hypergraphStore.addNode(node('B', 0.5));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		plnService.setTruthValue('ab', { strength: 0.8, confidence: 0.7 });

		const result = plnService.infer({ maxIterations: 1 });
		const inverted = result.inferred.find(l => l.rule === 'inversion' && l.from === 'B' && l.to === 'A');
		assert.ok(inverted, 'expected an inverted B->A link');
		assert.ok(inverted!.truthValue.confidence < 0.7);
	});

	// --- Similarity ---

	test('should derive Similarity when both A->B and B->A exist', () => {
		hypergraphStore.addNode(node('A'));
		hypergraphStore.addNode(node('B'));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		hypergraphStore.addLink(link('ba', 'B', 'A'));
		plnService.setTruthValue('ab', { strength: 0.8, confidence: 0.6 });
		plnService.setTruthValue('ba', { strength: 0.6, confidence: 0.9 });

		const result = plnService.infer({ maxIterations: 1 });
		const similarity = result.inferred.filter(l => l.rule === 'similarity');
		assert.strictEqual(similarity.length, 1, 'expected exactly one similarity conclusion for the A/B pair');
		assert.ok(similarity[0].truthValue.confidence <= 0.6);
	});

	// --- Persistence & dedup ---

	test('inferred links should be persisted in the hypergraph store', () => {
		hypergraphStore.addNode(node('A'));
		hypergraphStore.addNode(node('B'));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.9 });

		const result = plnService.infer({ maxIterations: 1 });
		assert.ok(result.inferred.length > 0);
		for (const inferred of result.inferred) {
			const persisted = hypergraphStore.getLink(inferred.id);
			assert.ok(persisted, `expected persisted link for ${inferred.id}`);
			assert.strictEqual(persisted!.link_type, 'Inferred');
			assert.strictEqual(persisted!.metadata['inferred'], true);
		}
	});

	test('should not re-derive the same conclusion twice across separate infer() calls', () => {
		hypergraphStore.addNode(node('A'));
		hypergraphStore.addNode(node('B'));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.9 });

		plnService.infer({ maxIterations: 1 });
		const countAfterFirst = plnService.getInferredLinks().length;
		plnService.infer({ maxIterations: 1 });
		const countAfterSecond = plnService.getInferredLinks().length;

		assert.strictEqual(countAfterFirst, countAfterSecond, 'no duplicate conclusions should be added');
	});

	test('should discard conclusions below the minConfidence threshold', () => {
		hypergraphStore.addNode(node('A'));
		hypergraphStore.addNode(node('B'));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.1 });

		const result = plnService.infer({ maxIterations: 1, minConfidence: 0.99 });
		assert.strictEqual(result.inferred.length, 0);
	});

	test('should fire onDidInferLink for each new conclusion', () => {
		hypergraphStore.addNode(node('A'));
		hypergraphStore.addNode(node('B'));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.9 });

		const fired: InferredLink[] = [];
		plnService.onDidInferLink(l => fired.push(l));
		const result = plnService.infer({ maxIterations: 1 });

		assert.strictEqual(fired.length, result.inferred.length);
	});

	// --- Multi-hop chaining across iterations ---

	test('should chain deduction across multiple iterations (A->B->C->D)', () => {
		for (const id of ['A', 'B', 'C', 'D']) {
			hypergraphStore.addNode(node(id, 0.5));
		}
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		hypergraphStore.addLink(link('bc', 'B', 'C'));
		hypergraphStore.addLink(link('cd', 'C', 'D'));
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.9 });
		plnService.setTruthValue('bc', { strength: 0.9, confidence: 0.9 });
		plnService.setTruthValue('cd', { strength: 0.9, confidence: 0.9 });

		const result = plnService.infer({ maxIterations: 3 });
		const adToD = plnService.getInferredLinks().find(l => l.from === 'A' && l.to === 'D');
		assert.ok(adToD, 'expected a multi-hop A->D conclusion after several iterations');
		assert.ok(result.iterations >= 2);
	});

	// --- Reset ---

	test('reset should clear inferred links, truth values, and persisted nodes', () => {
		hypergraphStore.addNode(node('A'));
		hypergraphStore.addNode(node('B'));
		hypergraphStore.addLink(link('ab', 'A', 'B'));
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.9 });
		const result = plnService.infer({ maxIterations: 1 });
		const firstId = result.inferred[0].id;

		plnService.reset();

		assert.deepStrictEqual(plnService.getInferredLinks(), []);
		assert.strictEqual(plnService.getTruthValue('ab'), undefined);
		assert.strictEqual(hypergraphStore.getLink(firstId), undefined);
	});

	// --- Empty graph ---

	test('should return an empty result on an empty hypergraph', () => {
		const result = plnService.infer();
		assert.deepStrictEqual(result.inferred, []);
		assert.strictEqual(result.linksExamined, 0);
	});
});
