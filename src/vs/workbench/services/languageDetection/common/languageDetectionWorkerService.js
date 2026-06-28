"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageDetectionStatsId = exports.AutomaticLanguageDetectionLikelyWrongId = exports.LanguageDetectionLanguageEventSource = exports.ILanguageDetectionService = void 0;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
exports.ILanguageDetectionService = (0, instantiation_1.createDecorator)('ILanguageDetectionService');
exports.LanguageDetectionLanguageEventSource = 'languageDetection';
//#region Telemetry events
exports.AutomaticLanguageDetectionLikelyWrongId = 'automaticlanguagedetection.likelywrong';
exports.LanguageDetectionStatsId = 'automaticlanguagedetection.stats';
//#endregion
