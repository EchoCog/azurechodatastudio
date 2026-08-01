"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextSearchCompleteMessageType = exports.Range = exports.Position = void 0;
class Position {
	line;
	character;
	constructor(line, character) {
		this.line = line;
		this.character = character;
	}
	isBefore(other) { return false; }
	isBeforeOrEqual(other) { return false; }
	isAfter(other) { return false; }
	isAfterOrEqual(other) { return false; }
	isEqual(other) { return false; }
	compareTo(other) { return 0; }
	translate(_, _2) { return new Position(0, 0); }
	with(_) { return new Position(0, 0); }
}
exports.Position = Position;
class Range {
	start;
	end;
	constructor(startLine, startCol, endLine, endCol) {
		this.start = new Position(startLine, startCol);
		this.end = new Position(endLine, endCol);
	}
	isEmpty = false;
	isSingleLine = false;
	contains(positionOrRange) { return false; }
	isEqual(other) { return false; }
	intersection(range) { return undefined; }
	union(other) { return new Range(0, 0, 0, 0); }
	with(_) { return new Range(0, 0, 0, 0); }
}
exports.Range = Range;
/**
 * Represents the severity of a TextSearchComplete message.
 */
var TextSearchCompleteMessageType;
(function (TextSearchCompleteMessageType) {
	TextSearchCompleteMessageType[TextSearchCompleteMessageType["Information"] = 1] = "Information";
	TextSearchCompleteMessageType[TextSearchCompleteMessageType["Warning"] = 2] = "Warning";
})(TextSearchCompleteMessageType || (exports.TextSearchCompleteMessageType = TextSearchCompleteMessageType = {}));
