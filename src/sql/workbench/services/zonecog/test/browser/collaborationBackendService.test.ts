/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { NullLogService } from 'vs/platform/log/common/log';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { CollaborationBackendService } from 'sql/workbench/services/zonecog/browser/collaborationBackendService';
import {
	CollaborationParticipant,
	CollaborationTransportKind,
	ICollaborationChannel,
	roleHasPermission,
} from 'sql/workbench/services/zonecog/common/collaborationBackend';
import { replaceOperation } from 'sql/workbench/services/zonecog/common/collaborationOT';

/**
 * An in-memory stand-in for the relay: it delivers every message to the other
 * members of the same session, serialized exactly as a real socket would, so
 * peers never share object references.
 */
class TestRelayHub {
	private readonly _sessions = new Map<string, Set<TestRelayChannel>>();
	private readonly _held: Array<{ channel: TestRelayChannel; message: unknown }> = [];
	private _paused = false;

	/** Hold traffic so peers can act before hearing from each other. */
	pause(): void {
		this._paused = true;
	}

	/** Release held traffic in the order it was sent. */
	resume(): void {
		this._paused = false;
		while (this._held.length > 0) {
			const next = this._held.shift()!;
			next.channel.deliver(next.message);
		}
	}

	connect(sessionId: string): TestRelayChannel {
		let members = this._sessions.get(sessionId);
		if (!members) {
			members = new Set<TestRelayChannel>();
			this._sessions.set(sessionId, members);
		}
		const channel = new TestRelayChannel(this, sessionId);
		members.add(channel);
		return channel;
	}

	disconnect(sessionId: string, channel: TestRelayChannel): void {
		this._sessions.get(sessionId)?.delete(channel);
	}

	broadcast(sessionId: string, sender: TestRelayChannel, message: unknown): void {
		const members = this._sessions.get(sessionId);
		if (!members) {
			return;
		}
		const wire = JSON.stringify(message);
		for (const member of Array.from(members)) {
			if (member === sender) {
				continue;
			}
			if (this._paused) {
				this._held.push({ channel: member, message: JSON.parse(wire) });
			} else {
				member.deliver(JSON.parse(wire));
			}
		}
	}
}

class TestRelayChannel implements ICollaborationChannel {
	onmessage: ((event: { data: unknown }) => void) | null = null;

	constructor(private readonly _hub: TestRelayHub, private readonly _sessionId: string) { }

	postMessage(message: unknown): void {
		this._hub.broadcast(this._sessionId, this, message);
	}

	deliver(message: unknown): void {
		this.onmessage?.({ data: message });
	}

	close(): void {
		this._hub.disconnect(this._sessionId, this);
		this.onmessage = null;
	}
}

class TestCollaborationBackendService extends CollaborationBackendService {
	constructor(private readonly _hub: TestRelayHub, displayName: string) {
		const logService = new NullLogService();
		super(logService, new HypergraphStore(logService), new CognitiveMembraneService(logService));
		// A zero interval keeps the presence heartbeat from leaving timers
		// behind; every test drives presence explicitly instead.
		this.configure({ displayName, presenceIntervalMs: 0, joinTimeoutMs: 50 });
	}

	protected override _createTransport(sessionId: string): { channel: ICollaborationChannel; kind: CollaborationTransportKind } | undefined {
		return { channel: this._hub.connect(sessionId), kind: 'websocket' };
	}
}

