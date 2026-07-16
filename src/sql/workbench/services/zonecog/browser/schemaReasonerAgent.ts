/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	ISchemaReasonerAgent,
	SchemaReasoningResult,
	SchemaElementAnalysis,
	SchemaRelationship,
	SchemaQualityIssue,
	NormalizationAnalysis,
	DomainModelInference,
	ColumnAnalysis,
} from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { AgentCapabilities, AgentStatus, AgentAction } from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IHypergraphStore, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

/**
 * Schema Reasoner Agent Implementation.
 * Provides database schema understanding and analysis.
 */
export class SchemaReasonerAgent extends Disposable implements ISchemaReasonerAgent {
	readonly _serviceBrand: undefined;

	readonly id: string = 'schema-reasoner-agent';
	readonly name: string = 'Schema Reasoner';
	readonly description: string = 'Database schema understanding and analysis';

	private _status: AgentStatus = 'idle';
	private _currentLoad: number = 0;

	private readonly _onDidChangeStatus = this._register(new Emitter<AgentStatus>());
	readonly onDidChangeStatus: Event<AgentStatus> = this._onDidChangeStatus.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILLMProviderService private readonly llmService: ILLMProviderService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super();
		this.logService.info('[SchemaReasonerAgent] Initialized');
	}

	getCapabilities(): AgentCapabilities {
		return {
			canPerceive: true,
			canReason: true,
			canAct: true,
			supportedActions: ['analyze_schema', 'discover_relationships', 'infer_domain', 'suggest_improvements', 'generate_docs', 'compare_schemas'],
			maxConcurrentTasks: 2,
		};
	}

	getStatus(): AgentStatus {
		return this._status;
	}

	getCurrentLoad(): number {
		return this._currentLoad;
	}

	async perceive(input: any): Promise<void> {
		this.membraneService.recordActivity('cerebral');
		if (typeof input === 'string' && this._looksLikeSchema(input)) {
			const node: Omit<HypergraphNode, 'id'> = {
				node_type: 'schema_definition',
				content: input,
				links: [],
				metadata: {
					perceived_at: Date.now(),
					agent: this.id,
				},
				salience_score: 0.7,
			};
			await this.hypergraphStore.addNode(node);
		}
	}

	async decide(context: any): Promise<AgentAction | null> {
		this.membraneService.recordActivity('cerebral');

		if (context.schema && typeof context.schema === 'string') {
			return {
				action: 'analyze_schema',
				target: context.schema,
				parameters: {},
				confidence: 0.9,
			};
		}

		return null;
	}

	async execute(action: AgentAction): Promise<any> {
		this.membraneService.recordActivity('somatic');
		this._status = 'active';
		this._currentLoad += 0.5;
		this._onDidChangeStatus.fire(this._status);

		try {
			switch (action.action) {
				case 'analyze_schema':
					return await this.analyzeSchema(action.target);
				case 'discover_relationships':
					return await this.discoverRelationships(
						Array.isArray(action.parameters?.tables)
							? action.parameters.tables.filter((table): table is string => typeof table === 'string')
							: []
					);
				case 'infer_domain':
					return await this.inferDomainModel(action.target);
				case 'suggest_improvements':
					return await this.suggestImprovements(action.target);
				case 'generate_docs':
					return await this.generateDocumentation(action.target);
				case 'compare_schemas':
					return await this.compareSchemas(
						action.target,
						typeof action.parameters?.schema2 === 'string' ? action.parameters.schema2 : ''
					);
				default:
					throw new Error(`Unknown action: ${action.action}`);
			}
		} finally {
			this._currentLoad = Math.max(0, this._currentLoad - 0.5);
			this._status = this._currentLoad > 0 ? 'active' : 'idle';
			this._onDidChangeStatus.fire(this._status);
		}
	}

	async analyzeSchema(schemaDefinition: string): Promise<SchemaReasoningResult> {
		this._status = 'active';
		this._currentLoad += 0.5;
		this._onDidChangeStatus.fire(this._status);

		try {
			return await this._analyzeSchemaInternal(schemaDefinition);
		} finally {
			this._currentLoad = Math.max(0, this._currentLoad - 0.5);
			this._status = this._currentLoad > 0 ? 'active' : 'idle';
			this._onDidChangeStatus.fire(this._status);
		}
	}

	private async _analyzeSchemaInternal(schemaDefinition: string): Promise<SchemaReasoningResult> {
		this.membraneService.recordActivity('cerebral');
		this.logService.info(`[SchemaReasonerAgent] Analyzing schema...`);

		// Parse schema elements
		const elements = this._parseSchemaElements(schemaDefinition);

		// Discover relationships
		const relationships = await this._discoverRelationshipsFromSchema(schemaDefinition, elements);

		// Identify quality issues
		const qualityIssues = this._identifyQualityIssues(schemaDefinition, elements);

		// Analyze normalization
		const normalization = await this._analyzeNormalization(schemaDefinition, elements);

		// Infer domain model
		const domainModel = await this.inferDomainModel(schemaDefinition);

		const result: SchemaReasoningResult = {
			elements,
			relationships,
			qualityIssues,
			normalization,
			domainModel,
		};

		// Store in hypergraph
		await this._storeSchemaAnalysis(schemaDefinition, result);

		return result;
	}

	async discoverRelationships(tables: string[]): Promise<SchemaRelationship[]> {
		this.membraneService.recordActivity('cerebral');

		const uniqueTables = Array.from(new Set(tables));
		const catalog = uniqueTables.map(name => ({
			name,
			singular: this._singularize(name.toLowerCase()),
			tokens: this._tokenizeTableName(name),
		}));

		const relationships: SchemaRelationship[] = [];

		// Cross-table FK inference: a table whose name tokenizes into another
		// table's (singularized) name likely holds a foreign key to it
		// (e.g. "order_items" -> "orders", "student_courses" -> "students").
		for (const source of catalog) {
			for (const target of catalog) {
				if (source.name === target.name) {
					continue;
				}
				const referencesTarget = source.tokens.includes(target.singular) || source.tokens.includes(target.name.toLowerCase());
				if (!referencesTarget) {
					continue;
				}
				const alreadyFound = relationships.some(r => r.sourceTable === source.name && r.targetTable === target.name);
				if (alreadyFound) {
					continue;
				}
				relationships.push({
					sourceTable: source.name,
					targetTable: target.name,
					relationshipType: 'one_to_many',
					cardinality: 'N:1',
					foreignKeyColumns: [`${target.singular}_id`],
					isExplicit: false,
				});
			}
		}

		// Junction table (many-to-many) detection: a table that resolves to
		// exactly two distinct FK-style references is likely a join table
		// linking those two tables in a many-to-many relationship.
		for (const junction of catalog) {
			const refs = relationships.filter(r => r.sourceTable === junction.name);
			const distinctTargets = Array.from(new Set(refs.map(r => r.targetTable)));
			if (distinctTargets.length !== 2) {
				continue;
			}
			const [left, right] = distinctTargets;
			const alreadyFound = relationships.some(r =>
				r.relationshipType === 'many_to_many' &&
				((r.sourceTable === left && r.targetTable === right) || (r.sourceTable === right && r.targetTable === left)));
			if (alreadyFound) {
				continue;
			}
			relationships.push({
				sourceTable: left,
				targetTable: right,
				relationshipType: 'many_to_many',
				cardinality: 'M:N',
				foreignKeyColumns: refs.flatMap(r => r.foreignKeyColumns),
				isExplicit: false,
			});
		}

		return relationships;
	}

	async inferDomainModel(schemaDefinition: string): Promise<DomainModelInference> {
		this.membraneService.recordActivity('cerebral');

		const prompt = `Analyze this database schema and infer the domain model:

${schemaDefinition}

Identify:
1. Main entities (business objects)
2. Which tables are aggregate roots
3. Bounded contexts
4. Business rules suggested by constraints

Return a structured analysis.`;

		await this.llmService.complete(prompt);

		// Parse entities from schema
		const entities = this._extractEntities(schemaDefinition);

		return {
			entities,
			aggregates: entities.filter(e => e.isAggregateRoot).map(e => e.name),
			boundedContexts: this._inferBoundedContexts(entities),
			businessRules: this._extractBusinessRules(schemaDefinition),
		};
	}

	async suggestImprovements(schemaDefinition: string): Promise<SchemaQualityIssue[]> {
		this.membraneService.recordActivity('cerebral');

		const elements = this._parseSchemaElements(schemaDefinition);
		return this._identifyQualityIssues(schemaDefinition, elements);
	}

	async generateDocumentation(schemaDefinition: string): Promise<string> {
		this.membraneService.recordActivity('cerebral');

		const analysis = await this.analyzeSchema(schemaDefinition);

		let doc = `# Database Schema Documentation\n\n`;
		doc += `## Overview\n\n`;
		doc += `This database contains ${analysis.elements.length} objects.\n\n`;

		doc += `## Tables\n\n`;
		for (const element of analysis.elements.filter(e => e.type === 'table')) {
			doc += `### ${element.name}\n\n`;
			doc += `**Purpose:** ${element.inferredPurpose}\n\n`;

			if (element.columns && element.columns.length > 0) {
				doc += `| Column | Type | Role | Description |\n`;
				doc += `|--------|------|------|-------------|\n`;
				for (const col of element.columns) {
					doc += `| ${col.name} | ${col.dataType} | ${col.role} | ${col.semanticMeaning} |\n`;
				}
				doc += '\n';
			}
		}

		doc += `## Relationships\n\n`;
		for (const rel of analysis.relationships) {
			doc += `- **${rel.sourceTable}** → **${rel.targetTable}** (${rel.relationshipType})\n`;
		}

		doc += `\n## Domain Model\n\n`;
		for (const entity of analysis.domainModel.entities) {
			doc += `### ${entity.name}\n`;
			doc += `- Aggregate Root: ${entity.isAggregateRoot ? 'Yes' : 'No'}\n`;
			doc += `- Backing Tables: ${entity.backingTables.join(', ')}\n\n`;
		}

		return doc;
	}

	async compareSchemas(schema1: string, schema2: string): Promise<string> {
		this.membraneService.recordActivity('cerebral');

		const elements1 = this._parseSchemaElements(schema1);
		const elements2 = this._parseSchemaElements(schema2);

		const names1 = new Set(elements1.map(e => e.name));
		const names2 = new Set(elements2.map(e => e.name));

		const added = elements2.filter(e => !names1.has(e.name));
		const removed = elements1.filter(e => !names2.has(e.name));
		const common = elements1.filter(e => names2.has(e.name));

		let diff = `# Schema Comparison\n\n`;

		diff += `## Added (${added.length})\n`;
		for (const e of added) {
			diff += `- ${e.type}: ${e.name}\n`;
		}

		diff += `\n## Removed (${removed.length})\n`;
		for (const e of removed) {
			diff += `- ${e.type}: ${e.name}\n`;
		}

		diff += `\n## Modified\n`;
		// Would need deeper comparison for modified elements

		diff += `\n## Unchanged (${common.length})\n`;

		return diff;
	}

	private _looksLikeSchema(text: string): boolean {
		const schemaKeywords = /\b(CREATE\s+TABLE|CREATE\s+INDEX|ALTER\s+TABLE|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i;
		return schemaKeywords.test(text);
	}

	private _parseSchemaElements(schema: string): SchemaElementAnalysis[] {
		const elements: SchemaElementAnalysis[] = [];

		// Parse tables
		const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\);/gi;
		let match;

		while ((match = tablePattern.exec(schema)) !== null) {
			const tableName = match[1];
			const columnsDef = match[2];
			const columns = this._parseColumns(columnsDef);

			elements.push({
				name: tableName,
				type: 'table',
				inferredPurpose: this._inferTablePurpose(tableName, columns),
				entityType: this._inferEntityType(tableName),
				columns,
			});
		}

		// Parse views
		const viewPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+[`"\[]?(\w+)[`"\]]?/gi;
		while ((match = viewPattern.exec(schema)) !== null) {
			elements.push({
				name: match[1],
				type: 'view',
				inferredPurpose: `View derived from underlying tables`,
			});
		}

		// Parse indexes
		const indexPattern = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+[`"\[]?(\w+)[`"\]]?\s+ON\s+[`"\[]?(\w+)[`"\]]?/gi;
		while ((match = indexPattern.exec(schema)) !== null) {
			elements.push({
				name: match[1],
				type: 'index',
				inferredPurpose: `Index on table ${match[2]}`,
			});
		}

		return elements;
	}

	private _parseColumns(columnsDef: string): ColumnAnalysis[] {
		const columns: ColumnAnalysis[] = [];
		const lines = columnsDef.split(',').map(l => l.trim()).filter(l => l.length > 0);

		for (const line of lines) {
			// Skip constraints
			if (/^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)/i.test(line)) {
				continue;
			}

			const colMatch = line.match(/^[`"\[]?(\w+)[`"\]]?\s+(\w+(?:\([^)]+\))?)/i);
			if (colMatch) {
				const name = colMatch[1];
				const dataType = colMatch[2];

				columns.push({
					name,
					dataType,
					role: this._inferColumnRole(name, dataType, line),
					semanticMeaning: this._inferColumnMeaning(name, dataType),
				});
			}
		}

		return columns;
	}

	private _inferColumnRole(name: string, dataType: string, definition: string): ColumnAnalysis['role'] {
		const nameLower = name.toLowerCase();

		if (/PRIMARY\s+KEY/i.test(definition) || nameLower === 'id') {
			return 'primary_key';
		}
		if (/_id$/.test(nameLower) || /REFERENCES/i.test(definition)) {
			return 'foreign_key';
		}
		if (/created|updated|modified|timestamp|date/i.test(nameLower)) {
			return 'timestamp';
		}
		if (/^is_|^has_|^can_|active|enabled|flag/i.test(nameLower)) {
			return 'flag';
		}
		if (/amount|total|count|sum|price|quantity|score/i.test(nameLower)) {
			return 'measure';
		}
		if (/type|category|status|level|tier/i.test(nameLower)) {
			return 'dimension';
		}

		return 'attribute';
	}

	private _inferColumnMeaning(name: string, dataType: string): string {
		const nameLower = name.toLowerCase();

		if (nameLower === 'id') return 'Primary identifier';
		if (/_id$/.test(nameLower)) return `Reference to ${nameLower.replace(/_id$/, '')} table`;
		if (/email/.test(nameLower)) return 'Email address';
		if (/name/.test(nameLower)) return 'Name field';
		if (/created_at|created_on/.test(nameLower)) return 'Record creation timestamp';
		if (/updated_at|modified_at/.test(nameLower)) return 'Last modification timestamp';
		if (/password|hash/.test(nameLower)) return 'Sensitive credential data';
		if (/phone|mobile/.test(nameLower)) return 'Phone number';
		if (/address/.test(nameLower)) return 'Address information';
		if (/price|amount|cost/.test(nameLower)) return 'Monetary value';
		if (/description|desc/.test(nameLower)) return 'Descriptive text';

		return `${name} field`;
	}

	private _inferTablePurpose(tableName: string, columns: ColumnAnalysis[]): string {
		if (/users?$/i.test(tableName)) return 'Stores user account information';
		if (/products?$/i.test(tableName)) return 'Product catalog';
		if (/orders?$/i.test(tableName)) return 'Order records';
		if (/customers?$/i.test(tableName)) return 'Customer information';
		if (/items?$/i.test(tableName)) return 'Item records';
		if (/log|audit|history/i.test(tableName)) return 'Audit/log records';
		if (/config|setting/i.test(tableName)) return 'Configuration storage';
		if (/_\w+_$/i.test(tableName)) return 'Junction table for many-to-many relationship';

		return `Stores ${tableName.replace(/_/g, ' ')} data`;
	}

	private _inferEntityType(tableName: string): string {
		const nameLower = tableName.toLowerCase().replace(/_/g, '');

		if (/user|account|profile/.test(nameLower)) return 'User';
		if (/product|item|good/.test(nameLower)) return 'Product';
		if (/order|purchase|transaction/.test(nameLower)) return 'Transaction';
		if (/customer|client/.test(nameLower)) return 'Customer';
		if (/employee|staff|worker/.test(nameLower)) return 'Employee';
		if (/message|notification|alert/.test(nameLower)) return 'Communication';
		if (/document|file|attachment/.test(nameLower)) return 'Document';

		return 'Entity';
	}

	private async _discoverRelationshipsFromSchema(schema: string, elements: SchemaElementAnalysis[]): Promise<SchemaRelationship[]> {
		const relationships: SchemaRelationship[] = [];

		// Parse explicit foreign keys
		const fkPattern = /FOREIGN\s+KEY\s*\([`"\[]?(\w+)[`"\]]?\)\s+REFERENCES\s+[`"\[]?(\w+)[`"\]]?\s*\([`"\[]?(\w+)[`"\]]?\)/gi;
		let match;

		while ((match = fkPattern.exec(schema)) !== null) {
			const fkColumn = match[1];
			const refTable = match[2];

			// Find the source table by looking at all CREATE TABLE statements before this FK
			const beforeMatch = schema.substring(0, match.index);
			const allTableMatches = [...beforeMatch.matchAll(/CREATE\s+TABLE\s+[`"\[]?(\w+)[`"\]]?\s*\(/gi)];
			const lastTableMatch = allTableMatches.length > 0 ? allTableMatches[allTableMatches.length - 1] : null;
			const sourceTable = lastTableMatch ? lastTableMatch[1] : 'unknown';

			relationships.push({
				sourceTable,
				targetTable: refTable,
				relationshipType: 'one_to_many',
				cardinality: 'N:1',
				foreignKeyColumns: [fkColumn],
				isExplicit: true,
			});
		}

		// Infer relationships from naming conventions
		for (const element of elements.filter(e => e.type === 'table')) {
			if (element.columns) {
				for (const col of element.columns) {
					if (col.role === 'foreign_key' && /_id$/.test(col.name.toLowerCase())) {
						const targetTable = col.name.replace(/_id$/i, '');
						const targetExists = elements.some(e =>
							e.type === 'table' &&
							(e.name.toLowerCase() === targetTable.toLowerCase() ||
								e.name.toLowerCase() === targetTable.toLowerCase() + 's'));

						if (targetExists && !relationships.some(r =>
							r.sourceTable === element.name && r.foreignKeyColumns.includes(col.name))) {
							relationships.push({
								sourceTable: element.name,
								targetTable: targetTable,
								relationshipType: 'one_to_many',
								cardinality: 'N:1',
								foreignKeyColumns: [col.name],
								isExplicit: false,
							});
						}
					}
				}
			}
		}

		return relationships;
	}

	/**
	 * Splits a table name into lowercase naming-convention tokens, e.g.
	 * "order_items" -> ["order", "items"], "OrderItems" -> ["order", "items"].
	 */
	private _tokenizeTableName(tableName: string): string[] {
		return tableName
			.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
			.toLowerCase()
			.split(/[_\s]+/)
			.filter(token => token.length > 0);
	}

	/**
	 * Naive English singularization used for naming-convention matching
	 * (e.g. "orders" -> "order", "categories" -> "category").
	 */
	private _singularize(word: string): string {
		if (/ies$/.test(word)) {
			return word.replace(/ies$/, 'y');
		}
		if (/(ss|us)$/.test(word)) {
			return word;
		}
		if (/s$/.test(word)) {
			return word.replace(/s$/, '');
		}
		return word;
	}

	private _identifyQualityIssues(schema: string, elements: SchemaElementAnalysis[]): SchemaQualityIssue[] {
		const issues: SchemaQualityIssue[] = [];

		for (const element of elements) {
			if (element.type !== 'table' || !element.columns) {
				continue;
			}

			// Check for missing primary key
			const hasPK = element.columns.some(c => c.role === 'primary_key');
			if (!hasPK) {
				issues.push({
					severity: 'error',
					element: element.name,
					type: 'missing_primary_key',
					description: `Table ${element.name} has no primary key`,
					recommendation: 'Add a primary key column (e.g., id)',
				});
			}

			// Check for missing timestamps
			const hasTimestamps = element.columns.some(c =>
				c.role === 'timestamp' && /created/i.test(c.name));
			if (!hasTimestamps) {
				issues.push({
					severity: 'info',
					element: element.name,
					type: 'missing_audit_columns',
					description: `Table ${element.name} lacks audit timestamp columns`,
					recommendation: 'Consider adding created_at and updated_at columns',
				});
			}

			// Check for potentially large text columns
			const hasText = element.columns.some(c =>
				/TEXT|CLOB|BLOB/i.test(c.dataType));
			if (hasText) {
				issues.push({
					severity: 'warning',
					element: element.name,
					type: 'large_object_column',
					description: `Table ${element.name} contains TEXT/BLOB columns`,
					recommendation: 'Consider moving large objects to separate table or external storage',
				});
			}

			// Check for naming conventions
			if (!/^[a-z][a-z0-9_]*$/i.test(element.name)) {
				issues.push({
					severity: 'info',
					element: element.name,
					type: 'naming_convention',
					description: `Table name ${element.name} uses non-standard characters`,
					recommendation: 'Use snake_case for table names',
				});
			}
		}

		return issues;
	}

	private async _analyzeNormalization(schema: string, elements: SchemaElementAnalysis[]): Promise<NormalizationAnalysis> {
		const violations: any[] = [];

		// Basic normalization analysis
		for (const element of elements.filter(e => e.type === 'table')) {
			if (!element.columns) continue;

			// Check for repeating groups (potential 1NF violation)
			const numberSuffixes = element.columns.filter(c => /\d+$/.test(c.name));
			if (numberSuffixes.length > 2) {
				violations.push({
					tableName: element.name,
					normalForm: '1NF',
					description: `Possible repeating group detected (columns ending in numbers)`,
					suggestedFix: 'Extract repeating columns into a separate table',
				});
			}

			// Check for redundant data patterns (potential 2NF/3NF violation)
			const descriptiveColumns = element.columns.filter(c =>
				c.role === 'attribute' && /_name$|_desc/i.test(c.name));
			const fkColumns = element.columns.filter(c => c.role === 'foreign_key');

			if (fkColumns.length > 0 && descriptiveColumns.length > fkColumns.length) {
				violations.push({
					tableName: element.name,
					normalForm: '3NF',
					description: `Possible transitive dependency: descriptive columns may depend on FK`,
					suggestedFix: 'Consider if descriptive data belongs in referenced table',
				});
			}
		}

		// Determine current normal form
		let currentForm: NormalizationAnalysis['currentForm'] = '3NF';
		if (violations.some(v => v.normalForm === '1NF')) {
			currentForm = '1NF';
		} else if (violations.some(v => v.normalForm === '2NF')) {
			currentForm = '2NF';
		}

		return {
			currentForm,
			violations,
			denormalizationOpportunities: [],
		};
	}

	private _extractEntities(schema: string): DomainModelInference['entities'] {
		const elements = this._parseSchemaElements(schema);

		return elements
			.filter(e => e.type === 'table')
			.map(e => ({
				name: this._toEntityName(e.name),
				backingTables: [e.name],
				isAggregateRoot: this._isLikelyAggregateRoot(e),
				properties: e.columns?.map(c => c.name) ?? [],
				behaviors: [],
			}));
	}

	private _toEntityName(tableName: string): string {
		return tableName
			.replace(/_/g, ' ')
			.replace(/\b\w/g, c => c.toUpperCase())
			.replace(/s$/, ''); // Remove trailing 's'
	}

	private _isLikelyAggregateRoot(element: SchemaElementAnalysis): boolean {
		const name = element.name.toLowerCase();

		// Common aggregate root patterns
		if (/users?|orders?|products?|customers?|accounts?/i.test(name)) {
			return true;
		}

		// Junction tables are not aggregate roots
		if (/_/.test(name) && element.columns?.filter(c => c.role === 'foreign_key').length === 2) {
			return false;
		}

		// Tables with few FKs are more likely to be roots
		const fkCount = element.columns?.filter(c => c.role === 'foreign_key').length ?? 0;
		return fkCount <= 1;
	}

	private _inferBoundedContexts(entities: DomainModelInference['entities']): string[] {
		const contexts = new Set<string>();

		for (const entity of entities) {
			const name = entity.name.toLowerCase();

			if (/user|account|auth|login|role|permission/.test(name)) {
				contexts.add('Identity');
			}
			if (/order|cart|checkout|payment/.test(name)) {
				contexts.add('Orders');
			}
			if (/product|catalog|category|inventory/.test(name)) {
				contexts.add('Catalog');
			}
			if (/customer|address|profile/.test(name)) {
				contexts.add('Customers');
			}
			if (/invoice|billing|subscription/.test(name)) {
				contexts.add('Billing');
			}
			if (/shipping|delivery|tracking/.test(name)) {
				contexts.add('Shipping');
			}
		}

		return Array.from(contexts);
	}

	private _extractBusinessRules(schema: string): string[] {
		const rules: string[] = [];

		// Check constraints
		const checkPattern = /CHECK\s*\(([^)]+)\)/gi;
		let match;
		while ((match = checkPattern.exec(schema)) !== null) {
			rules.push(`Constraint: ${match[1]}`);
		}

		// Unique constraints
		const uniquePattern = /UNIQUE\s*\(([^)]+)\)/gi;
		while ((match = uniquePattern.exec(schema)) !== null) {
			rules.push(`Uniqueness required: ${match[1]}`);
		}

		// NOT NULL constraints suggest required fields
		const notNullPattern = /(\w+)\s+\w+.*\bNOT\s+NULL\b/gi;
		while ((match = notNullPattern.exec(schema)) !== null) {
			rules.push(`Required field: ${match[1]}`);
		}

		return rules;
	}

	private async _storeSchemaAnalysis(schema: string, result: SchemaReasoningResult): Promise<void> {
		const node: Omit<HypergraphNode, 'id'> = {
			node_type: 'schema_analysis',
			content: JSON.stringify(result),
			links: [],
			metadata: {
				element_count: result.elements.length,
				relationship_count: result.relationships.length,
				issue_count: result.qualityIssues.length,
				analyzed_at: Date.now(),
				agent: this.id,
			},
			salience_score: 0.8,
		};
		await this.hypergraphStore.addNode(node);
	}
}
