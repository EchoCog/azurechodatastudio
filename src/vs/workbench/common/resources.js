"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ResourceGlobMatcher_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceGlobMatcher = void 0;
const uri_1 = require("vs/base/common/uri");
const objects_1 = require("vs/base/common/objects");
const path_1 = require("vs/base/common/path");
const event_1 = require("vs/base/common/event");
const resources_1 = require("vs/base/common/resources");
const lifecycle_1 = require("vs/base/common/lifecycle");
const glob_1 = require("vs/base/common/glob");
const workspace_1 = require("vs/platform/workspace/common/workspace");
const configuration_1 = require("vs/platform/configuration/common/configuration");
const network_1 = require("vs/base/common/network");
const map_1 = require("vs/base/common/map");
const extpath_1 = require("vs/base/common/extpath");
let ResourceGlobMatcher = class ResourceGlobMatcher extends lifecycle_1.Disposable {
    static { ResourceGlobMatcher_1 = this; }
    getExpression;
    shouldUpdate;
    contextService;
    configurationService;
    static NO_FOLDER = null;
    _onExpressionChange = this._register(new event_1.Emitter());
    onExpressionChange = this._onExpressionChange.event;
    mapFolderToParsedExpression = new Map();
    mapFolderToConfiguredExpression = new Map();
    constructor(getExpression, shouldUpdate, contextService, configurationService) {
        super();
        this.getExpression = getExpression;
        this.shouldUpdate = shouldUpdate;
        this.contextService = contextService;
        this.configurationService = configurationService;
        this.updateExpressions(false);
        this.registerListeners();
    }
    registerListeners() {
        this._register(this.configurationService.onDidChangeConfiguration(e => {
            if (this.shouldUpdate(e)) {
                this.updateExpressions(true);
            }
        }));
        this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.updateExpressions(true)));
    }
    updateExpressions(fromEvent) {
        let changed = false;
        // Add expressions per workspaces that got added
        for (const folder of this.contextService.getWorkspace().folders) {
            const folderUriStr = folder.uri.toString();
            const newExpression = this.doGetExpression(folder.uri);
            const currentExpression = this.mapFolderToConfiguredExpression.get(folderUriStr);
            if (newExpression) {
                if (!currentExpression || !(0, objects_1.equals)(currentExpression.expression, newExpression.expression)) {
                    changed = true;
                    this.mapFolderToParsedExpression.set(folderUriStr, (0, glob_1.parse)(newExpression.expression));
                    this.mapFolderToConfiguredExpression.set(folderUriStr, newExpression);
                }
            }
            else {
                if (currentExpression) {
                    changed = true;
                    this.mapFolderToParsedExpression.delete(folderUriStr);
                    this.mapFolderToConfiguredExpression.delete(folderUriStr);
                }
            }
        }
        // Remove expressions per workspace no longer present
        const foldersMap = new map_1.ResourceSet(this.contextService.getWorkspace().folders.map(folder => folder.uri));
        for (const [folder] of this.mapFolderToConfiguredExpression) {
            if (folder === ResourceGlobMatcher_1.NO_FOLDER) {
                continue; // always keep this one
            }
            if (!foldersMap.has(uri_1.URI.parse(folder))) {
                this.mapFolderToParsedExpression.delete(folder);
                this.mapFolderToConfiguredExpression.delete(folder);
                changed = true;
            }
        }
        // Always set for resources outside workspace as well
        const globalNewExpression = this.doGetExpression(undefined);
        const globalCurrentExpression = this.mapFolderToConfiguredExpression.get(ResourceGlobMatcher_1.NO_FOLDER);
        if (globalNewExpression) {
            if (!globalCurrentExpression || !(0, objects_1.equals)(globalCurrentExpression.expression, globalNewExpression.expression)) {
                changed = true;
                this.mapFolderToParsedExpression.set(ResourceGlobMatcher_1.NO_FOLDER, (0, glob_1.parse)(globalNewExpression.expression));
                this.mapFolderToConfiguredExpression.set(ResourceGlobMatcher_1.NO_FOLDER, globalNewExpression);
            }
        }
        else {
            if (globalCurrentExpression) {
                changed = true;
                this.mapFolderToParsedExpression.delete(ResourceGlobMatcher_1.NO_FOLDER);
                this.mapFolderToConfiguredExpression.delete(ResourceGlobMatcher_1.NO_FOLDER);
            }
        }
        if (fromEvent && changed) {
            this._onExpressionChange.fire();
        }
    }
    doGetExpression(resource) {
        const expression = this.getExpression(resource);
        if (!expression) {
            return undefined;
        }
        const keys = Object.keys(expression);
        if (keys.length === 0) {
            return undefined;
        }
        let hasAbsolutePath = false;
        // Check the expression for absolute paths/globs
        // and specifically for Windows, make sure the
        // drive letter is lowercased, because we later
        // check with `URI.fsPath` which is always putting
        // the drive letter lowercased.
        const massagedExpression = Object.create(null);
        for (const key of keys) {
            if (!hasAbsolutePath) {
                hasAbsolutePath = (0, path_1.isAbsolute)(key);
            }
            let massagedKey = key;
            const driveLetter = (0, extpath_1.getDriveLetter)(massagedKey, true /* probe for windows */);
            if (driveLetter) {
                const driveLetterLower = driveLetter.toLowerCase();
                if (driveLetter !== driveLetter.toLowerCase()) {
                    massagedKey = `${driveLetterLower}${massagedKey.substring(1)}`;
                }
            }
            massagedExpression[massagedKey] = expression[key];
        }
        return {
            expression: massagedExpression,
            hasAbsolutePath
        };
    }
    matches(resource, hasSibling) {
        if (this.mapFolderToParsedExpression.size === 0) {
            return false; // return early: no expression for this matcher
        }
        const folder = this.contextService.getWorkspaceFolder(resource);
        let expressionForFolder;
        let expressionConfigForFolder;
        if (folder && this.mapFolderToParsedExpression.has(folder.uri.toString())) {
            expressionForFolder = this.mapFolderToParsedExpression.get(folder.uri.toString());
            expressionConfigForFolder = this.mapFolderToConfiguredExpression.get(folder.uri.toString());
        }
        else {
            expressionForFolder = this.mapFolderToParsedExpression.get(ResourceGlobMatcher_1.NO_FOLDER);
            expressionConfigForFolder = this.mapFolderToConfiguredExpression.get(ResourceGlobMatcher_1.NO_FOLDER);
        }
        if (!expressionForFolder) {
            return false; // return early: no expression for this resource
        }
        // If the resource if from a workspace, convert its absolute path to a relative
        // path so that glob patterns have a higher probability to match. For example
        // a glob pattern of "src/**" will not match on an absolute path "/folder/src/file.txt"
        // but can match on "src/file.txt"
        let resourcePathToMatch;
        if (folder) {
            resourcePathToMatch = (0, resources_1.relativePath)(folder.uri, resource);
        }
        else {
            resourcePathToMatch = this.uriToPath(resource);
        }
        if (typeof resourcePathToMatch === 'string' && !!expressionForFolder(resourcePathToMatch, undefined, hasSibling)) {
            return true;
        }
        // If the configured expression has an absolute path, we also check for absolute paths
        // to match, otherwise we potentially miss out on matches. We only do that if we previously
        // matched on the relative path.
        if (resourcePathToMatch !== this.uriToPath(resource) && expressionConfigForFolder?.hasAbsolutePath) {
            return !!expressionForFolder(this.uriToPath(resource), undefined, hasSibling);
        }
        return false;
    }
    uriToPath(uri) {
        if (uri.scheme === network_1.Schemas.file) {
            return uri.fsPath;
        }
        return uri.path;
    }
};
exports.ResourceGlobMatcher = ResourceGlobMatcher;
exports.ResourceGlobMatcher = ResourceGlobMatcher = ResourceGlobMatcher_1 = __decorate([
    __param(2, workspace_1.IWorkspaceContextService),
    __param(3, configuration_1.IConfigurationService)
], ResourceGlobMatcher);
