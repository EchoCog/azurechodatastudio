"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTEXT_ACCESSIBILITY_MODE_ENABLED = exports.IAccessibilityService = void 0;
exports.isAccessibilityInformation = isAccessibilityInformation;
const contextkey_1 = require("vs/platform/contextkey/common/contextkey");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
exports.IAccessibilityService = (0, instantiation_1.createDecorator)('accessibilityService');
exports.CONTEXT_ACCESSIBILITY_MODE_ENABLED = new contextkey_1.RawContextKey('accessibilityModeEnabled', false);
function isAccessibilityInformation(obj) {
	return obj && typeof obj === 'object'
		&& typeof obj.label === 'string'
		&& (typeof obj.role === 'undefined' || typeof obj.role === 'string');
}
