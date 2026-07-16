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
var BaseTextEditorModel_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseTextEditorModel = void 0;
const editorModel_1 = require("vs/workbench/common/editor/editorModel");
const language_1 = require("vs/editor/common/languages/language");
const model_1 = require("vs/editor/common/services/model");
const lifecycle_1 = require("vs/base/common/lifecycle");
const modesRegistry_1 = require("vs/editor/common/languages/modesRegistry");
const languageDetectionWorkerService_1 = require("vs/workbench/services/languageDetection/common/languageDetectionWorkerService");
const async_1 = require("vs/base/common/async");
const accessibility_1 = require("vs/platform/accessibility/common/accessibility");
const nls_1 = require("vs/nls");
/**
 * The base text editor model leverages the code editor model. This class is only intended to be subclassed and not instantiated.
 */
let BaseTextEditorModel = class BaseTextEditorModel extends editorModel_1.EditorModel {
	static { BaseTextEditorModel_1 = this; }
	modelService;
	languageService;
	languageDetectionService;
	accessibilityService;
	static AUTO_DETECT_LANGUAGE_THROTTLE_DELAY = 600;
	textEditorModelHandle = undefined;
	createdEditorModel;
	modelDisposeListener = this._register(new lifecycle_1.MutableDisposable());
	autoDetectLanguageThrottler = this._register(new async_1.ThrottledDelayer(BaseTextEditorModel_1.AUTO_DETECT_LANGUAGE_THROTTLE_DELAY));
	constructor(modelService, languageService, languageDetectionService, accessibilityService, textEditorModelHandle) {
		super();
		this.modelService = modelService;
		this.languageService = languageService;
		this.languageDetectionService = languageDetectionService;
		this.accessibilityService = accessibilityService;
		if (textEditorModelHandle) {
			this.handleExistingModel(textEditorModelHandle);
		}
	}
	handleExistingModel(textEditorModelHandle) {
		// We need the resource to point to an existing model
		const model = this.modelService.getModel(textEditorModelHandle);
		if (!model) {
			throw new Error(`Document with resource ${textEditorModelHandle.toString(true)} does not exist`);
		}
		this.textEditorModelHandle = textEditorModelHandle;
		// Make sure we clean up when this model gets disposed
		this.registerModelDisposeListener(model);
	}
	registerModelDisposeListener(model) {
		this.modelDisposeListener.value = model.onWillDispose(() => {
			this.textEditorModelHandle = undefined; // make sure we do not dispose code editor model again
			this.dispose();
		});
	}
	get textEditorModel() {
		return this.textEditorModelHandle ? this.modelService.getModel(this.textEditorModelHandle) : null;
	}
	isReadonly() {
		return true;
	}
	_hasLanguageSetExplicitly = false;
	get hasLanguageSetExplicitly() { return this._hasLanguageSetExplicitly; }
	setLanguageId(languageId, source) {
		// Remember that an explicit language was set
		this._hasLanguageSetExplicitly = true;
		this.setLanguageIdInternal(languageId, source);
	}
	setLanguageIdInternal(languageId, source) {
		if (!this.isResolved()) {
			return;
		}
		if (!languageId || languageId === this.textEditorModel.getLanguageId()) {
			return;
		}
		this.textEditorModel.setLanguage(this.languageService.createById(languageId), source);
	}
	installModelListeners(model) {
		// Setup listener for lower level language changes
		const disposable = this._register(model.onDidChangeLanguage((e) => {
			if (e.source === languageDetectionWorkerService_1.LanguageDetectionLanguageEventSource) {
				return;
			}
			this._hasLanguageSetExplicitly = true;
			disposable.dispose();
		}));
	}
	getLanguageId() {
		return this.textEditorModel?.getLanguageId();
	}
	autoDetectLanguage() {
		return this.autoDetectLanguageThrottler.trigger(() => this.doAutoDetectLanguage());
	}
	async doAutoDetectLanguage() {
		if (this.hasLanguageSetExplicitly || // skip detection when the user has made an explicit choice on the language
			!this.textEditorModelHandle || // require a URI to run the detection for
			!this.languageDetectionService.isEnabledForLanguage(this.getLanguageId() ?? modesRegistry_1.PLAINTEXT_LANGUAGE_ID) // require a valid language that is enlisted for detection
		) {
			return;
		}
		const lang = await this.languageDetectionService.detectLanguage(this.textEditorModelHandle);
		const prevLang = this.getLanguageId();
		if (lang && lang !== prevLang && !this.isDisposed()) {
			this.setLanguageIdInternal(lang, languageDetectionWorkerService_1.LanguageDetectionLanguageEventSource);
			const languageName = this.languageService.getLanguageName(lang);
			this.accessibilityService.alert((0, nls_1.localize)('languageAutoDetected', "Language {0} was automatically detected and set as the language mode.", languageName ?? lang));
		}
	}
	/**
	 * Creates the text editor model with the provided value, optional preferred language
	 * (can be comma separated for multiple values) and optional resource URL.
	 */
	createTextEditorModel(value, resource, preferredLanguageId) {
		const firstLineText = this.getFirstLineText(value);
		const languageSelection = this.getOrCreateLanguage(resource, this.languageService, preferredLanguageId, firstLineText);
		return this.doCreateTextEditorModel(value, languageSelection, resource);
	}
	doCreateTextEditorModel(value, languageSelection, resource) {
		let model = resource && this.modelService.getModel(resource);
		if (!model) {
			model = this.modelService.createModel(value, languageSelection, resource);
			this.createdEditorModel = true;
			// Make sure we clean up when this model gets disposed
			this.registerModelDisposeListener(model);
		}
		else {
			this.updateTextEditorModel(value, languageSelection.languageId);
		}
		this.textEditorModelHandle = model.uri;
		return model;
	}
	getFirstLineText(value) {
		// text buffer factory
		const textBufferFactory = value;
		if (typeof textBufferFactory.getFirstLineText === 'function') {
			return textBufferFactory.getFirstLineText(1000 /* ModelConstants.FIRST_LINE_DETECTION_LENGTH_LIMIT */);
		}
		// text model
		const textSnapshot = value;
		return textSnapshot.getLineContent(1).substr(0, 1000 /* ModelConstants.FIRST_LINE_DETECTION_LENGTH_LIMIT */);
	}
	/**
	 * Gets the language for the given identifier. Subclasses can override to provide their own implementation of this lookup.
	 *
	 * @param firstLineText optional first line of the text buffer to set the language on. This can be used to guess a language from content.
	 */
	getOrCreateLanguage(resource, languageService, preferredLanguage, firstLineText) {
		// lookup language via resource path if the provided language is unspecific
		if (!preferredLanguage || preferredLanguage === modesRegistry_1.PLAINTEXT_LANGUAGE_ID) {
			return languageService.createByFilepathOrFirstLine(resource ?? null, firstLineText);
		}
		// otherwise take the preferred language for granted
		return languageService.createById(preferredLanguage);
	}
	/**
	 * Updates the text editor model with the provided value. If the value is the same as the model has, this is a no-op.
	 */
	updateTextEditorModel(newValue, preferredLanguageId) {
		if (!this.isResolved()) {
			return;
		}
		// contents
		if (newValue) {
			this.modelService.updateModel(this.textEditorModel, newValue);
		}
		// language (only if specific and changed)
		if (preferredLanguageId && preferredLanguageId !== modesRegistry_1.PLAINTEXT_LANGUAGE_ID && this.textEditorModel.getLanguageId() !== preferredLanguageId) {
			this.textEditorModel.setLanguage(this.languageService.createById(preferredLanguageId));
		}
	}
	createSnapshot() {
		if (!this.textEditorModel) {
			return null;
		}
		return this.textEditorModel.createSnapshot(true /* preserve BOM */);
	}
	isResolved() {
		return !!this.textEditorModelHandle;
	}
	dispose() {
		this.modelDisposeListener.dispose(); // dispose this first because it will trigger another dispose() otherwise
		if (this.textEditorModelHandle && this.createdEditorModel) {
			this.modelService.destroyModel(this.textEditorModelHandle);
		}
		this.textEditorModelHandle = undefined;
		this.createdEditorModel = false;
		super.dispose();
	}
};
exports.BaseTextEditorModel = BaseTextEditorModel;
exports.BaseTextEditorModel = BaseTextEditorModel = BaseTextEditorModel_1 = __decorate([
	__param(0, model_1.IModelService),
	__param(1, language_1.ILanguageService),
	__param(2, languageDetectionWorkerService_1.ILanguageDetectionService),
	__param(3, accessibility_1.IAccessibilityService)
], BaseTextEditorModel);
