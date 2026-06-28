"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIDE_GROUP = exports.ACTIVE_GROUP = exports.IEditorService = void 0;
exports.isPreferredGroup = isPreferredGroup;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const editorGroupsService_1 = require("vs/workbench/services/editor/common/editorGroupsService");
exports.IEditorService = (0, instantiation_1.createDecorator)('editorService');
/**
 * Open an editor in the currently active group.
 */
exports.ACTIVE_GROUP = -1;
/**
 * Open an editor to the side of the active group.
 */
exports.SIDE_GROUP = -2;
function isPreferredGroup(obj) {
    const candidate = obj;
    return typeof obj === 'number' || (0, editorGroupsService_1.isEditorGroup)(candidate);
}
