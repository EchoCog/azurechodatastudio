/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DataPatternAgent } from 'sql/workbench/services/zonecog/browser/dataPatternAgent';
import { NullLogService } from 'vs/platform/log/common/log';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';

suite('DataPatternAgent', () => {
	let agent: DataPatternAgent;
	let logService: NullLogService;
	let membraneService: CognitiveMembraneService;
	let hypergraphStore: HypergraphStore;

	// Sample test data
	const numericData = [
		{ id: 1, value: 10, category: 'A' },
		{ id: 2, value: 20, category: 'A' },
		{ id: 3, value: 30, category: 'B' },
		{ id: 4, value: 40, category: 'B' },
		{ id: 5, value: 50, category: 'A' },
	];

	const dataWithNulls = [
		{ id: 1, name: 'Alice', age: 25 },
		{ id: 2, name: null, age: 30 },
		{ id: 3, name: 'Charlie', age: null },
		{ id: 4, name: 'Diana', age: 35 },
		{ id: 5, name: null, age: 28 },
	];

	const temporalData = [
		{ id: 1, created_at: '2024-01-15', value: 100 },
		{ id: 2, created_at: '2024-01-16', value: 150 },
		{ id: 3, created_at: '2024-01-17', value: 120 },
		{ id: 4, created_at: '2024-01-18', value: 180 },
		{ id: 5, created_at: '2024-01-19', value: 200 },
	];

	const correlatedData = [
		{ x: 1, y: 2 },
		{ x: 2, y: 4 },
		{ x: 3, y: 6 },
		{ x: 4, y: 8 },
		{ x: 5, y: 10 },
	];

	const dataWithOutliers = [
		{ id: 1, value: 10 },
		{ id: 2, value: 12 },
		{ id: 3, value: 11 },
		{ id: 4, value: 13 },
		{ id: 5, value: 100 }, // Outlier
	];

	const duplicateData = [
		{ id: 1, name: 'Alice' },
		{ id: 2, name: 'Bob' },
		{ id: 1, name: 'Alice' }, // Duplicate
		{ id: 3, name: 'Charlie' },
	];

	const inconsistentData = [
		{ id: 1, status: 'Active' },
		{ id: 2, status: 'active' },
		{ id: 3, status: 'ACTIVE' },
		{ id: 4, status: ' Active ' },
	];

	setup(() => {
		logService = new NullLogService();
		membraneService = new CognitiveMembraneService(logService);
		hypergraphStore = new HypergraphStore(logService);
		agent = new DataPatternAgent(logService, membraneService, hypergraphStore);
	});

	teardown(() => {
		agent.dispose();
		membraneService.dispose();
		hypergraphStore.dispose();
	});

	// --- Identity Tests ---

	test('should have correct identity', () => {
		assert.strictEqual(agent.id, 'data-pattern-agent');
		assert.strictEqual(agent.name, 'Data Pattern Analyzer');
		assert.ok(agent.description.includes('pattern'));
	});

	test('should have correct capabilities', () => {
		const caps = agent.getCapabilities();

		assert.strictEqual(caps.canPerceive, true);
		assert.strictEqual(caps.canReason, true);
		assert.strictEqual(caps.canAct, true);
		assert.ok(caps.supportedActions.includes('detect_patterns'));
		assert.ok(caps.supportedActions.includes('generate_summary'));
		assert.ok(caps.supportedActions.includes('identify_anomalies'));
		assert.ok(caps.supportedActions.includes('suggest_quality'));
		assert.ok(caps.maxConcurrentTasks >= 1);
	});

	test('should start in idle status', () => {
		assert.strictEqual(agent.getStatus(), 'idle');
		assert.strictEqual(agent.getCurrentLoad(), 0);
	});

	// --- Pattern Detection Tests ---

	test('should detect patterns in numeric data', async () => {
		const patterns = await agent.detectPatterns(numericData);

		assert.ok(Array.isArray(patterns));
	});

	test('should detect trend pattern in increasing data', async () => {
		const trendData = [
			{ value: 10 },
			{ value: 20 },
			{ value: 30 },
			{ value: 40 },
			{ value: 50 },
		];

		const patterns = await agent.detectPatterns(trendData);

		const trendPattern = patterns.find(p => p.type === 'trend');
		assert.ok(trendPattern);
		assert.ok(trendPattern.description.includes('upward'));
	});

	test('should detect correlation between columns', async () => {
		const patterns = await agent.detectPatterns(correlatedData);

		const correlationPattern = patterns.find(p => p.type === 'correlation');
		assert.ok(correlationPattern);
		assert.ok(correlationPattern.confidence > 0.9); // Strong correlation
	});

	test('should detect categorical dominance', async () => {
		const dominantData = [
			{ category: 'A' },
			{ category: 'A' },
			{ category: 'A' },
			{ category: 'A' },
			{ category: 'B' },
		];

		const patterns = await agent.detectPatterns(dominantData);

		const clusterPattern = patterns.find(p => p.type === 'cluster');
		assert.ok(clusterPattern);
		assert.ok(clusterPattern.description.includes('dominated'));
	});

	test('should return empty patterns for empty data', async () => {
		const patterns = await agent.detectPatterns([]);

		assert.strictEqual(patterns.length, 0);
	});

	// --- Summary Generation Tests ---

	test('should generate summary for numeric data', async () => {
		const summary = await agent.generateSummary(numericData);

		assert.strictEqual(summary.rowCount, 5);
		assert.ok(summary.columns.length > 0);
		assert.ok(summary.qualityScore >= 0 && summary.qualityScore <= 1);
	});

	test('should include statistics for numeric columns', async () => {
		const summary = await agent.generateSummary(numericData);

		const valueColumn = summary.columns.find(c => c.name === 'value');
		assert.ok(valueColumn);
		assert.ok(valueColumn.statistics);
		assert.strictEqual(valueColumn.statistics.min, 10);
		assert.strictEqual(valueColumn.statistics.max, 50);
	});

	test('should calculate null percentage', async () => {
		const summary = await agent.generateSummary(dataWithNulls);

		const nameColumn = summary.columns.find(c => c.name === 'name');
		assert.ok(nameColumn);
		assert.strictEqual(nameColumn.nullPercentage, 40);
	});

	test('should calculate distinct count', async () => {
		const summary = await agent.generateSummary(numericData);

		const categoryColumn = summary.columns.find(c => c.name === 'category');
		assert.ok(categoryColumn);
		assert.strictEqual(categoryColumn.distinctCount, 2);
	});

	test('should infer correct column types', async () => {
		const summary = await agent.generateSummary(numericData);

		const idColumn = summary.columns.find(c => c.name === 'id');
		const categoryColumn = summary.columns.find(c => c.name === 'category');

		assert.ok(idColumn);
		assert.ok(['integer', 'decimal'].includes(idColumn.type));
		assert.ok(categoryColumn);
		assert.strictEqual(categoryColumn.type, 'string');
	});

	test('should handle empty data for summary', async () => {
		const summary = await agent.generateSummary([]);

		assert.strictEqual(summary.rowCount, 0);
		assert.strictEqual(summary.columns.length, 0);
		assert.strictEqual(summary.qualityScore, 0);
	});

	// --- Anomaly Detection Tests ---

	test('should detect missing values', async () => {
		const anomalies = await agent.identifyAnomalies(dataWithNulls);

		const missingAnomaly = anomalies.find(a => a.type === 'missing');
		assert.ok(missingAnomaly);
	});

	test('should detect outliers', async () => {
		const anomalies = await agent.identifyAnomalies(dataWithOutliers);

		const outlierAnomaly = anomalies.find(a => a.type === 'outlier');
		assert.ok(outlierAnomaly);
		assert.ok(outlierAnomaly.affectedRows?.includes(4)); // Index of outlier
	});

	test('should detect duplicate rows', async () => {
		const anomalies = await agent.identifyAnomalies(duplicateData);

		const duplicateAnomaly = anomalies.find(a => a.type === 'duplicate');
		assert.ok(duplicateAnomaly);
	});

	test('should detect inconsistent values', async () => {
		const anomalies = await agent.identifyAnomalies(inconsistentData);

		const inconsistentAnomaly = anomalies.find(a => a.type === 'inconsistent');
		assert.ok(inconsistentAnomaly);
	});

	test('should return empty anomalies for empty data', async () => {
		const anomalies = await agent.identifyAnomalies([]);

		assert.strictEqual(anomalies.length, 0);
	});

	test('should assign correct severity to anomalies', async () => {
		const highNullData = Array(10).fill(null).map((_, i) => ({
			id: i,
			value: i < 7 ? null : 100,
		}));

		const anomalies = await agent.identifyAnomalies(highNullData);

		const missingAnomaly = anomalies.find(a => a.type === 'missing');
		assert.ok(missingAnomaly);
		assert.strictEqual(missingAnomaly.severity, 'high');
	});

	// --- Data Quality Suggestions Tests ---

	test('should suggest improvements for high null columns', async () => {
		const suggestions = await agent.suggestDataQualityImprovements(dataWithNulls);

		assert.ok(suggestions.some(s => s.includes('null')));
	});

	test('should suggest improvements for constant columns', async () => {
		const constantData = Array(20).fill(null).map((_, i) => ({
			id: i,
			status: 'active', // All same value
		}));

		const suggestions = await agent.suggestDataQualityImprovements(constantData);

		assert.ok(suggestions.some(s => s.includes('constant')));
	});

	test('should suggest improvements for outliers', async () => {
		const suggestions = await agent.suggestDataQualityImprovements(dataWithOutliers);

		assert.ok(suggestions.some(s => s.toLowerCase().includes('outlier')));
	});

	test('should suggest improvements for inconsistent data', async () => {
		const suggestions = await agent.suggestDataQualityImprovements(inconsistentData);

		assert.ok(suggestions.some(s => s.toLowerCase().includes('standardize')));
	});

	test('should suggest improvements for duplicates', async () => {
		const suggestions = await agent.suggestDataQualityImprovements(duplicateData);

		assert.ok(suggestions.some(s => s.toLowerCase().includes('duplicate')));
	});

	// --- Perceive Tests ---

	test('should perceive data arrays', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.perceive(numericData);

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('should create perception node with quality score', async () => {
		await agent.perceive(dataWithNulls);

		const nodes = hypergraphStore.findNodesByType('data_perception');
		assert.ok(nodes.length > 0);
	});

	test('should assign higher salience to low quality data', async () => {
		// High null data should have low quality and high salience
		const highNullData = Array(10).fill(null).map((_, i) => ({
			id: i,
			value: i < 8 ? null : 100,
		}));

		await agent.perceive(highNullData);

		const nodes = hypergraphStore.findNodesByType('data_perception');
		const recentNode = nodes[nodes.length - 1];
		assert.ok(recentNode.salience_score > 0.5);
	});

	// --- Decide Tests ---

	test('should decide to detect patterns when data provided', async () => {
		const action = await agent.decide({
			data: numericData,
		});

		assert.ok(action);
		assert.strictEqual(action.action, 'detect_patterns');
		assert.ok(action.confidence > 0);
	});

	test('should return null for empty context', async () => {
		const action = await agent.decide({});

		assert.strictEqual(action, null);
	});

	test('should return null when data is not an array', async () => {
		const action = await agent.decide({
			data: { notAnArray: true },
		});

		assert.strictEqual(action, null);
	});

	// --- Execute Tests ---

	test('should execute detect_patterns action', async () => {
		const result = await agent.execute({
			action: 'detect_patterns',
			target: JSON.stringify(numericData),
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(Array.isArray(result));
	});

	test('should execute generate_summary action', async () => {
		const result = await agent.execute({
			action: 'generate_summary',
			target: JSON.stringify(numericData),
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(result.rowCount !== undefined);
		assert.ok(result.columns !== undefined);
	});

	test('should execute identify_anomalies action', async () => {
		const result = await agent.execute({
			action: 'identify_anomalies',
			target: JSON.stringify(dataWithNulls),
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(Array.isArray(result));
	});

	test('should execute suggest_quality action', async () => {
		const result = await agent.execute({
			action: 'suggest_quality',
			target: JSON.stringify(dataWithNulls),
			parameters: {},
			confidence: 1.0,
		});

		assert.ok(result);
		assert.ok(Array.isArray(result));
	});

	test('should throw for unknown action', async () => {
		try {
			await agent.execute({
				action: 'unknown_action',
				target: '[]',
				parameters: {},
				confidence: 1.0,
			});
			assert.fail('Should have thrown');
		} catch (error) {
			assert.ok(error);
		}
	});

	// --- Event Tests ---

	test('should fire status change events', async () => {
		let statusChanges: string[] = [];
		agent.onDidChangeStatus(status => {
			statusChanges.push(status);
		});

		await agent.detectPatterns(numericData);

		assert.ok(statusChanges.includes('active'));
		assert.ok(statusChanges.includes('idle'));
	});

	// --- Membrane Activity Tests ---

	test('should record membrane activity on perceive', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		await agent.perceive(numericData);

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	test('should record membrane activity on detect patterns', async () => {
		const initialCerebral = membraneService.getActivity('cerebral');

		await agent.detectPatterns(numericData);

		const afterCerebral = membraneService.getActivity('cerebral');
		assert.ok(afterCerebral > initialCerebral);
	});

	// --- Hypergraph Storage Tests ---

	test('should store patterns in hypergraph', async () => {
		const initialCount = hypergraphStore.nodeCount();

		await agent.detectPatterns(correlatedData);

		const afterCount = hypergraphStore.nodeCount();
		assert.ok(afterCount > initialCount);
	});

	test('should store patterns with correct node type', async () => {
		await agent.detectPatterns(correlatedData);

		const nodes = hypergraphStore.findNodesByType('data_pattern');
		assert.ok(nodes.length > 0);
	});

	// --- Temporal Pattern Tests ---

	test('should detect temporal data', async () => {
		const patterns = await agent.detectPatterns(temporalData);

		// Should recognize temporal column
		assert.ok(Array.isArray(patterns));
	});

	// --- Edge Cases ---

	test('should handle single row data', async () => {
		const singleRow = [{ id: 1, value: 100 }];

		const summary = await agent.generateSummary(singleRow);

		assert.strictEqual(summary.rowCount, 1);
	});

	test('should handle data with all nulls', async () => {
		const allNulls = [
			{ value: null },
			{ value: null },
			{ value: null },
		];

		const summary = await agent.generateSummary(allNulls);

		const valueColumn = summary.columns.find(c => c.name === 'value');
		assert.ok(valueColumn);
		assert.strictEqual(valueColumn.nullPercentage, 100);
	});

	test('should handle mixed type columns gracefully', async () => {
		const mixedData = [
			{ value: 10 },
			{ value: 'text' },
			{ value: 20 },
		];

		// Should not throw
		const summary = await agent.generateSummary(mixedData);
		assert.ok(summary);
	});
});
