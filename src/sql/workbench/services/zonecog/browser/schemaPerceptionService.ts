/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ISchemaPerceptionService,
	PerceivedSchemaElement,
	SchemaElementType,
	SchemaPerceptionEvent,
	ObservedQuery,
	QueryObservationEvent,
	QueryStatistics,
	QueryOperationType
} from 'sql/workbench/services/zonecog/common/schemaPerception';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Maximum number of observed queries to retain per connection.
 */
const MAX_QUERY_HISTORY = 500;

/**
 * Schema Perception Service implementation.
 *
 * Provides embodied cognition interface to database schemas, perceiving
 * schema elements and query executions as sensory inputs for the
 * Zone-Cog cognitive workbench.
 */
export class SchemaPerceptionService extends Disposable implements ISchemaPerceptionService {

	declare readonly _serviceBrand: undefined;

	// Schema element storage: connectionUri -> elementId -> element
	private readonly _elements = new Map<string, Map<string, PerceivedSchemaElement>>();

	// Query observation storage: connectionUri -> queries[]
	private readonly _queries = new Map<string, ObservedQuery[]>();

	// Active perception tracking
	private readonly _activePerceptions = new Set<string>();

	// Element access counts for salience calculation
	private readonly _accessCounts = new Map<string, number>();

	private _queryCounter = 0;

	private readonly _onDidPerceiveSchema = this._register(new Emitter<SchemaPerceptionEvent>());
	readonly onDidPerceiveSchema: Event<SchemaPerceptionEvent> = this._onDidPerceiveSchema.event;

