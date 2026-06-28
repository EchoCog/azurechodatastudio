"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutorunObserver = void 0;
exports.autorunOpts = autorunOpts;
exports.autorun = autorun;
exports.autorunHandleChanges = autorunHandleChanges;
exports.autorunWithStoreHandleChanges = autorunWithStoreHandleChanges;
exports.autorunWithStore = autorunWithStore;
exports.autorunDelta = autorunDelta;
const assert_1 = require("vs/base/common/assert");
const lifecycle_1 = require("vs/base/common/lifecycle");
const base_1 = require("vs/base/common/observableInternal/base");
const logging_1 = require("vs/base/common/observableInternal/logging");
function autorunOpts(options, fn) {
    return new AutorunObserver(options.debugName, fn, undefined, undefined);
}
function autorun(fn) {
    return new AutorunObserver(undefined, fn, undefined, undefined);
}
function autorunHandleChanges(options, fn) {
    return new AutorunObserver(options.debugName, fn, options.createEmptyChangeSummary, options.handleChange);
}
function autorunWithStoreHandleChanges(options, fn) {
    const store = new lifecycle_1.DisposableStore();
    const disposable = autorunHandleChanges({
        debugName: options.debugName ?? (() => (0, base_1.getFunctionName)(fn)),
        createEmptyChangeSummary: options.createEmptyChangeSummary,
        handleChange: options.handleChange,
    }, (reader, changeSummary) => {
        store.clear();
        fn(reader, changeSummary, store);
    });
    return (0, lifecycle_1.toDisposable)(() => {
        disposable.dispose();
        store.dispose();
    });
}
function autorunWithStore(fn) {
    const store = new lifecycle_1.DisposableStore();
    const disposable = autorunOpts({
        debugName: () => (0, base_1.getFunctionName)(fn) || '(anonymous)',
    }, reader => {
        store.clear();
        fn(reader, store);
    });
    return (0, lifecycle_1.toDisposable)(() => {
        disposable.dispose();
        store.dispose();
    });
}
class AutorunObserver {
    _debugName;
    _runFn;
    createChangeSummary;
    _handleChange;
    state = 2 /* AutorunState.stale */;
    updateCount = 0;
    disposed = false;
    dependencies = new Set();
    dependenciesToBeRemoved = new Set();
    changeSummary;
    get debugName() {
        if (typeof this._debugName === 'string') {
            return this._debugName;
        }
        if (typeof this._debugName === 'function') {
            const name = this._debugName();
            if (name !== undefined) {
                return name;
            }
        }
        const name = (0, base_1.getFunctionName)(this._runFn);
        if (name !== undefined) {
            return name;
        }
        return '(anonymous)';
    }
    constructor(_debugName, _runFn, createChangeSummary, _handleChange) {
        this._debugName = _debugName;
        this._runFn = _runFn;
        this.createChangeSummary = createChangeSummary;
        this._handleChange = _handleChange;
        this.changeSummary = this.createChangeSummary?.();
        (0, logging_1.getLogger)()?.handleAutorunCreated(this);
        this._runIfNeeded();
    }
    dispose() {
        this.disposed = true;
        for (const o of this.dependencies) {
            o.removeObserver(this);
        }
        this.dependencies.clear();
    }
    _runIfNeeded() {
        if (this.state === 3 /* AutorunState.upToDate */) {
            return;
        }
        const emptySet = this.dependenciesToBeRemoved;
        this.dependenciesToBeRemoved = this.dependencies;
        this.dependencies = emptySet;
        this.state = 3 /* AutorunState.upToDate */;
        try {
            if (!this.disposed) {
                (0, logging_1.getLogger)()?.handleAutorunTriggered(this);
                const changeSummary = this.changeSummary;
                this.changeSummary = this.createChangeSummary?.();
                this._runFn(this, changeSummary);
            }
        }
        finally {
            (0, logging_1.getLogger)()?.handleAutorunFinished(this);
            // We don't want our observed observables to think that they are (not even temporarily) not being observed.
            // Thus, we only unsubscribe from observables that are definitely not read anymore.
            for (const o of this.dependenciesToBeRemoved) {
                o.removeObserver(this);
            }
            this.dependenciesToBeRemoved.clear();
        }
    }
    toString() {
        return `Autorun<${this.debugName}>`;
    }
    // IObserver implementation
    beginUpdate() {
        if (this.state === 3 /* AutorunState.upToDate */) {
            this.state = 1 /* AutorunState.dependenciesMightHaveChanged */;
        }
        this.updateCount++;
    }
    endUpdate() {
        if (this.updateCount === 1) {
            do {
                if (this.state === 1 /* AutorunState.dependenciesMightHaveChanged */) {
                    this.state = 3 /* AutorunState.upToDate */;
                    for (const d of this.dependencies) {
                        d.reportChanges();
                        if (this.state === 2 /* AutorunState.stale */) {
                            // The other dependencies will refresh on demand
                            break;
                        }
                    }
                }
                this._runIfNeeded();
            } while (this.state !== 3 /* AutorunState.upToDate */);
        }
        this.updateCount--;
        (0, assert_1.assertFn)(() => this.updateCount >= 0);
    }
    handlePossibleChange(observable) {
        if (this.state === 3 /* AutorunState.upToDate */ && this.dependencies.has(observable) && !this.dependenciesToBeRemoved.has(observable)) {
            this.state = 1 /* AutorunState.dependenciesMightHaveChanged */;
        }
    }
    handleChange(observable, change) {
        if (this.dependencies.has(observable) && !this.dependenciesToBeRemoved.has(observable)) {
            const shouldReact = this._handleChange ? this._handleChange({
                changedObservable: observable,
                change,
                didChange: o => o === observable,
            }, this.changeSummary) : true;
            if (shouldReact) {
                this.state = 2 /* AutorunState.stale */;
            }
        }
    }
    // IReader implementation
    readObservable(observable) {
        // In case the run action disposes the autorun
        if (this.disposed) {
            return observable.get();
        }
        observable.addObserver(this);
        const value = observable.get();
        this.dependencies.add(observable);
        this.dependenciesToBeRemoved.delete(observable);
        return value;
    }
}
exports.AutorunObserver = AutorunObserver;
(function (autorun) {
    autorun.Observer = AutorunObserver;
})(autorun || (exports.autorun = autorun = {}));
function autorunDelta(observable, handler) {
    let _lastValue;
    return autorunOpts({ debugName: () => (0, base_1.getFunctionName)(handler) }, (reader) => {
        const newValue = observable.read(reader);
        const lastValue = _lastValue;
        _lastValue = newValue;
        handler({ lastValue, newValue });
    });
}
