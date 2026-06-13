/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { CognitiveAgentConfig, CognitiveAgent, AgentCapabilities, AgentAction } from 'sql/workbench/services/zonecog/common/aarOrchestration';

/**
 * SQL Analysis result containing parsed query information.
 */
export interface SQLAnalysisResult {
	/** Original query text */
	queryText: string;
	/** Query type (SELECT, INSERT, UPDATE, DELETE, etc.) */
	queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'ALTER' | 'DROP' | 'OTHER';
	/** Tables referenced in the query */
	tablesReferenced: string[];
	/** Columns referenced */
	columnsReferenced: string[];
	/** Joins detected */
	joins: SQLJoinInfo[];
	/** Subqueries detected */
	subqueries: SQLSubqueryInfo[];
	/** Aggregations used */
	aggregations: string[];
	/** Window functions used */
	windowFunctions: string[];
	/** Estimated complexity (1-10) */
	complexity: number;
	/** Potential performance issues */
	performanceIssues: SQLPerformanceIssue[];
	/** Suggested indexes */
	suggestedIndexes: SQLIndexSuggestion[];
	/** Semantic understanding of query intent */
	semanticIntent: string;
}

/**
 * Join information from SQL analysis.
 */
export interface SQLJoinInfo {
	/** Join type */
	type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';
	/** Left table */
	leftTable: string;
	/** Right table */
	rightTable: string;
	/** Join condition */
	condition: string;
}

/**
 * Subquery information.
 */
export interface SQLSubqueryInfo {
	/** Subquery text */
	query: string;
	/** Location in parent query */
	location: 'SELECT' | 'FROM' | 'WHERE' | 'HAVING';
	/** Whether it's correlated */
	isCorrelated: boolean;
}

/**
 * Performance issue detected in SQL.
 */
export interface SQLPerformanceIssue {
	/** Issue severity */
	severity: 'low' | 'medium' | 'high' | 'critical';
	/** Issue type */
	type: string;
	/** Description */
	description: string;
	/** Location in query */
	location?: string;
	/** Suggested fix */
	suggestedFix?: string;
}

/**
 * Index suggestion for query optimization.
 */
export interface SQLIndexSuggestion {
	/** Table name */
	tableName: string;
	/** Columns for index */
	columns: string[];
	/** Index type */
	indexType: 'btree' | 'hash' | 'gin' | 'gist';
	/** Estimated improvement */
	estimatedImprovement: string;
	/** Reasoning */
	reasoning: string;
}

/**
 * Schema reasoning result.
 */
export interface SchemaReasoningResult {
	/** Schema elements analyzed */
	elements: SchemaElementAnalysis[];
	/** Relationships discovered */
	relationships: SchemaRelationship[];
	/** Schema quality issues */
	qualityIssues: SchemaQualityIssue[];
	/** Normalization analysis */
	normalization: NormalizationAnalysis;
	/** Domain model inference */
	domainModel: DomainModelInference;
}

/**
 * Analysis of a schema element.
 */
export interface SchemaElementAnalysis {
	/** Element name */
	name: string;
	/** Element type */
	type: 'table' | 'view' | 'procedure' | 'function' | 'index';
	/** Purpose (inferred) */
	inferredPurpose: string;
	/** Entity type (inferred) */
	entityType?: string;
	/** Columns with their inferred roles */
	columns?: ColumnAnalysis[];
}

/**
 * Column analysis.
 */
export interface ColumnAnalysis {
	/** Column name */
	name: string;
	/** Data type */
	dataType: string;
	/** Inferred role */
	role: 'primary_key' | 'foreign_key' | 'attribute' | 'timestamp' | 'flag' | 'measure' | 'dimension';
	/** Semantic meaning */
	semanticMeaning: string;
}

/**
 * Schema relationship.
 */
export interface SchemaRelationship {
	/** Source table */
	sourceTable: string;
	/** Target table */
	targetTable: string;
	/** Relationship type */
	relationshipType: 'one_to_one' | 'one_to_many' | 'many_to_many';
	/** Cardinality */
	cardinality: string;
	/** Foreign key columns */
	foreignKeyColumns: string[];
	/** Is explicit (FK constraint) or inferred */
	isExplicit: boolean;
}

/**
 * Schema quality issue.
 */
export interface SchemaQualityIssue {
	/** Issue severity */
	severity: 'info' | 'warning' | 'error';
	/** Affected element */
	element: string;
	/** Issue type */
	type: string;
	/** Description */
	description: string;
	/** Recommendation */
	recommendation: string;
}

/**
 * Normalization analysis result.
 */
export interface NormalizationAnalysis {
	/** Current normal form */
	currentForm: '1NF' | '2NF' | '3NF' | 'BCNF' | '4NF' | '5NF';
	/** Violations found */
	violations: NormalizationViolation[];
	/** Denormalization opportunities */
	denormalizationOpportunities: string[];
}

/**
 * Normalization violation.
 */
export interface NormalizationViolation {
	/** Table name */
	tableName: string;
	/** Normal form violated */
	normalForm: string;
	/** Description */
	description: string;
	/** Suggested fix */
	suggestedFix: string;
}

/**
 * Domain model inferred from schema.
 */
