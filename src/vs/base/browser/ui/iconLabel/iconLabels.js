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
exports.renderLabelWithIcons = renderLabelWithIcons;
exports.renderIcon = renderIcon;
const dom = __importStar(require("vs/base/browser/dom"));
const themables_1 = require("vs/base/common/themables");
const labelWithIconsRegex = new RegExp(`(\\\\)?\\$\\((${themables_1.ThemeIcon.iconNameExpression}(?:${themables_1.ThemeIcon.iconModifierExpression})?)\\)`, 'g');
function renderLabelWithIcons(text) {
	const elements = new Array();
	let match;
	let textStart = 0, textStop = 0;
	while ((match = labelWithIconsRegex.exec(text)) !== null) {
		textStop = match.index || 0;
		if (textStart < textStop) {
			elements.push(text.substring(textStart, textStop));
		}
		textStart = (match.index || 0) + match[0].length;
		const [, escaped, codicon] = match;
		elements.push(escaped ? `$(${codicon})` : renderIcon({ id: codicon }));
	}
	if (textStart < text.length) {
		elements.push(text.substring(textStart));
	}
	return elements;
}
function renderIcon(icon) {
	const node = dom.$(`span`);
	node.classList.add(...themables_1.ThemeIcon.asClassNameArray(icon));
	return node;
}
