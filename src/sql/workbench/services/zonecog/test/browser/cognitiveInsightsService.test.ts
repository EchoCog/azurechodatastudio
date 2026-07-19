/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICognitiveInsightsService, CognitiveInsight } from 'sql/workbench/services/zonecog/common/cognitiveInsights';
import { CognitiveInsightsService } from 'sql/workbench/services/zonecog/browser/cognitiveInsightsService';
import { ISchemaPerceptionService } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { SchemaPerceptionService } from 'sql/workbench/services/zonecog/browser/schemaPerceptionService';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('Cognitive Insights Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let insightsService: ICognitiveInsightsService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		const schemaPerceptionService = instantiationService.createInstance(SchemaPerceptionService);
		instantiationService.stub(ISchemaPerceptionService, schemaPerceptionService);

		insightsService = instantiationService.createInstance(CognitiveInsightsService);
	});

	test('should start with no insights', () => {
		assert.deepStrictEqual(insightsService.getRecentInsights(), []);
		assert.strictEqual(insightsService.getInsightCount(), 0);
	});

	test('should flag SELECT * queries', () => {
		const insights = insightsService.analyzeQuery('SELECT * FROM dbo.Users');
		assert.strictEqual(insights.length, 1);
		assert.strictEqual(insights[0].severity, 'suggestion');
		assert.ok(insights[0].message.includes('SELECT *'));
		assert.strictEqual(insights[0].subject, 'dbo.Users');
	});

	test('should warn on UPDATE/DELETE without WHERE', () => {
		const insights = insightsService.analyzeQuery('DELETE FROM Orders');
		assert.strictEqual(insights.length, 1);
		assert.strictEqual(insights[0].severity, 'warning');
		assert.ok(insights[0].message.includes('WHERE'));
	});

	test('should not warn on filtered writes', () => {
		const insights = insightsService.analyzeQuery('DELETE FROM Orders WHERE id = 5');
		assert.deepStrictEqual(insights, []);
	});

	test('should flag leading-wildcard LIKE predicates', () => {
		const insights = insightsService.analyzeQuery("SELECT name FROM Users WHERE name LIKE '%smith'");
		assert.strictEqual(insights.length, 1);
		assert.ok(insights[0].message.includes('index'));
	});

	test('should flag slow queries', () => {
		const insights = insightsService.analyzeQuery('SELECT id FROM Orders WHERE id = 1', 6000);
		assert.strictEqual(insights.length, 1);
		assert.strictEqual(insights[0].severity, 'warning');
		assert.ok(insights[0].message.includes('6000ms'));
	});

	test('should raise a frequent-table insight at the threshold', () => {
		for (let i = 0; i < 4; i++) {
			assert.deepStrictEqual(insightsService.analyzeQuery(`SELECT id FROM Hot WHERE id = ${i}`), []);
		}
		const fifth = insightsService.analyzeQuery('SELECT id FROM Hot WHERE id = 99');
		assert.strictEqual(fifth.length, 1);
		assert.strictEqual(fifth[0].severity, 'info');
		assert.strictEqual(fifth[0].subject, 'Hot');
	});

	test('should not raise the same insight twice', () => {
		insightsService.analyzeQuery('SELECT * FROM dbo.Users');
		const second = insightsService.analyzeQuery('SELECT * FROM dbo.Users');
		assert.deepStrictEqual(second, []);
		assert.strictEqual(insightsService.getInsightCount(), 1);
	});

	test('should persist insights as Insight hypergraph nodes', () => {
		const [insight] = insightsService.analyzeQuery('SELECT * FROM dbo.Users');
		const node = hypergraphStore.getNode(insight.id);
		assert.ok(node);
		assert.strictEqual(node!.node_type, 'Insight');
		assert.strictEqual(node!.metadata['severity'], 'suggestion');
	});

	test('should fire onDidGenerateInsight per insight', () => {
		const fired: CognitiveInsight[] = [];
		insightsService.onDidGenerateInsight(i => fired.push(i));
		insightsService.analyzeQuery('DELETE FROM Orders');
		assert.strictEqual(fired.length, 1);
	});

	test('recent insights should be most recent first and honor limit', () => {
		insightsService.analyzeQuery('SELECT * FROM A');
		insightsService.analyzeQuery('DELETE FROM B');
		const recent = insightsService.getRecentInsights();
		assert.strictEqual(recent.length, 2);
		assert.strictEqual(recent[0].severity, 'warning');
		assert.strictEqual(insightsService.getRecentInsights(1).length, 1);
	});

	test('clear should remove insights and their hypergraph nodes', () => {
		const [insight] = insightsService.analyzeQuery('SELECT * FROM dbo.Users');
		insightsService.clear();
		assert.deepStrictEqual(insightsService.getRecentInsights(), []);
		assert.strictEqual(hypergraphStore.getNode(insight.id), undefined);
	});
});
