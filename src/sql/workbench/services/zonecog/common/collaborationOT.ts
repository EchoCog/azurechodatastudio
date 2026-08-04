/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Operational transformation (OT) engine for Zone-Cog multi-user cognitive
 * workspaces (Phase D.1).
 *
 * Documents are plain strings and every edit is expressed as a `TextOperation`
 * - an ordered run of retain/insert/delete components that consumes exactly
 * `baseLength` characters and produces exactly `targetLength` characters.
 * Two functions give the algebra its power:
 *
 * - `composeOperations(a, b)` folds two sequential operations into one.
 * - `transformOperations(a, b)` takes two operations made against the *same*
 *   document state and returns `[a', b']` such that
 *   `compose(a, b') === compose(b, a')` (transformation property TP1).
 *
 * TP1 is what makes concurrent editing convergent: whichever order two
 * participants learn about each other's edits, they end up with byte-identical
 * documents.
 */

// ---------------------------------------------------------------------------
// Operation model
// ---------------------------------------------------------------------------

/** Skip `count` characters of the base document, keeping them unchanged. */
export interface RetainComponent {
	readonly type: 'retain';
	readonly count: number;
}

/** Insert `text` at the current position. Consumes no base characters. */
export interface InsertComponent {
	readonly type: 'insert';
	readonly text: string;
}

/** Remove `count` characters of the base document. Produces no output. */
export interface DeleteComponent {
	readonly type: 'delete';
	readonly count: number;
}

export type TextOperationComponent = RetainComponent | InsertComponent | DeleteComponent;

/**
 * An edit to a text document, expressed so that it can be transformed against
 * concurrent edits.
 */
export interface TextOperation {
	readonly components: readonly TextOperationComponent[];
	/** Required length of the document this operation applies to. */
	readonly baseLength: number;
	/** Length of the document produced by applying this operation. */
	readonly targetLength: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Accumulates components into a normalized `TextOperation`.
 *
 * Normalization keeps the result canonical: adjacent components of the same
 * kind are merged, no-ops are dropped, and an insert that lands directly after
 * a delete is re-ordered in front of it. Canonical form matters because
 * `composeOperations` and `transformOperations` are only guaranteed to agree
 * across participants when equivalent operations have identical structure.
 */
export class TextOperationBuilder {

	private readonly _components: TextOperationComponent[] = [];
	private _baseLength = 0;
	private _targetLength = 0;

	/** Keep the next `count` characters. */
	retain(count: number): this {
		if (count <= 0) {
			return this;
		}
		this._baseLength += count;
		this._targetLength += count;
		const last = this._components[this._components.length - 1];
		if (last && last.type === 'retain') {
			this._components[this._components.length - 1] = { type: 'retain', count: last.count + count };
		} else {
			this._components.push({ type: 'retain', count });
		}
		return this;
	}

	/** Insert `text` at the current position. */
	insert(text: string): this {
		if (text.length === 0) {
			return this;
		}
		this._targetLength += text.length;
		const lastIndex = this._components.length - 1;
		const last = this._components[lastIndex];
		if (last && last.type === 'insert') {
			this._components[lastIndex] = { type: 'insert', text: last.text + text };
			return this;
		}
		if (last && last.type === 'delete') {
			// Canonical form places inserts before deletes at the same offset.
			const beforeLast = this._components[lastIndex - 1];
			if (beforeLast && beforeLast.type === 'insert') {
				this._components[lastIndex - 1] = { type: 'insert', text: beforeLast.text + text };
			} else {
				this._components.splice(lastIndex, 0, { type: 'insert', text });
			}
			return this;
		}
		this._components.push({ type: 'insert', text });
		return this;
	}

	/** Remove the next `count` characters. */
	delete(count: number): this {
		if (count <= 0) {
			return this;
		}
		this._baseLength += count;
		const last = this._components[this._components.length - 1];
		if (last && last.type === 'delete') {
			this._components[this._components.length - 1] = { type: 'delete', count: last.count + count };
		} else {
			this._components.push({ type: 'delete', count });
		}
		return this;
	}

