"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.WindowMinimumSize = void 0;
exports.isWorkspaceToOpen = isWorkspaceToOpen;
exports.isFolderToOpen = isFolderToOpen;
exports.isFileToOpen = isFileToOpen;
exports.getMenuBarVisibility = getMenuBarVisibility;
exports.getTitleBarStyle = getTitleBarStyle;
exports.useWindowControlsOverlay = useWindowControlsOverlay;
exports.zoomLevelToZoomFactor = zoomLevelToZoomFactor;
const platform_1 = require("vs/base/common/platform");
exports.WindowMinimumSize = {
	WIDTH: 400,
	WIDTH_WITH_VERTICAL_PANEL: 600,
	HEIGHT: 270
};
function isWorkspaceToOpen(uriToOpen) {
	return !!uriToOpen.workspaceUri;
}
function isFolderToOpen(uriToOpen) {
	return !!uriToOpen.folderUri;
}
function isFileToOpen(uriToOpen) {
	return !!uriToOpen.fileUri;
}
function getMenuBarVisibility(configurationService) {
	const titleBarStyle = getTitleBarStyle(configurationService);
	const menuBarVisibility = configurationService.getValue('window.menuBarVisibility');
	if (menuBarVisibility === 'default' || (titleBarStyle === 'native' && menuBarVisibility === 'compact') || (platform_1.isMacintosh && platform_1.isNative)) {
		return 'classic';
	}
	else {
		return menuBarVisibility;
	}
}
function getTitleBarStyle(configurationService) {
	if (platform_1.isWeb) {
		return 'custom';
	}
	const configuration = configurationService.getValue('window');
	if (configuration) {
		const useNativeTabs = platform_1.isMacintosh && configuration.nativeTabs === true;
		if (useNativeTabs) {
			return 'native'; // native tabs on sierra do not work with custom title style
		}
		const useSimpleFullScreen = platform_1.isMacintosh && configuration.nativeFullScreen === false;
		if (useSimpleFullScreen) {
			return 'native'; // simple fullscreen does not work well with custom title style (https://github.com/microsoft/vscode/issues/63291)
		}
		const style = configuration.titleBarStyle;
		if (style === 'native' || style === 'custom') {
			return style;
		}
	}
	return platform_1.isLinux ? 'native' : 'custom'; // default to custom on all macOS and Windows
}
function useWindowControlsOverlay(configurationService) {
	if (!platform_1.isWindows || platform_1.isWeb) {
		return false; // only supported on a desktop Windows instance
	}
	if (getTitleBarStyle(configurationService) === 'native') {
		return false; // only supported when title bar is custom
	}
	// Default to true.
	return true;
}
/**
 * According to Electron docs: `scale := 1.2 ^ level`.
 * https://github.com/electron/electron/blob/master/docs/api/web-contents.md#contentssetzoomlevellevel
 */
function zoomLevelToZoomFactor(zoomLevel = 0) {
	return Math.pow(1.2, zoomLevel);
}
