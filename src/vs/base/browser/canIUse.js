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
exports.BrowserFeatures = void 0;
const browser = __importStar(require("vs/base/browser/browser"));
const platform = __importStar(require("vs/base/common/platform"));
/**
	* Browser feature we can support in current platform, browser and environment.
	*/
exports.BrowserFeatures = {
	clipboard: {
		writeText: (platform.isNative
			|| (document.queryCommandSupported && document.queryCommandSupported('copy'))
			|| !!(navigator && navigator.clipboard && navigator.clipboard.writeText)),
		readText: (platform.isNative
			|| !!(navigator && navigator.clipboard && navigator.clipboard.readText))
	},
	keyboard: (() => {
		if (platform.isNative || browser.isStandalone()) {
			return 0 /* KeyboardSupport.Always */;
		}
		if (navigator.keyboard || browser.isSafari) {
			return 1 /* KeyboardSupport.FullScreen */;
		}
		return 2 /* KeyboardSupport.None */;
	})(),
	// 'ontouchstart' in window always evaluates to true with typescript's modern typings. This causes `window` to be
	// `never` later in `window.navigator`. That's why we need the explicit `window as Window` cast
	touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
	pointerEvents: window.PointerEvent && ('ontouchstart' in window || window.navigator.maxTouchPoints > 0 || navigator.maxTouchPoints > 0)
};
