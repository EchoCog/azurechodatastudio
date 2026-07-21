/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ISensorimotorBindingService,
	TemporalEncoding,
	DecodedMotorIntent,
	SensorimotorBindingEvent,
	SensorimotorBindingState,
} from 'sql/workbench/services/zonecog/common/sensorimotorBinding';
import {
	IEmbodiedCognitionService,
	SensoryPercept,
	SensoryModality,
	MotorAction,
	MotorActionKind,
} from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { IDTESNService } from 'sql/workbench/services/zonecog/common/dtesn';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered sensory modalities used for the one-hot encoder segment. */
const MODALITY_ORDER: SensoryModality[] = ['schema', 'query', 'result', 'file', 'interaction'];

/** Ordered motor action kinds mapped onto DTESN readout units. */
const KIND_ORDER: MotorActionKind[] = ['insight', 'query_suggestion', 'schema_recommendation', 'alert', 'navigation'];

/** Default minimum decoded confidence required to emit a motor action. */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

/** Maximum number of percept encodings retained for feedback supervision. */
const MAX_RETAINED_ENCODINGS = 128;

/** Number of buffered feedback samples that triggers a readout training run. */
const TRAIN_BATCH_SIZE = 16;

/** Payload-length normalisation scale for the encoder (characters). */
const PAYLOAD_LENGTH_SCALE = 512;

/**
 * Deterministic FNV-1a string hash mapped to [0, 1].  Used to derive
 * stable content features from percept payloads.
 */
