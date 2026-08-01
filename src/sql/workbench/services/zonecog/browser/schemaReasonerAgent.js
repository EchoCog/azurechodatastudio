"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
	var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
	else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
	return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
	return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaReasonerAgent = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
const llmProvider_1 = require("sql/workbench/services/zonecog/common/llmProvider");
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const zonecogService_2 = require("sql/workbench/services/zonecog/common/zonecogService");
/**
 * Schema Reasoner Agent Implementation.
 * Provides database schema understanding and analysis.
 */
let SchemaReasonerAgent = class SchemaReasonerAgent extends lifecycle_1.Disposable {
	logService;
	llmService;
	membraneService;
	hypergraphStore;
	_serviceBrand;
	id = 'schema-reasoner-agent';
	name = 'Schema Reasoner';
	description = 'Database schema understanding and analysis';
	_status = 'idle';
	_currentLoad = 0;
	_onDidChangeStatus = this._register(new event_1.Emitter());
	onDidChangeStatus = this._onDidChangeStatus.event;
	constructor(logService, llmService, membraneService, hypergraphStore) {
		super();
		this.logService = logService;
		this.llmService = llmService;
		this.membraneService = membraneService;
		this.hypergraphStore = hypergraphStore;
		this.logService.info('[SchemaReasonerAgent] Initialized');
	}
	getCapabilities() {
		return {
			canPerceive: true,
			canReason: true,
			canAct: true,
			supportedActions: ['analyze_schema', 'discover_relationships', 'infer_domain', 'suggest_improvements', 'generate_docs', 'compare_schemas'],
			maxConcurrentTasks: 2,
		};
	}
	getStatus() {
		return this._status;
	}
	getCurrentLoad() {
		return this._currentLoad;
	}
	async perceive(input) {
		this.membraneService.recordActivity('cerebral');
		if (typeof input === 'string' && this._looksLikeSchema(input)) {
			const node = {
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
	async decide(context) {
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
	async execute(action) {
		this.membraneService.recordActivity('somatic');
		this._status = 'active';
		this._currentLoad += 0.5;
		this._onDidChangeStatus.fire(this._status);
		try {
			switch (action.action) {
				case 'analyze_schema':
					return await this.analyzeSchema(action.target);
				case 'discover_relationships':
					return await this.discoverRelationships(Array.isArray(action.parameters?.tables)
						? action.parameters.tables.filter((table) => typeof table === 'string')
						: []);
				case 'infer_domain':
					return await this.inferDomainModel(action.target);
				case 'suggest_improvements':
					return await this.suggestImprovements(action.target);
				case 'generate_docs':
					return await this.generateDocumentation(action.target);
				case 'compare_schemas':
					return await this.compareSchemas(action.target, typeof action.parameters?.schema2 === 'string' ? action.parameters.schema2 : '');
				default:
					throw new Error(`Unknown action: ${action.action}`);
			}
		}
		finally {
			this._currentLoad = Math.max(0, this._currentLoad - 0.5);
			this._status = this._currentLoad > 0 ? 'active' : 'idle';
			this._onDidChangeStatus.fire(this._status);
		}
	}
	async analyzeSchema(schemaDefinition) {
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
		const result = {
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
	async discoverRelationships(tables) {
		this.membraneService.recordActivity('cerebral');
		const relationships = [];
		// Look for naming conventions that suggest relationships
		for (let i = 0; i < tables.length; i++) {
			for (let j = i + 1; j < tables.length; j++) {
				const relationship = this._inferRelationship(tables[i], tables[j]);
				if (relationship) {
					relationships.push(relationship);
				}
			}
		}
		return relationships;
	}
	async inferDomainModel(schemaDefinition) {
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
	async suggestImprovements(schemaDefinition) {
		this.membraneService.recordActivity('cerebral');
		const elements = this._parseSchemaElements(schemaDefinition);
		return this._identifyQualityIssues(schemaDefinition, elements);
	}
	async generateDocumentation(schemaDefinition) {
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
	async compareSchemas(schema1, schema2) {
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
	_looksLikeSchema(text) {
		const schemaKeywords = /\b(CREATE\s+TABLE|CREATE\s+INDEX|ALTER\s+TABLE|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i;
		return schemaKeywords.test(text);
	}
	_parseSchemaElements(schema) {
		const elements = [];
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
	_parseColumns(columnsDef) {
		const columns = [];
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
	_inferColumnRole(name, dataType, definition) {
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
	_inferColumnMeaning(name, dataType) {
		const nameLower = name.toLowerCase();
		if (nameLower === 'id')
			return 'Primary identifier';
		if (/_id$/.test(nameLower))
			return `Reference to ${nameLower.replace(/_id$/, '')} table`;
		if (/email/.test(nameLower))
			return 'Email address';
		if (/name/.test(nameLower))
			return 'Name field';
		if (/created_at|created_on/.test(nameLower))
			return 'Record creation timestamp';
		if (/updated_at|modified_at/.test(nameLower))
			return 'Last modification timestamp';
		if (/password|hash/.test(nameLower))
			return 'Sensitive credential data';
		if (/phone|mobile/.test(nameLower))
			return 'Phone number';
		if (/address/.test(nameLower))
			return 'Address information';
		if (/price|amount|cost/.test(nameLower))
			return 'Monetary value';
		if (/description|desc/.test(nameLower))
			return 'Descriptive text';
		return `${name} field`;
	}
	_inferTablePurpose(tableName, columns) {
		if (/users?$/i.test(tableName))
			return 'Stores user account information';
		if (/products?$/i.test(tableName))
			return 'Product catalog';
		if (/orders?$/i.test(tableName))
			return 'Order records';
		if (/customers?$/i.test(tableName))
			return 'Customer information';
		if (/items?$/i.test(tableName))
			return 'Item records';
		if (/log|audit|history/i.test(tableName))
			return 'Audit/log records';
		if (/config|setting/i.test(tableName))
			return 'Configuration storage';
		if (/_\w+_$/i.test(tableName))
			return 'Junction table for many-to-many relationship';
		return `Stores ${tableName.replace(/_/g, ' ')} data`;
	}
	_inferEntityType(tableName) {
		const nameLower = tableName.toLowerCase().replace(/_/g, '');
		if (/user|account|profile/.test(nameLower))
			return 'User';
		if (/product|item|good/.test(nameLower))
			return 'Product';
		if (/order|purchase|transaction/.test(nameLower))
			return 'Transaction';
		if (/customer|client/.test(nameLower))
			return 'Customer';
		if (/employee|staff|worker/.test(nameLower))
			return 'Employee';
		if (/message|notification|alert/.test(nameLower))
			return 'Communication';
		if (/document|file|attachment/.test(nameLower))
			return 'Document';
		return 'Entity';
	}
	async _discoverRelationshipsFromSchema(schema, elements) {
		const relationships = [];
		// Parse explicit foreign keys
		const fkPattern = /FOREIGN\s+KEY\s*\([`"\[]?(\w+)[`"\]]?\)\s+REFERENCES\s+[`"\[]?(\w+)[`"\]]?\s*\([`"\[]?(\w+)[`"\]]?\)/gi;
		let match;
		while ((match = fkPattern.exec(schema)) !== null) {
			const fkColumn = match[1];
			const refTable = match[2];
			// Find the source table by looking backwards in the schema
			const beforeMatch = schema.substring(0, match.index);
			const tableMatch = beforeMatch.match(/CREATE\s+TABLE\s+[`"\[]?(\w+)[`"\]]?\s*\([^)]*$/i);
			const sourceTable = tableMatch ? tableMatch[1] : 'unknown';
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
						const targetExists = elements.some(e => e.type === 'table' &&
							(e.name.toLowerCase() === targetTable.toLowerCase() ||
								e.name.toLowerCase() === targetTable.toLowerCase() + 's'));
						if (targetExists && !relationships.some(r => r.sourceTable === element.name && r.foreignKeyColumns.includes(col.name))) {
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
	_inferRelationship(table1, table2) {
		const t1 = table1.toLowerCase();
		const t2 = table2.toLowerCase();
		// Check for junction table pattern
		if (t1.includes(t2) || t2.includes(t1)) {
			return null; // Likely same entity
		}
		return null;
	}
	_identifyQualityIssues(schema, elements) {
		const issues = [];
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
			const hasTimestamps = element.columns.some(c => c.role === 'timestamp' && /created/i.test(c.name));
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
			const hasText = element.columns.some(c => /TEXT|CLOB|BLOB/i.test(c.dataType));
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
	async _analyzeNormalization(schema, elements) {
		const violations = [];
		// Basic normalization analysis
		for (const element of elements.filter(e => e.type === 'table')) {
			if (!element.columns)
				continue;
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
			const descriptiveColumns = element.columns.filter(c => c.role === 'attribute' && /_name$|_desc/i.test(c.name));
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
		let currentForm = '3NF';
		if (violations.some(v => v.normalForm === '1NF')) {
			currentForm = '1NF';
		}
		else if (violations.some(v => v.normalForm === '2NF')) {
			currentForm = '2NF';
		}
		return {
			currentForm,
			violations,
			denormalizationOpportunities: [],
		};
	}
	_extractEntities(schema) {
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
	_toEntityName(tableName) {
		return tableName
			.replace(/_/g, ' ')
			.replace(/\b\w/g, c => c.toUpperCase())
			.replace(/s$/, ''); // Remove trailing 's'
	}
	_isLikelyAggregateRoot(element) {
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
	_inferBoundedContexts(entities) {
		const contexts = new Set();
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
	_extractBusinessRules(schema) {
		const rules = [];
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
	async _storeSchemaAnalysis(schema, result) {
		const node = {
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
};
exports.SchemaReasonerAgent = SchemaReasonerAgent;
exports.SchemaReasonerAgent = SchemaReasonerAgent = __decorate([
	__param(0, log_1.ILogService),
	__param(1, llmProvider_1.ILLMProviderService),
	__param(2, zonecogService_1.ICognitiveMembraneService),
	__param(3, zonecogService_2.IHypergraphStore)
], SchemaReasonerAgent);
