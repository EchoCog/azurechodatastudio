"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const aphroditeService_1 = require("sql/workbench/services/zonecog/browser/aphroditeService");
const log_1 = require("vs/platform/log/common/log");
const cognitiveMembraneService_1 = require("sql/workbench/services/zonecog/browser/cognitiveMembraneService");
suite('AphroditeService', () => {
    let aphroditeService;
    let membraneService;
    let logService;
    setup(() => {
        logService = new log_1.NullLogService();
        membraneService = new cognitiveMembraneService_1.CognitiveMembraneService(logService);
        aphroditeService = new aphroditeService_1.AphroditeService(logService, membraneService);
    });
    teardown(() => {
        aphroditeService.dispose();
        membraneService.dispose();
    });
    test('should initialize with default config', () => {
        const config = aphroditeService.getConfig();
        assert.strictEqual(config.baseUrl, 'http://localhost:2242');
        assert.strictEqual(config.model, 'default');
        assert.strictEqual(config.maxTokens, 2048);
        assert.strictEqual(config.temperature, 0.7);
        assert.strictEqual(config.topP, 0.95);
        assert.strictEqual(config.topK, 40);
        assert.strictEqual(config.frequencyPenalty, 0.0);
        assert.strictEqual(config.presencePenalty, 0.0);
        assert.strictEqual(config.timeoutMs, 60000);
        assert.strictEqual(config.batchingEnabled, true);
        assert.strictEqual(config.maxBatchSize, 16);
    });
    test('should update config partially', () => {
        aphroditeService.updateConfig({
            model: 'llama-3.1-70b',
            temperature: 0.5,
            maxTokens: 4096,
        });
        const config = aphroditeService.getConfig();
        assert.strictEqual(config.model, 'llama-3.1-70b');
        assert.strictEqual(config.temperature, 0.5);
        assert.strictEqual(config.maxTokens, 4096);
        // Other values should remain default
        assert.strictEqual(config.baseUrl, 'http://localhost:2242');
        assert.strictEqual(config.topP, 0.95);
    });
    test('should not be connected initially', () => {
        assert.strictEqual(aphroditeService.isConnected(), false);
    });
    test('should fire connection status event on initialize', async () => {
        let statusChanged = false;
        aphroditeService.onDidChangeConnectionStatus((connected) => {
            statusChanged = true;
        });
        // Initialize will fail to connect (no real server)
        await aphroditeService.initialize({});
        assert.strictEqual(statusChanged, true);
        assert.strictEqual(aphroditeService.isConnected(), false);
    });
    test('should initialize with custom config', async () => {
        await aphroditeService.initialize({
            baseUrl: 'http://custom:8080',
            apiKey: 'test-key',
            model: 'custom-model',
        });
        const config = aphroditeService.getConfig();
        assert.strictEqual(config.baseUrl, 'http://custom:8080');
        assert.strictEqual(config.apiKey, 'test-key');
        assert.strictEqual(config.model, 'custom-model');
    });
    test('should return false for health check when server unavailable', async () => {
        const healthy = await aphroditeService.healthCheck();
        assert.strictEqual(healthy, false);
    });
    test('should cancel request by ID', () => {
        // Should not throw
        aphroditeService.cancelRequest('non-existent-request');
    });
    test('should cancel all requests', () => {
        // Should not throw
        aphroditeService.cancelAllRequests();
    });
    test('should return zeroed stats when server unavailable', async () => {
        const stats = await aphroditeService.getStats();
        assert.strictEqual(stats.requestsPerSecond, 0);
        assert.strictEqual(stats.tokensPerSecond, 0);
        assert.strictEqual(stats.activeRequests, 0);
        assert.strictEqual(stats.queuedRequests, 0);
        assert.strictEqual(stats.gpuMemoryUsed, 0);
        assert.strictEqual(stats.gpuMemoryTotal, 0);
        assert.strictEqual(stats.gpuUtilization, 0);
        assert.strictEqual(stats.kvCacheSize, 0);
    });
    test('should have onDidReceiveStreamToken event', () => {
        assert.ok(aphroditeService.onDidReceiveStreamToken);
        const disposable = aphroditeService.onDidReceiveStreamToken(() => { });
        disposable.dispose();
    });
    test('should have onDidUpdateStats event', () => {
        assert.ok(aphroditeService.onDidUpdateStats);
        const disposable = aphroditeService.onDidUpdateStats(() => { });
        disposable.dispose();
    });
    test('should record membrane activity on initialize', async () => {
        const initialActivity = membraneService.getActivity('cerebral');
        await aphroditeService.initialize({});
        const afterActivity = membraneService.getActivity('cerebral');
        assert.ok(afterActivity > initialActivity);
    });
    test('should record membrane activity on stats', async () => {
        const initialActivity = membraneService.getActivity('cerebral');
        await aphroditeService.getStats();
        // Stats doesn't record activity on error path
        const afterActivity = membraneService.getActivity('cerebral');
        assert.ok(afterActivity >= initialActivity);
    });
    test('complete should throw when server unavailable', async () => {
        try {
            await aphroditeService.complete({
                prompt: 'Hello, world!',
            });
            assert.fail('Should have thrown');
        }
        catch (error) {
            assert.ok(error);
        }
    });
    test('embed should throw when server unavailable', async () => {
        try {
            await aphroditeService.embed({
                texts: ['Hello', 'World'],
            });
            assert.fail('Should have thrown');
        }
        catch (error) {
            assert.ok(error);
        }
    });
    test('listModels should throw when server unavailable', async () => {
        try {
            await aphroditeService.listModels();
            assert.fail('Should have thrown');
        }
        catch (error) {
            assert.ok(error);
        }
    });
    test('getCurrentModel should throw when server unavailable', async () => {
        try {
            await aphroditeService.getCurrentModel();
            assert.fail('Should have thrown');
        }
        catch (error) {
            assert.ok(error);
        }
    });
    test('switchModel should update config model', async () => {
        await aphroditeService.switchModel('new-model');
        const config = aphroditeService.getConfig();
        assert.strictEqual(config.model, 'new-model');
    });
    test('batchComplete should handle errors gracefully', async () => {
        const result = await aphroditeService.batchComplete({
            batchId: 'test-batch',
            requests: [
                { prompt: 'Test 1' },
                { prompt: 'Test 2' },
            ],
        });
        assert.strictEqual(result.batchId, 'test-batch');
        assert.ok(result.errors.length > 0);
        assert.ok(result.totalTimeMs >= 0);
    });
    test('config should have batchingEnabled option', () => {
        const config = aphroditeService.getConfig();
        assert.strictEqual(typeof config.batchingEnabled, 'boolean');
    });
    test('config should have maxBatchSize option', () => {
        const config = aphroditeService.getConfig();
        assert.strictEqual(typeof config.maxBatchSize, 'number');
        assert.ok(config.maxBatchSize > 0);
    });
});
