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
exports.SelectActionViewItem = exports.ActionViewItem = exports.BaseActionViewItem = void 0;
const browser_1 = require("vs/base/browser/browser");
const dnd_1 = require("vs/base/browser/dnd");
const dom_1 = require("vs/base/browser/dom");
const touch_1 = require("vs/base/browser/touch");
const iconLabelHover_1 = require("vs/base/browser/ui/iconLabel/iconLabelHover");
const selectBox_1 = require("vs/base/browser/ui/selectBox/selectBox");
const actions_1 = require("vs/base/common/actions");
const lifecycle_1 = require("vs/base/common/lifecycle");
const platform = __importStar(require("vs/base/common/platform"));
const types = __importStar(require("vs/base/common/types"));
require("vs/css!./actionbar");
const nls = __importStar(require("vs/nls"));
class BaseActionViewItem extends lifecycle_1.Disposable {
	options;
	element;
	_context;
	_action;
	customHover;
	get action() {
		return this._action;
	}
	_actionRunner;
	constructor(context, action, options = {}) {
		super();
		this.options = options;
		this._context = context || this;
		this._action = action;
		if (action instanceof actions_1.Action) {
			this._register(action.onDidChange(event => {
				if (!this.element) {
					// we have not been rendered yet, so there
					// is no point in updating the UI
					return;
				}
				this.handleActionChangeEvent(event);
			}));
		}
	}
	handleActionChangeEvent(event) {
		if (event.enabled !== undefined) {
			this.updateEnabled();
		}
		if (event.checked !== undefined) {
			this.updateChecked();
		}
		if (event.class !== undefined) {
			this.updateClass();
		}
		if (event.label !== undefined) {
			this.updateLabel();
			this.updateTooltip();
		}
		if (event.tooltip !== undefined) {
			this.updateTooltip();
		}
		// {{SQL CARBON EDIT}}
		if (event.expanded !== undefined) {
			this.updateExpanded();
		}
	}
	get actionRunner() {
		if (!this._actionRunner) {
			this._actionRunner = this._register(new actions_1.ActionRunner());
		}
		return this._actionRunner;
	}
	set actionRunner(actionRunner) {
		this._actionRunner = actionRunner;
	}
	isEnabled() {
		return this._action.enabled;
	}
	setActionContext(newContext) {
		this._context = newContext;
	}
	render(container) {
		const element = this.element = container;
		this._register(touch_1.Gesture.addTarget(container));
		const enableDragging = this.options && this.options.draggable;
		if (enableDragging) {
			container.draggable = true;
			if (browser_1.isFirefox) {
				// Firefox: requires to set a text data transfer to get going
				this._register((0, dom_1.addDisposableListener)(container, dom_1.EventType.DRAG_START, e => e.dataTransfer?.setData(dnd_1.DataTransfers.TEXT, this._action.label)));
			}
		}
		this._register((0, dom_1.addDisposableListener)(element, touch_1.EventType.Tap, e => this.onClick(e, true))); // Preserve focus on tap #125470
		this._register((0, dom_1.addDisposableListener)(element, dom_1.EventType.MOUSE_DOWN, e => {
			if (!enableDragging) {
				dom_1.EventHelper.stop(e, true); // do not run when dragging is on because that would disable it
			}
			if (this._action.enabled && e.button === 0) {
				element.classList.add('active');
			}
		}));
		if (platform.isMacintosh) {
			// macOS: allow to trigger the button when holding Ctrl+key and pressing the
			// main mouse button. This is for scenarios where e.g. some interaction forces
			// the Ctrl+key to be pressed and hold but the user still wants to interact
			// with the actions (for example quick access in quick navigation mode).
			this._register((0, dom_1.addDisposableListener)(element, dom_1.EventType.CONTEXT_MENU, e => {
				if (e.button === 0 && e.ctrlKey === true) {
					this.onClick(e);
				}
			}));
		}
		this._register((0, dom_1.addDisposableListener)(element, dom_1.EventType.CLICK, e => {
			dom_1.EventHelper.stop(e, true);
			// menus do not use the click event
			if (!(this.options && this.options.isMenu)) {
				this.onClick(e);
			}
		}));
		this._register((0, dom_1.addDisposableListener)(element, dom_1.EventType.DBLCLICK, e => {
			dom_1.EventHelper.stop(e, true);
		}));
		[dom_1.EventType.MOUSE_UP, dom_1.EventType.MOUSE_OUT].forEach(event => {
			this._register((0, dom_1.addDisposableListener)(element, event, e => {
				dom_1.EventHelper.stop(e);
				element.classList.remove('active');
			}));
		});
	}
	onClick(event, preserveFocus = false) {
		dom_1.EventHelper.stop(event, true);
		const context = types.isUndefinedOrNull(this._context) ? this.options?.useEventAsContext ? event : { preserveFocus } : this._context;
		this.actionRunner.run(this._action, context);
	}
	// Only set the tabIndex on the element once it is about to get focused
	// That way this element wont be a tab stop when it is not needed #106441
	focus() {
		if (this.element) {
			this.element.tabIndex = 0;
			this.element.focus();
			this.element.classList.add('focused');
		}
	}
	isFocused() {
		return !!this.element?.classList.contains('focused');
	}
	blur() {
		if (this.element) {
			this.element.blur();
			this.element.tabIndex = -1;
			this.element.classList.remove('focused');
		}
	}
	setFocusable(focusable) {
		if (this.element) {
			this.element.tabIndex = focusable ? 0 : -1;
		}
	}
	get trapsArrowNavigation() {
		return false;
	}
	updateEnabled() {
		// implement in subclass
	}
	updateLabel() {
		// implement in subclass
	}
	getTooltip() {
		return this.action.tooltip;
	}
	updateTooltip() {
		if (!this.element) {
			return;
		}
		const title = this.getTooltip() ?? '';
		this.updateAriaLabel();
		if (!this.options.hoverDelegate) {
			this.element.title = title;
		}
		else {
			this.element.title = '';
			if (!this.customHover) {
				this.customHover = (0, iconLabelHover_1.setupCustomHover)(this.options.hoverDelegate, this.element, title);
				this._store.add(this.customHover);
			}
			else {
				this.customHover.update(title);
			}
		}
	}
	updateAriaLabel() {
		if (this.element) {
			const title = this.getTooltip() ?? '';
			this.element.setAttribute('aria-label', title);
		}
	}
	updateClass() {
		// implement in subclass
	}
	updateChecked() {
		// implement in subclass
	}
	// {{SQL CARBON EDIT}}
	updateExpanded() {
		// implement in subclass
	}
	dispose() {
		if (this.element) {
			this.element.remove();
			this.element = undefined;
		}
		this._context = undefined;
		super.dispose();
	}
}
exports.BaseActionViewItem = BaseActionViewItem;
class ActionViewItem extends BaseActionViewItem {
	label;
	options;
	cssClass;
	constructor(context, action, options) {
		super(context, action, options);
		this.options = options;
		this.options.icon = options.icon !== undefined ? options.icon : false;
		this.options.label = options.label !== undefined ? options.label : true;
		this.cssClass = '';
	}
	render(container) {
		super.render(container);
		if (this.element) {
			this.label = (0, dom_1.append)(this.element, (0, dom_1.$)('a.action-label'));
		}
		if (this.label) {
			this.label.setAttribute('role', this.getDefaultAriaRole());
		}
		if (this.options.label && this.options.keybinding && this.element) {
			(0, dom_1.append)(this.element, (0, dom_1.$)('span.keybinding')).textContent = this.options.keybinding;
		}
		this.updateClass();
		this.updateLabel();
		this.updateTooltip();
		this.updateEnabled();
		this.updateChecked();
	}
	getDefaultAriaRole() {
		if (this._action.id === actions_1.Separator.ID) {
			return 'presentation'; // A separator is a presentation item
		}
		else {
			if (this.options.isMenu) {
				return 'menuitem';
			}
			else {
				return 'button';
			}
		}
	}
	// Only set the tabIndex on the element once it is about to get focused
	// That way this element wont be a tab stop when it is not needed #106441
	focus() {
		if (this.label) {
			this.label.tabIndex = 0;
			this.label.focus();
		}
	}
	isFocused() {
		return !!this.label && this.label?.tabIndex === 0;
	}
	blur() {
		if (this.label) {
			this.label.tabIndex = -1;
		}
	}
	setFocusable(focusable) {
		if (this.label) {
			this.label.tabIndex = focusable ? 0 : -1;
		}
	}
	updateLabel() {
		if (this.options.label && this.label) {
			this.label.textContent = this.action.label;
		}
	}
	getTooltip() {
		let title = null;
		if (this.action.tooltip) {
			title = this.action.tooltip;
		}
		else if (!this.options.label && this.action.label && this.options.icon) {
			title = this.action.label;
			if (this.options.keybinding) {
				title = nls.localize({ key: 'titleLabel', comment: ['action title', 'action keybinding'] }, "{0} ({1})", title, this.options.keybinding);
			}
		}
		return title ?? undefined;
	}
	updateClass() {
		if (this.cssClass && this.label) {
			this.label.classList.remove(...this.cssClass.split(' '));
		}
		if (this.options.icon) {
			this.cssClass = this.action.class;
			if (this.label) {
				this.label.classList.add('codicon');
				if (this.cssClass) {
					// {{SQL CARBON EDIT}} - avoid exception if class contains empty elements
					let classList = this.cssClass.split(' ');
					let containsEmpty = false;
					if (classList && classList.length > 0) {
						for (let i = 0; i < classList.length; ++i) {
							if (classList[i] === undefined || classList[i] === '') {
								containsEmpty = true;
							}
						}
						if (!containsEmpty) {
							this.label.classList.add(...this.cssClass.split(' '));
						}
					}
				}
			}
			this.updateEnabled();
		}
		else {
			this.label?.classList.remove('codicon');
		}
	}
	updateEnabled() {
		if (this.action.enabled) {
			if (this.label) {
				this.label.removeAttribute('aria-disabled');
				this.label.classList.remove('disabled');
			}
			this.element?.classList.remove('disabled');
		}
		else {
			if (this.label) {
				this.label.setAttribute('aria-disabled', 'true');
				this.label.classList.add('disabled');
			}
			this.element?.classList.add('disabled');
		}
	}
	updateAriaLabel() {
		if (this.label) {
			const title = this.getTooltip() ?? '';
			this.label.setAttribute('aria-label', title);
		}
	}
	updateChecked() {
		if (this.label) {
			if (this.action.checked !== undefined) {
				this.label.classList.toggle('checked', this.action.checked);
				this.label.setAttribute('aria-checked', this.action.checked ? 'true' : 'false');
				this.label.setAttribute('role', 'checkbox');
			}
			else {
				this.label.classList.remove('checked');
				this.label.setAttribute('aria-checked', '');
				this.label.setAttribute('role', this.getDefaultAriaRole());
			}
		}
	}
	// {{SQL CARBON EDIT}} - BEGIN
	updateExpanded() {
		if (this.label) {
			if (this.action.expanded !== undefined) {
				this.label.setAttribute('aria-expanded', `${this.action.expanded}`);
			}
			else {
				this.label.removeAttribute('aria-expanded');
			}
		}
	}
	updateTooltip() {
		super.updateTooltip();
		const tooltip = this.getTooltip();
		if (tooltip) {
			this.label?.setAttribute('aria-label', tooltip);
		}
	}
}
exports.ActionViewItem = ActionViewItem;
class SelectActionViewItem extends BaseActionViewItem {
	selectBox;
	constructor(ctx, action, options, selected, contextViewProvider, styles, selectBoxOptions) {
		super(ctx, action);
		this.selectBox = new selectBox_1.SelectBox(options, selected, contextViewProvider, styles, selectBoxOptions);
		this.selectBox.setFocusable(false);
		this._register(this.selectBox);
		this.registerListeners();
	}
	setOptions(options, selected) {
		this.selectBox.setOptions(options, selected);
	}
	select(index) {
		this.selectBox.select(index);
	}
	registerListeners() {
		this._register(this.selectBox.onDidSelect(e => this.runAction(e.selected, e.index)));
	}
	runAction(option, index) {
		this.actionRunner.run(this._action, this.getActionContext(option, index));
	}
	getActionContext(option, index) {
		return option;
	}
	setFocusable(focusable) {
		this.selectBox.setFocusable(focusable);
	}
	focus() {
		this.selectBox?.focus();
	}
	blur() {
		this.selectBox?.blur();
	}
	render(container) {
		this.selectBox.render(container);
	}
}
exports.SelectActionViewItem = SelectActionViewItem;
