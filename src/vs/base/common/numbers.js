"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlidingWindowAverage = exports.MovingAverage = exports.Counter = void 0;
exports.clamp = clamp;
exports.rot = rot;
function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}
function rot(index, modulo) {
	return (modulo + (index % modulo)) % modulo;
}
class Counter {
	_next = 0;
	getNext() {
		return this._next++;
	}
}
exports.Counter = Counter;
class MovingAverage {
	_n = 1;
	_val = 0;
	update(value) {
		this._val = this._val + (value - this._val) / this._n;
		this._n += 1;
		return this._val;
	}
	get value() {
		return this._val;
	}
}
exports.MovingAverage = MovingAverage;
class SlidingWindowAverage {
	_n = 0;
	_val = 0;
	_values = [];
	_index = 0;
	_sum = 0;
	constructor(size) {
		this._values = new Array(size);
		this._values.fill(0, 0, size);
	}
	update(value) {
		const oldValue = this._values[this._index];
		this._values[this._index] = value;
		this._index = (this._index + 1) % this._values.length;
		this._sum -= oldValue;
		this._sum += value;
		if (this._n < this._values.length) {
			this._n += 1;
		}
		this._val = this._sum / this._n;
		return this._val;
	}
	get value() {
		return this._val;
	}
}
exports.SlidingWindowAverage = SlidingWindowAverage;
