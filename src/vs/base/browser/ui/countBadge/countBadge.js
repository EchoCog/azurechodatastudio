"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.CountBadge = exports.unthemedCountStyles = void 0;
const dom_1 = require("vs/base/browser/dom");
const strings_1 = require("vs/base/common/strings");
require("vs/css!./countBadge");
exports.unthemedCountStyles = {
    badgeBackground: '#4D4D4D',
    badgeForeground: '#FFFFFF',
    badgeBorder: undefined
};
class CountBadge {
    options;
    styles;
    element;
    count = 0;
    countFormat;
    titleFormat;
    constructor(container, options, styles) {
        this.options = options;
        this.styles = styles;
        this.element = (0, dom_1.append)(container, (0, dom_1.$)('.monaco-count-badge'));
        this.countFormat = this.options.countFormat || '{0}';
        this.titleFormat = this.options.titleFormat || '';
        this.setCount(this.options.count || 0);
    }
    setCount(count) {
        this.count = count;
        this.render();
    }
    setCountFormat(countFormat) {
        this.countFormat = countFormat;
        this.render();
    }
    setTitleFormat(titleFormat) {
        this.titleFormat = titleFormat;
        this.render();
    }
    render() {
        this.element.textContent = (0, strings_1.format)(this.countFormat, this.count);
        this.element.title = (0, strings_1.format)(this.titleFormat, this.count);
        this.element.style.backgroundColor = this.styles.badgeBackground ?? '';
        this.element.style.color = this.styles.badgeForeground ?? '';
        if (this.styles.badgeBorder) {
            this.element.style.border = `1px solid ${this.styles.badgeBorder}`;
        }
    }
}
exports.CountBadge = CountBadge;
