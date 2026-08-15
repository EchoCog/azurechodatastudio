/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	InProcessMeshHub,
	InProcessMeshChannel,
	CognitiveMeshNode,
	MeshRequestCorrelator,
	createMeshChannel,
	setDefaultMeshHub,
	getDefaultMeshHub,
} from 'sql/workbench/services/zonecog/browser/cognitiveMeshTransport';
import {
	CognitiveMeshEnvelope,
	CognitiveMeshRequestPayload,
	CognitiveMeshResponsePayload,
	normalizeMeshAddress,
	isWebSocketUrl,
} from 'sql/workbench/services/zonecog/common/cognitiveMesh';

suite('Cognitive Mesh Transport Tests', () => {

	teardown(() => {
		setDefaultMeshHub(undefined);
	});

	test('normalizeMeshAddress upgrades host:port to ws://', () => {
		assert.strictEqual(normalizeMeshAddress('localhost:8765'), 'ws://localhost:8765');
		assert.strictEqual(normalizeMeshAddress('ws://already/ok'), 'ws://already/ok');
		assert.strictEqual(normalizeMeshAddress('wss://secure'), 'wss://secure');
		assert.ok(isWebSocketUrl(normalizeMeshAddress('10.0.0.1:9000')));
	});

	test('InProcessMeshHub delivers posts to other endpoints only', async () => {
		const hub = new InProcessMeshHub();
		const a = hub.connect('a');
		const b = hub.connect('b');
		const seen: unknown[] = [];
		b.onmessage = event => { seen.push(event.data); };

		a.postMessage({ hello: 'mesh' });
		// Delivery is synchronous on the in-process hub.
		assert.strictEqual(seen.length, 1);
		assert.deepStrictEqual(seen[0], { hello: 'mesh' });

		// Sender does not receive its own post.
		let aSeen = 0;
		a.onmessage = () => { aSeen++; };
		a.postMessage({ again: true });
		assert.strictEqual(aSeen, 0);
		assert.strictEqual(seen.length, 2);

		a.close();
		b.close();
		assert.strictEqual(hub.size, 0);
	});

	test('MeshRequestCorrelator request/response round-trip', async () => {
		const hub = new InProcessMeshHub();
		const clientCh = hub.connect('client');
		const serverCh = hub.connect('server');

		const server = new MeshRequestCorrelator('server', envelope => serverCh.postMessage(envelope));
		server.registerHandler('ping', async (envelope) => {
			const args = envelope.payload?.args as { n?: number } | undefined;
			return { ok: true, result: { pong: (args?.n ?? 0) + 1 } };
		});
		serverCh.onmessage = event => { void server.handleMessage(event.data); };

		const client = new MeshRequestCorrelator('client', envelope => clientCh.postMessage(envelope));
		clientCh.onmessage = event => { void client.handleMessage(event.data); };

		const response = await client.request('server', 'ping', { n: 41 }, 1000);
		assert.strictEqual(response.ok, true);
		assert.deepStrictEqual(response.result, { pong: 42 });

		client.dispose();
		server.dispose();
		clientCh.close();
		serverCh.close();
	});

	test('CognitiveMeshNode routes request to peer via shared hub', async () => {
		const hub = new InProcessMeshHub();
		const nodeA = new CognitiveMeshNode('peer-a', address => hub.connect(address));
		const nodeB = new CognitiveMeshNode('peer-b', address => hub.connect(address));

		// Pair them: each holds a channel to the other endpoint id.
		// A talks on endpoint "to-b", B listens on a sibling endpoint that
		// answers via a dedicated node-side channel.
		const aToB = hub.connect('link-ab-a');
		const bSide = hub.connect('link-ab-b');
		nodeA.attachPeerChannel('peer-b', 'link-ab-a', aToB, true);

		bSide.onmessage = event => {
			const envelope = event.data as CognitiveMeshEnvelope<CognitiveMeshRequestPayload>;
			if (envelope?.type !== 'request') {
				return;
			}
			const reply: CognitiveMeshEnvelope<CognitiveMeshResponsePayload> = {
				type: 'response',
				id: `r-${envelope.id}`,
				fromPeerId: 'peer-b',
				toPeerId: envelope.fromPeerId,
				replyTo: envelope.id,
				timestamp: Date.now(),
				payload: { ok: true, result: { echo: envelope.payload?.args } },
			};
			bSide.postMessage(reply);
		};

		// When A posts on aToB, bSide receives; reply returns to aToB → nodeA correlator.
		const response = await nodeA.request('peer-b', 'echo', { value: 'deep-tree' }, 1000);
		assert.strictEqual(response.ok, true);
		assert.deepStrictEqual(response.result, { echo: { value: 'deep-tree' } });

		nodeA.dispose();
		nodeB.dispose();
		bSide.close();
		hub.clear();
	});

	test('createMeshChannel uses in-process hub for logical ids', () => {
		const hub = new InProcessMeshHub();
		const channel = createMeshChannel('logical-node-1', { hub });
		assert.ok(channel);
		assert.ok(channel instanceof InProcessMeshChannel);
		assert.strictEqual((channel as InProcessMeshChannel).endpointId, 'logical-node-1');
		channel!.close();
	});

	test('getDefaultMeshHub is replaceable for test isolation', () => {
		const custom = new InProcessMeshHub();
		setDefaultMeshHub(custom);
		assert.strictEqual(getDefaultMeshHub(), custom);
		const ch = getDefaultMeshHub().connect('x');
		assert.strictEqual(custom.size, 1);
		ch.close();
		setDefaultMeshHub(undefined);
		assert.notStrictEqual(getDefaultMeshHub(), custom);
	});

	test('correlator times out missing responses', async () => {
		const hub = new InProcessMeshHub();
		const alone = hub.connect('alone');
		const correlator = new MeshRequestCorrelator('alone', envelope => alone.postMessage(envelope));
		alone.onmessage = event => { void correlator.handleMessage(event.data); };

		let rejected = false;
		try {
			await correlator.request('nobody', 'missing-op', undefined, 30);
		} catch (error) {
			rejected = true;
			assert.ok(error instanceof Error);
			assert.ok(/timed out/i.test(error.message));
		}
		assert.ok(rejected);
		correlator.dispose();
		alone.close();
	});
});
