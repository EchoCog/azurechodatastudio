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
});
