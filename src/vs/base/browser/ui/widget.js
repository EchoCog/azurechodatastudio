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
exports.Widget = void 0;
const dom = __importStar(require("vs/base/browser/dom"));
const keyboardEvent_1 = require("vs/base/browser/keyboardEvent");
const mouseEvent_1 = require("vs/base/browser/mouseEvent");
const touch_1 = require("vs/base/browser/touch");
const lifecycle_1 = require("vs/base/common/lifecycle");
class Widget extends lifecycle_1.Disposable {
    onclick(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.CLICK, (e) => listener(new mouseEvent_1.StandardMouseEvent(e))));
    }
    onmousedown(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.MOUSE_DOWN, (e) => listener(new mouseEvent_1.StandardMouseEvent(e))));
    }
    onmouseover(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.MOUSE_OVER, (e) => listener(new mouseEvent_1.StandardMouseEvent(e))));
    }
    onmouseleave(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.MOUSE_LEAVE, (e) => listener(new mouseEvent_1.StandardMouseEvent(e))));
    }
    onkeydown(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.KEY_DOWN, (e) => listener(new keyboardEvent_1.StandardKeyboardEvent(e))));
    }
    onkeyup(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.KEY_UP, (e) => listener(new keyboardEvent_1.StandardKeyboardEvent(e))));
    }
    oninput(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.INPUT, listener));
    }
    onblur(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.BLUR, listener));
    }
    onfocus(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.FOCUS, listener));
    }
    onchange(domNode, listener) {
        this._register(dom.addDisposableListener(domNode, dom.EventType.CHANGE, listener));
    }
    ignoreGesture(domNode) {
        return touch_1.Gesture.ignoreTarget(domNode);
    }
}
exports.Widget = Widget;
