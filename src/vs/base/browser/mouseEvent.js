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
exports.StandardWheelEvent = exports.DragMouseEvent = exports.StandardMouseEvent = void 0;
const browser = __importStar(require("vs/base/browser/browser"));
const iframe_1 = require("vs/base/browser/iframe");
const platform = __importStar(require("vs/base/common/platform"));
class StandardMouseEvent {
	browserEvent;
	leftButton;
	middleButton;
	rightButton;
	buttons;
	target;
	detail;
	posx;
	posy;
	ctrlKey;
	shiftKey;
	altKey;
	metaKey;
	timestamp;
	constructor(e) {
		this.timestamp = Date.now();
		this.browserEvent = e;
		this.leftButton = e.button === 0;
		this.middleButton = e.button === 1;
		this.rightButton = e.button === 2;
		this.buttons = e.buttons;
		this.target = e.target;
		this.detail = e.detail || 1;
		if (e.type === 'dblclick') {
			this.detail = 2;
		}
		this.ctrlKey = e.ctrlKey;
		this.shiftKey = e.shiftKey;
		this.altKey = e.altKey;
		this.metaKey = e.metaKey;
		if (typeof e.pageX === 'number') {
			this.posx = e.pageX;
			this.posy = e.pageY;
		}
		else {
			// Probably hit by MSGestureEvent
			this.posx = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft;
			this.posy = e.clientY + document.body.scrollTop + document.documentElement.scrollTop;
		}
		// Find the position of the iframe this code is executing in relative to the iframe where the event was captured.
		const iframeOffsets = iframe_1.IframeUtils.getPositionOfChildWindowRelativeToAncestorWindow(window, e.view);
		this.posx -= iframeOffsets.left;
		this.posy -= iframeOffsets.top;
	}
	preventDefault() {
		this.browserEvent.preventDefault();
	}
	stopPropagation() {
		this.browserEvent.stopPropagation();
	}
}
exports.StandardMouseEvent = StandardMouseEvent;
class DragMouseEvent extends StandardMouseEvent {
	dataTransfer;
	constructor(e) {
		super(e);
		this.dataTransfer = e.dataTransfer;
	}
}
exports.DragMouseEvent = DragMouseEvent;
class StandardWheelEvent {
	browserEvent;
	deltaY;
	deltaX;
	target;
	constructor(e, deltaX = 0, deltaY = 0) {
		this.browserEvent = e || null;
		this.target = e ? (e.target || e.targetNode || e.srcElement) : null;
		this.deltaY = deltaY;
		this.deltaX = deltaX;
		if (e) {
			// Old (deprecated) wheel events
			const e1 = e;
			const e2 = e;
			// vertical delta scroll
			if (typeof e1.wheelDeltaY !== 'undefined') {
				this.deltaY = e1.wheelDeltaY / 120;
			}
			else if (typeof e2.VERTICAL_AXIS !== 'undefined' && e2.axis === e2.VERTICAL_AXIS) {
				this.deltaY = -e2.detail / 3;
			}
			else if (e.type === 'wheel') {
				// Modern wheel event
				// https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent
				const ev = e;
				if (ev.deltaMode === ev.DOM_DELTA_LINE) {
					// the deltas are expressed in lines
					if (browser.isFirefox && !platform.isMacintosh) {
						this.deltaY = -e.deltaY / 3;
					}
					else {
						this.deltaY = -e.deltaY;
					}
				}
				else {
					this.deltaY = -e.deltaY / 40;
				}
			}
			// horizontal delta scroll
			if (typeof e1.wheelDeltaX !== 'undefined') {
				if (browser.isSafari && platform.isWindows) {
					this.deltaX = -(e1.wheelDeltaX / 120);
				}
				else {
					this.deltaX = e1.wheelDeltaX / 120;
				}
			}
			else if (typeof e2.HORIZONTAL_AXIS !== 'undefined' && e2.axis === e2.HORIZONTAL_AXIS) {
				this.deltaX = -e.detail / 3;
			}
			else if (e.type === 'wheel') {
				// Modern wheel event
				// https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent
				const ev = e;
				if (ev.deltaMode === ev.DOM_DELTA_LINE) {
					// the deltas are expressed in lines
					if (browser.isFirefox && !platform.isMacintosh) {
						this.deltaX = -e.deltaX / 3;
					}
					else {
						this.deltaX = -e.deltaX;
					}
				}
				else {
					this.deltaX = -e.deltaX / 40;
				}
			}
			// Assume a vertical scroll if nothing else worked
			if (this.deltaY === 0 && this.deltaX === 0 && e.wheelDelta) {
				this.deltaY = e.wheelDelta / 120;
			}
		}
	}
	preventDefault() {
		this.browserEvent?.preventDefault();
	}
	stopPropagation() {
		this.browserEvent?.stopPropagation();
	}
}
exports.StandardWheelEvent = StandardWheelEvent;
