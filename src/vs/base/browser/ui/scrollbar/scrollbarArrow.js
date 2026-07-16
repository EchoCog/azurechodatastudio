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
exports.ScrollbarArrow = exports.ARROW_IMG_SIZE = void 0;
const globalPointerMoveMonitor_1 = require("vs/base/browser/globalPointerMoveMonitor");
const widget_1 = require("vs/base/browser/ui/widget");
const async_1 = require("vs/base/common/async");
const themables_1 = require("vs/base/common/themables");
const dom = __importStar(require("vs/base/browser/dom"));
/**
	* The arrow image size.
	*/
exports.ARROW_IMG_SIZE = 11;
class ScrollbarArrow extends widget_1.Widget {
	_onActivate;
	bgDomNode;
	domNode;
	_pointerdownRepeatTimer;
	_pointerdownScheduleRepeatTimer;
	_pointerMoveMonitor;
	constructor(opts) {
		super();
		this._onActivate = opts.onActivate;
		this.bgDomNode = document.createElement('div');
		this.bgDomNode.className = 'arrow-background';
		this.bgDomNode.style.position = 'absolute';
		this.bgDomNode.style.width = opts.bgWidth + 'px';
		this.bgDomNode.style.height = opts.bgHeight + 'px';
		if (typeof opts.top !== 'undefined') {
			this.bgDomNode.style.top = '0px';
		}
		if (typeof opts.left !== 'undefined') {
			this.bgDomNode.style.left = '0px';
		}
		if (typeof opts.bottom !== 'undefined') {
			this.bgDomNode.style.bottom = '0px';
		}
		if (typeof opts.right !== 'undefined') {
			this.bgDomNode.style.right = '0px';
		}
		this.domNode = document.createElement('div');
		this.domNode.className = opts.className;
		this.domNode.classList.add(...themables_1.ThemeIcon.asClassNameArray(opts.icon));
		this.domNode.style.position = 'absolute';
		this.domNode.style.width = exports.ARROW_IMG_SIZE + 'px';
		this.domNode.style.height = exports.ARROW_IMG_SIZE + 'px';
		if (typeof opts.top !== 'undefined') {
			this.domNode.style.top = opts.top + 'px';
		}
		if (typeof opts.left !== 'undefined') {
			this.domNode.style.left = opts.left + 'px';
		}
		if (typeof opts.bottom !== 'undefined') {
			this.domNode.style.bottom = opts.bottom + 'px';
		}
		if (typeof opts.right !== 'undefined') {
			this.domNode.style.right = opts.right + 'px';
		}
		this._pointerMoveMonitor = this._register(new globalPointerMoveMonitor_1.GlobalPointerMoveMonitor());
		this._register(dom.addStandardDisposableListener(this.bgDomNode, dom.EventType.POINTER_DOWN, (e) => this._arrowPointerDown(e)));
		this._register(dom.addStandardDisposableListener(this.domNode, dom.EventType.POINTER_DOWN, (e) => this._arrowPointerDown(e)));
		this._pointerdownRepeatTimer = this._register(new async_1.IntervalTimer());
		this._pointerdownScheduleRepeatTimer = this._register(new async_1.TimeoutTimer());
	}
	_arrowPointerDown(e) {
		if (!e.target || !(e.target instanceof Element)) {
			return;
		}
		const scheduleRepeater = () => {
			this._pointerdownRepeatTimer.cancelAndSet(() => this._onActivate(), 1000 / 24);
		};
		this._onActivate();
		this._pointerdownRepeatTimer.cancel();
		this._pointerdownScheduleRepeatTimer.cancelAndSet(scheduleRepeater, 200);
		this._pointerMoveMonitor.startMonitoring(e.target, e.pointerId, e.buttons, (pointerMoveData) => { }, () => {
			this._pointerdownRepeatTimer.cancel();
			this._pointerdownScheduleRepeatTimer.cancel();
		});
		e.preventDefault();
	}
}
exports.ScrollbarArrow = ScrollbarArrow;
