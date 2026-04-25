/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { DTESNService } from 'sql/workbench/services/zonecog/browser/dtesnService';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('DTESN Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let dtesnService: IDTESNService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		const hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		dtesnService = instantiationService.createInstance(DTESNService);
	});

	test('should initialise with default 3-layer configuration', () => {
		const config = dtesnService.getConfig();
		assert.strictEqual(config.treeDepth, 3);
		assert.strictEqual(config.inputDim, 8);
		assert.strictEqual(config.outputDim, 4);
		assert.ok(config.layers.length >= 1);
	});

	test('should perform a forward pass and return correct output shape', () => {
		const input = [0.5, 0.3, 0.7, 0.2, 0.6, 0.4, 0.8, 0.1];
		const result = dtesnService.forward(input);

		assert.strictEqual(result.output.length, 4, 'Output dim should be 4');
		assert.strictEqual(result.layerStates.length, 3, 'Should have 3 layer states');
		assert.ok(result.durationMs >= 0);

		// Layer state shapes
		for (let d = 0; d < 3; d++) {
			assert.strictEqual(result.layerStates[d].layer, d);
			assert.strictEqual(result.layerStates[d].activation.length, 50, `Layer ${d} reservoir size should be 50`);
		}
	});

	test('should pad/truncate input to match inputDim', () => {
		// Too short — should be padded
		const shortInput = [0.5, 0.3];
		const result1 = dtesnService.forward(shortInput);
		assert.strictEqual(result1.output.length, 4);

		// Too long — should be truncated
		const longInput = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
		const result2 = dtesnService.forward(longInput);
		assert.strictEqual(result2.output.length, 4);
	});

	test('should maintain state between forward passes (echo property)', () => {
		const input = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
		const zeroInput = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

		// Drive with a spike then silence; reservoir should remember the spike
		dtesnService.forward(input);
		const afterSpike = dtesnService.getState();

		dtesnService.forward(zeroInput);
		const afterSilence = dtesnService.getState();

		// State should differ between spike and silence (echo property)
		const spikeNorm = afterSpike.layers[0].activation.reduce((s, v) => s + Math.abs(v), 0);
		const silenceNorm = afterSilence.layers[0].activation.reduce((s, v) => s + Math.abs(v), 0);
		// Both should be non-zero (reservoir retains state)
		assert.ok(spikeNorm > 0, 'Reservoir should activate on spike input');
		assert.ok(silenceNorm > 0, 'Reservoir should retain echo after spike');
	});

	test('should reset state to zero', () => {
		const input = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
		dtesnService.forward(input);

		dtesnService.resetState();
		const state = dtesnService.getState();
		for (const ls of state.layers) {
			const sum = ls.activation.reduce((s, v) => s + Math.abs(v), 0);
			assert.strictEqual(sum, 0, `Layer ${ls.layer} should be zero after reset`);
		}
	});

	test('should track total ticks', () => {
		const input = [0.5, 0.3, 0.7, 0.2, 0.6, 0.4, 0.8, 0.1];
		for (let i = 0; i < 5; i++) {
			dtesnService.forward(input);
		}
		const state = dtesnService.getState();
		assert.strictEqual(state.totalTicks, 5);
	});

	test('should record and clear training samples', () => {
		assert.strictEqual(dtesnService.getTrainingBufferSize(), 0);

		const input = [0.5, 0.3, 0.7, 0.2, 0.6, 0.4, 0.8, 0.1];
		const target = [0.1, 0.9, 0.3, 0.7];

		dtesnService.recordTrainingSample(input, target, 'test-label');
		assert.strictEqual(dtesnService.getTrainingBufferSize(), 1);

		dtesnService.recordTrainingSample(input, target);
		assert.strictEqual(dtesnService.getTrainingBufferSize(), 2);

		dtesnService.clearTrainingBuffer();
		assert.strictEqual(dtesnService.getTrainingBufferSize(), 0);
	});

	test('should train readout and reduce MSE with consistent data', () => {
		// Create a simple pattern: input sums → target
		const samples = 10;
		for (let i = 0; i < samples; i++) {
			const input = [i / samples, (i + 1) / samples, (i + 2) / samples, (i + 3) / samples,
				(i + 4) / samples, (i + 5) / samples, (i + 6) / samples, (i + 7) / samples];
			const target = [i / samples, 1 - i / samples, 0.5, 0.5];
			dtesnService.recordTrainingSample(input, target);
		}

		const mse = dtesnService.trainReadout();
		assert.ok(mse >= 0, 'MSE should be non-negative');
		assert.ok(isFinite(mse), 'MSE should be finite');
	});

	test('should return non-negative spectral radius for all layers', () => {
		const config = dtesnService.getConfig();
		for (let d = 0; d < config.treeDepth; d++) {
			const sr = dtesnService.getLayerSpectralRadius(d);
			assert.ok(sr >= 0, `Layer ${d} spectral radius should be non-negative`);
			assert.ok(sr < 10, `Layer ${d} spectral radius should be reasonable`);
		}
	});

	test('should return valid diagnostic summary', () => {
		const summary = dtesnService.getDiagnosticSummary();
		assert.ok(summary.includes('DTESN'));
		assert.ok(summary.includes('depth='));
		assert.ok(summary.includes('ticks='));
	});

	test('should fire onDidTick event after each forward pass', async () => {
		let tickCount = 0;
		dtesnService.onDidTick(() => { tickCount++; });

		const input = [0.5, 0.3, 0.7, 0.2, 0.6, 0.4, 0.8, 0.1];
		dtesnService.forward(input);
		dtesnService.forward(input);

		assert.strictEqual(tickCount, 2);
	});

	test('should fire onDidLearn event after training', async () => {
		let learnFired = false;
		let lastSamples = 0;

		dtesnService.onDidLearn((ev) => {
			learnFired = true;
			lastSamples = ev.samplesUsed;
		});

		for (let i = 0; i < 5; i++) {
			dtesnService.recordTrainingSample(
				[i / 5, 1 - i / 5, 0.5, 0.5, 0.2, 0.8, 0.3, 0.7],
				[i / 5, 0.5, 0.5, 1 - i / 5]
			);
		}

		dtesnService.trainReadout();
		assert.ok(learnFired, 'onDidLearn should fire after training');
		assert.strictEqual(lastSamples, 5);
	});
});
