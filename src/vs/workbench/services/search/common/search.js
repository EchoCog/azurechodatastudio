"use strict";
/*---------------------------------------------------------------------------------------------
	*  Copyright (c) Microsoft Corporation. All rights reserved.
	*  Licensed under the MIT License. See License.txt in the project root for license information.
	*--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	var desc = Object.getOwnPropertyDescriptor(m, k);
	if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
		desc = { enumerable: true, get: function() { return m[k]; } };
	}
	Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
	Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
	o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
	var ownKeys = function(o) {
		ownKeys = Object.getOwnPropertyNames || function (o) {
			var ar = [];
			for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
			return ar;
		};
		return ownKeys(o);
	};
	return function (mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
		__setModuleDefault(result, mod);
		return result;
	};
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryGlobTester = exports.SerializableFileMatch = exports.SearchError = exports.SearchErrorCode = exports.OneLineRange = exports.SearchRange = exports.TextSearchMatch = exports.FileMatch = exports.ISearchService = exports.SEARCH_EXCLUDE_CONFIG = exports.VIEW_ID = exports.PANEL_ID = exports.VIEWLET_ID = exports.TextSearchCompleteMessageType = void 0;
exports.resultIsMatch = resultIsMatch;
exports.isFileMatch = isFileMatch;
exports.isProgressMessage = isProgressMessage;
exports.getExcludes = getExcludes;
exports.pathIncludedInQuery = pathIncludedInQuery;
exports.deserializeSearchError = deserializeSearchError;
exports.serializeSearchError = serializeSearchError;
exports.isSerializedSearchComplete = isSerializedSearchComplete;
exports.isSerializedSearchSuccess = isSerializedSearchSuccess;
exports.isSerializedFileMatch = isSerializedFileMatch;
exports.isFilePatternMatch = isFilePatternMatch;
exports.resolvePatternsForProvider = resolvePatternsForProvider;
exports.hasSiblingPromiseFn = hasSiblingPromiseFn;
exports.hasSiblingFn = hasSiblingFn;
const arrays_1 = require("vs/base/common/arrays");
const glob = __importStar(require("vs/base/common/glob"));
const objects = __importStar(require("vs/base/common/objects"));
const extpath = __importStar(require("vs/base/common/extpath"));
const strings_1 = require("vs/base/common/strings");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const paths = __importStar(require("vs/base/common/path"));
const errors_1 = require("vs/base/common/errors");
const searchExtTypes_1 = require("vs/workbench/services/search/common/searchExtTypes");
Object.defineProperty(exports, "TextSearchCompleteMessageType", { enumerable: true, get: function () { return searchExtTypes_1.TextSearchCompleteMessageType; } });
const async_1 = require("vs/base/common/async");
exports.VIEWLET_ID = 'workbench.view.search';
exports.PANEL_ID = 'workbench.panel.search';
exports.VIEW_ID = 'workbench.view.search';
exports.SEARCH_EXCLUDE_CONFIG = 'search.exclude';
// Warning: this pattern is used in the search editor to detect offsets. If you
// change this, also change the search-result built-in extension
const SEARCH_ELIDED_PREFIX = '⟪ ';
const SEARCH_ELIDED_SUFFIX = ' characters skipped ⟫';
const SEARCH_ELIDED_MIN_LEN = (SEARCH_ELIDED_PREFIX.length + SEARCH_ELIDED_SUFFIX.length + 5) * 2;
exports.ISearchService = (0, instantiation_1.createDecorator)('searchService');
function resultIsMatch(result) {
	return !!result.preview;
}
function isFileMatch(p) {
	return !!p.resource;
}
function isProgressMessage(p) {
	return !!p.message;
}
class FileMatch {
	resource;
	results = [];
	constructor(resource) {
		this.resource = resource;
		// empty
	}
}
exports.FileMatch = FileMatch;
class TextSearchMatch {
	ranges;
	preview;
	webviewIndex;
	constructor(text, range, previewOptions, webviewIndex) {
		this.ranges = range;
		this.webviewIndex = webviewIndex;
		// Trim preview if this is one match and a single-line match with a preview requested.
		// Otherwise send the full text, like for replace or for showing multiple previews.
		// TODO this is fishy.
		const ranges = Array.isArray(range) ? range : [range];
		if (previewOptions && previewOptions.matchLines === 1 && isSingleLineRangeList(ranges)) {
			// 1 line preview requested
			text = (0, strings_1.getNLines)(text, previewOptions.matchLines);
			let result = '';
			let shift = 0;
			let lastEnd = 0;
			const leadingChars = Math.floor(previewOptions.charsPerLine / 5);
			const matches = [];
			for (const range of ranges) {
				const previewStart = Math.max(range.startColumn - leadingChars, 0);
				const previewEnd = range.startColumn + previewOptions.charsPerLine;
				if (previewStart > lastEnd + leadingChars + SEARCH_ELIDED_MIN_LEN) {
					const elision = SEARCH_ELIDED_PREFIX + (previewStart - lastEnd) + SEARCH_ELIDED_SUFFIX;
					result += elision + text.slice(previewStart, previewEnd);
					shift += previewStart - (lastEnd + elision.length);
				}
				else {
					result += text.slice(lastEnd, previewEnd);
				}
				matches.push(new OneLineRange(0, range.startColumn - shift, range.endColumn - shift));
				lastEnd = previewEnd;
			}
			this.preview = { text: result, matches: Array.isArray(this.ranges) ? matches : matches[0] };
		}
		else {
			const firstMatchLine = Array.isArray(range) ? range[0].startLineNumber : range.startLineNumber;
			this.preview = {
				text,
				matches: (0, arrays_1.mapArrayOrNot)(range, r => new SearchRange(r.startLineNumber - firstMatchLine, r.startColumn, r.endLineNumber - firstMatchLine, r.endColumn))
			};
		}
	}
}
exports.TextSearchMatch = TextSearchMatch;
function isSingleLineRangeList(ranges) {
	const line = ranges[0].startLineNumber;
	for (const r of ranges) {
		if (r.startLineNumber !== line || r.endLineNumber !== line) {
			return false;
		}
	}
	return true;
}
class SearchRange {
	startLineNumber;
	startColumn;
	endLineNumber;
	endColumn;
	constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
		this.startLineNumber = startLineNumber;
		this.startColumn = startColumn;
		this.endLineNumber = endLineNumber;
		this.endColumn = endColumn;
	}
}
exports.SearchRange = SearchRange;
class OneLineRange extends SearchRange {
	constructor(lineNumber, startColumn, endColumn) {
		super(lineNumber, startColumn, lineNumber, endColumn);
	}
}
exports.OneLineRange = OneLineRange;
function getExcludes(configuration, includeSearchExcludes = true) {
	const fileExcludes = configuration && configuration.files && configuration.files.exclude;
	const searchExcludes = includeSearchExcludes && configuration && configuration.search && configuration.search.exclude;
	if (!fileExcludes && !searchExcludes) {
		return undefined;
	}
	if (!fileExcludes || !searchExcludes) {
		return fileExcludes || searchExcludes;
	}
	let allExcludes = Object.create(null);
	// clone the config as it could be frozen
	allExcludes = objects.mixin(allExcludes, objects.deepClone(fileExcludes));
	allExcludes = objects.mixin(allExcludes, objects.deepClone(searchExcludes), true);
	return allExcludes;
}
function pathIncludedInQuery(queryProps, fsPath) {
	if (queryProps.excludePattern && glob.match(queryProps.excludePattern, fsPath)) {
		return false;
	}
	if (queryProps.includePattern || queryProps.usingSearchPaths) {
		if (queryProps.includePattern && glob.match(queryProps.includePattern, fsPath)) {
			return true;
		}
		// If searchPaths are being used, the extra file must be in a subfolder and match the pattern, if present
		if (queryProps.usingSearchPaths) {
			return !!queryProps.folderQueries && queryProps.folderQueries.some(fq => {
				const searchPath = fq.folder.fsPath;
				if (extpath.isEqualOrParent(fsPath, searchPath)) {
					const relPath = paths.relative(searchPath, fsPath);
					return !fq.includePattern || !!glob.match(fq.includePattern, relPath);
				}
				else {
					return false;
				}
			});
		}
		return false;
	}
	return true;
}
var SearchErrorCode;
(function (SearchErrorCode) {
	SearchErrorCode[SearchErrorCode["unknownEncoding"] = 1] = "unknownEncoding";
	SearchErrorCode[SearchErrorCode["regexParseError"] = 2] = "regexParseError";
	SearchErrorCode[SearchErrorCode["globParseError"] = 3] = "globParseError";
	SearchErrorCode[SearchErrorCode["invalidLiteral"] = 4] = "invalidLiteral";
	SearchErrorCode[SearchErrorCode["rgProcessError"] = 5] = "rgProcessError";
	SearchErrorCode[SearchErrorCode["other"] = 6] = "other";
	SearchErrorCode[SearchErrorCode["canceled"] = 7] = "canceled";
})(SearchErrorCode || (exports.SearchErrorCode = SearchErrorCode = {}));
class SearchError extends Error {
	code;
	constructor(message, code) {
		super(message);
		this.code = code;
	}
}
exports.SearchError = SearchError;
function deserializeSearchError(error) {
	const errorMsg = error.message;
	if ((0, errors_1.isCancellationError)(error)) {
		return new SearchError(errorMsg, SearchErrorCode.canceled);
	}
	try {
		const details = JSON.parse(errorMsg);
		return new SearchError(details.message, details.code);
	}
	catch (e) {
		return new SearchError(errorMsg, SearchErrorCode.other);
	}
}
function serializeSearchError(searchError) {
	const details = { message: searchError.message, code: searchError.code };
	return new Error(JSON.stringify(details));
}
function isSerializedSearchComplete(arg) {
	if (arg.type === 'error') {
		return true;
	}
	else if (arg.type === 'success') {
		return true;
	}
	else {
		return false;
	}
}
function isSerializedSearchSuccess(arg) {
	return arg.type === 'success';
}
function isSerializedFileMatch(arg) {
	return !!arg.path;
}
function isFilePatternMatch(candidate, normalizedFilePatternLowercase) {
	const pathToMatch = candidate.searchPath ? candidate.searchPath : candidate.relativePath;
	return (0, strings_1.fuzzyContains)(pathToMatch, normalizedFilePatternLowercase);
}
class SerializableFileMatch {
	path;
	results;
	constructor(path) {
		this.path = path;
		this.results = [];
	}
	addMatch(match) {
		this.results.push(match);
	}
	serialize() {
		return {
			path: this.path,
			results: this.results,
			numMatches: this.results.length
		};
	}
}
exports.SerializableFileMatch = SerializableFileMatch;
/**
	*  Computes the patterns that the provider handles. Discards sibling clauses and 'false' patterns
	*/
