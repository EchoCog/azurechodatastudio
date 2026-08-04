/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CollaborativeReasoningService, ICollaborativeReasoningChannel } from 'sql/workbench/services/zonecog/browser/collaborativeReasoningService';
import { CollaborativePhaseEvent, CollaborativeAnnotation, CollaborativeDecisionEvent } from 'sql/workbench/services/zonecog/common/collaborativeReasoning';
import { IZoneCogService, ICognitiveMembraneService, ThinkingPhase } from 'sql/workbench/services/zonecog/common/zonecogService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CollaborationBackendService } from 'sql/workbench/services/zonecog/browser/collaborationBackendService';
import { CollaborationTransportKind, ICollaborationChannel } from 'sql/workbench/services/zonecog/common/collaborationBackend';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { Emitter } from 'vs/base/common/event';

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

class FakeChannel implements ICollaborativeReasoningChannel {
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

/** Minimal fake ZoneCogService exposing just what the collaborative service needs. */
class FakeZoneCogService implements Pick<IZoneCogService, 'onDidCompleteThinkingPhase' | 'getQueryHistory'> {
	private readonly _onDidCompleteThinkingPhase = new Emitter<ThinkingPhase>();
	readonly onDidCompleteThinkingPhase = this._onDidCompleteThinkingPhase.event;
	private readonly _history: Array<{ query: string; timestamp: number }> = [];

	setCurrentQuery(query: string): void {
		this._history.push({ query, timestamp: Date.now() });
	}

	getQueryHistory(): Array<{ query: string; timestamp: number }> {
		return [...this._history];
	}

	firePhase(phase: ThinkingPhase): void {
		this._onDidCompleteThinkingPhase.fire(phase);
	}
}

/** Backend variant whose session transport is an in-memory hub. */
class TestCollaborationBackendService extends CollaborationBackendService {
	constructor(private readonly sessionHub: FakeChannelHub, logService: ILogService, membraneService: ICognitiveMembraneService) {
		super(logService, new HypergraphStore(logService), membraneService);
		this.configure({ presenceIntervalMs: 0, joinTimeoutMs: 50 });
	}
	protected override _createTransport(): { channel: ICollaborationChannel; kind: CollaborationTransportKind } | undefined {
		return { channel: this.sessionHub.connect(), kind: 'websocket' };
	}
}

/** Service variant whose transport is the in-memory hub. */
class TestCollaborativeReasoningService extends CollaborativeReasoningService {
	constructor(
		private readonly hub: FakeChannelHub | undefined,
		logService: ILogService,
		zoneCogService: IZoneCogService,
		membraneService: ICognitiveMembraneService,
		collaborationBackend: CollaborationBackendService
	) {
		super(logService, zoneCogService, membraneService, collaborationBackend);
	}
	protected override _createChannel(): ICollaborativeReasoningChannel | undefined {
		// Stands in for the BroadcastChannel a browser provides; the shared
		// multi-user path above it is exercised for real.
		return this.hub?.connect();
	}
}

function phase(name: string, content = 'content'): ThinkingPhase {
	return { name, content, durationMs: 1 };
}

suite('Collaborative Reasoning Service Tests', () => {

	let sessionHub: FakeChannelHub;

	setup(() => {
		sessionHub = new FakeChannelHub();
	});

	function makeParticipant(hub: FakeChannelHub | undefined): { service: TestCollaborativeReasoningService; zoneCog: FakeZoneCogService; backend: TestCollaborationBackendService } {
		const logService = new NullLogService();
		const zoneCog = new FakeZoneCogService();
		const membrane = new CognitiveMembraneService(logService);
		const backend = new TestCollaborationBackendService(sessionHub, logService, membrane);
		const service = new TestCollaborativeReasoningService(hub, logService, zoneCog as unknown as IZoneCogService, membrane, backend);
		return { service, zoneCog, backend };
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

	test('peers should discover each other via hello handshake', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);

		a.service.startSession();
		b.service.startSession();

		assert.strictEqual(a.service.getState().knownPeers.length, 1);
		assert.strictEqual(b.service.getState().knownPeers.length, 1);
	});

	test('local phases should be recorded and broadcast to peers', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.zoneCog.setCurrentQuery('what tables exist?');
		a.zoneCog.firePhase(phase('Initial Engagement', 'hmm...'));
		a.zoneCog.firePhase(phase('Problem Space Exploration', 'exploring...'));

		assert.strictEqual(a.service.getState().phasesSent, 2);
		assert.strictEqual(b.service.getState().phasesReceived, 2);

		const bLog = b.service.getSessionLog();
		assert.strictEqual(bLog.length, 2);
		assert.strictEqual(bLog[0].kind, 'phase');
		const first = bLog[0] as { kind: 'phase'; event: CollaborativePhaseEvent };
		assert.strictEqual(first.event.phase.name, 'Initial Engagement');
		assert.strictEqual(first.event.query, 'what tables exist?');
		assert.strictEqual(first.event.querySeq, 1);
	});

