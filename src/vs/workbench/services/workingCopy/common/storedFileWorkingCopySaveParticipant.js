"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoredFileWorkingCopySaveParticipant = void 0;
const nls_1 = require("vs/nls");
const async_1 = require("vs/base/common/async");
const cancellation_1 = require("vs/base/common/cancellation");
const log_1 = require("vs/platform/log/common/log");
const progress_1 = require("vs/platform/progress/common/progress");
const lifecycle_1 = require("vs/base/common/lifecycle");
const arrays_1 = require("vs/base/common/arrays");
let StoredFileWorkingCopySaveParticipant = class StoredFileWorkingCopySaveParticipant extends lifecycle_1.Disposable {
    progressService;
    logService;
    saveParticipants = [];
    get length() { return this.saveParticipants.length; }
    constructor(progressService, logService) {
        super();
        this.progressService = progressService;
        this.logService = logService;
    }
    addSaveParticipant(participant) {
        const remove = (0, arrays_1.insert)(this.saveParticipants, participant);
        return (0, lifecycle_1.toDisposable)(() => remove());
    }
    participate(workingCopy, context, token) {
        const cts = new cancellation_1.CancellationTokenSource(token);
        return this.progressService.withProgress({
            title: (0, nls_1.localize)('saveParticipants', "Saving '{0}'", workingCopy.name),
            location: 15 /* ProgressLocation.Notification */,
            cancellable: true,
            delay: workingCopy.isDirty() ? 3000 : 5000
        }, async (progress) => {
            // undoStop before participation
            workingCopy.model?.pushStackElement();
            for (const saveParticipant of this.saveParticipants) {
                if (cts.token.isCancellationRequested || workingCopy.isDisposed()) {
                    break;
                }
                try {
                    const promise = saveParticipant.participate(workingCopy, context, progress, cts.token);
                    await (0, async_1.raceCancellation)(promise, cts.token);
                }
                catch (err) {
                    this.logService.warn(err);
                }
            }
            // undoStop after participation
            workingCopy.model?.pushStackElement();
        }, () => {
            // user cancel
            cts.dispose(true);
        });
    }
    dispose() {
        this.saveParticipants.splice(0, this.saveParticipants.length);
        super.dispose();
    }
};
exports.StoredFileWorkingCopySaveParticipant = StoredFileWorkingCopySaveParticipant;
exports.StoredFileWorkingCopySaveParticipant = StoredFileWorkingCopySaveParticipant = __decorate([
    __param(0, progress_1.IProgressService),
    __param(1, log_1.ILogService)
], StoredFileWorkingCopySaveParticipant);
