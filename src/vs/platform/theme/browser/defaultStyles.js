"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultMenuStyles = exports.defaultSelectBoxStyles = exports.defaultListStyles = exports.defaultBreadcrumbsWidgetStyles = exports.defaultCountBadgeStyles = exports.defaultFindWidgetStyles = exports.defaultInputBoxStyles = exports.defaultDialogStyles = exports.defaultCheckboxStyles = exports.defaultToggleStyles = exports.defaultProgressBarStyles = exports.defaultButtonStyles = exports.defaultKeybindingLabelStyles = void 0;
exports.overrideStyles = overrideStyles;
exports.getKeybindingLabelStyles = getKeybindingLabelStyles;
exports.getButtonStyles = getButtonStyles;
exports.getProgressBarStyles = getProgressBarStyles;
exports.getToggleStyles = getToggleStyles;
exports.getCheckboxStyles = getCheckboxStyles;
exports.getDialogStyle = getDialogStyle;
exports.getInputBoxStyle = getInputBoxStyle;
exports.getCountBadgeStyle = getCountBadgeStyle;
exports.getBreadcrumbsWidgetStyles = getBreadcrumbsWidgetStyles;
exports.getListStyles = getListStyles;
exports.getSelectBoxStyles = getSelectBoxStyles;
exports.getMenuStyles = getMenuStyles;
const colorRegistry_1 = require("vs/platform/theme/common/colorRegistry");
const color_1 = require("vs/base/common/color");
const colors_1 = require("sql/platform/theme/common/colors"); // {{SQL CARBON EDIT}}
// {{SQL CARBON EDIT}} - add export keyword so that this can be used by the defaultStyles.ts in sql folder.
function overrideStyles(override, styles) {
    const result = { ...styles };
    for (const key in override) {
        const val = override[key];
        result[key] = val !== undefined ? (0, colorRegistry_1.asCssVariable)(val) : undefined;
    }
    return result;
}
exports.defaultKeybindingLabelStyles = {
    keybindingLabelBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.keybindingLabelBackground),
    keybindingLabelForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.keybindingLabelForeground),
    keybindingLabelBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.keybindingLabelBorder),
    keybindingLabelBottomBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.keybindingLabelBottomBorder),
    keybindingLabelShadow: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.widgetShadow)
};
function getKeybindingLabelStyles(override) {
    return overrideStyles(override, exports.defaultKeybindingLabelStyles);
}
exports.defaultButtonStyles = {
    buttonForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonForeground),
    buttonSeparator: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonSeparator),
    buttonBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonBackground),
    buttonHoverBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonHoverBackground),
    buttonSecondaryForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonSecondaryForeground),
    buttonSecondaryBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonSecondaryBackground),
    buttonSecondaryHoverBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonSecondaryHoverBackground),
    buttonBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonBorder),
    // {{SQL CARBON EDIT}} - Start
    buttonSecondaryBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonSecondaryBorder),
    buttonDisabledBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonDisabledBackground),
    buttonDisabledForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonDisabledForeground),
    buttonDisabledBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.buttonDisabledBorder)
    // {{SQL CARBON EDIT}} - End
};
function getButtonStyles(override) {
    return overrideStyles(override, exports.defaultButtonStyles);
}
exports.defaultProgressBarStyles = {
    progressBarBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.progressBarBackground)
};
function getProgressBarStyles(override) {
    return overrideStyles(override, exports.defaultProgressBarStyles);
}
exports.defaultToggleStyles = {
    inputActiveOptionBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputActiveOptionBorder),
    inputActiveOptionForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputActiveOptionForeground),
    inputActiveOptionBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputActiveOptionBackground)
};
function getToggleStyles(override) {
    return overrideStyles(override, exports.defaultToggleStyles);
}
exports.defaultCheckboxStyles = {
    checkboxBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.checkboxBackground),
    checkboxBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.checkboxBorder),
    checkboxForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.checkboxForeground)
};
function getCheckboxStyles(override) {
    return overrideStyles(override, exports.defaultCheckboxStyles);
}
exports.defaultDialogStyles = {
    dialogBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.editorWidgetBackground),
    dialogForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.editorWidgetForeground),
    dialogShadow: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.widgetShadow),
    dialogBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.contrastBorder),
    errorIconForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.problemsErrorIconForeground),
    warningIconForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.problemsWarningIconForeground),
    infoIconForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.problemsInfoIconForeground),
    textLinkForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.textLinkForeground)
};
function getDialogStyle(override) {
    return overrideStyles(override, exports.defaultDialogStyles);
}
exports.defaultInputBoxStyles = {
    inputBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputBackground),
    inputForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputForeground),
    inputBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputBorder),
    inputValidationInfoBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationInfoBorder),
    inputValidationInfoBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationInfoBackground),
    inputValidationInfoForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationInfoForeground),
    inputValidationWarningBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationWarningBorder),
    inputValidationWarningBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationWarningBackground),
    inputValidationWarningForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationWarningForeground),
    inputValidationErrorBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationErrorBorder),
    inputValidationErrorBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationErrorBackground),
    inputValidationErrorForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.inputValidationErrorForeground),
    // {{SQL CARBON EDIT}}
    disabledInputBackground: (0, colorRegistry_1.asCssVariable)(colors_1.disabledInputBackground),
    disabledInputForeground: (0, colorRegistry_1.asCssVariable)(colors_1.disabledInputForeground),
    disabledInputBorder: 'transparent'
    // {{SQL CARBON EDIT}} - END
};
function getInputBoxStyle(override) {
    return overrideStyles(override, exports.defaultInputBoxStyles);
}
exports.defaultFindWidgetStyles = {
    listFilterWidgetBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFilterWidgetBackground),
    listFilterWidgetOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFilterWidgetOutline),
    listFilterWidgetNoMatchesOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFilterWidgetNoMatchesOutline),
    listFilterWidgetShadow: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFilterWidgetShadow),
    inputBoxStyles: exports.defaultInputBoxStyles,
    toggleStyles: exports.defaultToggleStyles
};
exports.defaultCountBadgeStyles = {
    badgeBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.badgeBackground),
    badgeForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.badgeForeground),
    badgeBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.contrastBorder)
};
function getCountBadgeStyle(override) {
    return overrideStyles(override, exports.defaultCountBadgeStyles);
}
exports.defaultBreadcrumbsWidgetStyles = {
    breadcrumbsBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.breadcrumbsBackground),
    breadcrumbsForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.breadcrumbsForeground),
    breadcrumbsHoverForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.breadcrumbsFocusForeground),
    breadcrumbsFocusForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.breadcrumbsFocusForeground),
    breadcrumbsFocusAndSelectionForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.breadcrumbsActiveSelectionForeground)
};
function getBreadcrumbsWidgetStyles(override) {
    return overrideStyles(override, exports.defaultBreadcrumbsWidgetStyles);
}
exports.defaultListStyles = {
    listBackground: undefined,
    listInactiveFocusForeground: undefined,
    listFocusBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFocusBackground),
    listFocusForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFocusForeground),
    listFocusOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFocusOutline),
    listActiveSelectionBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listActiveSelectionBackground),
    listActiveSelectionForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listActiveSelectionForeground),
    listActiveSelectionIconForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listActiveSelectionIconForeground),
    listFocusAndSelectionOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listFocusAndSelectionOutline),
    listFocusAndSelectionBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listActiveSelectionBackground),
    listFocusAndSelectionForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listActiveSelectionForeground),
    listInactiveSelectionBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listInactiveSelectionBackground),
    listInactiveSelectionIconForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listInactiveSelectionIconForeground),
    listInactiveSelectionForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listInactiveSelectionForeground),
    listInactiveFocusBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listInactiveFocusBackground),
    listInactiveFocusOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listInactiveFocusOutline),
    listHoverBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listHoverBackground),
    listHoverForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listHoverForeground),
    listDropBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listDropBackground),
    listSelectionOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.activeContrastBorder),
    listHoverOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.activeContrastBorder),
    treeIndentGuidesStroke: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.treeIndentGuidesStroke),
    treeInactiveIndentGuidesStroke: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.treeInactiveIndentGuidesStroke),
    tableColumnsBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.tableColumnsBorder),
    tableOddRowsBackgroundColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.tableOddRowsBackgroundColor),
};
function getListStyles(override) {
    return overrideStyles(override, exports.defaultListStyles);
}
exports.defaultSelectBoxStyles = {
    selectBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.selectBackground),
    selectListBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.selectListBackground),
    selectForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.selectForeground),
    decoratorRightForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.pickerGroupForeground),
    selectBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.selectBorder),
    focusBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.focusBorder),
    listFocusBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.quickInputListFocusBackground),
    listInactiveSelectionIconForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.quickInputListFocusIconForeground),
    listFocusForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.quickInputListFocusForeground),
    listFocusOutline: (0, colorRegistry_1.asCssVariableWithDefault)(colorRegistry_1.activeContrastBorder, color_1.Color.transparent.toString()),
    listHoverBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listHoverBackground),
    listHoverForeground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.listHoverForeground),
    listHoverOutline: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.activeContrastBorder),
    selectListBorder: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.editorWidgetBorder),
    listBackground: undefined,
    listActiveSelectionBackground: undefined,
    listActiveSelectionForeground: undefined,
    listActiveSelectionIconForeground: undefined,
    listFocusAndSelectionBackground: undefined,
    listDropBackground: undefined,
    listInactiveSelectionBackground: undefined,
    listInactiveSelectionForeground: undefined,
    listInactiveFocusBackground: undefined,
    listInactiveFocusOutline: undefined,
    listSelectionOutline: undefined,
    listFocusAndSelectionForeground: undefined,
    listFocusAndSelectionOutline: undefined,
    listInactiveFocusForeground: undefined,
    tableColumnsBorder: undefined,
    tableOddRowsBackgroundColor: undefined,
    treeIndentGuidesStroke: undefined,
    treeInactiveIndentGuidesStroke: undefined,
};
function getSelectBoxStyles(override) {
    return overrideStyles(override, exports.defaultSelectBoxStyles);
}
exports.defaultMenuStyles = {
    shadowColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.widgetShadow),
    borderColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.menuBorder),
    foregroundColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.menuForeground),
    backgroundColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.menuBackground),
    selectionForegroundColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.menuSelectionForeground),
    selectionBackgroundColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.menuSelectionBackground),
    selectionBorderColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.menuSelectionBorder),
    separatorColor: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.menuSeparatorBackground),
    scrollbarShadow: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.scrollbarShadow),
    scrollbarSliderBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.scrollbarSliderBackground),
    scrollbarSliderHoverBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.scrollbarSliderHoverBackground),
    scrollbarSliderActiveBackground: (0, colorRegistry_1.asCssVariable)(colorRegistry_1.scrollbarSliderActiveBackground)
};
function getMenuStyles(override) {
    return overrideStyles(override, exports.defaultMenuStyles);
}
