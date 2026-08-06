/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	TextOperation,
	TextOperationBuilder,
	applyOperation,
	composeOperations,
	identityOperation,
	isIdentityOperation,
	parseTextOperation,
	replaceOperation,
	transformOperations,
	transformPosition,
} from 'sql/workbench/services/zonecog/common/collaborationOT';

/** Deterministic pseudo-random source so a failure can always be reproduced. */
function makeRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

function randomText(random: () => number, length: number): string {
	const alphabet = 'abcdefghij';
	let text = '';
	for (let i = 0; i < length; i++) {
		text += alphabet[Math.floor(random() * alphabet.length)];
	}
	return text;
}

/** Build an arbitrary well-formed operation against a document. */
function randomOperation(random: () => number, document: string): TextOperation {
	const builder = new TextOperationBuilder();
	let remaining = document.length;
	while (remaining > 0) {
		const chunk = Math.min(remaining, 1 + Math.floor(random() * 4));
		const roll = random();
		if (roll < 0.4) {
			builder.retain(chunk);
			remaining -= chunk;
		} else if (roll < 0.7) {
			builder.insert(randomText(random, 1 + Math.floor(random() * 3)));
		} else {
			builder.delete(chunk);
			remaining -= chunk;
		}
	}
	if (random() < 0.3) {
		builder.insert(randomText(random, 1 + Math.floor(random() * 3)));
	}
	return builder.build();
}

