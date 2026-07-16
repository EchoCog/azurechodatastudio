"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_EDITOR_PART_OPTIONS = exports.DEFAULT_EDITOR_MAX_DIMENSIONS = exports.DEFAULT_EDITOR_MIN_DIMENSIONS = void 0;
exports.impactsEditorPartOptions = impactsEditorPartOptions;
exports.getEditorPartOptions = getEditorPartOptions;
exports.fillActiveEditorViewState = fillActiveEditorViewState;
const dom_1 = require("vs/base/browser/dom");
const types_1 = require("vs/base/common/types");
exports.DEFAULT_EDITOR_MIN_DIMENSIONS = new dom_1.Dimension(220, 70);
exports.DEFAULT_EDITOR_MAX_DIMENSIONS = new dom_1.Dimension(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
exports.DEFAULT_EDITOR_PART_OPTIONS = {
	showTabs: true,
	highlightModifiedTabs: false,
	tabCloseButton: 'right',
	tabSizing: 'fit',
	tabSizingFixedMinWidth: 50,
	tabSizingFixedMaxWidth: 160,
	pinnedTabSizing: 'normal',
	preventPinnedEditorClose: 'keyboardAndMouse',
	titleScrollbarSizing: 'default',
	focusRecentEditorAfterClose: true,
	showIcons: true,
	hasIcons: true, // 'vs-seti' is our default icon theme
	enablePreview: true,
	openPositioning: 'right',
	openSideBySideDirection: 'right',
	closeEmptyGroups: true,
	labelFormat: 'default',
	splitSizing: 'auto',
	splitOnDragAndDrop: true,
	centeredLayoutFixedWidth: false,
	doubleClickTabToToggleEditorGroupSizes: true,
};
function impactsEditorPartOptions(event) {
	return event.affectsConfiguration('workbench.editor') || event.affectsConfiguration('workbench.iconTheme');
}
function getEditorPartOptions(configurationService, themeService) {
	const options = {
		...exports.DEFAULT_EDITOR_PART_OPTIONS,
		hasIcons: themeService.getFileIconTheme().hasFileIcons
	};
	const config = configurationService.getValue();
	if (config?.workbench?.editor) {
		// Assign all primitive configuration over
		Object.assign(options, config.workbench.editor);
		// Special handle array types and convert to Set
		if ((0, types_1.isObject)(config.workbench.editor.autoLockGroups)) {
			options.autoLockGroups = new Set();
			for (const [editorId, enablement] of Object.entries(config.workbench.editor.autoLockGroups)) {
				if (enablement === true) {
					options.autoLockGroups.add(editorId);
				}
			}
		}
		else {
			options.autoLockGroups = undefined;
		}
	}
	return options;
}
function fillActiveEditorViewState(group, expectedActiveEditor, presetOptions) {
	if (!expectedActiveEditor || !group.activeEditor || expectedActiveEditor.matches(group.activeEditor)) {
		const options = {
			...presetOptions,
			viewState: group.activeEditorPane?.getViewState()
		};
		return options;
	}
	return presetOptions || Object.create(null);
}
