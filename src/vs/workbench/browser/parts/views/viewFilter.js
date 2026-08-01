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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
	var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
	else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
	return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
	return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilterWidget = exports.viewFilterSubmenu = void 0;
const async_1 = require("vs/base/common/async");
const DOM = __importStar(require("vs/base/browser/dom"));
const contextView_1 = require("vs/platform/contextview/browser/contextView");
const lifecycle_1 = require("vs/base/common/lifecycle");
const colorRegistry_1 = require("vs/platform/theme/common/colorRegistry");
const nls_1 = require("vs/nls");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const contextScopedHistoryWidget_1 = require("vs/platform/history/browser/contextScopedHistoryWidget");
const contextkey_1 = require("vs/platform/contextkey/common/contextkey");
const codicons_1 = require("vs/base/common/codicons");
const keybinding_1 = require("vs/platform/keybinding/common/keybinding");
const historyWidgetKeybindingHint_1 = require("vs/platform/history/browser/historyWidgetKeybindingHint");
const actions_1 = require("vs/platform/actions/common/actions");
const toolbar_1 = require("vs/platform/actions/browser/toolbar");
const menuEntryActionViewItem_1 = require("vs/platform/actions/browser/menuEntryActionViewItem");
const widget_1 = require("vs/base/browser/ui/widget");
const event_1 = require("vs/base/common/event");
const defaultStyles_1 = require("vs/platform/theme/browser/defaultStyles");
const viewFilterMenu = new actions_1.MenuId('menu.view.filter');
exports.viewFilterSubmenu = new actions_1.MenuId('submenu.view.filter');
actions_1.MenuRegistry.appendMenuItem(viewFilterMenu, {
	submenu: exports.viewFilterSubmenu,
	title: (0, nls_1.localize)('more filters', "More Filters..."),
	group: 'navigation',
	icon: codicons_1.Codicon.filter,
});
class MoreFiltersActionViewItem extends menuEntryActionViewItem_1.SubmenuEntryActionViewItem {
	_checked = false;
	set checked(checked) {
		if (this._checked !== checked) {
			this._checked = checked;
			this.updateChecked();
		}
	}
	updateChecked() {
		if (this.element) {
			this.element.classList.toggle('checked', this._checked);
		}
	}
	render(container) {
		super.render(container);
		this.updateChecked();
	}
}
let FilterWidget = class FilterWidget extends widget_1.Widget {
	options;
	instantiationService;
	contextViewService;
	keybindingService;
	element;
	delayedFilterUpdate;
	filterInputBox;
	filterBadge;
	toolbar;
	focusContextKey;
	_onDidChangeFilterText = this._register(new event_1.Emitter());
	onDidChangeFilterText = this._onDidChangeFilterText.event;
	moreFiltersActionViewItem;
	isMoreFiltersChecked = false;
	focusTracker;
	get onDidFocus() { return this.focusTracker.onDidFocus; }
	get onDidBlur() { return this.focusTracker.onDidBlur; }
	constructor(options, instantiationService, contextViewService, contextKeyService, keybindingService) {
		super();
		this.options = options;
		this.instantiationService = instantiationService;
		this.contextViewService = contextViewService;
		this.keybindingService = keybindingService;
		this.delayedFilterUpdate = new async_1.Delayer(400);
		this._register((0, lifecycle_1.toDisposable)(() => this.delayedFilterUpdate.cancel()));
		if (options.focusContextKey) {
			this.focusContextKey = new contextkey_1.RawContextKey(options.focusContextKey, false).bindTo(contextKeyService);
		}
		this.element = DOM.$('.viewpane-filter');
		[this.filterInputBox, this.focusTracker] = this.createInput(this.element);
		const controlsContainer = DOM.append(this.element, DOM.$('.viewpane-filter-controls'));
		this.filterBadge = this.createBadge(controlsContainer);
		this.toolbar = this._register(this.createToolBar(controlsContainer));
		this.adjustInputBox();
	}
	hasFocus() {
		return this.filterInputBox.hasFocus();
	}
	focus() {
		this.filterInputBox.focus();
	}
	blur() {
		this.filterInputBox.blur();
	}
	updateBadge(message) {
		this.filterBadge.classList.toggle('hidden', !message);
		this.filterBadge.textContent = message || '';
		this.adjustInputBox();
	}
	setFilterText(filterText) {
		this.filterInputBox.value = filterText;
	}
	getFilterText() {
		return this.filterInputBox.value;
	}
	getHistory() {
		return this.filterInputBox.getHistory();
	}
	layout(width) {
		this.element.parentElement?.classList.toggle('grow', width > 700);
		this.element.classList.toggle('small', width < 400);
		this.adjustInputBox();
	}
	checkMoreFilters(checked) {
		this.isMoreFiltersChecked = checked;
		if (this.moreFiltersActionViewItem) {
			this.moreFiltersActionViewItem.checked = checked;
		}
	}
	createInput(container) {
		const inputBox = this._register(this.instantiationService.createInstance(contextScopedHistoryWidget_1.ContextScopedHistoryInputBox, container, this.contextViewService, {
			placeholder: this.options.placeholder,
			ariaLabel: this.options.ariaLabel,
			history: this.options.history || [],
			showHistoryHint: () => (0, historyWidgetKeybindingHint_1.showHistoryKeybindingHint)(this.keybindingService),
			inputBoxStyles: defaultStyles_1.defaultInputBoxStyles
		}));
		if (this.options.text) {
			inputBox.value = this.options.text;
		}
		this._register(inputBox.onDidChange(filter => this.delayedFilterUpdate.trigger(() => this.onDidInputChange(inputBox))));
		this._register(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (e) => this.onInputKeyDown(e, inputBox)));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_DOWN, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_UP, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.CLICK, (e) => {
			e.stopPropagation();
			e.preventDefault();
		}));
		const focusTracker = this._register(DOM.trackFocus(inputBox.inputElement));
		if (this.focusContextKey) {
			this._register(focusTracker.onDidFocus(() => this.focusContextKey.set(true)));
			this._register(focusTracker.onDidBlur(() => this.focusContextKey.set(false)));
			this._register((0, lifecycle_1.toDisposable)(() => this.focusContextKey.reset()));
		}
		return [inputBox, focusTracker];
	}
	createBadge(container) {
		const filterBadge = DOM.append(container, DOM.$('.viewpane-filter-badge.hidden'));
		filterBadge.style.backgroundColor = (0, colorRegistry_1.asCssVariable)(colorRegistry_1.badgeBackground);
		filterBadge.style.color = (0, colorRegistry_1.asCssVariable)(colorRegistry_1.badgeForeground);
		filterBadge.style.border = `1px solid ${(0, colorRegistry_1.asCssVariable)(colorRegistry_1.contrastBorder)}`;
		return filterBadge;
	}
	createToolBar(container) {
		return this.instantiationService.createInstance(toolbar_1.MenuWorkbenchToolBar, container, viewFilterMenu, {
			hiddenItemStrategy: -1 /* HiddenItemStrategy.NoHide */,
			actionViewItemProvider: (action) => {
				if (action instanceof actions_1.SubmenuItemAction && action.item.submenu.id === exports.viewFilterSubmenu.id) {
					this.moreFiltersActionViewItem = this.instantiationService.createInstance(MoreFiltersActionViewItem, action, undefined);
					this.moreFiltersActionViewItem.checked = this.isMoreFiltersChecked;
					return this.moreFiltersActionViewItem;
				}
				return undefined;
			}
		});
	}
	onDidInputChange(inputbox) {
		inputbox.addToHistory();
		this._onDidChangeFilterText.fire(inputbox.value);
	}
	adjustInputBox() {
		this.filterInputBox.inputElement.style.paddingRight = this.element.classList.contains('small') || this.filterBadge.classList.contains('hidden') ? '25px' : '150px';
	}
	// Action toolbar is swallowing some keys for action items which should not be for an input box
	handleKeyboardEvent(event) {
		if (event.equals(10 /* KeyCode.Space */)
			|| event.equals(15 /* KeyCode.LeftArrow */)
			|| event.equals(17 /* KeyCode.RightArrow */)) {
			event.stopPropagation();
		}
	}
	onInputKeyDown(event, filterInputBox) {
		let handled = false;
		if (event.equals(2 /* KeyCode.Tab */) && !this.toolbar.isEmpty()) {
			this.toolbar.focus();
			handled = true;
		}
		if (handled) {
			event.stopPropagation();
			event.preventDefault();
		}
	}
};
exports.FilterWidget = FilterWidget;
exports.FilterWidget = FilterWidget = __decorate([
	__param(1, instantiation_1.IInstantiationService),
	__param(2, contextView_1.IContextViewService),
	__param(3, contextkey_1.IContextKeyService),
	__param(4, keybinding_1.IKeybindingService)
], FilterWidget);
