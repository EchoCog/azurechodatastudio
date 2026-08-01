/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IECANAttentionService, AttentionValue, ECANSpreadEvent } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('ECAN Attention Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let ecanService: IECANAttentionService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		ecanService = instantiationService.createInstance(ECANAttentionService);
	});

	// --- Initial State Tests ---

	test('should initialize with default focus boundary of 0.0', () => {
		assert.strictEqual(ecanService.getFocusBoundary(), 0.0);
	});

	test('should return empty attentional focus initially', () => {
		const focus = ecanService.getAttentionalFocus();
		assert.strictEqual(focus.length, 0);
	});

	test('should return default attention value for untracked node', () => {
		const av = ecanService.getAttentionValue('non-existent');
		assert.strictEqual(av.sti, 0);
		assert.strictEqual(av.lti, 0);
	});

	// --- Attention Value Management Tests ---

	test('should set and get attention value', () => {
		const av: AttentionValue = { sti: 0.5, lti: 0.3 };
		ecanService.setAttentionValue('node-1', av);

		const retrieved = ecanService.getAttentionValue('node-1');
		assert.strictEqual(retrieved.sti, 0.5);
		assert.strictEqual(retrieved.lti, 0.3);
	});

	test('should clamp STI to [-1, 1]', () => {
		ecanService.setAttentionValue('high-sti', { sti: 2.0, lti: 0.5 });
		assert.strictEqual(ecanService.getAttentionValue('high-sti').sti, 1.0);

		ecanService.setAttentionValue('low-sti', { sti: -2.0, lti: 0.5 });
		assert.strictEqual(ecanService.getAttentionValue('low-sti').sti, -1.0);
	});

	test('should clamp LTI to [0, 1]', () => {
		ecanService.setAttentionValue('high-lti', { sti: 0.5, lti: 1.5 });
		assert.strictEqual(ecanService.getAttentionValue('high-lti').lti, 1.0);

		ecanService.setAttentionValue('low-lti', { sti: 0.5, lti: -0.5 });
		assert.strictEqual(ecanService.getAttentionValue('low-lti').lti, 0.0);
	});

	test('should stimulate a node by adding to STI', () => {
		ecanService.setAttentionValue('stim-node', { sti: 0.3, lti: 0.5 });
		ecanService.stimulate('stim-node', 0.2);

		const av = ecanService.getAttentionValue('stim-node');
		assert.ok(Math.abs(av.sti - 0.5) < 0.001);
		assert.strictEqual(av.lti, 0.5); // LTI unchanged
	});

	test('should stimulate untracked node', () => {
		ecanService.stimulate('new-node', 0.5);

		const av = ecanService.getAttentionValue('new-node');
		assert.strictEqual(av.sti, 0.5);
		assert.strictEqual(av.lti, 0); // Default LTI
	});

	test('should clamp stimulation result', () => {
		ecanService.setAttentionValue('clamp-stim', { sti: 0.9, lti: 0.5 });
		ecanService.stimulate('clamp-stim', 0.5);

		assert.strictEqual(ecanService.getAttentionValue('clamp-stim').sti, 1.0);
	});

	// --- Attentional Focus Tests ---

	test('should include nodes above focus boundary in attentional focus', () => {
		ecanService.setAttentionValue('above-1', { sti: 0.5, lti: 0.5 });
		ecanService.setAttentionValue('above-2', { sti: 0.3, lti: 0.5 });
		ecanService.setAttentionValue('below-1', { sti: -0.5, lti: 0.5 });

		const focus = ecanService.getAttentionalFocus();
		assert.strictEqual(focus.length, 2);
		assert.ok(focus.includes('above-1'));
		assert.ok(focus.includes('above-2'));
		assert.ok(!focus.includes('below-1'));
	});

	test('should include node at exactly the focus boundary', () => {
		ecanService.setFocusBoundary(0.3);
		ecanService.setAttentionValue('exact-boundary', { sti: 0.3, lti: 0.5 });

		const focus = ecanService.getAttentionalFocus();
		assert.ok(focus.includes('exact-boundary'));
	});

	// --- Focus Boundary Tests ---

	test('should set focus boundary', () => {
		ecanService.setFocusBoundary(0.5);
		assert.strictEqual(ecanService.getFocusBoundary(), 0.5);
	});

	test('should clamp focus boundary to [-1, 1]', () => {
		ecanService.setFocusBoundary(2.0);
		assert.strictEqual(ecanService.getFocusBoundary(), 1.0);

		ecanService.setFocusBoundary(-2.0);
		assert.strictEqual(ecanService.getFocusBoundary(), -1.0);
	});

	test('should fire onDidChangeFocusBoundary event', () => {
		let firedBoundary: number | undefined;
		ecanService.onDidChangeFocusBoundary(boundary => { firedBoundary = boundary; });

		ecanService.setFocusBoundary(0.4);

		assert.strictEqual(firedBoundary, 0.4);
	});

	// --- Spreading Activation Tests ---

	test('should run spreading activation cycle', () => {
		// Create nodes and links in hypergraph
		hypergraphStore.addNode({
			id: 'spread-1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'spread-2', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addLink({
			id: 'spread-link', link_type: 'Related', outgoing: ['spread-1', 'spread-2'], metadata: {},
		});

		// Set attention values
		ecanService.setAttentionValue('spread-1', { sti: 0.8, lti: 0.5 });
		ecanService.setAttentionValue('spread-2', { sti: 0.2, lti: 0.5 });

		const result = ecanService.spreadActivation();

		assert.ok(result.durationMs >= 0);
		assert.ok(Array.isArray(result.boosted));
		assert.ok(Array.isArray(result.decayed));
		assert.ok(Array.isArray(result.evicted));
	});

	test('should spread STI along links', () => {
		hypergraphStore.addNode({
			id: 'source', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'target', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addLink({
			id: 'spread-link', link_type: 'Related', outgoing: ['source', 'target'], metadata: {},
		});

		ecanService.setAttentionValue('source', { sti: 1.0, lti: 0.5 });
		ecanService.setAttentionValue('target', { sti: 0.0, lti: 0.5 });

		ecanService.spreadActivation();

		// Target should have received some STI from source
		const targetAv = ecanService.getAttentionValue('target');
		// The exact value depends on spread fraction and rent, but should be > 0 minus rent
		assert.ok(targetAv.sti !== 0.0, 'Target STI should change after spreading');
	});

	test('should collect rent from all nodes', () => {
		ecanService.setAttentionValue('rent-node-1', { sti: 0.5, lti: 0.5 });
		ecanService.setAttentionValue('rent-node-2', { sti: 0.5, lti: 0.5 });

		ecanService.spreadActivation();

		// Both nodes should have STI reduced by rent (0.02)
		const av1 = ecanService.getAttentionValue('rent-node-1');
		const av2 = ecanService.getAttentionValue('rent-node-2');

		assert.ok(av1.sti < 0.5);
		assert.ok(av2.sti < 0.5);
	});

	test('should evict low-STI low-LTI nodes', () => {
		// Create a node that will fall below eviction threshold
		ecanService.setAttentionValue('evict-me', { sti: -0.48, lti: 0.1 });

		ecanService.spreadActivation();

		// After rent (-0.02), STI should be -0.5 or lower
		// With LTI < 0.3, it should be evicted
		const av = ecanService.getAttentionValue('evict-me');
		// If evicted, should return default (0, 0)
		assert.strictEqual(av.sti, 0);
		assert.strictEqual(av.lti, 0);
	});

	test('should not evict high-LTI nodes even with low STI', () => {
		ecanService.setAttentionValue('preserve-me', { sti: -0.48, lti: 0.5 });

		ecanService.spreadActivation();

		// With high LTI, node should not be evicted
		const av = ecanService.getAttentionValue('preserve-me');
		assert.ok(av.sti < 0 || av.lti > 0, 'Node should still exist');
	});

	test('should fire onDidSpread event', () => {
		let firedEvent: ECANSpreadEvent | undefined;
		ecanService.onDidSpread(event => { firedEvent = event; });

		ecanService.spreadActivation();

		assert.ok(firedEvent);
		assert.ok(firedEvent!.durationMs >= 0);
	});

	test('should synchronize salience scores with hypergraph', () => {
		hypergraphStore.addNode({
			id: 'sync-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.0,
		});

		// Set high STI
		ecanService.setAttentionValue('sync-node', { sti: 0.8, lti: 0.5 });

		ecanService.spreadActivation();

		// Check hypergraph node's salience was updated
		const node = hypergraphStore.getNode('sync-node')!;
		// Salience should be (STI + 1) / 2, but STI was reduced by rent
		assert.ok(node.salience_score > 0);
	});

	// --- Snapshot Tests ---

	test('should return valid snapshot', () => {
		ecanService.setAttentionValue('snap-node-1', { sti: 0.5, lti: 0.5 });
		ecanService.setAttentionValue('snap-node-2', { sti: -0.5, lti: 0.5 });

		const snapshot = ecanService.getSnapshot();

		assert.strictEqual(snapshot.attentionalFocusBoundary, 0.0);
		assert.strictEqual(snapshot.totalTrackedNodes, 2);
		assert.strictEqual(snapshot.nodesInFocus, 1); // Only snap-node-1 is above boundary
		assert.ok(snapshot.timestamp > 0);
	});

	test('should track spreading cycles in snapshot', () => {
		assert.strictEqual(ecanService.getSnapshot().spreadingCycles, 0);

		ecanService.spreadActivation();
		assert.strictEqual(ecanService.getSnapshot().spreadingCycles, 1);

		ecanService.spreadActivation();
		assert.strictEqual(ecanService.getSnapshot().spreadingCycles, 2);
	});

	test('should track rent collected in snapshot', () => {
		ecanService.setAttentionValue('rent-track', { sti: 0.5, lti: 0.5 });

		assert.strictEqual(ecanService.getSnapshot().rentCollected, 0);

		ecanService.spreadActivation();

		assert.ok(ecanService.getSnapshot().rentCollected > 0);
	});

	// --- Reset Tests ---

	test('should reset all attention values and counters', () => {
		ecanService.setAttentionValue('reset-node', { sti: 0.5, lti: 0.5 });
		ecanService.setFocusBoundary(0.3);
		ecanService.spreadActivation();

		ecanService.reset();

		assert.strictEqual(ecanService.getAttentionValue('reset-node').sti, 0);
		assert.strictEqual(ecanService.getFocusBoundary(), 0.0);
		assert.strictEqual(ecanService.getSnapshot().spreadingCycles, 0);
		assert.strictEqual(ecanService.getSnapshot().rentCollected, 0);
		assert.strictEqual(ecanService.getSnapshot().totalTrackedNodes, 0);
	});

	// --- OpenCog ECAN Model Tests ---

	test('should implement OpenCog-style STI for short-term importance', () => {
		// STI determines attentional focus
		ecanService.setAttentionValue('sti-test', { sti: 0.7, lti: 0.3 });
		const focus = ecanService.getAttentionalFocus();
		assert.ok(focus.includes('sti-test'));
	});

	test('should implement OpenCog-style LTI for long-term importance', () => {
		// High LTI should protect from eviction
		ecanService.setAttentionValue('lti-test', { sti: -0.49, lti: 0.9 });
		ecanService.spreadActivation();

		// Node should survive due to high LTI
		const av = ecanService.getAttentionValue('lti-test');
		assert.ok(av.lti > 0 || av.sti !== 0, 'High LTI node should be preserved');
	});

	test('should implement economic rent collection', () => {
		const initialSti = 0.5;
		ecanService.setAttentionValue('econ-node', { sti: initialSti, lti: 0.5 });

		ecanService.spreadActivation();

		const finalSti = ecanService.getAttentionValue('econ-node').sti;
		assert.ok(finalSti < initialSti, 'STI should decrease due to rent');
	});
});
