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
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { ICognitiveLoopService } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { CognitiveLoopService } from 'sql/workbench/services/zonecog/browser/cognitiveLoopService';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { DTESNService } from 'sql/workbench/services/zonecog/browser/dtesnService';
import { IAAROrchestrationService } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { AAROrchestrationService } from 'sql/workbench/services/zonecog/browser/aarOrchestrationService';
import { IHypergraphPersistenceService } from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { HypergraphPersistenceService } from 'sql/workbench/services/zonecog/browser/hypergraphPersistenceService';

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

// Register the ECAN Attention service (Economic Attention Network)
registerSingleton(IECANAttentionService, ECANAttentionService, InstantiationType.Eager);

// Register the Cognitive Loop service (autonomous perceive→attend→think→act→reflect cycle)
registerSingleton(ICognitiveLoopService, CognitiveLoopService, InstantiationType.Eager);

// Register Phase 4 services

// Register the DTESN service (Deep Tree Echo State Network — temporal reservoir computing)
registerSingleton(IDTESNService, DTESNService, InstantiationType.Eager);

// Register the AAR Orchestration service (Agent-Arena-Relation core orchestration)
registerSingleton(IAAROrchestrationService, AAROrchestrationService, InstantiationType.Eager);

// Register the Hypergraph Persistence service (IndexedDB-backed durable knowledge store)
registerSingleton(IHypergraphPersistenceService, HypergraphPersistenceService, InstantiationType.Eager);

// Register the ZoneCog service as a singleton
registerSingleton(IZoneCogService, ZoneCogService, InstantiationType.Eager);
