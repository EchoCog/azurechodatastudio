"use strict";
/*---------------------------------------------------------------------------------------------
	*  Copyright (c) Microsoft Corporation. All rights reserved.
	*  Licensed under the MIT License. See License.txt in the project root for license information.
	*--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	var desc = Object.getOwnPropertyDescriptor(m, k);
	if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
		desc = { enumerable: true, get: function() { return m[k]; } };
	}
	Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
	Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
	o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
	var ownKeys = function(o) {
		ownKeys = Object.getOwnPropertyNames || function (o) {
			var ar = [];
			for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
			return ar;
		};
		return ownKeys(o);
	};
	return function (mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
		__setModuleDefault(result, mod);
		return result;
	};
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalPointerMoveMonitor = void 0;
const dom = __importStar(require("vs/base/browser/dom"));
const lifecycle_1 = require("vs/base/common/lifecycle");
class GlobalPointerMoveMonitor {
	_hooks = new lifecycle_1.DisposableStore();
	_pointerMoveCallback = null;
	_onStopCallback = null;
	dispose() {
		this.stopMonitoring(false);
		this._hooks.dispose();
	}
	stopMonitoring(invokeStopCallback, browserEvent) {
		if (!this.isMonitoring()) {
			// Not monitoring
			return;
		}
		// Unhook
		this._hooks.clear();
		this._pointerMoveCallback = null;
		const onStopCallback = this._onStopCallback;
		this._onStopCallback = null;
		if (invokeStopCallback && onStopCallback) {
			onStopCallback(browserEvent);
		}
	}
	isMonitoring() {
		return !!this._pointerMoveCallback;
	}
	startMonitoring(initialElement, pointerId, initialButtons, pointerMoveCallback, onStopCallback) {
		if (this.isMonitoring()) {
			this.stopMonitoring(false);
		}
		this._pointerMoveCallback = pointerMoveCallback;
		this._onStopCallback = onStopCallback;
		let eventSource = initialElement;
		try {
			initialElement.setPointerCapture(pointerId);
			this._hooks.add((0, lifecycle_1.toDisposable)(() => {
				try {
					initialElement.releasePointerCapture(pointerId);
				}
				catch (err) {
					// See https://github.com/microsoft/vscode/issues/161731
					//
					// `releasePointerCapture` sometimes fails when being invoked with the exception:
					//     DOMException: Failed to execute 'releasePointerCapture' on 'Element':
					//     No active pointer with the given id is found.
					//
					// There's no need to do anything in case of failure
				}
			}));
		}
		catch (err) {
			// See https://github.com/microsoft/vscode/issues/144584
			// See https://github.com/microsoft/vscode/issues/146947
			// `setPointerCapture` sometimes fails when being invoked
			// from a `mousedown` listener on macOS and Windows
			// and it always fails on Linux with the exception:
			//     DOMException: Failed to execute 'setPointerCapture' on 'Element':
			//     No active pointer with the given id is found.
			// In case of failure, we bind the listeners on the window
			eventSource = window;
		}
		this._hooks.add(dom.addDisposableListener(eventSource, dom.EventType.POINTER_MOVE, (e) => {
			if (e.buttons !== initialButtons) {
				// Buttons state has changed in the meantime
				this.stopMonitoring(true);
				return;
			}
			e.preventDefault();
			this._pointerMoveCallback(e);
		}));
		this._hooks.add(dom.addDisposableListener(eventSource, dom.EventType.POINTER_UP, (e) => this.stopMonitoring(true)));
	}
}
exports.GlobalPointerMoveMonitor = GlobalPointerMoveMonitor;