function hashToUnit(text: string, salt: number): number {
	let h = (0x811C9DC5 ^ salt) >>> 0;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h / 0xFFFFFFFF;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * Sensorimotor Binding Service (Phase 5.4: DTESN Sensorimotor Binding).
 *
 * Wires the Deep Tree Echo State Network to actual workspace events:
 *
 *   SensoryPercept --TemporalEncoder--> input vector --DTESN.forward-->
 *   readout vector --MotorDecoder--> DecodedMotorIntent --threshold-->
 *   MotorAction (via IEmbodiedCognitionService.act)
 *
 * The online-learning pipeline converts user feedback on decoded intents
 * into labelled DTESN training samples and periodically retrains the
 * ridge-regression readout, closing the proprioceptive feedback loop that
 * drives dynamic model training (MLOps).
 */
export class SensorimotorBindingService extends Disposable implements ISensorimotorBindingService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidBind = this._register(new Emitter<SensorimotorBindingEvent>());
	readonly onDidBind: Event<SensorimotorBindingEvent> = this._onDidBind.event;

	private readonly _onDidTrainFromFeedback = this._register(new Emitter<{ samplesUsed: number; mse: number }>());
	readonly onDidTrainFromFeedback: Event<{ samplesUsed: number; mse: number }> = this._onDidTrainFromFeedback.event;

	private readonly _perceptSubscription = this._register(new MutableDisposable<IDisposable>());

	/** Retained encodings keyed by percept ID (FIFO-capped) for feedback supervision. */
	private readonly _retainedEncodings = new Map<string, TemporalEncoding>();

	private _active = false;
	private _perceptsEncoded = 0;
	private _actionsEmitted = 0;
	private _feedbackSamples = 0;
	private _trainingRuns = 0;
	private _lastTrainingMse: number | null = null;
	private _confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD;
	private _lastUpdate = Date.now();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IDTESNService private readonly dtesnService: IDTESNService,
		@IEmbodiedCognitionService private readonly embodiedCognitionService: IEmbodiedCognitionService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this.logService.info('SensorimotorBindingService: initialized DTESN sensorimotor binding layer');
		this.membraneService.recordActivity('autonomic');
	}

	// -- Binding loop control --------------------------------------------------

	start(): boolean {
		if (this._active) {
			return false;
		}
		this._perceptSubscription.value = this.embodiedCognitionService.onDidPerceive(percept => {
			try {
				this.processPercept(percept);
			} catch (error) {
				this.membraneService.recordError('somatic', `Sensorimotor binding cycle failed: ${error}`);
				this.logService.error('SensorimotorBindingService: binding cycle failed', error);
			}
		});
		this._active = true;
		this._lastUpdate = Date.now();
		this.membraneService.recordActivity('autonomic');
		this.logService.info('SensorimotorBindingService: live binding loop started');
		return true;
	}

	stop(): boolean {
		if (!this._active) {
			return false;
		}
		this._perceptSubscription.clear();
		this._active = false;
		this._lastUpdate = Date.now();
		this.membraneService.recordActivity('autonomic');
		this.logService.info('SensorimotorBindingService: live binding loop stopped');
		return true;
	}

	// -- TemporalEncoder ---------------------------------------------------------

	encodePercept(percept: SensoryPercept): TemporalEncoding {
		this.membraneService.recordActivity('cerebral');
		const inputDim = this.dtesnService.getConfig().inputDim;
		const input = new Array<number>(inputDim).fill(0);

		// Segment 1: one-hot sensory modality.
		const modalityIndex = MODALITY_ORDER.indexOf(percept.modality);
		if (modalityIndex >= 0 && modalityIndex < inputDim) {
			input[modalityIndex] = 1;
		}

		// Segment 2: salience.
		if (MODALITY_ORDER.length < inputDim) {
			input[MODALITY_ORDER.length] = clamp01(percept.salience);
		}

		// Segment 3: normalised payload magnitude.
		if (MODALITY_ORDER.length + 1 < inputDim) {
			input[MODALITY_ORDER.length + 1] = Math.tanh(percept.payload.length / PAYLOAD_LENGTH_SCALE);
		}

		// Segment 4: time-of-day phase in [0, 1] (temporal context).
		if (MODALITY_ORDER.length + 2 < inputDim) {
			const msIntoDay = percept.timestamp % 86_400_000;
			input[MODALITY_ORDER.length + 2] = (Math.sin((msIntoDay / 86_400_000) * 2 * Math.PI) + 1) / 2;
		}

		// Segment 5: deterministic payload content features for any remaining dims.
		for (let d = MODALITY_ORDER.length + 3; d < inputDim; d++) {
			input[d] = hashToUnit(percept.payload, d);
		}

		const encoding: TemporalEncoding = {
			perceptId: percept.id,
			input,
			timestamp: Date.now(),
		};
		this._retainEncoding(encoding);
		return encoding;
	}

	// -- MotorDecoder ------------------------------------------------------------

	decodeOutput(output: number[]): DecodedMotorIntent {
		this.membraneService.recordActivity('cerebral');
		if (output.length === 0) {
			return { kind: KIND_ORDER[0], confidence: 0, rawOutput: [] };
		}

		// Softmax over the readout units (numerically stabilised).
		const max = Math.max(...output);
		const exps = output.map(v => Math.exp(v - max));
		const sum = exps.reduce((a, b) => a + b, 0);
		const probs = exps.map(e => e / sum);

		let bestIndex = 0;
		for (let i = 1; i < probs.length; i++) {
			if (probs[i] > probs[bestIndex]) {
				bestIndex = i;
			}
		}

		return {
			kind: KIND_ORDER[bestIndex % KIND_ORDER.length],
			confidence: clamp01(probs[bestIndex]),
			rawOutput: [...output],
		};
	}

	// -- Full pipeline -----------------------------------------------------------

	processPercept(percept: SensoryPercept): SensorimotorBindingEvent {
		const encoding = this.encodePercept(percept);
		const forward = this.dtesnService.forward(encoding.input);
		const intent = this.decodeOutput(forward.output);

		this._perceptsEncoded++;
		this._lastUpdate = Date.now();

		let action: MotorAction | null = null;
		if (intent.confidence >= this._confidenceThreshold) {
			this.membraneService.recordActivity('somatic');
			action = this.embodiedCognitionService.act(
				intent.kind,
				`DTESN sensorimotor intent from ${percept.modality} percept`,
				JSON.stringify({
					perceptSummary: percept.summary,
					rawOutput: intent.rawOutput,
					source: 'dtesn-sensorimotor-binding',
				}),
				intent.confidence,
				[percept.id]
			);
			this._actionsEmitted++;
		}

		const event: SensorimotorBindingEvent = { percept, encoding, intent, action };
		this._onDidBind.fire(event);
		return event;
	}

	// -- Online learning pipeline -------------------------------------------------

	provideFeedback(perceptId: string, desiredKind: MotorActionKind, reward: number): boolean {
		const encoding = this._retainedEncodings.get(perceptId);
		if (!encoding) {
			return false;
		}

		const outputDim = this.dtesnService.getConfig().outputDim;
		const kindIndex = KIND_ORDER.indexOf(desiredKind);
		const target = new Array<number>(outputDim).fill(0);
		if (kindIndex >= 0 && kindIndex < outputDim) {
			target[kindIndex] = clamp01(reward);
		}

		this.dtesnService.recordTrainingSample(encoding.input, target, desiredKind);
		this._feedbackSamples++;
		this._lastUpdate = Date.now();
		this.membraneService.recordActivity('autonomic');

		if (this.dtesnService.getTrainingBufferSize() >= TRAIN_BATCH_SIZE) {
			this._trainFromBuffer();
		}
		return true;
	}

	private _trainFromBuffer(): void {
		const samplesUsed = this.dtesnService.getTrainingBufferSize();
		try {
			const mse = this.dtesnService.trainReadout();
			this.dtesnService.clearTrainingBuffer();
			this._trainingRuns++;
			this._lastTrainingMse = mse;
			this._lastUpdate = Date.now();
			this.membraneService.recordActivity('cerebral');

			this.hypergraphStore.addNode({
				node_type: 'SensorimotorTraining',
				content: `DTESN readout retrained from ${samplesUsed} feedback sample(s); MSE=${mse.toFixed(6)}`,
				links: [],
				metadata: {
					samplesUsed,
					mse,
					trainingRun: this._trainingRuns,
					timestamp: this._lastUpdate,
				},
				salience_score: clamp01(1 - mse),
			});

			this._onDidTrainFromFeedback.fire({ samplesUsed, mse });
			this.logService.info(`SensorimotorBindingService: readout trained on ${samplesUsed} sample(s), MSE=${mse.toFixed(6)}`);
		} catch (error) {
			this.membraneService.recordError('cerebral', `Sensorimotor readout training failed: ${error}`);
			this.logService.error('SensorimotorBindingService: readout training failed', error);
		}
	}

	// -- Configuration & state ------------------------------------------------

	setConfidenceThreshold(threshold: number): void {
		this._confidenceThreshold = clamp01(threshold);
		this._lastUpdate = Date.now();
		this.membraneService.recordActivity('autonomic');
	}

	getState(): SensorimotorBindingState {
		return {
			active: this._active,
			perceptsEncoded: this._perceptsEncoded,
			actionsEmitted: this._actionsEmitted,
			feedbackSamples: this._feedbackSamples,
			trainingRuns: this._trainingRuns,
			lastTrainingMse: this._lastTrainingMse,
			confidenceThreshold: this._confidenceThreshold,
			lastUpdate: this._lastUpdate,
		};
	}

	reset(): void {
		this.stop();
		this._retainedEncodings.clear();
		this._perceptsEncoded = 0;
		this._actionsEmitted = 0;
		this._feedbackSamples = 0;
		this._trainingRuns = 0;
		this._lastTrainingMse = null;
		this._confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD;
		this._lastUpdate = Date.now();
		this.membraneService.recordActivity('autonomic');
		this.logService.info('SensorimotorBindingService: reset');
	}

	// -- Internals --------------------------------------------------------------

	private _retainEncoding(encoding: TemporalEncoding): void {
		if (this._retainedEncodings.size >= MAX_RETAINED_ENCODINGS) {
			const oldest = this._retainedEncodings.keys().next().value;
			if (oldest !== undefined) {
				this._retainedEncodings.delete(oldest);
			}
		}
		this._retainedEncodings.set(encoding.perceptId, encoding);
	}
}
