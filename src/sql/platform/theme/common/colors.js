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
exports.resultsErrorColor = exports.cellBorderColor = exports.jobsHeadingBackground = exports.tableHoverBackground = exports.cellBackground = exports.tableBackground = exports.disabledCheckboxForeground = exports.buttonFocusOutline = exports.disabledInputForeground = exports.disabledInputBackground = exports.tableCellOutline = exports.listFocusAndSelectionForeground = exports.listFocusAndSelectionBackground = exports.tableHeaderForeground = exports.tableHeaderBackground = void 0;
const colorRegistry_1 = require("vs/platform/theme/common/colorRegistry");
const color_1 = require("vs/base/common/color");
const nls = __importStar(require("vs/nls"));
exports.tableHeaderBackground = (0, colorRegistry_1.registerColor)('table.headerBackground', { dark: new color_1.Color(new color_1.RGBA(51, 51, 52)), light: new color_1.Color(new color_1.RGBA(245, 245, 245)), hcDark: '#333334', hcLight: '#fff' }, nls.localize('tableHeaderBackground', "Table header background color"));
exports.tableHeaderForeground = (0, colorRegistry_1.registerColor)('table.headerForeground', { dark: new color_1.Color(new color_1.RGBA(229, 229, 229)), light: new color_1.Color(new color_1.RGBA(16, 16, 16)), hcDark: '#e5e5e5', hcLight: '#000' }, nls.localize('tableHeaderForeground', "Table header foreground color"));
exports.listFocusAndSelectionBackground = (0, colorRegistry_1.registerColor)('list.focusAndSelectionBackground', { dark: '#2c3295', light: '#2c3295', hcDark: null, hcLight: null }, nls.localize('listFocusAndSelectionBackground', "List/Table background color for the selected and focus item when the list/table is active"));
exports.listFocusAndSelectionForeground = (0, colorRegistry_1.registerColor)('list.focusAndSelectionForeground', { dark: '#ffffff', light: '#ffffff', hcDark: null, hcLight: null }, nls.localize('listFocusAndSelectionBackground', "List/Table foreground color for the selected and focus item when the list/table is active"));
exports.tableCellOutline = (0, colorRegistry_1.registerColor)('table.cell.outline', { dark: '#e3e4e229', light: '#33333333', hcDark: '#e3e4e229', hcLight: '#e3e4e229' }, nls.localize('tableCellOutline', 'Color of the outline of a cell.'));
exports.disabledInputBackground = (0, colorRegistry_1.registerColor)('input.disabled.background', { dark: '#444444', light: '#dcdcdc', hcDark: color_1.Color.black, hcLight: color_1.Color.white }, nls.localize('disabledInputBoxBackground', "Disabled Input box background."));
exports.disabledInputForeground = (0, colorRegistry_1.registerColor)('input.disabled.foreground', { dark: '#888888', light: '#888888', hcDark: colorRegistry_1.foreground, hcLight: colorRegistry_1.foreground }, nls.localize('disabledInputBoxForeground', "Disabled Input box foreground."));
exports.buttonFocusOutline = (0, colorRegistry_1.registerColor)('button.focusOutline', { dark: '#eaeaea', light: '#666666', hcDark: null, hcLight: colorRegistry_1.activeContrastBorder }, nls.localize('buttonFocusOutline', "Button outline color when focused."));
exports.disabledCheckboxForeground = (0, colorRegistry_1.registerColor)('checkbox.disabled.foreground', { dark: '#888888', light: '#888888', hcDark: color_1.Color.black, hcLight: color_1.Color.white }, nls.localize('disabledCheckboxforeground', "Disabled checkbox foreground."));
// SQL Agent Colors
exports.tableBackground = (0, colorRegistry_1.registerColor)('agent.tableBackground', { light: '#fffffe', dark: '#333333', hcDark: color_1.Color.black, hcLight: color_1.Color.white }, nls.localize('agentTableBackground', "SQL Agent Table background color."));
exports.cellBackground = (0, colorRegistry_1.registerColor)('agent.cellBackground', { light: '#faf5f8', dark: color_1.Color.black, hcDark: color_1.Color.black, hcLight: color_1.Color.white }, nls.localize('agentCellBackground', "SQL Agent table cell background color."));
exports.tableHoverBackground = (0, colorRegistry_1.registerColor)('agent.tableHoverColor', { light: '#dcdcdc', dark: '#444444', hcDark: null, hcLight: null }, nls.localize('agentTableHoverBackground', "SQL Agent table hover background color."));
exports.jobsHeadingBackground = (0, colorRegistry_1.registerColor)('agent.jobsHeadingColor', { light: '#f4f4f4', dark: '#444444', hcDark: '#2b56f2', hcLight: '#ffffff' }, nls.localize('agentJobsHeadingColor', "SQL Agent heading background color."));
exports.cellBorderColor = (0, colorRegistry_1.registerColor)('agent.cellBorderColor', { light: null, dark: null, hcDark: colorRegistry_1.contrastBorder, hcLight: colorRegistry_1.contrastBorder }, nls.localize('agentCellBorderColor', "SQL Agent table cell border color."));
exports.resultsErrorColor = (0, colorRegistry_1.registerColor)('results.error.color', { light: '#f44242', dark: '#f44242', hcDark: '#f44242', hcLight: '#f44242' }, nls.localize('resultsErrorColor', "Results messages error color."));
