"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditorZoom = void 0;
const event_1 = require("vs/base/common/event");
exports.EditorZoom = new class {
	_zoomLevel = 0;
	_onDidChangeZoomLevel = new event_1.Emitter();
	onDidChangeZoomLevel = this._onDidChangeZoomLevel.event;
	getZoomLevel() {
		return this._zoomLevel;
	}
	setZoomLevel(zoomLevel) {
		zoomLevel = Math.min(Math.max(-5, zoomLevel), 20);
		if (this._zoomLevel === zoomLevel) {
			return;
		}
		this._zoomLevel = zoomLevel;
		this._onDidChangeZoomLevel.fire(this._zoomLevel);
	}
};
