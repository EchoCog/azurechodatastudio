/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const ISchemaPerceptionService = createDecorator<ISchemaPerceptionService>('schemaPerceptionService');

// ---------------------------------------------------------------------------
// Schema Perception Types
// ---------------------------------------------------------------------------

/**
 * Represents a perceived database schema element.
 */
export interface PerceivedSchemaElement {
	/** Unique identifier for this schema element. */
	id: string;
	/** Type of schema element (database, table, column, index, etc.). */
	elementType: SchemaElementType;
	/** Name of the element. */
	name: string;
	/** Fully qualified name (e.g., "database.schema.table"). */
	qualifiedName: string;
	/** Parent element ID (null for top-level databases). */
	parentId: string | null;
	/** Connection URI this element belongs to. */
	connectionUri: string;
	/** Additional metadata about the element. */
	metadata: SchemaElementMetadata;
	/** Timestamp when this element was last perceived. */
	perceivedAt: number;
}

/**
 * Types of schema elements that can be perceived.
 */
export type SchemaElementType =
	| 'database'
	| 'schema'
	| 'table'
	| 'view'
	| 'column'
	| 'index'
	| 'constraint'
	| 'procedure'
	| 'function'
	| 'trigger';

/**
 * Metadata for a perceived schema element.
 */
export interface SchemaElementMetadata {
	/** Data type (for columns). */
	dataType?: string;
	/** Whether the column is nullable. */
	nullable?: boolean;
	/** Whether this is a primary key. */
	isPrimaryKey?: boolean;
	/** Whether this is a foreign key. */
	isForeignKey?: boolean;
	/** Referenced table for foreign keys. */
	referencedTable?: string;
	/** Row count estimate (for tables). */
	rowCount?: number;
	/** Size in bytes (for tables). */
	sizeBytes?: number;
	/** Index type (for indexes). */
	indexType?: string;
	/** Constraint type (for constraints). */
	constraintType?: string;
	/** Additional provider-specific properties. */
	extra?: Record<string, unknown>;
}

/**
 * Result of a query observation.
 */
export interface ObservedQuery {
	/** Unique identifier for this query observation. */
	id: string;
	/** The SQL query text. */
	queryText: string;
	/** Connection URI where the query was executed. */
	connectionUri: string;
	/** Query execution start time. */
	startTime: number;
	/** Query execution duration in milliseconds. */
	durationMs: number;
	/** Number of rows affected/returned. */
	rowCount: number;
	/** Whether the query succeeded. */
	success: boolean;
	/** Error message if the query failed. */
	errorMessage?: string;
	/** Tables referenced by the query (parsed). */
	referencedTables: string[];
	/** Query operation type (SELECT, INSERT, UPDATE, DELETE, DDL). */
	operationType: QueryOperationType;
	/** Performance insights extracted from the query. */
	performanceInsights?: QueryPerformanceInsights;
}

/**
 * Query operation types.
 */
export type QueryOperationType =
	| 'select'
	| 'insert'
	| 'update'
	| 'delete'
	| 'create'
	| 'alter'
	| 'drop'
	| 'truncate'
	| 'other';

/**
 * Performance insights for a query.
 */
export interface QueryPerformanceInsights {
	/** Whether the query used an index. */
	usedIndex?: boolean;
	/** Estimated cost (if available from query plan). */
	estimatedCost?: number;
	/** Actual rows scanned. */
	rowsScanned?: number;
	/** Suggested optimizations. */
	suggestions?: string[];
}

/**
 * Event fired when schema elements are perceived.
 */
export interface SchemaPerceptionEvent {
	/** Type of perception event. */
	type: 'discovered' | 'updated' | 'removed';
	/** Connection URI for the event. */
	connectionUri: string;
	/** Schema elements involved. */
	elements: PerceivedSchemaElement[];
}

/**
 * Event fired when a query is observed.
 */
