"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.wasEventTriggeredRecently = exports.waitForState = exports.observableSignalFromEvent = exports.observableSignal = exports.observableFromPromise = exports.observableFromEvent = exports.keepAlive = exports.derivedObservableWithWritableCache = exports.derivedObservableWithCache = exports.debouncedObservable = exports.constObservable = exports.autorunWithStoreHandleChanges = exports.autorunOpts = exports.autorunWithStore = exports.autorunHandleChanges = exports.autorunDelta = exports.autorun = exports.derivedWithStore = exports.derivedHandleChanges = exports.derivedOpts = exports.derived = exports.subtransaction = exports.transaction = exports.disposableObservableValue = exports.observableValue = void 0;
var base_1 = require("vs/base/common/observableInternal/base");
Object.defineProperty(exports, "observableValue", { enumerable: true, get: function () { return base_1.observableValue; } });
Object.defineProperty(exports, "disposableObservableValue", { enumerable: true, get: function () { return base_1.disposableObservableValue; } });
Object.defineProperty(exports, "transaction", { enumerable: true, get: function () { return base_1.transaction; } });
Object.defineProperty(exports, "subtransaction", { enumerable: true, get: function () { return base_1.subtransaction; } });
var derived_1 = require("vs/base/common/observableInternal/derived");
Object.defineProperty(exports, "derived", { enumerable: true, get: function () { return derived_1.derived; } });
Object.defineProperty(exports, "derivedOpts", { enumerable: true, get: function () { return derived_1.derivedOpts; } });
Object.defineProperty(exports, "derivedHandleChanges", { enumerable: true, get: function () { return derived_1.derivedHandleChanges; } });
Object.defineProperty(exports, "derivedWithStore", { enumerable: true, get: function () { return derived_1.derivedWithStore; } });
var autorun_1 = require("vs/base/common/observableInternal/autorun");
Object.defineProperty(exports, "autorun", { enumerable: true, get: function () { return autorun_1.autorun; } });
Object.defineProperty(exports, "autorunDelta", { enumerable: true, get: function () { return autorun_1.autorunDelta; } });
Object.defineProperty(exports, "autorunHandleChanges", { enumerable: true, get: function () { return autorun_1.autorunHandleChanges; } });
Object.defineProperty(exports, "autorunWithStore", { enumerable: true, get: function () { return autorun_1.autorunWithStore; } });
Object.defineProperty(exports, "autorunOpts", { enumerable: true, get: function () { return autorun_1.autorunOpts; } });
Object.defineProperty(exports, "autorunWithStoreHandleChanges", { enumerable: true, get: function () { return autorun_1.autorunWithStoreHandleChanges; } });
var utils_1 = require("vs/base/common/observableInternal/utils");
Object.defineProperty(exports, "constObservable", { enumerable: true, get: function () { return utils_1.constObservable; } });
Object.defineProperty(exports, "debouncedObservable", { enumerable: true, get: function () { return utils_1.debouncedObservable; } });
Object.defineProperty(exports, "derivedObservableWithCache", { enumerable: true, get: function () { return utils_1.derivedObservableWithCache; } });
Object.defineProperty(exports, "derivedObservableWithWritableCache", { enumerable: true, get: function () { return utils_1.derivedObservableWithWritableCache; } });
Object.defineProperty(exports, "keepAlive", { enumerable: true, get: function () { return utils_1.keepAlive; } });
Object.defineProperty(exports, "observableFromEvent", { enumerable: true, get: function () { return utils_1.observableFromEvent; } });
Object.defineProperty(exports, "observableFromPromise", { enumerable: true, get: function () { return utils_1.observableFromPromise; } });
Object.defineProperty(exports, "observableSignal", { enumerable: true, get: function () { return utils_1.observableSignal; } });
Object.defineProperty(exports, "observableSignalFromEvent", { enumerable: true, get: function () { return utils_1.observableSignalFromEvent; } });
Object.defineProperty(exports, "waitForState", { enumerable: true, get: function () { return utils_1.waitForState; } });
Object.defineProperty(exports, "wasEventTriggeredRecently", { enumerable: true, get: function () { return utils_1.wasEventTriggeredRecently; } });
const logging_1 = require("vs/base/common/observableInternal/logging");
const enableLogging = false;
if (enableLogging) {
	(0, logging_1.setLogger)(new logging_1.ConsoleObservableLogger());
}
