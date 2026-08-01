/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { SensoryPercept, MotorAction, MotorActionKind } from 'sql/workbench/services/zonecog/common/embodiedCognition';

export const ISensorimotorBindingService = createDecorator<ISensorimotorBindingService>('sensorimotorBindingService');

// ---------------------------------------------------------------------------
// Temporal encoding types
// ---------------------------------------------------------------------------

/**
 * The result of temporally encoding a sensory percept into a DTESN
 * input vector (TemporalEncoder output).
 */
export interface TemporalEncoding {
	/** ID of the sensory percept that was encoded. */
	perceptId: string;
	/** The DTESN-ready input vector (length = DTESN inputDim). */
	input: number[];
	/** Epoch-ms when the encoding was produced. */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Motor decoding types
// ---------------------------------------------------------------------------

/**
 * A motor intent decoded from a DTESN readout output vector
 * (MotorDecoder output).  This is the pre-action stage: an intent only
 * becomes a {@link MotorAction} when its confidence clears the binding
 * confidence threshold.
 */
export interface DecodedMotorIntent {
	/** The motor action category the readout activation maps to. */
	kind: MotorActionKind;
	/** Softmax confidence of the winning readout unit in [0, 1]. */
	confidence: number;
	/** The raw DTESN readout vector the intent was decoded from. */
	rawOutput: number[];
}

/**
 * A complete sensorimotor binding cycle: percept -> temporal encoding ->
 * DTESN forward pass -> decoded motor intent -> (optionally) emitted action.
 */
export interface SensorimotorBindingEvent {
	/** The sensory percept that triggered the cycle. */
	percept: SensoryPercept;
	/** The temporal encoding fed into the DTESN. */
	encoding: TemporalEncoding;
	/** The motor intent decoded from the DTESN readout. */
	intent: DecodedMotorIntent;
	/** The motor action emitted, or null when confidence was below threshold. */
	action: MotorAction | null;
}

// ---------------------------------------------------------------------------
// Binding state
// ---------------------------------------------------------------------------

/**
 * Aggregate state of the sensorimotor binding layer.
 */
export interface SensorimotorBindingState {
	/** Whether the binding loop is subscribed to live percepts. */
	active: boolean;
	/** Total percepts encoded through the DTESN. */
	perceptsEncoded: number;
	/** Total motor actions emitted (intents above threshold). */
	actionsEmitted: number;
	/** Total feedback samples recorded into the online-learning pipeline. */
	feedbackSamples: number;
	/** Number of readout training runs triggered by feedback. */
	trainingRuns: number;
	/** MSE from the most recent readout training run (null before first run). */
	lastTrainingMse: number | null;
	/** Minimum decoded confidence required to emit a motor action. */
	confidenceThreshold: number;
	/** Epoch-ms of the last state mutation. */
	lastUpdate: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Sensorimotor Binding Service -- wires the Deep Tree Echo State Network
 * to actual workspace events (Phase 5.4: DTESN Sensorimotor Binding).
 *
 * Pipeline:
 *   SensoryPercept --TemporalEncoder--> input vector --DTESN.forward-->
 *   readout vector --MotorDecoder--> DecodedMotorIntent --threshold-->
 *   MotorAction (via IEmbodiedCognitionService.act)
 *
 * Online learning: user feedback on emitted intents is converted into
 * labelled training samples and periodically used to retrain the DTESN
 * ridge-regression readout, closing the proprioceptive feedback loop.
 */
export interface ISensorimotorBindingService {
	readonly _serviceBrand: undefined;

	/** Fired after each complete sensorimotor binding cycle. */
	readonly onDidBind: Event<SensorimotorBindingEvent>;

	/** Fired after each online-learning readout training run. */
	readonly onDidTrainFromFeedback: Event<{ samplesUsed: number; mse: number }>;

	// -- Binding loop control --------------------------------------------------

	/**
	 * Start the live binding loop: every percept captured by the embodied
	 * cognition layer is encoded, run through the DTESN and decoded.
	 * @returns true if the loop was started, false if already active.
	 */
	start(): boolean;

	/**
	 * Stop the live binding loop.
	 * @returns true if the loop was stopped, false if it was not active.
	 */
	stop(): boolean;

	// -- TemporalEncoder ---------------------------------------------------------

	/**
	 * Encode a sensory percept as a DTESN input vector.  The encoding is
	 * deterministic: modality one-hot + salience + payload features +
	 * time-of-day phase, sized to the DTESN input dimension.
	 */
	encodePercept(percept: SensoryPercept): TemporalEncoding;

	// -- MotorDecoder ------------------------------------------------------------

	/**
	 * Decode a DTESN readout output vector to a motor intent using a
	 * softmax over the readout units mapped to motor action kinds.
	 */
	decodeOutput(output: number[]): DecodedMotorIntent;

	// -- Full pipeline -----------------------------------------------------------

	/**
	 * Run one complete sensorimotor cycle for a percept: encode, forward
	 * through the DTESN, decode, and emit a motor action when the decoded
	 * confidence clears the threshold.
	 */
	processPercept(percept: SensoryPercept): SensorimotorBindingEvent;

	// -- Online learning pipeline -------------------------------------------------

	/**
	 * Provide supervision for a previously processed percept.  Converts
	 * the feedback into a labelled DTESN training sample (encoding input
	 * -> reward-scaled one-hot target for the desired action kind) and
	 * triggers readout training once enough samples accumulate.
	 * @param perceptId ID of a percept processed within the retention window.
	 * @param desiredKind The motor action kind that would have been correct.
	 * @param reward Reward signal in [0, 1] (1 = fully correct).
	 * @returns true when the feedback was recorded, false if the percept
	 *          encoding is no longer retained.
	 */
	provideFeedback(perceptId: string, desiredKind: MotorActionKind, reward: number): boolean;

	// -- Configuration & state ------------------------------------------------

	/**
	 * Set the minimum decoded confidence required to emit a motor action.
	 * Clamped to [0, 1].
	 */
	setConfidenceThreshold(threshold: number): void;

	/**
	 * Get the current aggregate binding state.
	 */
	getState(): SensorimotorBindingState;

	/**
	 * Reset all binding statistics and retained encodings.
	 */
	reset(): void;
}
