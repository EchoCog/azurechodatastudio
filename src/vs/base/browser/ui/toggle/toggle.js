"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Checkbox = exports.Toggle = exports.ToggleActionViewItem = exports.unthemedToggleStyles = void 0;
const actionViewItems_1 = require("vs/base/browser/ui/actionbar/actionViewItems");
const widget_1 = require("vs/base/browser/ui/widget");
const codicons_1 = require("vs/base/common/codicons");
const themables_1 = require("vs/base/common/themables");
const event_1 = require("vs/base/common/event");
require("vs/css!./toggle");
exports.unthemedToggleStyles = {
	inputActiveOptionBorder: '#007ACC00',
	inputActiveOptionForeground: '#FFFFFF',
	inputActiveOptionBackground: '#0E639C50'
};
class ToggleActionViewItem extends actionViewItems_1.BaseActionViewItem {
	toggle;
	constructor(context, action, options) {
		super(context, action, options);
		this.toggle = this._register(new Toggle({
			actionClassName: this._action.class,
			isChecked: !!this._action.checked,
			title: this.options.keybinding ? `${this._action.label} (${this.options.keybinding})` : this._action.label,
			notFocusable: true,
			inputActiveOptionBackground: options.toggleStyles?.inputActiveOptionBackground,
			inputActiveOptionBorder: options.toggleStyles?.inputActiveOptionBorder,
			inputActiveOptionForeground: options.toggleStyles?.inputActiveOptionForeground,
		}));
		this._register(this.toggle.onChange(() => this._action.checked = !!this.toggle && this.toggle.checked));
	}
	render(container) {
		this.element = container;
		this.element.appendChild(this.toggle.domNode);
	}
	updateEnabled() {
		if (this.toggle) {
			if (this.isEnabled()) {
				this.toggle.enable();
			}
			else {
				this.toggle.disable();
			}
		}
	}
	updateChecked() {
		this.toggle.checked = !!this._action.checked;
	}
	focus() {
		this.toggle.domNode.tabIndex = 0;
		this.toggle.focus();
	}
	blur() {
		this.toggle.domNode.tabIndex = -1;
		this.toggle.domNode.blur();
	}
	setFocusable(focusable) {
		this.toggle.domNode.tabIndex = focusable ? 0 : -1;
	}
}
exports.ToggleActionViewItem = ToggleActionViewItem;
class Toggle extends widget_1.Widget {
	_onChange = this._register(new event_1.Emitter());
	onChange = this._onChange.event;
	_onKeyDown = this._register(new event_1.Emitter());
	onKeyDown = this._onKeyDown.event;
	_opts;
	_icon;
	domNode;
	_checked;
	constructor(opts) {
		super();
		this._opts = opts;
		this._checked = this._opts.isChecked;
		const classes = ['monaco-custom-toggle'];
		if (this._opts.icon) {
			this._icon = this._opts.icon;
			classes.push(...themables_1.ThemeIcon.asClassNameArray(this._icon));
		}
		if (this._opts.actionClassName) {
			classes.push(...this._opts.actionClassName.split(' '));
		}
		if (this._checked) {
			classes.push('checked');
		}
		this.domNode = document.createElement('div');
		this.domNode.title = this._opts.title;
		this.domNode.classList.add(...classes);
		if (!this._opts.notFocusable) {
			this.domNode.tabIndex = 0;
		}
		this.domNode.setAttribute('role', 'checkbox');
		this.domNode.setAttribute('aria-checked', String(this._checked));
		this.domNode.setAttribute('aria-label', this._opts.title);
		this.applyStyles();
		this.onclick(this.domNode, (ev) => {
			if (this.enabled) {
				this.checked = !this._checked;
				this._onChange.fire(false);
				ev.preventDefault();
			}
		});
		this._register(this.ignoreGesture(this.domNode));
		this.onkeydown(this.domNode, (keyboardEvent) => {
			if (keyboardEvent.keyCode === 10 /* KeyCode.Space */ || keyboardEvent.keyCode === 3 /* KeyCode.Enter */) {
				this.checked = !this._checked;
				this._onChange.fire(true);
				keyboardEvent.preventDefault();
				keyboardEvent.stopPropagation();
				return;
			}
			this._onKeyDown.fire(keyboardEvent);
		});
	}
	get enabled() {
		return this.domNode.getAttribute('aria-disabled') !== 'true';
	}
	focus() {
		this.domNode.focus();
	}
	get checked() {
		return this._checked;
	}
	set checked(newIsChecked) {
		this._checked = newIsChecked;
		this.domNode.setAttribute('aria-checked', String(this._checked));
		this.domNode.classList.toggle('checked', this._checked);
		this.applyStyles();
	}
	setIcon(icon) {
		if (this._icon) {
			this.domNode.classList.remove(...themables_1.ThemeIcon.asClassNameArray(this._icon));
		}
		this._icon = icon;
		if (this._icon) {
			this.domNode.classList.add(...themables_1.ThemeIcon.asClassNameArray(this._icon));
		}
	}
	width() {
		return 2 /*margin left*/ + 2 /*border*/ + 2 /*padding*/ + 16 /* icon width */;
	}
	applyStyles() {
		if (this.domNode) {
			this.domNode.style.borderColor = (this._checked && this._opts.inputActiveOptionBorder) || '';
			this.domNode.style.color = (this._checked && this._opts.inputActiveOptionForeground) || 'inherit';
			this.domNode.style.backgroundColor = (this._checked && this._opts.inputActiveOptionBackground) || '';
		}
	}
	enable() {
		this.domNode.setAttribute('aria-disabled', String(false));
	}
	disable() {
		this.domNode.setAttribute('aria-disabled', String(true));
	}
	setTitle(newTitle) {
		this.domNode.title = newTitle;
		this.domNode.setAttribute('aria-label', newTitle);
	}
}
exports.Toggle = Toggle;
class Checkbox extends widget_1.Widget {
	title;
	isChecked;
	checkbox;
	styles;
	domNode;
	constructor(title, isChecked, styles) {
		super();
		this.title = title;
		this.isChecked = isChecked;
		this.checkbox = new Toggle({ title: this.title, isChecked: this.isChecked, icon: codicons_1.Codicon.check, actionClassName: 'monaco-checkbox', ...exports.unthemedToggleStyles });
		this.domNode = this.checkbox.domNode;
		this.styles = styles;
		this.applyStyles();
		this._register(this.checkbox.onChange(() => this.applyStyles()));
	}
	get checked() {
		return this.checkbox.checked;
	}
	set checked(newIsChecked) {
		this.checkbox.checked = newIsChecked;
		this.applyStyles();
	}
	focus() {
		this.domNode.focus();
	}
	hasFocus() {
		return this.domNode === document.activeElement;
	}
	applyStyles() {
		this.domNode.style.color = this.styles.checkboxForeground || '';
		this.domNode.style.backgroundColor = this.styles.checkboxBackground || '';
		this.domNode.style.borderColor = this.styles.checkboxBorder || '';
	}
}
exports.Checkbox = Checkbox;
