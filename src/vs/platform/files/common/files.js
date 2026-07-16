"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.ByteSize = exports.ETAG_DISABLED = exports.FileKind = exports.FILES_READONLY_FROM_PERMISSIONS_CONFIG = exports.FILES_READONLY_EXCLUDE_CONFIG = exports.FILES_READONLY_INCLUDE_CONFIG = exports.FILES_EXCLUDE_CONFIG = exports.FILES_ASSOCIATIONS_CONFIG = exports.HotExitConfiguration = exports.AutoSaveConfiguration = exports.NotModifiedSinceFileOperationError = exports.TooLargeFileOperationError = exports.FileOperationError = exports.FileChangesEvent = exports.FileOperationEvent = exports.FileSystemProviderError = exports.FileSystemProviderErrorCode = exports.FilePermission = exports.FileType = exports.IFileService = void 0;
exports.isFileOpenForWriteOptions = isFileOpenForWriteOptions;
exports.hasReadWriteCapability = hasReadWriteCapability;
exports.hasFileFolderCopyCapability = hasFileFolderCopyCapability;
exports.hasFileCloneCapability = hasFileCloneCapability;
exports.hasOpenReadWriteCloseCapability = hasOpenReadWriteCloseCapability;
exports.hasFileReadStreamCapability = hasFileReadStreamCapability;
exports.hasFileAtomicReadCapability = hasFileAtomicReadCapability;
exports.hasFileAtomicWriteCapability = hasFileAtomicWriteCapability;
exports.hasFileAtomicDeleteCapability = hasFileAtomicDeleteCapability;
exports.hasReadonlyCapability = hasReadonlyCapability;
exports.createFileSystemProviderError = createFileSystemProviderError;
exports.ensureFileSystemProviderError = ensureFileSystemProviderError;
exports.markAsFileSystemProviderError = markAsFileSystemProviderError;
exports.toFileSystemProviderErrorCode = toFileSystemProviderErrorCode;
exports.toFileOperationResult = toFileOperationResult;
exports.isParent = isParent;
exports.etag = etag;
exports.whenProviderRegistered = whenProviderRegistered;
exports.getLargeFileConfirmationLimit = getLargeFileConfirmationLimit;
const ternarySearchTree_1 = require("vs/base/common/ternarySearchTree");
const path_1 = require("vs/base/common/path");
const strings_1 = require("vs/base/common/strings");
const types_1 = require("vs/base/common/types");
const uri_1 = require("vs/base/common/uri");
const nls_1 = require("vs/nls");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const platform_1 = require("vs/base/common/platform");
const network_1 = require("vs/base/common/network");
//#region file service & providers
exports.IFileService = (0, instantiation_1.createDecorator)('fileService');
function isFileOpenForWriteOptions(options) {
	return options.create === true;
}
var FileType;
(function (FileType) {
	/**
	 * File is unknown (neither file, directory nor symbolic link).
	 */
	FileType[FileType["Unknown"] = 0] = "Unknown";
	/**
	 * File is a normal file.
	 */
	FileType[FileType["File"] = 1] = "File";
	/**
	 * File is a directory.
	 */
	FileType[FileType["Directory"] = 2] = "Directory";
	/**
	 * File is a symbolic link.
	 *
	 * Note: even when the file is a symbolic link, you can test for
	 * `FileType.File` and `FileType.Directory` to know the type of
	 * the target the link points to.
	 */
	FileType[FileType["SymbolicLink"] = 64] = "SymbolicLink";
})(FileType || (exports.FileType = FileType = {}));
var FilePermission;
(function (FilePermission) {
	/**
	 * File is readonly. Components like editors should not
	 * offer to edit the contents.
	 */
	FilePermission[FilePermission["Readonly"] = 1] = "Readonly";
	/**
	 * File is locked. Components like editors should offer
	 * to edit the contents and ask the user upon saving to
	 * remove the lock.
	 */
	FilePermission[FilePermission["Locked"] = 2] = "Locked";
})(FilePermission || (exports.FilePermission = FilePermission = {}));
function hasReadWriteCapability(provider) {
	return !!(provider.capabilities & 2 /* FileSystemProviderCapabilities.FileReadWrite */);
}
function hasFileFolderCopyCapability(provider) {
	return !!(provider.capabilities & 8 /* FileSystemProviderCapabilities.FileFolderCopy */);
}
function hasFileCloneCapability(provider) {
	return !!(provider.capabilities & 131072 /* FileSystemProviderCapabilities.FileClone */);
}
function hasOpenReadWriteCloseCapability(provider) {
	return !!(provider.capabilities & 4 /* FileSystemProviderCapabilities.FileOpenReadWriteClose */);
}
function hasFileReadStreamCapability(provider) {
	return !!(provider.capabilities & 16 /* FileSystemProviderCapabilities.FileReadStream */);
}
function hasFileAtomicReadCapability(provider) {
	if (!hasReadWriteCapability(provider)) {
		return false; // we require the `FileReadWrite` capability too
	}
	return !!(provider.capabilities & 16384 /* FileSystemProviderCapabilities.FileAtomicRead */);
}
function hasFileAtomicWriteCapability(provider) {
	if (!hasReadWriteCapability(provider)) {
		return false; // we require the `FileReadWrite` capability too
	}
	return !!(provider.capabilities & 32768 /* FileSystemProviderCapabilities.FileAtomicWrite */);
}
function hasFileAtomicDeleteCapability(provider) {
	return !!(provider.capabilities & 65536 /* FileSystemProviderCapabilities.FileAtomicDelete */);
}
function hasReadonlyCapability(provider) {
	return !!(provider.capabilities & 2048 /* FileSystemProviderCapabilities.Readonly */);
}
var FileSystemProviderErrorCode;
(function (FileSystemProviderErrorCode) {
	FileSystemProviderErrorCode["FileExists"] = "EntryExists";
	FileSystemProviderErrorCode["FileNotFound"] = "EntryNotFound";
	FileSystemProviderErrorCode["FileNotADirectory"] = "EntryNotADirectory";
	FileSystemProviderErrorCode["FileIsADirectory"] = "EntryIsADirectory";
	FileSystemProviderErrorCode["FileExceedsStorageQuota"] = "EntryExceedsStorageQuota";
	FileSystemProviderErrorCode["FileTooLarge"] = "EntryTooLarge";
	FileSystemProviderErrorCode["FileWriteLocked"] = "EntryWriteLocked";
	FileSystemProviderErrorCode["NoPermissions"] = "NoPermissions";
	FileSystemProviderErrorCode["Unavailable"] = "Unavailable";
	FileSystemProviderErrorCode["Unknown"] = "Unknown";
})(FileSystemProviderErrorCode || (exports.FileSystemProviderErrorCode = FileSystemProviderErrorCode = {}));
class FileSystemProviderError extends Error {
	code;
	static create(error, code) {
		const providerError = new FileSystemProviderError(error.toString(), code);
		markAsFileSystemProviderError(providerError, code);
		return providerError;
	}
	constructor(message, code) {
		super(message);
		this.code = code;
	}
}
exports.FileSystemProviderError = FileSystemProviderError;
function createFileSystemProviderError(error, code) {
	return FileSystemProviderError.create(error, code);
}
function ensureFileSystemProviderError(error) {
	if (!error) {
		return createFileSystemProviderError((0, nls_1.localize)('unknownError', "Unknown Error"), FileSystemProviderErrorCode.Unknown); // https://github.com/microsoft/vscode/issues/72798
	}
	return error;
}
function markAsFileSystemProviderError(error, code) {
	error.name = code ? `${code} (FileSystemError)` : `FileSystemError`;
	return error;
}
function toFileSystemProviderErrorCode(error) {
	// Guard against abuse
	if (!error) {
		return FileSystemProviderErrorCode.Unknown;
	}
	// FileSystemProviderError comes with the code
	if (error instanceof FileSystemProviderError) {
		return error.code;
	}
	// Any other error, check for name match by assuming that the error
	// went through the markAsFileSystemProviderError() method
	const match = /^(.+) \(FileSystemError\)$/.exec(error.name);
	if (!match) {
		return FileSystemProviderErrorCode.Unknown;
	}
	switch (match[1]) {
		case FileSystemProviderErrorCode.FileExists: return FileSystemProviderErrorCode.FileExists;
		case FileSystemProviderErrorCode.FileIsADirectory: return FileSystemProviderErrorCode.FileIsADirectory;
		case FileSystemProviderErrorCode.FileNotADirectory: return FileSystemProviderErrorCode.FileNotADirectory;
		case FileSystemProviderErrorCode.FileNotFound: return FileSystemProviderErrorCode.FileNotFound;
		case FileSystemProviderErrorCode.FileTooLarge: return FileSystemProviderErrorCode.FileTooLarge;
		case FileSystemProviderErrorCode.FileWriteLocked: return FileSystemProviderErrorCode.FileWriteLocked;
		case FileSystemProviderErrorCode.NoPermissions: return FileSystemProviderErrorCode.NoPermissions;
		case FileSystemProviderErrorCode.Unavailable: return FileSystemProviderErrorCode.Unavailable;
	}
	return FileSystemProviderErrorCode.Unknown;
}
function toFileOperationResult(error) {
	// FileSystemProviderError comes with the result already
	if (error instanceof FileOperationError) {
		return error.fileOperationResult;
	}
	// Otherwise try to find from code
	switch (toFileSystemProviderErrorCode(error)) {
		case FileSystemProviderErrorCode.FileNotFound:
			return 1 /* FileOperationResult.FILE_NOT_FOUND */;
		case FileSystemProviderErrorCode.FileIsADirectory:
			return 0 /* FileOperationResult.FILE_IS_DIRECTORY */;
		case FileSystemProviderErrorCode.FileNotADirectory:
			return 9 /* FileOperationResult.FILE_NOT_DIRECTORY */;
		case FileSystemProviderErrorCode.FileWriteLocked:
			return 5 /* FileOperationResult.FILE_WRITE_LOCKED */;
		case FileSystemProviderErrorCode.NoPermissions:
			return 6 /* FileOperationResult.FILE_PERMISSION_DENIED */;
		case FileSystemProviderErrorCode.FileExists:
			return 4 /* FileOperationResult.FILE_MOVE_CONFLICT */;
		case FileSystemProviderErrorCode.FileTooLarge:
			return 7 /* FileOperationResult.FILE_TOO_LARGE */;
		default:
			return 10 /* FileOperationResult.FILE_OTHER_ERROR */;
	}
}
class FileOperationEvent {
	resource;
	operation;
	target;
	constructor(resource, operation, target) {
		this.resource = resource;
		this.operation = operation;
		this.target = target;
	}
	isOperation(operation) {
		return this.operation === operation;
	}
}
exports.FileOperationEvent = FileOperationEvent;
class FileChangesEvent {
	added = undefined;
	updated = undefined;
	deleted = undefined;
	constructor(changes, ignorePathCasing) {
		const entriesByType = new Map();
		for (const change of changes) {
			const array = entriesByType.get(change.type);
			if (array) {
				array.push([change.resource, change]);
			}
			else {
				entriesByType.set(change.type, [[change.resource, change]]);
			}
			switch (change.type) {
				case 1 /* FileChangeType.ADDED */:
					this.rawAdded.push(change.resource);
					break;
				case 0 /* FileChangeType.UPDATED */:
					this.rawUpdated.push(change.resource);
					break;
				case 2 /* FileChangeType.DELETED */:
					this.rawDeleted.push(change.resource);
					break;
			}
		}
		for (const [key, value] of entriesByType) {
			switch (key) {
				case 1 /* FileChangeType.ADDED */:
					this.added = ternarySearchTree_1.TernarySearchTree.forUris(() => ignorePathCasing);
					this.added.fill(value);
					break;
				case 0 /* FileChangeType.UPDATED */:
					this.updated = ternarySearchTree_1.TernarySearchTree.forUris(() => ignorePathCasing);
					this.updated.fill(value);
					break;
				case 2 /* FileChangeType.DELETED */:
					this.deleted = ternarySearchTree_1.TernarySearchTree.forUris(() => ignorePathCasing);
					this.deleted.fill(value);
					break;
			}
		}
	}
	/**
	 * Find out if the file change events match the provided resource.
	 *
	 * Note: when passing `FileChangeType.DELETED`, we consider a match
	 * also when the parent of the resource got deleted.
	 */
	contains(resource, ...types) {
		return this.doContains(resource, { includeChildren: false }, ...types);
	}
	/**
	 * Find out if the file change events either match the provided
	 * resource, or contain a child of this resource.
	 */
	affects(resource, ...types) {
		return this.doContains(resource, { includeChildren: true }, ...types);
	}
	doContains(resource, options, ...types) {
		if (!resource) {
			return false;
		}
		const hasTypesFilter = types.length > 0;
		// Added
		if (!hasTypesFilter || types.includes(1 /* FileChangeType.ADDED */)) {
			if (this.added?.get(resource)) {
				return true;
			}
			if (options.includeChildren && this.added?.findSuperstr(resource)) {
				return true;
			}
		}
		// Updated
		if (!hasTypesFilter || types.includes(0 /* FileChangeType.UPDATED */)) {
			if (this.updated?.get(resource)) {
				return true;
			}
			if (options.includeChildren && this.updated?.findSuperstr(resource)) {
				return true;
			}
		}
		// Deleted
		if (!hasTypesFilter || types.includes(2 /* FileChangeType.DELETED */)) {
			if (this.deleted?.findSubstr(resource) /* deleted also considers parent folders */) {
				return true;
			}
			if (options.includeChildren && this.deleted?.findSuperstr(resource)) {
				return true;
			}
		}
		return false;
	}
	/**
	 * Returns if this event contains added files.
	 */
	gotAdded() {
		return !!this.added;
	}
	/**
	 * Returns if this event contains deleted files.
	 */
	gotDeleted() {
		return !!this.deleted;
	}
	/**
	 * Returns if this event contains updated files.
	 */
	gotUpdated() {
		return !!this.updated;
	}
	/**
	 * @deprecated use the `contains` or `affects` method to efficiently find
	 * out if the event relates to a given resource. these methods ensure:
	 * - that there is no expensive lookup needed (by using a `TernarySearchTree`)
	 * - correctly handles `FileChangeType.DELETED` events
	 */
	rawAdded = [];
	/**
	* @deprecated use the `contains` or `affects` method to efficiently find
	* out if the event relates to a given resource. these methods ensure:
	* - that there is no expensive lookup needed (by using a `TernarySearchTree`)
	* - correctly handles `FileChangeType.DELETED` events
	*/
	rawUpdated = [];
	/**
	* @deprecated use the `contains` or `affects` method to efficiently find
	* out if the event relates to a given resource. these methods ensure:
	* - that there is no expensive lookup needed (by using a `TernarySearchTree`)
	* - correctly handles `FileChangeType.DELETED` events
	*/
	rawDeleted = [];
}
exports.FileChangesEvent = FileChangesEvent;
function isParent(path, candidate, ignoreCase) {
	if (!path || !candidate || path === candidate) {
		return false;
	}
	if (candidate.length > path.length) {
		return false;
	}
	if (candidate.charAt(candidate.length - 1) !== path_1.sep) {
		candidate += path_1.sep;
	}
	if (ignoreCase) {
		return (0, strings_1.startsWithIgnoreCase)(path, candidate);
	}
	return path.indexOf(candidate) === 0;
}
class FileOperationError extends Error {
	fileOperationResult;
	options;
	constructor(message, fileOperationResult, options) {
		super(message);
		this.fileOperationResult = fileOperationResult;
		this.options = options;
	}
}
exports.FileOperationError = FileOperationError;
class TooLargeFileOperationError extends FileOperationError {
	fileOperationResult;
	size;
	constructor(message, fileOperationResult, size, options) {
		super(message, fileOperationResult, options);
		this.fileOperationResult = fileOperationResult;
		this.size = size;
	}
}
exports.TooLargeFileOperationError = TooLargeFileOperationError;
class NotModifiedSinceFileOperationError extends FileOperationError {
	stat;
	constructor(message, stat, options) {
		super(message, 2 /* FileOperationResult.FILE_NOT_MODIFIED_SINCE */, options);
		this.stat = stat;
	}
}
exports.NotModifiedSinceFileOperationError = NotModifiedSinceFileOperationError;
//#endregion
//#region Settings
exports.AutoSaveConfiguration = {
	OFF: 'off',
	AFTER_DELAY: 'afterDelay',
	ON_FOCUS_CHANGE: 'onFocusChange',
	ON_WINDOW_CHANGE: 'onWindowChange'
};
exports.HotExitConfiguration = {
	OFF: 'off',
	ON_EXIT: 'onExit',
	ON_EXIT_AND_WINDOW_CLOSE: 'onExitAndWindowClose'
};
exports.FILES_ASSOCIATIONS_CONFIG = 'files.associations';
exports.FILES_EXCLUDE_CONFIG = 'files.exclude';
exports.FILES_READONLY_INCLUDE_CONFIG = 'files.readonlyInclude';
exports.FILES_READONLY_EXCLUDE_CONFIG = 'files.readonlyExclude';
exports.FILES_READONLY_FROM_PERMISSIONS_CONFIG = 'files.readonlyFromPermissions';
//#endregion
//#region Utilities
var FileKind;
(function (FileKind) {
	FileKind[FileKind["FILE"] = 0] = "FILE";
	FileKind[FileKind["FOLDER"] = 1] = "FOLDER";
	FileKind[FileKind["ROOT_FOLDER"] = 2] = "ROOT_FOLDER";
})(FileKind || (exports.FileKind = FileKind = {}));
/**
 * A hint to disable etag checking for reading/writing.
 */
