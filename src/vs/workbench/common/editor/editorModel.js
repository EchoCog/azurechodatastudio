"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditorModel = void 0;
const event_1 = require("vs/base/common/event");
const lifecycle_1 = require("vs/base/common/lifecycle");
/**
 * The editor model is the heavyweight counterpart of editor input. Depending on the editor input, it
 * resolves from a file system retrieve content and may allow for saving it back or reverting it.
 * Editor models are typically cached for some while because they are expensive to construct.
 */
class EditorModel extends lifecycle_1.Disposable {
    _onWillDispose = this._register(new event_1.Emitter());
    onWillDispose = this._onWillDispose.event;
    disposed = false;
    resolved = false;
    /**
     * Causes this model to resolve returning a promise when loading is completed.
     */
    async resolve() {
        this.resolved = true;
    }
    /**
     * Returns whether this model was loaded or not.
     */
    isResolved() {
        return this.resolved;
    }
    /**
     * Find out if this model has been disposed.
     */
    isDisposed() {
        return this.disposed;
    }
    /**
     * Subclasses should implement to free resources that have been claimed through loading.
     */
    dispose() {
        this.disposed = true;
        this._onWillDispose.fire();
        super.dispose();
    }
}
exports.EditorModel = EditorModel;
