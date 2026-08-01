"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.UndoRedoSource = exports.UndoRedoGroup = exports.ResourceEditStackSnapshot = exports.IUndoRedoService = void 0;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
exports.IUndoRedoService = (0, instantiation_1.createDecorator)('undoRedoService');
class ResourceEditStackSnapshot {
	resource;
	elements;
	constructor(resource, elements) {
		this.resource = resource;
		this.elements = elements;
	}
}
exports.ResourceEditStackSnapshot = ResourceEditStackSnapshot;
class UndoRedoGroup {
	static _ID = 0;
	id;
	order;
	constructor() {
		this.id = UndoRedoGroup._ID++;
		this.order = 1;
	}
	nextOrder() {
		if (this.id === 0) {
			return 0;
		}
		return this.order++;
	}
	static None = new UndoRedoGroup();
}
exports.UndoRedoGroup = UndoRedoGroup;
class UndoRedoSource {
	static _ID = 0;
	id;
	order;
	constructor() {
		this.id = UndoRedoSource._ID++;
		this.order = 1;
	}
	nextOrder() {
		if (this.id === 0) {
			return 0;
		}
		return this.order++;
	}
	static None = new UndoRedoSource();
}
exports.UndoRedoSource = UndoRedoSource;