exports.ETAG_DISABLED = '';
function etag(stat) {
	if (typeof stat.size !== 'number' || typeof stat.mtime !== 'number') {
		return undefined;
	}
	return stat.mtime.toString(29) + stat.size.toString(31);
}
async function whenProviderRegistered(file, fileService) {
	if (fileService.hasProvider(uri_1.URI.from({ scheme: file.scheme }))) {
		return;
	}
	return new Promise(resolve => {
		const disposable = fileService.onDidChangeFileSystemProviderRegistrations(e => {
			if (e.scheme === file.scheme && e.added) {
				disposable.dispose();
				resolve();
			}
		});
	});
}
/**
 * Helper to format a raw byte size into a human readable label.
 */
class ByteSize {
	static KB = 1024;
	static MB = ByteSize.KB * ByteSize.KB;
	static GB = ByteSize.MB * ByteSize.KB;
	static TB = ByteSize.GB * ByteSize.KB;
	static formatSize(size) {
		if (!(0, types_1.isNumber)(size)) {
			size = 0;
		}
		if (size < ByteSize.KB) {
			return (0, nls_1.localize)('sizeB', "{0}B", size.toFixed(0));
		}
		if (size < ByteSize.MB) {
			return (0, nls_1.localize)('sizeKB', "{0}KB", (size / ByteSize.KB).toFixed(2));
		}
		if (size < ByteSize.GB) {
			return (0, nls_1.localize)('sizeMB', "{0}MB", (size / ByteSize.MB).toFixed(2));
		}
		if (size < ByteSize.TB) {
			return (0, nls_1.localize)('sizeGB', "{0}GB", (size / ByteSize.GB).toFixed(2));
		}
		return (0, nls_1.localize)('sizeTB', "{0}TB", (size / ByteSize.TB).toFixed(2));
	}
}
exports.ByteSize = ByteSize;
function getLargeFileConfirmationLimit(arg) {
	const isRemote = typeof arg === 'string' || arg?.scheme === network_1.Schemas.vscodeRemote;
	const isLocal = typeof arg !== 'string' && arg?.scheme === network_1.Schemas.file;
	if (isLocal) {
		// Local almost has no limit in file size
		return 1024 * ByteSize.MB;
	}
	if (isRemote) {
		// With a remote, pick a low limit to avoid
		// potentially costly file transfers
		return 10 * ByteSize.MB;
	}
	if (platform_1.isWeb) {
		// Web: we cannot know for sure if a cost
		// is associated with the file transfer
		// so we pick a reasonably small limit
		return 50 * ByteSize.MB;
	}
	// Local desktop: almost no limit in file size
	return 1024 * ByteSize.MB;
}
//#endregion