function resolvePatternsForProvider(globalPattern, folderPattern) {
	const merged = {
		...(globalPattern || {}),
		...(folderPattern || {})
	};
	return Object.keys(merged)
		.filter(key => {
		const value = merged[key];
		return typeof value === 'boolean' && value;
	});
}
class QueryGlobTester {
	_excludeExpression;
	_parsedExcludeExpression;
	_parsedIncludeExpression = null;
	constructor(config, folderQuery) {
		this._excludeExpression = {
			...(config.excludePattern || {}),
			...(folderQuery.excludePattern || {})
		};
		this._parsedExcludeExpression = glob.parse(this._excludeExpression);
		// Empty includeExpression means include nothing, so no {} shortcuts
		let includeExpression = config.includePattern;
		if (folderQuery.includePattern) {
			if (includeExpression) {
				includeExpression = {
					...includeExpression,
					...folderQuery.includePattern
				};
			}
			else {
				includeExpression = folderQuery.includePattern;
			}
		}
		if (includeExpression) {
			this._parsedIncludeExpression = glob.parse(includeExpression);
		}
	}
	matchesExcludesSync(testPath, basename, hasSibling) {
		if (this._parsedExcludeExpression && this._parsedExcludeExpression(testPath, basename, hasSibling)) {
			return true;
		}
		return false;
	}
	/**
		* Guaranteed sync - siblingsFn should not return a promise.
		*/
	includedInQuerySync(testPath, basename, hasSibling) {
		if (this._parsedExcludeExpression && this._parsedExcludeExpression(testPath, basename, hasSibling)) {
			return false;
		}
		if (this._parsedIncludeExpression && !this._parsedIncludeExpression(testPath, basename, hasSibling)) {
			return false;
		}
		return true;
	}
	/**
		* Evaluating the exclude expression is only async if it includes sibling clauses. As an optimization, avoid doing anything with Promises
		* unless the expression is async.
		*/
	includedInQuery(testPath, basename, hasSibling) {
		const excluded = this._parsedExcludeExpression(testPath, basename, hasSibling);
		const isIncluded = () => {
			return this._parsedIncludeExpression ?
				!!(this._parsedIncludeExpression(testPath, basename, hasSibling)) :
				true;
		};
		if ((0, async_1.isThenable)(excluded)) {
			return excluded.then(excluded => {
				if (excluded) {
					return false;
				}
				return isIncluded();
			});
		}
		return isIncluded();
	}
	hasSiblingExcludeClauses() {
		return hasSiblingClauses(this._excludeExpression);
	}
}
exports.QueryGlobTester = QueryGlobTester;
function hasSiblingClauses(pattern) {
	for (const key in pattern) {
		if (typeof pattern[key] !== 'boolean') {
			return true;
		}
	}
	return false;
}
function hasSiblingPromiseFn(siblingsFn) {
	if (!siblingsFn) {
		return undefined;
	}
	let siblings;
	return (name) => {
		if (!siblings) {
			siblings = (siblingsFn() || Promise.resolve([]))
				.then(list => list ? listToMap(list) : {});
		}
		return siblings.then(map => !!map[name]);
	};
}
function hasSiblingFn(siblingsFn) {
	if (!siblingsFn) {
		return undefined;
	}
	let siblings;
	return (name) => {
		if (!siblings) {
			const list = siblingsFn();
			siblings = list ? listToMap(list) : {};
		}
		return !!siblings[name];
	};
}
function listToMap(list) {
	const map = {};
	for (const key of list) {
		map[key] = true;
	}
	return map;
}
