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
var UntitledTextEditorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UntitledTextEditorService = exports.IUntitledTextEditorService = void 0;
const uri_1 = require("vs/base/common/uri");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const untitledTextEditorModel_1 = require("vs/workbench/services/untitled/common/untitledTextEditorModel");
const configuration_1 = require("vs/platform/configuration/common/configuration");
const event_1 = require("vs/base/common/event");
const map_1 = require("vs/base/common/map");
const network_1 = require("vs/base/common/network");
const lifecycle_1 = require("vs/base/common/lifecycle");
const extensions_1 = require("vs/platform/instantiation/common/extensions");
exports.IUntitledTextEditorService = (0, instantiation_1.createDecorator)('untitledTextEditorService');
let UntitledTextEditorService = class UntitledTextEditorService extends lifecycle_1.Disposable {
	static { UntitledTextEditorService_1 = this; }
	instantiationService;
	configurationService;
	static UNTITLED_WITHOUT_ASSOCIATED_RESOURCE_REGEX = /Untitled-\d+/;
	_onDidChangeDirty = this._register(new event_1.Emitter());
	onDidChangeDirty = this._onDidChangeDirty.event;
	_onDidChangeEncoding = this._register(new event_1.Emitter());
	onDidChangeEncoding = this._onDidChangeEncoding.event;
	_onWillDispose = this._register(new event_1.Emitter());
	onWillDispose = this._onWillDispose.event;
	_onDidChangeLabel = this._register(new event_1.Emitter());
	onDidChangeLabel = this._onDidChangeLabel.event;
	mapResourceToModel = new map_1.ResourceMap();
	constructor(instantiationService, configurationService) {
		super();
		this.instantiationService = instantiationService;
		this.configurationService = configurationService;
	}
	get(resource) {
		return this.mapResourceToModel.get(resource);
	}
	getValue(resource) {
		return this.get(resource)?.textEditorModel?.getValue();
	}
	async resolve(options) {
		const model = this.doCreateOrGet(options);
		await model.resolve();
		return model;
	}
	create(options) {
		return this.doCreateOrGet(options);
	}
	doCreateOrGet(options = Object.create(null)) {
		const massagedOptions = this.massageOptions(options);
		// Return existing instance if asked for it
		if (massagedOptions.untitledResource && this.mapResourceToModel.has(massagedOptions.untitledResource)) {
			return this.mapResourceToModel.get(massagedOptions.untitledResource);
		}
		// Create new instance otherwise
		return this.doCreate(massagedOptions);
	}
	massageOptions(options) {
		const massagedOptions = Object.create(null);
		// Figure out associated and untitled resource
		if (options.associatedResource) {
			massagedOptions.untitledResource = uri_1.URI.from({
				scheme: network_1.Schemas.untitled,
				authority: options.associatedResource.authority,
				fragment: options.associatedResource.fragment,
				path: options.associatedResource.path,
				query: options.associatedResource.query
			});
			massagedOptions.associatedResource = options.associatedResource;
		}
		else {
			if (options.untitledResource?.scheme === network_1.Schemas.untitled) {
				massagedOptions.untitledResource = options.untitledResource;
			}
		}
		// Language id
		if (options.languageId) {
			massagedOptions.languageId = options.languageId;
		}
		else if (!massagedOptions.associatedResource) {
			const configuration = this.configurationService.getValue();
			if (configuration.files?.defaultLanguage) {
				massagedOptions.languageId = configuration.files.defaultLanguage;
			}
		}
		// Take over encoding and initial value
		massagedOptions.encoding = options.encoding;
		massagedOptions.initialValue = options.initialValue;
		return massagedOptions;
	}
	doCreate(options) {
		// Create a new untitled resource if none is provided
		let untitledResource = options.untitledResource;
		if (!untitledResource) {
			let counter = 1;
			do {
				untitledResource = uri_1.URI.from({ scheme: network_1.Schemas.untitled, path: `Untitled-${counter}` });
				counter++;
			} while (this.mapResourceToModel.has(untitledResource));
		}
		// Create new model with provided options
		const model = this._register(this.instantiationService.createInstance(untitledTextEditorModel_1.UntitledTextEditorModel, untitledResource, !!options.associatedResource, options.initialValue, options.languageId, options.encoding));
		this.registerModel(model);
		return model;
	}
	registerModel(model) {
		// Install model listeners
		const modelListeners = new lifecycle_1.DisposableStore();
		modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire(model)));
		modelListeners.add(model.onDidChangeName(() => this._onDidChangeLabel.fire(model)));
		modelListeners.add(model.onDidChangeEncoding(() => this._onDidChangeEncoding.fire(model)));
		modelListeners.add(model.onWillDispose(() => this._onWillDispose.fire(model)));
		// Remove from cache on dispose
		event_1.Event.once(model.onWillDispose)(() => {
			// Registry
			this.mapResourceToModel.delete(model.resource);
			// Listeners
			modelListeners.dispose();
		});
		// Add to cache
		this.mapResourceToModel.set(model.resource, model);
		// If the model is dirty right from the beginning,
		// make sure to emit this as an event
		if (model.isDirty()) {
			this._onDidChangeDirty.fire(model);
		}
	}
	isUntitledWithAssociatedResource(resource) {
		return resource.scheme === network_1.Schemas.untitled && resource.path.length > 1 && !UntitledTextEditorService_1.UNTITLED_WITHOUT_ASSOCIATED_RESOURCE_REGEX.test(resource.path);
	}
};
exports.UntitledTextEditorService = UntitledTextEditorService;
exports.UntitledTextEditorService = UntitledTextEditorService = UntitledTextEditorService_1 = __decorate([
	__param(0, instantiation_1.IInstantiationService),
	__param(1, configuration_1.IConfigurationService)
], UntitledTextEditorService);
(0, extensions_1.registerSingleton)(exports.IUntitledTextEditorService, UntitledTextEditorService, 1 /* InstantiationType.Delayed */);
