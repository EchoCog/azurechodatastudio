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
exports.spinningLoading = exports.syncing = exports.gotoNextLocation = exports.gotoPreviousLocation = exports.widgetClose = exports.iconsSchemaId = exports.IconFontDefinition = exports.IconContribution = exports.Extensions = void 0;
exports.registerIcon = registerIcon;
exports.getIconRegistry = getIconRegistry;
const async_1 = require("vs/base/common/async");
const codicons_1 = require("vs/base/common/codicons");
const themables_1 = require("vs/base/common/themables");
const event_1 = require("vs/base/common/event");
const types_1 = require("vs/base/common/types");
const uri_1 = require("vs/base/common/uri");
const nls_1 = require("vs/nls");
const jsonContributionRegistry_1 = require("vs/platform/jsonschemas/common/jsonContributionRegistry");
const platform = __importStar(require("vs/platform/registry/common/platform"));
//  ------ API types
// icon registry
exports.Extensions = {
	IconContribution: 'base.contributions.icons'
};
var IconContribution;
(function (IconContribution) {
	function getDefinition(contribution, registry) {
		let definition = contribution.defaults;
		while (themables_1.ThemeIcon.isThemeIcon(definition)) {
			const c = iconRegistry.getIcon(definition.id);
			if (!c) {
				return undefined;
			}
			definition = c.defaults;
		}
		return definition;
	}
	IconContribution.getDefinition = getDefinition;
})(IconContribution || (exports.IconContribution = IconContribution = {}));
var IconFontDefinition;
(function (IconFontDefinition) {
	function toJSONObject(iconFont) {
		return {
			weight: iconFont.weight,
			style: iconFont.style,
			src: iconFont.src.map(s => ({ format: s.format, location: s.location.toString() }))
		};
	}
	IconFontDefinition.toJSONObject = toJSONObject;
	function fromJSONObject(json) {
		const stringOrUndef = (s) => (0, types_1.isString)(s) ? s : undefined;
		if (json && Array.isArray(json.src) && json.src.every((s) => (0, types_1.isString)(s.format) && (0, types_1.isString)(s.location))) {
			return {
				weight: stringOrUndef(json.weight),
				style: stringOrUndef(json.style),
				src: json.src.map((s) => ({ format: s.format, location: uri_1.URI.parse(s.location) }))
			};
		}
		return undefined;
	}
	IconFontDefinition.fromJSONObject = fromJSONObject;
})(IconFontDefinition || (exports.IconFontDefinition = IconFontDefinition = {}));
class IconRegistry {
	_onDidChange = new event_1.Emitter();
	onDidChange = this._onDidChange.event;
	iconsById;
	iconSchema = {
		definitions: {
			icons: {
				type: 'object',
				properties: {
					fontId: { type: 'string', description: (0, nls_1.localize)('iconDefinition.fontId', 'The id of the font to use. If not set, the font that is defined first is used.') },
					fontCharacter: { type: 'string', description: (0, nls_1.localize)('iconDefinition.fontCharacter', 'The font character associated with the icon definition.') }
				},
				additionalProperties: false,
				defaultSnippets: [{ body: { fontCharacter: '\\\\e030' } }]
			}
		},
		type: 'object',
		properties: {}
	};
	iconReferenceSchema = { type: 'string', pattern: `^${themables_1.ThemeIcon.iconNameExpression}$`, enum: [], enumDescriptions: [] };
	iconFontsById;
	constructor() {
		this.iconsById = {};
		this.iconFontsById = {};
	}
	registerIcon(id, defaults, description, deprecationMessage) {
		const existing = this.iconsById[id];
		if (existing) {
			if (description && !existing.description) {
				existing.description = description;
				this.iconSchema.properties[id].markdownDescription = `${description} $(${id})`;
				const enumIndex = this.iconReferenceSchema.enum.indexOf(id);
				if (enumIndex !== -1) {
					this.iconReferenceSchema.enumDescriptions[enumIndex] = description;
				}
				this._onDidChange.fire();
			}
			return existing;
		}
		const iconContribution = { id, description, defaults, deprecationMessage };
		this.iconsById[id] = iconContribution;
		const propertySchema = { $ref: '#/definitions/icons' };
		if (deprecationMessage) {
			propertySchema.deprecationMessage = deprecationMessage;
		}
		if (description) {
			propertySchema.markdownDescription = `${description}: $(${id})`;
		}
		this.iconSchema.properties[id] = propertySchema;
		this.iconReferenceSchema.enum.push(id);
		this.iconReferenceSchema.enumDescriptions.push(description || '');
		this._onDidChange.fire();
		return { id };
	}
	deregisterIcon(id) {
		delete this.iconsById[id];
		delete this.iconSchema.properties[id];
		const index = this.iconReferenceSchema.enum.indexOf(id);
		if (index !== -1) {
			this.iconReferenceSchema.enum.splice(index, 1);
			this.iconReferenceSchema.enumDescriptions.splice(index, 1);
		}
		this._onDidChange.fire();
	}
	getIcons() {
		return Object.keys(this.iconsById).map(id => this.iconsById[id]);
	}
	getIcon(id) {
		return this.iconsById[id];
	}
	getIconSchema() {
		return this.iconSchema;
	}
	getIconReferenceSchema() {
		return this.iconReferenceSchema;
	}
	registerIconFont(id, definition) {
		const existing = this.iconFontsById[id];
		if (existing) {
			return existing;
		}
		this.iconFontsById[id] = definition;
		this._onDidChange.fire();
		return definition;
	}
	deregisterIconFont(id) {
		delete this.iconFontsById[id];
	}
	getIconFont(id) {
		return this.iconFontsById[id];
	}
	toString() {
		const sorter = (i1, i2) => {
			return i1.id.localeCompare(i2.id);
		};
		const classNames = (i) => {
			while (themables_1.ThemeIcon.isThemeIcon(i.defaults)) {
				i = this.iconsById[i.defaults.id];
			}
			return `codicon codicon-${i ? i.id : ''}`;
		};
		const reference = [];
		reference.push(`| preview     | identifier                        | default codicon ID                | description`);
		reference.push(`| ----------- | --------------------------------- | --------------------------------- | --------------------------------- |`);
		const contributions = Object.keys(this.iconsById).map(key => this.iconsById[key]);
		for (const i of contributions.filter(i => !!i.description).sort(sorter)) {
			reference.push(`|<i class="${classNames(i)}"></i>|${i.id}|${themables_1.ThemeIcon.isThemeIcon(i.defaults) ? i.defaults.id : i.id}|${i.description || ''}|`);
		}
		reference.push(`| preview     | identifier                        `);
		reference.push(`| ----------- | --------------------------------- |`);
		for (const i of contributions.filter(i => !themables_1.ThemeIcon.isThemeIcon(i.defaults)).sort(sorter)) {
			reference.push(`|<i class="${classNames(i)}"></i>|${i.id}|`);
		}
		return reference.join('\n');
	}
}
const iconRegistry = new IconRegistry();
platform.Registry.add(exports.Extensions.IconContribution, iconRegistry);
function registerIcon(id, defaults, description, deprecationMessage) {
	return iconRegistry.registerIcon(id, defaults, description, deprecationMessage);
}
function getIconRegistry() {
	return iconRegistry;
}
function initialize() {
	const codiconFontCharacters = (0, codicons_1.getCodiconFontCharacters)();
	for (const icon in codiconFontCharacters) {
		const fontCharacter = '\\' + codiconFontCharacters[icon].toString(16);
		iconRegistry.registerIcon(icon, { fontCharacter });
	}
}
initialize();
exports.iconsSchemaId = 'vscode://schemas/icons';
const schemaRegistry = platform.Registry.as(jsonContributionRegistry_1.Extensions.JSONContribution);
schemaRegistry.registerSchema(exports.iconsSchemaId, iconRegistry.getIconSchema());
const delayer = new async_1.RunOnceScheduler(() => schemaRegistry.notifySchemaChanged(exports.iconsSchemaId), 200);
iconRegistry.onDidChange(() => {
	if (!delayer.isScheduled()) {
		delayer.schedule();
	}
});
//setTimeout(_ => console.log(iconRegistry.toString()), 5000);
// common icons
exports.widgetClose = registerIcon('widget-close', codicons_1.Codicon.close, (0, nls_1.localize)('widgetClose', 'Icon for the close action in widgets.'));
exports.gotoPreviousLocation = registerIcon('goto-previous-location', codicons_1.Codicon.arrowUp, (0, nls_1.localize)('previousChangeIcon', 'Icon for goto previous editor location.'));
exports.gotoNextLocation = registerIcon('goto-next-location', codicons_1.Codicon.arrowDown, (0, nls_1.localize)('nextChangeIcon', 'Icon for goto next editor location.'));
exports.syncing = themables_1.ThemeIcon.modify(codicons_1.Codicon.sync, 'spin');
exports.spinningLoading = themables_1.ThemeIcon.modify(codicons_1.Codicon.loading, 'spin');
