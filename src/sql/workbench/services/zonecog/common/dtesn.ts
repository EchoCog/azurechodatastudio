/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IDTESNService = createDecorator<IDTESNService>('dtesnService');

// ---------------------------------------------------------------------------
// DTESN configuration types
// ---------------------------------------------------------------------------

/**
 * Configuration for a single Echo State Network layer in the Deep Tree.
 */
export interface DTESNLayerConfig {
	/** Number of reservoir neurons in this layer. */
	reservoirSize: number;
	/** Leaking rate for state integration (0=no memory, 1=full integration). */
	leakRate: number;
	/** Spectral radius of the reservoir weight matrix (controls echo/memory). */
	spectralRadius: number;
	/** Input scaling factor. */
	inputScaling: number;
	/** Fraction of reservoir connections that are non-zero (sparsity). */
	connectivity: number;
}

/**
 * Full DTESN network configuration.
 */
export interface DTESNConfig {
	/** Number of tree levels (depth). */
	treeDepth: number;
	/** Dimensionality of the input vector. */
	inputDim: number;
	/** Dimensionality of the readout output. */
	outputDim: number;
	/** Per-layer configuration. If fewer entries than treeDepth, last entry is reused. */
	layers: DTESNLayerConfig[];
}

/**
 * The internal state of a single DTESN layer at one time step.
 */
export interface DTESNLayerState {
	/** Layer index (0 = deepest/input-closest layer). */
	layer: number;
	/** Current reservoir activation vector. */
	activation: number[];
	/** The input vector fed into this layer at the last tick. */
	lastInput: number[];
}

/**
 * Complete DTESN state snapshot (all layers).
 */
export interface DTESNState {
	/** States for each layer, indexed by layer number. */
	layers: DTESNLayerState[];
	/** Readout output from the last forward pass. */
	lastOutput: number[];
	/** Total number of forward passes executed. */
	totalTicks: number;
	/** Timestamp of the last tick. */
	lastTickTime: number;
}

/**
 * Result of a single DTESN forward pass.
 */
export interface DTESNForwardResult {
	/** Readout output vector. */
	output: number[];
	/** Per-layer activation states after this tick. */
	layerStates: DTESNLayerState[];
	/** Duration of the forward pass in ms. */
	durationMs: number;
}

/**
 * MLOps training sample recorded for offline/online learning.
 */
export interface DTESNTrainingSample {
	/** Input vector. */
	input: number[];
	/** Target / desired output vector (supervisor signal). */
	target: number[];
	/** Wall-clock timestamp when this sample was recorded. */
	timestamp: number;
	/** Optional label for classification tasks. */
	label?: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Deep Tree Echo State Network (DTESN) Service.
 *
 * Implements a hierarchical reservoir computing architecture where each
 * level of the tree is an Echo State Network (ESN) layer.  Lower layers
 * receive the raw input and their activations bubble up to higher layers,
 * creating a deep hierarchy of temporal abstractions.
 *
 * This maps directly to the Deep Tree Echo architecture described in the
 * EchoCog manifesto:
 *
 *   Input ──► Layer 0 (ESN) ──► Layer 1 (ESN) ──► … ──► Layer N (ESN)
 *                  │                  │                        │
 *                  └──────────── concatenate ─────────────► Readout W_out
 *
 * Role in the 4E Embodied AI Framework:
 * - Temporal encoding of sensorimotor sequences
 * - Proprioceptive feedback loop state representation
 * - Dynamic model training support via online ridge-regression readout
 * - Drives MLOps by accumulating training samples for periodic re-learning
 */
export interface IDTESNService {
	readonly _serviceBrand: undefined;

	/** Fired after each forward pass. */
	readonly onDidTick: Event<DTESNForwardResult>;

	/** Fired when the readout weights are updated (online learning). */
	readonly onDidLearn: Event<{ samplesUsed: number; mse: number }>;

	// -- Core network operations ---------------------------------------------

	/**
	 * Feed an input vector through all DTESN layers and produce output.
	 * Updates the reservoir state and returns the readout activation.
	 * @param input Input vector (length must match inputDim).
	 */
	forward(input: number[]): DTESNForwardResult;

	/**
	 * Reset all layer states to zero (warm-up washout).
	 */
	resetState(): void;

	/**
	 * Get the current full DTESN state snapshot.
	 */
	getState(): DTESNState;

	/**
	 * Get the active network configuration.
	 */
	getConfig(): DTESNConfig;

	// -- MLOps / online learning ---------------------------------------------

	/**
	 * Record a labelled input→target sample for the training buffer.
	 * Call this whenever a ground-truth target is known.
	 */
	recordTrainingSample(input: number[], target: number[], label?: string): void;

	/**
	 * Run online ridge-regression readout training over the buffered samples.
	 * Updates W_out in place.
	 * @param ridgeAlpha Regularisation parameter (default 1e-4).
	 * @returns MSE on the training buffer.
	 */
	trainReadout(ridgeAlpha?: number): number;

	/**
	 * Get the number of buffered training samples waiting to be trained.
	 */
	getTrainingBufferSize(): number;

	/**
	 * Clear the training sample buffer.
	 */
	clearTrainingBuffer(): void;

	// -- Diagnostics ---------------------------------------------------------

	/**
	 * Get the spectral radius of the reservoir weight matrix for a given layer.
	 * (Diagnostic metric; should stay at the configured value after initialisation.)
	 */
	getLayerSpectralRadius(layer: number): number;

	/**
	 * Return a brief diagnostic summary string (suitable for notification display).
	 */
	getDiagnosticSummary(): string;
}
