"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Categories = void 0;
const nls_1 = require("vs/nls");
exports.Categories = Object.freeze({
	View: { value: (0, nls_1.localize)('view', "View"), original: 'View' },
	Help: { value: (0, nls_1.localize)('help', "Help"), original: 'Help' },
	Test: { value: (0, nls_1.localize)('test', "Test"), original: 'Test' },
	File: { value: (0, nls_1.localize)('file', "File"), original: 'File' },
	Preferences: { value: (0, nls_1.localize)('preferences', "Preferences"), original: 'Preferences' },
	Developer: { value: (0, nls_1.localize)({ key: 'developer', comment: ['A developer on Code itself or someone diagnosing issues in Code'] }, "Developer"), original: 'Developer' }
});
