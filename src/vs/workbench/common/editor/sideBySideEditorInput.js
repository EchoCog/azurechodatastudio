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
var SideBySideEditorInput_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SideBySideEditorInputSerializer = exports.AbstractSideBySideEditorInputSerializer = exports.SideBySideEditorInput = void 0;
const event_1 = require("vs/base/common/event");
const nls_1 = require("vs/nls");
const platform_1 = require("vs/platform/registry/common/platform");
const editor_1 = require("vs/workbench/common/editor");
const editorInput_1 = require("vs/workbench/common/editor/editorInput");
const editorService_1 = require("vs/workbench/services/editor/common/editorService");
/**
 * Side by side editor inputs that have a primary and secondary side.
 */
let SideBySideEditorInput = class SideBySideEditorInput extends editorInput_1.EditorInput {
    static { SideBySideEditorInput_1 = this; }
    preferredName;
    preferredDescription;
    secondary;
    primary;
    editorService;
    static ID = 'workbench.editorinputs.sidebysideEditorInput';
    get typeId() {
        return SideBySideEditorInput_1.ID;
    }
    get capabilities() {
        // Use primary capabilities as main capabilities...
        let capabilities = this.primary.capabilities;
        // ...with the exception of `CanSplitInGroup` which
        // is only relevant to single editors.
        capabilities &= ~32 /* EditorInputCapabilities.CanSplitInGroup */;
        // Trust: should be considered for both sides
        if (this.secondary.hasCapability(16 /* EditorInputCapabilities.RequiresTrust */)) {
            capabilities |= 16 /* EditorInputCapabilities.RequiresTrust */;
        }
        // Singleton: should be considered for both sides
        if (this.secondary.hasCapability(8 /* EditorInputCapabilities.Singleton */)) {
            capabilities |= 8 /* EditorInputCapabilities.Singleton */;
        }
        // Indicate we show more than one editor
        capabilities |= 256 /* EditorInputCapabilities.MultipleEditors */;
        return capabilities;
    }
    get resource() {
        if (this.hasIdenticalSides) {
            // pretend to be just primary side when being asked for a resource
            // in case both sides are the same. this can help when components
            // want to identify this input among others (e.g. in history).
            return this.primary.resource;
        }
        return undefined;
    }
    hasIdenticalSides = this.primary.matches(this.secondary);
    constructor(preferredName, preferredDescription, secondary, primary, editorService) {
        super();
        this.preferredName = preferredName;
        this.preferredDescription = preferredDescription;
        this.secondary = secondary;
        this.primary = primary;
        this.editorService = editorService;
        this.registerListeners();
    }
    registerListeners() {
        // When the primary or secondary input gets disposed, dispose this diff editor input
        this._register(event_1.Event.once(event_1.Event.any(this.primary.onWillDispose, this.secondary.onWillDispose))(() => {
            if (!this.isDisposed()) {
                this.dispose();
            }
        }));
        // Re-emit some events from the primary side to the outside
        this._register(this.primary.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
        // Re-emit some events from both sides to the outside
        this._register(this.primary.onDidChangeCapabilities(() => this._onDidChangeCapabilities.fire()));
        this._register(this.secondary.onDidChangeCapabilities(() => this._onDidChangeCapabilities.fire()));
        this._register(this.primary.onDidChangeLabel(() => this._onDidChangeLabel.fire()));
        this._register(this.secondary.onDidChangeLabel(() => this._onDidChangeLabel.fire()));
    }
    getName() {
        const preferredName = this.getPreferredName();
        if (preferredName) {
            return preferredName;
        }
        if (this.hasIdenticalSides) {
            return this.primary.getName(); // keep name concise when same editor is opened side by side
        }
        return (0, nls_1.localize)('sideBySideLabels', "{0} - {1}", this.secondary.getName(), this.primary.getName());
    }
    getPreferredName() {
        return this.preferredName;
    }
    getDescription(verbosity) {
        const preferredDescription = this.getPreferredDescription();
        if (preferredDescription) {
            return preferredDescription;
        }
        if (this.hasIdenticalSides) {
            return this.primary.getDescription(verbosity);
        }
        return super.getDescription(verbosity);
    }
    getPreferredDescription() {
        return this.preferredDescription;
    }
    getTitle(verbosity) {
        if (this.hasIdenticalSides) {
            return this.primary.getTitle(verbosity) ?? this.getName();
        }
        return super.getTitle(verbosity);
    }
    getLabelExtraClasses() {
        if (this.hasIdenticalSides) {
            return this.primary.getLabelExtraClasses();
        }
        return super.getLabelExtraClasses();
    }
    getAriaLabel() {
        if (this.hasIdenticalSides) {
            return this.primary.getAriaLabel();
        }
        return super.getAriaLabel();
    }
    getTelemetryDescriptor() {
        const descriptor = this.primary.getTelemetryDescriptor();
        return { ...descriptor, ...super.getTelemetryDescriptor() };
    }
    isDirty() {
        return this.primary.isDirty();
    }
    isSaving() {
        return this.primary.isSaving();
    }
    async save(group, options) {
        const primarySaveResult = await this.primary.save(group, options);
        return this.saveResultToEditor(primarySaveResult);
    }
    async saveAs(group, options) {
        const primarySaveResult = await this.primary.saveAs(group, options);
        return this.saveResultToEditor(primarySaveResult);
    }
    saveResultToEditor(primarySaveResult) {
        if (!primarySaveResult || !this.hasIdenticalSides) {
            return primarySaveResult;
        }
        if (this.primary.matches(primarySaveResult)) {
            return this;
        }
        if (primarySaveResult instanceof editorInput_1.EditorInput) {
            return new SideBySideEditorInput_1(this.preferredName, this.preferredDescription, primarySaveResult, primarySaveResult, this.editorService);
        }
        if (!(0, editor_1.isResourceDiffEditorInput)(primarySaveResult) && !(0, editor_1.isResourceSideBySideEditorInput)(primarySaveResult) && !(0, editor_1.isResourceMergeEditorInput)(primarySaveResult)) {
            return {
                primary: primarySaveResult,
                secondary: primarySaveResult,
                label: this.preferredName,
                description: this.preferredDescription
            };
        }
        return undefined;
    }
    revert(group, options) {
        return this.primary.revert(group, options);
    }
    async rename(group, target) {
        if (!this.hasIdenticalSides) {
            return undefined; // currently only enabled when both sides are identical
        }
        // Forward rename to primary side
        const renameResult = await this.primary.rename(group, target);
        if (!renameResult) {
            return undefined;
        }
        // Build a side-by-side result from the rename result
        if ((0, editor_1.isEditorInput)(renameResult.editor)) {
            return {
                editor: new SideBySideEditorInput_1(this.preferredName, this.preferredDescription, renameResult.editor, renameResult.editor, this.editorService),
                options: {
                    ...renameResult.options,
                    viewState: (0, editor_1.findViewStateForEditor)(this, group, this.editorService)
                }
            };
        }
        if ((0, editor_1.isResourceEditorInput)(renameResult.editor)) {
            return {
                editor: {
                    label: this.preferredName,
                    description: this.preferredDescription,
                    primary: renameResult.editor,
                    secondary: renameResult.editor,
                    options: {
                        ...renameResult.options,
                        viewState: (0, editor_1.findViewStateForEditor)(this, group, this.editorService)
                    }
                }
            };
        }
        return undefined;
    }
    isReadonly() {
        return this.primary.isReadonly();
    }
    toUntyped(options) {
        const primaryResourceEditorInput = this.primary.toUntyped(options);
        const secondaryResourceEditorInput = this.secondary.toUntyped(options);
        // Prevent nested side by side editors which are unsupported
        if (primaryResourceEditorInput && secondaryResourceEditorInput &&
            !(0, editor_1.isResourceDiffEditorInput)(primaryResourceEditorInput) && !(0, editor_1.isResourceDiffEditorInput)(secondaryResourceEditorInput) &&
            !(0, editor_1.isResourceSideBySideEditorInput)(primaryResourceEditorInput) && !(0, editor_1.isResourceSideBySideEditorInput)(secondaryResourceEditorInput) &&
            !(0, editor_1.isResourceMergeEditorInput)(primaryResourceEditorInput) && !(0, editor_1.isResourceMergeEditorInput)(secondaryResourceEditorInput)) {
            const untypedInput = {
                label: this.preferredName,
                description: this.preferredDescription,
                primary: primaryResourceEditorInput,
                secondary: secondaryResourceEditorInput
            };
            if (typeof options?.preserveViewState === 'number') {
                untypedInput.options = {
                    viewState: (0, editor_1.findViewStateForEditor)(this, options.preserveViewState, this.editorService)
                };
            }
            return untypedInput;
        }
        return undefined;
    }
    matches(otherInput) {
        if (this === otherInput) {
            return true;
        }
        if ((0, editor_1.isDiffEditorInput)(otherInput) || (0, editor_1.isResourceDiffEditorInput)(otherInput)) {
            return false; // prevent subclass from matching
        }
        if (otherInput instanceof SideBySideEditorInput_1) {
            return this.primary.matches(otherInput.primary) && this.secondary.matches(otherInput.secondary);
        }
        if ((0, editor_1.isResourceSideBySideEditorInput)(otherInput)) {
            return this.primary.matches(otherInput.primary) && this.secondary.matches(otherInput.secondary);
        }
        return false;
    }
};
exports.SideBySideEditorInput = SideBySideEditorInput;
exports.SideBySideEditorInput = SideBySideEditorInput = SideBySideEditorInput_1 = __decorate([
    __param(4, editorService_1.IEditorService)
], SideBySideEditorInput);
class AbstractSideBySideEditorInputSerializer {
    canSerialize(editorInput) {
        const input = editorInput;
        if (input.primary && input.secondary) {
            const [secondaryInputSerializer, primaryInputSerializer] = this.getSerializers(input.secondary.typeId, input.primary.typeId);
            return !!(secondaryInputSerializer?.canSerialize(input.secondary) && primaryInputSerializer?.canSerialize(input.primary));
        }
        return false;
    }
    serialize(editorInput) {
        const input = editorInput;
        if (input.primary && input.secondary) {
            const [secondaryInputSerializer, primaryInputSerializer] = this.getSerializers(input.secondary.typeId, input.primary.typeId);
            if (primaryInputSerializer && secondaryInputSerializer) {
                const primarySerialized = primaryInputSerializer.serialize(input.primary);
                const secondarySerialized = secondaryInputSerializer.serialize(input.secondary);
                if (primarySerialized && secondarySerialized) {
                    const serializedEditorInput = {
                        name: input.getPreferredName(),
                        description: input.getPreferredDescription(),
                        primarySerialized: primarySerialized,
                        secondarySerialized: secondarySerialized,
                        primaryTypeId: input.primary.typeId,
                        secondaryTypeId: input.secondary.typeId
                    };
                    return JSON.stringify(serializedEditorInput);
                }
            }
        }
        return undefined;
    }
    deserialize(instantiationService, serializedEditorInput) {
        const deserialized = JSON.parse(serializedEditorInput);
        const [secondaryInputSerializer, primaryInputSerializer] = this.getSerializers(deserialized.secondaryTypeId, deserialized.primaryTypeId);
        if (primaryInputSerializer && secondaryInputSerializer) {
            const primaryInput = primaryInputSerializer.deserialize(instantiationService, deserialized.primarySerialized);
            const secondaryInput = secondaryInputSerializer.deserialize(instantiationService, deserialized.secondarySerialized);
            if (primaryInput instanceof editorInput_1.EditorInput && secondaryInput instanceof editorInput_1.EditorInput) {
                return this.createEditorInput(instantiationService, deserialized.name, deserialized.description, secondaryInput, primaryInput);
            }
        }
        return undefined;
    }
    getSerializers(secondaryEditorInputTypeId, primaryEditorInputTypeId) {
        const registry = platform_1.Registry.as(editor_1.EditorExtensions.EditorFactory);
        return [registry.getEditorSerializer(secondaryEditorInputTypeId), registry.getEditorSerializer(primaryEditorInputTypeId)];
    }
}
exports.AbstractSideBySideEditorInputSerializer = AbstractSideBySideEditorInputSerializer;
class SideBySideEditorInputSerializer extends AbstractSideBySideEditorInputSerializer {
    createEditorInput(instantiationService, name, description, secondaryInput, primaryInput) {
        return instantiationService.createInstance(SideBySideEditorInput, name, description, secondaryInput, primaryInput);
    }
}
exports.SideBySideEditorInputSerializer = SideBySideEditorInputSerializer;
