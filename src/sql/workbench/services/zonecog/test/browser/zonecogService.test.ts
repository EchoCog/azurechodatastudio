/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IZoneCogService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('ZoneCog Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let zoneCogService: IZoneCogService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		zoneCogService = instantiationService.createInstance(ZoneCogService);
	});

	test('should initialize properly', async () => {
		await zoneCogService.initialize();
		const state = zoneCogService.getCognitiveState();
		assert.strictEqual(state.isInitialized, true);
		assert.strictEqual(state.thinkingModeEnabled, true);
	});

	test('should process simple queries', async () => {
		await zoneCogService.initialize();
		const response = await zoneCogService.processQuery('Hello');
		
		assert.ok(response.response);
		assert.ok(response.metadata);
		assert.strictEqual(response.metadata.queryComplexity, 'simple');
		assert.ok(response.confidence > 0);
	});

	test('should process complex queries with deeper thinking', async () => {
		await zoneCogService.initialize();
		const complexQuery = 'Can you analyze and compare the different approaches to data visualization and synthesize the optimal strategy for our database performance metrics?';
		const response = await zoneCogService.processQuery(complexQuery);
		
		assert.ok(response.response);
		assert.strictEqual(response.metadata.queryComplexity, 'complex');
		assert.strictEqual(response.metadata.thinkingDepth, 'deep');
		assert.ok(response.thinking.includes('thinking'));
	});

	test('should toggle thinking mode', async () => {
		await zoneCogService.initialize();
		
		zoneCogService.setThinkingMode(false);
		let state = zoneCogService.getCognitiveState();
		assert.strictEqual(state.thinkingModeEnabled, false);
		
		const response = await zoneCogService.processQuery('Test query');
		assert.strictEqual(response.thinking, '');
		
		zoneCogService.setThinkingMode(true);
		state = zoneCogService.getCognitiveState();
		assert.strictEqual(state.thinkingModeEnabled, true);
	});

	test('should assess query complexity correctly', async () => {
		await zoneCogService.initialize();
		
		// Simple query
		const simpleResponse = await zoneCogService.processQuery('Hi');
		assert.strictEqual(simpleResponse.metadata.queryComplexity, 'simple');
		
		// Moderate query
		const moderateResponse = await zoneCogService.processQuery('How can I connect to my database?');
		assert.strictEqual(moderateResponse.metadata.queryComplexity, 'moderate');
		
		// Complex query
		const complexResponse = await zoneCogService.processQuery('Please analyze the performance metrics and synthesize optimization strategies for our multi-tenant database architecture across different cloud providers.');
		assert.strictEqual(complexResponse.metadata.queryComplexity, 'complex');
	});
});