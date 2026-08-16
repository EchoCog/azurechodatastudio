/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FederatedQueryService } from 'sql/workbench/services/zonecog/browser/federatedQueryService';
import { ISharedCognitionChannel } from 'sql/workbench/services/zonecog/browser/sharedCognitionService';
import { ICognitiveMeshChannel, InProcessMeshHub } from 'sql/workbench/services/zonecog/browser/cognitiveMeshTransport';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

/**
 * In-memory hub standing in for BroadcastChannel: messages posted by one
 * channel are delivered synchronously to every other channel on the hub.
 */
class FakeChannelHub {
	private readonly _channels: FakeChannel[] = [];

	connect(): FakeChannel {
		const channel = new FakeChannel(this);
		this._channels.push(channel);
		return channel;
	}

	broadcast(sender: FakeChannel, message: unknown): void {
		for (const channel of this._channels) {
			if (channel !== sender && !channel.closed && channel.onmessage) {
				channel.onmessage({ data: message });
			}
		}
	}
}

class FakeChannel implements ISharedCognitionChannel {
	closed = false;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	constructor(private readonly hub: FakeChannelHub) { }
	postMessage(message: unknown): void {
		this.hub.broadcast(this, message);
	}
	close(): void {
		this.closed = true;
	}
}

/** Service variant whose transport is the in-memory hub. */
class TestFederatedQueryService extends FederatedQueryService {
	constructor(
		private readonly hub: FakeChannelHub | undefined,
		private readonly remoteHub: InProcessMeshHub | undefined,
		logService: ILogService,
		hypergraphStore: IHypergraphStore,
		membraneService: ICognitiveMembraneService
	) {
		super(logService, hypergraphStore, membraneService);
	}
	protected override _createChannel(): ISharedCognitionChannel | undefined {
		return this.hub?.connect();
	}
	protected override _createRemoteChannel(wsUrl: string): ICognitiveMeshChannel | undefined {
		// Production WebSocket path is covered by cognitiveMeshTransport tests.
		// Unit tests use a shared in-process hub so two services can answer
		// each other's federated-query requests without a network server.
		return this.remoteHub?.connect(wsUrl);
	}
}

