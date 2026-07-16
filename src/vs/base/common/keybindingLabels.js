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
exports.UserSettingsLabelProvider = exports.ElectronAcceleratorLabelProvider = exports.AriaLabelProvider = exports.UILabelProvider = exports.ModifierLabelProvider = void 0;
const nls = __importStar(require("vs/nls"));
class ModifierLabelProvider {
	modifierLabels;
	constructor(mac, windows, linux = windows) {
		this.modifierLabels = [null]; // index 0 will never me accessed.
		this.modifierLabels[2 /* OperatingSystem.Macintosh */] = mac;
		this.modifierLabels[1 /* OperatingSystem.Windows */] = windows;
		this.modifierLabels[3 /* OperatingSystem.Linux */] = linux;
	}
	toLabel(OS, chords, keyLabelProvider) {
		if (chords.length === 0) {
			return null;
		}
		const result = [];
		for (let i = 0, len = chords.length; i < len; i++) {
			const chord = chords[i];
			const keyLabel = keyLabelProvider(chord);
			if (keyLabel === null) {
				// this keybinding cannot be expressed...
				return null;
			}
			result[i] = _simpleAsString(chord, keyLabel, this.modifierLabels[OS]);
		}
		return result.join(' ');
	}
}
exports.ModifierLabelProvider = ModifierLabelProvider;
/**
	* A label provider that prints modifiers in a suitable format for displaying in the UI.
	*/
exports.UILabelProvider = new ModifierLabelProvider({
	ctrlKey: '\u2303',
	shiftKey: '⇧',
	altKey: '⌥',
	metaKey: '⌘',
	separator: '',
}, {
	ctrlKey: nls.localize({ key: 'ctrlKey', comment: ['This is the short form for the Control key on the keyboard'] }, "Ctrl"),
	shiftKey: nls.localize({ key: 'shiftKey', comment: ['This is the short form for the Shift key on the keyboard'] }, "Shift"),
	altKey: nls.localize({ key: 'altKey', comment: ['This is the short form for the Alt key on the keyboard'] }, "Alt"),
	metaKey: nls.localize({ key: 'windowsKey', comment: ['This is the short form for the Windows key on the keyboard'] }, "Windows"),
	separator: '+',
}, {
	ctrlKey: nls.localize({ key: 'ctrlKey', comment: ['This is the short form for the Control key on the keyboard'] }, "Ctrl"),
	shiftKey: nls.localize({ key: 'shiftKey', comment: ['This is the short form for the Shift key on the keyboard'] }, "Shift"),
	altKey: nls.localize({ key: 'altKey', comment: ['This is the short form for the Alt key on the keyboard'] }, "Alt"),
	metaKey: nls.localize({ key: 'superKey', comment: ['This is the short form for the Super key on the keyboard'] }, "Super"),
	separator: '+',
});
/**
	* A label provider that prints modifiers in a suitable format for ARIA.
	*/
exports.AriaLabelProvider = new ModifierLabelProvider({
	ctrlKey: nls.localize({ key: 'ctrlKey.long', comment: ['This is the long form for the Control key on the keyboard'] }, "Control"),
	shiftKey: nls.localize({ key: 'shiftKey.long', comment: ['This is the long form for the Shift key on the keyboard'] }, "Shift"),
	altKey: nls.localize({ key: 'optKey.long', comment: ['This is the long form for the Alt/Option key on the keyboard'] }, "Option"),
	metaKey: nls.localize({ key: 'cmdKey.long', comment: ['This is the long form for the Command key on the keyboard'] }, "Command"),
	separator: '+',
}, {
	ctrlKey: nls.localize({ key: 'ctrlKey.long', comment: ['This is the long form for the Control key on the keyboard'] }, "Control"),
	shiftKey: nls.localize({ key: 'shiftKey.long', comment: ['This is the long form for the Shift key on the keyboard'] }, "Shift"),
	altKey: nls.localize({ key: 'altKey.long', comment: ['This is the long form for the Alt key on the keyboard'] }, "Alt"),
	metaKey: nls.localize({ key: 'windowsKey.long', comment: ['This is the long form for the Windows key on the keyboard'] }, "Windows"),
	separator: '+',
}, {
	ctrlKey: nls.localize({ key: 'ctrlKey.long', comment: ['This is the long form for the Control key on the keyboard'] }, "Control"),
	shiftKey: nls.localize({ key: 'shiftKey.long', comment: ['This is the long form for the Shift key on the keyboard'] }, "Shift"),
	altKey: nls.localize({ key: 'altKey.long', comment: ['This is the long form for the Alt key on the keyboard'] }, "Alt"),
	metaKey: nls.localize({ key: 'superKey.long', comment: ['This is the long form for the Super key on the keyboard'] }, "Super"),
	separator: '+',
});
/**
	* A label provider that prints modifiers in a suitable format for Electron Accelerators.
	* See https://github.com/electron/electron/blob/master/docs/api/accelerator.md
	*/
exports.ElectronAcceleratorLabelProvider = new ModifierLabelProvider({
	ctrlKey: 'Ctrl',
	shiftKey: 'Shift',
	altKey: 'Alt',
	metaKey: 'Cmd',
	separator: '+',
}, {
	ctrlKey: 'Ctrl',
	shiftKey: 'Shift',
	altKey: 'Alt',
	metaKey: 'Super',
	separator: '+',
});
/**
	* A label provider that prints modifiers in a suitable format for user settings.
	*/
exports.UserSettingsLabelProvider = new ModifierLabelProvider({
	ctrlKey: 'ctrl',
	shiftKey: 'shift',
	altKey: 'alt',
	metaKey: 'cmd',
	separator: '+',
}, {
	ctrlKey: 'ctrl',
	shiftKey: 'shift',
	altKey: 'alt',
	metaKey: 'win',
	separator: '+',
}, {
	ctrlKey: 'ctrl',
	shiftKey: 'shift',
	altKey: 'alt',
	metaKey: 'meta',
	separator: '+',
});
function _simpleAsString(modifiers, key, labels) {
	if (key === null) {
		return '';
	}
	const result = [];
	// translate modifier keys: Ctrl-Shift-Alt-Meta
	if (modifiers.ctrlKey) {
		result.push(labels.ctrlKey);
	}
	if (modifiers.shiftKey) {
		result.push(labels.shiftKey);
	}
	if (modifiers.altKey) {
		result.push(labels.altKey);
	}
	if (modifiers.metaKey) {
		result.push(labels.metaKey);
	}
	// the actual key
	if (key !== '') {
		result.push(key);
	}
	return result.join(labels.separator);
}
