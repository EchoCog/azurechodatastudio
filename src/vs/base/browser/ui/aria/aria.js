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
exports.setARIAContainer = setARIAContainer;
exports.alert = alert;
exports.status = status;
const dom = __importStar(require("vs/base/browser/dom"));
require("vs/css!./aria");
// Use a max length since we are inserting the whole msg in the DOM and that can cause browsers to freeze for long messages #94233
const MAX_MESSAGE_LENGTH = 20000;
let ariaContainer;
let alertContainer;
let alertContainer2;
let statusContainer;
let statusContainer2;
function setARIAContainer(parent) {
	ariaContainer = document.createElement('div');
	ariaContainer.className = 'monaco-aria-container';
	const createAlertContainer = () => {
		const element = document.createElement('div');
		element.className = 'monaco-alert';
		element.setAttribute('role', 'alert');
		element.setAttribute('aria-atomic', 'true');
		ariaContainer.appendChild(element);
		return element;
	};
	alertContainer = createAlertContainer();
	alertContainer2 = createAlertContainer();
	const createStatusContainer = () => {
		const element = document.createElement('div');
		element.className = 'monaco-status';
		element.setAttribute('aria-live', 'polite');
		element.setAttribute('aria-atomic', 'true');
		ariaContainer.appendChild(element);
		return element;
	};
	statusContainer = createStatusContainer();
	statusContainer2 = createStatusContainer();
	parent.appendChild(ariaContainer);
}
/**
	* Given the provided message, will make sure that it is read as alert to screen readers.
	*/
function alert(msg) {
	if (!ariaContainer) {
		return;
	}
	// Use alternate containers such that duplicated messages get read out by screen readers #99466
	if (alertContainer.textContent !== msg) {
		dom.clearNode(alertContainer2);
		insertMessage(alertContainer, msg);
	}
	else {
		dom.clearNode(alertContainer);
		insertMessage(alertContainer2, msg);
	}
}
/**
	* Given the provided message, will make sure that it is read as status to screen readers.
	*/
function status(msg) {
	if (!ariaContainer) {
		return;
	}
	if (statusContainer.textContent !== msg) {
		dom.clearNode(statusContainer2);
		insertMessage(statusContainer, msg);
	}
	else {
		dom.clearNode(statusContainer);
		insertMessage(statusContainer2, msg);
	}
}
function insertMessage(target, msg) {
	dom.clearNode(target);
	if (msg.length > MAX_MESSAGE_LENGTH) {
		msg = msg.substr(0, MAX_MESSAGE_LENGTH);
	}
	target.textContent = msg;
	// See https://www.paciellogroup.com/blog/2012/06/html5-accessibility-chops-aria-rolealert-browser-support/
	target.style.visibility = 'hidden';
	target.style.visibility = 'visible';
}