suite('Collaboration Backend Service Tests', () => {
	let hub: TestRelayHub;
	let services: TestCollaborationBackendService[];

	function makeService(displayName: string): TestCollaborationBackendService {
		const service = new TestCollaborationBackendService(hub, displayName);
		services.push(service);
		return service;
	}

	setup(() => {
		hub = new TestRelayHub();
		services = [];
	});

	teardown(() => {
		for (const service of services) {
			service.dispose();
		}
		services = [];
	});

	test('should start disconnected', () => {
		const host = makeService('Host');
		const state = host.getState();
		assert.strictEqual(state.connected, false);
		assert.strictEqual(state.transport, 'none');
		assert.strictEqual(state.session, undefined);
		assert.strictEqual(state.isHost, false);
		assert.strictEqual(host.getParticipants().length, 0);
	});

	test('should create a session with a shareable code', async () => {
		const host = makeService('Host');
		const session = await host.createSession('Query Review');
		assert.ok(session);
		assert.match(session!.id, /^ZC-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
		assert.strictEqual(session!.title, 'Query Review');
		assert.strictEqual(session!.hostUserId, host.getLocalIdentity().userId);

		const state = host.getState();
		assert.strictEqual(state.connected, true);
		assert.strictEqual(state.isHost, true);
		assert.strictEqual(state.localRole, 'owner');
		assert.strictEqual(host.getParticipants().length, 1);
	});

	test('should reject a malformed session code', async () => {
		const guest = makeService('Guest');
		for (const code of ['   ', 'not-a-code', 'ZC-1234', 'ZC-GHIJ-KLMN-OPQR']) {
			assert.strictEqual(await guest.joinSession(code), undefined, `accepted ${code}`);
			assert.strictEqual(guest.getState().connected, false);
		}
	});

	test('should join an existing session and see both participants', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');

		const joined = await guest.joinSession(session!.id);
		assert.ok(joined);
		assert.strictEqual(joined!.title, 'Shared Workspace');
		assert.strictEqual(joined!.hostUserId, host.getLocalIdentity().userId);

		assert.strictEqual(guest.getParticipants().length, 2);
		assert.strictEqual(host.getParticipants().length, 2);
		assert.strictEqual(guest.getState().isHost, false);
		assert.strictEqual(guest.getState().localRole, 'editor');
		assert.ok(host.getParticipants().some(p => p.displayName === 'Guest'));
		assert.ok(guest.getParticipants().some(p => p.displayName === 'Host'));
	});

	test('should accept a session code typed without its separators', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');

		const typed = session!.id.replace(/-/g, '').toLowerCase();
		const joined = await guest.joinSession(typed);
		assert.strictEqual(joined?.id, session!.id);
	});

	test('should give up when nobody is hosting the requested session', async () => {
		const guest = makeService('Guest');
		assert.strictEqual(await guest.joinSession('ZC-AAAA-BBBB-CCCC'), undefined);
		assert.strictEqual(guest.getState().connected, false);
	});

	test('should clamp a newcomer that asks to join as owner', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');

		await guest.joinSession(session!.id, 'owner');
		const asSeenByHost = host.getParticipant(guest.getLocalIdentity().userId);
		assert.strictEqual(asSeenByHost?.role, 'editor');
		assert.strictEqual(guest.getState().localRole, 'editor');
	});

	test('should share cognitive focus between participants', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		assert.strictEqual(guest.updateFocus({ anchor: 0, head: 0, phaseName: 'Pattern Recognition', querySeq: 3 }), true);

		const asSeenByHost = host.getParticipant(guest.getLocalIdentity().userId);
		assert.strictEqual(asSeenByHost?.focus?.phaseName, 'Pattern Recognition');
		assert.strictEqual(asSeenByHost?.focus?.querySeq, 3);
		assert.ok(asSeenByHost!.focus!.updatedAt > 0);
	});

	test('should replicate documents to participants', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		const document = host.createDocument('analysis.sql', 'SELECT 1');
		assert.ok(document);
		const replica = guest.getDocument(document!.id);
		assert.strictEqual(replica?.content, 'SELECT 1');
		assert.strictEqual(replica?.title, 'analysis.sql');
	});

	test('should hand a joiner the documents created before they arrived', async () => {
		const host = makeService('Host');
		const session = await host.createSession('Shared Workspace');
		const document = host.createDocument('analysis.sql', 'SELECT 1');
		host.editDocument(document!.id, 7, 1, '42');

		const guest = makeService('Guest');
		await guest.joinSession(session!.id);

		const replica = guest.getDocument(document!.id);
		assert.strictEqual(replica?.content, 'SELECT 42');
		assert.strictEqual(replica?.revision, host.getDocument(document!.id)!.revision);
	});

	test('should propagate an edit from a guest back to the host', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);
		const document = host.createDocument('analysis.sql', 'SELECT 1');

		assert.strictEqual(guest.editDocument(document!.id, 8, 0, ' FROM t'), true);
		assert.strictEqual(guest.getDocument(document!.id)?.content, 'SELECT 1 FROM t');
		assert.strictEqual(host.getDocument(document!.id)?.content, 'SELECT 1 FROM t');
	});

	test('should converge when two participants edit at the same time', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);
		const document = host.createDocument('analysis.sql', 'SELECT a FROM t');

		// Both sides edit the same revision before either has heard from the
		// other; only operational transformation can reconcile this.
		hub.pause();
		assert.strictEqual(host.applyLocalOperation(document!.id, replaceOperation(15, 7, 1, 'count(*)')), true);
		assert.strictEqual(guest.applyLocalOperation(document!.id, replaceOperation(15, 15, 0, ' WHERE x > 1')), true);
		assert.notStrictEqual(host.getDocument(document!.id)!.content, guest.getDocument(document!.id)!.content);
		hub.resume();

		const converged = 'SELECT count(*) FROM t WHERE x > 1';
		assert.strictEqual(host.getDocument(document!.id)?.content, converged);
		assert.strictEqual(guest.getDocument(document!.id)?.content, converged);
		assert.strictEqual(host.getDocument(document!.id)?.revision, guest.getDocument(document!.id)?.revision);
	});

	test('should converge when three participants edit at the same time', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const observer = makeService('Third');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);
		await observer.joinSession(session!.id);
		const document = host.createDocument('notes', 'abcdef');

		hub.pause();
		host.applyLocalOperation(document!.id, replaceOperation(6, 0, 0, '1'));
		guest.applyLocalOperation(document!.id, replaceOperation(6, 3, 0, '2'));
		observer.applyLocalOperation(document!.id, replaceOperation(6, 6, 0, '3'));
		hub.resume();

		const content = host.getDocument(document!.id)!.content;
		assert.strictEqual(content, '1abc2def3');
		assert.strictEqual(guest.getDocument(document!.id)?.content, content);
		assert.strictEqual(observer.getDocument(document!.id)?.content, content);
	});

	test('should keep a stream of interleaved edits consistent', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);
		const document = host.createDocument('notes', '');

		for (let i = 0; i < 10; i++) {
			host.editDocument(document!.id, host.getDocument(document!.id)!.content.length, 0, 'H');
			guest.editDocument(document!.id, 0, 0, 'G');
		}

		const content = host.getDocument(document!.id)!.content;
		assert.strictEqual(content.length, 20);
		assert.strictEqual(guest.getDocument(document!.id)?.content, content);
	});

	test('should refuse an edit from a participant without write access', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id, 'observer');
		const document = host.createDocument('analysis.sql', 'SELECT 1');

		assert.strictEqual(guest.hasPermission('document:edit'), false);
		assert.strictEqual(guest.editDocument(document!.id, 0, 0, 'x'), false);
		assert.strictEqual(host.getDocument(document!.id)?.content, 'SELECT 1');
	});

	test('should ignore an edit that an observer posts straight onto the wire', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id, 'observer');
		const document = host.createDocument('analysis.sql', 'SELECT 1');

		// Bypass the local permission check the way a tampered client would.
		const channel = guest.createChannel('probe');
		assert.ok(channel);
		channel!.postMessage({
			type: 'operation',
			userId: guest.getLocalIdentity().userId,
			timestamp: Date.now(),
			documentId: document!.id,
			revision: 0,
			operation: replaceOperation(8, 0, 0, 'DROP '),
		});

		assert.strictEqual(host.getDocument(document!.id)?.content, 'SELECT 1');
	});

	test('should let the owner change a participant role', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id, 'observer');

		assert.strictEqual(host.setParticipantRole(guest.getLocalIdentity().userId, 'editor'), true);
		assert.strictEqual(guest.getState().localRole, 'editor');
		assert.strictEqual(guest.hasPermission('document:edit'), true);
	});

	test('should refuse a role change from a participant who cannot manage the session', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		assert.strictEqual(guest.setParticipantRole(host.getLocalIdentity().userId, 'observer'), false);
		assert.strictEqual(host.getState().localRole, 'owner');
	});

	test('should run a vote to consensus', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		const vote = host.createVote('Which join strategy?', ['hash', 'merge']);
		assert.ok(vote);
		assert.strictEqual(guest.getVotes().length, 1);

		assert.strictEqual(host.castVote(vote!.id, 'hash'), true);
		assert.strictEqual(guest.castVote(vote!.id, 'hash'), true);

		const result = host.closeVote(vote!.id);
		assert.strictEqual(result?.winningOption, 'hash');
		assert.strictEqual(result?.consensus, true);
		assert.strictEqual(result?.tally['hash'], 2);
		assert.strictEqual(result?.turnout, 1);
		assert.strictEqual(guest.getVotes()[0].closed, true);
		assert.strictEqual(guest.getVotes()[0].result?.winningOption, 'hash');
	});

	test('should report a split vote as unresolved consensus', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		const vote = host.createVote('Which join strategy?', ['hash', 'merge']);
		host.castVote(vote!.id, 'hash');
		guest.castVote(vote!.id, 'merge');

		const result = host.tallyVote(vote!.id);
		assert.strictEqual(result?.consensus, false);
		assert.strictEqual(result?.tally['hash'], 1);
		assert.strictEqual(result?.tally['merge'], 1);
		assert.strictEqual(result?.winningOption, undefined);
	});

	test('should record only the latest ballot from a participant', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		const vote = host.createVote('Which join strategy?', ['hash', 'merge']);
		guest.castVote(vote!.id, 'hash');
		guest.castVote(vote!.id, 'merge');

		const result = host.tallyVote(vote!.id);
		assert.strictEqual(result?.tally['merge'], 1);
		assert.strictEqual(result?.tally['hash'], 0);
		assert.strictEqual(result?.turnout, 0.5);
	});

	test('should reject a ballot for an option that was never offered', async () => {
		const host = makeService('Host');
		await host.createSession('Shared Workspace');
		const vote = host.createVote('Which join strategy?', ['hash', 'merge']);
		assert.strictEqual(host.castVote(vote!.id, 'nested-loop'), false);
	});

	test('should stop accepting ballots once a vote is closed', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		const vote = host.createVote('Which join strategy?', ['hash', 'merge']);
		host.castVote(vote!.id, 'hash');
		host.closeVote(vote!.id);

		assert.strictEqual(guest.castVote(vote!.id, 'merge'), false);
		assert.strictEqual(host.tallyVote(vote!.id)?.tally['merge'], 0);
		assert.strictEqual(host.tallyVote(vote!.id)?.tally['hash'], 1);
	});

	test('should hand hosting to the longest-standing participant when the host leaves', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);
		const document = host.createDocument('analysis.sql', 'SELECT 1');
		assert.strictEqual(guest.getState().isHost, false);

		host.leaveSession();

		assert.strictEqual(guest.getState().isHost, true);
		assert.strictEqual(guest.getState().localRole, 'owner');
		assert.strictEqual(guest.getParticipants().length, 1);
		// The new host must be able to keep sequencing the shared documents.
		assert.strictEqual(guest.editDocument(document!.id, 8, 0, ' AS one'), true);
		assert.strictEqual(guest.getDocument(document!.id)?.content, 'SELECT 1 AS one');
	});

	test('should let a late joiner take over from the migrated host', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);
		const document = host.createDocument('analysis.sql', 'SELECT 1');
		host.leaveSession();

		const latecomer = makeService('Latecomer');
		await latecomer.joinSession(session!.id);
		assert.strictEqual(latecomer.getDocument(document!.id)?.content, 'SELECT 1');
		assert.strictEqual(latecomer.editDocument(document!.id, 8, 0, ' AS one'), true);
		assert.strictEqual(guest.getDocument(document!.id)?.content, 'SELECT 1 AS one');
	});

	test('should drop a participant that announces it is leaving', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		guest.leaveSession();

		assert.strictEqual(host.getParticipants().length, 1);
		assert.strictEqual(guest.getState().connected, false);
		assert.strictEqual(guest.getState().session, undefined);
	});

	test('should announce participant changes', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');

		const seen: CollaborationParticipant[][] = [];
		host.onDidChangeParticipants(participants => seen.push(participants));
		await guest.joinSession(session!.id);

		assert.ok(seen.length > 0);
		assert.ok(seen[seen.length - 1].some(p => p.displayName === 'Guest'));
	});

	test('should carry named sub-channels between participants', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);

		const hostChannel = host.createChannel('reasoning');
		const guestChannel = guest.createChannel('reasoning');
		const otherChannel = guest.createChannel('unrelated');
		assert.ok(hostChannel && guestChannel && otherChannel);

		const received: unknown[] = [];
		const strayed: unknown[] = [];
		guestChannel!.onmessage = event => received.push(event.data);
		otherChannel!.onmessage = event => strayed.push(event.data);
		hostChannel!.postMessage({ kind: 'phase', name: 'Pattern Recognition' });

		assert.deepStrictEqual(received, [{ kind: 'phase', name: 'Pattern Recognition' }]);
		assert.strictEqual(strayed.length, 0);
	});

	test('should not offer sub-channels outside a session', () => {
		const host = makeService('Host');
		assert.strictEqual(host.createChannel('reasoning'), undefined);
	});

	test('should recover the last session after a restart', async () => {
		// Both windows share one hypergraph store, standing in for the store
		// that survives a restart.
		const logService = new NullLogService();
		const hypergraphStore = new HypergraphStore(logService);
		const membraneService = new CognitiveMembraneService(logService);
		const localHub = hub;

		class SharedStoreService extends CollaborationBackendService {
			constructor(displayName: string) {
				super(logService, hypergraphStore, membraneService);
				this.configure({ displayName, presenceIntervalMs: 0, joinTimeoutMs: 50 });
			}
			protected override _createTransport(sessionId: string): { channel: ICollaborationChannel; kind: CollaborationTransportKind } | undefined {
				return { channel: localHub.connect(sessionId), kind: 'websocket' };
			}
		}

		const before = new SharedStoreService('Host');
		const session = await before.createSession('Shared Workspace');
		before.createDocument('analysis.sql', 'SELECT 1');
		before.leaveSession();
		before.dispose();

		const after = new SharedStoreService('Host again');
		const recovered = await after.recoverSession();

		assert.strictEqual(recovered?.id, session!.id);
		assert.strictEqual(recovered?.title, 'Shared Workspace');
		assert.strictEqual(after.getState().connected, true);
		assert.strictEqual(after.getDocuments().length, 1);
		assert.strictEqual(after.getDocuments()[0].content, 'SELECT 1');
		after.dispose();
	});

	test('should report nothing to recover when no session was ever hosted', async () => {
		const host = makeService('Host');
		assert.strictEqual(await host.recoverSession(), undefined);
	});

	test('should survive a peer sending nonsense on the wire', async () => {
		const host = makeService('Host');
		const guest = makeService('Guest');
		const session = await host.createSession('Shared Workspace');
		await guest.joinSession(session!.id);
		const document = host.createDocument('analysis.sql', 'SELECT 1');

		const channel = guest.createChannel('probe');
		channel!.postMessage('not an object');
		channel!.postMessage({ type: 'operation' });
		channel!.postMessage({ type: 'operation', userId: guest.getLocalIdentity().userId, documentId: document!.id, revision: 0, operation: { components: 'nope' } });
		channel!.postMessage({ type: 'unknown-message', userId: guest.getLocalIdentity().userId });

		assert.strictEqual(host.getDocument(document!.id)?.content, 'SELECT 1');
		assert.strictEqual(host.getState().connected, true);
		assert.strictEqual(host.getParticipants().length, 2);
	});

	test('role permissions should widen from observer to owner', () => {
		assert.strictEqual(roleHasPermission('observer', 'presence:share'), true);
		assert.strictEqual(roleHasPermission('observer', 'annotation:write'), false);
		assert.strictEqual(roleHasPermission('observer', 'vote:cast'), false);
		assert.strictEqual(roleHasPermission('commenter', 'annotation:write'), true);
		assert.strictEqual(roleHasPermission('commenter', 'document:edit'), false);
		assert.strictEqual(roleHasPermission('editor', 'document:edit'), true);
		assert.strictEqual(roleHasPermission('editor', 'session:manage'), false);
		assert.strictEqual(roleHasPermission('owner', 'session:manage'), true);
	});
});
