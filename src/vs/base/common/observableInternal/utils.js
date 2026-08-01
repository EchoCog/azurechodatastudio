"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromEventObservable = void 0;
exports.constObservable = constObservable;
exports.observableFromPromise = observableFromPromise;
exports.waitForState = waitForState;
exports.observableFromEvent = observableFromEvent;
exports.observableSignalFromEvent = observableSignalFromEvent;
exports.observableSignal = observableSignal;
exports.debouncedObservable = debouncedObservable;
exports.wasEventTriggeredRecently = wasEventTriggeredRecently;
exports.keepAlive = keepAlive;
exports.derivedObservableWithCache = derivedObservableWithCache;
exports.derivedObservableWithWritableCache = derivedObservableWithWritableCache;
const lifecycle_1 = require("vs/base/common/lifecycle");
const autorun_1 = require("vs/base/common/observableInternal/autorun");
const base_1 = require("vs/base/common/observableInternal/base");
const derived_1 = require("vs/base/common/observableInternal/derived");
const logging_1 = require("vs/base/common/observableInternal/logging");
/**
 * Represents an efficient observable whose value never changes.
 */
function constObservable(value) {
	return new ConstObservable(value);
}
class ConstObservable extends base_1.ConvenientObservable {
	value;
	constructor(value) {
		super();
		this.value = value;
	}
	get debugName() {
		return this.toString();
	}
	get() {
		return this.value;
	}
	addObserver(observer) {
		// NO OP
	}
	removeObserver(observer) {
		// NO OP
	}
	toString() {
		return `Const: ${this.value}`;
	}
}
function observableFromPromise(promise) {
	const observable = (0, base_1.observableValue)('promiseValue', {});
	promise.then((value) => {
		observable.set({ value }, undefined);
	});
	return observable;
}
function waitForState(observable, predicate) {
	return new Promise(resolve => {
		let didRun = false;
		let shouldDispose = false;
		const d = (0, autorun_1.autorun)(reader => {
			/** @description waitForState */
			const currentState = observable.read(reader);
			if (predicate(currentState)) {
				if (!didRun) {
					shouldDispose = true;
				}
				else {
					d.dispose();
				}
				resolve(currentState);
			}
		});
		didRun = true;
		if (shouldDispose) {
			d.dispose();
		}
	});
}
function observableFromEvent(event, getValue) {
	return new FromEventObservable(event, getValue);
}
class FromEventObservable extends base_1.BaseObservable {
	event;
	_getValue;
	value;
	hasValue = false;
	subscription;
	constructor(event, _getValue) {
		super();
		this.event = event;
		this._getValue = _getValue;
	}
	getDebugName() {
		return (0, base_1.getFunctionName)(this._getValue);
	}
	get debugName() {
		const name = this.getDebugName();
		return 'From Event' + (name ? `: ${name}` : '');
	}
	onFirstObserverAdded() {
		this.subscription = this.event(this.handleEvent);
	}
	handleEvent = (args) => {
		const newValue = this._getValue(args);
		const didChange = !this.hasValue || this.value !== newValue;
		(0, logging_1.getLogger)()?.handleFromEventObservableTriggered(this, { oldValue: this.value, newValue, change: undefined, didChange, hadValue: this.hasValue });
		if (didChange) {
			this.value = newValue;
			if (this.hasValue) {
				(0, base_1.transaction)((tx) => {
					for (const o of this.observers) {
						tx.updateObserver(o, this);
						o.handleChange(this, undefined);
					}
				}, () => {
					const name = this.getDebugName();
					return 'Event fired' + (name ? `: ${name}` : '');
				});
			}
			this.hasValue = true;
		}
	};
	onLastObserverRemoved() {
		this.subscription.dispose();
		this.subscription = undefined;
		this.hasValue = false;
		this.value = undefined;
	}
	get() {
		if (this.subscription) {
			if (!this.hasValue) {
				this.handleEvent(undefined);
			}
			return this.value;
		}
		else {
			// no cache, as there are no subscribers to keep it updated
			return this._getValue(undefined);
		}
	}
}
exports.FromEventObservable = FromEventObservable;
(function (observableFromEvent) {
	observableFromEvent.Observer = FromEventObservable;
})(observableFromEvent || (exports.observableFromEvent = observableFromEvent = {}));
function observableSignalFromEvent(debugName, event) {
	return new FromEventObservableSignal(debugName, event);
}
class FromEventObservableSignal extends base_1.BaseObservable {
	debugName;
	event;
	subscription;
	constructor(debugName, event) {
		super();
		this.debugName = debugName;
		this.event = event;
	}
	onFirstObserverAdded() {
		this.subscription = this.event(this.handleEvent);
	}
	handleEvent = () => {
		(0, base_1.transaction)((tx) => {
			for (const o of this.observers) {
				tx.updateObserver(o, this);
				o.handleChange(this, undefined);
			}
		}, () => this.debugName);
	};
	onLastObserverRemoved() {
		this.subscription.dispose();
		this.subscription = undefined;
	}
	get() {
		// NO OP
	}
}
/**
 * Creates a signal that can be triggered to invalidate observers.
 * Signals don't have a value - when they are triggered they indicate a change.
 * However, signals can carry a delta that is passed to observers.
 */
