"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICognitiveMembraneService = exports.IHypergraphStore = exports.IZoneCogService = void 0;
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
exports.IZoneCogService = (0, instantiation_1.createDecorator)('zonecogService');
exports.IHypergraphStore = (0, instantiation_1.createDecorator)('hypergraphStore');
// ---------------------------------------------------------------------------
// Cognitive Membrane types
// ---------------------------------------------------------------------------
exports.ICognitiveMembraneService = (0, instantiation_1.createDecorator)('cognitiveMembraneService');
