/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ISensorimotorBindingService, SensorimotorBindingEvent } from 'sql/workbench/services/zonecog/common/sensorimotorBinding';
import { SensorimotorBindingService } from 'sql/workbench/services/zonecog/browser/sensorimotorBindingService';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { DTESNService } from 'sql/workbench/services/zonecog/browser/dtesnService';
import { IEmbodiedCognitionService, SensoryPercept } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Sensorimotor Binding Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let bindingService: ISensorimotorBindingService;
	let dtesnService: IDTESNService;
	let embodiedService: IEmbodiedCognitionService;
	let hypergraphStore: IHypergraphStore;

	function makePercept(overrides?: Partial<SensoryPercept>): SensoryPercept {
		return {
			id: 'p-test-1',
			modality: 'query',
			summary: 'Observed SELECT query',
			payload: 'SELECT * FROM customers WHERE region = \'EU\'',
			salience: 0.7,
			timestamp: Date.now(),
			...overrides,
		};
	}

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		dtesnService = instantiationService.createInstance(DTESNService);
		instantiationService.stub(IDTESNService, dtesnService);

		embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		bindingService = instantiationService.createInstance(SensorimotorBindingService);
	});

	// --- Initialization ---

	test('should initialize inactive with zeroed statistics', () => {
		const state = bindingService.getState();
		assert.strictEqual(state.active, false);
		assert.strictEqual(state.perceptsEncoded, 0);
		assert.strictEqual(state.actionsEmitted, 0);
		assert.strictEqual(state.feedbackSamples, 0);
		assert.strictEqual(state.trainingRuns, 0);
		assert.strictEqual(state.lastTrainingMse, null);
		assert.ok(state.confidenceThreshold > 0 && state.confidenceThreshold <= 1);
	});

	// --- TemporalEncoder ---

	test('should encode a percept to a vector matching the DTESN input dimension', () => {
		const encoding = bindingService.encodePercept(makePercept());
		assert.strictEqual(encoding.input.length, dtesnService.getConfig().inputDim);
		assert.strictEqual(encoding.perceptId, 'p-test-1');
	});

	test('should produce one-hot modality segment and bounded features', () => {
		const encoding = bindingService.encodePercept(makePercept({ modality: 'schema' }));
		// 'schema' is index 0 in the modality order
		assert.strictEqual(encoding.input[0], 1);
		assert.strictEqual(encoding.input[1], 0);
		for (const v of encoding.input) {
			assert.ok(v >= 0 && v <= 1, `Encoded feature ${v} should be in [0, 1]`);
		}
	});

	test('should encode deterministically for identical percepts', () => {
		const percept = makePercept();
		const a = bindingService.encodePercept(percept);
		const b = bindingService.encodePercept(percept);
		assert.deepStrictEqual(a.input, b.input);
	});

	test('should encode different modalities differently', () => {
		const q = bindingService.encodePercept(makePercept({ modality: 'query' }));
		const f = bindingService.encodePercept(makePercept({ modality: 'file' }));
		assert.notDeepStrictEqual(q.input, f.input);
	});

	// --- MotorDecoder ---

	test('should decode readout output to a motor intent with softmax confidence', () => {
		const intent = bindingService.decodeOutput([2.0, 0.1, 0.1, 0.1]);
		assert.strictEqual(intent.kind, 'insight');
		assert.ok(intent.confidence > 0.25 && intent.confidence <= 1);
		assert.deepStrictEqual(intent.rawOutput, [2.0, 0.1, 0.1, 0.1]);
	});

	test('should decode the argmax unit to the corresponding action kind', () => {
		assert.strictEqual(bindingService.decodeOutput([0, 5, 0, 0]).kind, 'query_suggestion');
		assert.strictEqual(bindingService.decodeOutput([0, 0, 5, 0]).kind, 'schema_recommendation');
		assert.strictEqual(bindingService.decodeOutput([0, 0, 0, 5]).kind, 'alert');
	});

	test('should handle empty readout output gracefully', () => {
		const intent = bindingService.decodeOutput([]);
		assert.strictEqual(intent.confidence, 0);
		assert.deepStrictEqual(intent.rawOutput, []);
	});

	// --- Full pipeline ---

	test('should run a full sensorimotor cycle and fire onDidBind', () => {
		let fired: SensorimotorBindingEvent | undefined;
		bindingService.onDidBind(ev => { fired = ev; });

		const event = bindingService.processPercept(makePercept());
		assert.ok(fired);
		assert.strictEqual(fired!.percept.id, 'p-test-1');
		assert.strictEqual(event.encoding.input.length, dtesnService.getConfig().inputDim);
		assert.strictEqual(event.intent.rawOutput.length, dtesnService.getConfig().outputDim);
		assert.strictEqual(bindingService.getState().perceptsEncoded, 1);
	});

	test('should not emit a motor action when confidence is below threshold', () => {
		bindingService.setConfidenceThreshold(1);
		const event = bindingService.processPercept(makePercept());
		assert.strictEqual(event.action, null);
		assert.strictEqual(bindingService.getState().actionsEmitted, 0);
	});

	test('should emit a motor action via embodied cognition when confidence clears threshold', () => {
		bindingService.setConfidenceThreshold(0);
		const event = bindingService.processPercept(makePercept());
		assert.ok(event.action, 'A motor action should have been emitted');
		assert.strictEqual(event.action!.kind, event.intent.kind);
		assert.deepStrictEqual(event.action!.sourcePercepts, ['p-test-1']);
		assert.strictEqual(bindingService.getState().actionsEmitted, 1);

		const recentActions = embodiedService.getRecentActions(undefined, 5);
		assert.ok(recentActions.some(a => a.id === event.action!.id), 'Action should be recorded by embodied cognition');
	});

	// --- Live binding loop ---

	test('should bind live percepts when started and stop cleanly', () => {
		assert.strictEqual(bindingService.start(), true);
		assert.strictEqual(bindingService.start(), false, 'Second start should be a no-op');
		assert.strictEqual(bindingService.getState().active, true);

		embodiedService.perceive('query', 'live query', 'SELECT 1', 0.5);
		assert.strictEqual(bindingService.getState().perceptsEncoded, 1);

		assert.strictEqual(bindingService.stop(), true);
		assert.strictEqual(bindingService.stop(), false, 'Second stop should be a no-op');

		embodiedService.perceive('query', 'post-stop query', 'SELECT 2', 0.5);
		assert.strictEqual(bindingService.getState().perceptsEncoded, 1, 'Stopped loop must not encode percepts');
	});

	// --- Online learning pipeline ---

	test('should record feedback for a retained percept encoding', () => {
		bindingService.processPercept(makePercept());
		const recorded = bindingService.provideFeedback('p-test-1', 'query_suggestion', 1);
		assert.strictEqual(recorded, true);
		assert.strictEqual(bindingService.getState().feedbackSamples, 1);
		assert.ok(dtesnService.getTrainingBufferSize() >= 1);
	});

	test('should reject feedback for an unknown percept', () => {
		const recorded = bindingService.provideFeedback('nonexistent', 'insight', 1);
		assert.strictEqual(recorded, false);
		assert.strictEqual(bindingService.getState().feedbackSamples, 0);
	});

	test('should train the readout and fire onDidTrainFromFeedback after enough feedback', () => {
		let trained: { samplesUsed: number; mse: number } | undefined;
		bindingService.onDidTrainFromFeedback(ev => { trained = ev; });

		for (let i = 0; i < 16; i++) {
			const percept = makePercept({ id: `p-fb-${i}`, payload: `SELECT ${i} FROM t`, salience: (i % 10) / 10 });
			bindingService.processPercept(percept);
			bindingService.provideFeedback(`p-fb-${i}`, 'query_suggestion', 1);
		}

		assert.ok(trained, 'Training should have been triggered');
		assert.strictEqual(trained!.samplesUsed, 16);
		assert.ok(trained!.mse >= 0);

		const state = bindingService.getState();
		assert.strictEqual(state.trainingRuns, 1);
		assert.strictEqual(state.lastTrainingMse, trained!.mse);
		assert.strictEqual(dtesnService.getTrainingBufferSize(), 0, 'Training buffer should be cleared after training');

		const nodes = hypergraphStore.getNodesByType('SensorimotorTraining');
		assert.strictEqual(nodes.length, 1, 'Training run should be persisted to the hypergraph');
	});

	// --- Configuration & reset ---

	test('should clamp confidence threshold to [0, 1]', () => {
		bindingService.setConfidenceThreshold(2);
		assert.strictEqual(bindingService.getState().confidenceThreshold, 1);
		bindingService.setConfidenceThreshold(-1);
		assert.strictEqual(bindingService.getState().confidenceThreshold, 0);
	});

	test('should reset all statistics and stop the loop', () => {
		bindingService.start();
		bindingService.processPercept(makePercept());
		bindingService.reset();

		const state = bindingService.getState();
		assert.strictEqual(state.active, false);
		assert.strictEqual(state.perceptsEncoded, 0);
		assert.strictEqual(state.actionsEmitted, 0);
		assert.strictEqual(state.feedbackSamples, 0);
		assert.strictEqual(state.trainingRuns, 0);
		assert.strictEqual(state.lastTrainingMse, null);

		assert.strictEqual(bindingService.provideFeedback('p-test-1', 'insight', 1), false,
			'Retained encodings should be cleared on reset');
	});
});
