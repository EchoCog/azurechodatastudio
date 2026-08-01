/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICognitiveMembraneService, MembraneStatus, MembraneTriad } from 'sql/workbench/services/zonecog/common/zonecogService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Cognitive Membrane Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let membraneService: ICognitiveMembraneService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		membraneService = instantiationService.createInstance(CognitiveMembraneService);
	});

	teardown(() => {
		(membraneService as CognitiveMembraneService).dispose();
	});

	// --- Initial State Tests ---

	test('should initialize with three triads', () => {
		const statuses = membraneService.getAllStatuses();
		assert.strictEqual(statuses.length, 3);

		const triads = statuses.map(s => s.triad);
		assert.ok(triads.includes('cerebral'));
		assert.ok(triads.includes('somatic'));
		assert.ok(triads.includes('autonomic'));
	});

	test('should initialize all triads as healthy', () => {
		const statuses = membraneService.getAllStatuses();
		for (const status of statuses) {
			assert.strictEqual(status.healthy, true);
			assert.strictEqual(status.errorCount, 0);
			assert.strictEqual(status.activeProcesses, 0);
		}
	});

	test('should report system as healthy initially', () => {
		assert.strictEqual(membraneService.isSystemHealthy(), true);
	});

	// --- Activity Recording Tests ---

	test('should record activity for cerebral triad', () => {
		membraneService.recordActivity('cerebral');
		const status = membraneService.getStatus('cerebral');

		assert.strictEqual(status.activeProcesses, 1);
		assert.ok(status.lastActivity > 0);
	});

	test('should record activity for somatic triad', () => {
		membraneService.recordActivity('somatic');
		const status = membraneService.getStatus('somatic');

		assert.strictEqual(status.activeProcesses, 1);
	});

	test('should record activity for autonomic triad', () => {
		membraneService.recordActivity('autonomic');
		const status = membraneService.getStatus('autonomic');

		assert.strictEqual(status.activeProcesses, 1);
	});

	test('should accumulate activity counts', () => {
		membraneService.recordActivity('cerebral');
		membraneService.recordActivity('cerebral');
		membraneService.recordActivity('cerebral');

		const status = membraneService.getStatus('cerebral');
		assert.strictEqual(status.activeProcesses, 3);
	});

	test('should update lastActivity timestamp on activity', () => {
		const beforeTime = Date.now();
		membraneService.recordActivity('cerebral');
		const afterTime = Date.now();

		const status = membraneService.getStatus('cerebral');
		assert.ok(status.lastActivity >= beforeTime);
		assert.ok(status.lastActivity <= afterTime);
	});

	// --- Error Recording Tests ---

	test('should record errors for cerebral triad', () => {
		membraneService.recordError('cerebral', 'Test error message');
		const status = membraneService.getStatus('cerebral');

		assert.strictEqual(status.errorCount, 1);
	});

	test('should accumulate error counts', () => {
		membraneService.recordError('cerebral', 'Error 1');
		membraneService.recordError('cerebral', 'Error 2');
		membraneService.recordError('cerebral', 'Error 3');

		const status = membraneService.getStatus('cerebral');
		assert.strictEqual(status.errorCount, 3);
	});

	test('should report membrane as unhealthy after too many errors', () => {
		// Record 10 errors (the threshold)
		for (let i = 0; i < 10; i++) {
			membraneService.recordError('cerebral', `Error ${i}`);
		}

		const status = membraneService.getStatus('cerebral');
		assert.strictEqual(status.healthy, false);
	});

	test('should report system as unhealthy if any membrane is unhealthy', () => {
		// Record 10 errors to make cerebral unhealthy
		for (let i = 0; i < 10; i++) {
			membraneService.recordError('cerebral', `Error ${i}`);
		}

		assert.strictEqual(membraneService.isSystemHealthy(), false);
	});

	test('should keep membrane healthy if errors are below threshold', () => {
		for (let i = 0; i < 9; i++) {
			membraneService.recordError('cerebral', `Error ${i}`);
		}

		const status = membraneService.getStatus('cerebral');
		assert.strictEqual(status.healthy, true);
	});

	// --- Error Reset Tests ---

	test('should reset errors for a triad', () => {
		membraneService.recordError('cerebral', 'Error 1');
		membraneService.recordError('cerebral', 'Error 2');

		assert.strictEqual(membraneService.getStatus('cerebral').errorCount, 2);

		membraneService.resetErrors('cerebral');

		assert.strictEqual(membraneService.getStatus('cerebral').errorCount, 0);
	});

	test('should restore health after resetting errors', () => {
		// Make unhealthy
		for (let i = 0; i < 10; i++) {
			membraneService.recordError('cerebral', `Error ${i}`);
		}
		assert.strictEqual(membraneService.getStatus('cerebral').healthy, false);

		// Reset errors
		membraneService.resetErrors('cerebral');

		assert.strictEqual(membraneService.getStatus('cerebral').healthy, true);
		assert.strictEqual(membraneService.isSystemHealthy(), true);
	});

	test('should only reset errors for specified triad', () => {
		membraneService.recordError('cerebral', 'Error 1');
		membraneService.recordError('somatic', 'Error 2');

		membraneService.resetErrors('cerebral');

		assert.strictEqual(membraneService.getStatus('cerebral').errorCount, 0);
		assert.strictEqual(membraneService.getStatus('somatic').errorCount, 1);
	});

	// --- Get Status Tests ---

	test('should return correct status for each triad', () => {
		const triads: MembraneTriad[] = ['cerebral', 'somatic', 'autonomic'];

		for (const triad of triads) {
			const status = membraneService.getStatus(triad);
			assert.strictEqual(status.triad, triad);
			assert.strictEqual(typeof status.healthy, 'boolean');
			assert.strictEqual(typeof status.activeProcesses, 'number');
			assert.strictEqual(typeof status.errorCount, 'number');
			assert.strictEqual(typeof status.lastActivity, 'number');
		}
	});

	test('should throw for unknown triad', () => {
		assert.throws(() => {
			membraneService.getStatus('unknown' as MembraneTriad);
		});
	});

	// --- Event Tests ---

	test('should fire onDidChangeMembraneStatus when activity is recorded', () => {
		let firedStatus: MembraneStatus | undefined;
		membraneService.onDidChangeMembraneStatus(status => { firedStatus = status; });

		membraneService.recordActivity('cerebral');

		assert.ok(firedStatus);
		assert.strictEqual(firedStatus!.triad, 'cerebral');
		assert.strictEqual(firedStatus!.activeProcesses, 1);
	});

	test('should fire onDidChangeMembraneStatus when error is recorded', () => {
		let firedStatus: MembraneStatus | undefined;
		membraneService.onDidChangeMembraneStatus(status => { firedStatus = status; });

		membraneService.recordError('somatic', 'Test error');

		assert.ok(firedStatus);
		assert.strictEqual(firedStatus!.triad, 'somatic');
		assert.strictEqual(firedStatus!.errorCount, 1);
	});

	test('should fire onDidChangeMembraneStatus when errors are reset', () => {
		membraneService.recordError('autonomic', 'Error');

		let firedStatus: MembraneStatus | undefined;
		membraneService.onDidChangeMembraneStatus(status => { firedStatus = status; });

		membraneService.resetErrors('autonomic');

		assert.ok(firedStatus);
		assert.strictEqual(firedStatus!.triad, 'autonomic');
		assert.strictEqual(firedStatus!.errorCount, 0);
	});

	// --- Independent Triad Tests ---

	test('should track triads independently', () => {
		membraneService.recordActivity('cerebral');
		membraneService.recordActivity('cerebral');
		membraneService.recordActivity('somatic');
		membraneService.recordError('autonomic', 'Error');

		assert.strictEqual(membraneService.getStatus('cerebral').activeProcesses, 2);
		assert.strictEqual(membraneService.getStatus('somatic').activeProcesses, 1);
		assert.strictEqual(membraneService.getStatus('autonomic').activeProcesses, 0);
		assert.strictEqual(membraneService.getStatus('autonomic').errorCount, 1);
	});

	// --- P-System Membrane Model Tests ---

	test('should map cerebral to cognitive processing', () => {
		// Cerebral membrane handles core cognitive processing, thinking protocol
		membraneService.recordActivity('cerebral');
		const status = membraneService.getStatus('cerebral');

		assert.strictEqual(status.triad, 'cerebral');
		// Verify it exists and is functional
		assert.ok(status.activeProcesses >= 1);
	});

	test('should map somatic to motor/sensory operations', () => {
		// Somatic membrane handles plugin container, UI interactions
		membraneService.recordActivity('somatic');
		const status = membraneService.getStatus('somatic');

		assert.strictEqual(status.triad, 'somatic');
		assert.ok(status.activeProcesses >= 1);
	});

	test('should map autonomic to monitoring/validation', () => {
		// Autonomic membrane handles validation, state monitoring
		membraneService.recordActivity('autonomic');
		const status = membraneService.getStatus('autonomic');

		assert.strictEqual(status.triad, 'autonomic');
		assert.ok(status.activeProcesses >= 1);
	});

	// --- Auto-Recovery Tests (Phase 7.2 error correction) ---

	test('should halve error count on recovery attempt', () => {
		for (let i = 0; i < 8; i++) {
			membraneService.recordError('cerebral', `Error ${i}`);
		}

		const healthy = membraneService.attemptRecovery('cerebral');

		assert.strictEqual(healthy, true);
		assert.strictEqual(membraneService.getStatus('cerebral').errorCount, 4);
	});

	test('should restore health of an unhealthy membrane through recovery', () => {
		for (let i = 0; i < 12; i++) {
			membraneService.recordError('somatic', `Error ${i}`);
		}
		assert.strictEqual(membraneService.getStatus('somatic').healthy, false);

		const healthy = membraneService.attemptRecovery('somatic');

		assert.strictEqual(healthy, true);
		assert.strictEqual(membraneService.getStatus('somatic').errorCount, 6);
		assert.strictEqual(membraneService.getStatus('somatic').healthy, true);
	});

	test('should report unhealthy when recovery is insufficient', () => {
		for (let i = 0; i < 40; i++) {
			membraneService.recordError('cerebral', `Error ${i}`);
		}

		const healthy = membraneService.attemptRecovery('cerebral');

		assert.strictEqual(healthy, false);
		assert.strictEqual(membraneService.getStatus('cerebral').errorCount, 20);
		assert.strictEqual(membraneService.getStatus('cerebral').healthy, false);
	});

	test('should record autonomic activity during recovery', () => {
		const before = membraneService.getActivity('autonomic');
		membraneService.recordError('cerebral', 'Error');
		membraneService.attemptRecovery('cerebral');

		assert.strictEqual(membraneService.getActivity('autonomic'), before + 1);
	});

	test('should fire status change event on recovery', () => {
		let fired: MembraneStatus | undefined;
		membraneService.recordError('cerebral', 'Error');
		membraneService.recordError('cerebral', 'Error');
		const disposable = membraneService.onDidChangeMembraneStatus(status => {
			if (status.triad === 'cerebral') {
				fired = status;
			}
		});

		membraneService.attemptRecovery('cerebral');
		disposable.dispose();

		assert.ok(fired);
		assert.strictEqual(fired!.errorCount, 1);
	});

	test('should clear errors and pending recovery on reset', () => {
		for (let i = 0; i < 15; i++) {
			membraneService.recordError('autonomic', `Error ${i}`);
		}
		membraneService.resetErrors('autonomic');

		assert.strictEqual(membraneService.getStatus('autonomic').errorCount, 0);
		assert.strictEqual(membraneService.getStatus('autonomic').healthy, true);
	});
});
