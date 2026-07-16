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
exports.ActionWithDropdownActionViewItem = exports.DropdownMenuActionViewItem = void 0;
const nls = __importStar(require("vs/nls"));
const dom_1 = require("vs/base/browser/dom");
const keyboardEvent_1 = require("vs/base/browser/keyboardEvent");
const actionViewItems_1 = require("vs/base/browser/ui/actionbar/actionViewItems");
const dropdown_1 = require("vs/base/browser/ui/dropdown/dropdown");
const actions_1 = require("vs/base/common/actions");
const codicons_1 = require("vs/base/common/codicons");
const themables_1 = require("vs/base/common/themables");
const event_1 = require("vs/base/common/event");
require("vs/css!./dropdown");
class DropdownMenuActionViewItem extends actionViewItems_1.BaseActionViewItem {
	menuActionsOrProvider;
	dropdownMenu;
	contextMenuProvider;
	actionItem = null;
	_onDidChangeVisibility = this._register(new event_1.Emitter());
	onDidChangeVisibility = this._onDidChangeVisibility.event;
	options;
	constructor(action, menuActionsOrProvider, contextMenuProvider, options = Object.create(null)) {
		super(null, action, options);
		this.menuActionsOrProvider = menuActionsOrProvider;
		this.contextMenuProvider = contextMenuProvider;
		this.options = options;
		if (this.options.actionRunner) {
			this.actionRunner = this.options.actionRunner;
		}
	}
	render(container) {
		this.actionItem = container;
		const labelRenderer = (el) => {
			this.element = (0, dom_1.append)(el, (0, dom_1.$)('a.action-label'));
			let classNames = [];
			if (typeof this.options.classNames === 'string') {
				classNames = this.options.classNames.split(/\s+/g).filter(s => !!s);
			}
			else if (this.options.classNames) {
				classNames = this.options.classNames;
			}
			// todo@aeschli: remove codicon, should come through `this.options.classNames`
			if (!classNames.find(c => c === 'icon')) {
				classNames.push('codicon');
			}
			this.element.classList.add(...classNames);
			this.element.setAttribute('role', 'button');
			this.element.setAttribute('aria-haspopup', 'true');
			this.element.setAttribute('aria-expanded', 'false');
			this.element.title = this._action.label || '';
			this.element.ariaLabel = this._action.label || '';
			return null;
		};
		const isActionsArray = Array.isArray(this.menuActionsOrProvider);
		const options = {
			contextMenuProvider: this.contextMenuProvider,
			labelRenderer: labelRenderer,
			menuAsChild: this.options.menuAsChild,
			actions: isActionsArray ? this.menuActionsOrProvider : undefined,
			actionProvider: isActionsArray ? undefined : this.menuActionsOrProvider,
			skipTelemetry: this.options.skipTelemetry
		};
		this.dropdownMenu = this._register(new dropdown_1.DropdownMenu(container, options));
		this._register(this.dropdownMenu.onDidChangeVisibility(visible => {
			this.element?.setAttribute('aria-expanded', `${visible}`);
			this._onDidChangeVisibility.fire(visible);
		}));
		this.dropdownMenu.menuOptions = {
			actionViewItemProvider: this.options.actionViewItemProvider,
			actionRunner: this.actionRunner,
			getKeyBinding: this.options.keybindingProvider,
			context: this._context
		};
		if (this.options.anchorAlignmentProvider) {
			const that = this;
			this.dropdownMenu.menuOptions = {
				...this.dropdownMenu.menuOptions,
				get anchorAlignment() {
					return that.options.anchorAlignmentProvider();
				}
			};
		}
		this.updateTooltip();
		this.updateEnabled();
	}
	getTooltip() {
		let title = null;
		if (this.action.tooltip) {
			title = this.action.tooltip;
		}
		else if (this.action.label) {
			title = this.action.label;
		}
		return title ?? undefined;
	}
	setActionContext(newContext) {
		super.setActionContext(newContext);
		if (this.dropdownMenu) {
			if (this.dropdownMenu.menuOptions) {
				this.dropdownMenu.menuOptions.context = newContext;
			}
			else {
				this.dropdownMenu.menuOptions = { context: newContext };
			}
		}
	}
	show() {
		this.dropdownMenu?.show();
	}
	updateEnabled() {
		const disabled = !this.action.enabled;
		this.actionItem?.classList.toggle('disabled', disabled);
		this.element?.classList.toggle('disabled', disabled);
	}
}
exports.DropdownMenuActionViewItem = DropdownMenuActionViewItem;
class ActionWithDropdownActionViewItem extends actionViewItems_1.ActionViewItem {
	contextMenuProvider;
	dropdownMenuActionViewItem;
	constructor(context, action, options, contextMenuProvider) {
		super(context, action, options);
		this.contextMenuProvider = contextMenuProvider;
	}
	render(container) {
		super.render(container);
		if (this.element) {
			this.element.classList.add('action-dropdown-item');
			const menuActionsProvider = {
				getActions: () => {
					const actionsProvider = this.options.menuActionsOrProvider;
					return Array.isArray(actionsProvider) ? actionsProvider : actionsProvider.getActions(); // TODO: microsoft/TypeScript#42768
				}
			};
			const menuActionClassNames = this.options.menuActionClassNames || [];
			const separator = (0, dom_1.h)('div.action-dropdown-item-separator', [(0, dom_1.h)('div', {})]).root;
			separator.classList.toggle('prominent', menuActionClassNames.includes('prominent'));
			(0, dom_1.append)(this.element, separator);
			this.dropdownMenuActionViewItem = new DropdownMenuActionViewItem(this._register(new actions_1.Action('dropdownAction', nls.localize('moreActions', "More Actions..."))), menuActionsProvider, this.contextMenuProvider, { classNames: ['dropdown', ...themables_1.ThemeIcon.asClassNameArray(codicons_1.Codicon.dropDownButton), ...menuActionClassNames] });
			this.dropdownMenuActionViewItem.render(this.element);
			this._register((0, dom_1.addDisposableListener)(this.element, dom_1.EventType.KEY_DOWN, e => {
				// {{SQL CARBON EDIT}} If we don't have any items then the dropdown is hidden so don't try to focus it #20877
				if (menuActionsProvider.getActions().length === 0) {
					return;
				}
				const event = new keyboardEvent_1.StandardKeyboardEvent(e);
				let handled = false;
				if (this.dropdownMenuActionViewItem?.isFocused() && event.equals(15 /* KeyCode.LeftArrow */)) {
					handled = true;
					this.dropdownMenuActionViewItem?.blur();
					this.focus();
				}
				else if (this.isFocused() && event.equals(17 /* KeyCode.RightArrow */)) {
					handled = true;
					this.blur();
					this.dropdownMenuActionViewItem?.focus();
				}
				if (handled) {
					event.preventDefault();
					event.stopPropagation();
				}
			}));
		}
	}
	blur() {
		super.blur();
		this.dropdownMenuActionViewItem?.blur();
	}
	setFocusable(focusable) {
		super.setFocusable(focusable);
		this.dropdownMenuActionViewItem?.setFocusable(focusable);
	}
}
exports.ActionWithDropdownActionViewItem = ActionWithDropdownActionViewItem;
