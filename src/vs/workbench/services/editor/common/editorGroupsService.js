"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.IEditorGroupsService = void 0;
exports.isEditorReplacement = isEditorReplacement;
exports.isEditorGroup = isEditorGroup;
exports.preferredSideBySideGroupDirection = preferredSideBySideGroupDirection;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const editor_1 = require("vs/workbench/common/editor");
exports.IEditorGroupsService = (0, instantiation_1.createDecorator)('editorGroupsService');
function isEditorReplacement(replacement) {
    const candidate = replacement;
    return (0, editor_1.isEditorInput)(candidate?.editor) && (0, editor_1.isEditorInput)(candidate?.replacement);
}
function isEditorGroup(obj) {
    const group = obj;
    return !!group && typeof group.id === 'number' && Array.isArray(group.editors);
}
//#region Editor Group Helpers
function preferredSideBySideGroupDirection(configurationService) {
    const openSideBySideDirection = configurationService.getValue('workbench.editor.openSideBySideDirection');
    if (openSideBySideDirection === 'down') {
        return 1 /* GroupDirection.DOWN */;
    }
    return 3 /* GroupDirection.RIGHT */;
}
//#endregion
