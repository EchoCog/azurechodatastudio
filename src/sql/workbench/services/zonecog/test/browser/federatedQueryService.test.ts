/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FederatedQueryService } from 'sql/workbench/services/zonecog/browser/federatedQueryService';
import { ISharedCognitionChannel } from 'sql/workbench/services/zonecog/browser/sharedCognitionService';
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
		logService: ILogService,
		hypergraphStore: IHypergraphStore,
		membraneService: ICognitiveMembraneService
	) {
		super(logService, hypergraphStore, membraneService);
	}
	protected override _createChannel(): ISharedCognitionChannel | undefined {
		return this.hub?.connect();
	}
}

suite('Federated Query Service Tests', () => {

	function makeParticipant(hub: FakeChannelHub | undefined): { service: TestFederatedQueryService; store: IHypergraphStore } {
		const logService = new NullLogService();
		const store = new HypergraphStore(logService);
		const membrane = new CognitiveMembraneService(logService);
		const service = new TestFederatedQueryService(hub, logService, store, membrane);
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
		const { service } = makeParticipant(new FakeChannelHub());
		const remotePeers = service.getRemotePeers();
		assert.strictEqual(remotePeers.length, 0);
	});

	test('should register remote peer connection', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connected',
		});

		const remotePeers = service.getRemotePeers();
		assert.strictEqual(remotePeers.length, 1);
		assert.strictEqual(remotePeers[0].peerId, 'remote-1');
		assert.strictEqual(remotePeers[0].state, 'connected');
	});

	test('should unregister remote peer connection', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connected',
		});
		service.unregisterRemotePeer('remote-1');

		const remotePeers = service.getRemotePeers();
		assert.strictEqual(remotePeers.length, 0);
	});

	test('should update remote peer state', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connecting',
		});

		service.updateRemotePeerState('remote-1', 'connected');

		const remotePeers = service.getRemotePeers();
		assert.strictEqual(remotePeers[0].state, 'connected');
	});

	test('should create distributed query plan', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connected',
		});

		const plan = service.planDistributedQuery({ keyword: 'test' });
		assert.ok(plan);
		assert.ok(plan.id.length > 0);
		assert.ok(plan.targetPeers.length > 0);
	});

	test('should execute distributed query', async () => {
		const { service, store } = makeParticipant(new FakeChannelHub());
		store.addNode(node('local-1', 'test content'));

		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connected',
		});

		const plan = service.planDistributedQuery({ keyword: 'test' });
		const results = await service.executeDistributedQuery(plan);

		assert.ok(results);
		assert.ok(results.mergedNodes.length > 0);
	});

	test('should propagate salience to remote peers', async () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.startSession();

		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connected',
		});

		const success = await service.propagateSalience({
			nodeId: 'test-node',
			salienceValue: 0.85,
			targetPeers: ['remote-1'],
		});

		assert.ok(success);
	});

	test('should aggregate results with merge strategy', async () => {
		const { service, store } = makeParticipant(new FakeChannelHub());
		store.addNode(node('n1', 'test', 0.6));

		const results = await service.aggregateResults(
			[{
				peerId: 'local',
				peerName: 'Local',
				isSelf: true,
				nodes: [node('n1', 'test', 0.6), node('n2', 'another', 0.4)],
			}],
			'merge'
		);

		assert.ok(results.length >= 2);
	});

	test('should aggregate results with highest-salience conflict resolution', async () => {
		const { service } = makeParticipant(new FakeChannelHub());

		const results = await service.aggregateResults(
			[
				{
					peerId: 'peer1',
					peerName: 'Peer 1',
					isSelf: true,
					nodes: [node('shared', 'content', 0.3)],
				},
				{
					peerId: 'peer2',
					peerName: 'Peer 2',
					isSelf: false,
					nodes: [node('shared', 'content', 0.9)],
				},
			],
			'merge',
			'highest-salience'
		);

		const sharedNode = results.find(n => n.id === 'shared');
		assert.ok(sharedNode);
		assert.strictEqual(sharedNode!.salience_score, 0.9);
	});

	test('should get distributed state statistics', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connected',
		});

		const state = service.getDistributedState();
		assert.strictEqual(state.remotePeerCount, 1);
		assert.strictEqual(state.connectedPeerCount, 1);
	});

	test('should fire onDidChangeRemotePeer event', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		let firedEvent: unknown;
		service.onDidChangeRemotePeer(event => { firedEvent = event; });

		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Remote Peer 1',
			address: 'remote-host',
			port: 9876,
			state: 'connected',
		});

		assert.ok(firedEvent);
	});

	test('should fire onDidCompletedDistributedQuery event', async () => {
		const { service, store } = makeParticipant(new FakeChannelHub());
		let firedEvent: unknown;
		service.onDidCompleteDistributedQuery(event => { firedEvent = event; });

		store.addNode(node('local-1', 'test content'));

		const plan = service.planDistributedQuery({ keyword: 'test' });
		await service.executeDistributedQuery(plan);

		assert.ok(firedEvent);
	});

	test('should filter connected remote peers only', () => {
		const { service } = makeParticipant(new FakeChannelHub());

		service.registerRemotePeer({
			peerId: 'remote-1',
			peerName: 'Connected Peer',
			address: 'host1',
			port: 9876,
			state: 'connected',
		});

		service.registerRemotePeer({
			peerId: 'remote-2',
			peerName: 'Disconnected Peer',
			address: 'host2',
			port: 9877,
			state: 'disconnected',
		});

		const connected = service.getConnectedRemotePeers();
		assert.strictEqual(connected.length, 1);
		assert.strictEqual(connected[0].peerId, 'remote-1');
	});
});
