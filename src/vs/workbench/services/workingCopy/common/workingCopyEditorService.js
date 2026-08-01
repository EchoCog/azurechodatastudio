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
exports.WorkingCopyEditorService = exports.IWorkingCopyEditorService = void 0;
const event_1 = require("vs/base/common/event");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const extensions_1 = require("vs/platform/instantiation/common/extensions");
const lifecycle_1 = require("vs/base/common/lifecycle");
const editorService_1 = require("vs/workbench/services/editor/common/editorService");
exports.IWorkingCopyEditorService = (0, instantiation_1.createDecorator)('workingCopyEditorService');
let WorkingCopyEditorService = class WorkingCopyEditorService extends lifecycle_1.Disposable {
	editorService;
	_onDidRegisterHandler = this._register(new event_1.Emitter());
	onDidRegisterHandler = this._onDidRegisterHandler.event;
	handlers = new Set();
	constructor(editorService) {
		super();
		this.editorService = editorService;
	}
	registerHandler(handler) {
		// Add to registry and emit as event
		this.handlers.add(handler);
		this._onDidRegisterHandler.fire(handler);
		return (0, lifecycle_1.toDisposable)(() => this.handlers.delete(handler));
	}
	findEditor(workingCopy) {
		for (const editorIdentifier of this.editorService.getEditors(0 /* EditorsOrder.MOST_RECENTLY_ACTIVE */)) {
			if (this.isOpen(workingCopy, editorIdentifier.editor)) {
				return editorIdentifier;
			}
		}
		return undefined;
	}
	isOpen(workingCopy, editor) {
		for (const handler of this.handlers) {
			if (handler.isOpen(workingCopy, editor)) {
				return true;
			}
		}
		return false;
	}
};
exports.WorkingCopyEditorService = WorkingCopyEditorService;
exports.WorkingCopyEditorService = WorkingCopyEditorService = __decorate([
	__param(0, editorService_1.IEditorService)
], WorkingCopyEditorService);
// Register Service
(0, extensions_1.registerSingleton)(exports.IWorkingCopyEditorService, WorkingCopyEditorService, 1 /* InstantiationType.Delayed */);