	test('own phases should also appear in the local transcript', () => {
		const { service, zoneCog } = makeParticipant(new FakeChannelHub());
		service.startSession();

		zoneCog.firePhase(phase('Initial Engagement'));

		const log = service.getSessionLog();
		assert.strictEqual(log.length, 1);
		assert.strictEqual(service.getState().phasesSent, 1);
	});

	test('querySeq should increment only on Initial Engagement', () => {
		const { service, zoneCog } = makeParticipant(new FakeChannelHub());
		service.startSession();

		zoneCog.firePhase(phase('Initial Engagement'));
		zoneCog.firePhase(phase('Problem Space Exploration'));
		zoneCog.firePhase(phase('Initial Engagement'));

		const log = service.getSessionLog().map(e => (e as { kind: 'phase'; event: CollaborativePhaseEvent }).event.querySeq);
		assert.deepStrictEqual(log, [1, 1, 2]);
	});

	test('phases fired before the session starts should not be recorded', () => {
		const { service, zoneCog } = makeParticipant(new FakeChannelHub());
		zoneCog.firePhase(phase('Initial Engagement'));
		assert.strictEqual(service.getSessionLog().length, 0);

		service.startSession();
		zoneCog.firePhase(phase('Problem Space Exploration'));
		assert.strictEqual(service.getSessionLog().length, 1);
	});

