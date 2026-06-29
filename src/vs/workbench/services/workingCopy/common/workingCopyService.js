"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkingCopyService = exports.IWorkingCopyService = void 0;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const extensions_1 = require("vs/platform/instantiation/common/extensions");
const event_1 = require("vs/base/common/event");
const uri_1 = require("vs/base/common/uri");
const lifecycle_1 = require("vs/base/common/lifecycle");
const map_1 = require("vs/base/common/map");
const network_1 = require("vs/base/common/network"); // {{SQL CARBON EDIT}} @chlafreniere need to block working copies of notebook editors from being tracked
const constants_1 = require("sql/workbench/common/constants");
exports.IWorkingCopyService = (0, instantiation_1.createDecorator)('workingCopyService');
class WorkingCopyService extends lifecycle_1.Disposable {
    //#region Events
    _onDidRegister = this._register(new event_1.Emitter());
    onDidRegister = this._onDidRegister.event;
    _onDidUnregister = this._register(new event_1.Emitter());
    onDidUnregister = this._onDidUnregister.event;
    _onDidChangeDirty = this._register(new event_1.Emitter());
    onDidChangeDirty = this._onDidChangeDirty.event;
    _onDidChangeContent = this._register(new event_1.Emitter());
    onDidChangeContent = this._onDidChangeContent.event;
    _onDidSave = this._register(new event_1.Emitter());
    onDidSave = this._onDidSave.event;
    //#endregion
    //#region Registry
    get workingCopies() { return Array.from(this._workingCopies.values()); }
    _workingCopies = new Set();
    mapResourceToWorkingCopies = new map_1.ResourceMap();
    registerWorkingCopy(workingCopy) {
        let workingCopiesForResource = this.mapResourceToWorkingCopies.get(workingCopy.resource);
        if (workingCopiesForResource?.has(workingCopy.typeId)) {
            throw new Error(`Cannot register more than one working copy with the same resource ${workingCopy.resource.toString()} and type ${workingCopy.typeId}.`);
        }
        // {{SQL CARBON EDIT}} @chlafreniere need to block working copies of notebook editors from being tracked
        if (workingCopy.resource.path.includes(constants_1.CELL_URI_PATH_PREFIX) && workingCopy.resource.scheme === network_1.Schemas.untitled) {
            return new lifecycle_1.DisposableStore();
        }
        // Registry (all)
        this._workingCopies.add(workingCopy);
        // Registry (type based)
        if (!workingCopiesForResource) {
            workingCopiesForResource = new Map();
            this.mapResourceToWorkingCopies.set(workingCopy.resource, workingCopiesForResource);
        }
        workingCopiesForResource.set(workingCopy.typeId, workingCopy);
        // Wire in Events
        const disposables = new lifecycle_1.DisposableStore();
        disposables.add(workingCopy.onDidChangeContent(() => this._onDidChangeContent.fire(workingCopy)));
        disposables.add(workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire(workingCopy)));
        disposables.add(workingCopy.onDidSave(e => this._onDidSave.fire({ workingCopy, ...e })));
        // Send some initial events
        this._onDidRegister.fire(workingCopy);
        if (workingCopy.isDirty()) {
            this._onDidChangeDirty.fire(workingCopy);
        }
        return (0, lifecycle_1.toDisposable)(() => {
            this.unregisterWorkingCopy(workingCopy);
            (0, lifecycle_1.dispose)(disposables);
            // Signal as event
            this._onDidUnregister.fire(workingCopy);
        });
    }
    unregisterWorkingCopy(workingCopy) {
        // Registry (all)
        this._workingCopies.delete(workingCopy);
        // Registry (type based)
        const workingCopiesForResource = this.mapResourceToWorkingCopies.get(workingCopy.resource);
        if (workingCopiesForResource?.delete(workingCopy.typeId) && workingCopiesForResource.size === 0) {
            this.mapResourceToWorkingCopies.delete(workingCopy.resource);
        }
        // If copy is dirty, ensure to fire an event to signal the dirty change
        // (a disposed working copy cannot account for being dirty in our model)
        if (workingCopy.isDirty()) {
            this._onDidChangeDirty.fire(workingCopy);
        }
    }
    has(resourceOrIdentifier) {
        if (uri_1.URI.isUri(resourceOrIdentifier)) {
            return this.mapResourceToWorkingCopies.has(resourceOrIdentifier);
        }
        return this.mapResourceToWorkingCopies.get(resourceOrIdentifier.resource)?.has(resourceOrIdentifier.typeId) ?? false;
    }
    get(identifier) {
        return this.mapResourceToWorkingCopies.get(identifier.resource)?.get(identifier.typeId);
    }
    getAll(resource) {
        const workingCopies = this.mapResourceToWorkingCopies.get(resource);
        if (!workingCopies) {
            return undefined;
        }
        return Array.from(workingCopies.values());
    }
    //#endregion
    //#region Dirty Tracking
    get hasDirty() {
        for (const workingCopy of this._workingCopies) {
            if (workingCopy.isDirty()) {
                return true;
            }
        }
        return false;
    }
    get dirtyCount() {
        let totalDirtyCount = 0;
        for (const workingCopy of this._workingCopies) {
            if (workingCopy.isDirty()) {
                totalDirtyCount++;
            }
        }
        return totalDirtyCount;
    }
    get dirtyWorkingCopies() {
        return this.workingCopies.filter(workingCopy => workingCopy.isDirty());
    }
    get modifiedCount() {
        let totalModifiedCount = 0;
        for (const workingCopy of this._workingCopies) {
            if (workingCopy.isModified()) {
                totalModifiedCount++;
            }
        }
        return totalModifiedCount;
    }
    get modifiedWorkingCopies() {
        return this.workingCopies.filter(workingCopy => workingCopy.isModified());
    }
    isDirty(resource, typeId) {
        const workingCopies = this.mapResourceToWorkingCopies.get(resource);
        if (workingCopies) {
            // For a specific type
            if (typeof typeId === 'string') {
                return workingCopies.get(typeId)?.isDirty() ?? false;
            }
            // Across all working copies
            else {
                for (const [, workingCopy] of workingCopies) {
                    if (workingCopy.isDirty()) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
exports.WorkingCopyService = WorkingCopyService;
(0, extensions_1.registerSingleton)(exports.IWorkingCopyService, WorkingCopyService, 1 /* InstantiationType.Delayed */);
