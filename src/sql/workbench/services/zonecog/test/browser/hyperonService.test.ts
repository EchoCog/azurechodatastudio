/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	HyperonService, parseMeTTaProgram, renderMeTTaAtom, unifyAtoms, substituteBindings, atomsEqual
} from 'sql/workbench/services/zonecog/browser/hyperonService';
import { MeTTaAtom } from 'sql/workbench/services/zonecog/common/hyperon';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { PLNReasoningService } from 'sql/workbench/services/zonecog/browser/plnReasoningService';
import { HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { NullLogService } from 'vs/platform/log/common/log';

suite('HyperonService', () => {
	let hyperon: HyperonService;
	let hypergraphStore: HypergraphStore;
	let membraneService: CognitiveMembraneService;
	let plnService: PLNReasoningService;
	let logService: NullLogService;

	setup(() => {
		logService = new NullLogService();
		hypergraphStore = new HypergraphStore(logService);
		membraneService = new CognitiveMembraneService(logService);
		plnService = new PLNReasoningService(logService, hypergraphStore, membraneService);
		hyperon = new HyperonService(logService, hypergraphStore, membraneService, plnService);
	});

	teardown(() => {
		hyperon.dispose();
		plnService.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});

	function makeNode(id: string, nodeType: string, content: string, salience: number): HypergraphNode {
		return { id, node_type: nodeType, content, links: [], metadata: {}, salience_score: salience };
	}

	// -- Parsing -----------------------------------------------------------------

	test('parse handles symbols, variables, numbers, strings, booleans and nesting', () => {
		const atoms = hyperon.parse('(foo $x 42 -3.5 "hi there" True (bar baz))');
		assert.strictEqual(atoms.length, 1);
		const expr = atoms[0];
		assert.strictEqual(expr.kind, 'expression');
		if (expr.kind === 'expression') {
			assert.deepStrictEqual(expr.children[0], { kind: 'symbol', name: 'foo' });
			assert.deepStrictEqual(expr.children[1], { kind: 'variable', name: 'x' });
			assert.deepStrictEqual(expr.children[2], { kind: 'grounded', value: 42 });
			assert.deepStrictEqual(expr.children[3], { kind: 'grounded', value: -3.5 });
			assert.deepStrictEqual(expr.children[4], { kind: 'grounded', value: 'hi there' });
			assert.deepStrictEqual(expr.children[5], { kind: 'grounded', value: true });
			assert.strictEqual(expr.children[6].kind, 'expression');
		}
	});

	test('parse skips comments and throws on malformed input', () => {
		const atoms = hyperon.parse('; a comment\n(a b) ; trailing\n(c d)');
		assert.strictEqual(atoms.length, 2);
		assert.throws(() => hyperon.parse('(unclosed'));
		assert.throws(() => hyperon.parse(')'));
		assert.throws(() => hyperon.parse('"unterminated'));
	});

	test('renderAtom produces canonical round-trippable source', () => {
		const source = '(rule $x (f 1.5 "s") True)';
		const atoms = hyperon.parse(source);
		const rendered = hyperon.renderAtom(atoms[0]);
		assert.strictEqual(rendered, '(rule $x (f 1.5 "s") True)');
		assert.ok(atomsEqual(atoms[0], hyperon.parse(rendered)[0]));
	});

	test('parseMeTTaProgram distinguishes directives from facts', () => {
		const program = parseMeTTaProgram('(fact a) !(+ 1 2) (fact b)');
		assert.strictEqual(program.length, 3);
		assert.strictEqual(program[0].directive, false);
		assert.strictEqual(program[1].directive, true);
		assert.strictEqual(program[2].directive, false);
	});

	// -- Unification -----------------------------------------------------------------

	test('unifyAtoms binds variables consistently and rejects mismatches', () => {
		const pattern = hyperon.parse('(link $x $y $x)')[0];
		const good = hyperon.parse('(link a b a)')[0];
		const bad = hyperon.parse('(link a b c)')[0];
		const bindings = unifyAtoms(pattern, good, new Map());
		assert.ok(bindings);
		assert.strictEqual(renderMeTTaAtom(substituteBindings({ kind: 'variable', name: 'x' }, bindings!)), 'a');
		assert.strictEqual(unifyAtoms(pattern, bad, new Map()), undefined);
	});

	test('unifyAtoms occurs-check prevents infinite structures', () => {
		const variable: MeTTaAtom = { kind: 'variable', name: 'x' };
		const cyclic: MeTTaAtom = { kind: 'expression', children: [{ kind: 'symbol', name: 'f' }, variable] };
		assert.strictEqual(unifyAtoms(variable, cyclic, new Map()), undefined);
	});

	// -- Evaluation --------------------------------------------------------------

	test('run evaluates grounded arithmetic', () => {
		const result = hyperon.run('!(+ 1 (* 2 3))');
		assert.strictEqual(result.errors.length, 0);
		assert.deepStrictEqual(result.directives[0].rendered, ['7']);
	});

	test('run evaluates comparison and logic builtins', () => {
		assert.deepStrictEqual(hyperon.run('!(< 1 2)').directives[0].rendered, ['True']);
		assert.deepStrictEqual(hyperon.run('!(and True False)').directives[0].rendered, ['False']);
		assert.deepStrictEqual(hyperon.run('!(not False)').directives[0].rendered, ['True']);
		assert.deepStrictEqual(hyperon.run('!(== (f a) (f a))').directives[0].rendered, ['True']);
		assert.deepStrictEqual(hyperon.run('!(== (f a) (f b))').directives[0].rendered, ['False']);
	});

	test('division by zero produces an error and no result', () => {
		const result = hyperon.run('!(/ 1 0)');
		assert.strictEqual(result.directives[0].results.length, 0);
		assert.ok(result.errors.some(e => e.includes('division by zero')));
	});

	test('rules rewrite expressions - single result', () => {
		const result = hyperon.run('(= (double $x) (* $x 2)) !(double 21)');
		assert.deepStrictEqual(result.directives[0].rendered, ['42']);
	});

	test('rules are nondeterministic - multiple results collected', () => {
		const result = hyperon.run('(= (color) red) (= (color) green) (= (color) blue) !(color)');
		assert.deepStrictEqual(result.directives[0].rendered.sort(), ['blue', 'green', 'red']);
	});

	test('recursive rules terminate - factorial', () => {
		const program = `
			(= (fact 0) 1)
			(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) (quote nope)))
			!(fact 5)
		`;
		const result = hyperon.run(program);
		assert.ok(result.directives[0].rendered.includes('120'));
	});

	test('if special form selects branches per condition result', () => {
		assert.deepStrictEqual(hyperon.run('!(if (> 3 1) yes no)').directives[0].rendered, ['yes']);
		assert.deepStrictEqual(hyperon.run('!(if (< 3 1) yes no)').directives[0].rendered, ['no']);
	});

	test('quote prevents evaluation', () => {
		assert.deepStrictEqual(hyperon.run('!(quote (+ 1 2))').directives[0].rendered, ['(+ 1 2)']);
	});

	test('match queries the space and evaluates templates', () => {
		const program = `
			(parent tom bob)
			(parent bob ann)
			!(match &self (parent $p $c) (pair $p $c))
		`;
		const result = hyperon.run(program);
		const rendered = result.directives[0].rendered.sort();
		assert.deepStrictEqual(rendered, ['(pair bob ann)', '(pair tom bob)']);
	});

	test('nested match implements joins across facts', () => {
		const program = `
			(parent tom bob)
			(parent bob ann)
			!(match &self (parent $g $p) (match &self (parent $p $c) (grandparent $g $c)))
		`;
		const result = hyperon.run(program);
		assert.deepStrictEqual(result.directives[0].rendered, ['(grandparent tom ann)']);
	});

	test('unmatched expressions evaluate to themselves (normal form)', () => {
		const result = hyperon.run('!(no-such-rule 1 2)');
		assert.deepStrictEqual(result.directives[0].rendered, ['(no-such-rule 1 2)']);
	});

	test('step budget halts runaway recursion with an error', () => {
		const result = hyperon.run('(= (loop $x) (loop (+ $x 1))) !(loop 0)');
		assert.ok(result.errors.length > 0);
		assert.ok(result.errors.some(e => e.includes('budget') || e.includes('depth')));
	});

	test('run fires onDidRunProgram', () => {
		let fired = 0;
		hyperon.onDidRunProgram(() => fired++);
		hyperon.run('!(+ 1 1)');
		assert.strictEqual(fired, 1);
	});

	// -- Space management -----------------------------------------------------------

	test('addToSpace persists facts across runs and rejects directives', () => {
		const added = hyperon.addToSpace('(likes cat fish) (= (meal $x) (likes $x fish))');
		assert.strictEqual(added, 2);
		const stats = hyperon.getSpaceStats();
		assert.strictEqual(stats.atomCount, 2);
		assert.strictEqual(stats.ruleCount, 1);
		const result = hyperon.run('!(match &self (likes $w fish) $w)');
		assert.deepStrictEqual(result.directives[0].rendered, ['cat']);
		assert.throws(() => hyperon.addToSpace('!(+ 1 1)'));
	});

	test('run does not mutate the persistent space', () => {
		hyperon.run('(transient fact) !(+ 1 1)');
		assert.strictEqual(hyperon.getSpaceStats().atomCount, 0);
	});

	test('query matches pattern and instantiates template against persistent space', () => {
		hyperon.addToSpace('(edge a b) (edge b c)');
		const results = hyperon.query('(edge $x $y)', '(from $x)');
		assert.deepStrictEqual(results.map(r => hyperon.renderAtom(r)).sort(), ['(from a)', '(from b)']);
	});

	test('resetSpace empties the space', () => {
		hyperon.addToSpace('(a) (b)');
		hyperon.resetSpace();
		assert.strictEqual(hyperon.getSpaceStats().atomCount, 0);
	});

	// -- Bidirectional binding ------------------------------------------------------

	test('jsToAtom and atomToJs round trip primitives, arrays and objects', () => {
		assert.deepStrictEqual(hyperon.jsToAtom(3.5), { kind: 'grounded', value: 3.5 });
		assert.deepStrictEqual(hyperon.jsToAtom('text'), { kind: 'grounded', value: 'text' });
		assert.deepStrictEqual(hyperon.jsToAtom(true), { kind: 'grounded', value: true });
		assert.deepStrictEqual(hyperon.atomToJs(hyperon.jsToAtom([1, 'two', false])), [1, 'two', false]);
		const objectAtom = hyperon.jsToAtom({ alpha: 1, beta: [2, 3] });
		assert.strictEqual(renderMeTTaAtom(objectAtom), '((alpha 1) (beta (2 3)))');
		assert.deepStrictEqual(hyperon.atomToJs(objectAtom), [['alpha', 1], ['beta', [2, 3]]]);
	});

	test('atomToJs unwraps symbols and variables to strings', () => {
		assert.strictEqual(hyperon.atomToJs({ kind: 'symbol', name: 'foo' }), 'foo');
		assert.strictEqual(hyperon.atomToJs({ kind: 'variable', name: 'x' }), '$x');
	});

	// -- Hypergraph integration --------------------------------------------------------

	test('importHypergraph adds node, prior and link facts', () => {
		hypergraphStore.addNode(makeNode('n1', 'Concept', 'first', 0.7));
		hypergraphStore.addNode(makeNode('n2', 'Concept', 'second', 0.3));
		hypergraphStore.addLink({ id: 'e1', link_type: 'Association', outgoing: ['n1', 'n2'], metadata: {} });
		const added = hyperon.importHypergraph();
		// 2 nodes × (node + prior) + 1 link
		assert.strictEqual(added, 5);
		const nodes = hyperon.query('(node $t $id $c)', '$id');
		assert.deepStrictEqual(nodes.map(a => hyperon.renderAtom(a)).sort(), ['n1', 'n2']);
		const links = hyperon.query('(link $l $a $b $s $c)', '(pair $a $b)');
		assert.deepStrictEqual(links.map(a => hyperon.renderAtom(a)), ['(pair n1 n2)']);
	});

	// -- MeTTa-native PLN deduction (URE integration) -----------------------------------

	test('runPLNDeduction derives A→C from A→B and B→C and persists it', () => {
		hypergraphStore.addNode(makeNode('a', 'Concept', 'a', 0.6));
		hypergraphStore.addNode(makeNode('b', 'Concept', 'b', 0.5));
		hypergraphStore.addNode(makeNode('c', 'Concept', 'c', 0.4));
		hypergraphStore.addLink({ id: 'ab', link_type: 'Implication', outgoing: ['a', 'b'], metadata: {} });
		hypergraphStore.addLink({ id: 'bc', link_type: 'Implication', outgoing: ['b', 'c'], metadata: {} });
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.8 });
		plnService.setTruthValue('bc', { strength: 0.8, confidence: 0.7 });

		const result = hyperon.runPLNDeduction();
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.inferred.length, 1);
		const conclusion = result.inferred[0];
		assert.strictEqual(conclusion.from, 'a');
		assert.strictEqual(conclusion.to, 'c');
		assert.deepStrictEqual(conclusion.premises, ['ab', 'bc']);

		// Expected strength: sAB*sBC + (1-sAB)*(sC - sB*sBC)/(1-sB)
		// = 0.72 + 0.1*(0.4-0.4)/0.5 = 0.72
		assert.ok(Math.abs(conclusion.truthValue.strength - 0.72) < 1e-9);
		// Expected confidence: 0.8*0.7*0.9 = 0.504
		assert.ok(Math.abs(conclusion.truthValue.confidence - 0.504) < 1e-9);

		// Persisted as an Inferred hypergraph link with PLN-registered truth value
		const inferredLinks = hypergraphStore.getLinksByType('Inferred');
		assert.strictEqual(inferredLinks.length, 1);
		assert.deepStrictEqual(inferredLinks[0].outgoing, ['a', 'c']);
		assert.strictEqual(inferredLinks[0].metadata['rule'], 'metta-deduction');
		const registeredTv = plnService.getTruthValue(conclusion.linkId)!;
		assert.ok(Math.abs(registeredTv.strength - 0.72) < 1e-9);
	});

	test('runPLNDeduction is idempotent across runs', () => {
		hypergraphStore.addNode(makeNode('a', 'Concept', 'a', 0.6));
		hypergraphStore.addNode(makeNode('b', 'Concept', 'b', 0.5));
		hypergraphStore.addNode(makeNode('c', 'Concept', 'c', 0.4));
		hypergraphStore.addLink({ id: 'ab', link_type: 'Implication', outgoing: ['a', 'b'], metadata: {} });
		hypergraphStore.addLink({ id: 'bc', link_type: 'Implication', outgoing: ['b', 'c'], metadata: {} });

		const first = hyperon.runPLNDeduction();
		assert.strictEqual(first.inferred.length, 1);
		const second = hyperon.runPLNDeduction();
		assert.strictEqual(second.inferred.length, 0);
		assert.strictEqual(hypergraphStore.getLinksByType('Inferred').length, 1);
	});

	test('runPLNDeduction skips self-loops and low-confidence conclusions', () => {
		hypergraphStore.addNode(makeNode('a', 'Concept', 'a', 0.5));
		hypergraphStore.addNode(makeNode('b', 'Concept', 'b', 0.5));
		hypergraphStore.addLink({ id: 'ab', link_type: 'Implication', outgoing: ['a', 'b'], metadata: {} });
		hypergraphStore.addLink({ id: 'ba', link_type: 'Implication', outgoing: ['b', 'a'], metadata: {} });
		plnService.setTruthValue('ab', { strength: 0.9, confidence: 0.9 });
		plnService.setTruthValue('ba', { strength: 0.9, confidence: 0.9 });

		// Both derivable conclusions (a→a, b→b) are self-loops: none persisted.
		const result = hyperon.runPLNDeduction();
		assert.strictEqual(result.inferred.length, 0);
		assert.ok(result.conclusionsExamined >= 2);

		// High minConfidence filters everything out too.
		hypergraphStore.addNode(makeNode('c', 'Concept', 'c', 0.5));
		hypergraphStore.addLink({ id: 'bc', link_type: 'Implication', outgoing: ['b', 'c'], metadata: {} });
		plnService.setTruthValue('bc', { strength: 0.8, confidence: 0.1 });
		const filtered = hyperon.runPLNDeduction({ minConfidence: 0.9 });
		assert.strictEqual(filtered.inferred.length, 0);
	});

	test('PLN forward chaining consumes MeTTa-derived truth values', () => {
		hypergraphStore.addNode(makeNode('a', 'Concept', 'a', 0.6));
		hypergraphStore.addNode(makeNode('b', 'Concept', 'b', 0.5));
		hypergraphStore.addNode(makeNode('c', 'Concept', 'c', 0.4));
		hypergraphStore.addLink({ id: 'ab', link_type: 'Implication', outgoing: ['a', 'b'], metadata: {} });
		hypergraphStore.addLink({ id: 'bc', link_type: 'Implication', outgoing: ['b', 'c'], metadata: {} });

		const mettaResult = hyperon.runPLNDeduction();
		assert.strictEqual(mettaResult.inferred.length, 1);
		const registered = plnService.getTruthValue(mettaResult.inferred[0].linkId);
		assert.ok(registered);
		assert.ok(registered!.confidence > 0);
	});

	// -- Membrane integration ----------------------------------------------------------

	test('operations record cerebral membrane activity', () => {
		const before = membraneService.getActivity('cerebral');
		hyperon.run('!(+ 1 1)');
		hyperon.addToSpace('(fact x)');
		hyperon.runPLNDeduction();
		const after = membraneService.getActivity('cerebral');
		assert.ok(after >= before);
	});
});
