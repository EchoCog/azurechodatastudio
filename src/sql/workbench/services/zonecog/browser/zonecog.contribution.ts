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
import { ISensorimotorBindingService } from 'sql/workbench/services/zonecog/common/sensorimotorBinding';
import { SensorimotorBindingService } from 'sql/workbench/services/zonecog/browser/sensorimotorBindingService';
import { IAAROrchestrationService } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { AAROrchestrationService } from 'sql/workbench/services/zonecog/browser/aarOrchestrationService';
import { IHypergraphPersistenceService } from 'sql/workbench/services/zonecog/common/hypergraphPersistence';
import { HypergraphPersistenceService } from 'sql/workbench/services/zonecog/browser/hypergraphPersistenceService';
import { ISchemaPerceptionService } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { SchemaPerceptionService } from 'sql/workbench/services/zonecog/browser/schemaPerceptionService';
import { IAphroditeService } from 'sql/workbench/services/zonecog/common/aphrodite';
import { AphroditeService } from 'sql/workbench/services/zonecog/browser/aphroditeService';
import { ISQLAnalyzerAgent, ISchemaReasonerAgent, IPerformanceAdvisorAgent, IDataPatternAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { SQLAnalyzerAgent } from 'sql/workbench/services/zonecog/browser/sqlAnalyzerAgent';
import { SchemaReasonerAgent } from 'sql/workbench/services/zonecog/browser/schemaReasonerAgent';
import { PerformanceAdvisorAgent } from 'sql/workbench/services/zonecog/browser/performanceAdvisorAgent';
import { DataPatternAgent } from 'sql/workbench/services/zonecog/browser/dataPatternAgent';
import { ICognitiveWorkflowAutomationService } from 'sql/workbench/services/zonecog/common/cognitiveWorkflowAutomation';
import { CognitiveWorkflowAutomationService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkflowAutomationService';
import { IAgiStudioService } from 'sql/workbench/services/zonecog/common/agiStudio';
import { AgiStudioService } from 'sql/workbench/services/zonecog/browser/agiStudioService';
import { IUserInteractionLearningService } from 'sql/workbench/services/zonecog/common/userInteractionLearning';
import { UserInteractionLearningService } from 'sql/workbench/services/zonecog/browser/userInteractionLearningService';
import { ICognitiveProvenanceService } from 'sql/workbench/services/zonecog/common/cognitiveProvenance';
import { CognitiveProvenanceService } from 'sql/workbench/services/zonecog/browser/cognitiveProvenanceService';
import { ISchemaEvolutionService } from 'sql/workbench/services/zonecog/common/schemaEvolution';
import { SchemaEvolutionService } from 'sql/workbench/services/zonecog/browser/schemaEvolutionService';
import { IPLNReasoningService } from 'sql/workbench/services/zonecog/common/plnReasoning';
import { PLNReasoningService } from 'sql/workbench/services/zonecog/browser/plnReasoningService';
import { ICognitiveAnalyticsService } from 'sql/workbench/services/zonecog/common/cognitiveAnalytics';
import { ICognitiveInsightsService } from 'sql/workbench/services/zonecog/common/cognitiveInsights';
import { CognitiveInsightsService } from 'sql/workbench/services/zonecog/browser/cognitiveInsightsService';
import { ICognitiveTraceService } from 'sql/workbench/services/zonecog/common/cognitiveTrace';
import { CognitiveTraceService } from 'sql/workbench/services/zonecog/browser/cognitiveTraceService';
import { ISharedCognitionService } from 'sql/workbench/services/zonecog/common/sharedCognition';
import { SharedCognitionService } from 'sql/workbench/services/zonecog/browser/sharedCognitionService';
import { CognitiveAnalyticsService } from 'sql/workbench/services/zonecog/browser/cognitiveAnalyticsService';
import { IFederatedQueryService } from 'sql/workbench/services/zonecog/common/federatedQuery';
import { FederatedQueryService } from 'sql/workbench/services/zonecog/browser/federatedQueryService';
import { IHypergraphSemanticSearchService } from 'sql/workbench/services/zonecog/common/hypergraphSemanticSearch';
import { HypergraphSemanticSearchService } from 'sql/workbench/services/zonecog/browser/hypergraphSemanticSearchService';

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

// Register the DTESN service (Deep Tree Echo State Network - temporal reservoir computing)
registerSingleton(IDTESNService, DTESNService, InstantiationType.Eager);

// Register the Sensorimotor Binding service (Phase 5.4: DTESN sensorimotor binding - temporal encoding, motor decoding, online learning)
registerSingleton(ISensorimotorBindingService, SensorimotorBindingService, InstantiationType.Eager);

// Register the AAR Orchestration service (Agent-Arena-Relation core orchestration)
registerSingleton(IAAROrchestrationService, AAROrchestrationService, InstantiationType.Eager);

// Register the Hypergraph Persistence service (IndexedDB-backed durable knowledge store)
registerSingleton(IHypergraphPersistenceService, HypergraphPersistenceService, InstantiationType.Eager);

// Register Phase 5 services

// Register the Schema Perception service (database schema embodied cognition interface)
registerSingleton(ISchemaPerceptionService, SchemaPerceptionService, InstantiationType.Eager);

// Register the Aphrodite service (Aphrodite LLM inference engine integration)
registerSingleton(IAphroditeService, AphroditeService, InstantiationType.Eager);

// Register Cognitive Agents (P2: Multi-Agent Extensions)

// Register the SQL Analyzer Agent (deep SQL query analysis)
registerSingleton(ISQLAnalyzerAgent, SQLAnalyzerAgent, InstantiationType.Eager);

// Register the Schema Reasoner Agent (database schema understanding)
registerSingleton(ISchemaReasonerAgent, SchemaReasonerAgent, InstantiationType.Eager);

// Register the Performance Advisor Agent (query optimization suggestions)
registerSingleton(IPerformanceAdvisorAgent, PerformanceAdvisorAgent, InstantiationType.Eager);

// Register the Data Pattern Agent (statistical pattern recognition)
registerSingleton(IDataPatternAgent, DataPatternAgent, InstantiationType.Eager);

// Register Phase 6 services

// Register the Cognitive Workflow Automation service (custom workflow DSL execution)
registerSingleton(ICognitiveWorkflowAutomationService, CognitiveWorkflowAutomationService, InstantiationType.Eager);

// Register Phase 7 services

// Register the AGI Studio service (Agent-Zero-style hierarchical autonomous agents)
registerSingleton(IAgiStudioService, AgiStudioService, InstantiationType.Eager);

// Register the ZoneCog service as a singleton
registerSingleton(IZoneCogService, ZoneCogService, InstantiationType.Eager);

// Register Phase 8 services

// Register the User Interaction Learning service (behavioral analytics, pattern
// mining into the hypergraph, and Q-learning strategy selection)
registerSingleton(IUserInteractionLearningService, UserInteractionLearningService, InstantiationType.Eager);

// Register the Cognitive Provenance service (audit trails and transitive
// provenance chains for cognitive decisions)
registerSingleton(ICognitiveProvenanceService, CognitiveProvenanceService, InstantiationType.Eager);

// Register the Schema Evolution service (snapshot diffing of perceived
// schemas into a persisted SchemaChange history)
registerSingleton(ISchemaEvolutionService, SchemaEvolutionService, InstantiationType.Eager);

// Register the PLN Reasoning service (PLN-style truth values and URE-lite
// forward-chaining deduction/inversion/similarity inference over the
// hypergraph store's binary directed links)
registerSingleton(IPLNReasoningService, PLNReasoningService, InstantiationType.Eager);
// Register the Cognitive Analytics service (Phase 6.3: query latency
// histograms, thinking phase durations, ECAN efficiency, working memory
// utilization, LLM token economics, and DTESN training convergence)
registerSingleton(ICognitiveAnalyticsService, CognitiveAnalyticsService, InstantiationType.Eager);

// Register Phase 4 completion services

// Register the Cognitive Insights service (auto-generated insights from
// observed queries and perceived schemas, persisted as Insight nodes)
registerSingleton(ICognitiveInsightsService, CognitiveInsightsService, InstantiationType.Eager);

// Register the Cognitive Trace service (session trace recording, shareable
// JSON export/import, and phase-by-phase replay)
registerSingleton(ICognitiveTraceService, CognitiveTraceService, InstantiationType.Eager);

// Register the Shared Cognition service (multi-window shared hypergraph
// state over a BroadcastChannel)
registerSingleton(ISharedCognitionService, SharedCognitionService, InstantiationType.Eager);

// Register the Federated Query service (same-machine multi-window
// hypergraph query federation over a BroadcastChannel; Phase 3.4)
registerSingleton(IFederatedQueryService, FederatedQueryService, InstantiationType.Eager);
// Register the Hypergraph Semantic Search service (Aphrodite-embedding-backed
// similarity search over hypergraph nodes, with a deterministic local
// hashing-trick fallback when no Aphrodite engine is connected)
registerSingleton(IHypergraphSemanticSearchService, HypergraphSemanticSearchService, InstantiationType.Eager);
