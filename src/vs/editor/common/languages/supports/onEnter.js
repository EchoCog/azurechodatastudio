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
exports.OnEnterSupport = void 0;
const errors_1 = require("vs/base/common/errors");
const strings = __importStar(require("vs/base/common/strings"));
const languageConfiguration_1 = require("vs/editor/common/languages/languageConfiguration");
class OnEnterSupport {
	_brackets;
	_regExpRules;
	constructor(opts) {
		opts = opts || {};
		opts.brackets = opts.brackets || [
			['(', ')'],
			['{', '}'],
			['[', ']']
		];
		this._brackets = [];
		opts.brackets.forEach((bracket) => {
			const openRegExp = OnEnterSupport._createOpenBracketRegExp(bracket[0]);
			const closeRegExp = OnEnterSupport._createCloseBracketRegExp(bracket[1]);
			if (openRegExp && closeRegExp) {
				this._brackets.push({
					open: bracket[0],
					openRegExp: openRegExp,
					close: bracket[1],
					closeRegExp: closeRegExp,
				});
			}
		});
		this._regExpRules = opts.onEnterRules || [];
	}
	onEnter(autoIndent, previousLineText, beforeEnterText, afterEnterText) {
		// (1): `regExpRules`
		if (autoIndent >= 3 /* EditorAutoIndentStrategy.Advanced */) {
			for (let i = 0, len = this._regExpRules.length; i < len; i++) {
				const rule = this._regExpRules[i];
				const regResult = [{
						reg: rule.beforeText,
						text: beforeEnterText
					}, {
						reg: rule.afterText,
						text: afterEnterText
					}, {
						reg: rule.previousLineText,
						text: previousLineText
					}].every((obj) => {
					if (!obj.reg) {
						return true;
					}
					obj.reg.lastIndex = 0; // To disable the effect of the "g" flag.
					return obj.reg.test(obj.text);
				});
				if (regResult) {
					return rule.action;
				}
			}
		}
		// (2): Special indent-outdent
		if (autoIndent >= 2 /* EditorAutoIndentStrategy.Brackets */) {
			if (beforeEnterText.length > 0 && afterEnterText.length > 0) {
				for (let i = 0, len = this._brackets.length; i < len; i++) {
					const bracket = this._brackets[i];
					if (bracket.openRegExp.test(beforeEnterText) && bracket.closeRegExp.test(afterEnterText)) {
						return { indentAction: languageConfiguration_1.IndentAction.IndentOutdent };
					}
				}
			}
		}
		// (4): Open bracket based logic
		if (autoIndent >= 2 /* EditorAutoIndentStrategy.Brackets */) {
			if (beforeEnterText.length > 0) {
				for (let i = 0, len = this._brackets.length; i < len; i++) {
					const bracket = this._brackets[i];
					if (bracket.openRegExp.test(beforeEnterText)) {
						return { indentAction: languageConfiguration_1.IndentAction.Indent };
					}
				}
			}
		}
		return null;
	}
	static _createOpenBracketRegExp(bracket) {
		let str = strings.escapeRegExpCharacters(bracket);
		if (!/\B/.test(str.charAt(0))) {
			str = '\\b' + str;
		}
		str += '\\s*$';
		return OnEnterSupport._safeRegExp(str);
	}
	static _createCloseBracketRegExp(bracket) {
		let str = strings.escapeRegExpCharacters(bracket);
		if (!/\B/.test(str.charAt(str.length - 1))) {
			str = str + '\\b';
		}
		str = '^\\s*' + str;
		return OnEnterSupport._safeRegExp(str);
	}
	static _safeRegExp(def) {
		try {
			return new RegExp(def);
		}
		catch (err) {
			(0, errors_1.onUnexpectedError)(err);
			return null;
		}
	}
}
exports.OnEnterSupport = OnEnterSupport;
