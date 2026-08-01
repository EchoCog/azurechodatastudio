"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.PANEL_SECTION_BORDER = exports.PANEL_SECTION_HEADER_BORDER = exports.PANEL_SECTION_HEADER_FOREGROUND = exports.PANEL_SECTION_HEADER_BACKGROUND = exports.PANEL_SECTION_DRAG_AND_DROP_BACKGROUND = exports.PANEL_DRAG_AND_DROP_BORDER = exports.PANEL_INPUT_BORDER = exports.PANEL_ACTIVE_TITLE_BORDER = exports.PANEL_INACTIVE_TITLE_FOREGROUND = exports.PANEL_ACTIVE_TITLE_FOREGROUND = exports.PANEL_BORDER = exports.PANEL_BACKGROUND = exports.SIDE_BY_SIDE_EDITOR_VERTICAL_BORDER = exports.SIDE_BY_SIDE_EDITOR_HORIZONTAL_BORDER = exports.EDITOR_DROP_INTO_PROMPT_BORDER = exports.EDITOR_DROP_INTO_PROMPT_BACKGROUND = exports.EDITOR_DROP_INTO_PROMPT_FOREGROUND = exports.EDITOR_DRAG_AND_DROP_BACKGROUND = exports.EDITOR_GROUP_BORDER = exports.EDITOR_GROUP_HEADER_BORDER = exports.EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND = exports.EDITOR_GROUP_HEADER_TABS_BORDER = exports.EDITOR_GROUP_HEADER_TABS_BACKGROUND = exports.EDITOR_GROUP_FOCUSED_EMPTY_BORDER = exports.EDITOR_GROUP_EMPTY_BACKGROUND = exports.EDITOR_PANE_BACKGROUND = exports.TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER = exports.TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER = exports.TAB_INACTIVE_MODIFIED_BORDER = exports.TAB_ACTIVE_MODIFIED_BORDER = exports.TAB_UNFOCUSED_HOVER_BORDER = exports.TAB_HOVER_BORDER = exports.TAB_UNFOCUSED_ACTIVE_BORDER_TOP = exports.TAB_ACTIVE_BORDER_TOP = exports.TAB_UNFOCUSED_ACTIVE_BORDER = exports.TAB_ACTIVE_BORDER = exports.TAB_LAST_PINNED_BORDER = exports.TAB_BORDER = exports.TAB_UNFOCUSED_HOVER_FOREGROUND = exports.TAB_HOVER_FOREGROUND = exports.TAB_UNFOCUSED_HOVER_BACKGROUND = exports.TAB_HOVER_BACKGROUND = exports.TAB_UNFOCUSED_INACTIVE_FOREGROUND = exports.TAB_UNFOCUSED_ACTIVE_FOREGROUND = exports.TAB_INACTIVE_FOREGROUND = exports.TAB_ACTIVE_FOREGROUND = exports.TAB_UNFOCUSED_INACTIVE_BACKGROUND = exports.TAB_INACTIVE_BACKGROUND = exports.TAB_UNFOCUSED_ACTIVE_BACKGROUND = exports.TAB_ACTIVE_BACKGROUND = void 0;
exports.SIDE_BAR_BACKGROUND = exports.EXTENSION_BADGE_REMOTE_FOREGROUND = exports.EXTENSION_BADGE_REMOTE_BACKGROUND = exports.STATUS_BAR_OFFLINE_ITEM_HOVER_BACKGROUND = exports.STATUS_BAR_OFFLINE_ITEM_HOVER_FOREGROUND = exports.STATUS_BAR_OFFLINE_ITEM_FOREGROUND = exports.STATUS_BAR_OFFLINE_ITEM_BACKGROUND = exports.STATUS_BAR_REMOTE_ITEM_HOVER_BACKGROUND = exports.STATUS_BAR_REMOTE_ITEM_HOVER_FOREGROUND = exports.STATUS_BAR_REMOTE_ITEM_FOREGROUND = exports.STATUS_BAR_REMOTE_ITEM_BACKGROUND = exports.PROFILE_BADGE_FOREGROUND = exports.PROFILE_BADGE_BACKGROUND = exports.ACTIVITY_BAR_BADGE_FOREGROUND = exports.ACTIVITY_BAR_BADGE_BACKGROUND = exports.ACTIVITY_BAR_DRAG_AND_DROP_BORDER = exports.ACTIVITY_BAR_ACTIVE_BACKGROUND = exports.ACTIVITY_BAR_ACTIVE_FOCUS_BORDER = exports.ACTIVITY_BAR_ACTIVE_BORDER = exports.ACTIVITY_BAR_BORDER = exports.ACTIVITY_BAR_INACTIVE_FOREGROUND = exports.ACTIVITY_BAR_FOREGROUND = exports.ACTIVITY_BAR_BACKGROUND = exports.STATUS_BAR_WARNING_ITEM_HOVER_BACKGROUND = exports.STATUS_BAR_WARNING_ITEM_HOVER_FOREGROUND = exports.STATUS_BAR_WARNING_ITEM_FOREGROUND = exports.STATUS_BAR_WARNING_ITEM_BACKGROUND = exports.STATUS_BAR_ERROR_ITEM_HOVER_BACKGROUND = exports.STATUS_BAR_ERROR_ITEM_HOVER_FOREGROUND = exports.STATUS_BAR_ERROR_ITEM_FOREGROUND = exports.STATUS_BAR_ERROR_ITEM_BACKGROUND = exports.STATUS_BAR_PROMINENT_ITEM_HOVER_BACKGROUND = exports.STATUS_BAR_PROMINENT_ITEM_HOVER_FOREGROUND = exports.STATUS_BAR_PROMINENT_ITEM_BACKGROUND = exports.STATUS_BAR_PROMINENT_ITEM_FOREGROUND = exports.STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND = exports.STATUS_BAR_ITEM_HOVER_FOREGROUND = exports.STATUS_BAR_ITEM_HOVER_BACKGROUND = exports.STATUS_BAR_ITEM_FOCUS_BORDER = exports.STATUS_BAR_ITEM_ACTIVE_BACKGROUND = exports.STATUS_BAR_NO_FOLDER_BORDER = exports.STATUS_BAR_FOCUS_BORDER = exports.STATUS_BAR_BORDER = exports.STATUS_BAR_NO_FOLDER_BACKGROUND = exports.STATUS_BAR_BACKGROUND = exports.STATUS_BAR_NO_FOLDER_FOREGROUND = exports.STATUS_BAR_FOREGROUND = exports.BANNER_ICON_FOREGROUND = exports.BANNER_FOREGROUND = exports.BANNER_BACKGROUND = void 0;
exports.CARD_OVERLAY_BACKGROUND = exports.CARD_OVERLAY_FOREGROUND = exports.WINDOW_INACTIVE_BORDER = exports.WINDOW_ACTIVE_BORDER = exports.NOTIFICATIONS_INFO_ICON_FOREGROUND = exports.NOTIFICATIONS_WARNING_ICON_FOREGROUND = exports.NOTIFICATIONS_ERROR_ICON_FOREGROUND = exports.NOTIFICATIONS_BORDER = exports.NOTIFICATIONS_CENTER_HEADER_BACKGROUND = exports.NOTIFICATIONS_CENTER_HEADER_FOREGROUND = exports.NOTIFICATIONS_LINKS = exports.NOTIFICATIONS_BACKGROUND = exports.NOTIFICATIONS_FOREGROUND = exports.NOTIFICATIONS_TOAST_BORDER = exports.NOTIFICATIONS_CENTER_BORDER = exports.MENUBAR_SELECTION_BORDER = exports.MENUBAR_SELECTION_BACKGROUND = exports.MENUBAR_SELECTION_FOREGROUND = exports.TITLE_BAR_BORDER = exports.TITLE_BAR_INACTIVE_BACKGROUND = exports.TITLE_BAR_ACTIVE_BACKGROUND = exports.TITLE_BAR_INACTIVE_FOREGROUND = exports.TITLE_BAR_ACTIVE_FOREGROUND = exports.SIDE_BAR_SECTION_HEADER_BORDER = exports.SIDE_BAR_SECTION_HEADER_FOREGROUND = exports.SIDE_BAR_SECTION_HEADER_BACKGROUND = exports.SIDE_BAR_DRAG_AND_DROP_BACKGROUND = exports.SIDE_BAR_TITLE_FOREGROUND = exports.SIDE_BAR_BORDER = exports.SIDE_BAR_FOREGROUND = void 0;
exports.WORKBENCH_BACKGROUND = WORKBENCH_BACKGROUND;
const nls_1 = require("vs/nls");
const colorRegistry_1 = require("vs/platform/theme/common/colorRegistry");
const color_1 = require("vs/base/common/color");
const theme_1 = require("vs/platform/theme/common/theme");
// < --- Workbench (not customizable) --- >
function WORKBENCH_BACKGROUND(theme) {
	switch (theme.type) {
		case theme_1.ColorScheme.LIGHT:
			return color_1.Color.fromHex('#F3F3F3');
		case theme_1.ColorScheme.HIGH_CONTRAST_LIGHT:
			return color_1.Color.fromHex('#FFFFFF');
		case theme_1.ColorScheme.HIGH_CONTRAST_DARK:
			return color_1.Color.fromHex('#000000');
		default:
			return color_1.Color.fromHex('#252526');
	}
}
// < --- Tabs --- >
//#region Tab Background
exports.TAB_ACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('tab.activeBackground', {
	dark: colorRegistry_1.editorBackground,
	light: colorRegistry_1.editorBackground,
	hcDark: colorRegistry_1.editorBackground,
	hcLight: colorRegistry_1.editorBackground
}, (0, nls_1.localize)('tabActiveBackground', "Active tab background color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_ACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('tab.unfocusedActiveBackground', {
	dark: exports.TAB_ACTIVE_BACKGROUND,
	light: exports.TAB_ACTIVE_BACKGROUND,
	hcDark: exports.TAB_ACTIVE_BACKGROUND,
	hcLight: exports.TAB_ACTIVE_BACKGROUND,
}, (0, nls_1.localize)('tabUnfocusedActiveBackground', "Active tab background color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_INACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('tab.inactiveBackground', {
	dark: '#2D2D2D',
	light: '#ECECEC',
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('tabInactiveBackground', "Inactive tab background color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_INACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('tab.unfocusedInactiveBackground', {
	dark: exports.TAB_INACTIVE_BACKGROUND,
	light: exports.TAB_INACTIVE_BACKGROUND,
	hcDark: exports.TAB_INACTIVE_BACKGROUND,
	hcLight: exports.TAB_INACTIVE_BACKGROUND
}, (0, nls_1.localize)('tabUnfocusedInactiveBackground', "Inactive tab background color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
//#endregion
//#region Tab Foreground
exports.TAB_ACTIVE_FOREGROUND = (0, colorRegistry_1.registerColor)('tab.activeForeground', {
	dark: color_1.Color.white,
	light: '#333333',
	hcDark: color_1.Color.white,
	hcLight: '#292929'
}, (0, nls_1.localize)('tabActiveForeground', "Active tab foreground color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_INACTIVE_FOREGROUND = (0, colorRegistry_1.registerColor)('tab.inactiveForeground', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_FOREGROUND, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_FOREGROUND, 0.7),
	hcDark: color_1.Color.white,
	hcLight: '#292929'
}, (0, nls_1.localize)('tabInactiveForeground', "Inactive tab foreground color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_ACTIVE_FOREGROUND = (0, colorRegistry_1.registerColor)('tab.unfocusedActiveForeground', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_FOREGROUND, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_FOREGROUND, 0.7),
	hcDark: color_1.Color.white,
	hcLight: '#292929'
}, (0, nls_1.localize)('tabUnfocusedActiveForeground', "Active tab foreground color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_INACTIVE_FOREGROUND = (0, colorRegistry_1.registerColor)('tab.unfocusedInactiveForeground', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_INACTIVE_FOREGROUND, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_INACTIVE_FOREGROUND, 0.5),
	hcDark: color_1.Color.white,
	hcLight: '#292929'
}, (0, nls_1.localize)('tabUnfocusedInactiveForeground', "Inactive tab foreground color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
//#endregion
//#region Tab Hover Foreground/Background
exports.TAB_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('tab.hoverBackground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabHoverBackground', "Tab background color when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('tab.unfocusedHoverBackground', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_HOVER_BACKGROUND, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_HOVER_BACKGROUND, 0.7),
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabUnfocusedHoverBackground', "Tab background color in an unfocused group when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('tab.hoverForeground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('tabHoverForeground', "Tab foreground color when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('tab.unfocusedHoverForeground', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_HOVER_FOREGROUND, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_HOVER_FOREGROUND, 0.5),
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabUnfocusedHoverForeground', "Tab foreground color in an unfocused group when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
//#endregion
//#region Tab Borders
exports.TAB_BORDER = (0, colorRegistry_1.registerColor)('tab.border', {
	dark: '#252526',
	light: '#F3F3F3',
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder,
}, (0, nls_1.localize)('tabBorder', "Border to separate tabs from each other. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_LAST_PINNED_BORDER = (0, colorRegistry_1.registerColor)('tab.lastPinnedBorder', {
	dark: colorRegistry_1.treeIndentGuidesStroke,
	light: colorRegistry_1.treeIndentGuidesStroke,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('lastPinnedTabBorder', "Border to separate pinned tabs from other tabs. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_ACTIVE_BORDER = (0, colorRegistry_1.registerColor)('tab.activeBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabActiveBorder', "Border on the bottom of an active tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_ACTIVE_BORDER = (0, colorRegistry_1.registerColor)('tab.unfocusedActiveBorder', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_BORDER, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_BORDER, 0.7),
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabActiveUnfocusedBorder', "Border on the bottom of an active tab in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_ACTIVE_BORDER_TOP = (0, colorRegistry_1.registerColor)('tab.activeBorderTop', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: '#B5200D'
}, (0, nls_1.localize)('tabActiveBorderTop', "Border to the top of an active tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_ACTIVE_BORDER_TOP = (0, colorRegistry_1.registerColor)('tab.unfocusedActiveBorderTop', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_BORDER_TOP, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_BORDER_TOP, 0.7),
	hcDark: null,
	hcLight: '#B5200D'
}, (0, nls_1.localize)('tabActiveUnfocusedBorderTop', "Border to the top of an active tab in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_HOVER_BORDER = (0, colorRegistry_1.registerColor)('tab.hoverBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabHoverBorder', "Border to highlight tabs when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_HOVER_BORDER = (0, colorRegistry_1.registerColor)('tab.unfocusedHoverBorder', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_HOVER_BORDER, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_HOVER_BORDER, 0.7),
	hcDark: null,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('tabUnfocusedHoverBorder', "Border to highlight tabs in an unfocused group when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
//#endregion
//#region Tab Modified Border
exports.TAB_ACTIVE_MODIFIED_BORDER = (0, colorRegistry_1.registerColor)('tab.activeModifiedBorder', {
	dark: '#3399CC',
	light: '#33AAEE',
	hcDark: null,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('tabActiveModifiedBorder', "Border on the top of modified active tabs in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_INACTIVE_MODIFIED_BORDER = (0, colorRegistry_1.registerColor)('tab.inactiveModifiedBorder', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_MODIFIED_BORDER, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_MODIFIED_BORDER, 0.5),
	hcDark: color_1.Color.white,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('tabInactiveModifiedBorder', "Border on the top of modified inactive tabs in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER = (0, colorRegistry_1.registerColor)('tab.unfocusedActiveModifiedBorder', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_MODIFIED_BORDER, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_ACTIVE_MODIFIED_BORDER, 0.7),
	hcDark: color_1.Color.white,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('unfocusedActiveModifiedBorder', "Border on the top of modified active tabs in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
exports.TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER = (0, colorRegistry_1.registerColor)('tab.unfocusedInactiveModifiedBorder', {
	dark: (0, colorRegistry_1.transparent)(exports.TAB_INACTIVE_MODIFIED_BORDER, 0.5),
	light: (0, colorRegistry_1.transparent)(exports.TAB_INACTIVE_MODIFIED_BORDER, 0.5),
	hcDark: color_1.Color.white,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('unfocusedINactiveModifiedBorder', "Border on the top of modified inactive tabs in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));
//#endregion
// < --- Editors --- >
exports.EDITOR_PANE_BACKGROUND = (0, colorRegistry_1.registerColor)('editorPane.background', {
	dark: colorRegistry_1.editorBackground,
	light: colorRegistry_1.editorBackground,
	hcDark: colorRegistry_1.editorBackground,
	hcLight: colorRegistry_1.editorBackground
}, (0, nls_1.localize)('editorPaneBackground', "Background color of the editor pane visible on the left and right side of the centered editor layout."));
exports.EDITOR_GROUP_EMPTY_BACKGROUND = (0, colorRegistry_1.registerColor)('editorGroup.emptyBackground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('editorGroupEmptyBackground', "Background color of an empty editor group. Editor groups are the containers of editors."));
exports.EDITOR_GROUP_FOCUSED_EMPTY_BORDER = (0, colorRegistry_1.registerColor)('editorGroup.focusedEmptyBorder', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.focusBorder,
	hcLight: colorRegistry_1.focusBorder
}, (0, nls_1.localize)('editorGroupFocusedEmptyBorder', "Border color of an empty editor group that is focused. Editor groups are the containers of editors."));
exports.EDITOR_GROUP_HEADER_TABS_BACKGROUND = (0, colorRegistry_1.registerColor)('editorGroupHeader.tabsBackground', {
	dark: '#252526',
	light: '#F3F3F3',
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabsContainerBackground', "Background color of the editor group title header when tabs are enabled. Editor groups are the containers of editors."));
exports.EDITOR_GROUP_HEADER_TABS_BORDER = (0, colorRegistry_1.registerColor)('editorGroupHeader.tabsBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('tabsContainerBorder', "Border color of the editor group title header when tabs are enabled. Editor groups are the containers of editors."));
exports.EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND = (0, colorRegistry_1.registerColor)('editorGroupHeader.noTabsBackground', {
	dark: colorRegistry_1.editorBackground,
	light: colorRegistry_1.editorBackground,
	hcDark: colorRegistry_1.editorBackground,
	hcLight: colorRegistry_1.editorBackground
}, (0, nls_1.localize)('editorGroupHeaderBackground', "Background color of the editor group title header when tabs are disabled (`\"workbench.editor.showTabs\": false`). Editor groups are the containers of editors."));
exports.EDITOR_GROUP_HEADER_BORDER = (0, colorRegistry_1.registerColor)('editorGroupHeader.border', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('editorTitleContainerBorder', "Border color of the editor group title header. Editor groups are the containers of editors."));
exports.EDITOR_GROUP_BORDER = (0, colorRegistry_1.registerColor)('editorGroup.border', {
	dark: '#444444',
	light: '#E7E7E7',
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('editorGroupBorder', "Color to separate multiple editor groups from each other. Editor groups are the containers of editors."));
exports.EDITOR_DRAG_AND_DROP_BACKGROUND = (0, colorRegistry_1.registerColor)('editorGroup.dropBackground', {
	dark: color_1.Color.fromHex('#53595D').transparent(0.5),
	light: color_1.Color.fromHex('#2677CB').transparent(0.18),
	hcDark: null,
	hcLight: color_1.Color.fromHex('#0F4A85').transparent(0.50)
}, (0, nls_1.localize)('editorDragAndDropBackground', "Background color when dragging editors around. The color should have transparency so that the editor contents can still shine through."));
exports.EDITOR_DROP_INTO_PROMPT_FOREGROUND = (0, colorRegistry_1.registerColor)('editorGroup.dropIntoPromptForeground', {
	dark: colorRegistry_1.editorWidgetForeground,
	light: colorRegistry_1.editorWidgetForeground,
	hcDark: colorRegistry_1.editorWidgetForeground,
	hcLight: colorRegistry_1.editorWidgetForeground
}, (0, nls_1.localize)('editorDropIntoPromptForeground', "Foreground color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor."));
exports.EDITOR_DROP_INTO_PROMPT_BACKGROUND = (0, colorRegistry_1.registerColor)('editorGroup.dropIntoPromptBackground', {
	dark: colorRegistry_1.editorWidgetBackground,
	light: colorRegistry_1.editorWidgetBackground,
	hcDark: colorRegistry_1.editorWidgetBackground,
	hcLight: colorRegistry_1.editorWidgetBackground
}, (0, nls_1.localize)('editorDropIntoPromptBackground', "Background color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor."));
exports.EDITOR_DROP_INTO_PROMPT_BORDER = (0, colorRegistry_1.registerColor)('editorGroup.dropIntoPromptBorder', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('editorDropIntoPromptBorder', "Border color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor."));
exports.SIDE_BY_SIDE_EDITOR_HORIZONTAL_BORDER = (0, colorRegistry_1.registerColor)('sideBySideEditor.horizontalBorder', {
	dark: exports.EDITOR_GROUP_BORDER,
	light: exports.EDITOR_GROUP_BORDER,
	hcDark: exports.EDITOR_GROUP_BORDER,
	hcLight: exports.EDITOR_GROUP_BORDER
}, (0, nls_1.localize)('sideBySideEditor.horizontalBorder', "Color to separate two editors from each other when shown side by side in an editor group from top to bottom."));
exports.SIDE_BY_SIDE_EDITOR_VERTICAL_BORDER = (0, colorRegistry_1.registerColor)('sideBySideEditor.verticalBorder', {
	dark: exports.EDITOR_GROUP_BORDER,
	light: exports.EDITOR_GROUP_BORDER,
	hcDark: exports.EDITOR_GROUP_BORDER,
	hcLight: exports.EDITOR_GROUP_BORDER
}, (0, nls_1.localize)('sideBySideEditor.verticalBorder', "Color to separate two editors from each other when shown side by side in an editor group from left to right."));
// < --- Panels --- >
exports.PANEL_BACKGROUND = (0, colorRegistry_1.registerColor)('panel.background', {
	dark: colorRegistry_1.editorBackground,
	light: colorRegistry_1.editorBackground,
	hcDark: colorRegistry_1.editorBackground,
	hcLight: colorRegistry_1.editorBackground
}, (0, nls_1.localize)('panelBackground', "Panel background color. Panels are shown below the editor area and contain views like output and integrated terminal."));
exports.PANEL_BORDER = (0, colorRegistry_1.registerColor)('panel.border', {
	dark: color_1.Color.fromHex('#808080').transparent(0.35),
	light: color_1.Color.fromHex('#808080').transparent(0.35),
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('panelBorder', "Panel border color to separate the panel from the editor. Panels are shown below the editor area and contain views like output and integrated terminal."));
exports.PANEL_ACTIVE_TITLE_FOREGROUND = (0, colorRegistry_1.registerColor)('panelTitle.activeForeground', {
	dark: '#E7E7E7',
	light: '#424242',
	hcDark: color_1.Color.white,
	hcLight: colorRegistry_1.editorForeground
}, (0, nls_1.localize)('panelActiveTitleForeground', "Title color for the active panel. Panels are shown below the editor area and contain views like output and integrated terminal."));
exports.PANEL_INACTIVE_TITLE_FOREGROUND = (0, colorRegistry_1.registerColor)('panelTitle.inactiveForeground', {
	dark: (0, colorRegistry_1.transparent)(exports.PANEL_ACTIVE_TITLE_FOREGROUND, 0.6),
	light: (0, colorRegistry_1.transparent)(exports.PANEL_ACTIVE_TITLE_FOREGROUND, 0.75),
	hcDark: color_1.Color.white,
	hcLight: colorRegistry_1.editorForeground
}, (0, nls_1.localize)('panelInactiveTitleForeground', "Title color for the inactive panel. Panels are shown below the editor area and contain views like output and integrated terminal."));
exports.PANEL_ACTIVE_TITLE_BORDER = (0, colorRegistry_1.registerColor)('panelTitle.activeBorder', {
	dark: exports.PANEL_ACTIVE_TITLE_FOREGROUND,
	light: exports.PANEL_ACTIVE_TITLE_FOREGROUND,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: '#B5200D'
}, (0, nls_1.localize)('panelActiveTitleBorder', "Border color for the active panel title. Panels are shown below the editor area and contain views like output and integrated terminal."));
exports.PANEL_INPUT_BORDER = (0, colorRegistry_1.registerColor)('panelInput.border', {
	dark: colorRegistry_1.inputBorder,
	light: color_1.Color.fromHex('#ddd'),
	hcDark: colorRegistry_1.inputBorder,
	hcLight: colorRegistry_1.inputBorder
}, (0, nls_1.localize)('panelInputBorder', "Input box border for inputs in the panel."));
exports.PANEL_DRAG_AND_DROP_BORDER = (0, colorRegistry_1.registerColor)('panel.dropBorder', {
	dark: exports.PANEL_ACTIVE_TITLE_FOREGROUND,
	light: exports.PANEL_ACTIVE_TITLE_FOREGROUND,
	hcDark: exports.PANEL_ACTIVE_TITLE_FOREGROUND,
	hcLight: exports.PANEL_ACTIVE_TITLE_FOREGROUND
}, (0, nls_1.localize)('panelDragAndDropBorder', "Drag and drop feedback color for the panel titles. Panels are shown below the editor area and contain views like output and integrated terminal."));
exports.PANEL_SECTION_DRAG_AND_DROP_BACKGROUND = (0, colorRegistry_1.registerColor)('panelSection.dropBackground', {
	dark: exports.EDITOR_DRAG_AND_DROP_BACKGROUND,
	light: exports.EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcDark: exports.EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcLight: exports.EDITOR_DRAG_AND_DROP_BACKGROUND
}, (0, nls_1.localize)('panelSectionDragAndDropBackground', "Drag and drop feedback color for the panel sections. The color should have transparency so that the panel sections can still shine through. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));
exports.PANEL_SECTION_HEADER_BACKGROUND = (0, colorRegistry_1.registerColor)('panelSectionHeader.background', {
	dark: color_1.Color.fromHex('#808080').transparent(0.2),
	light: color_1.Color.fromHex('#808080').transparent(0.2),
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('panelSectionHeaderBackground', "Panel section header background color. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));
exports.PANEL_SECTION_HEADER_FOREGROUND = (0, colorRegistry_1.registerColor)('panelSectionHeader.foreground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('panelSectionHeaderForeground', "Panel section header foreground color. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));
exports.PANEL_SECTION_HEADER_BORDER = (0, colorRegistry_1.registerColor)('panelSectionHeader.border', {
	dark: colorRegistry_1.contrastBorder,
	light: colorRegistry_1.contrastBorder,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('panelSectionHeaderBorder', "Panel section header border color used when multiple views are stacked vertically in the panel. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));
exports.PANEL_SECTION_BORDER = (0, colorRegistry_1.registerColor)('panelSection.border', {
	dark: exports.PANEL_BORDER,
	light: exports.PANEL_BORDER,
	hcDark: exports.PANEL_BORDER,
	hcLight: exports.PANEL_BORDER
}, (0, nls_1.localize)('panelSectionBorder', "Panel section border color used when multiple views are stacked horizontally in the panel. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));
// < --- Banner --- >
exports.BANNER_BACKGROUND = (0, colorRegistry_1.registerColor)('banner.background', {
	dark: colorRegistry_1.listActiveSelectionBackground,
	light: (0, colorRegistry_1.darken)(colorRegistry_1.listActiveSelectionBackground, 0.3),
	hcDark: colorRegistry_1.listActiveSelectionBackground,
	hcLight: colorRegistry_1.listActiveSelectionBackground
}, (0, nls_1.localize)('banner.background', "Banner background color. The banner is shown under the title bar of the window."));
exports.BANNER_FOREGROUND = (0, colorRegistry_1.registerColor)('banner.foreground', {
	dark: colorRegistry_1.listActiveSelectionForeground,
	light: colorRegistry_1.listActiveSelectionForeground,
	hcDark: colorRegistry_1.listActiveSelectionForeground,
	hcLight: colorRegistry_1.listActiveSelectionForeground
}, (0, nls_1.localize)('banner.foreground', "Banner foreground color. The banner is shown under the title bar of the window."));
exports.BANNER_ICON_FOREGROUND = (0, colorRegistry_1.registerColor)('banner.iconForeground', {
	dark: colorRegistry_1.editorInfoForeground,
	light: colorRegistry_1.editorInfoForeground,
	hcDark: colorRegistry_1.editorInfoForeground,
	hcLight: colorRegistry_1.editorInfoForeground
}, (0, nls_1.localize)('banner.iconForeground', "Banner icon color. The banner is shown under the title bar of the window."));
// < --- Status --- >
exports.STATUS_BAR_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBar.foreground', {
	dark: '#FFFFFF',
	light: '#FFFFFF',
	hcDark: '#FFFFFF',
	hcLight: colorRegistry_1.editorForeground
}, (0, nls_1.localize)('statusBarForeground', "Status bar foreground color when a workspace or folder is opened. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_NO_FOLDER_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBar.noFolderForeground', {
	dark: exports.STATUS_BAR_FOREGROUND,
	light: exports.STATUS_BAR_FOREGROUND,
	hcDark: exports.STATUS_BAR_FOREGROUND,
	hcLight: exports.STATUS_BAR_FOREGROUND
}, (0, nls_1.localize)('statusBarNoFolderForeground', "Status bar foreground color when no folder is opened. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBar.background', {
	dark: '#007ACC',
	light: '#007ACC',
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('statusBarBackground', "Status bar background color when a workspace or folder is opened. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_NO_FOLDER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBar.noFolderBackground', {
	dark: '#68217A',
	light: '#68217A',
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('statusBarNoFolderBackground', "Status bar background color when no folder is opened. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_BORDER = (0, colorRegistry_1.registerColor)('statusBar.border', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('statusBarBorder', "Status bar border color separating to the sidebar and editor. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_FOCUS_BORDER = (0, colorRegistry_1.registerColor)('statusBar.focusBorder', {
	dark: exports.STATUS_BAR_FOREGROUND,
	light: exports.STATUS_BAR_FOREGROUND,
	hcDark: null,
	hcLight: exports.STATUS_BAR_FOREGROUND
}, (0, nls_1.localize)('statusBarFocusBorder', "Status bar border color when focused on keyboard navigation. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_NO_FOLDER_BORDER = (0, colorRegistry_1.registerColor)('statusBar.noFolderBorder', {
	dark: exports.STATUS_BAR_BORDER,
	light: exports.STATUS_BAR_BORDER,
	hcDark: exports.STATUS_BAR_BORDER,
	hcLight: exports.STATUS_BAR_BORDER
}, (0, nls_1.localize)('statusBarNoFolderBorder', "Status bar border color separating to the sidebar and editor when no folder is opened. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ITEM_ACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.activeBackground', {
	dark: color_1.Color.white.transparent(0.18),
	light: color_1.Color.white.transparent(0.18),
	hcDark: color_1.Color.white.transparent(0.18),
	hcLight: color_1.Color.black.transparent(0.18)
}, (0, nls_1.localize)('statusBarItemActiveBackground', "Status bar item background color when clicking. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ITEM_FOCUS_BORDER = (0, colorRegistry_1.registerColor)('statusBarItem.focusBorder', {
	dark: exports.STATUS_BAR_FOREGROUND,
	light: exports.STATUS_BAR_FOREGROUND,
	hcDark: null,
	hcLight: colorRegistry_1.activeContrastBorder
}, (0, nls_1.localize)('statusBarItemFocusBorder', "Status bar item border color when focused on keyboard navigation. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ITEM_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.hoverBackground', {
	dark: color_1.Color.white.transparent(0.12),
	light: color_1.Color.white.transparent(0.12),
	hcDark: color_1.Color.white.transparent(0.12),
	hcLight: color_1.Color.black.transparent(0.12)
}, (0, nls_1.localize)('statusBarItemHoverBackground', "Status bar item background color when hovering. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ITEM_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.hoverForeground', {
	dark: exports.STATUS_BAR_FOREGROUND,
	light: exports.STATUS_BAR_FOREGROUND,
	hcDark: exports.STATUS_BAR_FOREGROUND,
	hcLight: exports.STATUS_BAR_FOREGROUND
}, (0, nls_1.localize)('statusBarItemHoverForeground', "Status bar item foreground color when hovering. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.compactHoverBackground', {
	dark: color_1.Color.white.transparent(0.20),
	light: color_1.Color.white.transparent(0.20),
	hcDark: color_1.Color.white.transparent(0.20),
	hcLight: color_1.Color.black.transparent(0.20)
}, (0, nls_1.localize)('statusBarItemCompactHoverBackground', "Status bar item background color when hovering an item that contains two hovers. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_PROMINENT_ITEM_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.prominentForeground', {
	dark: exports.STATUS_BAR_FOREGROUND,
	light: exports.STATUS_BAR_FOREGROUND,
	hcDark: exports.STATUS_BAR_FOREGROUND,
	hcLight: exports.STATUS_BAR_FOREGROUND
}, (0, nls_1.localize)('statusBarProminentItemForeground', "Status bar prominent items foreground color. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_PROMINENT_ITEM_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.prominentBackground', {
	dark: color_1.Color.black.transparent(0.5),
	light: color_1.Color.black.transparent(0.5),
	hcDark: color_1.Color.black.transparent(0.5),
	hcLight: color_1.Color.black.transparent(0.5),
}, (0, nls_1.localize)('statusBarProminentItemBackground', "Status bar prominent items background color. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_PROMINENT_ITEM_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.prominentHoverForeground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND
}, (0, nls_1.localize)('statusBarProminentItemHoverForeground', "Status bar prominent items foreground color when hovering. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_PROMINENT_ITEM_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.prominentHoverBackground', {
	dark: color_1.Color.black.transparent(0.3),
	light: color_1.Color.black.transparent(0.3),
	hcDark: color_1.Color.black.transparent(0.3),
	hcLight: null
}, (0, nls_1.localize)('statusBarProminentItemHoverBackground', "Status bar prominent items background color when hovering. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ERROR_ITEM_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.errorBackground', {
	dark: (0, colorRegistry_1.darken)(colorRegistry_1.errorForeground, .4),
	light: (0, colorRegistry_1.darken)(colorRegistry_1.errorForeground, .4),
	hcDark: null,
	hcLight: '#B5200D'
}, (0, nls_1.localize)('statusBarErrorItemBackground', "Status bar error items background color. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ERROR_ITEM_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.errorForeground', {
	dark: color_1.Color.white,
	light: color_1.Color.white,
	hcDark: color_1.Color.white,
	hcLight: color_1.Color.white
}, (0, nls_1.localize)('statusBarErrorItemForeground', "Status bar error items foreground color. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ERROR_ITEM_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.errorHoverForeground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND
}, (0, nls_1.localize)('statusBarErrorItemHoverForeground', "Status bar error items foreground color when hovering. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_ERROR_ITEM_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.errorHoverBackground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND
}, (0, nls_1.localize)('statusBarErrorItemHoverBackground', "Status bar error items background color when hovering. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_WARNING_ITEM_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.warningBackground', {
	dark: (0, colorRegistry_1.darken)(colorRegistry_1.editorWarningForeground, .4),
	light: (0, colorRegistry_1.darken)(colorRegistry_1.editorWarningForeground, .4),
	hcDark: null,
	hcLight: '#895503'
}, (0, nls_1.localize)('statusBarWarningItemBackground', "Status bar warning items background color. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_WARNING_ITEM_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.warningForeground', {
	dark: color_1.Color.white,
	light: color_1.Color.white,
	hcDark: color_1.Color.white,
	hcLight: color_1.Color.white
}, (0, nls_1.localize)('statusBarWarningItemForeground', "Status bar warning items foreground color. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_WARNING_ITEM_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.warningHoverForeground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND
}, (0, nls_1.localize)('statusBarWarningItemHoverForeground', "Status bar warning items foreground color when hovering. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));
exports.STATUS_BAR_WARNING_ITEM_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.warningHoverBackground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND
}, (0, nls_1.localize)('statusBarWarningItemHoverBackground', "Status bar warning items background color when hovering. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));
// < --- Activity Bar --- >
exports.ACTIVITY_BAR_BACKGROUND = (0, colorRegistry_1.registerColor)('activityBar.background', {
	dark: '#333333',
	light: '#2C2C2C',
	hcDark: '#000000',
	hcLight: '#FFFFFF'
}, (0, nls_1.localize)('activityBarBackground', "Activity bar background color. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_FOREGROUND = (0, colorRegistry_1.registerColor)('activityBar.foreground', {
	dark: color_1.Color.white,
	light: color_1.Color.white,
	hcDark: color_1.Color.white,
	hcLight: colorRegistry_1.editorForeground
}, (0, nls_1.localize)('activityBarForeground', "Activity bar item foreground color when it is active. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_INACTIVE_FOREGROUND = (0, colorRegistry_1.registerColor)('activityBar.inactiveForeground', {
	dark: (0, colorRegistry_1.transparent)(exports.ACTIVITY_BAR_FOREGROUND, 0.4),
	light: (0, colorRegistry_1.transparent)(exports.ACTIVITY_BAR_FOREGROUND, 0.4),
	hcDark: color_1.Color.white,
	hcLight: colorRegistry_1.editorForeground
}, (0, nls_1.localize)('activityBarInActiveForeground', "Activity bar item foreground color when it is inactive. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_BORDER = (0, colorRegistry_1.registerColor)('activityBar.border', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('activityBarBorder', "Activity bar border color separating to the side bar. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_ACTIVE_BORDER = (0, colorRegistry_1.registerColor)('activityBar.activeBorder', {
	dark: exports.ACTIVITY_BAR_FOREGROUND,
	light: exports.ACTIVITY_BAR_FOREGROUND,
	hcDark: null,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('activityBarActiveBorder', "Activity bar border color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_ACTIVE_FOCUS_BORDER = (0, colorRegistry_1.registerColor)('activityBar.activeFocusBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: '#B5200D'
}, (0, nls_1.localize)('activityBarActiveFocusBorder', "Activity bar focus border color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_ACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('activityBar.activeBackground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('activityBarActiveBackground', "Activity bar background color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_DRAG_AND_DROP_BORDER = (0, colorRegistry_1.registerColor)('activityBar.dropBorder', {
	dark: exports.ACTIVITY_BAR_FOREGROUND,
	light: exports.ACTIVITY_BAR_FOREGROUND,
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('activityBarDragAndDropBorder', "Drag and drop feedback color for the activity bar items. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_BADGE_BACKGROUND = (0, colorRegistry_1.registerColor)('activityBarBadge.background', {
	dark: '#007ACC',
	light: '#007ACC',
	hcDark: '#000000',
	hcLight: '#0F4A85'
}, (0, nls_1.localize)('activityBarBadgeBackground', "Activity notification badge background color. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
exports.ACTIVITY_BAR_BADGE_FOREGROUND = (0, colorRegistry_1.registerColor)('activityBarBadge.foreground', {
	dark: color_1.Color.white,
	light: color_1.Color.white,
	hcDark: color_1.Color.white,
	hcLight: color_1.Color.white
}, (0, nls_1.localize)('activityBarBadgeForeground', "Activity notification badge foreground color. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));
// < --- Profiles --- >
exports.PROFILE_BADGE_BACKGROUND = (0, colorRegistry_1.registerColor)('profileBadge.background', {
	dark: '#4D4D4D',
	light: '#C4C4C4',
	hcDark: color_1.Color.white,
	hcLight: color_1.Color.black
}, (0, nls_1.localize)('profileBadgeBackground', "Profile badge background color. The profile badge shows on top of the settings gear icon in the activity bar."));
exports.PROFILE_BADGE_FOREGROUND = (0, colorRegistry_1.registerColor)('profileBadge.foreground', {
	dark: color_1.Color.white,
	light: '#333333',
	hcDark: color_1.Color.black,
	hcLight: color_1.Color.white
}, (0, nls_1.localize)('profileBadgeForeground', "Profile badge foreground color. The profile badge shows on top of the settings gear icon in the activity bar."));
// < --- Remote --- >
exports.STATUS_BAR_REMOTE_ITEM_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.remoteBackground', {
	dark: exports.ACTIVITY_BAR_BADGE_BACKGROUND,
	light: exports.ACTIVITY_BAR_BADGE_BACKGROUND,
	hcDark: exports.ACTIVITY_BAR_BADGE_BACKGROUND,
	hcLight: exports.ACTIVITY_BAR_BADGE_BACKGROUND
}, (0, nls_1.localize)('statusBarItemHostBackground', "Background color for the remote indicator on the status bar."));
exports.STATUS_BAR_REMOTE_ITEM_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.remoteForeground', {
	dark: exports.ACTIVITY_BAR_BADGE_FOREGROUND,
	light: exports.ACTIVITY_BAR_BADGE_FOREGROUND,
	hcDark: exports.ACTIVITY_BAR_BADGE_FOREGROUND,
	hcLight: exports.ACTIVITY_BAR_BADGE_FOREGROUND
}, (0, nls_1.localize)('statusBarItemHostForeground', "Foreground color for the remote indicator on the status bar."));
exports.STATUS_BAR_REMOTE_ITEM_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.remoteHoverForeground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND
}, (0, nls_1.localize)('statusBarRemoteItemHoverForeground', "Foreground color for the remote indicator on the status bar when hovering."));
exports.STATUS_BAR_REMOTE_ITEM_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.remoteHoverBackground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: null
}, (0, nls_1.localize)('statusBarRemoteItemHoverBackground', "Background color for the remote indicator on the status bar when hovering."));
exports.STATUS_BAR_OFFLINE_ITEM_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.offlineBackground', {
	dark: '#6c1717',
	light: '#6c1717',
	hcDark: '#6c1717',
	hcLight: '#6c1717'
}, (0, nls_1.localize)('statusBarItemOfflineBackground', "Status bar item background color when the workbench is offline."));
exports.STATUS_BAR_OFFLINE_ITEM_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.offlineForeground', {
	dark: exports.STATUS_BAR_REMOTE_ITEM_FOREGROUND,
	light: exports.STATUS_BAR_REMOTE_ITEM_FOREGROUND,
	hcDark: exports.STATUS_BAR_REMOTE_ITEM_FOREGROUND,
	hcLight: exports.STATUS_BAR_REMOTE_ITEM_FOREGROUND
}, (0, nls_1.localize)('statusBarItemOfflineForeground', "Status bar item foreground color when the workbench is offline."));
exports.STATUS_BAR_OFFLINE_ITEM_HOVER_FOREGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.offlineHoverForeground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: exports.STATUS_BAR_ITEM_HOVER_FOREGROUND
}, (0, nls_1.localize)('statusBarOfflineItemHoverForeground', "Status bar item foreground hover color when the workbench is offline."));
exports.STATUS_BAR_OFFLINE_ITEM_HOVER_BACKGROUND = (0, colorRegistry_1.registerColor)('statusBarItem.offlineHoverBackground', {
	dark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: exports.STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: null
}, (0, nls_1.localize)('statusBarOfflineItemHoverBackground', "Status bar item background hover color when the workbench is offline."));
exports.EXTENSION_BADGE_REMOTE_BACKGROUND = (0, colorRegistry_1.registerColor)('extensionBadge.remoteBackground', {
	dark: exports.ACTIVITY_BAR_BADGE_BACKGROUND,
	light: exports.ACTIVITY_BAR_BADGE_BACKGROUND,
	hcDark: exports.ACTIVITY_BAR_BADGE_BACKGROUND,
	hcLight: exports.ACTIVITY_BAR_BADGE_BACKGROUND
}, (0, nls_1.localize)('extensionBadge.remoteBackground', "Background color for the remote badge in the extensions view."));
exports.EXTENSION_BADGE_REMOTE_FOREGROUND = (0, colorRegistry_1.registerColor)('extensionBadge.remoteForeground', {
	dark: exports.ACTIVITY_BAR_BADGE_FOREGROUND,
	light: exports.ACTIVITY_BAR_BADGE_FOREGROUND,
	hcDark: exports.ACTIVITY_BAR_BADGE_FOREGROUND,
	hcLight: exports.ACTIVITY_BAR_BADGE_FOREGROUND
}, (0, nls_1.localize)('extensionBadge.remoteForeground', "Foreground color for the remote badge in the extensions view."));
// < --- Side Bar --- >
exports.SIDE_BAR_BACKGROUND = (0, colorRegistry_1.registerColor)('sideBar.background', {
	dark: '#252526',
	light: '#F3F3F3',
	hcDark: '#000000',
	hcLight: '#FFFFFF'
}, (0, nls_1.localize)('sideBarBackground', "Side bar background color. The side bar is the container for views like explorer and search."));
exports.SIDE_BAR_FOREGROUND = (0, colorRegistry_1.registerColor)('sideBar.foreground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('sideBarForeground', "Side bar foreground color. The side bar is the container for views like explorer and search."));
exports.SIDE_BAR_BORDER = (0, colorRegistry_1.registerColor)('sideBar.border', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('sideBarBorder', "Side bar border color on the side separating to the editor. The side bar is the container for views like explorer and search."));
exports.SIDE_BAR_TITLE_FOREGROUND = (0, colorRegistry_1.registerColor)('sideBarTitle.foreground', {
	dark: exports.SIDE_BAR_FOREGROUND,
	light: exports.SIDE_BAR_FOREGROUND,
	hcDark: exports.SIDE_BAR_FOREGROUND,
	hcLight: exports.SIDE_BAR_FOREGROUND
}, (0, nls_1.localize)('sideBarTitleForeground', "Side bar title foreground color. The side bar is the container for views like explorer and search."));
exports.SIDE_BAR_DRAG_AND_DROP_BACKGROUND = (0, colorRegistry_1.registerColor)('sideBar.dropBackground', {
	dark: exports.EDITOR_DRAG_AND_DROP_BACKGROUND,
	light: exports.EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcDark: exports.EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcLight: exports.EDITOR_DRAG_AND_DROP_BACKGROUND
}, (0, nls_1.localize)('sideBarDragAndDropBackground', "Drag and drop feedback color for the side bar sections. The color should have transparency so that the side bar sections can still shine through. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));
exports.SIDE_BAR_SECTION_HEADER_BACKGROUND = (0, colorRegistry_1.registerColor)('sideBarSectionHeader.background', {
	dark: color_1.Color.fromHex('#808080').transparent(0.2),
	light: color_1.Color.fromHex('#808080').transparent(0.2),
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('sideBarSectionHeaderBackground', "Side bar section header background color. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));
exports.SIDE_BAR_SECTION_HEADER_FOREGROUND = (0, colorRegistry_1.registerColor)('sideBarSectionHeader.foreground', {
	dark: exports.SIDE_BAR_FOREGROUND,
	light: exports.SIDE_BAR_FOREGROUND,
	hcDark: exports.SIDE_BAR_FOREGROUND,
	hcLight: exports.SIDE_BAR_FOREGROUND
}, (0, nls_1.localize)('sideBarSectionHeaderForeground', "Side bar section header foreground color. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));
exports.SIDE_BAR_SECTION_HEADER_BORDER = (0, colorRegistry_1.registerColor)('sideBarSectionHeader.border', {
	dark: colorRegistry_1.contrastBorder,
	light: colorRegistry_1.contrastBorder,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('sideBarSectionHeaderBorder', "Side bar section header border color. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));
// < --- Title Bar --- >
exports.TITLE_BAR_ACTIVE_FOREGROUND = (0, colorRegistry_1.registerColor)('titleBar.activeForeground', {
	dark: '#CCCCCC',
	light: '#333333',
	hcDark: '#FFFFFF',
	hcLight: '#292929'
}, (0, nls_1.localize)('titleBarActiveForeground', "Title bar foreground when the window is active."));
exports.TITLE_BAR_INACTIVE_FOREGROUND = (0, colorRegistry_1.registerColor)('titleBar.inactiveForeground', {
	dark: (0, colorRegistry_1.transparent)(exports.TITLE_BAR_ACTIVE_FOREGROUND, 0.6),
	light: (0, colorRegistry_1.transparent)(exports.TITLE_BAR_ACTIVE_FOREGROUND, 0.6),
	hcDark: null,
	hcLight: '#292929'
}, (0, nls_1.localize)('titleBarInactiveForeground', "Title bar foreground when the window is inactive."));
exports.TITLE_BAR_ACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('titleBar.activeBackground', {
	dark: '#3C3C3C',
	light: '#DDDDDD',
	hcDark: '#000000',
	hcLight: '#FFFFFF'
}, (0, nls_1.localize)('titleBarActiveBackground', "Title bar background when the window is active."));
exports.TITLE_BAR_INACTIVE_BACKGROUND = (0, colorRegistry_1.registerColor)('titleBar.inactiveBackground', {
	dark: (0, colorRegistry_1.transparent)(exports.TITLE_BAR_ACTIVE_BACKGROUND, 0.6),
	light: (0, colorRegistry_1.transparent)(exports.TITLE_BAR_ACTIVE_BACKGROUND, 0.6),
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('titleBarInactiveBackground', "Title bar background when the window is inactive."));
exports.TITLE_BAR_BORDER = (0, colorRegistry_1.registerColor)('titleBar.border', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('titleBarBorder', "Title bar border color."));
// < --- Menubar --- >
exports.MENUBAR_SELECTION_FOREGROUND = (0, colorRegistry_1.registerColor)('menubar.selectionForeground', {
	dark: exports.TITLE_BAR_ACTIVE_FOREGROUND,
	light: exports.TITLE_BAR_ACTIVE_FOREGROUND,
	hcDark: exports.TITLE_BAR_ACTIVE_FOREGROUND,
	hcLight: exports.TITLE_BAR_ACTIVE_FOREGROUND,
}, (0, nls_1.localize)('menubarSelectionForeground', "Foreground color of the selected menu item in the menubar."));
exports.MENUBAR_SELECTION_BACKGROUND = (0, colorRegistry_1.registerColor)('menubar.selectionBackground', {
	dark: colorRegistry_1.toolbarHoverBackground,
	light: colorRegistry_1.toolbarHoverBackground,
	hcDark: null,
	hcLight: null,
}, (0, nls_1.localize)('menubarSelectionBackground', "Background color of the selected menu item in the menubar."));
exports.MENUBAR_SELECTION_BORDER = (0, colorRegistry_1.registerColor)('menubar.selectionBorder', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.activeContrastBorder,
	hcLight: colorRegistry_1.activeContrastBorder,
}, (0, nls_1.localize)('menubarSelectionBorder', "Border color of the selected menu item in the menubar."));
// < --- Notifications --- >
exports.NOTIFICATIONS_CENTER_BORDER = (0, colorRegistry_1.registerColor)('notificationCenter.border', {
	dark: colorRegistry_1.widgetBorder,
	light: colorRegistry_1.widgetBorder,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('notificationCenterBorder', "Notifications center border color. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_TOAST_BORDER = (0, colorRegistry_1.registerColor)('notificationToast.border', {
	dark: colorRegistry_1.widgetBorder,
	light: colorRegistry_1.widgetBorder,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('notificationToastBorder', "Notification toast border color. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_FOREGROUND = (0, colorRegistry_1.registerColor)('notifications.foreground', {
	dark: colorRegistry_1.editorWidgetForeground,
	light: colorRegistry_1.editorWidgetForeground,
	hcDark: colorRegistry_1.editorWidgetForeground,
	hcLight: colorRegistry_1.editorWidgetForeground
}, (0, nls_1.localize)('notificationsForeground', "Notifications foreground color. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_BACKGROUND = (0, colorRegistry_1.registerColor)('notifications.background', {
	dark: colorRegistry_1.editorWidgetBackground,
	light: colorRegistry_1.editorWidgetBackground,
	hcDark: colorRegistry_1.editorWidgetBackground,
	hcLight: colorRegistry_1.editorWidgetBackground
}, (0, nls_1.localize)('notificationsBackground', "Notifications background color. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_LINKS = (0, colorRegistry_1.registerColor)('notificationLink.foreground', {
	dark: colorRegistry_1.textLinkForeground,
	light: colorRegistry_1.textLinkForeground,
	hcDark: colorRegistry_1.textLinkForeground,
	hcLight: colorRegistry_1.textLinkForeground
}, (0, nls_1.localize)('notificationsLink', "Notification links foreground color. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_CENTER_HEADER_FOREGROUND = (0, colorRegistry_1.registerColor)('notificationCenterHeader.foreground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('notificationCenterHeaderForeground', "Notifications center header foreground color. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_CENTER_HEADER_BACKGROUND = (0, colorRegistry_1.registerColor)('notificationCenterHeader.background', {
	dark: (0, colorRegistry_1.lighten)(exports.NOTIFICATIONS_BACKGROUND, 0.3),
	light: (0, colorRegistry_1.darken)(exports.NOTIFICATIONS_BACKGROUND, 0.05),
	hcDark: exports.NOTIFICATIONS_BACKGROUND,
	hcLight: exports.NOTIFICATIONS_BACKGROUND
}, (0, nls_1.localize)('notificationCenterHeaderBackground', "Notifications center header background color. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_BORDER = (0, colorRegistry_1.registerColor)('notifications.border', {
	dark: exports.NOTIFICATIONS_CENTER_HEADER_BACKGROUND,
	light: exports.NOTIFICATIONS_CENTER_HEADER_BACKGROUND,
	hcDark: exports.NOTIFICATIONS_CENTER_HEADER_BACKGROUND,
	hcLight: exports.NOTIFICATIONS_CENTER_HEADER_BACKGROUND
}, (0, nls_1.localize)('notificationsBorder', "Notifications border color separating from other notifications in the notifications center. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_ERROR_ICON_FOREGROUND = (0, colorRegistry_1.registerColor)('notificationsErrorIcon.foreground', {
	dark: colorRegistry_1.editorErrorForeground,
	light: colorRegistry_1.editorErrorForeground,
	hcDark: colorRegistry_1.editorErrorForeground,
	hcLight: colorRegistry_1.editorErrorForeground
}, (0, nls_1.localize)('notificationsErrorIconForeground', "The color used for the icon of error notifications. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_WARNING_ICON_FOREGROUND = (0, colorRegistry_1.registerColor)('notificationsWarningIcon.foreground', {
	dark: colorRegistry_1.editorWarningForeground,
	light: colorRegistry_1.editorWarningForeground,
	hcDark: colorRegistry_1.editorWarningForeground,
	hcLight: colorRegistry_1.editorWarningForeground
}, (0, nls_1.localize)('notificationsWarningIconForeground', "The color used for the icon of warning notifications. Notifications slide in from the bottom right of the window."));
exports.NOTIFICATIONS_INFO_ICON_FOREGROUND = (0, colorRegistry_1.registerColor)('notificationsInfoIcon.foreground', {
	dark: colorRegistry_1.editorInfoForeground,
	light: colorRegistry_1.editorInfoForeground,
	hcDark: colorRegistry_1.editorInfoForeground,
	hcLight: colorRegistry_1.editorInfoForeground
}, (0, nls_1.localize)('notificationsInfoIconForeground', "The color used for the icon of info notifications. Notifications slide in from the bottom right of the window."));
exports.WINDOW_ACTIVE_BORDER = (0, colorRegistry_1.registerColor)('window.activeBorder', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('windowActiveBorder', "The color used for the border of the window when it is active. Only supported in the macOS and Linux desktop client when using the custom title bar."));
exports.WINDOW_INACTIVE_BORDER = (0, colorRegistry_1.registerColor)('window.inactiveBorder', {
	dark: null,
	light: null,
	hcDark: colorRegistry_1.contrastBorder,
	hcLight: colorRegistry_1.contrastBorder
}, (0, nls_1.localize)('windowInactiveBorder', "The color used for the border of the window when it is inactive. Only supported in the macOS and Linux desktop client when using the custom title bar."));
// < --- Card --- >
exports.CARD_OVERLAY_FOREGROUND = (0, colorRegistry_1.registerColor)('card.overlayForeground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, (0, nls_1.localize)('cardOverlayForeground', "The card overlay foreground color."));
exports.CARD_OVERLAY_BACKGROUND = (0, colorRegistry_1.registerColor)('card.overlayBackground', {
	dark: '#252526',
	light: '#F3F3F3',
	hcDark: '#000000',
	hcLight: '#FFFFFF',
}, (0, nls_1.localize)('cardOverlayBackground', "The card overlay background color."));
