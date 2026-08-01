"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectBox = exports.unthemedSelectBoxStyles = void 0;
const listWidget_1 = require("vs/base/browser/ui/list/listWidget");
const selectBoxCustom_1 = require("vs/base/browser/ui/selectBox/selectBoxCustom");
const selectBoxNative_1 = require("vs/base/browser/ui/selectBox/selectBoxNative");
const widget_1 = require("vs/base/browser/ui/widget");
const platform_1 = require("vs/base/common/platform");
require("vs/css!./selectBox");
exports.unthemedSelectBoxStyles = {
	...listWidget_1.unthemedListStyles,
	selectBackground: '#3C3C3C',
	selectForeground: '#F0F0F0',
	selectBorder: '#3C3C3C',
	decoratorRightForeground: undefined,
	selectListBackground: undefined,
	selectListBorder: undefined,
	focusBorder: undefined
};
class SelectBox extends widget_1.Widget {
	selectElement; // {{SQL CARBON EDIT}}
	selectBoxDelegate; // {{SQL CARBON EDIT}} Make protected so we can hook into keyboard events
	constructor(options, selected, contextViewProvider, styles, selectBoxOptions) {
		super();
		// Default to native SelectBox for OSX unless overridden
		if (platform_1.isMacintosh && !selectBoxOptions?.useCustomDrawn) {
			this.selectBoxDelegate = new selectBoxNative_1.SelectBoxNative(options, selected, styles, selectBoxOptions);
		}
		else {
			this.selectBoxDelegate = new selectBoxCustom_1.SelectBoxList(options, selected, contextViewProvider, styles, selectBoxOptions);
		}
		// {{SQL CARBON EDIT}}
		this.selectElement = this.selectBoxDelegate.selectElement;
		this._register(this.selectBoxDelegate);
	}
	// Public SelectBox Methods - routed through delegate interface
	get onDidSelect() {
		return this.selectBoxDelegate.onDidSelect;
	}
	setOptions(options, selected) {
		this.selectBoxDelegate.setOptions(options, selected);
	}
	select(index) {
		this.selectBoxDelegate.select(index);
	}
	setAriaLabel(label) {
		this.selectBoxDelegate.setAriaLabel(label);
	}
	focus() {
		this.selectBoxDelegate.focus();
	}
	blur() {
		this.selectBoxDelegate.blur();
	}
	setFocusable(focusable) {
		this.selectBoxDelegate.setFocusable(focusable);
	}
	render(container) {
		this.selectBoxDelegate.render(container);
	}
	// {{SQL CARBON EDIT}}
	createOption(value, disabled) {
		let option = document.createElement('option');
		option.value = value;
		option.text = value;
		option.disabled = disabled || false;
		return option;
	}
}
exports.SelectBox = SelectBox;