suite('Collaboration Operational Transformation Tests', () => {

	test('should track base and target lengths', () => {
		const operation = new TextOperationBuilder().retain(3).insert('xy').delete(2).build();
		assert.strictEqual(operation.baseLength, 5);
		assert.strictEqual(operation.targetLength, 5);
	});

	test('should apply retain, insert and delete', () => {
		const operation = new TextOperationBuilder().retain(5).insert(' brave').retain(7).build();
		assert.strictEqual(applyOperation(operation, 'hello world!'), 'hello brave world!');
	});

	test('should reject an operation built against a different document length', () => {
		const operation = new TextOperationBuilder().retain(5).build();
		assert.throws(() => applyOperation(operation, 'too long for this'), /length 5/);
	});

	test('should merge adjacent components and drop no-ops', () => {
		const operation = new TextOperationBuilder().retain(2).retain(3).insert('a').insert('b').delete(0).build();
		assert.strictEqual(operation.components.length, 2);
		assert.deepStrictEqual(operation.components[0], { type: 'retain', count: 5 });
		assert.deepStrictEqual(operation.components[1], { type: 'insert', text: 'ab' });
	});

	test('should canonicalize an insert that follows a delete', () => {
		const viaDeleteFirst = new TextOperationBuilder().delete(2).insert('hi').build();
		const viaInsertFirst = new TextOperationBuilder().insert('hi').delete(2).build();
		assert.deepStrictEqual(viaDeleteFirst.components, viaInsertFirst.components);
	});

	test('identity operation should leave the document untouched', () => {
		const operation = identityOperation(5);
		assert.ok(isIdentityOperation(operation));
		assert.strictEqual(applyOperation(operation, 'abcde'), 'abcde');
	});

	test('replaceOperation should express an editor edit', () => {
		const operation = replaceOperation(11, 6, 5, 'there');
		assert.strictEqual(applyOperation(operation, 'hello world'), 'hello there');
		assert.ok(!isIdentityOperation(operation));
	});

	test('replaceOperation should clamp out-of-range edits', () => {
		const operation = replaceOperation(5, 10, 4, '!');
		assert.strictEqual(applyOperation(operation, 'abcde'), 'abcde!');
	});

	test('compose should equal applying both operations in sequence', () => {
		const first = replaceOperation(5, 0, 0, 'ab');
		const second = replaceOperation(7, 7, 0, 'z');
		const composed = composeOperations(first, second);
		assert.strictEqual(applyOperation(composed, 'hello'), applyOperation(second, applyOperation(first, 'hello')));
	});

	test('compose should cancel text that is inserted and then deleted', () => {
		const insert = replaceOperation(3, 3, 0, 'xyz');
		const remove = replaceOperation(6, 3, 3, '');
		assert.strictEqual(applyOperation(composeOperations(insert, remove), 'abc'), 'abc');
	});

	test('compose should reject operations that do not line up', () => {
		const first = identityOperation(4);
		const second = identityOperation(9);
		assert.throws(() => composeOperations(first, second), /Cannot compose/);
	});

	test('transform should merge concurrent inserts at different offsets', () => {
		const document = 'hello world';
		const mine = replaceOperation(document.length, 0, 0, '>> ');
		const theirs = replaceOperation(document.length, 11, 0, '!');
		const [minePrime, theirsPrime] = transformOperations(mine, theirs);

		const afterMine = applyOperation(theirsPrime, applyOperation(mine, document));
		const afterTheirs = applyOperation(minePrime, applyOperation(theirs, document));
		assert.strictEqual(afterMine, '>> hello world!');
		assert.strictEqual(afterMine, afterTheirs);
	});

	test('transform should order concurrent inserts at the same offset deterministically', () => {
		const document = 'ab';
		const mine = replaceOperation(2, 1, 0, 'X');
		const theirs = replaceOperation(2, 1, 0, 'Y');
		const [minePrime, theirsPrime] = transformOperations(mine, theirs);
		assert.strictEqual(applyOperation(theirsPrime, applyOperation(mine, document)), 'aXYb');
		assert.strictEqual(applyOperation(minePrime, applyOperation(theirs, document)), 'aXYb');
	});

	test('transform should not delete the same text twice', () => {
		const document = 'abcdef';
		const mine = replaceOperation(6, 1, 3, '');
		const theirs = replaceOperation(6, 2, 3, '');
		const [minePrime, theirsPrime] = transformOperations(mine, theirs);
		// 'bcd' and 'cde' overlap on 'cd'; the union must be removed exactly once.
		const converged = applyOperation(theirsPrime, applyOperation(mine, document));
		assert.strictEqual(converged, 'af');
		assert.strictEqual(applyOperation(minePrime, applyOperation(theirs, document)), converged);
	});

	test('transform should preserve an insert made inside a concurrently deleted range', () => {
		const document = 'abcdef';
		const insert = replaceOperation(6, 3, 0, 'XY');
		const remove = replaceOperation(6, 1, 4, '');
		const [insertPrime, removePrime] = transformOperations(insert, remove);
		assert.strictEqual(applyOperation(removePrime, applyOperation(insert, document)), 'aXYf');
		assert.strictEqual(applyOperation(insertPrime, applyOperation(remove, document)), 'aXYf');
	});

	test('transform should reject operations with different bases', () => {
		assert.throws(() => transformOperations(identityOperation(3), identityOperation(4)), /base lengths differ/);
	});

	test('should satisfy TP1 across randomized concurrent edits', () => {
		const random = makeRandom(20260803);
		for (let iteration = 0; iteration < 2000; iteration++) {
			const document = randomText(random, Math.floor(random() * 20));
			const mine = randomOperation(random, document);
			const theirs = randomOperation(random, document);
			const [minePrime, theirsPrime] = transformOperations(mine, theirs);

			// TP1: applying either operation then the other side's transformed
			// counterpart must reach the same document.
			const viaMine = applyOperation(theirsPrime, applyOperation(mine, document));
			const viaTheirs = applyOperation(minePrime, applyOperation(theirs, document));
			assert.strictEqual(viaMine, viaTheirs,
				`TP1 violated for document ${JSON.stringify(document)}`);

			// The composed forms must agree too, since a client folds pending
			// edits together before sending them.
			assert.strictEqual(
				applyOperation(composeOperations(mine, theirsPrime), document),
				applyOperation(composeOperations(theirs, minePrime), document));
		}
	});

	test('compose should be associative across randomized edits', () => {
		const random = makeRandom(4242);
		for (let iteration = 0; iteration < 500; iteration++) {
			const document = randomText(random, Math.floor(random() * 15));
			const first = randomOperation(random, document);
			const afterFirst = applyOperation(first, document);
			const second = randomOperation(random, afterFirst);
			const third = randomOperation(random, applyOperation(second, afterFirst));

			const leftAssociated = composeOperations(composeOperations(first, second), third);
			const rightAssociated = composeOperations(first, composeOperations(second, third));
			assert.strictEqual(applyOperation(leftAssociated, document), applyOperation(rightAssociated, document));
		}
	});

	test('transformPosition should follow the text a cursor points at', () => {
		assert.strictEqual(transformPosition(replaceOperation(10, 2, 0, 'XYZ'), 5), 8);
		assert.strictEqual(transformPosition(replaceOperation(10, 6, 0, 'XYZ'), 5), 5);
		assert.strictEqual(transformPosition(replaceOperation(10, 1, 3, ''), 6), 3);
		assert.strictEqual(transformPosition(replaceOperation(10, 4, 3, ''), 5), 4);
		assert.strictEqual(transformPosition(identityOperation(10), 7), 7);
	});

	test('should accept a well-formed operation from the wire', () => {
		const operation = new TextOperationBuilder().retain(2).insert('hi').delete(1).build();
		const parsed = parseTextOperation(JSON.parse(JSON.stringify(operation)));
		assert.ok(parsed);
		assert.strictEqual(applyOperation(parsed!, 'abc'), 'abhi');
	});

	test('should reject malformed operations from the wire', () => {
		const malformed: unknown[] = [
			null,
			42,
			'retain 3',
			{},
			{ components: 'nope' },
			{ components: [{ type: 'retain', count: -1 }] },
			{ components: [{ type: 'retain', count: 1.5 }] },
			{ components: [{ type: 'insert', text: 42 }] },
			{ components: [{ type: 'wat', count: 1 }] },
			// Declared lengths that disagree with the components would corrupt
			// every replica that trusted them.
			{ components: [{ type: 'retain', count: 3 }], baseLength: 9 },
			{ components: [{ type: 'retain', count: 3 }], targetLength: 9 },
		];
		for (const value of malformed) {
			assert.strictEqual(parseTextOperation(value), undefined, `accepted ${JSON.stringify(value)}`);
		}
	});
});
