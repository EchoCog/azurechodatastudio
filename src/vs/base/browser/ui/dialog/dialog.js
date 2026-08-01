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
exports.Dialog = void 0;
const dom_1 = require("vs/base/browser/dom");
const keyboardEvent_1 = require("vs/base/browser/keyboardEvent");
const actionbar_1 = require("vs/base/browser/ui/actionbar/actionbar");
const button_1 = require("vs/base/browser/ui/button/button");
const toggle_1 = require("vs/base/browser/ui/toggle/toggle");
const inputBox_1 = require("vs/base/browser/ui/inputbox/inputBox");
const actions_1 = require("vs/base/common/actions");
const codicons_1 = require("vs/base/common/codicons");
const themables_1 = require("vs/base/common/themables");
const labels_1 = require("vs/base/common/labels");
const lifecycle_1 = require("vs/base/common/lifecycle");
const platform_1 = require("vs/base/common/platform");
require("vs/css!./dialog");
const nls = __importStar(require("vs/nls"));
class Dialog extends lifecycle_1.Disposable {
	container;
	message;
	options;
	element;
	shadowElement;
	modalElement;
	buttonsContainer;
	messageDetailElement;
	messageContainer;
	iconElement;
	checkbox;
	toolbarContainer;
	buttonBar;
	focusToReturn;
	inputs;
	buttons;
	buttonStyles;
	constructor(container, message, buttons, options) {
		super();
		this.container = container;
		this.message = message;
		this.options = options;
		this.modalElement = this.container.appendChild((0, dom_1.$)(`.monaco-dialog-modal-block.dimmed`));
		this.shadowElement = this.modalElement.appendChild((0, dom_1.$)('.dialog-shadow'));
		this.element = this.shadowElement.appendChild((0, dom_1.$)('.monaco-dialog-box'));
		this.element.setAttribute('role', 'dialog');
		this.element.tabIndex = -1;
		(0, dom_1.hide)(this.element);
		this.buttonStyles = options.buttonStyles;
		if (Array.isArray(buttons) && buttons.length > 0) {
			this.buttons = buttons;
		}
		else if (!this.options.disableDefaultAction) {
			this.buttons = [nls.localize('ok', "OK")];
		}
		else {
			this.buttons = [];
		}
		const buttonsRowElement = this.element.appendChild((0, dom_1.$)('.dialog-buttons-row'));
		this.buttonsContainer = buttonsRowElement.appendChild((0, dom_1.$)('.dialog-buttons'));
		const messageRowElement = this.element.appendChild((0, dom_1.$)('.dialog-message-row'));
		this.iconElement = messageRowElement.appendChild((0, dom_1.$)('#monaco-dialog-icon.dialog-icon'));
		this.iconElement.setAttribute('aria-label', this.getIconAriaLabel());
		this.messageContainer = messageRowElement.appendChild((0, dom_1.$)('.dialog-message-container'));
		if (this.options.detail || this.options.renderBody) {
			const messageElement = this.messageContainer.appendChild((0, dom_1.$)('.dialog-message'));
			const messageTextElement = messageElement.appendChild((0, dom_1.$)('#monaco-dialog-message-text.dialog-message-text'));
			messageTextElement.innerText = this.message;
		}
		this.messageDetailElement = this.messageContainer.appendChild((0, dom_1.$)('#monaco-dialog-message-detail.dialog-message-detail'));
		if (this.options.detail || !this.options.renderBody) {
			this.messageDetailElement.innerText = this.options.detail ? this.options.detail : message;
		}
		else {
			this.messageDetailElement.style.display = 'none';
		}
		if (this.options.renderBody) {
			const customBody = this.messageContainer.appendChild((0, dom_1.$)('#monaco-dialog-message-body.dialog-message-body'));
			this.options.renderBody(customBody);
			for (const el of this.messageContainer.querySelectorAll('a')) {
				el.tabIndex = 0;
			}
		}
		if (this.options.inputs) {
			this.inputs = this.options.inputs.map(input => {
				const inputRowElement = this.messageContainer.appendChild((0, dom_1.$)('.dialog-message-input'));
				const inputBox = this._register(new inputBox_1.InputBox(inputRowElement, undefined, {
					placeholder: input.placeholder,
					type: input.type ?? 'text',
					inputBoxStyles: options.inputBoxStyles
				}));
				if (input.value) {
					inputBox.value = input.value;
				}
				return inputBox;
			});
		}
		else {
			this.inputs = [];
		}
		if (this.options.checkboxLabel) {
			const checkboxRowElement = this.messageContainer.appendChild((0, dom_1.$)('.dialog-checkbox-row'));
			const checkbox = this.checkbox = this._register(new toggle_1.Checkbox(this.options.checkboxLabel, !!this.options.checkboxChecked, options.checkboxStyles));
			checkboxRowElement.appendChild(checkbox.domNode);
			const checkboxMessageElement = checkboxRowElement.appendChild((0, dom_1.$)('.dialog-checkbox-message'));
			checkboxMessageElement.innerText = this.options.checkboxLabel;
			this._register((0, dom_1.addDisposableListener)(checkboxMessageElement, dom_1.EventType.CLICK, () => checkbox.checked = !checkbox.checked));
		}
		const toolbarRowElement = this.element.appendChild((0, dom_1.$)('.dialog-toolbar-row'));
		this.toolbarContainer = toolbarRowElement.appendChild((0, dom_1.$)('.dialog-toolbar'));
		this.applyStyles();
	}
	getIconAriaLabel() {
		let typeLabel = nls.localize('dialogInfoMessage', 'Info');
		switch (this.options.type) {
			case 'error':
				typeLabel = nls.localize('dialogErrorMessage', 'Error');
				break;
			case 'warning':
				typeLabel = nls.localize('dialogWarningMessage', 'Warning');
				break;
			case 'pending':
				typeLabel = nls.localize('dialogPendingMessage', 'In Progress');
				break;
			case 'none':
			case 'info':
			case 'question':
			default:
				break;
		}
		return typeLabel;
	}
	updateMessage(message) {
		this.messageDetailElement.innerText = message;
	}
	async show() {
		this.focusToReturn = document.activeElement;
		return new Promise((resolve) => {
			(0, dom_1.clearNode)(this.buttonsContainer);
			const buttonBar = this.buttonBar = this._register(new button_1.ButtonBar(this.buttonsContainer));
			const buttonMap = this.rearrangeButtons(this.buttons, this.options.cancelId);
			// Handle button clicks
			buttonMap.forEach((entry, index) => {
				const primary = buttonMap[index].index === 0;
				const button = this.options.buttonDetails ? this._register(buttonBar.addButtonWithDescription({ title: true, secondary: !primary, ...this.buttonStyles })) : this._register(buttonBar.addButton({ title: true, secondary: !primary, ...this.buttonStyles }));
				button.label = (0, labels_1.mnemonicButtonLabel)(buttonMap[index].label, true);
				if (button instanceof button_1.ButtonWithDescription) {
					button.description = this.options.buttonDetails[buttonMap[index].index];
				}
				this._register(button.onDidClick(e => {
					if (e) {
						dom_1.EventHelper.stop(e);
					}
					resolve({
						button: buttonMap[index].index,
						checkboxChecked: this.checkbox ? this.checkbox.checked : undefined,
						values: this.inputs.length > 0 ? this.inputs.map(input => input.value) : undefined
					});
				}));
			});
			// Handle keyboard events globally: Tab, Arrow-Left/Right
			this._register((0, dom_1.addDisposableListener)(window, 'keydown', e => {
				const evt = new keyboardEvent_1.StandardKeyboardEvent(e);
				if (evt.equals(512 /* KeyMod.Alt */)) {
					evt.preventDefault();
				}
				if (evt.equals(3 /* KeyCode.Enter */)) {
					// Enter in input field should OK the dialog
					if (this.inputs.some(input => input.hasFocus())) {
						dom_1.EventHelper.stop(e);
						resolve({
							button: buttonMap.find(button => button.index !== this.options.cancelId)?.index ?? 0,
							checkboxChecked: this.checkbox ? this.checkbox.checked : undefined,
							values: this.inputs.length > 0 ? this.inputs.map(input => input.value) : undefined
						});
					}
					return; // leave default handling
				}
				if (evt.equals(10 /* KeyCode.Space */)) {
					return; // leave default handling
				}
				let eventHandled = false;
				// Focus: Next / Previous
				if (evt.equals(2 /* KeyCode.Tab */) || evt.equals(17 /* KeyCode.RightArrow */) || evt.equals(1024 /* KeyMod.Shift */ | 2 /* KeyCode.Tab */) || evt.equals(15 /* KeyCode.LeftArrow */)) {
					// Build a list of focusable elements in their visual order
					const focusableElements = [];
					let focusedIndex = -1;
					if (this.messageContainer) {
						const links = this.messageContainer.querySelectorAll('a');
						for (const link of links) {
							focusableElements.push(link);
							if (link === document.activeElement) {
								focusedIndex = focusableElements.length - 1;
							}
						}
					}
					for (const input of this.inputs) {
						focusableElements.push(input);
						if (input.hasFocus()) {
							focusedIndex = focusableElements.length - 1;
						}
					}
					if (this.checkbox) {
						focusableElements.push(this.checkbox);
						if (this.checkbox.hasFocus()) {
							focusedIndex = focusableElements.length - 1;
						}
					}
					if (this.buttonBar) {
						for (const button of this.buttonBar.buttons) {
							focusableElements.push(button);
							if (button.hasFocus()) {
								focusedIndex = focusableElements.length - 1;
							}
						}
					}
					// Focus next element (with wrapping)
					if (evt.equals(2 /* KeyCode.Tab */) || evt.equals(17 /* KeyCode.RightArrow */)) {
						if (focusedIndex === -1) {
							focusedIndex = 0; // default to focus first element if none have focus
						}
						const newFocusedIndex = (focusedIndex + 1) % focusableElements.length;
						focusableElements[newFocusedIndex].focus();
					}
					// Focus previous element (with wrapping)
					else {
						if (focusedIndex === -1) {
							focusedIndex = focusableElements.length; // default to focus last element if none have focus
						}
						let newFocusedIndex = focusedIndex - 1;
						if (newFocusedIndex === -1) {
							newFocusedIndex = focusableElements.length - 1;
						}
						focusableElements[newFocusedIndex].focus();
					}
					eventHandled = true;
				}
				if (eventHandled) {
					dom_1.EventHelper.stop(e, true);
				}
				else if (this.options.keyEventProcessor) {
					this.options.keyEventProcessor(evt);
				}
			}, true));
			this._register((0, dom_1.addDisposableListener)(window, 'keyup', e => {
				dom_1.EventHelper.stop(e, true);
				const evt = new keyboardEvent_1.StandardKeyboardEvent(e);
				if (!this.options.disableCloseAction && evt.equals(9 /* KeyCode.Escape */)) {
					resolve({
						button: this.options.cancelId || 0,
						checkboxChecked: this.checkbox ? this.checkbox.checked : undefined
					});
				}
			}, true));
			// Detect focus out
			this._register((0, dom_1.addDisposableListener)(this.element, 'focusout', e => {
				if (!!e.relatedTarget && !!this.element) {
					if (!(0, dom_1.isAncestor)(e.relatedTarget, this.element)) {
						this.focusToReturn = e.relatedTarget;
						if (e.target) {
							e.target.focus();
							dom_1.EventHelper.stop(e, true);
						}
					}
				}
			}, false));
			const spinModifierClassName = 'codicon-modifier-spin';
			this.iconElement.classList.remove(...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.dialogError), ...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.dialogWarning), ...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.dialogInfo), ...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.loading), spinModifierClassName);
			if (this.options.icon) {
				this.iconElement.classList.add(...themables_1.ThemeIcon.asClassNameArray(this.options.icon));
			}
			else {
				switch (this.options.type) {
					case 'error':
						this.iconElement.classList.add(...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.dialogError));
						break;
					case 'warning':
						this.iconElement.classList.add(...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.dialogWarning));
						break;
					case 'pending':
						this.iconElement.classList.add(...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.loading), spinModifierClassName);
						break;
					case 'none':
						this.iconElement.classList.add('no-codicon');
						break;
					case 'info':
					case 'question':
					default:
						this.iconElement.classList.add(...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.dialogInfo));
						break;
				}
			}
			if (!this.options.disableCloseAction) {
				const actionBar = this._register(new actionbar_1.ActionBar(this.toolbarContainer, {}));
				const action = this._register(new actions_1.Action('dialog.close', nls.localize('dialogClose', "Close Dialog"), themables_1.ThemeIcon.asClassName(codicons_1.Codicon.dialogClose), true, async () => {
					resolve({
						button: this.options.cancelId || 0,
						checkboxChecked: this.checkbox ? this.checkbox.checked : undefined
					});
				}));
				actionBar.push(action, { icon: true, label: false });
			}
			this.applyStyles();
			this.element.setAttribute('aria-modal', 'true');
			this.element.setAttribute('aria-labelledby', 'monaco-dialog-icon monaco-dialog-message-text');
			this.element.setAttribute('aria-describedby', 'monaco-dialog-icon monaco-dialog-message-text monaco-dialog-message-detail monaco-dialog-message-body');
			(0, dom_1.show)(this.element);
			// Focus first element (input or button)
			if (this.inputs.length > 0) {
				this.inputs[0].focus();
				this.inputs[0].select();
			}
			else {
				buttonMap.forEach((value, index) => {
					if (value.index === 0) {
						buttonBar.buttons[index].focus();
					}
				});
			}
		});
	}
	applyStyles() {
		const style = this.options.dialogStyles;
		const fgColor = style.dialogForeground;
		const bgColor = style.dialogBackground;
		const shadowColor = style.dialogShadow ? `0 0px 8px ${style.dialogShadow}` : '';
		const border = style.dialogBorder ? `1px solid ${style.dialogBorder}` : '';
		const linkFgColor = style.textLinkForeground;
		this.shadowElement.style.boxShadow = shadowColor;
		this.element.style.color = fgColor ?? '';
		this.element.style.backgroundColor = bgColor ?? '';
		this.element.style.border = border;
		// TODO fix
		// if (fgColor && bgColor) {
		// 	const messageDetailColor = fgColor.transparent(.9);
		// 	this.messageDetailElement.style.mixBlendMode = messageDetailColor.makeOpaque(bgColor).toString();
		// }
		if (linkFgColor) {
			for (const el of this.messageContainer.getElementsByTagName('a')) {
				el.style.color = linkFgColor;
			}
		}
		let color;
		switch (this.options.type) {
			case 'error':
				color = style.errorIconForeground;
				break;
			case 'warning':
				color = style.warningIconForeground;
				break;
			default:
				color = style.infoIconForeground;
				break;
		}
		if (color) {
			this.iconElement.style.color = color;
		}
	}
	dispose() {
		super.dispose();
		if (this.modalElement) {
			this.modalElement.remove();
			this.modalElement = undefined;
		}
		if (this.focusToReturn && (0, dom_1.isAncestor)(this.focusToReturn, document.body)) {
			this.focusToReturn.focus();
			this.focusToReturn = undefined;
		}
	}
	rearrangeButtons(buttons, cancelId) {
		// Maps each button to its current label and old index
		// so that when we move them around it's not a problem
		const buttonMap = buttons.map((label, index) => ({ label, index }));
		if (buttons.length < 2) {
			return buttonMap; // only need to rearrange if there are 2+ buttons
		}
		if (platform_1.isMacintosh || platform_1.isLinux) {
			// Linux: the GNOME HIG (https://developer.gnome.org/hig/patterns/feedback/dialogs.html?highlight=dialog)
			// recommend the following:
			// "Always ensure that the cancel button appears first, before the affirmative button. In left-to-right
			//  locales, this is on the left. This button order ensures that users become aware of, and are reminded
			//  of, the ability to cancel prior to encountering the affirmative button."
			// macOS: the HIG (https://developer.apple.com/design/human-interface-guidelines/components/presentation/alerts)
			// recommend the following:
			// "Place buttons where people expect. In general, place the button people are most likely to choose on the trailing side in a
			//  row of buttons or at the top in a stack of buttons. Always place the default button on the trailing side of a row or at the
			//  top of a stack. Cancel buttons are typically on the leading side of a row or at the bottom of a stack."
			if (typeof cancelId === 'number' && buttonMap[cancelId]) {
				const cancelButton = buttonMap.splice(cancelId, 1)[0];
				buttonMap.splice(1, 0, cancelButton);
			}
			buttonMap.reverse();
		}
		else if (platform_1.isWindows) {
			// Windows: the HIG (https://learn.microsoft.com/en-us/windows/win32/uxguide/win-dialog-box)
			// recommend the following:
			// "One of the following sets of concise commands: Yes/No, Yes/No/Cancel, [Do it]/Cancel,
			//  [Do it]/[Don't do it], [Do it]/[Don't do it]/Cancel."
			if (typeof cancelId === 'number' && buttonMap[cancelId]) {
				const cancelButton = buttonMap.splice(cancelId, 1)[0];
				buttonMap.push(cancelButton);
			}
		}
		return buttonMap;
	}
}
exports.Dialog = Dialog;
