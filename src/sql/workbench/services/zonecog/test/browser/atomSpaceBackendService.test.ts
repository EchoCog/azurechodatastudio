/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	AtomSpaceBackendService, nodeHandle, linkHandle, gzipCompress, gzipDecompress, reviseTruthValues
} from 'sql/workbench/services/zonecog/browser/atomSpaceBackendService';
import { salienceToTruthValue, truthValueToSalience, NodeAtom, AtomSpaceConnectionState } from 'sql/workbench/services/zonecog/common/atomSpaceBackend';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { PLNReasoningService } from 'sql/workbench/services/zonecog/browser/plnReasoningService';
import { HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { NullLogService } from 'vs/platform/log/common/log';

suite('AtomSpaceBackendService', () => {
	let backend: AtomSpaceBackendService;
	let hypergraphStore: HypergraphStore;
	let membraneService: CognitiveMembraneService;
	let plnService: PLNReasoningService;
	let logService: NullLogService;

	setup(() => {
		logService = new NullLogService();
		hypergraphStore = new HypergraphStore(logService);
		membraneService = new CognitiveMembraneService(logService);
		plnService = new PLNReasoningService(logService, hypergraphStore, membraneService);
		backend = new AtomSpaceBackendService(logService, hypergraphStore, membraneService, plnService);
	});

	teardown(() => {
		backend.dispose();
		plnService.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});

	function makeNode(id: string, nodeType: string, content: string, salience: number): HypergraphNode {
		return { id, node_type: nodeType, content, links: [], metadata: {}, salience_score: salience };
	}

	// -- Truth value conversion (B.1) -------------------------------------------

	test('salienceToTruthValue maps salience to strength with default confidence', () => {
		const tv = salienceToTruthValue(0.8);
		assert.strictEqual(tv.strength, 0.8);
		assert.strictEqual(tv.confidence, 0.5);
	});

	test('salienceToTruthValue clamps out-of-range salience and scales confidence by evidence', () => {
		assert.strictEqual(salienceToTruthValue(1.7).strength, 1);
		assert.strictEqual(salienceToTruthValue(-0.5).strength, 0);
		const highEvidence = salienceToTruthValue(0.5, 90);
		assert.ok(Math.abs(highEvidence.confidence - 0.9) < 1e-9);
	});

	test('truthValueToSalience shrinks toward 0.5 with low confidence', () => {
		assert.strictEqual(truthValueToSalience({ strength: 0.9, confidence: 1 }), 0.9);
		assert.strictEqual(truthValueToSalience({ strength: 0.9, confidence: 0 }), 0.5);
		const half = truthValueToSalience({ strength: 0.9, confidence: 0.5 });
		assert.ok(Math.abs(half - 0.7) < 1e-9);
	});

	test('salience → truth value → salience round trip is stable at full confidence', () => {
		const tv = salienceToTruthValue(0.65, 1000000);
		const back = truthValueToSalience(tv);
		assert.ok(Math.abs(back - 0.65) < 0.001);
	});

	test('reviseTruthValues pools evidence counts toward the higher-confidence value', () => {
		const revised = reviseTruthValues({ strength: 0.9, confidence: 0.5 }, { strength: 0.5, confidence: 0.5 });
		assert.ok(Math.abs(revised.strength - 0.7) < 1e-9);
		assert.ok(revised.confidence > 0.5);
	});

	// -- Handles and atom table ---------------------------------------------------

	test('nodeHandle is deterministic and content-addressed', () => {
		assert.strictEqual(nodeHandle('ConceptNode', 'cat'), nodeHandle('ConceptNode', 'cat'));
		assert.notStrictEqual(nodeHandle('ConceptNode', 'cat'), nodeHandle('ConceptNode', 'dog'));
		assert.notStrictEqual(nodeHandle('ConceptNode', 'cat'), nodeHandle('PredicateNode', 'cat'));
	});

	test('linkHandle depends on type and ordered outgoing set', () => {
		const a = nodeHandle('ConceptNode', 'a');
		const b = nodeHandle('ConceptNode', 'b');
		assert.strictEqual(linkHandle('InheritanceLink', [a, b]), linkHandle('InheritanceLink', [a, b]));
		assert.notStrictEqual(linkHandle('InheritanceLink', [a, b]), linkHandle('InheritanceLink', [b, a]));
	});

	test('addNode upserts idempotently and revises truth values', () => {
		const first = backend.addNode('ConceptNode', 'cat', { strength: 0.8, confidence: 0.4 });
		const second = backend.addNode('ConceptNode', 'cat', { strength: 0.4, confidence: 0.4 });
		assert.strictEqual(first.handle, second.handle);
		assert.strictEqual(backend.atomCount(), 1);
		const tv = backend.getTruthValue(first.handle)!;
		assert.ok(Math.abs(tv.strength - 0.6) < 1e-9);
		assert.ok(tv.confidence > 0.4);
	});

	test('addLink requires outgoing atoms to exist', () => {
		const cat = backend.addNode('ConceptNode', 'cat');
		assert.throws(() => backend.addLink('InheritanceLink', [cat.handle, 'n:missing']));
		const animal = backend.addNode('ConceptNode', 'animal');
		const link = backend.addLink('InheritanceLink', [cat.handle, animal.handle]);
		assert.strictEqual(link.outgoing.length, 2);
	});

	test('getIncoming returns links referencing an atom and removeAtom is recursive', () => {
		const cat = backend.addNode('ConceptNode', 'cat');
		const animal = backend.addNode('ConceptNode', 'animal');
		const link = backend.addLink('InheritanceLink', [cat.handle, animal.handle]);
		assert.strictEqual(backend.getIncoming(cat.handle).length, 1);
		assert.strictEqual(backend.getIncoming(cat.handle)[0].handle, link.handle);
		const removed = backend.removeAtom(cat.handle, true);
		assert.strictEqual(removed, true);
		assert.strictEqual(backend.getAtom(link.handle), undefined);
		assert.strictEqual(backend.getAtom(cat.handle), undefined);
		assert.notStrictEqual(backend.getAtom(animal.handle), undefined);
	});

	test('getAtomsByType filters the atom table', () => {
		backend.addNode('ConceptNode', 'cat');
		backend.addNode('PredicateNode', 'eats');
		assert.strictEqual(backend.getAtomsByType('ConceptNode').length, 1);
		assert.strictEqual(backend.getAtomsByType('PredicateNode').length, 1);
		assert.strictEqual(backend.getAtomsByType('SchemaNode').length, 0);
	});

	test('events fire on add and remove', () => {
		let added = 0;
		let removed = 0;
		backend.onDidAddAtom(() => added++);
		backend.onDidRemoveAtom(() => removed++);
		const atom = backend.addNode('ConceptNode', 'cat');
		backend.removeAtom(atom.handle);
		assert.strictEqual(added, 1);
		assert.strictEqual(removed, 1);
	});

	test('setTruthValue replaces the stored truth value', () => {
		const atom = backend.addNode('ConceptNode', 'cat');
		backend.setTruthValue(atom.handle, { strength: 0.25, confidence: 0.75 });
		const tv = backend.getTruthValue(atom.handle)!;
		assert.strictEqual(tv.strength, 0.25);
		assert.strictEqual(tv.confidence, 0.75);
	});

	// -- Hypergraph mapping (B.1) --------------------------------------------------

	test('hypergraphNodeToAtom preserves identity, salience and metadata', () => {
		const node = makeNode('hn-1', 'QueryInput', 'what is a cat?', 0.75);
		node.metadata['origin'] = 'test';
		const atom = backend.hypergraphNodeToAtom(node);
		assert.strictEqual(atom.type, 'QueryInputNode');
		assert.strictEqual(atom.name, 'what is a cat?');
		assert.strictEqual(atom.attentionValue.sti, 0.75);
		assert.strictEqual(atom.truthValue.strength, 0.75);
		assert.strictEqual(atom.values['hypergraph:id'], 'hn-1');
		const roundTrip = backend.atomToHypergraphNode(atom);
		assert.strictEqual(roundTrip.id, 'hn-1');
		assert.strictEqual(roundTrip.node_type, 'QueryInput');
		assert.strictEqual(roundTrip.content, 'what is a cat?');
		assert.strictEqual(roundTrip.salience_score, 0.75);
		assert.strictEqual(roundTrip.metadata['origin'], 'test');
	});

	test('importFromHypergraph imports nodes and links, skipping dangling references', () => {
		hypergraphStore.addNode(makeNode('a', 'Concept', 'a', 0.5));
		hypergraphStore.addNode(makeNode('b', 'Concept', 'b', 0.5));
		hypergraphStore.addLink({ id: 'l1', link_type: 'Association', outgoing: ['a', 'b'], metadata: {} });
		hypergraphStore.addLink({ id: 'l2', link_type: 'Association', outgoing: ['a', 'ghost'], metadata: {} });
		const result = backend.importFromHypergraph();
		assert.strictEqual(result.nodesImported, 2);
		assert.strictEqual(result.linksImported, 1);
		assert.deepStrictEqual(result.danglingSkipped, ['l2']);
		assert.strictEqual(backend.atomCount(), 3);
	});

	test('importFromHypergraph merges duplicate content-identical nodes', () => {
		hypergraphStore.addNode(makeNode('x1', 'Concept', 'same', 0.5));
		hypergraphStore.addNode(makeNode('x2', 'Concept', 'same', 0.6));
		const result = backend.importFromHypergraph();
		assert.strictEqual(result.duplicatesMerged, 1);
		assert.strictEqual(backend.getAtomsByType('ConceptNode').length, 1);
	});

	test('import → export round trip restores nodes and links', () => {
		hypergraphStore.addNode(makeNode('a', 'Concept', 'alpha', 0.4));
		hypergraphStore.addNode(makeNode('b', 'Concept', 'beta', 0.6));
		hypergraphStore.addLink({ id: 'l1', link_type: 'Association', outgoing: ['a', 'b'], metadata: {} });
		backend.importFromHypergraph();

		// Drift the store away from the imported state, then export to restore it.
		hypergraphStore.updateNode('a', { content: 'corrupted', salience_score: 0.99 });
		const exported = backend.exportToHypergraph();
		assert.strictEqual(exported.nodesExported, 2);
		assert.strictEqual(exported.linksExported, 1);
		const restored = hypergraphStore.getNode('a')!;
		assert.strictEqual(restored.content, 'alpha');
		assert.strictEqual(restored.salience_score, 0.4);
		assert.strictEqual(hypergraphStore.getLinksForNode('a').length, 1);
		assert.strictEqual(hypergraphStore.getLinksForNode('a')[0].id, 'l1');
	});

	// -- Pattern matching (B.1: GetLink / BindLink) ---------------------------------

	test('get() binds variables with type restrictions', () => {
		const cat = backend.addNode('ConceptNode', 'cat');
		const dog = backend.addNode('ConceptNode', 'dog');
		const animal = backend.addNode('ConceptNode', 'animal');
		backend.addNode('PredicateNode', 'eats');
		backend.addLink('InheritanceLink', [cat.handle, animal.handle]);
		backend.addLink('InheritanceLink', [dog.handle, animal.handle]);

		const result = backend.get({
			variables: [{ name: '$x', typeRestriction: 'ConceptNode' }],
			pattern: {
				kind: 'link', type: 'InheritanceLink', outgoing: [
					{ kind: 'variable', name: '$x' },
					{ kind: 'node', type: 'ConceptNode', name: 'animal' }
				]
			}
		});
		assert.strictEqual(result.bindings.length, 2);
		const names = result.bindings
			.map(binding => (backend.getAtom(binding['$x']) as NodeAtom).name)
			.sort();
		assert.deepStrictEqual(names, ['cat', 'dog']);
	});

	test('get() enforces variable consistency across positions', () => {
		const a = backend.addNode('ConceptNode', 'a');
		const b = backend.addNode('ConceptNode', 'b');
		backend.addLink('SimilarityLink', [a.handle, a.handle]);
		backend.addLink('SimilarityLink', [a.handle, b.handle]);
		const result = backend.get({
			variables: [{ name: '$x' }],
			pattern: {
				kind: 'link', type: 'SimilarityLink', outgoing: [
					{ kind: 'variable', name: '$x' },
					{ kind: 'variable', name: '$x' }
				]
			}
		});
		assert.strictEqual(result.bindings.length, 1);
		assert.strictEqual((backend.getAtom(result.bindings[0]['$x']) as NodeAtom).name, 'a');
	});

	test('get() respects type restrictions on variables', () => {
		const cat = backend.addNode('ConceptNode', 'cat');
		const eats = backend.addNode('PredicateNode', 'eats');
		backend.addLink('EvaluationLink', [eats.handle, cat.handle]);
		const restricted = backend.get({
			variables: [{ name: '$p', typeRestriction: 'PredicateNode' }],
			pattern: {
				kind: 'link', type: 'EvaluationLink', outgoing: [
					{ kind: 'variable', name: '$p' },
					{ kind: 'node', name: 'cat' }
				]
			}
		});
		assert.strictEqual(restricted.bindings.length, 1);
		const mismatched = backend.get({
			variables: [{ name: '$p', typeRestriction: 'ConceptNode' }],
			pattern: {
				kind: 'link', type: 'EvaluationLink', outgoing: [
					{ kind: 'variable', name: '$p' },
					{ kind: 'node', name: 'cat' }
				]
			}
		});
		assert.strictEqual(mismatched.bindings.length, 0);
	});

	test('bind() instantiates the rewrite template for each match', () => {
		const cat = backend.addNode('ConceptNode', 'cat');
		const animal = backend.addNode('ConceptNode', 'animal');
		backend.addLink('InheritanceLink', [cat.handle, animal.handle]);
		const result = backend.bind({
			variables: [{ name: '$x' }],
			pattern: {
				kind: 'link', type: 'InheritanceLink', outgoing: [
					{ kind: 'variable', name: '$x' },
					{ kind: 'node', type: 'ConceptNode', name: 'animal' }
				]
			},
			rewrite: {
				kind: 'link', type: 'MemberLink', outgoing: [
					{ kind: 'variable', name: '$x' },
					{ kind: 'node', type: 'ConceptNode', name: 'kingdom-animalia' }
				]
			}
		});
		assert.strictEqual(result.bindings.length, 1);
		assert.strictEqual(result.instantiated.length, 1);
		assert.strictEqual(result.instantiated[0].type, 'MemberLink');
		assert.strictEqual(backend.getAtomsByType('MemberLink').length, 1);
		assert.ok(backend.getAtomsByType('ConceptNode').some(a => a.kind === 'Node' && a.name === 'kingdom-animalia'));
	});

	// -- Persistence / pagination (B.3) ---------------------------------------------

	test('fetchAtomPage pages through the local atom table when disconnected', async () => {
		for (let i = 0; i < 5; i++) {
			backend.addNode('ConceptNode', `atom-${i}`);
		}
		backend.configure({ pageSize: 2 });
		const first = await backend.fetchAtomPage(undefined);
		assert.strictEqual(first.atoms.length, 2);
		assert.ok(first.nextCursor);
		const second = await backend.fetchAtomPage(first.nextCursor);
		assert.strictEqual(second.atoms.length, 2);
		const third = await backend.fetchAtomPage(second.nextCursor);
		assert.strictEqual(third.atoms.length, 1);
		assert.strictEqual(third.nextCursor, undefined);
	});

	test('streamAtoms yields every atom exactly once', async () => {
		for (let i = 0; i < 7; i++) {
			backend.addNode('ConceptNode', `atom-${i}`);
		}
		backend.configure({ pageSize: 3 });
		const seen = new Set<string>();
		for await (const atom of backend.streamAtoms()) {
			assert.strictEqual(seen.has(atom.handle), false);
			seen.add(atom.handle);
		}
		assert.strictEqual(seen.size, 7);
	});

	test('connect() fails cleanly against an unreachable endpoint', async () => {
		backend.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		const states: AtomSpaceConnectionState[] = [];
		backend.onDidChangeConnectionState(s => states.push(s));
		const connected = await backend.connect();
		assert.strictEqual(connected, false);
		assert.strictEqual(backend.getConnectionState(), 'error');
		assert.ok(states.includes('connecting'));
		assert.ok(states.includes('error'));
	});

	test('persistAll reports failure without throwing when bridge unreachable', async () => {
		backend.addNode('ConceptNode', 'cat');
		backend.configure({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
		let fired = false;
		backend.onDidPersist(() => { fired = true; });
		const result = await backend.persistAll();
		assert.strictEqual(result.success, false);
		assert.ok(result.error);
		assert.strictEqual(fired, true);
	});

	test('gzip round trip preserves payload and compresses repetitive data', async () => {
		const payload = JSON.stringify({ atoms: new Array(200).fill({ type: 'ConceptNode', name: 'repetition' }) });
		const compressed = await gzipCompress(payload);
		assert.ok(compressed.byteLength < payload.length);
		const decompressed = await gzipDecompress(compressed);
		assert.strictEqual(decompressed, payload);
	});

	test('configure merges partial config and getConfig returns defaults otherwise', () => {
		const defaults = backend.getConfig();
		assert.strictEqual(defaults.baseUrl, 'http://127.0.0.1:7807');
		assert.strictEqual(defaults.compressionEnabled, true);
		backend.configure({ pageSize: 64 });
		assert.strictEqual(backend.getConfig().pageSize, 64);
		assert.strictEqual(backend.getConfig().baseUrl, 'http://127.0.0.1:7807');
	});

	test('operations record membrane activity', () => {
		const before = membraneService.getActivity('cerebral');
		backend.addNode('ConceptNode', 'cat');
		backend.importFromHypergraph();
		const after = membraneService.getActivity('cerebral');
		assert.ok(after >= before);
	});

	test('clear() empties the atom table', () => {
		backend.addNode('ConceptNode', 'cat');
		backend.addNode('ConceptNode', 'dog');
		backend.clear();
		assert.strictEqual(backend.atomCount(), 0);
		assert.strictEqual(backend.getAllAtoms().length, 0);
	});
});
