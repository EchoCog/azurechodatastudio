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
exports.ReplaceInput = void 0;
const dom = __importStar(require("vs/base/browser/dom"));
const toggle_1 = require("vs/base/browser/ui/toggle/toggle");
const inputBox_1 = require("vs/base/browser/ui/inputbox/inputBox");
const widget_1 = require("vs/base/browser/ui/widget");
const codicons_1 = require("vs/base/common/codicons");
const event_1 = require("vs/base/common/event");
require("vs/css!./findInput");
const nls = __importStar(require("vs/nls"));
const NLS_DEFAULT_LABEL = nls.localize('defaultLabel', "input");
const NLS_PRESERVE_CASE_LABEL = nls.localize('label.preserveCaseToggle', "Preserve Case");
class PreserveCaseToggle extends toggle_1.Toggle {
	constructor(opts) {
		super({
			// TODO: does this need its own icon?
			icon: codicons_1.Codicon.preserveCase,
			title: NLS_PRESERVE_CASE_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}
class ReplaceInput extends widget_1.Widget {
	_showOptionButtons;
	static OPTION_CHANGE = 'optionChange';
	contextViewProvider;
	placeholder;
	validation;
	label;
	fixFocusOnOptionClickEnabled = true;
	preserveCase;
	cachedOptionsWidth = 0;
	domNode;
	inputBox;
	_onDidOptionChange = this._register(new event_1.Emitter());
	onDidOptionChange = this._onDidOptionChange.event;
	_onKeyDown = this._register(new event_1.Emitter());
	onKeyDown = this._onKeyDown.event;
	_onMouseDown = this._register(new event_1.Emitter());
	onMouseDown = this._onMouseDown.event;
	_onInput = this._register(new event_1.Emitter());
	onInput = this._onInput.event;
	_onKeyUp = this._register(new event_1.Emitter());
	onKeyUp = this._onKeyUp.event;
	_onPreserveCaseKeyDown = this._register(new event_1.Emitter());
	onPreserveCaseKeyDown = this._onPreserveCaseKeyDown.event;
	constructor(parent, contextViewProvider, _showOptionButtons, options) {
		super();
		this._showOptionButtons = _showOptionButtons;
		this.contextViewProvider = contextViewProvider;
		this.placeholder = options.placeholder || '';
		this.validation = options.validation;
		this.label = options.label || NLS_DEFAULT_LABEL;
		const appendPreserveCaseLabel = options.appendPreserveCaseLabel || '';
		const history = options.history || [];
		const flexibleHeight = !!options.flexibleHeight;
		const flexibleWidth = !!options.flexibleWidth;
		const flexibleMaxHeight = options.flexibleMaxHeight;
		this.domNode = document.createElement('div');
		this.domNode.classList.add('monaco-findInput');
		this.inputBox = this._register(new inputBox_1.HistoryInputBox(this.domNode, this.contextViewProvider, {
			ariaLabel: this.label || '',
			placeholder: this.placeholder || '',
			validationOptions: {
				validation: this.validation
			},
			history,
			showHistoryHint: options.showHistoryHint,
			flexibleHeight,
			flexibleWidth,
			flexibleMaxHeight,
			inputBoxStyles: options.inputBoxStyles
		}));
		this.preserveCase = this._register(new PreserveCaseToggle({
			appendTitle: appendPreserveCaseLabel,
			isChecked: false,
			...options.toggleStyles
		}));
		this._register(this.preserveCase.onChange(viaKeyboard => {
			this._onDidOptionChange.fire(viaKeyboard);
			if (!viaKeyboard && this.fixFocusOnOptionClickEnabled) {
				this.inputBox.focus();
			}
			this.validate();
		}));
		this._register(this.preserveCase.onKeyDown(e => {
			this._onPreserveCaseKeyDown.fire(e);
		}));
		if (this._showOptionButtons) {
			this.cachedOptionsWidth = this.preserveCase.width();
		}
		else {
			this.cachedOptionsWidth = 0;
		}
		// Arrow-Key support to navigate between options
		const indexes = [this.preserveCase.domNode];
		this.onkeydown(this.domNode, (event) => {
			if (event.equals(15 /* KeyCode.LeftArrow */) || event.equals(17 /* KeyCode.RightArrow */) || event.equals(9 /* KeyCode.Escape */)) {
				const index = indexes.indexOf(document.activeElement);
				if (index >= 0) {
					let newIndex = -1;
					if (event.equals(17 /* KeyCode.RightArrow */)) {
						newIndex = (index + 1) % indexes.length;
					}
					else if (event.equals(15 /* KeyCode.LeftArrow */)) {
						if (index === 0) {
							newIndex = indexes.length - 1;
						}
						else {
							newIndex = index - 1;
						}
					}
					if (event.equals(9 /* KeyCode.Escape */)) {
						indexes[index].blur();
						this.inputBox.focus();
					}
					else if (newIndex >= 0) {
						indexes[newIndex].focus();
					}
					dom.EventHelper.stop(event, true);
				}
			}
		});
		const controls = document.createElement('div');
		controls.className = 'controls';
		controls.style.display = this._showOptionButtons ? 'block' : 'none';
		controls.appendChild(this.preserveCase.domNode);
		this.domNode.appendChild(controls);
		parent?.appendChild(this.domNode);
		this.onkeydown(this.inputBox.inputElement, (e) => this._onKeyDown.fire(e));
		this.onkeyup(this.inputBox.inputElement, (e) => this._onKeyUp.fire(e));
		this.oninput(this.inputBox.inputElement, (e) => this._onInput.fire());
		this.onmousedown(this.inputBox.inputElement, (e) => this._onMouseDown.fire(e));
	}
	enable() {
		this.domNode.classList.remove('disabled');
		this.inputBox.enable();
		this.preserveCase.enable();
	}
	disable() {
		this.domNode.classList.add('disabled');
		this.inputBox.disable();
		this.preserveCase.disable();
	}
	setFocusInputOnOptionClick(value) {
		this.fixFocusOnOptionClickEnabled = value;
	}
	setEnabled(enabled) {
		if (enabled) {
			this.enable();
		}
		else {
			this.disable();
		}
	}
	clear() {
		this.clearValidation();
		this.setValue('');
		this.focus();
	}
	getValue() {
		return this.inputBox.value;
	}
	setValue(value) {
		if (this.inputBox.value !== value) {
			this.inputBox.value = value;
		}
	}
	onSearchSubmit() {
		this.inputBox.addToHistory();
	}
	applyStyles() {
	}
	select() {
		this.inputBox.select();
	}
	focus() {
		this.inputBox.focus();
	}
	getPreserveCase() {
		return this.preserveCase.checked;
	}
	setPreserveCase(value) {
		this.preserveCase.checked = value;
	}
	focusOnPreserve() {
		this.preserveCase.focus();
	}
	_lastHighlightFindOptions = 0;
	highlightFindOptions() {
		this.domNode.classList.remove('highlight-' + (this._lastHighlightFindOptions));
		this._lastHighlightFindOptions = 1 - this._lastHighlightFindOptions;
		this.domNode.classList.add('highlight-' + (this._lastHighlightFindOptions));
	}
	validate() {
		this.inputBox?.validate();
	}
	showMessage(message) {
		this.inputBox?.showMessage(message);
	}
	clearMessage() {
		this.inputBox?.hideMessage();
	}
	clearValidation() {
		this.inputBox?.hideMessage();
	}
	set width(newWidth) {
		this.inputBox.paddingRight = this.cachedOptionsWidth;
		this.domNode.style.width = newWidth + 'px';
	}
	dispose() {
		super.dispose();
	}
}
exports.ReplaceInput = ReplaceInput;
