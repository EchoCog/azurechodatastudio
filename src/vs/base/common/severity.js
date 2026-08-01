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
const strings = __importStar(require("vs/base/common/strings"));
var Severity;
(function (Severity) {
	Severity[Severity["Ignore"] = 0] = "Ignore";
	Severity[Severity["Info"] = 1] = "Info";
	Severity[Severity["Warning"] = 2] = "Warning";
	Severity[Severity["Error"] = 3] = "Error";
})(Severity || (Severity = {}));
(function (Severity) {
	const _error = 'error';
	const _warning = 'warning';
	const _warn = 'warn';
	const _info = 'info';
	const _ignore = 'ignore';
	/**
		* Parses 'error', 'warning', 'warn', 'info' in call casings
		* and falls back to ignore.
		*/
	function fromValue(value) {
		if (!value) {
			return Severity.Ignore;
		}
		if (strings.equalsIgnoreCase(_error, value)) {
			return Severity.Error;
		}
		if (strings.equalsIgnoreCase(_warning, value) || strings.equalsIgnoreCase(_warn, value)) {
			return Severity.Warning;
		}
		if (strings.equalsIgnoreCase(_info, value)) {
			return Severity.Info;
		}
		return Severity.Ignore;
	}
	Severity.fromValue = fromValue;
	function toString(severity) {
		switch (severity) {
			case Severity.Error: return _error;
			case Severity.Warning: return _warning;
			case Severity.Info: return _info;
			default: return _ignore;
		}
	}
	Severity.toString = toString;
})(Severity || (Severity = {}));
exports.default = Severity;