	build(): TextOperation {
		return {
			components: this._components.slice(),
			baseLength: this._baseLength,
			targetLength: this._targetLength,
		};
	}
}

/** The operation that leaves a document of `length` characters untouched. */
export function identityOperation(length: number): TextOperation {
	return new TextOperationBuilder().retain(length).build();
}

/**
 * Build the operation for the most common editor edit: replace
 * `deleteCount` characters at `position` with `insertText`.
 */
export function replaceOperation(documentLength: number, position: number, deleteCount: number, insertText: string): TextOperation {
	const start = Math.max(0, Math.min(position, documentLength));
	const removed = Math.max(0, Math.min(deleteCount, documentLength - start));
	return new TextOperationBuilder()
		.retain(start)
		.insert(insertText)
		.delete(removed)
		.retain(documentLength - start - removed)
		.build();
}

/** True when the operation changes nothing about the document it applies to. */
export function isIdentityOperation(operation: TextOperation): boolean {
	return operation.components.every(component => component.type === 'retain');
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Apply `operation` to `document`.
 *
 * @throws when the operation was built against a document of a different
 * length - applying it anyway would silently corrupt the text.
 */
export function applyOperation(operation: TextOperation, document: string): string {
	if (document.length !== operation.baseLength) {
		throw new Error(`Cannot apply operation: expected a document of length ${operation.baseLength}, got ${document.length}`);
	}
	const parts: string[] = [];
	let cursor = 0;
	for (const component of operation.components) {
		switch (component.type) {
			case 'retain':
				parts.push(document.slice(cursor, cursor + component.count));
				cursor += component.count;
				break;
			case 'insert':
				parts.push(component.text);
				break;
			case 'delete':
				cursor += component.count;
				break;
		}
	}
	return parts.join('');
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/**
 * Fold two sequential operations into a single equivalent operation, so that
 * `apply(compose(a, b), doc) === apply(b, apply(a, doc))`.
 *
 * @throws when `second` was not built against the document `first` produces.
 */
export function composeOperations(first: TextOperation, second: TextOperation): TextOperation {
	if (first.targetLength !== second.baseLength) {
		throw new Error(`Cannot compose operations: first produces ${first.targetLength} characters but second expects ${second.baseLength}`);
	}
	const builder = new TextOperationBuilder();
	const a = first.components;
	const b = second.components;
	let i = 0;
	let j = 0;
	let ca: TextOperationComponent | undefined = a[i++];
	let cb: TextOperationComponent | undefined = b[j++];

	while (ca !== undefined || cb !== undefined) {
		// A delete in the first operation removes base characters the second
		// operation never saw, and an insert in the second operation adds
		// characters the first operation never produced: both pass straight
		// through without consuming from the other side.
		if (ca !== undefined && ca.type === 'delete') {
			builder.delete(ca.count);
			ca = a[i++];
			continue;
		}
		if (cb !== undefined && cb.type === 'insert') {
			builder.insert(cb.text);
			cb = b[j++];
			continue;
		}
		if (ca === undefined) {
			throw new Error('Cannot compose operations: first operation is too short');
		}
		if (cb === undefined) {
			throw new Error('Cannot compose operations: first operation is too long');
		}

		if (ca.type === 'retain' && cb.type === 'retain') {
			const length = Math.min(ca.count, cb.count);
			builder.retain(length);
			ca = ca.count > length ? { type: 'retain', count: ca.count - length } : a[i++];
			cb = cb.count > length ? { type: 'retain', count: cb.count - length } : b[j++];
		} else if (ca.type === 'insert' && cb.type === 'delete') {
			// The second operation deletes text the first one just inserted:
			// the two cancel out and neither reaches the result.
			const length = Math.min(ca.text.length, cb.count);
			ca = ca.text.length > length ? { type: 'insert', text: ca.text.slice(length) } : a[i++];
			cb = cb.count > length ? { type: 'delete', count: cb.count - length } : b[j++];
		} else if (ca.type === 'insert' && cb.type === 'retain') {
			const length = Math.min(ca.text.length, cb.count);
			builder.insert(ca.text.slice(0, length));
			ca = ca.text.length > length ? { type: 'insert', text: ca.text.slice(length) } : a[i++];
			cb = cb.count > length ? { type: 'retain', count: cb.count - length } : b[j++];
		} else if (ca.type === 'retain' && cb.type === 'delete') {
			const length = Math.min(ca.count, cb.count);
			builder.delete(length);
			ca = ca.count > length ? { type: 'retain', count: ca.count - length } : a[i++];
			cb = cb.count > length ? { type: 'delete', count: cb.count - length } : b[j++];
		} else {
			throw new Error('Cannot compose operations: incompatible components');
		}
	}

	return builder.build();
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Transform two operations that were both built against the same document
 * state, returning `[aPrime, bPrime]` such that
 * `compose(a, bPrime)` and `compose(b, aPrime)` are equivalent (TP1).
 *
 * `aPrime` is `a` rewritten to apply after `b`, and `bPrime` is `b` rewritten
 * to apply after `a`. Concurrent inserts at the same offset are ordered
 * deterministically by argument position (the first operation's insert wins
 * the earlier slot), which is what keeps every participant convergent as long
 * as they transform in a consistent order.
 *
 * @throws when the two operations were not built against the same base.
 */
export function transformOperations(a: TextOperation, b: TextOperation): [TextOperation, TextOperation] {
	if (a.baseLength !== b.baseLength) {
		throw new Error(`Cannot transform operations: base lengths differ (${a.baseLength} vs ${b.baseLength})`);
	}
	const aPrime = new TextOperationBuilder();
	const bPrime = new TextOperationBuilder();
	const ax = a.components;
	const bx = b.components;
	let i = 0;
	let j = 0;
	let ca: TextOperationComponent | undefined = ax[i++];
	let cb: TextOperationComponent | undefined = bx[j++];

	while (ca !== undefined || cb !== undefined) {
		// Inserts add characters the other side has never seen, so each side
		// keeps its own insert and the other side retains over it.
		if (ca !== undefined && ca.type === 'insert') {
			aPrime.insert(ca.text);
			bPrime.retain(ca.text.length);
			ca = ax[i++];
			continue;
		}
		if (cb !== undefined && cb.type === 'insert') {
			aPrime.retain(cb.text.length);
			bPrime.insert(cb.text);
			cb = bx[j++];
			continue;
		}
		if (ca === undefined) {
			throw new Error('Cannot transform operations: second operation is too long');
		}
		if (cb === undefined) {
			throw new Error('Cannot transform operations: first operation is too long');
		}

		if (ca.type === 'retain' && cb.type === 'retain') {
			const length = Math.min(ca.count, cb.count);
			aPrime.retain(length);
			bPrime.retain(length);
			ca = ca.count > length ? { type: 'retain', count: ca.count - length } : ax[i++];
			cb = cb.count > length ? { type: 'retain', count: cb.count - length } : bx[j++];
		} else if (ca.type === 'delete' && cb.type === 'delete') {
			// Both sides removed the same characters: the work is already done,
			// so neither transformed operation repeats the delete.
			const length = Math.min(ca.count, cb.count);
			ca = ca.count > length ? { type: 'delete', count: ca.count - length } : ax[i++];
			cb = cb.count > length ? { type: 'delete', count: cb.count - length } : bx[j++];
		} else if (ca.type === 'delete' && cb.type === 'retain') {
			const length = Math.min(ca.count, cb.count);
			aPrime.delete(length);
			ca = ca.count > length ? { type: 'delete', count: ca.count - length } : ax[i++];
			cb = cb.count > length ? { type: 'retain', count: cb.count - length } : bx[j++];
		} else if (ca.type === 'retain' && cb.type === 'delete') {
			const length = Math.min(ca.count, cb.count);
			bPrime.delete(length);
			ca = ca.count > length ? { type: 'retain', count: ca.count - length } : ax[i++];
			cb = cb.count > length ? { type: 'delete', count: cb.count - length } : bx[j++];
		} else {
			throw new Error('Cannot transform operations: incompatible components');
		}
	}

	return [aPrime.build(), bPrime.build()];
}

/**
 * Transform a cursor/selection offset so it keeps pointing at the same text
 * after `operation` is applied. Insertions strictly before the offset push it
 * right; deletions that span it collapse it to the start of the removed range.
 */
export function transformPosition(operation: TextOperation, position: number): number {
	let baseCursor = 0;
	let result = position;
	for (const component of operation.components) {
		if (baseCursor > position) {
			break;
		}
		switch (component.type) {
			case 'retain':
				baseCursor += component.count;
				break;
			case 'insert':
				if (baseCursor <= position) {
					result += component.text.length;
				}
				break;
			case 'delete': {
				const removedBefore = Math.min(component.count, Math.max(0, position - baseCursor));
				result -= removedBefore;
				baseCursor += component.count;
				break;
			}
		}
	}
	return Math.max(0, result);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an operation that arrived over the wire.
 *
 * Remote participants are not trusted to send well-formed operations, and an
 * operation whose declared lengths disagree with its components would corrupt
 * every replica that applied it. Returns the validated operation, or
 * `undefined` when the payload is not a structurally sound operation.
 */
export function parseTextOperation(value: unknown): TextOperation | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const candidate = value as Partial<TextOperation>;
	if (!Array.isArray(candidate.components)) {
		return undefined;
	}
	const builder = new TextOperationBuilder();
	for (const component of candidate.components) {
		if (typeof component !== 'object' || component === null) {
			return undefined;
		}
		const typed = component as Partial<TextOperationComponent> & { type?: unknown };
		if (typed.type === 'retain' || typed.type === 'delete') {
			const count = (typed as Partial<RetainComponent>).count;
			if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
				return undefined;
			}
			if (typed.type === 'retain') {
				builder.retain(count);
			} else {
				builder.delete(count);
			}
		} else if (typed.type === 'insert') {
			const text = (typed as Partial<InsertComponent>).text;
			if (typeof text !== 'string' || text.length === 0) {
				return undefined;
			}
			builder.insert(text);
		} else {
			return undefined;
		}
	}
	const operation = builder.build();
	if (typeof candidate.baseLength === 'number' && candidate.baseLength !== operation.baseLength) {
		return undefined;
	}
	if (typeof candidate.targetLength === 'number' && candidate.targetLength !== operation.targetLength) {
		return undefined;
	}
	return operation;
}