function observableSignal(debugName) {
	return new ObservableSignal(debugName);
}
class ObservableSignal extends base_1.BaseObservable {
	debugName;
	constructor(debugName) {
		super();
		this.debugName = debugName;
	}
	trigger(tx, change) {
		if (!tx) {
			(0, base_1.transaction)(tx => {
				this.trigger(tx, change);
			}, () => `Trigger signal ${this.debugName}`);
			return;
		}
		for (const o of this.observers) {
			tx.updateObserver(o, this);
			o.handleChange(this, change);
		}
	}
	get() {
		// NO OP
	}
}
function debouncedObservable(observable, debounceMs, disposableStore) {
	const debouncedObservable = (0, base_1.observableValue)('debounced', undefined);
	let timeout = undefined;
	disposableStore.add((0, autorun_1.autorun)(reader => {
		/** @description debounce */
		const value = observable.read(reader);
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			(0, base_1.transaction)(tx => {
				debouncedObservable.set(value, tx);
			});
		}, debounceMs);
	}));
	return debouncedObservable;
}
function wasEventTriggeredRecently(event, timeoutMs, disposableStore) {
	const observable = (0, base_1.observableValue)('triggeredRecently', false);
	let timeout = undefined;
	disposableStore.add(event(() => {
		observable.set(true, undefined);
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			observable.set(false, undefined);
		}, timeoutMs);
	}));
	return observable;
}
// TODO@hediet: Have `keepCacheAlive` and `recomputeOnChange` instead of forceRecompute
/**
 * This ensures the observable is being observed.
 * Observed observables (such as {@link derived}s) can maintain a cache, as they receive invalidation events.
 * Unobserved observables are forced to recompute their value from scratch every time they are read.
 *
 * @param observable the observable to keep alive
 * @param forceRecompute if true, the observable will be eagerly recomputed after it changed.
 * Use this if recomputing the observables causes side-effects.
*/
function keepAlive(observable, forceRecompute) {
	const o = new KeepAliveObserver(forceRecompute ?? false);
	observable.addObserver(o);
	if (forceRecompute) {
		observable.reportChanges();
	}
	return (0, lifecycle_1.toDisposable)(() => {
		observable.removeObserver(o);
	});
}
class KeepAliveObserver {
	forceRecompute;
	counter = 0;
	constructor(forceRecompute) {
		this.forceRecompute = forceRecompute;
	}
	beginUpdate(observable) {
		this.counter++;
	}
	endUpdate(observable) {
		this.counter--;
		if (this.counter === 0 && this.forceRecompute) {
			observable.reportChanges();
		}
	}
	handlePossibleChange(observable) {
		// NO OP
	}
	handleChange(observable, change) {
		// NO OP
	}
}
function derivedObservableWithCache(name, computeFn) {
	let lastValue = undefined;
	const observable = (0, derived_1.derived)(reader => {
		lastValue = computeFn(reader, lastValue);
		return lastValue;
	}, name);
	return observable;
}
function derivedObservableWithWritableCache(name, computeFn) {
	let lastValue = undefined;
	const counter = (0, base_1.observableValue)('derivedObservableWithWritableCache.counter', 0);
	const observable = (0, derived_1.derived)(reader => {
		counter.read(reader);
		lastValue = computeFn(reader, lastValue);
		return lastValue;
	}, name);
	return Object.assign(observable, {
		clearCache: (transaction) => {
			lastValue = undefined;
			counter.set(counter.get() + 1, transaction);
		},
	});
}
