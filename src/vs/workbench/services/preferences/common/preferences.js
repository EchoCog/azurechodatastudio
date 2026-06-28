"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.USE_SPLIT_JSON_SETTING = exports.DEFAULT_SETTINGS_EDITOR_SETTING = exports.FOLDER_SETTINGS_PATH = exports.DEFINE_KEYBINDING_EDITOR_CONTRIB_ID = exports.IPreferencesService = exports.SettingMatchType = exports.SettingValueType = void 0;
exports.validateSettingsEditorOptions = validateSettingsEditorOptions;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const editor_1 = require("vs/workbench/common/editor");
var SettingValueType;
(function (SettingValueType) {
    SettingValueType["Null"] = "null";
    SettingValueType["Enum"] = "enum";
    SettingValueType["String"] = "string";
    SettingValueType["MultilineString"] = "multiline-string";
    SettingValueType["Integer"] = "integer";
    SettingValueType["Number"] = "number";
    SettingValueType["Boolean"] = "boolean";
    SettingValueType["Array"] = "array";
    SettingValueType["Exclude"] = "exclude";
    SettingValueType["Include"] = "include";
    SettingValueType["Complex"] = "complex";
    SettingValueType["NullableInteger"] = "nullable-integer";
    SettingValueType["NullableNumber"] = "nullable-number";
    SettingValueType["Object"] = "object";
    SettingValueType["BooleanObject"] = "boolean-object";
    SettingValueType["LanguageTag"] = "language-tag";
    SettingValueType["ExtensionToggle"] = "extension-toggle";
})(SettingValueType || (exports.SettingValueType = SettingValueType = {}));
/**
 * The ways a setting could match a query,
 * sorted in increasing order of relevance.
 * For now, ignore description and value matches.
 */
var SettingMatchType;
(function (SettingMatchType) {
    SettingMatchType[SettingMatchType["None"] = 0] = "None";
    SettingMatchType[SettingMatchType["RemoteMatch"] = 1] = "RemoteMatch";
    SettingMatchType[SettingMatchType["WholeWordMatch"] = 2] = "WholeWordMatch";
    SettingMatchType[SettingMatchType["KeyMatch"] = 4] = "KeyMatch";
})(SettingMatchType || (exports.SettingMatchType = SettingMatchType = {}));
function validateSettingsEditorOptions(options) {
    return {
        // Inherit provided options
        ...options,
        // Enforce some options for settings specifically
        override: editor_1.DEFAULT_EDITOR_ASSOCIATION.id,
        pinned: true
    };
}
exports.IPreferencesService = (0, instantiation_1.createDecorator)('preferencesService');
exports.DEFINE_KEYBINDING_EDITOR_CONTRIB_ID = 'editor.contrib.defineKeybinding';
exports.FOLDER_SETTINGS_PATH = '.azuredatastudio/settings.json'; // {{SQL CARBON EDIT}}
exports.DEFAULT_SETTINGS_EDITOR_SETTING = 'workbench.settings.openDefaultSettings';
exports.USE_SPLIT_JSON_SETTING = 'workbench.settings.useSplitJSON';
