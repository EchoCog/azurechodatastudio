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
exports.notebookMultipleRequestsError = exports.RESULTS_GRID_DEFAULTS = exports.NBFORMAT_MINOR = exports.NBFORMAT = exports.DEFAULT_NOTEBOOK_FILETYPE = exports.CELL_URI_PATH_PREFIX = exports.TSGOPS_WEB_QUALITY = exports.IPYKERNEL_DISPLAY_NAME = exports.VSCODE_JUPYTER_PROVIDER_ID = exports.JUPYTER_PROVIDER_ID = exports.RESOURCE_VIEWER_TYPEID = exports.FILE_QUERY_EDITOR_TYPEID = exports.UNTITLED_QUERY_EDITOR_TYPEID = exports.UNTITLED_NOTEBOOK_TYPEID = exports.SearchInputBoxFocusedKey = exports.InputBoxFocusedKey = exports.SearchViewFocusedKey = exports.CONFIG_WORKBENCH_USEVSCODENOTEBOOKS = exports.CONFIG_WORKBENCH_ENABLEPREVIEWFEATURES = exports.AddCursorsAtSearchResults = exports.ToggleRegexCommandId = exports.ToggleWholeWordCommandId = exports.ToggleCaseSensitiveCommandId = exports.FocusSearchListCommandID = exports.ClearSearchHistoryCommandId = exports.OpenInEditorCommandId = exports.CopyAllCommandId = exports.CopyMatchCommandId = exports.CopyPathCommandId = exports.RemoveActionId = exports.CancelActionId = exports.OpenMatchToSide = exports.FocusSearchFromResults = exports.FocusActiveEditorCommandId = exports.FindInNotebooksActionId = void 0;
const contextkey_1 = require("vs/platform/contextkey/common/contextkey");
const nls = __importStar(require("vs/nls"));
exports.FindInNotebooksActionId = 'workbench.action.findInNotebooks';
exports.FocusActiveEditorCommandId = 'notebookSearch.action.focusActiveEditor';
exports.FocusSearchFromResults = 'notebookSearch.action.focusSearchFromResults';
exports.OpenMatchToSide = 'notebookSearch.action.openResultToSide';
exports.CancelActionId = 'notebookSearch.action.cancel';
exports.RemoveActionId = 'notebookSearch.action.remove';
exports.CopyPathCommandId = 'notebookSearch.action.copyPath';
exports.CopyMatchCommandId = 'notebookSearch.action.copyMatch';
exports.CopyAllCommandId = 'notebookSearch.action.copyAll';
exports.OpenInEditorCommandId = 'notebookSearch.action.openInEditor';
exports.ClearSearchHistoryCommandId = 'notebookSearch.action.clearHistory';
exports.FocusSearchListCommandID = 'notebookSearch.action.focusSearchList';
exports.ToggleCaseSensitiveCommandId = 'toggleSearchCaseSensitive';
exports.ToggleWholeWordCommandId = 'toggleSearchWholeWord';
exports.ToggleRegexCommandId = 'toggleSearchRegex';
exports.AddCursorsAtSearchResults = 'addCursorsAtSearchResults';
exports.CONFIG_WORKBENCH_ENABLEPREVIEWFEATURES = 'workbench.enablePreviewFeatures';
exports.CONFIG_WORKBENCH_USEVSCODENOTEBOOKS = 'workbench.useVSCodeNotebooks';
exports.SearchViewFocusedKey = new contextkey_1.RawContextKey('notebookSearchViewletFocus', false);
exports.InputBoxFocusedKey = new contextkey_1.RawContextKey('inputBoxFocus', false);
exports.SearchInputBoxFocusedKey = new contextkey_1.RawContextKey('searchInputBoxFocus', false);
// !! Do not change these or updates won't be able to deserialize editors correctly !!
exports.UNTITLED_NOTEBOOK_TYPEID = 'workbench.editorinputs.untitledNotebookInput';
exports.UNTITLED_QUERY_EDITOR_TYPEID = 'workbench.editorInput.untitledQueryInput';
exports.FILE_QUERY_EDITOR_TYPEID = 'workbench.editorInput.fileQueryInput';
exports.RESOURCE_VIEWER_TYPEID = 'workbench.editorInput.resourceViewerInput';
exports.JUPYTER_PROVIDER_ID = 'jupyter';
exports.VSCODE_JUPYTER_PROVIDER_ID = 'jupyter-notebook';
exports.IPYKERNEL_DISPLAY_NAME = 'Python 3 (ipykernel)';
exports.TSGOPS_WEB_QUALITY = 'tsgops-image';
exports.CELL_URI_PATH_PREFIX = 'notebook-editor-';
exports.DEFAULT_NOTEBOOK_FILETYPE = '.ipynb';
// The version of the notebook file format that we support
exports.NBFORMAT = 4;
exports.NBFORMAT_MINOR = 2;
exports.RESULTS_GRID_DEFAULTS = {
    cellPadding: [5, 8, 4],
    rowHeight: 24
};
exports.notebookMultipleRequestsError = nls.localize('notebookMultipleRequestsError', "Cannot execute code cell. Another cell is currently being executed.");
