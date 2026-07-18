"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachedFunction = exports.LRUCachedFunction = exports.Cache = void 0;
const cancellation_1 = require("vs/base/common/cancellation");
class Cache {
	task;
	result = null;
	constructor(task) {
		this.task = task;
	}
	get() {
		if (this.result) {
			return this.result;
		}
		const cts = new cancellation_1.CancellationTokenSource();
		const promise = this.task(cts.token);
		this.result = {
			promise,
			dispose: () => {
				this.result = null;
				cts.cancel();
				cts.dispose();
			}
		};
		return this.result;
	}
}
exports.Cache = Cache;
/**
 * Uses a LRU cache to make a given parametrized function cached.
 * Caches just the last value.
 * The key must be JSON serializable.
*/
class LRUCachedFunction {
	fn;
	lastCache = undefined;
	lastArgKey = undefined;
	constructor(fn) {
		this.fn = fn;
	}
	get(arg) {
		const key = JSON.stringify(arg);
		if (this.lastArgKey !== key) {
			this.lastArgKey = key;
			this.lastCache = this.fn(arg);
		}
		return this.lastCache;
	}
}
exports.LRUCachedFunction = LRUCachedFunction;
/**
 * Uses an unbounded cache (referential equality) to memoize the results of the given function.
*/
class CachedFunction {
	fn;
	_map = new Map();
	get cachedValues() {
		return this._map;
	}
	constructor(fn) {
		this.fn = fn;
	}
	get(arg) {
		if (this._map.has(arg)) {
			return this._map.get(arg);
		}
		const value = this.fn(arg);
		this._map.set(arg, value);
		return value;
	}
}
exports.CachedFunction = CachedFunction;
