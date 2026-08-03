/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FlareCogService } from 'sql/workbench/services/zonecog/browser/flareCogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { NullLogService } from 'vs/platform/log/common/log';
import { FlareCogPeer, CognitiveWorkload, DEFAULT_FLARECOG_CONFIG } from 'sql/workbench/services/zonecog/common/flareCog';

suite('FlareCog Service Tests', () => {
	let logService: NullLogService;
	let store: HypergraphStore;
	let membrane: CognitiveMembraneService;
	let service: FlareCogService;

	setup(() => {
		logService = new NullLogService();
		store = new HypergraphStore(logService);
		membrane = new CognitiveMembraneService(logService);
		service = new FlareCogService(logService, store, membrane);
	});

	teardown(() => {
		service.dispose();
	});

	test('should not be running until initialized and started', () => {
		const state = service.getState();
		assert.strictEqual(state.initialized, false);
		assert.strictEqual(state.running, false);
		assert.strictEqual(state.localNode, undefined);
	});

	test('should initialize with default config', () => {
		const config = service.initialize();
		assert.ok(config);
		assert.strictEqual(config.enableAutoDiscovery, DEFAULT_FLARECOG_CONFIG.enableAutoDiscovery);
		assert.strictEqual(config.transportSecure, DEFAULT_FLARECOG_CONFIG.transportSecure);
		const state = service.getState();
		assert.strictEqual(state.initialized, true);
		assert.ok(state.localNode);
		assert.ok(state.localNode!.id.length > 0);
	});

	test('should initialize with custom config', () => {
		const customConfig = {
			...DEFAULT_FLARECOG_CONFIG,
			localNodeName: 'TestNode',
			defaultPort: 9999,
			enableAutoDiscovery: false,
		};
		const config = service.initialize(customConfig);
		assert.strictEqual(config.localNodeName, 'TestNode');
		assert.strictEqual(config.defaultPort, 9999);
		assert.strictEqual(config.enableAutoDiscovery, false);
	});

	test('should start and stop correctly', async () => {
		service.initialize();
		await service.start();
		const state1 = service.getState();
		assert.strictEqual(state1.running, true);

		await service.stop();
		const state2 = service.getState();
		assert.strictEqual(state2.running, false);
	});

	test('should fail to start without initialization', async () => {
		try {
			await service.start();
			assert.fail('Should have thrown an error');
		} catch {
			// Expected
		}
	});

	test('should manage peers correctly', () => {
		service.initialize();
		const peer: FlareCogPeer = {
			id: 'peer1',
			name: 'Test Peer',
			address: 'localhost',
			port: 8765,
			capabilities: ['hypergraph', 'llm'],
			status: 'connected',
			lastSeen: Date.now(),
			latencyMs: 10,
		};

		service.registerPeer(peer);
		const peers = service.getPeers();
		assert.strictEqual(peers.length, 1);
		assert.strictEqual(peers[0].id, 'peer1');
		assert.strictEqual(peers[0].name, 'Test Peer');
	});

	test('should unregister peers', () => {
		service.initialize();
		const peer: FlareCogPeer = {
			id: 'peer1',
			name: 'Test Peer',
			address: 'localhost',
			port: 8765,
			capabilities: [],
			status: 'connected',
			lastSeen: Date.now(),
		};

		service.registerPeer(peer);
		assert.strictEqual(service.getPeers().length, 1);

		service.unregisterPeer('peer1');
		assert.strictEqual(service.getPeers().length, 0);
	});

	test('should filter connected peers', () => {
		service.initialize();

		const peer1: FlareCogPeer = {
			id: 'peer1',
			name: 'Connected Peer',
			address: 'localhost',
			port: 8765,
			capabilities: [],
			status: 'connected',
			lastSeen: Date.now(),
		};

		const peer2: FlareCogPeer = {
			id: 'peer2',
			name: 'Disconnected Peer',
			address: 'localhost',
			port: 8766,
			capabilities: [],
			status: 'disconnected',
			lastSeen: Date.now() - 10000,
		};

		service.registerPeer(peer1);
		service.registerPeer(peer2);

		const connected = service.getConnectedPeers();
		assert.strictEqual(connected.length, 1);
		assert.strictEqual(connected[0].id, 'peer1');
	});

	test('should authenticate peers', async () => {
		service.initialize();
		const token = await service.authenticate('peer1', 'test-secret');
		assert.ok(token);
		assert.ok(token.token.length > 0);
		assert.ok(token.expiresAt > Date.now());
		assert.strictEqual(token.peerId, 'peer1');
	});

	test('should create and distribute workloads', async () => {
		service.initialize();

		// Add some peers with capabilities
		const peer1: FlareCogPeer = {
			id: 'peer1',
			name: 'LLM Peer',
			address: 'localhost',
			port: 8765,
			capabilities: ['llm', 'hypergraph'],
			status: 'connected',
			lastSeen: Date.now(),
		};

		const peer2: FlareCogPeer = {
			id: 'peer2',
			name: 'Agent Peer',
			address: 'localhost',
			port: 8766,
			capabilities: ['agent', 'hypergraph'],
			status: 'connected',
			lastSeen: Date.now(),
		};

		service.registerPeer(peer1);
		service.registerPeer(peer2);

		const workload: CognitiveWorkload = {
			id: 'wl1',
			type: 'query',
			payload: { query: 'test' },
			priority: 1,
			requiredCapabilities: ['hypergraph'],
			createdAt: Date.now(),
			status: 'pending',
		};

		const result = await service.distributeWorkload(workload, 'capability-match');
		assert.ok(result);
		assert.strictEqual(result.workloadId, 'wl1');
		assert.ok(result.selectedPeers.length > 0);
	});

	test('should use different partitioning strategies', async () => {
		service.initialize();

		// Add peers
		for (let i = 0; i < 3; i++) {
			service.registerPeer({
				id: `peer${i}`,
				name: `Peer ${i}`,
				address: 'localhost',
				port: 8765 + i,
				capabilities: ['hypergraph'],
				status: 'connected',
				lastSeen: Date.now(),
			});
		}

		const workload: CognitiveWorkload = {
			id: 'wl1',
			type: 'query',
			payload: {},
			priority: 1,
			requiredCapabilities: [],
			createdAt: Date.now(),
			status: 'pending',
		};

		// Test round-robin
		const result1 = await service.distributeWorkload(workload, 'round-robin');
		assert.ok(result1);
		assert.ok(result1.selectedPeers.length > 0);

		// Test load-balanced
		const workload2 = { ...workload, id: 'wl2' };
		const result2 = await service.distributeWorkload(workload2, 'load-balanced');
		assert.ok(result2);

		// Test salience-based
		const workload3 = { ...workload, id: 'wl3' };
		const result3 = await service.distributeWorkload(workload3, 'salience-based');
		assert.ok(result3);
	});

	test('should fire events on peer status changes', async () => {
		service.initialize();
		let firedEvent: FlareCogPeer | undefined;

		service.onDidChangePeerStatus(event => {
			firedEvent = event;
		});

		const peer: FlareCogPeer = {
			id: 'peer1',
			name: 'Test Peer',
			address: 'localhost',
			port: 8765,
			capabilities: [],
			status: 'connected',
			lastSeen: Date.now(),
		};

		service.registerPeer(peer);

		// Update peer status
		service.updatePeerStatus('peer1', 'disconnected');

		assert.ok(firedEvent);
		assert.strictEqual(firedEvent!.id, 'peer1');
		assert.strictEqual(firedEvent!.status, 'disconnected');
	});

	test('should get statistics', () => {
		service.initialize();

		const peer: FlareCogPeer = {
			id: 'peer1',
			name: 'Test Peer',
			address: 'localhost',
			port: 8765,
			capabilities: ['hypergraph'],
			status: 'connected',
			lastSeen: Date.now(),
		};

		service.registerPeer(peer);

		const stats = service.getStatistics();
		assert.strictEqual(stats.totalPeers, 1);
		assert.strictEqual(stats.connectedPeers, 1);
		assert.strictEqual(stats.availableCapabilities.includes('hypergraph'), true);
	});

	test('should track workload distribution stats', async () => {
		service.initialize();

		const peer: FlareCogPeer = {
			id: 'peer1',
			name: 'Test Peer',
			address: 'localhost',
			port: 8765,
			capabilities: [],
			status: 'connected',
			lastSeen: Date.now(),
		};

		service.registerPeer(peer);

		const workload: CognitiveWorkload = {
			id: 'wl1',
			type: 'query',
			payload: {},
			priority: 1,
			requiredCapabilities: [],
			createdAt: Date.now(),
			status: 'pending',
		};

		await service.distributeWorkload(workload, 'round-robin');

		const stats = service.getStatistics();
		assert.strictEqual(stats.workloadsDistributed, 1);
	});

	test('should handle graceful shutdown', async () => {
		service.initialize();

		const peer: FlareCogPeer = {
			id: 'peer1',
			name: 'Test Peer',
			address: 'localhost',
			port: 8765,
			capabilities: [],
			status: 'connected',
			lastSeen: Date.now(),
		};

		service.registerPeer(peer);
		await service.start();
		assert.strictEqual(service.getState().running, true);

		await service.shutdown();
		assert.strictEqual(service.getState().running, false);
		assert.strictEqual(service.getPeers().length, 0);
	});

	test('should reject workload distribution when not initialized', async () => {
		const workload: CognitiveWorkload = {
			id: 'wl1',
			type: 'query',
			payload: {},
			priority: 1,
			requiredCapabilities: [],
			createdAt: Date.now(),
			status: 'pending',
		};

		const result = await service.distributeWorkload(workload, 'round-robin');
		assert.strictEqual(result, undefined);
	});
});
