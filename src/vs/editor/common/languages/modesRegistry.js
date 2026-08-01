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
exports.PLAINTEXT_EXTENSION = exports.PLAINTEXT_LANGUAGE_ID = exports.ModesRegistry = exports.EditorModesRegistry = exports.Extensions = void 0;
const nls = __importStar(require("vs/nls"));
const event_1 = require("vs/base/common/event");
const platform_1 = require("vs/platform/registry/common/platform");
const mime_1 = require("vs/base/common/mime");
const configurationRegistry_1 = require("vs/platform/configuration/common/configurationRegistry");
// Define extension point ids
exports.Extensions = {
	ModesRegistry: 'editor.modesRegistry'
};
class EditorModesRegistry {
	_languages;
	_onDidChangeLanguages = new event_1.Emitter();
	onDidChangeLanguages = this._onDidChangeLanguages.event;
	constructor() {
		this._languages = [];
	}
	registerLanguage(def) {
		this._languages.push(def);
		this._onDidChangeLanguages.fire(undefined);
		return {
			dispose: () => {
				for (let i = 0, len = this._languages.length; i < len; i++) {
					if (this._languages[i] === def) {
						this._languages.splice(i, 1);
						return;
					}
				}
			}
		};
	}
	getLanguages() {
		return this._languages;
	}
}
exports.EditorModesRegistry = EditorModesRegistry;
exports.ModesRegistry = new EditorModesRegistry();
platform_1.Registry.add(exports.Extensions.ModesRegistry, exports.ModesRegistry);
exports.PLAINTEXT_LANGUAGE_ID = 'plaintext';
exports.PLAINTEXT_EXTENSION = '.txt';
exports.ModesRegistry.registerLanguage({
	id: exports.PLAINTEXT_LANGUAGE_ID,
	extensions: [exports.PLAINTEXT_EXTENSION],
	aliases: [nls.localize('plainText.alias', "Plain Text"), 'text'],
	mimetypes: [mime_1.Mimes.text]
});
platform_1.Registry.as(configurationRegistry_1.Extensions.Configuration)
	.registerDefaultConfigurations([{
		overrides: {
			'[plaintext]': {
				'editor.unicodeHighlight.ambiguousCharacters': false,
				'editor.unicodeHighlight.invisibleCharacters': false
			}
		}
	}]);
