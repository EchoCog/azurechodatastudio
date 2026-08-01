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
exports.StandardKeyboardEvent = void 0;
exports.printKeyboardEvent = printKeyboardEvent;
exports.printStandardKeyboardEvent = printStandardKeyboardEvent;
const browser = __importStar(require("vs/base/browser/browser"));
const keyCodes_1 = require("vs/base/common/keyCodes");
const keybindings_1 = require("vs/base/common/keybindings");
const platform = __importStar(require("vs/base/common/platform"));
function extractKeyCode(e) {
	if (e.charCode) {
		// "keypress" events mostly
		const char = String.fromCharCode(e.charCode).toUpperCase();
		return keyCodes_1.KeyCodeUtils.fromString(char);
	}
	const keyCode = e.keyCode;
	// browser quirks
	if (keyCode === 3) {
		return 7 /* KeyCode.PauseBreak */;
	}
	else if (browser.isFirefox) {
		switch (keyCode) {
			case 59: return 85 /* KeyCode.Semicolon */;
			case 60:
				if (platform.isLinux) {
					return 97 /* KeyCode.IntlBackslash */;
				}
				break;
			case 61: return 86 /* KeyCode.Equal */;
			// based on: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/keyCode#numpad_keys
			case 107: return 109 /* KeyCode.NumpadAdd */;
			case 109: return 111 /* KeyCode.NumpadSubtract */;
			case 173: return 88 /* KeyCode.Minus */;
			case 224:
				if (platform.isMacintosh) {
					return 57 /* KeyCode.Meta */;
				}
				break;
		}
	}
	else if (browser.isWebKit) {
		if (platform.isMacintosh && keyCode === 93) {
			// the two meta keys in the Mac have different key codes (91 and 93)
			return 57 /* KeyCode.Meta */;
		}
		else if (!platform.isMacintosh && keyCode === 92) {
			return 57 /* KeyCode.Meta */;
		}
	}
	// cross browser keycodes:
	return keyCodes_1.EVENT_KEY_CODE_MAP[keyCode] || 0 /* KeyCode.Unknown */;
}
const ctrlKeyMod = (platform.isMacintosh ? 256 /* KeyMod.WinCtrl */ : 2048 /* KeyMod.CtrlCmd */);
const altKeyMod = 512 /* KeyMod.Alt */;
const shiftKeyMod = 1024 /* KeyMod.Shift */;
const metaKeyMod = (platform.isMacintosh ? 2048 /* KeyMod.CtrlCmd */ : 256 /* KeyMod.WinCtrl */);
function printKeyboardEvent(e) {
	const modifiers = [];
	if (e.ctrlKey) {
		modifiers.push(`ctrl`);
	}
	if (e.shiftKey) {
		modifiers.push(`shift`);
	}
	if (e.altKey) {
		modifiers.push(`alt`);
	}
	if (e.metaKey) {
		modifiers.push(`meta`);
	}
	return `modifiers: [${modifiers.join(',')}], code: ${e.code}, keyCode: ${e.keyCode}, key: ${e.key}`;
}
function printStandardKeyboardEvent(e) {
	const modifiers = [];
	if (e.ctrlKey) {
		modifiers.push(`ctrl`);
	}
	if (e.shiftKey) {
		modifiers.push(`shift`);
	}
	if (e.altKey) {
		modifiers.push(`alt`);
	}
	if (e.metaKey) {
		modifiers.push(`meta`);
	}
	return `modifiers: [${modifiers.join(',')}], code: ${e.code}, keyCode: ${e.keyCode} ('${keyCodes_1.KeyCodeUtils.toString(e.keyCode)}')`;
}
class StandardKeyboardEvent {
	_standardKeyboardEventBrand = true;
	browserEvent;
	target;
	ctrlKey;
	shiftKey;
	altKey;
	metaKey;
	altGraphKey;
	keyCode;
	code;
	_asKeybinding;
	_asKeyCodeChord;
	constructor(source) {
		const e = source;
		this.browserEvent = e;
		this.target = e.target;
		this.ctrlKey = e.ctrlKey;
		this.shiftKey = e.shiftKey;
		this.altKey = e.altKey;
		this.metaKey = e.metaKey;
		this.altGraphKey = e.getModifierState('AltGraph');
		this.keyCode = extractKeyCode(e);
		this.code = e.code;
		// console.info(e.type + ": keyCode: " + e.keyCode + ", which: " + e.which + ", charCode: " + e.charCode + ", detail: " + e.detail + " ====> " + this.keyCode + ' -- ' + KeyCode[this.keyCode]);
		this.ctrlKey = this.ctrlKey || this.keyCode === 5 /* KeyCode.Ctrl */;
		this.altKey = this.altKey || this.keyCode === 6 /* KeyCode.Alt */;
		this.shiftKey = this.shiftKey || this.keyCode === 4 /* KeyCode.Shift */;
		this.metaKey = this.metaKey || this.keyCode === 57 /* KeyCode.Meta */;
		this._asKeybinding = this._computeKeybinding();
		this._asKeyCodeChord = this._computeKeyCodeChord();
		// console.log(`code: ${e.code}, keyCode: ${e.keyCode}, key: ${e.key}`);
	}
	preventDefault() {
		if (this.browserEvent && this.browserEvent.preventDefault) {
			this.browserEvent.preventDefault();
		}
	}
	stopPropagation() {
		if (this.browserEvent && this.browserEvent.stopPropagation) {
			this.browserEvent.stopPropagation();
		}
	}
	toKeyCodeChord() {
		return this._asKeyCodeChord;
	}
	equals(other) {
		return this._asKeybinding === other;
	}
	_computeKeybinding() {
		let key = 0 /* KeyCode.Unknown */;
		if (this.keyCode !== 5 /* KeyCode.Ctrl */ && this.keyCode !== 4 /* KeyCode.Shift */ && this.keyCode !== 6 /* KeyCode.Alt */ && this.keyCode !== 57 /* KeyCode.Meta */) {
			key = this.keyCode;
		}
		let result = 0;
		if (this.ctrlKey) {
			result |= ctrlKeyMod;
		}
		if (this.altKey) {
			result |= altKeyMod;
		}
		if (this.shiftKey) {
			result |= shiftKeyMod;
		}
		if (this.metaKey) {
			result |= metaKeyMod;
		}
		result |= key;
		return result;
	}
	_computeKeyCodeChord() {
		let key = 0 /* KeyCode.Unknown */;
		if (this.keyCode !== 5 /* KeyCode.Ctrl */ && this.keyCode !== 4 /* KeyCode.Shift */ && this.keyCode !== 6 /* KeyCode.Alt */ && this.keyCode !== 57 /* KeyCode.Meta */) {
			key = this.keyCode;
		}
		return new keybindings_1.KeyCodeChord(this.ctrlKey, this.shiftKey, this.altKey, this.metaKey, key);
	}
}
exports.StandardKeyboardEvent = StandardKeyboardEvent;
