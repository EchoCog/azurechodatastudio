"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovedText = exports.SimpleLineRangeMapping = exports.RangeMapping = exports.LineRangeMapping = exports.LinesDiff = void 0;
const lineRange_1 = require("vs/editor/common/core/lineRange");
class LinesDiff {
	changes;
	moves;
	hitTimeout;
	constructor(changes, 
	/**
	 * Sorted by original line ranges.
	 * The original line ranges and the modified line ranges must be disjoint (but can be touching).
	 */
	moves, 
	/**
	 * Indicates if the time out was reached.
	 * In that case, the diffs might be an approximation and the user should be asked to rerun the diff with more time.
	 */
	hitTimeout) {
		this.changes = changes;
		this.moves = moves;
		this.hitTimeout = hitTimeout;
	}
}
exports.LinesDiff = LinesDiff;
/**
 * Maps a line range in the original text model to a line range in the modified text model.
 */
class LineRangeMapping {
	static inverse(mapping, originalLineCount, modifiedLineCount) {
		const result = [];
		let lastOriginalEndLineNumber = 1;
		let lastModifiedEndLineNumber = 1;
		for (const m of mapping) {
			const r = new LineRangeMapping(new lineRange_1.LineRange(lastOriginalEndLineNumber, m.originalRange.startLineNumber), new lineRange_1.LineRange(lastModifiedEndLineNumber, m.modifiedRange.startLineNumber), undefined);
			if (!r.modifiedRange.isEmpty) {
				result.push(r);
			}
			lastOriginalEndLineNumber = m.originalRange.endLineNumberExclusive;
			lastModifiedEndLineNumber = m.modifiedRange.endLineNumberExclusive;
		}
		const r = new LineRangeMapping(new lineRange_1.LineRange(lastOriginalEndLineNumber, originalLineCount + 1), new lineRange_1.LineRange(lastModifiedEndLineNumber, modifiedLineCount + 1), undefined);
		if (!r.modifiedRange.isEmpty) {
			result.push(r);
		}
		return result;
	}
	/**
	 * The line range in the original text model.
	 */
	originalRange;
	/**
	 * The line range in the modified text model.
	 */
	modifiedRange;
	/**
	 * If inner changes have not been computed, this is set to undefined.
	 * Otherwise, it represents the character-level diff in this line range.
	 * The original range of each range mapping should be contained in the original line range (same for modified), exceptions are new-lines.
	 * Must not be an empty array.
	 */
	innerChanges;
	constructor(originalRange, modifiedRange, innerChanges) {
		this.originalRange = originalRange;
		this.modifiedRange = modifiedRange;
		this.innerChanges = innerChanges;
	}
	toString() {
		return `{${this.originalRange.toString()}->${this.modifiedRange.toString()}}`;
	}
	get changedLineCount() {
		return Math.max(this.originalRange.length, this.modifiedRange.length);
	}
	flip() {
		return new LineRangeMapping(this.modifiedRange, this.originalRange, this.innerChanges?.map(c => c.flip()));
	}
}
exports.LineRangeMapping = LineRangeMapping;
/**
 * Maps a range in the original text model to a range in the modified text model.
 */
class RangeMapping {
	/**
	 * The original range.
	 */
	originalRange;
	/**
	 * The modified range.
	 */
	modifiedRange;
	constructor(originalRange, modifiedRange) {
		this.originalRange = originalRange;
		this.modifiedRange = modifiedRange;
	}
	toString() {
		return `{${this.originalRange.toString()}->${this.modifiedRange.toString()}}`;
	}
	flip() {
		return new RangeMapping(this.modifiedRange, this.originalRange);
	}
}
exports.RangeMapping = RangeMapping;
// TODO@hediet: Make LineRangeMapping extend from this!
class SimpleLineRangeMapping {
	original;
	modified;
	constructor(original, modified) {
		this.original = original;
		this.modified = modified;
	}
	toString() {
		return `{${this.original.toString()}->${this.modified.toString()}}`;
	}
	flip() {
		return new SimpleLineRangeMapping(this.modified, this.original);
	}
	join(other) {
		return new SimpleLineRangeMapping(this.original.join(other.original), this.modified.join(other.modified));
	}
}
exports.SimpleLineRangeMapping = SimpleLineRangeMapping;
class MovedText {
	lineRangeMapping;
	/**
	 * The diff from the original text to the moved text.
	 * Must be contained in the original/modified line range.
	 * Can be empty if the text didn't change (only moved).
	 */
	changes;
	constructor(lineRangeMapping, changes) {
		this.lineRangeMapping = lineRangeMapping;
		this.changes = changes;
	}
	flip() {
		return new MovedText(this.lineRangeMapping.flip(), this.changes.map(c => c.flip()));
	}
}
exports.MovedText = MovedText;
