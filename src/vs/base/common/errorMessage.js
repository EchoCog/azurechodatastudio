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
exports.toErrorMessage = toErrorMessage;
exports.isErrorWithActions = isErrorWithActions;
exports.createErrorWithActions = createErrorWithActions;
const arrays = __importStar(require("vs/base/common/arrays"));
const types = __importStar(require("vs/base/common/types"));
const nls = __importStar(require("vs/nls"));
function exceptionToErrorMessage(exception, verbose) {
	if (verbose && (exception.stack || exception.stacktrace)) {
		return nls.localize('stackTrace.format', "{0}: {1}", detectSystemErrorMessage(exception), stackToString(exception.stack) || stackToString(exception.stacktrace));
	}
	return detectSystemErrorMessage(exception);
}
function stackToString(stack) {
	if (Array.isArray(stack)) {
		return stack.join('\n');
	}
	return stack;
}
function detectSystemErrorMessage(exception) {
	// Custom node.js error from us
	if (exception.code === 'ERR_UNC_HOST_NOT_ALLOWED') {
		return `${exception.message}. Please update the 'security.allowedUNCHosts' setting if you want to allow this host.`;
	}
	// See https://nodejs.org/api/errors.html#errors_class_system_error
	if (typeof exception.code === 'string' && typeof exception.errno === 'number' && typeof exception.syscall === 'string') {
		return nls.localize('nodeExceptionMessage', "A system error occurred ({0})", exception.message);
	}
	return exception.message || nls.localize('error.defaultMessage', "An unknown error occurred. Please consult the log for more details.");
}
/**
	* Tries to generate a human readable error message out of the error. If the verbose parameter
	* is set to true, the error message will include stacktrace details if provided.
	*
	* @returns A string containing the error message.
	*/
function toErrorMessage(error = null, verbose = false) {
	if (!error) {
		return nls.localize('error.defaultMessage', "An unknown error occurred. Please consult the log for more details.");
	}
	if (Array.isArray(error)) {
		const errors = arrays.coalesce(error);
		const msg = toErrorMessage(errors[0], verbose);
		if (errors.length > 1) {
			return nls.localize('error.moreErrors', "{0} ({1} errors in total)", msg, errors.length);
		}
		return msg;
	}
	if (types.isString(error)) {
		return error;
	}
	if (error.detail) {
		const detail = error.detail;
		if (detail.error) {
			return exceptionToErrorMessage(detail.error, verbose);
		}
		if (detail.exception) {
			return exceptionToErrorMessage(detail.exception, verbose);
		}
	}
	if (error.stack) {
		return exceptionToErrorMessage(error, verbose);
	}
	if (error.message) {
		return error.message;
	}
	return nls.localize('error.defaultMessage', "An unknown error occurred. Please consult the log for more details.");
}
function isErrorWithActions(obj) {
	const candidate = obj;
	return candidate instanceof Error && Array.isArray(candidate.actions);
}
function createErrorWithActions(messageOrError, actions) {
	let error;
	if (typeof messageOrError === 'string') {
		error = new Error(messageOrError);
	}
	else {
		error = messageOrError;
	}
	error.actions = actions;
	return error;
}
