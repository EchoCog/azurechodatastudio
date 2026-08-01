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
exports.HoverAction = exports.HoverWidget = void 0;
exports.getHoverAccessibleViewHint = getHoverAccessibleViewHint;
const dom = __importStar(require("vs/base/browser/dom"));
const keyboardEvent_1 = require("vs/base/browser/keyboardEvent");
const scrollableElement_1 = require("vs/base/browser/ui/scrollbar/scrollableElement");
const lifecycle_1 = require("vs/base/common/lifecycle");
require("vs/css!./hover");
const nls_1 = require("vs/nls");
const $ = dom.$;
class HoverWidget extends lifecycle_1.Disposable {
	containerDomNode;
	contentsDomNode;
	scrollbar;
	constructor() {
		super();
		this.containerDomNode = document.createElement('div');
		this.containerDomNode.className = 'monaco-hover';
		this.containerDomNode.tabIndex = 0;
		this.containerDomNode.setAttribute('role', 'tooltip');
		this.contentsDomNode = document.createElement('div');
		this.contentsDomNode.className = 'monaco-hover-content';
		this.scrollbar = this._register(new scrollableElement_1.DomScrollableElement(this.contentsDomNode, {
			consumeMouseWheelIfScrollbarIsNeeded: true
		}));
		this.containerDomNode.appendChild(this.scrollbar.getDomNode());
	}
	onContentsChanged() {
		this.scrollbar.scanDomNode();
	}
}
exports.HoverWidget = HoverWidget;
class HoverAction extends lifecycle_1.Disposable {
	static render(parent, actionOptions, keybindingLabel) {
		return new HoverAction(parent, actionOptions, keybindingLabel);
	}
	actionContainer;
	action;
	constructor(parent, actionOptions, keybindingLabel) {
		super();
		this.actionContainer = dom.append(parent, $('div.action-container'));
		this.actionContainer.setAttribute('tabindex', '0');
		this.action = dom.append(this.actionContainer, $('a.action'));
		this.action.setAttribute('role', 'button');
		if (actionOptions.iconClass) {
			dom.append(this.action, $(`span.icon.${actionOptions.iconClass}`));
		}
		const label = dom.append(this.action, $('span'));
		label.textContent = keybindingLabel ? `${actionOptions.label} (${keybindingLabel})` : actionOptions.label;
		this._register(dom.addDisposableListener(this.actionContainer, dom.EventType.CLICK, e => {
			e.stopPropagation();
			e.preventDefault();
			actionOptions.run(this.actionContainer);
		}));
		this._register(dom.addDisposableListener(this.actionContainer, dom.EventType.KEY_DOWN, e => {
			const event = new keyboardEvent_1.StandardKeyboardEvent(e);
			if (event.equals(3 /* KeyCode.Enter */) || event.equals(10 /* KeyCode.Space */)) {
				e.stopPropagation();
				e.preventDefault();
				actionOptions.run(this.actionContainer);
			}
		}));
		this.setEnabled(true);
	}
	setEnabled(enabled) {
		if (enabled) {
			this.actionContainer.classList.remove('disabled');
			this.actionContainer.removeAttribute('aria-disabled');
		}
		else {
			this.actionContainer.classList.add('disabled');
			this.actionContainer.setAttribute('aria-disabled', 'true');
		}
	}
}
exports.HoverAction = HoverAction;
function getHoverAccessibleViewHint(shouldHaveHint, keybinding) {
	return shouldHaveHint && keybinding ? (0, nls_1.localize)('acessibleViewHint', "Inspect this in the accessible view with {0}.", keybinding) : shouldHaveHint ? (0, nls_1.localize)('acessibleViewHintNoKbOpen', "Inspect this in the accessible view via the command Open Accessible View which is currently not triggerable via keybinding.") : '';
}
