/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('EmbodiedCognitionService Tests', () => {

	let instantiationService: TestInstantiationService;
	let embodiedService: IEmbodiedCognitionService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
	});

	// -- Sensory percepts ----------------------------------------------------

	test('should record a sensory percept', () => {
		const percept = embodiedService.perceive('schema', 'orders table', '{"columns":["id","total"]}', 0.8);

		assert.ok(percept.id);
		assert.strictEqual(percept.modality, 'schema');
		assert.strictEqual(percept.summary, 'orders table');
		assert.strictEqual(percept.salience, 0.8);
		assert.ok(percept.timestamp > 0);
	});

	test('should persist percepts in hypergraph', () => {
		embodiedService.perceive('query', 'SELECT * FROM orders', 'SELECT * FROM orders');

		const nodes = hypergraphStore.getNodesByType('SensoryPercept');
		assert.strictEqual(nodes.length, 1);
		assert.strictEqual(nodes[0].content, 'SELECT * FROM orders');
	});

	test('should clamp salience to [0, 1]', () => {
		const low = embodiedService.perceive('schema', 'test', '', -0.5);
		assert.strictEqual(low.salience, 0);

		const high = embodiedService.perceive('schema', 'test2', '', 2.0);
		assert.strictEqual(high.salience, 1);
	});

	test('should filter percepts by modality', () => {
		embodiedService.perceive('schema', 's1', '');
		embodiedService.perceive('query', 'q1', '');
		embodiedService.perceive('schema', 's2', '');

		assert.strictEqual(embodiedService.getRecentPercepts('schema').length, 2);
		assert.strictEqual(embodiedService.getRecentPercepts('query').length, 1);
		assert.strictEqual(embodiedService.getRecentPercepts().length, 3);
	});

	test('should limit percept buffer size', () => {
		// MAX_PERCEPTS is 200; add 205 and verify oldest are evicted
		for (let i = 0; i < 205; i++) {
			embodiedService.perceive('interaction', `click-${i}`, '');
		}
		assert.strictEqual(embodiedService.getRecentPercepts(undefined, 300).length, 200);
	});

	test('should fire onDidPerceive event', () => {
		let eventCount = 0;
		embodiedService.onDidPerceive(() => eventCount++);

		embodiedService.perceive('file', 'test.sql', '');
		assert.strictEqual(eventCount, 1);
	});

	// -- Motor actions -------------------------------------------------------

	test('should produce a motor action', () => {
		const action = embodiedService.act('query_suggestion', 'Optimize query', 'SELECT ...', 0.9);

		assert.ok(action.id);
		assert.strictEqual(action.kind, 'query_suggestion');
		assert.strictEqual(action.label, 'Optimize query');
		assert.strictEqual(action.confidence, 0.9);
	});

	test('should persist actions in hypergraph', () => {
		embodiedService.act('insight', 'Found pattern', 'details', 0.7);

		const nodes = hypergraphStore.getNodesByType('MotorAction');
		assert.strictEqual(nodes.length, 1);
	});

	test('should link actions to source percepts', () => {
		const p1 = embodiedService.perceive('query', 'q1', '');
		const p2 = embodiedService.perceive('result', 'r1', '');
		embodiedService.act('insight', 'cross-ref', '', 0.6, [p1.id, p2.id]);

		const actionNodes = hypergraphStore.getNodesByType('MotorAction');
		assert.strictEqual(actionNodes.length, 1);

		const links = hypergraphStore.getLinksByType('MotivatedBy');
		assert.strictEqual(links.length, 2);
	});

	test('should filter actions by kind', () => {
		embodiedService.act('query_suggestion', 'a1', '', 0.5);
		embodiedService.act('insight', 'a2', '', 0.5);
		embodiedService.act('query_suggestion', 'a3', '', 0.5);

		assert.strictEqual(embodiedService.getRecentActions('query_suggestion').length, 2);
		assert.strictEqual(embodiedService.getRecentActions('insight').length, 1);
	});

	test('should fire onDidAct event', () => {
		let eventCount = 0;
		embodiedService.onDidAct(() => eventCount++);

		embodiedService.act('alert', 'test', '', 0.5);
		assert.strictEqual(eventCount, 1);
	});

	// -- Proprioception ------------------------------------------------------

	test('should report proprioceptive state', () => {
		const state = embodiedService.getProprioceptiveState();

		assert.strictEqual(state.activeSensoryChannels, 0);
		assert.strictEqual(state.attentionalFocus, null);
		assert.ok(state.healthy);
		assert.ok(state.lastUpdate > 0);
	});

	test('should track active sensory channels', () => {
		embodiedService.perceive('schema', 's', '');
		embodiedService.perceive('query', 'q', '');

		const state = embodiedService.getProprioceptiveState();
		assert.strictEqual(state.activeSensoryChannels, 2);
	});

	test('should set and clear attentional focus', () => {
		embodiedService.setAttentionalFocus('orders table');
		assert.strictEqual(embodiedService.getProprioceptiveState().attentionalFocus, 'orders table');

		embodiedService.setAttentionalFocus(null);
		assert.strictEqual(embodiedService.getProprioceptiveState().attentionalFocus, null);
	});

	test('should fire proprioception events on state changes', () => {
		let eventCount = 0;
		embodiedService.onDidUpdateProprioception(() => eventCount++);

		embodiedService.perceive('schema', 's', '');
		assert.ok(eventCount >= 1);

		const before = eventCount;
		embodiedService.setAttentionalFocus('test');
		assert.ok(eventCount > before);
	});

	// -- Environment snapshot ------------------------------------------------

	test('should provide environment snapshot', () => {
		embodiedService.perceive('schema', 'orders', '');
		embodiedService.perceive('schema', 'products', '');
		embodiedService.perceive('query', 'SELECT *', '');
		embodiedService.act('insight', 'pattern', '', 0.5);

		const env = embodiedService.getEnvironmentSnapshot();
		assert.strictEqual(env.knownSchemas.length, 2);
		assert.strictEqual(env.recentQueryPatterns.length, 1);
		assert.strictEqual(env.totalPercepts, 3);
		assert.strictEqual(env.totalActions, 1);
	});

	// -- Reset ---------------------------------------------------------------

	test('should reset all state', () => {
		embodiedService.perceive('schema', 's', '');
		embodiedService.act('insight', 'i', '', 0.5);
		embodiedService.setAttentionalFocus('test');

		embodiedService.reset();

		assert.strictEqual(embodiedService.getRecentPercepts().length, 0);
		assert.strictEqual(embodiedService.getRecentActions().length, 0);
		assert.strictEqual(embodiedService.getProprioceptiveState().attentionalFocus, null);
	});
});
