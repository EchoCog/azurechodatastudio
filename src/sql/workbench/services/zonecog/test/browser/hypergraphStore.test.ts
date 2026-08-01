/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IHypergraphStore, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Hypergraph Store Tests', () => {

	let instantiationService: TestInstantiationService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		hypergraphStore = instantiationService.createInstance(HypergraphStore);
	});

	// --- Node CRUD Tests ---

	test('should add and retrieve a node', () => {
		const node: HypergraphNode = {
			id: 'node-1',
			node_type: 'TestNode',
			content: 'Test content',
			links: [],
			metadata: { key: 'value' },
			salience_score: 0.5,
		};

		hypergraphStore.addNode(node);
		const retrieved = hypergraphStore.getNode('node-1');

		assert.ok(retrieved, 'Node should be retrieved');
		assert.strictEqual(retrieved!.id, 'node-1');
		assert.strictEqual(retrieved!.node_type, 'TestNode');
		assert.strictEqual(retrieved!.content, 'Test content');
		assert.strictEqual(retrieved!.salience_score, 0.5);
		assert.deepStrictEqual(retrieved!.metadata, { key: 'value' });
	});

	test('should return undefined for non-existent node', () => {
		const retrieved = hypergraphStore.getNode('non-existent');
		assert.strictEqual(retrieved, undefined);
	});

	test('should update an existing node', () => {
		const node: HypergraphNode = {
			id: 'update-node',
			node_type: 'Original',
			content: 'Original content',
			links: [],
			metadata: {},
			salience_score: 0.3,
		};

		hypergraphStore.addNode(node);
		const updated = hypergraphStore.updateNode('update-node', {
			node_type: 'Updated',
			content: 'Updated content',
			salience_score: 0.9,
		});

		assert.ok(updated, 'Should return updated node');
		assert.strictEqual(updated!.node_type, 'Updated');
		assert.strictEqual(updated!.content, 'Updated content');
		assert.strictEqual(updated!.salience_score, 0.9);
		assert.strictEqual(updated!.id, 'update-node', 'ID should not change');
	});

	test('should return undefined when updating non-existent node', () => {
		const result = hypergraphStore.updateNode('non-existent', { content: 'new' });
		assert.strictEqual(result, undefined);
	});

	test('should remove a node', () => {
		const node: HypergraphNode = {
			id: 'remove-node',
			node_type: 'TestNode',
			content: 'To be removed',
			links: [],
			metadata: {},
			salience_score: 0.5,
		};

		hypergraphStore.addNode(node);
		assert.ok(hypergraphStore.getNode('remove-node'), 'Node should exist');

		const removed = hypergraphStore.removeNode('remove-node');
		assert.strictEqual(removed, true);
		assert.strictEqual(hypergraphStore.getNode('remove-node'), undefined);
	});

	test('should return false when removing non-existent node', () => {
		const result = hypergraphStore.removeNode('non-existent');
		assert.strictEqual(result, false);
	});

	test('should get nodes by type', () => {
		hypergraphStore.addNode({
			id: 'type-1', node_type: 'TypeA', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'type-2', node_type: 'TypeA', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'type-3', node_type: 'TypeB', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		const typeANodes = hypergraphStore.getNodesByType('TypeA');
		assert.strictEqual(typeANodes.length, 2);
		assert.ok(typeANodes.every(n => n.node_type === 'TypeA'));

		const typeBNodes = hypergraphStore.getNodesByType('TypeB');
		assert.strictEqual(typeBNodes.length, 1);
	});

	test('should get all nodes', () => {
		hypergraphStore.addNode({
			id: 'all-1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'all-2', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		const allNodes = hypergraphStore.getAllNodes();
		assert.strictEqual(allNodes.length, 2);
	});

	test('should return defensive copies of nodes', () => {
		const originalNode: HypergraphNode = {
			id: 'defensive-node',
			node_type: 'Test',
			content: 'Original',
			links: ['link-1'],
			metadata: { key: 'value' },
			salience_score: 0.5,
		};

		hypergraphStore.addNode(originalNode);
		const retrieved = hypergraphStore.getNode('defensive-node')!;

		// Mutate the retrieved node
		retrieved.content = 'Mutated';
		retrieved.links.push('link-2');
		retrieved.metadata['newKey'] = 'newValue';

		// Verify the store still has the original values
		const fresh = hypergraphStore.getNode('defensive-node')!;
		assert.strictEqual(fresh.content, 'Original');
		assert.strictEqual(fresh.links.length, 1);
		assert.strictEqual(fresh.metadata['newKey'], undefined);
	});

	// --- Link CRUD Tests ---

	test('should add and retrieve a link', () => {
		// Create nodes first
		hypergraphStore.addNode({
			id: 'link-node-1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'link-node-2', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		const link: HypergraphLink = {
			id: 'link-1',
			link_type: 'RelatesTo',
			outgoing: ['link-node-1', 'link-node-2'],
			metadata: { weight: 0.8 },
		};

		hypergraphStore.addLink(link);
		const retrieved = hypergraphStore.getLink('link-1');

		assert.ok(retrieved, 'Link should be retrieved');
		assert.strictEqual(retrieved!.id, 'link-1');
		assert.strictEqual(retrieved!.link_type, 'RelatesTo');
		assert.deepStrictEqual(retrieved!.outgoing, ['link-node-1', 'link-node-2']);
	});

	test('should update node links array when adding a link', () => {
		hypergraphStore.addNode({
			id: 'auto-link-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		hypergraphStore.addLink({
			id: 'auto-link',
			link_type: 'Auto',
			outgoing: ['auto-link-node'],
			metadata: {},
		});

		const node = hypergraphStore.getNode('auto-link-node')!;
		assert.ok(node.links.includes('auto-link'), 'Node should have link reference');
	});

	test('should remove a link and update node references', () => {
		hypergraphStore.addNode({
			id: 'rm-link-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		hypergraphStore.addLink({
			id: 'rm-link',
			link_type: 'Test',
			outgoing: ['rm-link-node'],
			metadata: {},
		});

		const removed = hypergraphStore.removeLink('rm-link');
		assert.strictEqual(removed, true);
		assert.strictEqual(hypergraphStore.getLink('rm-link'), undefined);

		const node = hypergraphStore.getNode('rm-link-node')!;
		assert.ok(!node.links.includes('rm-link'), 'Node should not have removed link');
	});

	test('should get links by type', () => {
		hypergraphStore.addLink({
			id: 'lt-1', link_type: 'TypeX', outgoing: [], metadata: {},
		});
		hypergraphStore.addLink({
			id: 'lt-2', link_type: 'TypeX', outgoing: [], metadata: {},
		});
		hypergraphStore.addLink({
			id: 'lt-3', link_type: 'TypeY', outgoing: [], metadata: {},
		});

		const typeXLinks = hypergraphStore.getLinksByType('TypeX');
		assert.strictEqual(typeXLinks.length, 2);
	});

	test('should get links for a specific node', () => {
		hypergraphStore.addNode({
			id: 'lf-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'lf-other', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		hypergraphStore.addLink({
			id: 'lf-link-1', link_type: 'A', outgoing: ['lf-node', 'lf-other'], metadata: {},
		});
		hypergraphStore.addLink({
			id: 'lf-link-2', link_type: 'B', outgoing: ['lf-node'], metadata: {},
		});
		hypergraphStore.addLink({
			id: 'lf-link-3', link_type: 'C', outgoing: ['lf-other'], metadata: {},
		});

		const nodeLinks = hypergraphStore.getLinksForNode('lf-node');
		assert.strictEqual(nodeLinks.length, 2);
	});

	// --- Salience Tests ---

	test('should get top salient nodes', () => {
		hypergraphStore.addNode({
			id: 'sal-1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.9,
		});
		hypergraphStore.addNode({
			id: 'sal-2', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'sal-3', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.7,
		});

		const top2 = hypergraphStore.getTopSalientNodes(2);
		assert.strictEqual(top2.length, 2);
		assert.strictEqual(top2[0].id, 'sal-1'); // Highest salience
		assert.strictEqual(top2[1].id, 'sal-3'); // Second highest
	});

	test('should decay all salience scores', () => {
		hypergraphStore.addNode({
			id: 'decay-1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 1.0,
		});
		hypergraphStore.addNode({
			id: 'decay-2', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		hypergraphStore.decayAllSalience(0.8);

		const node1 = hypergraphStore.getNode('decay-1')!;
		const node2 = hypergraphStore.getNode('decay-2')!;

		assert.ok(Math.abs(node1.salience_score - 0.8) < 0.001);
		assert.ok(Math.abs(node2.salience_score - 0.4) < 0.001);
	});

	test('should clamp decay factor to [0, 1]', () => {
		hypergraphStore.addNode({
			id: 'clamp-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		// Factor > 1 should be clamped to 1
		hypergraphStore.decayAllSalience(2.0);
		assert.strictEqual(hypergraphStore.getNode('clamp-node')!.salience_score, 0.5);

		// Factor < 0 should be clamped to 0
		hypergraphStore.decayAllSalience(-1.0);
		assert.strictEqual(hypergraphStore.getNode('clamp-node')!.salience_score, 0.0);
	});

	// --- Bulk Operations ---

	test('should clear all nodes and links', () => {
		hypergraphStore.addNode({
			id: 'clear-1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addNode({
			id: 'clear-2', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		hypergraphStore.addLink({
			id: 'clear-link', link_type: 'T', outgoing: [], metadata: {},
		});

		assert.strictEqual(hypergraphStore.nodeCount(), 2);
		assert.strictEqual(hypergraphStore.linkCount(), 1);

		hypergraphStore.clear();

		assert.strictEqual(hypergraphStore.nodeCount(), 0);
		assert.strictEqual(hypergraphStore.linkCount(), 0);
	});

	test('should report correct node and link counts', () => {
		assert.strictEqual(hypergraphStore.nodeCount(), 0);
		assert.strictEqual(hypergraphStore.linkCount(), 0);

		hypergraphStore.addNode({
			id: 'count-1', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});
		assert.strictEqual(hypergraphStore.nodeCount(), 1);

		hypergraphStore.addLink({
			id: 'count-link', link_type: 'T', outgoing: [], metadata: {},
		});
		assert.strictEqual(hypergraphStore.linkCount(), 1);
	});

	// --- Event Tests ---

	test('should fire onDidChangeNode when adding a node', () => {
		let firedNode: HypergraphNode | undefined;
		hypergraphStore.onDidChangeNode(node => { firedNode = node; });

		hypergraphStore.addNode({
			id: 'event-node', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		assert.ok(firedNode);
		assert.strictEqual(firedNode!.id, 'event-node');
	});

	test('should fire onDidChangeNode when updating a node', () => {
		hypergraphStore.addNode({
			id: 'event-update', node_type: 'T', content: '', links: [], metadata: {}, salience_score: 0.5,
		});

		let firedNode: HypergraphNode | undefined;
		hypergraphStore.onDidChangeNode(node => { firedNode = node; });

		hypergraphStore.updateNode('event-update', { content: 'Updated' });

		assert.ok(firedNode);
		assert.strictEqual(firedNode!.content, 'Updated');
	});

	test('should fire onDidChangeLink when adding a link', () => {
		let firedLink: HypergraphLink | undefined;
		hypergraphStore.onDidChangeLink(link => { firedLink = link; });

		hypergraphStore.addLink({
			id: 'event-link', link_type: 'T', outgoing: [], metadata: {},
		});

		assert.ok(firedLink);
		assert.strictEqual(firedLink!.id, 'event-link');
	});
});
