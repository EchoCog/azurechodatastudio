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
exports.IBuiltinExtensionsScannerService = exports.ExtensionIdentifierMap = exports.ExtensionIdentifierSet = exports.ExtensionIdentifier = exports.EXTENSION_CATEGORIES = exports.ALL_EXTENSION_KINDS = exports.ExtensionsPolicy = exports.ExtensionsPolicyKey = exports.UNDEFINED_PUBLISHER = exports.BUILTIN_MANIFEST_CACHE_FILE = exports.USER_MANIFEST_CACHE_FILE = void 0;
exports.getWorkspaceSupportTypeMessage = getWorkspaceSupportTypeMessage;
exports.isApplicationScopedExtension = isApplicationScopedExtension;
exports.isLanguagePackExtension = isLanguagePackExtension;
exports.isAuthenticationProviderExtension = isAuthenticationProviderExtension;
exports.isResolverExtension = isResolverExtension;
const strings = __importStar(require("vs/base/common/strings"));
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const remoteHosts_1 = require("vs/platform/remote/common/remoteHosts");
exports.USER_MANIFEST_CACHE_FILE = 'extensions.user.cache';
exports.BUILTIN_MANIFEST_CACHE_FILE = 'extensions.builtin.cache';
exports.UNDEFINED_PUBLISHER = 'undefined_publisher';
exports.ExtensionsPolicyKey = 'extensions.extensionsPolicy'; // {{SQL CARBON EDIT}} start
var ExtensionsPolicy;
(function (ExtensionsPolicy) {
    ExtensionsPolicy["allowAll"] = "allowAll";
    ExtensionsPolicy["allowNone"] = "allowNone";
    ExtensionsPolicy["allowMicrosoft"] = "allowMicrosoft";
})(ExtensionsPolicy || (exports.ExtensionsPolicy = ExtensionsPolicy = {})); // {{SQL CARBON EDIT}} - End
exports.ALL_EXTENSION_KINDS = ['ui', 'workspace', 'web'];
function getWorkspaceSupportTypeMessage(supportType) {
    if (typeof supportType === 'object' && supportType !== null) {
        if (supportType.supported !== true) {
            return supportType.description;
        }
    }
    return undefined;
}
// {{SQL CARBON EDIT}} - ADS only implemented language pack filtering
exports.EXTENSION_CATEGORIES = [
    // 'Azure',
    // 'Data Science',
    // 'Debuggers',
    // 'Extension Packs',
    // 'Education',
    // 'Formatters',
    // 'Keymaps',
    'Language Packs',
    // 'Linters',
    // 'Machine Learning',
    // 'Notebooks',
    // 'Programming Languages',
    // 'SCM Providers',
    // 'Snippets',
    // 'Testing',
    // 'Themes',
    // 'Visualization',
    // 'Other',
];
/**
 * **!Do not construct directly!**
 *
 * **!Only static methods because it gets serialized!**
 *
 * This represents the "canonical" version for an extension identifier. Extension ids
 * have to be case-insensitive (due to the marketplace), but we must ensure case
 * preservation because the extension API is already public at this time.
 *
 * For example, given an extension with the publisher `"Hello"` and the name `"World"`,
 * its canonical extension identifier is `"Hello.World"`. This extension could be
 * referenced in some other extension's dependencies using the string `"hello.world"`.
 *
 * To make matters more complicated, an extension can optionally have an UUID. When two
 * extensions have the same UUID, they are considered equal even if their identifier is different.
 */
class ExtensionIdentifier {
    value;
    /**
     * Do not use directly. This is public to avoid mangling and thus
     * allow compatibility between running from source and a built version.
     */
    _lower;
    constructor(value) {
        this.value = value;
        this._lower = value.toLowerCase();
    }
    static equals(a, b) {
        if (typeof a === 'undefined' || a === null) {
            return (typeof b === 'undefined' || b === null);
        }
        if (typeof b === 'undefined' || b === null) {
            return false;
        }
        if (typeof a === 'string' || typeof b === 'string') {
            // At least one of the arguments is an extension id in string form,
            // so we have to use the string comparison which ignores case.
            const aValue = (typeof a === 'string' ? a : a.value);
            const bValue = (typeof b === 'string' ? b : b.value);
            return strings.equalsIgnoreCase(aValue, bValue);
        }
        // Now we know both arguments are ExtensionIdentifier
        return (a._lower === b._lower);
    }
    /**
     * Gives the value by which to index (for equality).
     */
    static toKey(id) {
        if (typeof id === 'string') {
            return id.toLowerCase();
        }
        return id._lower;
    }
}
exports.ExtensionIdentifier = ExtensionIdentifier;
class ExtensionIdentifierSet {
    _set = new Set();
    get size() {
        return this._set.size;
    }
    constructor(iterable) {
        if (iterable) {
            for (const value of iterable) {
                this.add(value);
            }
        }
    }
    add(id) {
        this._set.add(ExtensionIdentifier.toKey(id));
    }
    delete(extensionId) {
        return this._set.delete(ExtensionIdentifier.toKey(extensionId));
    }
    has(id) {
        return this._set.has(ExtensionIdentifier.toKey(id));
    }
}
exports.ExtensionIdentifierSet = ExtensionIdentifierSet;
class ExtensionIdentifierMap {
    _map = new Map();
    clear() {
        this._map.clear();
    }
    delete(id) {
        this._map.delete(ExtensionIdentifier.toKey(id));
    }
    get(id) {
        return this._map.get(ExtensionIdentifier.toKey(id));
    }
    has(id) {
        return this._map.has(ExtensionIdentifier.toKey(id));
    }
    set(id, value) {
        this._map.set(ExtensionIdentifier.toKey(id), value);
    }
    values() {
        return this._map.values();
    }
    forEach(callbackfn) {
        this._map.forEach(callbackfn);
    }
    [Symbol.iterator]() {
        return this._map[Symbol.iterator]();
    }
}
exports.ExtensionIdentifierMap = ExtensionIdentifierMap;
function isApplicationScopedExtension(manifest) {
    return isLanguagePackExtension(manifest);
}
function isLanguagePackExtension(manifest) {
    return manifest.contributes && manifest.contributes.localizations ? manifest.contributes.localizations.length > 0 : false;
}
function isAuthenticationProviderExtension(manifest) {
    return manifest.contributes && manifest.contributes.authentication ? manifest.contributes.authentication.length > 0 : false;
}
function isResolverExtension(manifest, remoteAuthority) {
    if (remoteAuthority) {
        const activationEvent = `onResolveRemoteAuthority:${(0, remoteHosts_1.getRemoteName)(remoteAuthority)}`;
        return !!manifest.activationEvents?.includes(activationEvent);
    }
    return false;
}
exports.IBuiltinExtensionsScannerService = (0, instantiation_1.createDecorator)('IBuiltinExtensionsScannerService');
