"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextModelPart = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
class TextModelPart extends lifecycle_1.Disposable {
	_isDisposed = false;
	dispose() {
		super.dispose();
		this._isDisposed = true;
	}
	assertNotDisposed() {
		if (this._isDisposed) {
			throw new Error('TextModelPart is disposed!');
		}
	}
}
exports.TextModelPart = TextModelPart;
