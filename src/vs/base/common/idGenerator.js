"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultGenerator = exports.IdGenerator = void 0;
class IdGenerator {
	_prefix;
	_lastId;
	constructor(prefix) {
		this._prefix = prefix;
		this._lastId = 0;
	}
	nextId() {
		/**
		 * {{SQL CARBON EDIT}}
		 * Adding suffix at the end of id to avoid the id getting picked up by faulty
		 * string matching logic that only checks for id prefixes to find the match.
		 */
		return this._prefix + (++this._lastId) + '-id';
	}
}
exports.IdGenerator = IdGenerator;
exports.defaultGenerator = new IdGenerator('id#');
