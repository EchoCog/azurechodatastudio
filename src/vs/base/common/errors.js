"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.BugIndicatingError = exports.ErrorNoTelemetry = exports.ExpectedError = exports.NotSupportedError = exports.NotImplementedError = exports.CancellationError = exports.errorHandler = exports.ErrorHandler = void 0;
exports.setUnexpectedErrorHandler = setUnexpectedErrorHandler;
exports.isSigPipeError = isSigPipeError;
exports.onUnexpectedError = onUnexpectedError;
exports.onUnexpectedExternalError = onUnexpectedExternalError;
exports.transformErrorForSerialization = transformErrorForSerialization;
exports.isCancellationError = isCancellationError;
exports.canceled = canceled;
exports.illegalArgument = illegalArgument;
exports.illegalState = illegalState;
exports.readonly = readonly;
exports.disposed = disposed;
exports.getErrorMessage = getErrorMessage;
// Avoid circular dependency on EventEmitter by implementing a subset of the interface.
class ErrorHandler {
    unexpectedErrorHandler;
    listeners;
    constructor() {
        this.listeners = [];
        this.unexpectedErrorHandler = function (e) {
            setTimeout(() => {
                if (e.stack) {
                    if (ErrorNoTelemetry.isErrorNoTelemetry(e)) {
                        throw new ErrorNoTelemetry(e.message + '\n\n' + e.stack);
                    }
                    throw new Error(e.message + '\n\n' + e.stack);
                }
                throw e;
            }, 0);
        };
    }
    addListener(listener) {
        this.listeners.push(listener);
        return () => {
            this._removeListener(listener);
        };
    }
    emit(e) {
        this.listeners.forEach((listener) => {
            listener(e);
        });
    }
    _removeListener(listener) {
        this.listeners.splice(this.listeners.indexOf(listener), 1);
    }
    setUnexpectedErrorHandler(newUnexpectedErrorHandler) {
        this.unexpectedErrorHandler = newUnexpectedErrorHandler;
    }
    getUnexpectedErrorHandler() {
        return this.unexpectedErrorHandler;
    }
    onUnexpectedError(e) {
        this.unexpectedErrorHandler(e);
        this.emit(e);
    }
    // For external errors, we don't want the listeners to be called
    onUnexpectedExternalError(e) {
        this.unexpectedErrorHandler(e);
    }
}
exports.ErrorHandler = ErrorHandler;
exports.errorHandler = new ErrorHandler();
/** @skipMangle */
function setUnexpectedErrorHandler(newUnexpectedErrorHandler) {
    exports.errorHandler.setUnexpectedErrorHandler(newUnexpectedErrorHandler);
}
/**
 * Returns if the error is a SIGPIPE error. SIGPIPE errors should generally be
 * logged at most once, to avoid a loop.
 *
 * @see https://github.com/microsoft/vscode-remote-release/issues/6481
 */
function isSigPipeError(e) {
    if (!e || typeof e !== 'object') {
        return false;
    }
    const cast = e;
    return cast.code === 'EPIPE' && cast.syscall?.toUpperCase() === 'WRITE';
}
function onUnexpectedError(e) {
    // ignore errors from cancelled promises
    if (!isCancellationError(e)) {
        exports.errorHandler.onUnexpectedError(e);
    }
    return undefined;
}
function onUnexpectedExternalError(e) {
    // ignore errors from cancelled promises
    if (!isCancellationError(e)) {
        exports.errorHandler.onUnexpectedExternalError(e);
    }
    return undefined;
}
function transformErrorForSerialization(error) {
    if (error instanceof Error) {
        const { name, message } = error;
        let errorCode = error.errorCode; // {{SQL CARBON EDIT}} Add error code to retain more information
        const stack = error.stacktrace || error.stack;
        return {
            $isError: true,
            name,
            message,
            stack,
            errorCode,
            data: error.data // {{SQL CARBON EDIT}} Add data property.
        };
    }
    // return as is
    return error;
}
const canceledName = 'Canceled';
/**
 * Checks if the given error is a promise in canceled state
 */
function isCancellationError(error) {
    if (error instanceof CancellationError) {
        return true;
    }
    return error instanceof Error && error.name === canceledName && error.message === canceledName;
}
// !!!IMPORTANT!!!
// Do NOT change this class because it is also used as an API-type.
class CancellationError extends Error {
    constructor() {
        super(canceledName);
        this.name = this.message;
    }
}
exports.CancellationError = CancellationError;
/**
 * @deprecated use {@link CancellationError `new CancellationError()`} instead
 */
function canceled() {
    const error = new Error(canceledName);
    error.name = error.message;
    return error;
}
function illegalArgument(name) {
    if (name) {
        return new Error(`Illegal argument: ${name}`);
    }
    else {
        return new Error('Illegal argument');
    }
}
function illegalState(name) {
    if (name) {
        return new Error(`Illegal state: ${name}`);
    }
    else {
        return new Error('Illegal state');
    }
}
function readonly(name) {
    return name
        ? new Error(`readonly property '${name} cannot be changed'`)
        : new Error('readonly property cannot be changed');
}
function disposed(what) {
    const result = new Error(`${what} has been disposed`);
    result.name = 'DISPOSED';
    return result;
}
function getErrorMessage(err) {
    if (!err) {
        return 'Error';
    }
    if (err.message) {
        return err.message;
    }
    if (err.stack) {
        return err.stack.split('\n')[0];
    }
    return String(err);
}
class NotImplementedError extends Error {
    constructor(message) {
        super('NotImplemented');
        if (message) {
            this.message = message;
        }
    }
}
exports.NotImplementedError = NotImplementedError;
class NotSupportedError extends Error {
    constructor(message) {
        super('NotSupported');
        if (message) {
            this.message = message;
        }
    }
}
exports.NotSupportedError = NotSupportedError;
class ExpectedError extends Error {
    isExpected = true;
}
exports.ExpectedError = ExpectedError;
/**
 * Error that when thrown won't be logged in telemetry as an unhandled error.
 */
class ErrorNoTelemetry extends Error {
    name;
    constructor(msg) {
        super(msg);
        this.name = 'CodeExpectedError';
    }
    static fromError(err) {
        if (err instanceof ErrorNoTelemetry) {
            return err;
        }
        const result = new ErrorNoTelemetry();
        result.message = err.message;
        result.stack = err.stack;
        return result;
    }
    static isErrorNoTelemetry(err) {
        return err.name === 'CodeExpectedError';
    }
}
exports.ErrorNoTelemetry = ErrorNoTelemetry;
/**
 * This error indicates a bug.
 * Do not throw this for invalid user input.
 * Only catch this error to recover gracefully from bugs.
 */
class BugIndicatingError extends Error {
    constructor(message) {
        super(message || 'An unexpected bug occurred.');
        Object.setPrototypeOf(this, BugIndicatingError.prototype);
        // Because we know for sure only buggy code throws this,
        // we definitely want to break here and fix the bug.
        // eslint-disable-next-line no-debugger
        // debugger;
    }
}
exports.BugIndicatingError = BugIndicatingError;
