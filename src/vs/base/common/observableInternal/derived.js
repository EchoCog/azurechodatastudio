"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Derived = void 0;
exports.derived = derived;
exports.derivedOpts = derivedOpts;
exports.derivedHandleChanges = derivedHandleChanges;
exports.derivedWithStore = derivedWithStore;
const errors_1 = require("vs/base/common/errors");
const lifecycle_1 = require("vs/base/common/lifecycle");
const base_1 = require("vs/base/common/observableInternal/base");
const logging_1 = require("vs/base/common/observableInternal/logging");
const defaultEqualityComparer = (a, b) => a === b;
function derived(computeFn, debugName) {
    return new Derived(debugName, computeFn, undefined, undefined, undefined, defaultEqualityComparer);
}
function derivedOpts(options, computeFn) {
    return new Derived(options.debugName, computeFn, undefined, undefined, undefined, options.equalityComparer ?? defaultEqualityComparer);
}
function derivedHandleChanges(debugName, options, computeFn) {
    return new Derived(debugName, computeFn, options.createEmptyChangeSummary, options.handleChange, undefined, defaultEqualityComparer);
}
function derivedWithStore(name, computeFn) {
    const store = new lifecycle_1.DisposableStore();
    return new Derived(name, r => {
        store.clear();
        return computeFn(r, store);
    }, undefined, undefined, () => store.dispose(), defaultEqualityComparer);
}
(0, base_1._setDerived)(derived);
class Derived extends base_1.BaseObservable {
    _debugName;
    _computeFn;
    createChangeSummary;
    _handleChange;
    _handleLastObserverRemoved;
    _equalityComparator;
    state = 0 /* DerivedState.initial */;
    value = undefined;
    updateCount = 0;
    dependencies = new Set();
    dependenciesToBeRemoved = new Set();
    changeSummary = undefined;
    get debugName() {
        if (!this._debugName) {
            return (0, base_1.getFunctionName)(this._computeFn) || '(anonymous)';
        }
        return typeof this._debugName === 'function' ? this._debugName() : this._debugName;
    }
    constructor(_debugName, _computeFn, createChangeSummary, _handleChange, _handleLastObserverRemoved = undefined, _equalityComparator) {
        super();
        this._debugName = _debugName;
        this._computeFn = _computeFn;
        this.createChangeSummary = createChangeSummary;
        this._handleChange = _handleChange;
        this._handleLastObserverRemoved = _handleLastObserverRemoved;
        this._equalityComparator = _equalityComparator;
        this.changeSummary = this.createChangeSummary?.();
        (0, logging_1.getLogger)()?.handleDerivedCreated(this);
    }
    onLastObserverRemoved() {
        /**
         * We are not tracking changes anymore, thus we have to assume
         * that our cache is invalid.
         */
        this.state = 0 /* DerivedState.initial */;
        this.value = undefined;
        for (const d of this.dependencies) {
            d.removeObserver(this);
        }
        this.dependencies.clear();
        this._handleLastObserverRemoved?.();
    }
    get() {
        if (this.observers.size === 0) {
            // Without observers, we don't know when to clean up stuff.
            // Thus, we don't cache anything to prevent memory leaks.
            const result = this._computeFn(this, this.createChangeSummary?.());
            // Clear new dependencies
            this.onLastObserverRemoved();
            return result;
        }
        else {
            do {
                // We might not get a notification for a dependency that changed while it is updating,
                // thus we also have to ask all our depedencies if they changed in this case.
                if (this.state === 1 /* DerivedState.dependenciesMightHaveChanged */) {
                    for (const d of this.dependencies) {
                        /** might call {@link handleChange} indirectly, which could make us stale */
                        d.reportChanges();
                        if (this.state === 2 /* DerivedState.stale */) {
                            // The other dependencies will refresh on demand, so early break
                            break;
                        }
                    }
                }
                // We called report changes of all dependencies.
                // If we are still not stale, we can assume to be up to date again.
                if (this.state === 1 /* DerivedState.dependenciesMightHaveChanged */) {
                    this.state = 3 /* DerivedState.upToDate */;
                }
                this._recomputeIfNeeded();
                // In case recomputation changed one of our dependencies, we need to recompute again.
            } while (this.state !== 3 /* DerivedState.upToDate */);
            return this.value;
        }
    }
    _recomputeIfNeeded() {
        if (this.state === 3 /* DerivedState.upToDate */) {
            return;
        }
        const emptySet = this.dependenciesToBeRemoved;
        this.dependenciesToBeRemoved = this.dependencies;
        this.dependencies = emptySet;
        const hadValue = this.state !== 0 /* DerivedState.initial */;
        const oldValue = this.value;
        this.state = 3 /* DerivedState.upToDate */;
        const changeSummary = this.changeSummary;
        this.changeSummary = this.createChangeSummary?.();
        try {
            /** might call {@link handleChange} indirectly, which could invalidate us */
            this.value = this._computeFn(this, changeSummary);
        }
        finally {
            // We don't want our observed observables to think that they are (not even temporarily) not being observed.
            // Thus, we only unsubscribe from observables that are definitely not read anymore.
            for (const o of this.dependenciesToBeRemoved) {
                o.removeObserver(this);
            }
            this.dependenciesToBeRemoved.clear();
        }
        const didChange = hadValue && !(this._equalityComparator(oldValue, this.value));
        (0, logging_1.getLogger)()?.handleDerivedRecomputed(this, {
            oldValue,
            newValue: this.value,
            change: undefined,
            didChange,
            hadValue,
        });
        if (didChange) {
            for (const r of this.observers) {
                r.handleChange(this, undefined);
            }
        }
    }
    toString() {
        return `LazyDerived<${this.debugName}>`;
    }
    // IObserver Implementation
    beginUpdate(_observable) {
        this.updateCount++;
        const propagateBeginUpdate = this.updateCount === 1;
        if (this.state === 3 /* DerivedState.upToDate */) {
            this.state = 1 /* DerivedState.dependenciesMightHaveChanged */;
            // If we propagate begin update, that will already signal a possible change.
            if (!propagateBeginUpdate) {
                for (const r of this.observers) {
                    r.handlePossibleChange(this);
                }
            }
        }
        if (propagateBeginUpdate) {
            for (const r of this.observers) {
                r.beginUpdate(this); // This signals a possible change
            }
        }
    }
    endUpdate(_observable) {
        this.updateCount--;
        if (this.updateCount === 0) {
            // End update could change the observer list.
            const observers = [...this.observers];
            for (const r of observers) {
                r.endUpdate(this);
            }
        }
        if (this.updateCount < 0) {
            throw new errors_1.BugIndicatingError();
        }
    }
    handlePossibleChange(observable) {
        // In all other states, observers already know that we might have changed.
        if (this.state === 3 /* DerivedState.upToDate */ && this.dependencies.has(observable) && !this.dependenciesToBeRemoved.has(observable)) {
            this.state = 1 /* DerivedState.dependenciesMightHaveChanged */;
            for (const r of this.observers) {
                r.handlePossibleChange(this);
            }
        }
    }
    handleChange(observable, change) {
        if (this.dependencies.has(observable) && !this.dependenciesToBeRemoved.has(observable)) {
            const shouldReact = this._handleChange ? this._handleChange({
                changedObservable: observable,
                change,
                didChange: o => o === observable,
            }, this.changeSummary) : true;
            const wasUpToDate = this.state === 3 /* DerivedState.upToDate */;
            if (shouldReact && (this.state === 1 /* DerivedState.dependenciesMightHaveChanged */ || wasUpToDate)) {
                this.state = 2 /* DerivedState.stale */;
                if (wasUpToDate) {
                    for (const r of this.observers) {
                        r.handlePossibleChange(this);
                    }
                }
            }
        }
    }
    // IReader Implementation
    readObservable(observable) {
        // Subscribe before getting the value to enable caching
        observable.addObserver(this);
        /** This might call {@link handleChange} indirectly, which could invalidate us */
        const value = observable.get();
        // Which is why we only add the observable to the dependencies now.
        this.dependencies.add(observable);
        this.dependenciesToBeRemoved.delete(observable);
        return value;
    }
    addObserver(observer) {
        const shouldCallBeginUpdate = !this.observers.has(observer) && this.updateCount > 0;
        super.addObserver(observer);
        if (shouldCallBeginUpdate) {
            observer.beginUpdate(this);
        }
    }
    removeObserver(observer) {
        const shouldCallEndUpdate = this.observers.has(observer) && this.updateCount > 0;
        super.removeObserver(observer);
        if (shouldCallEndUpdate) {
            // Calling end update after removing the observer makes sure endUpdate cannot be called twice here.
            observer.endUpdate(this);
        }
    }
}
exports.Derived = Derived;
