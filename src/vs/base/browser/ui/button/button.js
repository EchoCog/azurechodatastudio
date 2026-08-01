"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.ButtonBar = exports.ButtonWithDescription = exports.ButtonWithDropdown = exports.Button = exports.unthemedButtonStyles = void 0;
const dom_1 = require("vs/base/browser/dom");
const dompurify_1 = require("vs/base/browser/dompurify/dompurify");
const keyboardEvent_1 = require("vs/base/browser/keyboardEvent");
const markdownRenderer_1 = require("vs/base/browser/markdownRenderer");
const touch_1 = require("vs/base/browser/touch");
const iconLabels_1 = require("vs/base/browser/ui/iconLabel/iconLabels");
const actions_1 = require("vs/base/common/actions");
const codicons_1 = require("vs/base/common/codicons");
const color_1 = require("vs/base/common/color");
const event_1 = require("vs/base/common/event");
const htmlContent_1 = require("vs/base/common/htmlContent");
const lifecycle_1 = require("vs/base/common/lifecycle");
const themables_1 = require("vs/base/common/themables");
require("vs/css!./button");
const nls_1 = require("vs/nls");
exports.unthemedButtonStyles = {
	buttonBackground: '#0E639C',
	buttonHoverBackground: '#006BB3',
	buttonSeparator: color_1.Color.white.toString(),
	buttonForeground: color_1.Color.white.toString(),
	buttonBorder: undefined,
	buttonSecondaryBackground: undefined,
	buttonSecondaryForeground: undefined,
	buttonSecondaryHoverBackground: undefined,
	// {{SQL CARBON EDIT}} - Start
	buttonSecondaryBorder: undefined,
	buttonDisabledBackground: undefined,
	buttonDisabledForeground: undefined,
	buttonDisabledBorder: undefined
	// {{SQL CARBON EDIT}} - End
};
class Button extends lifecycle_1.Disposable {
	options;
	_element;
	_label = '';
	_labelElement;
	_labelShortElement;
	// {{SQL CARBON EDIT}} - Start
	hasIcon = false;
	// {{SQL CARBON EDIT}} - End
	_onDidClick = this._register(new event_1.Emitter());
	get onDidClick() { return this._onDidClick.event; }
	focusTracker;
	constructor(container, options) {
		super();
		this.options = options;
		this._element = document.createElement('a');
		this._element.classList.add('monaco-button');
		this._element.tabIndex = 0;
		this._element.setAttribute('role', 'button');
		this._element.classList.toggle('secondary', !!options.secondary);
		const background = options.secondary ? options.buttonSecondaryBackground : options.buttonBackground;
		const foreground = options.secondary ? options.buttonSecondaryForeground : options.buttonForeground;
		this._element.style.color = foreground || '';
		this._element.style.backgroundColor = background || '';
		if (options.supportShortLabel) {
			this._labelShortElement = document.createElement('div');
			this._labelShortElement.classList.add('monaco-button-label-short');
			this._element.appendChild(this._labelShortElement);
			this._labelElement = document.createElement('div');
			this._labelElement.classList.add('monaco-button-label');
			this._element.appendChild(this._labelElement);
			this._element.classList.add('monaco-text-button-with-short-label');
		}
		container.appendChild(this._element);
		this._register(touch_1.Gesture.addTarget(this._element));
		[dom_1.EventType.CLICK, touch_1.EventType.Tap].forEach(eventType => {
			this._register((0, dom_1.addDisposableListener)(this._element, eventType, e => {
				if (!this.enabled) {
					dom_1.EventHelper.stop(e);
					return;
				}
				this._onDidClick.fire(e);
			}));
		});
		this._register((0, dom_1.addDisposableListener)(this._element, dom_1.EventType.KEY_DOWN, e => {
			const event = new keyboardEvent_1.StandardKeyboardEvent(e);
			let eventHandled = false;
			if (this.enabled && (event.equals(3 /* KeyCode.Enter */) || event.equals(10 /* KeyCode.Space */))) {
				this._onDidClick.fire(e);
				eventHandled = true;
			}
			else if (event.equals(9 /* KeyCode.Escape */)) {
				this._element.blur();
				eventHandled = true;
			}
			if (eventHandled) {
				dom_1.EventHelper.stop(event, true);
			}
		}));
		this._register((0, dom_1.addDisposableListener)(this._element, dom_1.EventType.MOUSE_OVER, e => {
			if (!this._element.classList.contains('disabled')) {
				this.updateBackground(true);
			}
		}));
		this._register((0, dom_1.addDisposableListener)(this._element, dom_1.EventType.MOUSE_OUT, e => {
			this.updateBackground(false); // restore standard styles
		}));
		// Also set hover background when button is focused for feedback
		this.focusTracker = this._register((0, dom_1.trackFocus)(this._element));
		this._register(this.focusTracker.onDidFocus(() => { if (this.enabled) {
			this.updateBackground(true);
		} }));
		this._register(this.focusTracker.onDidBlur(() => { if (this.enabled) {
			this.updateBackground(false);
		} }));
		// {{SQL CARBON EDIT}} - Start
		this.updateStyles();
		// {{SQL CARBON EDIT}} - End
	}
	dispose() {
		super.dispose();
		this._element.remove();
	}
	getContentElements(content) {
		const elements = [];
		for (let segment of (0, iconLabels_1.renderLabelWithIcons)(content)) {
			if (typeof (segment) === 'string') {
				segment = segment.trim();
				// Ignore empty segment
				if (segment === '') {
					continue;
				}
				// Convert string segments to <span> nodes
				const node = document.createElement('span');
				node.textContent = segment;
				elements.push(node);
			}
			else {
				elements.push(segment);
			}
		}
		return elements;
	}
	// {{ SQL CARBON EDIT}} - Mark as protected
	updateBackground(hover) {
		// // {{SQL CARBON EDIT}} - Start
		if (!this.enabled || this.hasIcon) {
			return;
		}
		// {{SQL CARBON EDIT}} - End
		let background;
		if (this.options.secondary) {
			background = hover ? this.options.buttonSecondaryHoverBackground : this.options.buttonSecondaryBackground;
		}
		else {
			background = hover ? this.options.buttonHoverBackground : this.options.buttonBackground;
		}
		if (background) {
			this._element.style.backgroundColor = background;
		}
	}
	// {{SQL CARBON EDIT}} - Start
	updateStyles() {
		let background, foreground, border, fontWeight, fontSize;
		if (this.hasIcon) {
			background = border = 'transparent';
			foreground = 'inherit';
			fontWeight = fontSize = 'inherit';
			this._element.style.backgroundRepeat = 'no-repeat';
		}
		else {
			if (this.enabled) {
				if (this.options.secondary) {
					foreground = this.options.buttonSecondaryForeground;
					background = this.options.buttonSecondaryBackground;
					border = this.options.buttonSecondaryBorder;
				}
				else {
					foreground = this.options.buttonForeground;
					background = this.options.buttonBackground;
					border = this.options.buttonBorder;
				}
			}
			else {
				foreground = this.options.buttonDisabledForeground;
				background = this.options.buttonDisabledBackground;
				border = this.options.buttonDisabledBorder;
			}
			fontWeight = '600';
			fontSize = '12px';
		}
		this._element.style.color = foreground || '';
		this._element.style.backgroundColor = background || '';
		this._element.style.borderWidth = border ? '1px' : '';
		this._element.style.borderStyle = border ? 'solid' : '';
		this._element.style.borderColor = border || '';
		this._element.style.opacity = this.hasIcon ? '' : '1';
		this._element.style.fontWeight = fontWeight;
		this._element.style.fontSize = fontSize;
		this._element.style.borderRadius = '2px';
	}
	// {{SQL CARBON EDIT}} - End
	get element() {
		return this._element;
	}
	set label(value) {
		if (this._label === value) {
			return;
		}
		if ((0, htmlContent_1.isMarkdownString)(this._label) && (0, htmlContent_1.isMarkdownString)(value) && (0, htmlContent_1.markdownStringEqual)(this._label, value)) {
			return;
		}
		this._element.classList.add('monaco-text-button');
		const labelElement = this.options.supportShortLabel ? this._labelElement : this._element;
		if ((0, htmlContent_1.isMarkdownString)(value)) {
			const rendered = (0, markdownRenderer_1.renderMarkdown)(value, { inline: true });
			rendered.dispose();
			// Don't include outer `<p>`
			const root = rendered.element.querySelector('p')?.innerHTML;
			if (root) {
				// Only allow a very limited set of inline html tags
				const sanitized = (0, dompurify_1.sanitize)(root, { ADD_TAGS: ['b', 'i', 'u', 'code', 'span'], ALLOWED_ATTR: ['class'], RETURN_TRUSTED_TYPE: true });
				labelElement.innerHTML = sanitized;
			}
			else {
				(0, dom_1.reset)(labelElement);
			}
		}
		else {
			if (this.options.supportIcons) {
				(0, dom_1.reset)(labelElement, ...this.getContentElements(value));
			}
			else {
				labelElement.textContent = value;
			}
		}
		this._element.setAttribute('aria-label', value); // {{SQL CARBON EDIT}}
		if (typeof this.options.title === 'string') {
			this._element.title = this.options.title;
		}
		else if (this.options.title) {
			this._element.title = (0, markdownRenderer_1.renderStringAsPlaintext)(value);
		}
		this._label = value;
	}
	get label() {
		return this._label;
	}
	set labelShort(value) {
		if (!this.options.supportShortLabel || !this._labelShortElement) {
			return;
		}
		if (this.options.supportIcons) {
			(0, dom_1.reset)(this._labelShortElement, ...this.getContentElements(value));
		}
		else {
			this._labelShortElement.textContent = value;
		}
	}
	// {{SQL CARBON EDIT}} - accept class name directly
	set icon(icon) {
		if (typeof icon === 'string') {
			this._element.classList.add(...icon.split(' '));
		}
		else {
			this._element.classList.add(...themables_1.ThemeIcon.asClassNameArray(icon));
		}
		this.hasIcon = icon !== undefined;
		this.updateStyles();
	}
	// {{SQL CARBON EDIT}} - End
	set enabled(value) {
		if (value) {
			this._element.classList.remove('disabled');
			this._element.setAttribute('aria-disabled', String(false));
			this._element.tabIndex = 0;
		}
		else {
			this._element.classList.add('disabled');
			this._element.setAttribute('aria-disabled', String(true));
			(0, dom_1.removeTabIndexAndUpdateFocus)(this._element); // {{SQL CARBON EDIT}} - remove tabindex when disabled otherwise disabled control is still keyboard focusable.
		}
		// {{SQL CARBON EDIT}} - Start
		this.updateStyles();
		// {{SQL CARBON EDIT}} - End
	}
	get enabled() {
		return !this._element.classList.contains('disabled');
	}
	focus() {
		this._element.focus();
	}
	hasFocus() {
		return this._element === document.activeElement;
	}
}
exports.Button = Button;
class ButtonWithDropdown extends lifecycle_1.Disposable {
	button;
	action;
	dropdownButton;
	separatorContainer;
	separator;
	element;
	_onDidClick = this._register(new event_1.Emitter());
	onDidClick = this._onDidClick.event;
	constructor(container, options) {
		super();
		this.element = document.createElement('div');
		this.element.classList.add('monaco-button-dropdown');
		container.appendChild(this.element);
		this.button = this._register(new Button(this.element, options));
		this._register(this.button.onDidClick(e => this._onDidClick.fire(e)));
		this.action = this._register(new actions_1.Action('primaryAction', (0, markdownRenderer_1.renderStringAsPlaintext)(this.button.label), undefined, true, async () => this._onDidClick.fire(undefined)));
		this.separatorContainer = document.createElement('div');
		this.separatorContainer.classList.add('monaco-button-dropdown-separator');
		this.separator = document.createElement('div');
		this.separatorContainer.appendChild(this.separator);
		this.element.appendChild(this.separatorContainer);
		// Separator styles
		const border = options.buttonBorder;
		if (border) {
			this.separatorContainer.style.borderTop = '1px solid ' + border;
			this.separatorContainer.style.borderBottom = '1px solid ' + border;
		}
		const buttonBackground = options.secondary ? options.buttonSecondaryBackground : options.buttonBackground;
		this.separatorContainer.style.backgroundColor = buttonBackground ?? '';
		this.separator.style.backgroundColor = options.buttonSeparator ?? '';
		this.dropdownButton = this._register(new Button(this.element, { ...options, title: false, supportIcons: true }));
		this.dropdownButton.element.title = (0, nls_1.localize)("button dropdown more actions", 'More Actions...');
		this.dropdownButton.element.setAttribute('aria-haspopup', 'true');
		this.dropdownButton.element.setAttribute('aria-expanded', 'false');
		this.dropdownButton.element.classList.add('monaco-dropdown-button');
		this.dropdownButton.icon = codicons_1.Codicon.dropDownButton;
		this._register(this.dropdownButton.onDidClick(e => {
			options.contextMenuProvider.showContextMenu({
				getAnchor: () => this.dropdownButton.element,
				getActions: () => options.addPrimaryActionToDropdown === false ? [...options.actions] : [this.action, ...options.actions],
				actionRunner: options.actionRunner,
				onHide: () => this.dropdownButton.element.setAttribute('aria-expanded', 'false')
			});
			this.dropdownButton.element.setAttribute('aria-expanded', 'true');
		}));
	}
	dispose() {
		super.dispose();
		this.element.remove();
	}
	set label(value) {
		this.button.label = value;
		this.action.label = value;
	}
	set icon(icon) {
		this.button.icon = icon;
	}
	set enabled(enabled) {
		this.button.enabled = enabled;
		this.dropdownButton.enabled = enabled;
		this.element.classList.toggle('disabled', !enabled);
	}
	get enabled() {
		return this.button.enabled;
	}
	focus() {
		this.button.focus();
	}
	hasFocus() {
		return this.button.hasFocus() || this.dropdownButton.hasFocus();
	}
}
exports.ButtonWithDropdown = ButtonWithDropdown;
class ButtonWithDescription {
	options;
	_button;
	_element;
	_descriptionElement;
	constructor(container, options) {
		this.options = options;
		this._element = document.createElement('div');
		this._element.classList.add('monaco-description-button');
		this._button = new Button(this._element, options);
		this._descriptionElement = document.createElement('div');
		this._descriptionElement.classList.add('monaco-button-description');
		this._element.appendChild(this._descriptionElement);
		container.appendChild(this._element);
	}
	get onDidClick() {
		return this._button.onDidClick;
	}
	get element() {
		return this._element;
	}
	set label(value) {
		this._button.label = value;
	}
	set icon(icon) {
		this._button.icon = icon;
	}
	get enabled() {
		return this._button.enabled;
	}
	set enabled(enabled) {
		this._button.enabled = enabled;
	}
	focus() {
		this._button.focus();
	}
	hasFocus() {
		return this._button.hasFocus();
	}
	dispose() {
		this._button.dispose();
	}
	set description(value) {
		if (this.options.supportIcons) {
			(0, dom_1.reset)(this._descriptionElement, ...(0, iconLabels_1.renderLabelWithIcons)(value));
		}
		else {
			this._descriptionElement.textContent = value;
		}
	}
}
exports.ButtonWithDescription = ButtonWithDescription;
class ButtonBar {
	container;
	_buttons = [];
	_buttonStore = new lifecycle_1.DisposableStore();
	constructor(container) {
		this.container = container;
	}
	dispose() {
		this._buttonStore.dispose();
	}
	get buttons() {
		return this._buttons;
	}
	clear() {
		this._buttonStore.clear();
		this._buttons.length = 0;
	}
	addButton(options) {
		const button = this._buttonStore.add(new Button(this.container, options));
		this.pushButton(button);
		return button;
	}
	addButtonWithDescription(options) {
		const button = this._buttonStore.add(new ButtonWithDescription(this.container, options));
		this.pushButton(button);
		return button;
	}
	addButtonWithDropdown(options) {
		const button = this._buttonStore.add(new ButtonWithDropdown(this.container, options));
		this.pushButton(button);
		return button;
	}
	pushButton(button) {
		this._buttons.push(button);
		const index = this._buttons.length - 1;
		this._buttonStore.add((0, dom_1.addDisposableListener)(button.element, dom_1.EventType.KEY_DOWN, e => {
			const event = new keyboardEvent_1.StandardKeyboardEvent(e);
			let eventHandled = true;
			// Next / Previous Button
			let buttonIndexToFocus;
			if (event.equals(15 /* KeyCode.LeftArrow */)) {
				buttonIndexToFocus = index > 0 ? index - 1 : this._buttons.length - 1;
			}
			else if (event.equals(17 /* KeyCode.RightArrow */)) {
				buttonIndexToFocus = index === this._buttons.length - 1 ? 0 : index + 1;
			}
			else {
				eventHandled = false;
			}
			if (eventHandled && typeof buttonIndexToFocus === 'number') {
				this._buttons[buttonIndexToFocus].focus();
				dom_1.EventHelper.stop(e, true);
			}
		}));
	}
}
exports.ButtonBar = ButtonBar;
