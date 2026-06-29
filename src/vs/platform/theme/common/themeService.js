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
exports.Themable = exports.Extensions = exports.FolderThemeIcon = exports.FileThemeIcon = exports.IThemeService = void 0;
exports.themeColorFromId = themeColorFromId;
exports.getThemeTypeSelector = getThemeTypeSelector;
exports.registerThemingParticipant = registerThemingParticipant;
const codicons_1 = require("vs/base/common/codicons");
const event_1 = require("vs/base/common/event");
const lifecycle_1 = require("vs/base/common/lifecycle");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const platform = __importStar(require("vs/platform/registry/common/platform"));
const theme_1 = require("vs/platform/theme/common/theme");
exports.IThemeService = (0, instantiation_1.createDecorator)('themeService');
function themeColorFromId(id) {
    return { id };
}
exports.FileThemeIcon = codicons_1.Codicon.file;
exports.FolderThemeIcon = codicons_1.Codicon.folder;
function getThemeTypeSelector(type) {
    switch (type) {
        case theme_1.ColorScheme.DARK: return 'vs-dark';
        case theme_1.ColorScheme.HIGH_CONTRAST_DARK: return 'hc-black';
        case theme_1.ColorScheme.HIGH_CONTRAST_LIGHT: return 'hc-light';
        default: return 'vs';
    }
}
// static theming participant
exports.Extensions = {
    ThemingContribution: 'base.contributions.theming'
};
class ThemingRegistry {
    themingParticipants = [];
    onThemingParticipantAddedEmitter;
    constructor() {
        this.themingParticipants = [];
        this.onThemingParticipantAddedEmitter = new event_1.Emitter();
    }
    onColorThemeChange(participant) {
        this.themingParticipants.push(participant);
        this.onThemingParticipantAddedEmitter.fire(participant);
        return (0, lifecycle_1.toDisposable)(() => {
            const idx = this.themingParticipants.indexOf(participant);
            this.themingParticipants.splice(idx, 1);
        });
    }
    get onThemingParticipantAdded() {
        return this.onThemingParticipantAddedEmitter.event;
    }
    getThemingParticipants() {
        return this.themingParticipants;
    }
}
const themingRegistry = new ThemingRegistry();
platform.Registry.add(exports.Extensions.ThemingContribution, themingRegistry);
function registerThemingParticipant(participant) {
    return themingRegistry.onColorThemeChange(participant);
}
/**
 * Utility base class for all themable components.
 */
class Themable extends lifecycle_1.Disposable {
    themeService;
    theme;
    constructor(themeService) {
        super();
        this.themeService = themeService;
        this.theme = themeService.getColorTheme();
        // Hook up to theme changes
        this._register(this.themeService.onDidColorThemeChange(theme => this.onThemeChange(theme)));
    }
    onThemeChange(theme) {
        this.theme = theme;
        this.updateStyles();
    }
    updateStyles() {
        // Subclasses to override
    }
    getColor(id, modify) {
        let color = this.theme.getColor(id);
        if (color && modify) {
            color = modify(color, this.theme);
        }
        return color ? color.toString() : null;
    }
}
exports.Themable = Themable;
