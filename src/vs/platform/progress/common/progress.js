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
exports.IEditorProgressService = exports.LongRunningOperation = exports.UnmanagedProgress = exports.Progress = exports.emptyProgressRunner = exports.IProgressService = void 0;
const async_1 = require("vs/base/common/async");
const cancellation_1 = require("vs/base/common/cancellation");
const lifecycle_1 = require("vs/base/common/lifecycle");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
exports.IProgressService = (0, instantiation_1.createDecorator)('progressService');
exports.emptyProgressRunner = Object.freeze({
	total() { },
	worked() { },
	done() { }
});
class Progress {
	callback;
	static None = Object.freeze({ report() { } });
	report;
	_value;
	get value() { return this._value; }
	_lastTask;
	constructor(callback, opts) {
		this.callback = callback;
		this.report = opts?.async
			? this._reportAsync.bind(this)
			: this._reportSync.bind(this);
	}
	_reportSync(item) {
		this._value = item;
		this.callback(this._value);
	}
	_reportAsync(item) {
		Promise.resolve(this._lastTask).finally(() => {
			this._value = item;
			const r = this.callback(this._value);
			this._lastTask = Promise.resolve(r).finally(() => this._lastTask = undefined);
		});
	}
}
exports.Progress = Progress;
/**
 * RAII-style progress instance that allows imperative reporting and hides
 * once `dispose()` is called.
 */
let UnmanagedProgress = class UnmanagedProgress extends lifecycle_1.Disposable {
	deferred = new async_1.DeferredPromise();
	reporter;
	lastStep;
	constructor(options, progressService) {
		super();
		progressService.withProgress(options, reporter => {
			this.reporter = reporter;
			if (this.lastStep) {
				reporter.report(this.lastStep);
			}
			return this.deferred.p;
		});
		this._register((0, lifecycle_1.toDisposable)(() => this.deferred.complete()));
	}
	report(step) {
		if (this.reporter) {
			this.reporter.report(step);
		}
		else {
			this.lastStep = step;
		}
	}
};
exports.UnmanagedProgress = UnmanagedProgress;
exports.UnmanagedProgress = UnmanagedProgress = __decorate([
	__param(1, exports.IProgressService)
], UnmanagedProgress);
class LongRunningOperation extends lifecycle_1.Disposable {
	progressIndicator;
	currentOperationId = 0;
	currentOperationDisposables = this._register(new lifecycle_1.DisposableStore());
	currentProgressRunner;
	currentProgressTimeout;
	constructor(progressIndicator) {
		super();
		this.progressIndicator = progressIndicator;
	}
	start(progressDelay) {
		// Stop any previous operation
		this.stop();
		// Start new
		const newOperationId = ++this.currentOperationId;
		const newOperationToken = new cancellation_1.CancellationTokenSource();
		this.currentProgressTimeout = setTimeout(() => {
			if (newOperationId === this.currentOperationId) {
				this.currentProgressRunner = this.progressIndicator.show(true);
			}
		}, progressDelay);
		this.currentOperationDisposables.add((0, lifecycle_1.toDisposable)(() => clearTimeout(this.currentProgressTimeout)));
		this.currentOperationDisposables.add((0, lifecycle_1.toDisposable)(() => newOperationToken.cancel()));
		this.currentOperationDisposables.add((0, lifecycle_1.toDisposable)(() => this.currentProgressRunner ? this.currentProgressRunner.done() : undefined));
		return {
			id: newOperationId,
			token: newOperationToken.token,
			stop: () => this.doStop(newOperationId),
			isCurrent: () => this.currentOperationId === newOperationId
		};
	}
	stop() {
		this.doStop(this.currentOperationId);
	}
	doStop(operationId) {
		if (this.currentOperationId === operationId) {
			this.currentOperationDisposables.clear();
		}
	}
}
exports.LongRunningOperation = LongRunningOperation;
exports.IEditorProgressService = (0, instantiation_1.createDecorator)('editorProgressService');
