"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextFileOperationError = exports.ITextFileService = void 0;
exports.isTextFileEditorModel = isTextFileEditorModel;
exports.snapshotToString = snapshotToString;
exports.stringToSnapshot = stringToSnapshot;
exports.toBufferOrReadable = toBufferOrReadable;
const files_1 = require("vs/platform/files/common/files");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const buffer_1 = require("vs/base/common/buffer");
const types_1 = require("vs/base/common/types");
exports.ITextFileService = (0, instantiation_1.createDecorator)('textFileService');
class TextFileOperationError extends files_1.FileOperationError {
    textFileOperationResult;
    static isTextFileOperationError(obj) {
        return obj instanceof Error && !(0, types_1.isUndefinedOrNull)(obj.textFileOperationResult);
    }
    options;
    constructor(message, textFileOperationResult, options) {
        super(message, 10 /* FileOperationResult.FILE_OTHER_ERROR */);
        this.textFileOperationResult = textFileOperationResult;
        this.options = options;
    }
}
exports.TextFileOperationError = TextFileOperationError;
function isTextFileEditorModel(model) {
    const candidate = model;
    return (0, types_1.areFunctions)(candidate.setEncoding, candidate.getEncoding, candidate.save, candidate.revert, candidate.isDirty, candidate.getLanguageId);
}
function snapshotToString(snapshot) {
    const chunks = [];
    let chunk;
    while (typeof (chunk = snapshot.read()) === 'string') {
        chunks.push(chunk);
    }
    return chunks.join('');
}
function stringToSnapshot(value) {
    let done = false;
    return {
        read() {
            if (!done) {
                done = true;
                return value;
            }
            return null;
        }
    };
}
function toBufferOrReadable(value) {
    if (typeof value === 'undefined') {
        return undefined;
    }
    if (typeof value === 'string') {
        return buffer_1.VSBuffer.fromString(value);
    }
    return {
        read: () => {
            const chunk = value.read();
            if (typeof chunk === 'string') {
                return buffer_1.VSBuffer.fromString(chunk);
            }
            return null;
        }
    };
}