	test('annotations should be shared and appear in both transcripts', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.service.postAnnotation('peer-x', 3, 'Pattern Recognition and Analysis', '  nice catch!  ');

		assert.strictEqual(a.service.getState().annotationsSent, 1);
		assert.strictEqual(b.service.getState().annotationsReceived, 1);

		const received: CollaborativeAnnotation[] = [];
		b.service.onDidReceiveAnnotation(a => received.push(a));
		a.service.postAnnotation('peer-x', 3, 'Pattern Recognition and Analysis', 'second note');
		assert.strictEqual(received.length, 1);
		assert.strictEqual(received[0].text, 'second note');

		const aLog = a.service.getSessionLog();
		const firstAnnotation = aLog[0] as { kind: 'annotation'; event: CollaborativeAnnotation };
		assert.strictEqual(firstAnnotation.event.text, 'nice catch!');
	});

	test('blank annotations should be ignored', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.startSession();
		service.postAnnotation('peer-x', 1, 'Initial Engagement', '   ');
		assert.strictEqual(service.getSessionLog().length, 0);
		assert.strictEqual(service.getState().annotationsSent, 0);
	});

	test('should fire onDidReceivePhase for both own and peer phases', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		const received: CollaborativePhaseEvent[] = [];
		b.service.onDidReceivePhase(e => received.push(e));

		a.zoneCog.firePhase(phase('Initial Engagement'));
		assert.strictEqual(received.length, 1);
		assert.strictEqual(received[0].peerId, a.service.getState().peerId);
	});

	test('local phases after stopSession should not propagate', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();

		a.service.stopSession();
		a.zoneCog.firePhase(phase('Initial Engagement'));

		assert.strictEqual(b.service.getState().phasesReceived, 0);
	});

	test('clear should empty the transcript without touching lifetime counters', () => {
		const { service, zoneCog } = makeParticipant(new FakeChannelHub());
		service.startSession();
		zoneCog.firePhase(phase('Initial Engagement'));

		service.clear();
		assert.strictEqual(service.getSessionLog().length, 0);
		assert.strictEqual(service.getState().phasesSent, 1);
	});

	test('phases should carry no attribution outside a multi-user session', () => {
		const hub = new FakeChannelHub();
		const { service: a } = makeParticipant(hub);
		const { service: b, zoneCog: zoneCogB } = makeParticipant(hub);
		a.startSession();
		b.startSession();
		zoneCogB.firePhase(phase('Pattern Recognition'));

		const received = a.getSessionLog().filter(entry => entry.kind === 'phase');
		assert.strictEqual(received.length, 1);
		assert.strictEqual((received[0].event as CollaborativePhaseEvent).userId, undefined);
	});

	test('phases should be attributed to their author inside a multi-user session', async () => {
		const hub = new FakeChannelHub();
		const { service: a, backend: backendA } = makeParticipant(hub);
		const { service: b, zoneCog: zoneCogB, backend: backendB } = makeParticipant(hub);
		backendB.configure({ displayName: 'Marduk' });
		const session = await backendA.createSession('Shared Reasoning');
		await backendB.joinSession(session!.id);
		a.startSession();
		b.startSession();

		zoneCogB.firePhase(phase('Pattern Recognition'));

		const received = a.getSessionLog().filter(entry => entry.kind === 'phase');
		assert.strictEqual(received.length, 1);
		const event = received[0].event as CollaborativePhaseEvent;
		assert.strictEqual(event.userId, backendB.getLocalIdentity().userId);
		assert.strictEqual(event.displayName, 'Marduk');
	});

	test('should refuse an annotation from a participant without write access', async () => {
		const hub = new FakeChannelHub();
		const { service: a, backend: backendA } = makeParticipant(hub);
		const { service: b, backend: backendB } = makeParticipant(hub);
		const session = await backendA.createSession('Shared Reasoning');
		await backendB.joinSession(session!.id, 'observer');
		a.startSession();
		b.startSession();

		assert.strictEqual(b.postAnnotation('a', 1, 'Pattern Recognition', 'looks wrong'), false);
		assert.strictEqual(a.getSessionLog().filter(entry => entry.kind === 'annotation').length, 0);
	});

	test('should drop an annotation an observer posts straight onto the channel', async () => {
		const hub = new FakeChannelHub();
		const { service: a, backend: backendA } = makeParticipant(hub);
		const { service: b, backend: backendB } = makeParticipant(hub);
		const session = await backendA.createSession('Shared Reasoning');
		await backendB.joinSession(session!.id, 'observer');
		a.startSession();
		b.startSession();

		// Bypass the local permission check the way a tampered client would,
		// posting onto the transcript channel the session peers share.
		const channel = backendB.createChannel('zonecog-collaborative-reasoning');
		assert.ok(channel);
		channel!.postMessage({
			type: 'annotation',
			peerId: 'tampered',
			userId: backendB.getLocalIdentity().userId,
			targetPeerId: 'a',
			targetQuerySeq: 1,
			targetPhaseName: 'Pattern Recognition',
			text: 'looks wrong',
			timestamp: Date.now()
		});

		assert.strictEqual(a.getSessionLog().filter(entry => entry.kind === 'annotation').length, 0);
	});

	test('annotations should be attributed once a session grants access', async () => {
		const hub = new FakeChannelHub();
		const { service: a, backend: backendA } = makeParticipant(hub);
		const { service: b, backend: backendB } = makeParticipant(hub);
		backendB.configure({ displayName: 'Marduk' });
		const session = await backendA.createSession('Shared Reasoning');
		await backendB.joinSession(session!.id, 'commenter');
		a.startSession();
		b.startSession();

		assert.strictEqual(b.postAnnotation('a', 1, 'Pattern Recognition', 'agreed'), true);
		const annotations = a.getSessionLog().filter(entry => entry.kind === 'annotation');
		assert.strictEqual(annotations.length, 1);
		const annotation = annotations[0].event as CollaborativeAnnotation;
		assert.strictEqual(annotation.text, 'agreed');
		assert.strictEqual(annotation.userId, backendB.getLocalIdentity().userId);
		assert.strictEqual(annotation.displayName, 'Marduk');
	});

	test('should settle a contested judgement by vote', async () => {
		const hub = new FakeChannelHub();
		const { service: a, backend: backendA } = makeParticipant(hub);
		const { service: b, backend: backendB } = makeParticipant(hub);
		const session = await backendA.createSession('Shared Reasoning');
		await backendB.joinSession(session!.id);
		a.startSession();
		b.startSession();

		const raised: string[] = [];
		a.onDidChangeDecision(event => raised.push(event.topic));

		const decision = a.proposeDecision('Trust the index scan estimate?', ['yes', 'no']);
		assert.ok(decision);
		assert.strictEqual(a.getDecisions().length, 1);
		assert.strictEqual(b.getDecisions().length, 1);

		assert.strictEqual(a.castDecisionVote(decision!.decisionId, 'no'), true);
		assert.strictEqual(b.castDecisionVote(decision!.decisionId, 'no'), true);

		const outcome = a.resolveDecision(decision!.decisionId);
		assert.strictEqual(outcome?.winningOption, 'no');
		assert.strictEqual(outcome?.consensus, true);
		assert.ok(raised.indexOf('Trust the index scan estimate?') !== -1);
	});

	test('decisions should appear in the transcript exactly once', async () => {
		const hub = new FakeChannelHub();
		const { service: a, backend: backendA } = makeParticipant(hub);
		await backendA.createSession('Shared Reasoning');
		a.startSession();

		const decision = a.proposeDecision('Trust the index scan estimate?', ['yes', 'no']);
		a.castDecisionVote(decision!.decisionId, 'yes');
		a.resolveDecision(decision!.decisionId);

		const entries = a.getSessionLog().filter(entry => entry.kind === 'decision');
		assert.strictEqual(entries.length, 1);
		assert.strictEqual((entries[0].event as CollaborativeDecisionEvent).outcome?.winningOption, 'yes');
	});

	test('should not raise a decision without a multi-user session', () => {
		const { service } = makeParticipant(new FakeChannelHub());
		service.startSession();
		assert.strictEqual(service.proposeDecision('Trust the estimate?', ['yes', 'no']), undefined);
		assert.strictEqual(service.getDecisions().length, 0);
	});

	test('state should report the transport and identity in use', async () => {
		const hub = new FakeChannelHub();
		const { service, backend } = makeParticipant(hub);
		backend.configure({ displayName: 'Dan' });
		service.startSession();
		assert.strictEqual(service.getState().transport, 'broadcast');
		assert.strictEqual(service.getState().sessionId, undefined);

		const session = await backend.createSession('Shared Reasoning');
		const state = service.getState();
		assert.strictEqual(state.transport, 'websocket');
		assert.strictEqual(state.sessionId, session!.id);
		assert.strictEqual(state.displayName, 'Dan');
		assert.strictEqual(state.userId, backend.getLocalIdentity().userId);
	});

	test('three peers should all receive a broadcast phase', () => {
		const hub = new FakeChannelHub();
		const a = makeParticipant(hub);
		const b = makeParticipant(hub);
		const c = makeParticipant(hub);
		a.service.startSession();
		b.service.startSession();
		c.service.startSession();

		b.zoneCog.firePhase(phase('Initial Engagement'));

		assert.strictEqual(a.service.getSessionLog().length, 1);
		assert.strictEqual(c.service.getSessionLog().length, 1);
	});
});