export interface QueryObservationEvent {
	/** The observed query. */
	query: ObservedQuery;
	/** Cognitive salience score assigned (0-1). */
	salienceScore: number;
}

// ---------------------------------------------------------------------------
// Service Interface
// ---------------------------------------------------------------------------

/**
 * Schema Perception Service - Embodied cognition interface to database schemas.
 *
 * This service acts as the "sensory organ" for the Zone-Cog cognitive workbench,
 * perceiving database schemas and query executions as sensory inputs for the
 * embodied cognition layer.
 *
 * Key responsibilities:
 * 1. **Schema Discovery**: Perceive and track connected database schemas
 * 2. **Query Observation**: Monitor executed queries as sensory events
 * 3. **Pattern Recognition**: Identify query patterns and usage trends
 * 4. **Embodied Grounding**: Feed percepts to the EmbodiedCognitionService
 * 5. **Hypergraph Integration**: Create schema nodes in the knowledge graph
 */
export interface ISchemaPerceptionService {
	readonly _serviceBrand: undefined;

	/** Fired when schema elements are perceived. */
	readonly onDidPerceiveSchema: Event<SchemaPerceptionEvent>;

	/** Fired when a query is observed. */
	readonly onDidObserveQuery: Event<QueryObservationEvent>;

	// -- Schema Perception ----------------------------------------------------

	/**
	 * Perceive the schema for a database connection.
	 * Discovers tables, views, columns, indexes, and relationships.
	 * @param connectionUri The connection URI to perceive.
	 * @returns The perceived schema elements.
	 */
	perceiveSchema(connectionUri: string): Promise<PerceivedSchemaElement[]>;

	/**
	 * Get all perceived schema elements for a connection.
	 */
	getPerceivedElements(connectionUri: string): PerceivedSchemaElement[];

	/**
	 * Get a specific perceived element by ID.
	 */
	getElement(elementId: string): PerceivedSchemaElement | undefined;

	/**
	 * Get elements by type for a connection.
	 */
	getElementsByType(connectionUri: string, elementType: SchemaElementType): PerceivedSchemaElement[];

	/**
	 * Search perceived elements by name pattern.
	 */
	searchElements(connectionUri: string, pattern: string): PerceivedSchemaElement[];

	// -- Query Observation ----------------------------------------------------

	/**
	 * Observe a query execution.
	 * @param query The query observation to record.
	 */
	observeQuery(query: Omit<ObservedQuery, 'id'>): ObservedQuery;

	/**
	 * Get recent observed queries for a connection.
	 */
	getRecentQueries(connectionUri: string, limit?: number): ObservedQuery[];

	/**
	 * Get queries that reference a specific table.
	 */
	getQueriesForTable(tableName: string): ObservedQuery[];

	/**
	 * Get query statistics for a connection.
	 */
	getQueryStatistics(connectionUri: string): QueryStatistics;

	// -- Cognitive Integration ------------------------------------------------

	/**
	 * Register schema elements as hypergraph nodes.
	 * @param connectionUri The connection to register.
	 */
	registerSchemaInHypergraph(connectionUri: string): Promise<number>;

	/**
	 * Get the salience score for a schema element based on usage.
	 */
	getElementSalience(elementId: string): number;

	/**
	 * Clear perceived schema for a connection.
	 */
	clearPerception(connectionUri: string): void;

	/**
	 * Check if schema perception is active for a connection.
	 */
	isPerceiving(connectionUri: string): boolean;
}

/**
 * Query statistics for a connection.
 */
export interface QueryStatistics {
	/** Total queries observed. */
	totalQueries: number;
	/** Successful queries. */
	successfulQueries: number;
	/** Failed queries. */
	failedQueries: number;
	/** Average query duration in milliseconds. */
	averageDurationMs: number;
	/** Most frequently accessed tables. */
	frequentTables: Array<{ table: string; accessCount: number }>;
	/** Query type distribution. */
	operationCounts: Record<QueryOperationType, number>;
}
