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
exports.OVERRIDE_PROPERTY_REGEX = exports.OVERRIDE_PROPERTY_PATTERN = exports.configurationDefaultsSchemaId = exports.resourceLanguageSettingsSchemaId = exports.resourceSettings = exports.windowSettings = exports.machineOverridableSettings = exports.machineSettings = exports.applicationSettings = exports.allSettings = exports.Extensions = exports.EditPresentationTypes = void 0;
exports.overrideIdentifiersFromKey = overrideIdentifiersFromKey;
exports.keyFromOverrideIdentifiers = keyFromOverrideIdentifiers;
exports.getDefaultValue = getDefaultValue;
exports.validateProperty = validateProperty;
exports.getScopes = getScopes;
const arrays_1 = require("vs/base/common/arrays");
const event_1 = require("vs/base/common/event");
const types = __importStar(require("vs/base/common/types"));
const nls = __importStar(require("vs/nls"));
const configuration_1 = require("vs/platform/configuration/common/configuration");
const jsonContributionRegistry_1 = require("vs/platform/jsonschemas/common/jsonContributionRegistry");
const platform_1 = require("vs/platform/registry/common/platform");
var EditPresentationTypes;
(function (EditPresentationTypes) {
	EditPresentationTypes["Multiline"] = "multilineText";
	EditPresentationTypes["Singleline"] = "singlelineText";
})(EditPresentationTypes || (exports.EditPresentationTypes = EditPresentationTypes = {}));
exports.Extensions = {
	Configuration: 'base.contributions.configuration'
};
exports.allSettings = { properties: {}, patternProperties: {} };
exports.applicationSettings = { properties: {}, patternProperties: {} };
exports.machineSettings = { properties: {}, patternProperties: {} };
exports.machineOverridableSettings = { properties: {}, patternProperties: {} };
exports.windowSettings = { properties: {}, patternProperties: {} };
exports.resourceSettings = { properties: {}, patternProperties: {} };
exports.resourceLanguageSettingsSchemaId = 'vscode://schemas/settings/resourceLanguage';
exports.configurationDefaultsSchemaId = 'vscode://schemas/settings/configurationDefaults';
const contributionRegistry = platform_1.Registry.as(jsonContributionRegistry_1.Extensions.JSONContribution);
class ConfigurationRegistry {
	configurationDefaultsOverrides;
	defaultLanguageConfigurationOverridesNode;
	configurationContributors;
	configurationProperties;
	policyConfigurations;
	excludedConfigurationProperties;
	resourceLanguageSettingsSchema;
	overrideIdentifiers = new Set();
	_onDidSchemaChange = new event_1.Emitter();
	onDidSchemaChange = this._onDidSchemaChange.event;
	_onDidUpdateConfiguration = new event_1.Emitter();
	onDidUpdateConfiguration = this._onDidUpdateConfiguration.event;
	constructor() {
		this.configurationDefaultsOverrides = new Map();
		this.defaultLanguageConfigurationOverridesNode = {
			id: 'defaultOverrides',
			title: nls.localize('defaultLanguageConfigurationOverrides.title', "Default Language Configuration Overrides"),
			properties: {}
		};
		this.configurationContributors = [this.defaultLanguageConfigurationOverridesNode];
		this.resourceLanguageSettingsSchema = {
			properties: {},
			patternProperties: {},
			additionalProperties: true,
			allowTrailingCommas: true,
			allowComments: true
		};
		this.configurationProperties = {};
		this.policyConfigurations = new Map();
		this.excludedConfigurationProperties = {};
		contributionRegistry.registerSchema(exports.resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this.registerOverridePropertyPatternKey();
	}
	registerConfiguration(configuration, validate = true) {
		this.registerConfigurations([configuration], validate);
	}
	registerConfigurations(configurations, validate = true) {
		const properties = new Set();
		this.doRegisterConfigurations(configurations, validate, properties);
		contributionRegistry.registerSchema(exports.resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties });
	}
	deregisterConfigurations(configurations) {
		const properties = new Set();
		this.doDeregisterConfigurations(configurations, properties);
		contributionRegistry.registerSchema(exports.resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties });
	}
	updateConfigurations({ add, remove }) {
		const properties = new Set();
		this.doDeregisterConfigurations(remove, properties);
		this.doRegisterConfigurations(add, false, properties);
		contributionRegistry.registerSchema(exports.resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties });
	}
	registerDefaultConfigurations(configurationDefaults) {
		const properties = new Set();
		this.doRegisterDefaultConfigurations(configurationDefaults, properties);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties, defaultsOverrides: true });
	}
	doRegisterDefaultConfigurations(configurationDefaults, bucket) {
		const overrideIdentifiers = [];
		for (const { overrides, source } of configurationDefaults) {
			for (const key in overrides) {
				bucket.add(key);
				if (exports.OVERRIDE_PROPERTY_REGEX.test(key)) {
					const configurationDefaultOverride = this.configurationDefaultsOverrides.get(key);
					const valuesSources = configurationDefaultOverride?.valuesSources ?? new Map();
					if (source) {
						for (const configuration of Object.keys(overrides[key])) {
							valuesSources.set(configuration, source);
						}
					}
					const defaultValue = { ...(configurationDefaultOverride?.value || {}), ...overrides[key] };
					this.configurationDefaultsOverrides.set(key, { source, value: defaultValue, valuesSources });
					const plainKey = (0, configuration_1.getLanguageTagSettingPlainKey)(key);
					const property = {
						type: 'object',
						default: defaultValue,
						description: nls.localize('defaultLanguageConfiguration.description', "Configure settings to be overridden for the {0} language.", plainKey),
						$ref: exports.resourceLanguageSettingsSchemaId,
						defaultDefaultValue: defaultValue,
						source: types.isString(source) ? undefined : source,
						defaultValueSource: source
					};
					overrideIdentifiers.push(...overrideIdentifiersFromKey(key));
					this.configurationProperties[key] = property;
					this.defaultLanguageConfigurationOverridesNode.properties[key] = property;
				}
				else {
					this.configurationDefaultsOverrides.set(key, { value: overrides[key], source });
					const property = this.configurationProperties[key];
					if (property) {
						this.updatePropertyDefaultValue(key, property);
						this.updateSchema(key, property);
					}
				}
			}
		}
		this.doRegisterOverrideIdentifiers(overrideIdentifiers);
	}
	deregisterDefaultConfigurations(defaultConfigurations) {
		const properties = new Set();
		this.doDeregisterDefaultConfigurations(defaultConfigurations, properties);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties, defaultsOverrides: true });
	}
	doDeregisterDefaultConfigurations(defaultConfigurations, bucket) {
		for (const { overrides, source } of defaultConfigurations) {
			for (const key in overrides) {
				const configurationDefaultsOverride = this.configurationDefaultsOverrides.get(key);
				const id = types.isString(source) ? source : source?.id;
				const configurationDefaultsOverrideSourceId = types.isString(configurationDefaultsOverride?.source) ? configurationDefaultsOverride?.source : configurationDefaultsOverride?.source?.id;
				if (id !== configurationDefaultsOverrideSourceId) {
					continue;
				}
				bucket.add(key);
				this.configurationDefaultsOverrides.delete(key);
				if (exports.OVERRIDE_PROPERTY_REGEX.test(key)) {
					delete this.configurationProperties[key];
					delete this.defaultLanguageConfigurationOverridesNode.properties[key];
				}
				else {
					const property = this.configurationProperties[key];
					if (property) {
						this.updatePropertyDefaultValue(key, property);
						this.updateSchema(key, property);
					}
				}
			}
		}
		this.updateOverridePropertyPatternKey();
	}
	deltaConfiguration(delta) {
		// defaults: remove
		let defaultsOverrides = false;
		const properties = new Set();
		if (delta.removedDefaults) {
			this.doDeregisterDefaultConfigurations(delta.removedDefaults, properties);
			defaultsOverrides = true;
		}
		// defaults: add
		if (delta.addedDefaults) {
			this.doRegisterDefaultConfigurations(delta.addedDefaults, properties);
			defaultsOverrides = true;
		}
		// configurations: remove
		if (delta.removedConfigurations) {
			this.doDeregisterConfigurations(delta.removedConfigurations, properties);
		}
		// configurations: add
		if (delta.addedConfigurations) {
			this.doRegisterConfigurations(delta.addedConfigurations, false, properties);
		}
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties, defaultsOverrides });
	}
	notifyConfigurationSchemaUpdated(...configurations) {
		this._onDidSchemaChange.fire();
	}
	registerOverrideIdentifiers(overrideIdentifiers) {
		this.doRegisterOverrideIdentifiers(overrideIdentifiers);
		this._onDidSchemaChange.fire();
	}
	doRegisterOverrideIdentifiers(overrideIdentifiers) {
		for (const overrideIdentifier of overrideIdentifiers) {
			this.overrideIdentifiers.add(overrideIdentifier);
		}
		this.updateOverridePropertyPatternKey();
	}
	doRegisterConfigurations(configurations, validate, bucket) {
		configurations.forEach(configuration => {
			this.validateAndRegisterProperties(configuration, validate, configuration.extensionInfo, configuration.restrictedProperties, undefined, bucket);
			this.configurationContributors.push(configuration);
			this.registerJSONConfiguration(configuration);
		});
	}
	doDeregisterConfigurations(configurations, bucket) {
		const deregisterConfiguration = (configuration) => {
			if (configuration.properties) {
				for (const key in configuration.properties) {
					bucket.add(key);
					const property = this.configurationProperties[key];
					if (property?.policy?.name) {
						this.policyConfigurations.delete(property.policy.name);
					}
					delete this.configurationProperties[key];
					this.removeFromSchema(key, configuration.properties[key]);
				}
			}
			configuration.allOf?.forEach(node => deregisterConfiguration(node));
		};
		for (const configuration of configurations) {
			deregisterConfiguration(configuration);
			const index = this.configurationContributors.indexOf(configuration);
			if (index !== -1) {
				this.configurationContributors.splice(index, 1);
			}
		}
	}
	validateAndRegisterProperties(configuration, validate = true, extensionInfo, restrictedProperties, scope = 3 /* ConfigurationScope.WINDOW */, bucket) {
		scope = types.isUndefinedOrNull(configuration.scope) ? scope : configuration.scope;
		const properties = configuration.properties;
		if (properties) {
			for (const key in properties) {
				const property = properties[key];
				if (validate && validateProperty(key, property)) {
					delete properties[key];
					continue;
				}
				property.source = extensionInfo;
				// update default value
				property.defaultDefaultValue = properties[key].default;
				this.updatePropertyDefaultValue(key, property);
				// update scope
				if (exports.OVERRIDE_PROPERTY_REGEX.test(key)) {
					property.scope = undefined; // No scope for overridable properties `[${identifier}]`
				}
				else {
					property.scope = types.isUndefinedOrNull(property.scope) ? scope : property.scope;
					property.restricted = types.isUndefinedOrNull(property.restricted) ? !!restrictedProperties?.includes(key) : property.restricted;
				}
				// Add to properties maps
				// Property is included by default if 'included' is unspecified
				if (properties[key].hasOwnProperty('included') && !properties[key].included) {
					this.excludedConfigurationProperties[key] = properties[key];
					delete properties[key];
					continue;
				}
				else {
					this.configurationProperties[key] = properties[key];
					if (properties[key].policy?.name) {
						this.policyConfigurations.set(properties[key].policy.name, key);
					}
				}
				if (!properties[key].deprecationMessage && properties[key].markdownDeprecationMessage) {
					// If not set, default deprecationMessage to the markdown source
					properties[key].deprecationMessage = properties[key].markdownDeprecationMessage;
				}
				bucket.add(key);
			}
		}
		const subNodes = configuration.allOf;
		if (subNodes) {
			for (const node of subNodes) {
				this.validateAndRegisterProperties(node, validate, extensionInfo, restrictedProperties, scope, bucket);
			}
		}
	}
	// TODO: @sandy081 - Remove this method and include required info in getConfigurationProperties
	getConfigurations() {
		return this.configurationContributors;
	}
	getConfigurationProperties() {
		return this.configurationProperties;
	}
	getPolicyConfigurations() {
		return this.policyConfigurations;
	}
	getExcludedConfigurationProperties() {
		return this.excludedConfigurationProperties;
	}
	getConfigurationDefaultsOverrides() {
		return this.configurationDefaultsOverrides;
	}
	registerJSONConfiguration(configuration) {
		const register = (configuration) => {
			const properties = configuration.properties;
			if (properties) {
				for (const key in properties) {
					this.updateSchema(key, properties[key]);
				}
			}
			const subNodes = configuration.allOf;
			subNodes?.forEach(register);
		};
		register(configuration);
	}
	updateSchema(key, property) {
		exports.allSettings.properties[key] = property;
		switch (property.scope) {
			case 1 /* ConfigurationScope.APPLICATION */:
				exports.applicationSettings.properties[key] = property;
				break;
			case 2 /* ConfigurationScope.MACHINE */:
				exports.machineSettings.properties[key] = property;
				break;
			case 6 /* ConfigurationScope.MACHINE_OVERRIDABLE */:
				exports.machineOverridableSettings.properties[key] = property;
				break;
			case 3 /* ConfigurationScope.WINDOW */:
				exports.windowSettings.properties[key] = property;
				break;
			case 4 /* ConfigurationScope.RESOURCE */:
				exports.resourceSettings.properties[key] = property;
				break;
			case 5 /* ConfigurationScope.LANGUAGE_OVERRIDABLE */:
				exports.resourceSettings.properties[key] = property;
				this.resourceLanguageSettingsSchema.properties[key] = property;
				break;
		}
	}
	removeFromSchema(key, property) {
		delete exports.allSettings.properties[key];
		switch (property.scope) {
			case 1 /* ConfigurationScope.APPLICATION */:
				delete exports.applicationSettings.properties[key];
				break;
			case 2 /* ConfigurationScope.MACHINE */:
				delete exports.machineSettings.properties[key];
				break;
			case 6 /* ConfigurationScope.MACHINE_OVERRIDABLE */:
				delete exports.machineOverridableSettings.properties[key];
				break;
			case 3 /* ConfigurationScope.WINDOW */:
				delete exports.windowSettings.properties[key];
				break;
			case 4 /* ConfigurationScope.RESOURCE */:
			case 5 /* ConfigurationScope.LANGUAGE_OVERRIDABLE */:
				delete exports.resourceSettings.properties[key];
				delete this.resourceLanguageSettingsSchema.properties[key];
				break;
		}
	}
	updateOverridePropertyPatternKey() {
		for (const overrideIdentifier of this.overrideIdentifiers.values()) {
			const overrideIdentifierProperty = `[${overrideIdentifier}]`;
			const resourceLanguagePropertiesSchema = {
				type: 'object',
				description: nls.localize('overrideSettings.defaultDescription', "Configure editor settings to be overridden for a language."),
				errorMessage: nls.localize('overrideSettings.errorMessage', "This setting does not support per-language configuration."),
				$ref: exports.resourceLanguageSettingsSchemaId,
			};
			this.updatePropertyDefaultValue(overrideIdentifierProperty, resourceLanguagePropertiesSchema);
			exports.allSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			exports.applicationSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			exports.machineSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			exports.machineOverridableSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			exports.windowSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			exports.resourceSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
		}
	}
	registerOverridePropertyPatternKey() {
		const resourceLanguagePropertiesSchema = {
			type: 'object',
			description: nls.localize('overrideSettings.defaultDescription', "Configure editor settings to be overridden for a language."),
			errorMessage: nls.localize('overrideSettings.errorMessage', "This setting does not support per-language configuration."),
			$ref: exports.resourceLanguageSettingsSchemaId,
		};
		exports.allSettings.patternProperties[exports.OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		exports.applicationSettings.patternProperties[exports.OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		exports.machineSettings.patternProperties[exports.OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		exports.machineOverridableSettings.patternProperties[exports.OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		exports.windowSettings.patternProperties[exports.OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		exports.resourceSettings.patternProperties[exports.OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		this._onDidSchemaChange.fire();
	}
	updatePropertyDefaultValue(key, property) {
		const configurationdefaultOverride = this.configurationDefaultsOverrides.get(key);
		let defaultValue = configurationdefaultOverride?.value;
		let defaultSource = configurationdefaultOverride?.source;
		if (types.isUndefined(defaultValue)) {
			defaultValue = property.defaultDefaultValue;
			defaultSource = undefined;
		}
		if (types.isUndefined(defaultValue)) {
			defaultValue = getDefaultValue(property.type);
		}
		property.default = defaultValue;
		property.defaultValueSource = defaultSource;
	}
}
const OVERRIDE_IDENTIFIER_PATTERN = `\\[([^\\]]+)\\]`;
const OVERRIDE_IDENTIFIER_REGEX = new RegExp(OVERRIDE_IDENTIFIER_PATTERN, 'g');
exports.OVERRIDE_PROPERTY_PATTERN = `^(${OVERRIDE_IDENTIFIER_PATTERN})+$`;
exports.OVERRIDE_PROPERTY_REGEX = new RegExp(exports.OVERRIDE_PROPERTY_PATTERN);
function overrideIdentifiersFromKey(key) {
	const identifiers = [];
	if (exports.OVERRIDE_PROPERTY_REGEX.test(key)) {
		let matches = OVERRIDE_IDENTIFIER_REGEX.exec(key);
		while (matches?.length) {
			const identifier = matches[1].trim();
			if (identifier) {
				identifiers.push(identifier);
			}
			matches = OVERRIDE_IDENTIFIER_REGEX.exec(key);
		}
	}
	return (0, arrays_1.distinct)(identifiers);
}
function keyFromOverrideIdentifiers(overrideIdentifiers) {
	return overrideIdentifiers.reduce((result, overrideIdentifier) => `${result}[${overrideIdentifier}]`, '');
}
function getDefaultValue(type) {
	const t = Array.isArray(type) ? type[0] : type;
	switch (t) {
		case 'boolean':
			return false;
		case 'integer':
		case 'number':
			return 0;
		case 'string':
			return '';
		case 'array':
			return [];
		case 'object':
			return {};
		default:
			return null;
	}
}
const configurationRegistry = new ConfigurationRegistry();
platform_1.Registry.add(exports.Extensions.Configuration, configurationRegistry);
function validateProperty(property, schema) {
	if (!property.trim()) {
		return nls.localize('config.property.empty', "Cannot register an empty property");
	}
	if (exports.OVERRIDE_PROPERTY_REGEX.test(property)) {
		return nls.localize('config.property.languageDefault', "Cannot register '{0}'. This matches property pattern '\\\\[.*\\\\]$' for describing language specific editor settings. Use 'configurationDefaults' contribution.", property);
	}
	if (configurationRegistry.getConfigurationProperties()[property] !== undefined) {
		return nls.localize('config.property.duplicate', "Cannot register '{0}'. This property is already registered.", property);
	}
	if (schema.policy?.name && configurationRegistry.getPolicyConfigurations().get(schema.policy?.name) !== undefined) {
		return nls.localize('config.policy.duplicate', "Cannot register '{0}'. The associated policy {1} is already registered with {2}.", property, schema.policy?.name, configurationRegistry.getPolicyConfigurations().get(schema.policy?.name));
	}
	return null;
}
function getScopes() {
	const scopes = [];
	const configurationProperties = configurationRegistry.getConfigurationProperties();
	for (const key of Object.keys(configurationProperties)) {
		scopes.push([key, configurationProperties[key].scope]);
	}
	scopes.push(['launch', 4 /* ConfigurationScope.RESOURCE */]);
	scopes.push(['task', 4 /* ConfigurationScope.RESOURCE */]);
	return scopes;
}
