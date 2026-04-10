/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from 'vs/platform/instantiation/common/extensions';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';

// Register the Hypergraph store (dependency of ZoneCogService)
registerSingleton(IHypergraphStore, HypergraphStore, InstantiationType.Eager);

// Register the Cognitive Membrane service (dependency of ZoneCogService)
registerSingleton(ICognitiveMembraneService, CognitiveMembraneService, InstantiationType.Eager);

// Register the LLM provider service (dependency of ZoneCogService)
registerSingleton(ILLMProviderService, LLMProviderService, InstantiationType.Eager);

// Register the Embodied Cognition service (sensorimotor grounding layer)
registerSingleton(IEmbodiedCognitionService, EmbodiedCognitionService, InstantiationType.Eager);

// Register the Cognitive Workspace service (working memory, episodic memory, task contexts)
registerSingleton(ICognitiveWorkspaceService, CognitiveWorkspaceService, InstantiationType.Eager);

// Register the ZoneCog service as a singleton
registerSingleton(IZoneCogService, ZoneCogService, InstantiationType.Eager);
