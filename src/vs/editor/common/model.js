"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplyEditsResult = exports.SearchData = exports.ValidAnnotatedEditOperation = exports.FindMatch = exports.TextModelResolvedOptions = exports.InjectedTextCursorStops = exports.MinimapPosition = exports.GlyphMarginLane = exports.OverviewRulerLane = void 0;
exports.isITextSnapshot = isITextSnapshot;
exports.shouldSynchronizeModel = shouldSynchronizeModel;
const objects_1 = require("vs/base/common/objects");
/**
 * Vertical Lane in the overview ruler of the editor.
 */
var OverviewRulerLane;
(function (OverviewRulerLane) {
	OverviewRulerLane[OverviewRulerLane["Left"] = 1] = "Left";
	OverviewRulerLane[OverviewRulerLane["Center"] = 2] = "Center";
	OverviewRulerLane[OverviewRulerLane["Right"] = 4] = "Right";
	OverviewRulerLane[OverviewRulerLane["Full"] = 7] = "Full";
})(OverviewRulerLane || (exports.OverviewRulerLane = OverviewRulerLane = {}));
/**
 * Vertical Lane in the glyph margin of the editor.
 */
var GlyphMarginLane;
(function (GlyphMarginLane) {
	GlyphMarginLane[GlyphMarginLane["Left"] = 1] = "Left";
	GlyphMarginLane[GlyphMarginLane["Right"] = 2] = "Right";
})(GlyphMarginLane || (exports.GlyphMarginLane = GlyphMarginLane = {}));
/**
 * Position in the minimap to render the decoration.
 */
var MinimapPosition;
(function (MinimapPosition) {
	MinimapPosition[MinimapPosition["Inline"] = 1] = "Inline";
	MinimapPosition[MinimapPosition["Gutter"] = 2] = "Gutter";
})(MinimapPosition || (exports.MinimapPosition = MinimapPosition = {}));
var InjectedTextCursorStops;
(function (InjectedTextCursorStops) {
	InjectedTextCursorStops[InjectedTextCursorStops["Both"] = 0] = "Both";
	InjectedTextCursorStops[InjectedTextCursorStops["Right"] = 1] = "Right";
	InjectedTextCursorStops[InjectedTextCursorStops["Left"] = 2] = "Left";
	InjectedTextCursorStops[InjectedTextCursorStops["None"] = 3] = "None";
})(InjectedTextCursorStops || (exports.InjectedTextCursorStops = InjectedTextCursorStops = {}));
class TextModelResolvedOptions {
	_textModelResolvedOptionsBrand = undefined;
	tabSize;
	indentSize;
	_indentSizeIsTabSize;
	insertSpaces;
	defaultEOL;
	trimAutoWhitespace;
	bracketPairColorizationOptions;
	get originalIndentSize() {
		return this._indentSizeIsTabSize ? 'tabSize' : this.indentSize;
	}
	/**
	 * @internal
	 */
	constructor(src) {
		this.tabSize = Math.max(1, src.tabSize | 0);
		if (src.indentSize === 'tabSize') {
			this.indentSize = this.tabSize;
			this._indentSizeIsTabSize = true;
		}
		else {
			this.indentSize = Math.max(1, src.indentSize | 0);
			this._indentSizeIsTabSize = false;
		}
		this.insertSpaces = Boolean(src.insertSpaces);
		this.defaultEOL = src.defaultEOL | 0;
		this.trimAutoWhitespace = Boolean(src.trimAutoWhitespace);
		this.bracketPairColorizationOptions = src.bracketPairColorizationOptions;
	}
	/**
	 * @internal
	 */
	equals(other) {
		return (this.tabSize === other.tabSize
			&& this._indentSizeIsTabSize === other._indentSizeIsTabSize
			&& this.indentSize === other.indentSize
			&& this.insertSpaces === other.insertSpaces
			&& this.defaultEOL === other.defaultEOL
			&& this.trimAutoWhitespace === other.trimAutoWhitespace
			&& (0, objects_1.equals)(this.bracketPairColorizationOptions, other.bracketPairColorizationOptions));
	}
	/**
	 * @internal
	 */
	createChangeEvent(newOpts) {
		return {
			tabSize: this.tabSize !== newOpts.tabSize,
			indentSize: this.indentSize !== newOpts.indentSize,
			insertSpaces: this.insertSpaces !== newOpts.insertSpaces,
			trimAutoWhitespace: this.trimAutoWhitespace !== newOpts.trimAutoWhitespace,
		};
	}
}
exports.TextModelResolvedOptions = TextModelResolvedOptions;
class FindMatch {
	_findMatchBrand = undefined;
	range;
	matches;
	/**
	 * @internal
	 */
	constructor(range, matches) {
		this.range = range;
		this.matches = matches;
	}
}
exports.FindMatch = FindMatch;
/**
 * @internal
 */
function isITextSnapshot(obj) {
	return (obj && typeof obj.read === 'function');
}
/**
 * @internal
 */
class ValidAnnotatedEditOperation {
	identifier;
	range;
	text;
	forceMoveMarkers;
	isAutoWhitespaceEdit;
	_isTracked;
	constructor(identifier, range, text, forceMoveMarkers, isAutoWhitespaceEdit, _isTracked) {
		this.identifier = identifier;
		this.range = range;
		this.text = text;
		this.forceMoveMarkers = forceMoveMarkers;
		this.isAutoWhitespaceEdit = isAutoWhitespaceEdit;
		this._isTracked = _isTracked;
	}
}
exports.ValidAnnotatedEditOperation = ValidAnnotatedEditOperation;
/**
 * @internal
 */
class SearchData {
	/**
	 * The regex to search for. Always defined.
	 */
	regex;
	/**
	 * The word separator classifier.
	 */
	wordSeparators;
	/**
	 * The simple string to search for (if possible).
	 */
	simpleSearch;
	constructor(regex, wordSeparators, simpleSearch) {
		this.regex = regex;
		this.wordSeparators = wordSeparators;
		this.simpleSearch = simpleSearch;
	}
}
exports.SearchData = SearchData;
/**
 * @internal
 */
class ApplyEditsResult {
	reverseEdits;
	changes;
	trimAutoWhitespaceLineNumbers;
	constructor(reverseEdits, changes, trimAutoWhitespaceLineNumbers) {
		this.reverseEdits = reverseEdits;
		this.changes = changes;
		this.trimAutoWhitespaceLineNumbers = trimAutoWhitespaceLineNumbers;
	}
}
exports.ApplyEditsResult = ApplyEditsResult;
/**
 * @internal
 */
function shouldSynchronizeModel(model) {
	return (!model.isTooLargeForSyncing() && !model.isForSimpleWidget);
}