export interface DomainModelInference {
	/** Entities discovered */
	entities: DomainEntity[];
	/** Aggregates */
	aggregates: string[];
	/** Bounded contexts */
	boundedContexts: string[];
	/** Business rules inferred */
	businessRules: string[];
}

/**
 * Domain entity.
 */
export interface DomainEntity {
	/** Entity name */
	name: string;
	/** Table(s) backing this entity */
	backingTables: string[];
	/** Is aggregate root */
	isAggregateRoot: boolean;
	/** Properties */
	properties: string[];
	/** Behaviors (inferred from procedures) */
	behaviors: string[];
}

export const ISQLAnalyzerAgent = createDecorator<ISQLAnalyzerAgent>('sqlAnalyzerAgent');

/**
 * SQL Analyzer Agent - Deep SQL query analysis.
 */
export interface ISQLAnalyzerAgent extends CognitiveAgent {
	/**
	 * Analyze a SQL query.
	 */
	analyzeQuery(query: string): Promise<SQLAnalysisResult>;

	/**
	 * Explain query execution plan semantically.
	 */
	explainPlan(query: string): Promise<string>;

	/**
	 * Generate optimized version of query.
	 */
	optimizeQuery(query: string): Promise<string>;

	/**
	 * Translate natural language to SQL.
	 */
	naturalLanguageToSQL(description: string, schemaContext?: string): Promise<string>;

	/**
	 * Translate SQL to natural language explanation.
	 */
	sqlToNaturalLanguage(query: string): Promise<string>;
}

export const ISchemaReasonerAgent = createDecorator<ISchemaReasonerAgent>('schemaReasonerAgent');

/**
 * Schema Reasoner Agent - Database schema understanding.
 */
export interface ISchemaReasonerAgent extends CognitiveAgent {
	/**
	 * Analyze a database schema.
	 */
	analyzeSchema(schemaDefinition: string): Promise<SchemaReasoningResult>;

	/**
	 * Discover relationships in schema.
	 */
	discoverRelationships(tables: string[]): Promise<SchemaRelationship[]>;

	/**
	 * Infer domain model from schema.
	 */
	inferDomainModel(schemaDefinition: string): Promise<DomainModelInference>;

	/**
	 * Suggest schema improvements.
	 */
	suggestImprovements(schemaDefinition: string): Promise<SchemaQualityIssue[]>;

	/**
	 * Generate documentation for schema.
	 */
	generateDocumentation(schemaDefinition: string): Promise<string>;

	/**
	 * Compare two schemas and identify differences.
	 */
	compareSchemas(schema1: string, schema2: string): Promise<string>;
}

export const IPerformanceAdvisorAgent = createDecorator<IPerformanceAdvisorAgent>('performanceAdvisorAgent');

/**
 * Performance Advisor Agent - Query optimization suggestions.
 */
export interface IPerformanceAdvisorAgent extends CognitiveAgent {
	/**
	 * Analyze query performance.
	 */
	analyzePerformance(query: string, executionPlan?: string): Promise<SQLPerformanceIssue[]>;

	/**
	 * Suggest indexes for workload.
	 */
	suggestIndexes(queries: string[]): Promise<SQLIndexSuggestion[]>;

	/**
	 * Identify query anti-patterns.
	 */
	identifyAntiPatterns(query: string): Promise<string[]>;

	/**
	 * Generate query optimization report.
	 */
	generateReport(queries: string[]): Promise<string>;
}

export const IDataPatternAgent = createDecorator<IDataPatternAgent>('dataPatternAgent');

/**
 * Data Pattern Agent - Statistical pattern recognition.
 */
export interface IDataPatternAgent extends CognitiveAgent {
	/**
	 * Detect patterns in query results.
	 */
	detectPatterns(data: any[]): Promise<DataPattern[]>;

	/**
	 * Generate statistical summary.
	 */
	generateSummary(data: any[]): Promise<DataSummary>;

	/**
	 * Identify anomalies in data.
	 */
	identifyAnomalies(data: any[]): Promise<DataAnomaly[]>;

	/**
	 * Suggest data quality improvements.
	 */
	suggestDataQualityImprovements(data: any[]): Promise<string[]>;
}

/**
 * Data pattern detected.
 */
export interface DataPattern {
	/** Pattern type */
	type: 'trend' | 'seasonality' | 'cluster' | 'outlier' | 'correlation';
	/** Description */
	description: string;
	/** Confidence */
	confidence: number;
	/** Affected columns */
	columns: string[];
}

/**
 * Data summary.
 */
export interface DataSummary {
	/** Row count */
	rowCount: number;
	/** Column summaries */
	columns: ColumnSummary[];
	/** Overall data quality score */
	qualityScore: number;
}

/**
 * Column summary.
 */
export interface ColumnSummary {
	/** Column name */
	name: string;
	/** Data type */
	type: string;
	/** Null percentage */
	nullPercentage: number;
	/** Distinct count */
	distinctCount: number;
	/** Min/Max/Avg for numerics */
	statistics?: { min: number; max: number; avg: number; stddev: number };
}

/**
 * Data anomaly.
 */
export interface DataAnomaly {
	/** Anomaly type */
	type: 'outlier' | 'missing' | 'inconsistent' | 'duplicate';
	/** Severity */
	severity: 'low' | 'medium' | 'high';
	/** Description */
	description: string;
	/** Affected rows (indices) */
	affectedRows?: number[];
}
