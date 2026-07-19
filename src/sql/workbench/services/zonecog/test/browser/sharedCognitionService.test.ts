/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SharedCognitionService, ISharedCognitionChannel } from 'sql/workbench/services/zonecog/browser/sharedCognitionService';
import { SharedCognitionUpdate } from 'sql/workbench/services/zonecog/common/sharedCognition';
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
class TestSharedCognitionService extends SharedCognitionService {
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

suite('Shared Cognition Service Tests', () => {

	function makeParticipant(hub: FakeChannelHub | undefined): { service: TestSharedCognitionService; store: IHypergraphStore } {
		const logService = new NullLogService();
		const store = new HypergraphStore(logService);
		const membrane = new CognitiveMembraneService(logService);
		const service = new TestSharedCognitionService(hub, logService, store, membrane);
		return { service, store };
	}

	function node(id: string, content: string) {
		return { id, node_type: 'TestNode', content, links: [], metadata: {}, salience_score: 0.5 };
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
		assert.strictEqual(service.getState().active, false);
	});

	test('peers should discover each other via hello handshake', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);

		a.service.startSession();
		b.service.startSession();

		assert.strictEqual(a.service.getState().knownPeers.length, 1);
		assert.strictEqual(b.service.getState().knownPeers.length, 1);
		assert.strictEqual(a.service.getState().knownPeers[0], b.service.getState().peerId);
	});

	test('node upserts should propagate to peers', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.store.addNode(node('n1', 'shared knowledge'));

		const replicated = b.store.getNode('n1');
		assert.ok(replicated);
		assert.strictEqual(replicated!.content, 'shared knowledge');
		assert.strictEqual(b.service.getState().appliedUpdates, 1);
		assert.strictEqual(a.service.getState().sentUpdates, 1);
	});

	test('link upserts should propagate to peers', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.store.addNode(node('x', 'x'));
		a.store.addNode(node('y', 'y'));
		a.store.addLink({ id: 'l1', link_type: 'RelatesTo', outgoing: ['x', 'y'], metadata: {} });

		assert.ok(b.store.getLink('l1'));
	});

	test('applied peer updates must not echo back (no infinite loop)', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.store.addNode(node('n1', 'v1'));

		// If B re-broadcast the applied update, A would apply it again and
		// counts would keep growing; a single send/apply proves suppression.
		assert.strictEqual(a.service.getState().sentUpdates, 1);
		assert.strictEqual(a.service.getState().appliedUpdates, 0);
		assert.strictEqual(b.service.getState().sentUpdates, 0);
		assert.strictEqual(b.service.getState().appliedUpdates, 1);
	});

	test('should fire onDidApplyPeerUpdate for applied changes', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		const applied: SharedCognitionUpdate[] = [];
		b.service.onDidApplyPeerUpdate(u => applied.push(u));

		a.store.addNode(node('n1', 'v1'));

		assert.strictEqual(applied.length, 1);
		assert.strictEqual(applied[0].kind, 'node');
		assert.strictEqual(applied[0].id, 'n1');
		assert.strictEqual(applied[0].peerId, a.service.getState().peerId);
	});

	test('local changes after stopSession should not propagate', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.service.stopSession();
		a.store.addNode(node('n2', 'after stop'));

		assert.strictEqual(b.store.getNode('n2'), undefined);
	});

	test('three peers should all converge on the same node', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		const c = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();
		c.service.startSession();

		b.store.addNode(node('n1', 'from b'));

		assert.ok(a.store.getNode('n1'));
		assert.ok(c.store.getNode('n1'));
	});
});
