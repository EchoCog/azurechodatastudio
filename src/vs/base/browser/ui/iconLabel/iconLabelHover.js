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
exports.setupNativeHover = setupNativeHover;
exports.setupCustomHover = setupCustomHover;
const dom = __importStar(require("vs/base/browser/dom"));
const async_1 = require("vs/base/common/async");
const cancellation_1 = require("vs/base/common/cancellation");
const htmlContent_1 = require("vs/base/common/htmlContent");
const iconLabels_1 = require("vs/base/common/iconLabels");
const lifecycle_1 = require("vs/base/common/lifecycle");
const types_1 = require("vs/base/common/types");
const nls_1 = require("vs/nls");
function setupNativeHover(htmlElement, tooltip) {
    if ((0, types_1.isString)(tooltip)) {
        // Icons don't render in the native hover so we strip them out
        htmlElement.title = (0, iconLabels_1.stripIcons)(tooltip);
    }
    else if (tooltip?.markdownNotSupportedFallback) {
        htmlElement.title = tooltip.markdownNotSupportedFallback;
    }
    else {
        htmlElement.removeAttribute('title');
    }
}
class UpdatableHoverWidget {
    hoverDelegate;
    target;
    fadeInAnimation;
    _hoverWidget;
    _cancellationTokenSource;
    constructor(hoverDelegate, target, fadeInAnimation) {
        this.hoverDelegate = hoverDelegate;
        this.target = target;
        this.fadeInAnimation = fadeInAnimation;
    }
    async update(content, focus, options) {
        if (this._cancellationTokenSource) {
            // there's an computation ongoing, cancel it
            this._cancellationTokenSource.dispose(true);
            this._cancellationTokenSource = undefined;
        }
        if (this.isDisposed) {
            return;
        }
        let resolvedContent;
        if (content === undefined || (0, types_1.isString)(content) || content instanceof HTMLElement) {
            resolvedContent = content;
        }
        else if (!(0, types_1.isFunction)(content.markdown)) {
            resolvedContent = content.markdown ?? content.markdownNotSupportedFallback;
        }
        else {
            // compute the content, potentially long-running
            // show 'Loading' if no hover is up yet
            if (!this._hoverWidget) {
                this.show((0, nls_1.localize)('iconLabel.loading', "Loading..."), focus);
            }
            // compute the content
            this._cancellationTokenSource = new cancellation_1.CancellationTokenSource();
            const token = this._cancellationTokenSource.token;
            resolvedContent = await content.markdown(token);
            if (resolvedContent === undefined) {
                resolvedContent = content.markdownNotSupportedFallback;
            }
            if (this.isDisposed || token.isCancellationRequested) {
                // either the widget has been closed in the meantime
                // or there has been a new call to `update`
                return;
            }
        }
        this.show(resolvedContent, focus, options);
    }
    show(content, focus, options) {
        const oldHoverWidget = this._hoverWidget;
        if (this.hasContent(content)) {
            const hoverOptions = {
                content,
                target: this.target,
                showPointer: this.hoverDelegate.placement === 'element',
                hoverPosition: 2 /* HoverPosition.BELOW */,
                skipFadeInAnimation: !this.fadeInAnimation || !!oldHoverWidget, // do not fade in if the hover is already showing
                ...options
            };
            this._hoverWidget = this.hoverDelegate.showHover(hoverOptions, focus);
        }
        oldHoverWidget?.dispose();
    }
    hasContent(content) {
        if (!content) {
            return false;
        }
        if ((0, htmlContent_1.isMarkdownString)(content)) {
            return !!content.value;
        }
        return true;
    }
    get isDisposed() {
        return this._hoverWidget?.isDisposed;
    }
    dispose() {
        this._hoverWidget?.dispose();
        this._cancellationTokenSource?.dispose(true);
        this._cancellationTokenSource = undefined;
    }
}
function setupCustomHover(hoverDelegate, htmlElement, content, options) {
    let hoverPreparation;
    let hoverWidget;
    const hideHover = (disposeWidget, disposePreparation) => {
        const hadHover = hoverWidget !== undefined;
        if (disposeWidget) {
            hoverWidget?.dispose();
            hoverWidget = undefined;
        }
        if (disposePreparation) {
            hoverPreparation?.dispose();
            hoverPreparation = undefined;
        }
        if (hadHover) {
            hoverDelegate.onDidHideHover?.();
        }
    };
    const triggerShowHover = (delay, focus, target) => {
        return new async_1.TimeoutTimer(async () => {
            if (!hoverWidget || hoverWidget.isDisposed) {
                hoverWidget = new UpdatableHoverWidget(hoverDelegate, target || htmlElement, delay > 0);
                await hoverWidget.update(content, focus, options);
            }
        }, delay);
    };
    const onMouseOver = () => {
        if (hoverPreparation) {
            return;
        }
        const toDispose = new lifecycle_1.DisposableStore();
        const onMouseLeave = (e) => hideHover(false, e.fromElement === htmlElement);
        toDispose.add(dom.addDisposableListener(htmlElement, dom.EventType.MOUSE_LEAVE, onMouseLeave, true));
        const onMouseDown = () => hideHover(true, true);
        toDispose.add(dom.addDisposableListener(htmlElement, dom.EventType.MOUSE_DOWN, onMouseDown, true));
        const target = {
            targetElements: [htmlElement],
            dispose: () => { }
        };
        if (hoverDelegate.placement === undefined || hoverDelegate.placement === 'mouse') {
            // track the mouse position
            const onMouseMove = (e) => {
                target.x = e.x + 10;
                if ((e.target instanceof HTMLElement) && e.target.classList.contains('action-label')) {
                    hideHover(true, true);
                }
            };
            toDispose.add(dom.addDisposableListener(htmlElement, dom.EventType.MOUSE_MOVE, onMouseMove, true));
        }
        toDispose.add(triggerShowHover(hoverDelegate.delay, false, target));
        hoverPreparation = toDispose;
    };
    const mouseOverDomEmitter = dom.addDisposableListener(htmlElement, dom.EventType.MOUSE_OVER, onMouseOver, true);
    const hover = {
        show: focus => {
            hideHover(false, true); // terminate a ongoing mouse over preparation
            triggerShowHover(0, focus); // show hover immediately
        },
        hide: () => {
            hideHover(true, true);
        },
        update: async (newContent, hoverOptions) => {
            content = newContent;
            await hoverWidget?.update(content, undefined, hoverOptions);
        },
        dispose: () => {
            mouseOverDomEmitter.dispose();
            hideHover(true, true);
        }
    };
    return hover;
}
