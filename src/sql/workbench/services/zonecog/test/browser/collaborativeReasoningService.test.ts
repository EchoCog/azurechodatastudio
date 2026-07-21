/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CollaborativeReasoningService, ICollaborativeReasoningChannel } from 'sql/workbench/services/zonecog/browser/collaborativeReasoningService';
import { CollaborativePhaseEvent, CollaborativeAnnotation } from 'sql/workbench/services/zonecog/common/collaborativeReasoning';
import { IZoneCogService, ICognitiveMembraneService, ThinkingPhase } from 'sql/workbench/services/zonecog/common/zonecogService';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
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

/** Service variant whose transport is the in-memory hub. */
class TestCollaborativeReasoningService extends CollaborativeReasoningService {
	constructor(
		private readonly hub: FakeChannelHub | undefined,
		logService: ILogService,
		zoneCogService: IZoneCogService,
		membraneService: ICognitiveMembraneService
	) {
		super(logService, zoneCogService, membraneService);
	}
	protected override _createChannel(): ICollaborativeReasoningChannel | undefined {
		return this.hub?.connect();
	}
}

function phase(name: string, content = 'content'): ThinkingPhase {
	return { name, content, durationMs: 1 };
}

suite('Collaborative Reasoning Service Tests', () => {

	function makeParticipant(hub: FakeChannelHub | undefined): { service: TestCollaborativeReasoningService; zoneCog: FakeZoneCogService } {
		const logService = new NullLogService();
		const zoneCog = new FakeZoneCogService();
		const membrane = new CognitiveMembraneService(logService);
		const service = new TestCollaborativeReasoningService(hub, logService, zoneCog as unknown as IZoneCogService, membrane);
		return { service, zoneCog };
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
