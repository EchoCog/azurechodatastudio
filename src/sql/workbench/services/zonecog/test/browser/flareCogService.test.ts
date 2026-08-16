/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FlareCogService } from 'sql/workbench/services/zonecog/browser/flareCogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { InProcessMeshHub } from 'sql/workbench/services/zonecog/browser/cognitiveMeshTransport';
import { NullLogService } from 'vs/platform/log/common/log';
import {
	FlareCogPeer,
	DEFAULT_FLARECOG_CONFIG,
	WorkloadPartitionStrategy,
} from 'sql/workbench/services/zonecog/common/flareCog';

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

	test('should not be running until started', () => {
		assert.strictEqual(service.isRunning(), false);
		const localPeer = service.getLocalPeer();
		assert.ok(localPeer);
		assert.ok(localPeer.id.length > 0);
		assert.strictEqual(localPeer.online, true);
	});

	test('should initialize with default config', async () => {
		await service.initialize({});
		const config = service.getConfig();
		assert.strictEqual(config.nodeName, DEFAULT_FLARECOG_CONFIG.nodeName);
		assert.strictEqual(config.listenAddress, DEFAULT_FLARECOG_CONFIG.listenAddress);
		assert.strictEqual(config.enableMdns, DEFAULT_FLARECOG_CONFIG.enableMdns);
		assert.strictEqual(config.defaultPartitionStrategy, DEFAULT_FLARECOG_CONFIG.defaultPartitionStrategy);
	});

	test('should initialize with custom config', async () => {
		await service.initialize({
			nodeName: 'TestNode',
			listenAddress: '127.0.0.1:9999',
			enableMdns: false,
		});
		const config = service.getConfig();
		assert.strictEqual(config.nodeName, 'TestNode');
		assert.strictEqual(config.listenAddress, '127.0.0.1:9999');
		assert.strictEqual(config.enableMdns, false);
		assert.strictEqual(service.getLocalPeer().name, 'TestNode');
	});

	test('should start and stop correctly', async () => {
		await service.initialize({});
		await service.start();
		assert.strictEqual(service.isRunning(), true);

		await service.stop();
		assert.strictEqual(service.isRunning(), false);
	});

	test('should start with default config when initialize is skipped', async () => {
		await service.start();
		assert.strictEqual(service.isRunning(), true);
		assert.strictEqual(service.getConfig().nodeName, DEFAULT_FLARECOG_CONFIG.nodeName);
	});

	test('should manage peers correctly', async () => {
		await service.initialize({});
		const peer = await service.addPeer('localhost:8765');
		assert.ok(peer);
		assert.strictEqual(peer!.address, 'localhost:8765');
		assert.strictEqual(peer!.discoveryMethod, 'manual');
		assert.strictEqual(peer!.online, false);

		const peers = service.getAllPeers();
		// local peer + added peer
		assert.strictEqual(peers.length, 2);
		assert.ok(peers.some(p => p.id === peer!.id));
		assert.ok(service.getPeer(peer!.id));
	});

	test('should remove peers', async () => {
		await service.initialize({});
		const peer = await service.addPeer('localhost:8765');
		assert.ok(peer);
		assert.strictEqual(service.getAllPeers().length, 2);

		const removed = service.removePeer(peer!.id);
		assert.strictEqual(removed, true);
		assert.strictEqual(service.getAllPeers().length, 1);
		assert.strictEqual(service.getPeer(peer!.id), undefined);
	});

	test('should not remove the local peer', async () => {
		await service.initialize({});
		const local = service.getLocalPeer();
		assert.strictEqual(service.removePeer(local.id), false);
		assert.ok(service.getPeer(local.id));
	});

	test('should filter online peers', async () => {
		await service.initialize({});
		const offlinePeer = await service.addPeer('localhost:8765');
		assert.ok(offlinePeer);
		assert.strictEqual(offlinePeer!.online, false);

		const online = service.getOnlinePeers();
		assert.ok(online.every(p => p.online));
		assert.ok(online.some(p => p.id === service.getLocalPeer().id));
		assert.ok(!online.some(p => p.id === offlinePeer!.id));
	});

	test('should generate and validate authentication tokens', async () => {
		await service.initialize({});
		const token = service.generateToken('peer1', ['query:read', 'agent:spawn']);
		assert.ok(token);
		assert.ok(token.token.length > 0);
		assert.ok(token.expiresAt > Date.now());
		assert.strictEqual(token.peerId, 'peer1');
		assert.deepStrictEqual(token.scopes, ['query:read', 'agent:spawn']);

		const validated = service.validateToken(token.token);
		assert.ok(validated);
		assert.strictEqual(validated!.peerId, 'peer1');

		assert.strictEqual(service.revokeToken(token.token), true);
		assert.strictEqual(service.validateToken(token.token), undefined);
	});

	test('should submit workloads for distribution', async () => {
		await service.initialize({});
		await service.start();

		const assignment = await service.submitWorkload({
			type: 'query',
			payload: { query: 'test' },
			priority: 0.8,
			requiredCapabilities: [],
			estimatedCost: 0.2,
		});

		assert.ok(assignment);
		assert.ok(assignment.workload.id.length > 0);
		assert.strictEqual(assignment.workload.type, 'query');
		assert.strictEqual(assignment.assignedPeerId, service.getLocalPeer().id);
		assert.ok(assignment.reason.length > 0);
	});

	test('should use different partitioning strategies', async () => {
		await service.initialize({});
		await service.start();

		const strategies: WorkloadPartitionStrategy[] = [
			{ name: 'RR', type: 'round-robin', config: {} },
			{ name: 'LB', type: 'load-balanced', config: {} },
			{ name: 'SB', type: 'salience-based', config: {} },
			{ name: 'CM', type: 'capability-match', config: {} },
			{ name: 'LOC', type: 'locality', config: {} },
		];

		for (const strategy of strategies) {
			service.setPartitionStrategy(strategy);
			assert.strictEqual(service.getPartitionStrategy().type, strategy.type);

			const assignment = await service.submitWorkload({
				type: 'query',
				payload: {},
				priority: 0.5,
				requiredCapabilities: [],
				estimatedCost: 0.1,
			});
			assert.ok(assignment.workload.id.length > 0);
			assert.strictEqual(assignment.assignedPeerId, service.getLocalPeer().id);
		}
	});

	test('should fire events on peer changes', async () => {
		await service.initialize({});
		let firedEvent: FlareCogPeer | undefined;

		service.onDidChangePeer(event => {
			firedEvent = event;
		});

		const peer = await service.addPeer('localhost:8765');
		assert.ok(firedEvent);
		assert.strictEqual(firedEvent!.id, peer!.id);
		assert.strictEqual(firedEvent!.address, 'localhost:8765');
	});

	test('should fire events on workload assignment', async () => {
		await service.initialize({});
		let fired = false;
		service.onDidAssignWorkload(() => { fired = true; });

		await service.submitWorkload({
			type: 'thinking',
			payload: { prompt: 'hello' },
			priority: 0.6,
			requiredCapabilities: [],
			estimatedCost: 0.3,
		});

		assert.ok(fired);
	});

	test('should get cluster statistics', async () => {
		await service.initialize({});
		await service.addPeer('localhost:8765');

		const stats = service.getClusterStats();
		assert.strictEqual(stats.totalPeers, 2);
		assert.strictEqual(stats.onlinePeers, 1); // only local is online
		assert.ok(stats.totalCapacity >= 0);
		assert.strictEqual(stats.workloadsProcessed, 0);
	});

	test('should track workload completion stats', async () => {
		await service.initialize({});
		const assignment = await service.submitWorkload({
			type: 'query',
			payload: {},
			priority: 0.4,
			requiredCapabilities: [],
			estimatedCost: 0.1,
		});

		service.reportWorkloadComplete(assignment.workload.id, true, { ok: true });
		const stats = service.getClusterStats();
		assert.strictEqual(stats.workloadsProcessed, 1);
		assert.ok(stats.averageLatencyMs >= 0);
	});

	test('should handle graceful reset', async () => {
		await service.initialize({});
		const peer = await service.addPeer('localhost:8765');
		await service.start();
		assert.strictEqual(service.isRunning(), true);
		assert.strictEqual(service.getAllPeers().length, 2);

		service.reset();
		assert.strictEqual(service.isRunning(), false);
		assert.strictEqual(service.getAllPeers().length, 1);
		assert.strictEqual(service.getPeer(peer!.id), undefined);
		assert.ok(service.getLocalPeer().online);
	});

	test('should expose cluster state and health', async () => {
		await service.initialize({ nodeName: 'health-node' });
		await service.start();

		const state = service.getClusterState();
		assert.strictEqual(state.localPeerId, service.getLocalPeer().id);
		assert.strictEqual(state.localPeer.name, 'health-node');
		assert.ok(state.onlinePeerCount >= 1);
		assert.ok(state.healthy);
		assert.ok(service.isClusterHealthy());
	});

	test('should update configuration', async () => {
		await service.initialize({});
		service.updateConfig({ heartbeatIntervalMs: 2500, peerTimeoutMs: 8000 });
		const config = service.getConfig();
		assert.strictEqual(config.heartbeatIntervalMs, 2500);
		assert.strictEqual(config.peerTimeoutMs, 8000);
	});

	test('should select local peer for locality strategy', async () => {
		await service.initialize({});
		service.setPartitionStrategy({ name: 'Local', type: 'locality', config: {} });
		const selected = service.selectPeerForWorkload({
			type: 'action',
			payload: {},
			priority: 0.5,
			requiredCapabilities: [],
			estimatedCost: 0.1,
		});
		assert.ok(selected);
		assert.strictEqual(selected!.id, service.getLocalPeer().id);
	});

	// --- Mesh messaging -------------------------------------------------------

	test('should deliver sendMessage to local peer via onDidReceiveMessage', () => {
		const localId = service.getLocalPeer().id;
		let received: unknown;
		service.onDidReceiveMessage(msg => { received = msg; });
		assert.ok(service.sendMessage(localId, { ping: true }));
		assert.ok(received);
	});

	test('should fail sendMessage for unknown peers', () => {
		assert.strictEqual(service.sendMessage('no-such-peer', { x: 1 }), false);
	});

	test('should request/respond over in-process mesh between two nodes', async () => {
		const hub = new InProcessMeshHub();

		class MeshFlareCog extends FlareCogService {
			protected override _createPeerChannel(address: string) {
				return hub.connect(address);
			}
		}

		const a = new MeshFlareCog(logService, store, membrane);
		const bStore = new HypergraphStore(logService);
		const bMembrane = new CognitiveMembraneService(logService);
		const b = new MeshFlareCog(logService, bStore, bMembrane);

		await a.initialize({
			nodeName: 'A',
			enableMdns: false,
			security: {
				tlsRequired: false,
				verifyPeerCert: false,
				tokenAuthEnabled: false,
			},
		});
		await b.initialize({
			nodeName: 'B',
			enableMdns: false,
			security: {
				tlsRequired: false,
				verifyPeerCert: false,
				tokenAuthEnabled: false,
			},
		});

		// A opens a logical in-process channel; a second hub endpoint answers
		// as the remote peer (same pattern as AAR node-side responders).
		const peerOnA = await a.addPeer('flare-peer-b');
		assert.ok(peerOnA);
		assert.ok(peerOnA!.online, 'in-process channel should open immediately');

		const bId = b.getLocalPeer().id;
		const responder = hub.connect('flare-peer-b-responder');
		responder.onmessage = event => {
			const envelope = event.data as {
				type?: string;
				id?: string;
				fromPeerId?: string;
				payload?: { op?: string; args?: unknown };
			};
			if (envelope?.type !== 'request' || !envelope.id) {
				return;
			}
			responder.postMessage({
				type: 'response',
				id: `r-${envelope.id}`,
				fromPeerId: bId,
				toPeerId: envelope.fromPeerId,
				replyTo: envelope.id,
				timestamp: Date.now(),
				payload: { ok: true, result: { echoed: envelope.payload?.args } },
			});
		};

		const response = await a.request(peerOnA!.id, 'echo', { msg: 'tokamak' }, 1000);
		assert.strictEqual(response.ok, true);
		assert.deepStrictEqual(response.result, { echoed: { msg: 'tokamak' } });

		// sendMessage over the live peer channel should succeed
		assert.ok(a.sendMessage(peerOnA!.id, { hello: 'b' }));

		a.dispose();
		b.dispose();
		responder.close();
	});

	test('should broadcast payloads without throwing', async () => {
		await service.initialize({});
		await service.start();
		service.broadcast({ kind: 'flarecog-announce', ts: Date.now() });
		assert.ok(true);
	});
});
