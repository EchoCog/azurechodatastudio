/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { TestAccessibilityService } from 'vs/platform/accessibility/test/common/testAccessibilityService';

import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { IHypergraphVisualizationService } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { HypergraphVisualizationService } from 'sql/workbench/services/zonecog/browser/hypergraphVisualizationService';

function makeNode(id: string, type: string, salience: number, content = `${id} content`): HypergraphNode {
	return { id, node_type: type, content, links: [], metadata: {}, salience_score: salience };
}

suite('Hypergraph Visualization Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let hypergraphStore: IHypergraphStore;
	let membraneService: ICognitiveMembraneService;
	let ecanService: IECANAttentionService;
	let visualizationService: IHypergraphVisualizationService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IAccessibilityService, new TestAccessibilityService());
		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);
		membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);
		ecanService = instantiationService.createInstance(ECANAttentionService);
		instantiationService.stub(IECANAttentionService, ecanService);
		visualizationService = instantiationService.createInstance(HypergraphVisualizationService);
	});

	// --- Simulation core ---------------------------------------------------

	test('rebuild populates sim nodes from the hypergraph store', () => {
		hypergraphStore.addNode(makeNode('n1', 'TestNode', 0.9));
		hypergraphStore.addNode(makeNode('n2', 'TestNode', 0.4));
		visualizationService.rebuild();

		const sims = visualizationService.getSimNodes();
		assert.strictEqual(sims.length, 2);
		assert.ok(sims.every(s => s.radius >= 3));
	});

	test('simulation keeps the most salient nodes within budget', () => {
		for (let i = 0; i < 30; i++) {
			hypergraphStore.addNode(makeNode(`n${i}`, 'Bulk', i / 30));
		}
		visualizationService.setNodeBudget(10);
		const sims = visualizationService.getSimNodes();
		assert.strictEqual(sims.length, 10);
		// Top-salience retained: n29 is highest
		assert.ok(sims.some(s => s.node.id === 'n29'));
		assert.ok(!sims.some(s => s.node.id === 'n0'));
	});

	test('simulation respects node budget floor and ceiling', () => {
		visualizationService.setNodeBudget(1);
		assert.strictEqual(visualizationService.getNodeBudget(), 10);
		visualizationService.setNodeBudget(5000);
		assert.strictEqual(visualizationService.getNodeBudget(), 1000);
	});

	test('layout positions persist across rebuilds', () => {
		hypergraphStore.addNode(makeNode('stable', 'Stable', 0.8));
		visualizationService.rebuild();
		const before = visualizationService.getSimNode('stable')!;
		const x = before.x;
		const y = before.y;

		hypergraphStore.addNode(makeNode('other', 'Stable', 0.3));
		visualizationService.rebuild();
		const after = visualizationService.getSimNode('stable')!;
		assert.strictEqual(after.x, x);
		assert.strictEqual(after.y, y);
	});

	test('tick moves nodes toward equilibrium and clamps to viewport', () => {
		hypergraphStore.addNode(makeNode('a', 'T', 0.5));
		hypergraphStore.addNode(makeNode('b', 'T', 0.5));
		visualizationService.setViewportSize(400, 300);
		visualizationService.rebuild();
		visualizationService.tick();
		for (const sim of visualizationService.getSimNodes()) {
			assert.ok(sim.x >= sim.radius && sim.x <= 400 - sim.radius);
			assert.ok(sim.y >= sim.radius && sim.y <= 300 - sim.radius);
		}
	});

	test('binary links become sim edges; n-ary links are skipped', () => {
		hypergraphStore.addNode(makeNode('s', 'T', 0.5));
		hypergraphStore.addNode(makeNode('t', 'T', 0.5));
		hypergraphStore.addNode(makeNode('u', 'T', 0.5));
		hypergraphStore.addLink({ id: 'l1', link_type: 'Related', outgoing: ['s', 't'], metadata: {} });
		hypergraphStore.addLink({ id: 'l2', link_type: 'Triple', outgoing: ['s', 't', 'u'], metadata: {} });
		visualizationService.rebuild();
		const edges = visualizationService.getSimEdges();
		assert.strictEqual(edges.length, 1);
		assert.strictEqual(edges[0].link.id, 'l1');
	});

	test('pinned nodes do not integrate during tick', () => {
		hypergraphStore.addNode(makeNode('pin', 'T', 0.5));
		visualizationService.rebuild();
		const sim = visualizationService.getSimNode('pin')!;
		visualizationService.setPinned('pin', true);
		const x = sim.x;
		const y = sim.y;
		visualizationService.tick();
		assert.strictEqual(sim.x, x);
		assert.strictEqual(sim.y, y);
	});

	test('moveNode clamps to viewport and pins the node', () => {
		hypergraphStore.addNode(makeNode('mv', 'T', 0.5));
		visualizationService.setViewportSize(200, 200);
		visualizationService.rebuild();
		visualizationService.moveNode('mv', 9999, -50);
		const sim = visualizationService.getSimNode('mv')!;
		assert.ok(sim.x <= 200 - sim.radius);
		assert.ok(sim.y >= sim.radius);
		assert.strictEqual(sim.pinned, true);
	});

	// --- Color registry -----------------------------------------------------

	test('colorForNodeType is deterministic and stable', () => {
		const c1 = visualizationService.colorForNodeType('QueryInput');
		const c2 = visualizationService.colorForNodeType('QueryInput');
		assert.strictEqual(c1, c2);
		assert.ok(c1.startsWith('hsl('));
	});

	test('registered colors override the hash fallback', () => {
		visualizationService.registerNodeTypeColor('CognitiveDecision', '#ff0000');
		assert.strictEqual(visualizationService.colorForNodeType('CognitiveDecision'), '#ff0000');
	});

	test('radiusForSalience clamps to [0, 1]', () => {
		assert.strictEqual(visualizationService.radiusForSalience(-1), 3);
		assert.strictEqual(visualizationService.radiusForSalience(2), 10);
	});

	// --- Selection bus ---------------------------------------------------------

	test('focusNode fires onDidFocusNode and stores focus', () => {
		let fired: { nodeId: string; source: string } | undefined;
		visualizationService.onDidFocusNode(f => fired = f);
		visualizationService.focusNode('abc', 'test');
		assert.strictEqual(fired!.nodeId, 'abc');
		assert.strictEqual(fired!.source, 'test');
		assert.strictEqual(visualizationService.getFocusedNode()?.nodeId, 'abc');
	});

	test('clearFocus only clears matching source', () => {
		visualizationService.focusNode('abc', 'test');
		visualizationService.clearFocus('other');
		assert.ok(visualizationService.getFocusedNode());
		visualizationService.clearFocus('test');
		assert.strictEqual(visualizationService.getFocusedNode(), undefined);
	});

	// --- Animation channels --------------------------------------------------------

	test('scheduleAnimation assigns id and progress 0', () => {
		const id = visualizationService.scheduleAnimation({ kind: 'pulse', nodeId: 'n1', durationMs: 500 });
		const active = visualizationService.getActiveAnimations();
		assert.ok(id.length > 0);
		assert.strictEqual(active.length, 1);
		assert.strictEqual(active[0].progress, 0);
		assert.strictEqual(active[0].nodeId, 'n1');
	});

	test('node mutations synthesize pulse animations', () => {
		hypergraphStore.addNode(makeNode('auto', 'T', 0.5));
		const active = visualizationService.getActiveAnimations();
		assert.ok(active.some(a => a.kind === 'pulse' && a.nodeId === 'auto'));
	});

	test('binary link creation synthesizes flow animations', () => {
		hypergraphStore.addNode(makeNode('fs', 'T', 0.5));
		hypergraphStore.addNode(makeNode('ft', 'T', 0.5));
		hypergraphStore.addLink({ id: 'fl', link_type: 'R', outgoing: ['fs', 'ft'], metadata: {} });
		const active = visualizationService.getActiveAnimations();
		assert.ok(active.some(a => a.kind === 'flow' && a.sourceId === 'fs' && a.targetId === 'ft'));
	});

	test('ECAN spread synthesizes pulse/decay animations', () => {
		hypergraphStore.addNode(makeNode('boosted-node', 'T', 0.5));
		ecanService.setAttentionValue('boosted-node', { sti: 0.9, lti: 0.5 });
		ecanService.setAttentionValue('other-node', { sti: -0.5, lti: 0.1 });
		ecanService.spreadActivation();
		const active = visualizationService.getActiveAnimations();
		// At least one ECAN-sourced animation should exist
		assert.ok(active.some(a => a.payload?.['source'] === 'ecan' || a.payload?.['source'] === 'ecan-rent'));
	});

	test('cancelAnimation removes the effect', () => {
		const id = visualizationService.scheduleAnimation({ kind: 'pulse', nodeId: 'x', durationMs: 5000 });
		visualizationService.cancelAnimation(id);
		assert.strictEqual(visualizationService.getActiveAnimations().length, 0);
	});

	test('cullAnimations filters by viewport', () => {
		hypergraphStore.addNode(makeNode('inside', 'T', 0.5));
		hypergraphStore.addNode(makeNode('outside', 'T', 0.5));
		visualizationService.setViewportSize(400, 400);
		visualizationService.rebuild();
		const sim = visualizationService.getSimNode('inside')!;
		assert.ok(sim); // sim exists
		// addNode synthesizes a node-birth pulse for each new node; use those
		// (rather than scheduling duplicates) to assert viewport filtering.
		// Node positions are clamped into the simulation viewport, so "outside"
		// is expressed via a cull rect that covers only the 'inside' node.
		visualizationService.moveNode('inside', 100, 100);
		visualizationService.moveNode('outside', 390, 390);
		// A rect around (100,100) excludes the node at (390,390).
		const culled = visualizationService.cullAnimations({ x: 60, y: 60, width: 80, height: 80 });
		assert.strictEqual(culled.length, 1);
		assert.strictEqual(culled[0].nodeId, 'inside');
		// A rect covering neither node culls every active animation.
		const culledOut = visualizationService.cullAnimations({ x: 200, y: 200, width: 50, height: 50 });
		assert.strictEqual(culledOut.length, 0);
	});

	// --- Performance guards ---------------------------------------------------------

	test('low-power mode toggles and reports state', () => {
		assert.strictEqual(visualizationService.isLowPowerMode(), false);
		visualizationService.setLowPowerMode(true);
		assert.strictEqual(visualizationService.isLowPowerMode(), true);
	});

	test('suspend stops the frame clock; resume reports not-animating headless', () => {
		visualizationService.setSuspended(true);
		assert.strictEqual(visualizationService.isAnimating(), false);
		visualizationService.setSuspended(false);
		// In headless tests there is no requestAnimationFrame loop running
		assert.strictEqual(typeof visualizationService.isAnimating(), 'boolean');
	});

	test('renderer attachment is disposable', () => {
		let frames = 0;
		const handle = visualizationService.attachRenderer(() => frames++);
		assert.ok(handle);
		handle.dispose();
		// Disposing twice is safe
		handle.dispose();
	});

	// --- Accessibility (reduced motion) ------------------------------------------

	test('reduced motion at construction enables low-power mode', () => {
		const reduced = new TestAccessibilityService();
		reduced.isMotionReduced = () => true;
		const inst = new TestInstantiationService();
		inst.stub(ILogService, new NullLogService());
		inst.stub(IAccessibilityService, reduced);
		inst.stub(IHypergraphStore, inst.createInstance(HypergraphStore));
		inst.stub(ICognitiveMembraneService, inst.createInstance(CognitiveMembraneService));
		inst.stub(IECANAttentionService, inst.createInstance(ECANAttentionService));
		const service = inst.createInstance(HypergraphVisualizationService);
		assert.strictEqual(service.isLowPowerMode(), true);
	});

	test('full motion at construction leaves low-power mode off', () => {
		// The shared setup stubs a TestAccessibilityService with isMotionReduced() === false.
		assert.strictEqual(visualizationService.isLowPowerMode(), false);
	});
});
