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
var FilesConfigurationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilesConfigurationService = exports.IFilesConfigurationService = exports.AutoSaveAfterShortDelayContext = void 0;
const nls_1 = require("vs/nls");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const extensions_1 = require("vs/platform/instantiation/common/extensions");
const event_1 = require("vs/base/common/event");
const lifecycle_1 = require("vs/base/common/lifecycle");
const contextkey_1 = require("vs/platform/contextkey/common/contextkey");
const configuration_1 = require("vs/platform/configuration/common/configuration");
const files_1 = require("vs/platform/files/common/files");
const objects_1 = require("vs/base/common/objects");
const platform_1 = require("vs/base/common/platform");
const workspace_1 = require("vs/platform/workspace/common/workspace");
const resources_1 = require("vs/workbench/common/resources");
const async_1 = require("vs/base/common/async");
const uriIdentity_1 = require("vs/platform/uriIdentity/common/uriIdentity");
const environment_1 = require("vs/platform/environment/common/environment");
const map_1 = require("vs/base/common/map");
exports.AutoSaveAfterShortDelayContext = new contextkey_1.RawContextKey('autoSaveAfterShortDelayContext', false, true);
exports.IFilesConfigurationService = (0, instantiation_1.createDecorator)('filesConfigurationService');
let FilesConfigurationService = class FilesConfigurationService extends lifecycle_1.Disposable {
    static { FilesConfigurationService_1 = this; }
    configurationService;
    contextService;
    environmentService;
    uriIdentityService;
    fileService;
    static DEFAULT_AUTO_SAVE_MODE = platform_1.isWeb ? files_1.AutoSaveConfiguration.AFTER_DELAY : files_1.AutoSaveConfiguration.OFF;
    static READONLY_MESSAGES = {
        providerReadonly: { value: (0, nls_1.localize)('providerReadonly', "Editor is read-only because the file system of the file is read-only."), isTrusted: true },
        sessionReadonly: { value: (0, nls_1.localize)({ key: 'sessionReadonly', comment: ['Please do not translate the word "command", it is part of our internal syntax which must not change', '{Locked="](command:{0})"}'] }, "Editor is read-only because the file was set read-only in this session. [Click here](command:{0}) to set writeable.", 'workbench.action.files.setActiveEditorWriteableInSession'), isTrusted: true },
        configuredReadonly: { value: (0, nls_1.localize)({ key: 'configuredReadonly', comment: ['Please do not translate the word "command", it is part of our internal syntax which must not change', '{Locked="](command:{0})"}'] }, "Editor is read-only because the file was set read-only via settings. [Click here](command:{0}) to configure.", `workbench.action.openSettings?${encodeURIComponent('["files.readonly"]')}`), isTrusted: true },
        fileLocked: { value: (0, nls_1.localize)({ key: 'fileLocked', comment: ['Please do not translate the word "command", it is part of our internal syntax which must not change', '{Locked="](command:{0})"}'] }, "Editor is read-only because of file permissions. [Click here](command:{0}) to set writeable anyway.", 'workbench.action.files.setActiveEditorWriteableInSession'), isTrusted: true },
        fileReadonly: { value: (0, nls_1.localize)('fileReadonly', "Editor is read-only because the file is read-only."), isTrusted: true }
    };
    _onAutoSaveConfigurationChange = this._register(new event_1.Emitter());
    onAutoSaveConfigurationChange = this._onAutoSaveConfigurationChange.event;
    _onFilesAssociationChange = this._register(new event_1.Emitter());
    onFilesAssociationChange = this._onFilesAssociationChange.event;
    _onReadonlyConfigurationChange = this._register(new event_1.Emitter());
    onReadonlyChange = this._onReadonlyConfigurationChange.event;
    configuredAutoSaveDelay;
    configuredAutoSaveOnFocusChange;
    configuredAutoSaveOnWindowChange;
    autoSaveAfterShortDelayContext;
    currentFilesAssociationConfig;
    currentHotExitConfig;
    readonlyIncludeMatcher = this._register(new async_1.IdleValue(() => this.createReadonlyMatcher(files_1.FILES_READONLY_INCLUDE_CONFIG)));
    readonlyExcludeMatcher = this._register(new async_1.IdleValue(() => this.createReadonlyMatcher(files_1.FILES_READONLY_EXCLUDE_CONFIG)));
    configuredReadonlyFromPermissions;
    sessionReadonlyOverrides = new map_1.ResourceMap(resource => this.uriIdentityService.extUri.getComparisonKey(resource));
    constructor(contextKeyService, configurationService, contextService, environmentService, uriIdentityService, fileService) {
        super();
        this.configurationService = configurationService;
        this.contextService = contextService;
        this.environmentService = environmentService;
        this.uriIdentityService = uriIdentityService;
        this.fileService = fileService;
        this.autoSaveAfterShortDelayContext = exports.AutoSaveAfterShortDelayContext.bindTo(contextKeyService);
        const configuration = configurationService.getValue();
        this.currentFilesAssociationConfig = configuration?.files?.associations;
        this.currentHotExitConfig = configuration?.files?.hotExit || files_1.HotExitConfiguration.ON_EXIT;
        this.onFilesConfigurationChange(configuration);
        this.registerListeners();
    }
    createReadonlyMatcher(config) {
        const matcher = this._register(new resources_1.ResourceGlobMatcher(resource => this.configurationService.getValue(config, { resource }), event => event.affectsConfiguration(config), this.contextService, this.configurationService));
        this._register(matcher.onExpressionChange(() => this._onReadonlyConfigurationChange.fire()));
        return matcher;
    }
    isReadonly(resource, stat) {
        // if the entire file system provider is readonly, we respect that
        // and do not allow to change readonly. we take this as a hint that
        // the provider has no capabilities of writing.
        const provider = this.fileService.getProvider(resource.scheme);
        if (provider && (0, files_1.hasReadonlyCapability)(provider)) {
            return provider.readOnlyMessage ?? FilesConfigurationService_1.READONLY_MESSAGES.providerReadonly;
        }
        // session override always wins over the others
        const sessionReadonlyOverride = this.sessionReadonlyOverrides.get(resource);
        if (typeof sessionReadonlyOverride === 'boolean') {
            return sessionReadonlyOverride === true ? FilesConfigurationService_1.READONLY_MESSAGES.sessionReadonly : false;
        }
        if (this.uriIdentityService.extUri.isEqualOrParent(resource, this.environmentService.userRoamingDataHome) ||
            this.uriIdentityService.extUri.isEqual(resource, this.contextService.getWorkspace().configuration ?? undefined)) {
            return false; // explicitly exclude some paths from readonly that we need for configuration
        }
        // configured glob patterns win over stat information
        if (this.readonlyIncludeMatcher.value.matches(resource)) {
            return !this.readonlyExcludeMatcher.value.matches(resource) ? FilesConfigurationService_1.READONLY_MESSAGES.configuredReadonly : false;
        }
        // check if file is locked and configured to treat as readonly
        if (this.configuredReadonlyFromPermissions && stat?.locked) {
            return FilesConfigurationService_1.READONLY_MESSAGES.fileLocked;
        }
        // check if file is marked readonly from the file system provider
        if (stat?.readonly) {
            return FilesConfigurationService_1.READONLY_MESSAGES.fileReadonly;
        }
        return false;
    }
    async updateReadonly(resource, readonly) {
        if (readonly === 'toggle') {
            let stat = undefined;
            try {
                stat = await this.fileService.resolve(resource, { resolveMetadata: true });
            }
            catch (error) {
                // ignore
            }
            readonly = !this.isReadonly(resource, stat);
        }
        if (readonly === 'reset') {
            this.sessionReadonlyOverrides.delete(resource);
        }
        else {
            this.sessionReadonlyOverrides.set(resource, readonly);
        }
        this._onReadonlyConfigurationChange.fire();
    }
    registerListeners() {
        // Files configuration changes
        this._register(this.configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('files')) {
                this.onFilesConfigurationChange(this.configurationService.getValue());
            }
        }));
    }
    onFilesConfigurationChange(configuration) {
        // Auto Save
        const autoSaveMode = configuration?.files?.autoSave || FilesConfigurationService_1.DEFAULT_AUTO_SAVE_MODE;
        switch (autoSaveMode) {
            case files_1.AutoSaveConfiguration.AFTER_DELAY:
                this.configuredAutoSaveDelay = configuration?.files?.autoSaveDelay;
                this.configuredAutoSaveOnFocusChange = false;
                this.configuredAutoSaveOnWindowChange = false;
                break;
            case files_1.AutoSaveConfiguration.ON_FOCUS_CHANGE:
                this.configuredAutoSaveDelay = undefined;
                this.configuredAutoSaveOnFocusChange = true;
                this.configuredAutoSaveOnWindowChange = false;
                break;
            case files_1.AutoSaveConfiguration.ON_WINDOW_CHANGE:
                this.configuredAutoSaveDelay = undefined;
                this.configuredAutoSaveOnFocusChange = false;
                this.configuredAutoSaveOnWindowChange = true;
                break;
            default:
                this.configuredAutoSaveDelay = undefined;
                this.configuredAutoSaveOnFocusChange = false;
                this.configuredAutoSaveOnWindowChange = false;
                break;
        }
        this.autoSaveAfterShortDelayContext.set(this.getAutoSaveMode() === 1 /* AutoSaveMode.AFTER_SHORT_DELAY */);
        this._onAutoSaveConfigurationChange.fire(this.getAutoSaveConfiguration());
        // Check for change in files associations
        const filesAssociation = configuration?.files?.associations;
        if (!(0, objects_1.equals)(this.currentFilesAssociationConfig, filesAssociation)) {
            this.currentFilesAssociationConfig = filesAssociation;
            this._onFilesAssociationChange.fire();
        }
        // Hot exit
        const hotExitMode = configuration?.files?.hotExit;
        if (hotExitMode === files_1.HotExitConfiguration.OFF || hotExitMode === files_1.HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
            this.currentHotExitConfig = hotExitMode;
        }
        else {
            this.currentHotExitConfig = files_1.HotExitConfiguration.ON_EXIT;
        }
        // Readonly
        const readonlyFromPermissions = Boolean(configuration?.files?.readonlyFromPermissions);
        if (readonlyFromPermissions !== Boolean(this.configuredReadonlyFromPermissions)) {
            this.configuredReadonlyFromPermissions = readonlyFromPermissions;
            this._onReadonlyConfigurationChange.fire();
        }
    }
    getAutoSaveMode() {
        if (this.configuredAutoSaveOnFocusChange) {
            return 3 /* AutoSaveMode.ON_FOCUS_CHANGE */;
        }
        if (this.configuredAutoSaveOnWindowChange) {
            return 4 /* AutoSaveMode.ON_WINDOW_CHANGE */;
        }
        if (typeof this.configuredAutoSaveDelay === 'number' && this.configuredAutoSaveDelay >= 0) {
            return this.configuredAutoSaveDelay <= 1000 ? 1 /* AutoSaveMode.AFTER_SHORT_DELAY */ : 2 /* AutoSaveMode.AFTER_LONG_DELAY */;
        }
        return 0 /* AutoSaveMode.OFF */;
    }
    getAutoSaveConfiguration() {
        return {
            autoSaveDelay: typeof this.configuredAutoSaveDelay === 'number' && this.configuredAutoSaveDelay >= 0 ? this.configuredAutoSaveDelay : undefined,
            autoSaveFocusChange: !!this.configuredAutoSaveOnFocusChange,
            autoSaveApplicationChange: !!this.configuredAutoSaveOnWindowChange
        };
    }
    async toggleAutoSave() {
        const currentSetting = this.configurationService.getValue('files.autoSave');
        let newAutoSaveValue;
        if ([files_1.AutoSaveConfiguration.AFTER_DELAY, files_1.AutoSaveConfiguration.ON_FOCUS_CHANGE, files_1.AutoSaveConfiguration.ON_WINDOW_CHANGE].some(setting => setting === currentSetting)) {
            newAutoSaveValue = files_1.AutoSaveConfiguration.OFF;
        }
        else {
            newAutoSaveValue = files_1.AutoSaveConfiguration.AFTER_DELAY;
        }
        return this.configurationService.updateValue('files.autoSave', newAutoSaveValue);
    }
    get isHotExitEnabled() {
        if (this.contextService.getWorkspace().transient) {
            // Transient workspace: hot exit is disabled because
            // transient workspaces are not restored upon restart
            return false;
        }
        return this.currentHotExitConfig !== files_1.HotExitConfiguration.OFF;
    }
    get hotExitConfiguration() {
        return this.currentHotExitConfig;
    }
    preventSaveConflicts(resource, language) {
        return this.configurationService.getValue('files.saveConflictResolution', { resource, overrideIdentifier: language }) !== 'overwriteFileOnDisk';
    }
};
exports.FilesConfigurationService = FilesConfigurationService;
exports.FilesConfigurationService = FilesConfigurationService = FilesConfigurationService_1 = __decorate([
    __param(0, contextkey_1.IContextKeyService),
    __param(1, configuration_1.IConfigurationService),
    __param(2, workspace_1.IWorkspaceContextService),
    __param(3, environment_1.IEnvironmentService),
    __param(4, uriIdentity_1.IUriIdentityService),
    __param(5, files_1.IFileService)
], FilesConfigurationService);
(0, extensions_1.registerSingleton)(exports.IFilesConfigurationService, FilesConfigurationService, 0 /* InstantiationType.Eager */);
