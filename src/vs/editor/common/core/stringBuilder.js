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
exports.StringBuilder = void 0;
exports.getPlatformTextDecoder = getPlatformTextDecoder;
exports.decodeUTF16LE = decodeUTF16LE;
const strings = __importStar(require("vs/base/common/strings"));
const platform = __importStar(require("vs/base/common/platform"));
const buffer = __importStar(require("vs/base/common/buffer"));
let _utf16LE_TextDecoder;
function getUTF16LE_TextDecoder() {
	if (!_utf16LE_TextDecoder) {
		_utf16LE_TextDecoder = new TextDecoder('UTF-16LE');
	}
	return _utf16LE_TextDecoder;
}
let _utf16BE_TextDecoder;
function getUTF16BE_TextDecoder() {
	if (!_utf16BE_TextDecoder) {
		_utf16BE_TextDecoder = new TextDecoder('UTF-16BE');
	}
	return _utf16BE_TextDecoder;
}
let _platformTextDecoder;
function getPlatformTextDecoder() {
	if (!_platformTextDecoder) {
		_platformTextDecoder = platform.isLittleEndian() ? getUTF16LE_TextDecoder() : getUTF16BE_TextDecoder();
	}
	return _platformTextDecoder;
}
function decodeUTF16LE(source, offset, len) {
	const view = new Uint16Array(source.buffer, offset, len);
	if (len > 0 && (view[0] === 0xFEFF || view[0] === 0xFFFE)) {
		// UTF16 sometimes starts with a BOM https://de.wikipedia.org/wiki/Byte_Order_Mark
		// It looks like TextDecoder.decode will eat up a leading BOM (0xFEFF or 0xFFFE)
		// We don't want that behavior because we know the string is UTF16LE and the BOM should be maintained
		// So we use the manual decoder
		return compatDecodeUTF16LE(source, offset, len);
	}
	return getUTF16LE_TextDecoder().decode(view);
}
function compatDecodeUTF16LE(source, offset, len) {
	const result = [];
	let resultLen = 0;
	for (let i = 0; i < len; i++) {
		const charCode = buffer.readUInt16LE(source, offset);
		offset += 2;
		result[resultLen++] = String.fromCharCode(charCode);
	}
	return result.join('');
}
class StringBuilder {
	_capacity;
	_buffer;
	_completedStrings;
	_bufferLength;
	constructor(capacity) {
		this._capacity = capacity | 0;
		this._buffer = new Uint16Array(this._capacity);
		this._completedStrings = null;
		this._bufferLength = 0;
	}
	reset() {
		this._completedStrings = null;
		this._bufferLength = 0;
	}
	build() {
		if (this._completedStrings !== null) {
			this._flushBuffer();
			return this._completedStrings.join('');
		}
		return this._buildBuffer();
	}
	_buildBuffer() {
		if (this._bufferLength === 0) {
			return '';
		}
		const view = new Uint16Array(this._buffer.buffer, 0, this._bufferLength);
		return getPlatformTextDecoder().decode(view);
	}
	_flushBuffer() {
		const bufferString = this._buildBuffer();
		this._bufferLength = 0;
		if (this._completedStrings === null) {
			this._completedStrings = [bufferString];
		}
		else {
			this._completedStrings[this._completedStrings.length] = bufferString;
		}
	}
	/**
		* Append a char code (<2^16)
		*/
	appendCharCode(charCode) {
		const remainingSpace = this._capacity - this._bufferLength;
		if (remainingSpace <= 1) {
			if (remainingSpace === 0 || strings.isHighSurrogate(charCode)) {
				this._flushBuffer();
			}
		}
		this._buffer[this._bufferLength++] = charCode;
	}
	/**
		* Append an ASCII char code (<2^8)
		*/
	appendASCIICharCode(charCode) {
		if (this._bufferLength === this._capacity) {
			// buffer is full
			this._flushBuffer();
		}
		this._buffer[this._bufferLength++] = charCode;
	}
	appendString(str) {
		const strLen = str.length;
		if (this._bufferLength + strLen >= this._capacity) {
			// This string does not fit in the remaining buffer space
			this._flushBuffer();
			this._completedStrings[this._completedStrings.length] = str;
			return;
		}
		for (let i = 0; i < strLen; i++) {
			this._buffer[this._bufferLength++] = str.charCodeAt(i);
		}
	}
}
exports.StringBuilder = StringBuilder;