	private readonly _onDidObserveQuery = this._register(new Emitter<QueryObservationEvent>());
	readonly onDidObserveQuery: Event<QueryObservationEvent> = this._onDidObserveQuery.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService
	) {
		super();
		this.logService.info('SchemaPerceptionService: initialized schema perception for embodied cognition');
	}

	// -- Schema Perception ----------------------------------------------------

	async perceiveSchema(connectionUri: string): Promise<PerceivedSchemaElement[]> {
		this.membraneService.recordActivity('somatic');
		this._activePerceptions.add(connectionUri);

		// Initialize storage for this connection
		if (!this._elements.has(connectionUri)) {
			this._elements.set(connectionUri, new Map());
		}

		const elements: PerceivedSchemaElement[] = [];

		try {
			// In a full implementation, this would query the actual database schema
			// using IConnectionManagementService and provider APIs.
			// For now, we create a simulated perception that can be extended.

			this.logService.info(`SchemaPerceptionService: perceiving schema for ${connectionUri}`);

			// Emit perception event
			this._onDidPerceiveSchema.fire({
				type: 'discovered',
				connectionUri,
				elements,
			});

			// Feed perception to embodied cognition layer
			this.embodiedService.perceive(
				'schema',
				`Schema perception completed for ${connectionUri}`,
				JSON.stringify({ connectionUri, elementCount: elements.length }),
				0.6
			);

			return elements;

		} catch (error) {
			this.membraneService.recordError('somatic', `Schema perception failed: ${error}`);
			throw error;
		}
	}

	getPerceivedElements(connectionUri: string): PerceivedSchemaElement[] {
		const elementMap = this._elements.get(connectionUri);
		if (!elementMap) {
			return [];
		}
		return Array.from(elementMap.values());
	}

	getElement(elementId: string): PerceivedSchemaElement | undefined {
		for (const elementMap of this._elements.values()) {
			const element = elementMap.get(elementId);
			if (element) {
				return element;
			}
		}
		return undefined;
	}

	getElementsByType(connectionUri: string, elementType: SchemaElementType): PerceivedSchemaElement[] {
		const elements = this.getPerceivedElements(connectionUri);
		return elements.filter(e => e.elementType === elementType);
	}

	searchElements(connectionUri: string, pattern: string): PerceivedSchemaElement[] {
		const elements = this.getPerceivedElements(connectionUri);
		const lowerPattern = pattern.toLowerCase();
		return elements.filter(e =>
			e.name.toLowerCase().includes(lowerPattern) ||
			e.qualifiedName.toLowerCase().includes(lowerPattern)
		);
	}

	// -- Query Observation ----------------------------------------------------

	observeQuery(queryData: Omit<ObservedQuery, 'id'>): ObservedQuery {
		this.membraneService.recordActivity('somatic');

		const query: ObservedQuery = {
			id: `query-${++this._queryCounter}`,
			...queryData,
		};

		// Store the query
		if (!this._queries.has(query.connectionUri)) {
			this._queries.set(query.connectionUri, []);
		}
		const queries = this._queries.get(query.connectionUri)!;
		queries.push(query);

		// Trim history if needed
		while (queries.length > MAX_QUERY_HISTORY) {
			queries.shift();
		}

		// Update access counts for referenced tables
		for (const table of query.referencedTables) {
			const current = this._accessCounts.get(table) ?? 0;
			this._accessCounts.set(table, current + 1);
		}

		// Calculate salience based on query characteristics
		const salienceScore = this._calculateQuerySalience(query);

		// Feed to embodied cognition
		this.embodiedService.perceive(
			'query',
			`${query.operationType.toUpperCase()}: ${query.queryText.substring(0, 100)}`,
			JSON.stringify({
				operationType: query.operationType,
				durationMs: query.durationMs,
				rowCount: query.rowCount,
				success: query.success,
			}),
			salienceScore
		);

		// Emit observation event
		this._onDidObserveQuery.fire({ query, salienceScore });

		this.logService.trace(
			`SchemaPerceptionService: observed ${query.operationType} query (${query.durationMs}ms, ${query.rowCount} rows)`
		);

		return query;
	}

	getRecentQueries(connectionUri: string, limit: number = 50): ObservedQuery[] {
		const queries = this._queries.get(connectionUri) ?? [];
		return queries.slice(-limit);
	}

	getQueriesForTable(tableName: string): ObservedQuery[] {
		const result: ObservedQuery[] = [];
		const lowerTable = tableName.toLowerCase();

		for (const queries of this._queries.values()) {
			for (const query of queries) {
				if (query.referencedTables.some(t => t.toLowerCase() === lowerTable)) {
					result.push(query);
				}
			}
		}

		return result;
	}

	getQueryStatistics(connectionUri: string): QueryStatistics {
		const queries = this._queries.get(connectionUri) ?? [];

		const stats: QueryStatistics = {
			totalQueries: queries.length,
			successfulQueries: queries.filter(q => q.success).length,
			failedQueries: queries.filter(q => !q.success).length,
			averageDurationMs: 0,
			frequentTables: [],
			operationCounts: {
				select: 0,
				insert: 0,
				update: 0,
				delete: 0,
				create: 0,
				alter: 0,
				drop: 0,
				truncate: 0,
				other: 0,
			},
		};

		if (queries.length === 0) {
			return stats;
		}

		// Calculate average duration
		const totalDuration = queries.reduce((sum, q) => sum + q.durationMs, 0);
		stats.averageDurationMs = Math.round(totalDuration / queries.length);

		// Count operation types
		for (const query of queries) {
			stats.operationCounts[query.operationType]++;
		}

		// Calculate frequent tables
		const tableCounts = new Map<string, number>();
		for (const query of queries) {
			for (const table of query.referencedTables) {
				const current = tableCounts.get(table) ?? 0;
				tableCounts.set(table, current + 1);
			}
		}

		stats.frequentTables = Array.from(tableCounts.entries())
			.map(([table, accessCount]) => ({ table, accessCount }))
			.sort((a, b) => b.accessCount - a.accessCount)
			.slice(0, 10);

		return stats;
	}

	// -- Cognitive Integration ------------------------------------------------

	async registerSchemaInHypergraph(connectionUri: string): Promise<number> {
		this.membraneService.recordActivity('cerebral');

		const elements = this.getPerceivedElements(connectionUri);
		let nodesCreated = 0;

		for (const element of elements) {
			const nodeId = `schema-${element.id}`;

			// Check if node already exists
			if (this.hypergraphStore.getNode(nodeId)) {
				continue;
			}

			// Create hypergraph node for this schema element
			this.hypergraphStore.addNode({
				id: nodeId,
				node_type: `Schema:${element.elementType}`,
				content: JSON.stringify({
					name: element.name,
					qualifiedName: element.qualifiedName,
					metadata: element.metadata,
				}),
				links: [],
				metadata: {
					connectionUri: element.connectionUri,
					elementType: element.elementType,
					parentId: element.parentId,
					perceivedAt: element.perceivedAt,
				},
				salience_score: this.getElementSalience(element.id),
			});

			nodesCreated++;
		}

		// Create links between related elements (e.g., table -> columns)
		for (const element of elements) {
			if (element.parentId) {
				const parentNodeId = `schema-${element.parentId}`;
				const childNodeId = `schema-${element.id}`;

				if (this.hypergraphStore.getNode(parentNodeId) && this.hypergraphStore.getNode(childNodeId)) {
					this.hypergraphStore.addLink({
						id: `schema-link-${element.id}`,
						link_type: 'SchemaContains',
						outgoing: [parentNodeId, childNodeId],
						metadata: {},
					});
				}
			}
		}

		this.logService.info(
			`SchemaPerceptionService: registered ${nodesCreated} schema nodes in hypergraph for ${connectionUri}`
		);

		return nodesCreated;
	}

	getElementSalience(elementId: string): number {
		const accessCount = this._accessCounts.get(elementId) ?? 0;

		// Calculate salience based on access frequency
		// Using logarithmic scaling to prevent very frequent elements from dominating
		if (accessCount === 0) {
			return 0.1; // Base salience for unaccessed elements
		}

		// Scale from 0.1 to 1.0 based on access count
		const normalizedAccess = Math.min(1, Math.log10(accessCount + 1) / 2);
		return 0.1 + normalizedAccess * 0.9;
	}

	clearPerception(connectionUri: string): void {
		this._elements.delete(connectionUri);
		this._queries.delete(connectionUri);
		this._activePerceptions.delete(connectionUri);

		// Remove hypergraph nodes for this connection
		const allNodes = this.hypergraphStore.getAllNodes();
		for (const node of allNodes) {
			if (node.metadata['connectionUri'] === connectionUri) {
				this.hypergraphStore.removeNode(node.id);
			}
		}

		this._onDidPerceiveSchema.fire({
			type: 'removed',
			connectionUri,
			elements: [],
		});

		this.logService.info(`SchemaPerceptionService: cleared perception for ${connectionUri}`);
	}

	isPerceiving(connectionUri: string): boolean {
		return this._activePerceptions.has(connectionUri);
	}

	// -- Private Helpers ------------------------------------------------------

	/**
	 * Calculate cognitive salience for a query based on its characteristics.
	 */
	private _calculateQuerySalience(query: ObservedQuery): number {
		let salience = 0.3; // Base salience

		// Failed queries are more salient (require attention)
		if (!query.success) {
			salience += 0.3;
		}

		// Long-running queries are more salient
		if (query.durationMs > 5000) {
			salience += 0.2;
		} else if (query.durationMs > 1000) {
			salience += 0.1;
		}

		// DDL operations are more salient (schema changes)
		if (['create', 'alter', 'drop', 'truncate'].includes(query.operationType)) {
			salience += 0.2;
		}

		// Large result sets are more salient
		if (query.rowCount > 10000) {
			salience += 0.15;
		} else if (query.rowCount > 1000) {
			salience += 0.05;
		}

		return Math.min(1, salience);
	}

	/**
	 * Parse query text to extract operation type.
	 */
	parseQueryOperationType(queryText: string): QueryOperationType {
		const trimmed = queryText.trim().toLowerCase();

		if (trimmed.startsWith('select')) { return 'select'; }
		if (trimmed.startsWith('insert')) { return 'insert'; }
		if (trimmed.startsWith('update')) { return 'update'; }
		if (trimmed.startsWith('delete')) { return 'delete'; }
		if (trimmed.startsWith('create')) { return 'create'; }
		if (trimmed.startsWith('alter')) { return 'alter'; }
		if (trimmed.startsWith('drop')) { return 'drop'; }
		if (trimmed.startsWith('truncate')) { return 'truncate'; }

		return 'other';
	}

	/**
	 * Extract table names from a query (basic pattern matching).
	 */
	extractReferencedTables(queryText: string): string[] {
		const tables: string[] = [];
		const lowerQuery = queryText.toLowerCase();

		// Match FROM clause tables
		const fromMatch = lowerQuery.match(/\bfrom\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)/gi);
		if (fromMatch) {
			for (const match of fromMatch) {
				const tableName = match.replace(/^from\s+/i, '').trim();
				if (tableName && !tables.includes(tableName)) {
					tables.push(tableName);
				}
			}
		}

		// Match JOIN clause tables
		const joinMatch = lowerQuery.match(/\bjoin\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)/gi);
		if (joinMatch) {
			for (const match of joinMatch) {
				const tableName = match.replace(/^join\s+/i, '').trim();
				if (tableName && !tables.includes(tableName)) {
					tables.push(tableName);
				}
			}
		}

		// Match INSERT INTO
		const insertMatch = lowerQuery.match(/\binsert\s+into\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)/i);
		if (insertMatch) {
			const tableName = insertMatch[1].trim();
			if (tableName && !tables.includes(tableName)) {
				tables.push(tableName);
			}
		}

		// Match UPDATE
		const updateMatch = lowerQuery.match(/\bupdate\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)/i);
		if (updateMatch) {
			const tableName = updateMatch[1].trim();
			if (tableName && !tables.includes(tableName)) {
				tables.push(tableName);
			}
		}

		return tables;
	}
}
