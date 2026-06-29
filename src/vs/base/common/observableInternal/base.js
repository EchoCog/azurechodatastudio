"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisposableObservableValue = exports.ObservableValue = exports.TransactionImpl = exports.BaseObservable = exports.ConvenientObservable = void 0;
exports._setDerived = _setDerived;
exports.transaction = transaction;
exports.subtransaction = subtransaction;
exports.getFunctionName = getFunctionName;
exports.observableValue = observableValue;
exports.disposableObservableValue = disposableObservableValue;
const logging_1 = require("vs/base/common/observableInternal/logging");
let _derived;
/**
 * @internal
 * This is to allow splitting files.
*/
function _setDerived(derived) {
    _derived = derived;
}
class ConvenientObservable {
    get TChange() { return null; }
    reportChanges() {
        this.get();
    }
    /** @sealed */
    read(reader) {
        if (reader) {
            return reader.readObservable(this);
        }
        else {
            return this.get();
        }
    }
    /** @sealed */
    map(fn) {
        return _derived((reader) => fn(this.read(reader), reader), () => {
            const name = getFunctionName(fn);
            if (name !== undefined) {
                return name;
            }
            // regexp to match `x => x.y` where x and y can be arbitrary identifiers (uses backref):
            const regexp = /^\s*\(?\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*\)?\s*=>\s*\1\.([a-zA-Z_$][a-zA-Z_$0-9]*)\s*$/;
            const match = regexp.exec(fn.toString());
            if (match) {
                return `${this.debugName}.${match[2]}`;
            }
            return `${this.debugName} (mapped)`;
        });
    }
}
exports.ConvenientObservable = ConvenientObservable;
class BaseObservable extends ConvenientObservable {
    observers = new Set();
    addObserver(observer) {
        const len = this.observers.size;
        this.observers.add(observer);
        if (len === 0) {
            this.onFirstObserverAdded();
        }
    }
    removeObserver(observer) {
        const deleted = this.observers.delete(observer);
        if (deleted && this.observers.size === 0) {
            this.onLastObserverRemoved();
        }
    }
    onFirstObserverAdded() { }
    onLastObserverRemoved() { }
}
exports.BaseObservable = BaseObservable;
function transaction(fn, getDebugName) {
    const tx = new TransactionImpl(fn, getDebugName);
    try {
        fn(tx);
    }
    finally {
        tx.finish();
    }
}
function subtransaction(tx, fn, getDebugName) {
    if (!tx) {
        transaction(fn, getDebugName);
    }
    else {
        fn(tx);
    }
}
class TransactionImpl {
    _fn;
    _getDebugName;
    updatingObservers = [];
    constructor(_fn, _getDebugName) {
        this._fn = _fn;
        this._getDebugName = _getDebugName;
        (0, logging_1.getLogger)()?.handleBeginTransaction(this);
    }
    getDebugName() {
        if (this._getDebugName) {
            return this._getDebugName();
        }
        return getFunctionName(this._fn);
    }
    updateObserver(observer, observable) {
        this.updatingObservers.push({ observer, observable });
        observer.beginUpdate(observable);
    }
    finish() {
        const updatingObservers = this.updatingObservers;
        // Prevent anyone from updating observers from now on.
        this.updatingObservers = null;
        for (const { observer, observable } of updatingObservers) {
            observer.endUpdate(observable);
        }
        (0, logging_1.getLogger)()?.handleEndTransaction();
    }
}
exports.TransactionImpl = TransactionImpl;
function getFunctionName(fn) {
    const fnSrc = fn.toString();
    // Pattern: /** @description ... */
    const regexp = /\/\*\*\s*@description\s*([^*]*)\*\//;
    const match = regexp.exec(fnSrc);
    const result = match ? match[1] : undefined;
    return result?.trim();
}
/**
 * Creates an observable value.
 * Observers get informed when the value changes.
 */
function observableValue(name, initialValue) {
    return new ObservableValue(name, initialValue);
}
class ObservableValue extends BaseObservable {
    debugName;
    _value;
    constructor(debugName, initialValue) {
        super();
        this.debugName = debugName;
        this._value = initialValue;
    }
    get() {
        return this._value;
    }
    set(value, tx, change) {
        if (this._value === value) {
            return;
        }
        let _tx;
        if (!tx) {
            tx = _tx = new TransactionImpl(() => { }, () => `Setting ${this.debugName}`);
        }
        try {
            const oldValue = this._value;
            this._setValue(value);
            (0, logging_1.getLogger)()?.handleObservableChanged(this, { oldValue, newValue: value, change, didChange: true, hadValue: true });
            for (const observer of this.observers) {
                tx.updateObserver(observer, this);
                observer.handleChange(this, change);
            }
        }
        finally {
            if (_tx) {
                _tx.finish();
            }
        }
    }
    toString() {
        return `${this.debugName}: ${this._value}`;
    }
    _setValue(newValue) {
        this._value = newValue;
    }
}
exports.ObservableValue = ObservableValue;
function disposableObservableValue(name, initialValue) {
    return new DisposableObservableValue(name, initialValue);
}
class DisposableObservableValue extends ObservableValue {
    _setValue(newValue) {
        if (this._value === newValue) {
            return;
        }
        if (this._value) {
            this._value.dispose();
        }
        this._value = newValue;
    }
    dispose() {
        this._value?.dispose();
    }
}
exports.DisposableObservableValue = DisposableObservableValue;
