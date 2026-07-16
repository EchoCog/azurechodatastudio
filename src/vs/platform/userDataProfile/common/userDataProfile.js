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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryUserDataProfilesService = exports.UserDataProfilesService = exports.IUserDataProfilesService = void 0;
exports.isUserDataProfile = isUserDataProfile;
exports.reviveProfile = reviveProfile;
exports.toUserDataProfile = toUserDataProfile;
const hash_1 = require("vs/base/common/hash");
const event_1 = require("vs/base/common/event");
const lifecycle_1 = require("vs/base/common/lifecycle");
const resources_1 = require("vs/base/common/resources");
const uri_1 = require("vs/base/common/uri");
const nls_1 = require("vs/nls");
const environment_1 = require("vs/platform/environment/common/environment");
const files_1 = require("vs/platform/files/common/files");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const log_1 = require("vs/platform/log/common/log");
const workspace_1 = require("vs/platform/workspace/common/workspace");
const map_1 = require("vs/base/common/map");
const uriIdentity_1 = require("vs/platform/uriIdentity/common/uriIdentity");
const async_1 = require("vs/base/common/async");
const uuid_1 = require("vs/base/common/uuid");
const strings_1 = require("vs/base/common/strings");
const types_1 = require("vs/base/common/types");
function isUserDataProfile(thing) {
	const candidate = thing;
	return !!(candidate && typeof candidate === 'object'
		&& typeof candidate.id === 'string'
		&& typeof candidate.isDefault === 'boolean'
		&& typeof candidate.name === 'string'
		&& uri_1.URI.isUri(candidate.location)
		&& uri_1.URI.isUri(candidate.globalStorageHome)
		&& uri_1.URI.isUri(candidate.settingsResource)
		&& uri_1.URI.isUri(candidate.keybindingsResource)
		&& uri_1.URI.isUri(candidate.tasksResource)
		&& uri_1.URI.isUri(candidate.snippetsHome)
		&& uri_1.URI.isUri(candidate.extensionsResource));
}
exports.IUserDataProfilesService = (0, instantiation_1.createDecorator)('IUserDataProfilesService');
function reviveProfile(profile, scheme) {
	return {
		id: profile.id,
		isDefault: profile.isDefault,
		name: profile.name,
		shortName: profile.shortName,
		location: uri_1.URI.revive(profile.location).with({ scheme }),
		globalStorageHome: uri_1.URI.revive(profile.globalStorageHome).with({ scheme }),
		settingsResource: uri_1.URI.revive(profile.settingsResource).with({ scheme }),
		keybindingsResource: uri_1.URI.revive(profile.keybindingsResource).with({ scheme }),
		tasksResource: uri_1.URI.revive(profile.tasksResource).with({ scheme }),
		snippetsHome: uri_1.URI.revive(profile.snippetsHome).with({ scheme }),
		extensionsResource: uri_1.URI.revive(profile.extensionsResource).with({ scheme }),
		cacheHome: uri_1.URI.revive(profile.cacheHome).with({ scheme }),
		useDefaultFlags: profile.useDefaultFlags,
		isTransient: profile.isTransient,
	};
}
function toUserDataProfile(id, name, location, profilesCacheHome, options, defaultProfile) {
	return {
		id,
		name,
		location,
		isDefault: false,
		shortName: options?.shortName,
		globalStorageHome: defaultProfile && options?.useDefaultFlags?.globalState ? defaultProfile.globalStorageHome : (0, resources_1.joinPath)(location, 'globalStorage'),
		settingsResource: defaultProfile && options?.useDefaultFlags?.settings ? defaultProfile.settingsResource : (0, resources_1.joinPath)(location, 'settings.json'),
		keybindingsResource: defaultProfile && options?.useDefaultFlags?.keybindings ? defaultProfile.keybindingsResource : (0, resources_1.joinPath)(location, 'keybindings.json'),
		tasksResource: defaultProfile && options?.useDefaultFlags?.tasks ? defaultProfile.tasksResource : (0, resources_1.joinPath)(location, 'tasks.json'),
		snippetsHome: defaultProfile && options?.useDefaultFlags?.snippets ? defaultProfile.snippetsHome : (0, resources_1.joinPath)(location, 'snippets'),
		extensionsResource: defaultProfile && options?.useDefaultFlags?.extensions ? defaultProfile.extensionsResource : (0, resources_1.joinPath)(location, 'extensions.json'),
		cacheHome: (0, resources_1.joinPath)(profilesCacheHome, id),
		useDefaultFlags: options?.useDefaultFlags,
		isTransient: options?.transient
	};
}
let UserDataProfilesService = class UserDataProfilesService extends lifecycle_1.Disposable {
	environmentService;
	fileService;
	uriIdentityService;
	logService;
	static PROFILES_KEY = 'userDataProfiles';
	static PROFILE_ASSOCIATIONS_KEY = 'profileAssociations';
	_serviceBrand;
	enabled = true;
	profilesHome;
	profilesCacheHome;
	get defaultProfile() { return this.profiles[0]; }
	get profiles() { return [...this.profilesObject.profiles, ...this.transientProfilesObject.profiles]; }
	_onDidChangeProfiles = this._register(new event_1.Emitter());
	onDidChangeProfiles = this._onDidChangeProfiles.event;
	_onWillCreateProfile = this._register(new event_1.Emitter());
	onWillCreateProfile = this._onWillCreateProfile.event;
	_onWillRemoveProfile = this._register(new event_1.Emitter());
	onWillRemoveProfile = this._onWillRemoveProfile.event;
	_onDidResetWorkspaces = this._register(new event_1.Emitter());
	onDidResetWorkspaces = this._onDidResetWorkspaces.event;
	profileCreationPromises = new Map();
	transientProfilesObject = {
		profiles: [],
		workspaces: new map_1.ResourceMap(),
		emptyWindows: new Map()
	};
	constructor(environmentService, fileService, uriIdentityService, logService) {
		super();
		this.environmentService = environmentService;
		this.fileService = fileService;
		this.uriIdentityService = uriIdentityService;
		this.logService = logService;
		this.profilesHome = (0, resources_1.joinPath)(this.environmentService.userRoamingDataHome, 'profiles');
		this.profilesCacheHome = (0, resources_1.joinPath)(this.environmentService.cacheHome, 'CachedProfilesData');
	}
	init() {
		this._profilesObject = undefined;
	}
	setEnablement(enabled) {
		if (this.enabled !== enabled) {
			this._profilesObject = undefined;
			this.enabled = enabled;
		}
	}
	isEnabled() {
		return this.enabled;
	}
	_profilesObject;
	get profilesObject() {
		if (!this._profilesObject) {
			const defaultProfile = this.createDefaultProfile();
			const profiles = [defaultProfile];
			if (this.enabled) {
				try {
					for (const storedProfile of this.getStoredProfiles()) {
						if (!storedProfile.name || !(0, types_1.isString)(storedProfile.name) || !storedProfile.location) {
							this.logService.warn('Skipping the invalid stored profile', storedProfile.location || storedProfile.name);
							continue;
						}
						profiles.push(toUserDataProfile((0, resources_1.basename)(storedProfile.location), storedProfile.name, storedProfile.location, this.profilesCacheHome, { shortName: storedProfile.shortName, useDefaultFlags: storedProfile.useDefaultFlags }, defaultProfile));
					}
				}
				catch (error) {
					this.logService.error(error);
				}
			}
			const workspaces = new map_1.ResourceMap();
			const emptyWindows = new Map();
			if (profiles.length) {
				try {
					const profileAssociaitions = this.getStoredProfileAssociations();
					if (profileAssociaitions.workspaces) {
						for (const [workspacePath, profileId] of Object.entries(profileAssociaitions.workspaces)) {
							const workspace = uri_1.URI.parse(workspacePath);
							const profile = profiles.find(p => p.id === profileId);
							if (profile) {
								workspaces.set(workspace, profile);
							}
						}
					}
					if (profileAssociaitions.emptyWindows) {
						for (const [windowId, profileId] of Object.entries(profileAssociaitions.emptyWindows)) {
							const profile = profiles.find(p => p.id === profileId);
							if (profile) {
								emptyWindows.set(windowId, profile);
							}
						}
					}
				}
				catch (error) {
					this.logService.error(error);
				}
			}
			this._profilesObject = { profiles, workspaces, emptyWindows };
		}
		return this._profilesObject;
	}
	createDefaultProfile() {
		const defaultProfile = toUserDataProfile('__default__profile__', (0, nls_1.localize)('defaultProfile', "Default"), this.environmentService.userRoamingDataHome, this.profilesCacheHome);
		return { ...defaultProfile, extensionsResource: this.getDefaultProfileExtensionsLocation() ?? defaultProfile.extensionsResource, isDefault: true };
	}
	async createTransientProfile(workspaceIdentifier) {
		const namePrefix = `Temp`;
		const nameRegEx = new RegExp(`${(0, strings_1.escapeRegExpCharacters)(namePrefix)}\\s(\\d+)`);
		let nameIndex = 0;
		for (const profile of this.profiles) {
			const matches = nameRegEx.exec(profile.name);
			const index = matches ? parseInt(matches[1]) : 0;
			nameIndex = index > nameIndex ? index : nameIndex;
		}
		const name = `${namePrefix} ${nameIndex + 1}`;
		return this.createProfile((0, hash_1.hash)((0, uuid_1.generateUuid)()).toString(16), name, { transient: true }, workspaceIdentifier);
	}
	async createNamedProfile(name, options, workspaceIdentifier) {
		return this.createProfile((0, hash_1.hash)((0, uuid_1.generateUuid)()).toString(16), name, options, workspaceIdentifier);
	}
	async createProfile(id, name, options, workspaceIdentifier) {
		if (!this.enabled) {
			throw new Error(`Profiles are disabled in the current environment.`);
		}
		const profile = await this.doCreateProfile(id, name, options);
		if (workspaceIdentifier) {
			await this.setProfileForWorkspace(workspaceIdentifier, profile);
		}
		return profile;
	}
	async doCreateProfile(id, name, options) {
		if (!(0, types_1.isString)(name) || !name) {
			throw new Error('Name of the profile is mandatory and must be of type `string`');
		}
		let profileCreationPromise = this.profileCreationPromises.get(name);
		if (!profileCreationPromise) {
			profileCreationPromise = (async () => {
				try {
					const existing = this.profiles.find(p => p.name === name || p.id === id);
					if (existing) {
						return existing;
					}
					const profile = toUserDataProfile(id, name, (0, resources_1.joinPath)(this.profilesHome, id), this.profilesCacheHome, options, this.defaultProfile);
					await this.fileService.createFolder(profile.location);
					const joiners = [];
					this._onWillCreateProfile.fire({
						profile,
						join(promise) {
							joiners.push(promise);
						}
					});
					await async_1.Promises.settled(joiners);
					this.updateProfiles([profile], [], []);
					return profile;
				}
				finally {
					this.profileCreationPromises.delete(name);
				}
			})();
			this.profileCreationPromises.set(name, profileCreationPromise);
		}
		return profileCreationPromise;
	}
	async updateProfile(profileToUpdate, options) {
		if (!this.enabled) {
			throw new Error(`Profiles are disabled in the current environment.`);
		}
		let profile = this.profiles.find(p => p.id === profileToUpdate.id);
		if (!profile) {
			throw new Error(`Profile '${profileToUpdate.name}' does not exist`);
		}
		profile = toUserDataProfile(profile.id, options.name ?? profile.name, profile.location, this.profilesCacheHome, { shortName: options.shortName ?? profile.shortName, transient: options.transient ?? profile.isTransient, useDefaultFlags: options.useDefaultFlags ?? profile.useDefaultFlags }, this.defaultProfile);
		this.updateProfiles([], [], [profile]);
		return profile;
	}
	async removeProfile(profileToRemove) {
		if (!this.enabled) {
			throw new Error(`Profiles are disabled in the current environment.`);
		}
		if (profileToRemove.isDefault) {
			throw new Error('Cannot remove default profile');
		}
		const profile = this.profiles.find(p => p.id === profileToRemove.id);
		if (!profile) {
			throw new Error(`Profile '${profileToRemove.name}' does not exist`);
		}
		const joiners = [];
		this._onWillRemoveProfile.fire({
			profile,
			join(promise) {
				joiners.push(promise);
			}
		});
		try {
			await Promise.allSettled(joiners);
		}
		catch (error) {
			this.logService.error(error);
		}
		for (const windowId of [...this.profilesObject.emptyWindows.keys()]) {
			if (profile.id === this.profilesObject.emptyWindows.get(windowId)?.id) {
				this.profilesObject.emptyWindows.delete(windowId);
			}
		}
		for (const workspace of [...this.profilesObject.workspaces.keys()]) {
			if (profile.id === this.profilesObject.workspaces.get(workspace)?.id) {
				this.profilesObject.workspaces.delete(workspace);
			}
		}
		this.updateStoredProfileAssociations();
		this.updateProfiles([], [profile], []);
		try {
			await this.fileService.del(profile.cacheHome, { recursive: true });
		}
		catch (error) {
			if ((0, files_1.toFileOperationResult)(error) !== 1 /* FileOperationResult.FILE_NOT_FOUND */) {
				this.logService.error(error);
			}
		}
	}
	async setProfileForWorkspace(workspaceIdentifier, profileToSet) {
		if (!this.enabled) {
			throw new Error(`Profiles are disabled in the current environment.`);
		}
		const profile = this.profiles.find(p => p.id === profileToSet.id);
		if (!profile) {
			throw new Error(`Profile '${profileToSet.name}' does not exist`);
		}
		this.updateWorkspaceAssociation(workspaceIdentifier, profile);
	}
	unsetWorkspace(workspaceIdentifier, transient) {
		if (!this.enabled) {
			throw new Error(`Profiles are disabled in the current environment.`);
		}
		this.updateWorkspaceAssociation(workspaceIdentifier, undefined, transient);
	}
	async resetWorkspaces() {
		this.transientProfilesObject.workspaces.clear();
		this.transientProfilesObject.emptyWindows.clear();
		this.profilesObject.workspaces.clear();
		this.profilesObject.emptyWindows.clear();
		this.updateStoredProfileAssociations();
		this._onDidResetWorkspaces.fire();
	}
	async cleanUp() {
		if (!this.enabled) {
			return;
		}
		if (await this.fileService.exists(this.profilesHome)) {
			const stat = await this.fileService.resolve(this.profilesHome);
			await Promise.all((stat.children || [])
				.filter(child => child.isDirectory && this.profiles.every(p => !this.uriIdentityService.extUri.isEqual(p.location, child.resource)))
				.map(child => this.fileService.del(child.resource, { recursive: true })));
		}
	}
	async cleanUpTransientProfiles() {
		if (!this.enabled) {
			return;
		}
		const unAssociatedTransientProfiles = this.transientProfilesObject.profiles.filter(p => !this.isProfileAssociatedToWorkspace(p));
		await Promise.allSettled(unAssociatedTransientProfiles.map(p => this.removeProfile(p)));
	}
	getProfileForWorkspace(workspaceIdentifier) {
		const workspace = this.getWorkspace(workspaceIdentifier);
		return uri_1.URI.isUri(workspace) ? this.transientProfilesObject.workspaces.get(workspace) ?? this.profilesObject.workspaces.get(workspace) : this.transientProfilesObject.emptyWindows.get(workspace) ?? this.profilesObject.emptyWindows.get(workspace);
	}
	getWorkspace(workspaceIdentifier) {
		if ((0, workspace_1.isSingleFolderWorkspaceIdentifier)(workspaceIdentifier)) {
			return workspaceIdentifier.uri;
		}
		if ((0, workspace_1.isWorkspaceIdentifier)(workspaceIdentifier)) {
			return workspaceIdentifier.configPath;
		}
		return workspaceIdentifier.id;
	}
	isProfileAssociatedToWorkspace(profile) {
		if ([...this.transientProfilesObject.emptyWindows.values()].some(windowProfile => this.uriIdentityService.extUri.isEqual(windowProfile.location, profile.location))) {
			return true;
		}
		if ([...this.transientProfilesObject.workspaces.values()].some(workspaceProfile => this.uriIdentityService.extUri.isEqual(workspaceProfile.location, profile.location))) {
			return true;
		}
		if ([...this.profilesObject.emptyWindows.values()].some(windowProfile => this.uriIdentityService.extUri.isEqual(windowProfile.location, profile.location))) {
			return true;
		}
		if ([...this.profilesObject.workspaces.values()].some(workspaceProfile => this.uriIdentityService.extUri.isEqual(workspaceProfile.location, profile.location))) {
			return true;
		}
		return false;
	}
	updateProfiles(added, removed, updated) {
		const allProfiles = [...this.profiles, ...added];
		const storedProfiles = [];
		this.transientProfilesObject.profiles = [];
		for (let profile of allProfiles) {
			if (profile.isDefault) {
				continue;
			}
			if (removed.some(p => profile.id === p.id)) {
				continue;
			}
			profile = updated.find(p => profile.id === p.id) ?? profile;
			if (profile.isTransient) {
				this.transientProfilesObject.profiles.push(profile);
			}
			else {
				storedProfiles.push({ location: profile.location, name: profile.name, shortName: profile.shortName, useDefaultFlags: profile.useDefaultFlags });
			}
		}
		this.saveStoredProfiles(storedProfiles);
		this._profilesObject = undefined;
		this.triggerProfilesChanges(added, removed, updated);
	}
	triggerProfilesChanges(added, removed, updated) {
		this._onDidChangeProfiles.fire({ added, removed, updated, all: this.profiles });
	}
	updateWorkspaceAssociation(workspaceIdentifier, newProfile, transient) {
		// Force transient if the new profile to associate is transient
		transient = newProfile?.isTransient ? true : transient;
		if (!transient) {
			// Unset the transiet workspace association if any
			this.updateWorkspaceAssociation(workspaceIdentifier, undefined, true);
		}
		const workspace = this.getWorkspace(workspaceIdentifier);
		const profilesObject = transient ? this.transientProfilesObject : this.profilesObject;
		// Folder or Multiroot workspace
		if (uri_1.URI.isUri(workspace)) {
			profilesObject.workspaces.delete(workspace);
			if (newProfile) {
				profilesObject.workspaces.set(workspace, newProfile);
			}
		}
		// Empty Window
		else {
			profilesObject.emptyWindows.delete(workspace);
			if (newProfile) {
				profilesObject.emptyWindows.set(workspace, newProfile);
			}
		}
		if (!transient) {
			this.updateStoredProfileAssociations();
		}
	}
	updateStoredProfileAssociations() {
		const workspaces = {};
		for (const [workspace, profile] of this.profilesObject.workspaces.entries()) {
			workspaces[workspace.toString()] = profile.id;
		}
		const emptyWindows = {};
		for (const [windowId, profile] of this.profilesObject.emptyWindows.entries()) {
			emptyWindows[windowId.toString()] = profile.id;
		}
		this.saveStoredProfileAssociations({ workspaces, emptyWindows });
		this._profilesObject = undefined;
	}
	// TODO: @sandy081 Remove migration after couple of releases
	migrateStoredProfileAssociations(storedProfileAssociations) {
		const workspaces = {};
		const defaultProfile = this.createDefaultProfile();
		if (storedProfileAssociations.workspaces) {
			for (const [workspace, location] of Object.entries(storedProfileAssociations.workspaces)) {
				const uri = uri_1.URI.parse(location);
				workspaces[workspace] = this.uriIdentityService.extUri.isEqual(uri, defaultProfile.location) ? defaultProfile.id : this.uriIdentityService.extUri.basename(uri);
			}
		}
		const emptyWindows = {};
		if (storedProfileAssociations.emptyWindows) {
			for (const [workspace, location] of Object.entries(storedProfileAssociations.emptyWindows)) {
				const uri = uri_1.URI.parse(location);
				emptyWindows[workspace] = this.uriIdentityService.extUri.isEqual(uri, defaultProfile.location) ? defaultProfile.id : this.uriIdentityService.extUri.basename(uri);
			}
		}
		return { workspaces, emptyWindows };
	}
	getStoredProfiles() { return []; }
	saveStoredProfiles(storedProfiles) { throw new Error('not implemented'); }
	getStoredProfileAssociations() { return {}; }
	saveStoredProfileAssociations(storedProfileAssociations) { throw new Error('not implemented'); }
	getDefaultProfileExtensionsLocation() { return undefined; }
};
exports.UserDataProfilesService = UserDataProfilesService;
exports.UserDataProfilesService = UserDataProfilesService = __decorate([
	__param(0, environment_1.IEnvironmentService),
	__param(1, files_1.IFileService),
	__param(2, uriIdentity_1.IUriIdentityService),
	__param(3, log_1.ILogService)
], UserDataProfilesService);
class InMemoryUserDataProfilesService extends UserDataProfilesService {
	storedProfiles = [];
	getStoredProfiles() { return this.storedProfiles; }
	saveStoredProfiles(storedProfiles) { this.storedProfiles = storedProfiles; }
	storedProfileAssociations = {};
	getStoredProfileAssociations() { return this.storedProfileAssociations; }
	saveStoredProfileAssociations(storedProfileAssociations) { this.storedProfileAssociations = storedProfileAssociations; }
}
exports.InMemoryUserDataProfilesService = InMemoryUserDataProfilesService;