suite('Federated Query Service Tests', () => {

	function makeParticipant(
		hub: FakeChannelHub | undefined,
		remoteHub?: InProcessMeshHub
	): { service: TestFederatedQueryService; store: IHypergraphStore } {
		const logService = new NullLogService();
		const store = new HypergraphStore(logService);
		const membrane = new CognitiveMembraneService(logService);
		const service = new TestFederatedQueryService(hub, remoteHub, logService, store, membrane);
		return { service, store };
	}

	function node(id: string, content: string, salience = 0.5) {
		return { id, node_type: 'TestNode', content, links: [], metadata: {}, salience_score: salience };
	}

	test('should be inactive until started', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		assert.strictEqual(service.getState().active, false);
		assert.ok(service.startSession());
		assert.strictEqual(service.getState().active, true);
		service.stopSession();
		assert.strictEqual(service.getState().active, false);
	});

	test('startSession should report failure when the transport is unavailable', () => {
		const { service } = makeParticipant(undefined);
		assert.strictEqual(service.startSession(), false);
	});

	test('query without a session should return local results only', async () => {
		const { service, store } = makeParticipant(undefined);
		store.addNode(node('n1', 'local knowledge'));

		const results = await service.query({});

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].isSelf, true);
		assert.strictEqual(results[0].nodes.length, 1);
	});

	test('query with no known peers should return local results only even when active', async () => {
		const { service, store } = makeParticipant(new FakeChannelHub());
		service.startSession();
		store.addNode(node('n1', 'local knowledge'));

		const results = await service.query({});

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].isSelf, true);
	});

	test('query should collect matches from peers', async () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.store.addNode(node('a1', 'alpha secret'));
		b.store.addNode(node('b1', 'beta secret'));
		b.store.addNode(node('b2', 'unrelated'));

		const results = await a.service.query({ keyword: 'secret' }, 500);

		assert.strictEqual(results.length, 2);
		const self = results.find(r => r.isSelf);
		const peer = results.find(r => !r.isSelf);
		assert.ok(self);
		assert.ok(peer);
		assert.strictEqual(self!.nodes.length, 1);
		assert.strictEqual(self!.nodes[0].id, 'a1');
		assert.strictEqual(peer!.nodes.length, 1);
		assert.strictEqual(peer!.nodes[0].id, 'b1');
	});

	test('queryMerged should dedupe and sort by salience', async () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.store.addNode(node('shared', 'shared content', 0.3));
		b.store.addNode(node('shared', 'shared content', 0.9));
		b.store.addNode(node('other', 'shared content too', 0.5));

		const merged = await a.service.queryMerged({ keyword: 'shared' }, 500);

		assert.strictEqual(merged.length, 2);
		assert.strictEqual(merged[0].id, 'shared');
		assert.strictEqual(merged[0].salience_score, 0.9);
		assert.strictEqual(merged[1].id, 'other');
	});

	test('nodeType and minSalience filters should narrow matches', async () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		b.store.addNode({ id: 't1', node_type: 'Wanted', content: 'x', links: [], metadata: {}, salience_score: 0.8 });
		b.store.addNode({ id: 't2', node_type: 'Wanted', content: 'x', links: [], metadata: {}, salience_score: 0.1 });
		b.store.addNode({ id: 't3', node_type: 'Other', content: 'x', links: [], metadata: {}, salience_score: 0.9 });

		const results = await a.service.query({ nodeType: 'Wanted', minSalience: 0.5 }, 500);
		const peer = results.find(r => !r.isSelf);

		assert.strictEqual(peer!.nodes.length, 1);
		assert.strictEqual(peer!.nodes[0].id, 't1');
	});

	test('stopSession should resolve pending queries immediately', async () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		const pending = a.service.query({}, 5000);
		a.service.stopSession();

		const results = await pending;
		assert.ok(results.length >= 1);
	});

	test('state counters should track sent queries and answered requests', async () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		b.store.addNode(node('b1', 'x'));
		await a.service.query({}, 500);

		assert.strictEqual(a.service.getState().queriesSent, 1);
		assert.strictEqual(a.service.getState().responsesReceived, 1);
		assert.strictEqual(b.service.getState().requestsAnswered, 1);
	});

	// --- Distributed Federation Tests (Phase C.2: FlareCog) ---

	test('should have no remote peers initially', () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		const remotePeers = service.getRemotePeers();
		assert.strictEqual(remotePeers.length, 0);
	});

	test('should connect remote peer via websocket url', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		const connection = await service.connectRemotePeer('ws://remote-host:9876');

		assert.ok(connection);
		assert.strictEqual(connection!.wsUrl, 'ws://remote-host:9876');
		assert.strictEqual(connection!.state, 'connected');
		assert.ok(connection!.peerId.length > 0);

		const remotePeers = service.getRemotePeers();
		assert.strictEqual(remotePeers.length, 1);
		assert.strictEqual(remotePeers[0].peerId, connection!.peerId);
	});

	test('should reconnect return existing peer for same url', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		const first = await service.connectRemotePeer('ws://remote-host:9876');
		const second = await service.connectRemotePeer('ws://remote-host:9876');

		assert.ok(first);
		assert.ok(second);
		assert.strictEqual(first!.peerId, second!.peerId);
		assert.strictEqual(service.getRemotePeers().length, 1);
	});

	test('should disconnect remote peer connection', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		const connection = await service.connectRemotePeer('ws://remote-host:9876');
		assert.ok(connection);

		service.disconnectRemotePeer(connection!.peerId);
		assert.strictEqual(service.getRemotePeers().length, 0);
	});

	test('should create distributed query plan', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		const connection = await service.connectRemotePeer('ws://remote-host:9876');
		assert.ok(connection);

		const plan = service.planDistributedQuery({ keyword: 'test' });
		assert.ok(plan);
		assert.ok(plan.id.length > 0);
		assert.ok(plan.targetPeers.includes(connection!.peerId));
		assert.strictEqual(plan.includeLocal, true);
		assert.strictEqual(plan.aggregationStrategy, 'merge');
		assert.strictEqual(plan.conflictResolution, 'highest-salience');
	});

	test('should execute distributed query with local results', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service, store } = makeParticipant(new FakeChannelHub(), remoteHub);
		store.addNode(node('local-1', 'test content', 0.7));

		const remote = await service.connectRemotePeer('ws://remote-host:9876');
		assert.ok(remote);

		const plan = service.planDistributedQuery({ keyword: 'test' }, {
			includeLocal: true,
			// No remote target — only local merge path under test
			targetPeers: [],
			aggregationStrategy: 'merge',
			conflictResolution: 'highest-salience',
			peerTimeoutMs: 50,
		});
		const results = await service.executeDistributedQuery(plan);

		assert.ok(results);
		assert.ok(results.mergedNodes.length > 0);
		assert.ok(results.mergedNodes.some(n => n.id === 'local-1'));
		assert.ok(results.totalDurationMs >= 0);
		assert.ok(results.peerResults.some(r => r.isSelf));
	});

	test('should exchange distributed query results across mesh peers', async () => {
		const remoteHub = new InProcessMeshHub();
		const a = makeParticipant(new FakeChannelHub(), remoteHub);
		const b = makeParticipant(new FakeChannelHub(), remoteHub);
		a.store.addNode(node('a-only', 'alpha knowledge', 0.8));
		b.store.addNode(node('b-only', 'beta knowledge', 0.9));

		// Both attach channels on the shared hub so request/response routes.
		const aConn = await a.service.connectRemotePeer('ws://cluster-a:9000');
		const bConn = await b.service.connectRemotePeer('ws://cluster-b:9000');
		assert.ok(aConn);
		assert.ok(bConn);
		assert.strictEqual(aConn!.state, 'connected');
		assert.strictEqual(bConn!.state, 'connected');

		// A queries its remote mesh peer; B's channel on the same hub answers.
		const plan = a.service.planDistributedQuery({ keyword: 'knowledge' }, {
			includeLocal: true,
			targetPeers: [aConn!.peerId],
			peerTimeoutMs: 500,
		});
		const results = await a.service.executeDistributedQuery(plan);
		assert.ok(results);
		assert.ok(results.mergedNodes.some(n => n.id === 'a-only'), 'local A node present');
		assert.ok(results.mergedNodes.some(n => n.id === 'b-only'), 'remote B node present via mesh');
		assert.ok(results.peerResults.some(r => !r.isSelf && r.nodes.some(n => n.id === 'b-only')));
	});

	test('should propagate salience to remote peers', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		service.startSession();
		await service.connectRemotePeer('ws://remote-host:9876');

		service.propagateSalience('test-node', 0.15, 2);

		const stats = service.getDistributedStats();
		assert.strictEqual(stats.saliencePropagationsSent, 1);
		assert.strictEqual(stats.remotePeerCount, 1);
	});

	test('should honor aggregation and conflict options in plan', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service, store } = makeParticipant(new FakeChannelHub(), remoteHub);
		store.addNode(node('shared', 'content', 0.3));

		const plan = service.planDistributedQuery({ keyword: 'content' }, {
			includeLocal: true,
			aggregationStrategy: 'salience-rank',
			conflictResolution: 'highest-salience',
			targetPeers: [],
		});

		const results = await service.executeDistributedQuery(plan);
		assert.strictEqual(results.plan.aggregationStrategy, 'salience-rank');
		assert.strictEqual(results.plan.conflictResolution, 'highest-salience');
		assert.ok(results.mergedNodes.some(n => n.id === 'shared'));
	});

	test('should get distributed stats', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		await service.connectRemotePeer('ws://remote-host:9876');

		const stats = service.getDistributedStats();
		assert.strictEqual(stats.remotePeerCount, 1);
		assert.strictEqual(typeof stats.distributedQueriesSent, 'number');
		assert.strictEqual(typeof stats.distributedResponsesReceived, 'number');
		assert.strictEqual(typeof stats.averageDistributedLatencyMs, 'number');
		assert.strictEqual(typeof stats.saliencePropagationsSent, 'number');
		assert.strictEqual(typeof stats.saliencePropagationsReceived, 'number');
	});

	test('should fire onDidChangeRemotePeer event', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		let firedEvent: unknown;
		service.onDidChangeRemotePeer(event => { firedEvent = event; });

		await service.connectRemotePeer('ws://remote-host:9876');
		assert.ok(firedEvent);
	});

	test('should fire onDidCompleteDistributedQuery event', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service, store } = makeParticipant(new FakeChannelHub(), remoteHub);
		let firedEvent: unknown;
		service.onDidCompleteDistributedQuery(event => { firedEvent = event; });

		store.addNode(node('local-1', 'test content'));

		const plan = service.planDistributedQuery({ keyword: 'test' });
		await service.executeDistributedQuery(plan);

		assert.ok(firedEvent);
	});

	test('should filter connected remote peers only', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);

		const connected = await service.connectRemotePeer('ws://host1:9876');
		assert.ok(connected);

		// Second peer starts connected via connectRemotePeer
		const second = await service.connectRemotePeer('ws://host2:9877');
		assert.ok(second);

		// Disconnect one
		service.disconnectRemotePeer(second!.peerId);

		const remaining = service.getRemotePeers().filter(p => p.state === 'connected');
		assert.strictEqual(remaining.length, 1);
		assert.strictEqual(remaining[0].peerId, connected!.peerId);
	});

	test('should include distributedActive and remotePeers in session state', async () => {
		const remoteHub = new InProcessMeshHub();
		const { service } = makeParticipant(new FakeChannelHub(), remoteHub);
		service.startSession();
		const connection = await service.connectRemotePeer('ws://remote-host:9876');
		assert.ok(connection);

		const state = service.getState();
		assert.ok(state.remotePeers.includes(connection!.peerId));
	});
});
