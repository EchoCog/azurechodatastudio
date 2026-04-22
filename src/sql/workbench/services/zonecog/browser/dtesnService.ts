/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IDTESNService,
	DTESNConfig,
	DTESNLayerConfig,
	DTESNState,
	DTESNLayerState,
	DTESNForwardResult,
	DTESNTrainingSample,
} from 'sql/workbench/services/zonecog/common/dtesn';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_LAYER_CONFIG: DTESNLayerConfig = {
	reservoirSize: 50,
	leakRate: 0.3,
	spectralRadius: 0.9,
	inputScaling: 1.0,
	connectivity: 0.1,
};

const DEFAULT_CONFIG: DTESNConfig = {
	treeDepth: 3,
	inputDim: 8,
	outputDim: 4,
	layers: [DEFAULT_LAYER_CONFIG],
};

const MAX_TRAINING_BUFFER = 512;

// ---------------------------------------------------------------------------
// Utility: seeded pseudo-random number generator (Mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
	let s = seed;
	return (): number => {
		s |= 0; s = s + 0x6D2B79F5 | 0;
		let t = Math.imul(s ^ s >>> 15, 1 | s);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

// ---------------------------------------------------------------------------
// Matrix helpers (row-major, flat Float64Array)
// ---------------------------------------------------------------------------

function createMatrix(rows: number, cols: number): Float64Array {
	return new Float64Array(rows * cols);
}

function matVecMul(mat: Float64Array, vec: Float64Array, rows: number, cols: number, out: Float64Array): void {
	for (let r = 0; r < rows; r++) {
		let sum = 0;
		const base = r * cols;
		for (let c = 0; c < cols; c++) {
			sum += mat[base + c] * vec[c];
		}
		out[r] = sum;
	}
}

function initSparseReservoir(size: number, spectralRadius: number, connectivity: number, rng: () => number): Float64Array {
	const W = createMatrix(size, size);
	// Fill with sparse random weights
	for (let i = 0; i < size; i++) {
		for (let j = 0; j < size; j++) {
			if (rng() < connectivity) {
				W[i * size + j] = rng() * 2 - 1; // uniform [-1, 1]
			}
		}
	}
	// Approximate spectral radius rescaling via power iteration (10 steps)
	const radius = approximateSpectralRadius(W, size, rng);
	if (radius > 1e-9) {
		const scale = spectralRadius / radius;
		for (let k = 0; k < W.length; k++) {
			W[k] *= scale;
		}
	}
	return W;
}

function approximateSpectralRadius(W: Float64Array, size: number, rng: () => number): number {
	// Power iteration over 20 steps
	let v = new Float64Array(size);
	for (let i = 0; i < size; i++) { v[i] = rng() * 2 - 1; }
	let norm = 0;
	for (let k = 0; k < v.length; k++) { norm += v[k] * v[k]; }
	norm = Math.sqrt(norm);
	for (let k = 0; k < v.length; k++) { v[k] /= norm; }

	let eigenval = 0;
	const Wv = new Float64Array(size);
	for (let iter = 0; iter < 20; iter++) {
		matVecMul(W, v, size, size, Wv);
		norm = 0;
		for (let k = 0; k < Wv.length; k++) { norm += Wv[k] * Wv[k]; }
		eigenval = Math.sqrt(norm);
		if (eigenval < 1e-12) { break; }
		for (let k = 0; k < Wv.length; k++) { v[k] = Wv[k] / eigenval; }
	}
	return eigenval;
}

// ---------------------------------------------------------------------------
// Single ESN layer
// ---------------------------------------------------------------------------

class ESNLayer {
	readonly config: DTESNLayerConfig;
	readonly layerIndex: number;
	readonly inputDim: number;

	private readonly W_in: Float64Array;   // reservoirSize × inputDim
	private readonly W_res: Float64Array;  // reservoirSize × reservoirSize
	private _state: Float64Array;          // reservoirSize

	constructor(layerIndex: number, inputDim: number, config: DTESNLayerConfig, seed: number) {
		this.layerIndex = layerIndex;
		this.inputDim = inputDim;
		this.config = config;
		const rng = mulberry32(seed);
		const N = config.reservoirSize;

		// Input weight matrix: random uniform [-inputScaling, +inputScaling]
		this.W_in = createMatrix(N, inputDim);
		for (let k = 0; k < this.W_in.length; k++) {
			this.W_in[k] = (rng() * 2 - 1) * config.inputScaling;
		}

		// Reservoir weight matrix: sparse with target spectral radius
		this.W_res = initSparseReservoir(N, config.spectralRadius, config.connectivity, rng);

		this._state = new Float64Array(N);
	}

	get state(): Float64Array { return this._state; }
	get reservoirSize(): number { return this.config.reservoirSize; }

	tick(input: Float64Array): Float64Array {
		const N = this.config.reservoirSize;
		const inputContrib = new Float64Array(N);
		const resContrib = new Float64Array(N);

		matVecMul(this.W_in, input, N, this.inputDim, inputContrib);
		matVecMul(this.W_res, this._state, N, N, resContrib);

		const newState = new Float64Array(N);
		const leak = this.config.leakRate;
		for (let i = 0; i < N; i++) {
			newState[i] = (1 - leak) * this._state[i] + leak * Math.tanh(inputContrib[i] + resContrib[i]);
		}
		this._state = newState;
		return this._state;
	}

	resetState(): void {
		this._state = new Float64Array(this.config.reservoirSize);
	}

	/** Compute actual spectral radius via power iteration (for diagnostics). */
	computeSpectralRadius(): number {
		const rng = mulberry32(0xdeadbeef);
		return approximateSpectralRadius(this.W_res, this.config.reservoirSize, rng);
	}
}

// ---------------------------------------------------------------------------
// DTESN Service implementation
// ---------------------------------------------------------------------------

/**
 * Deep Tree Echo State Network (DTESN) Service.
 *
 * Hierarchical reservoir computing for temporal pattern recognition in the
 * Zone-Cog cognitive system.  Each tree level is an independent ESN layer;
 * the output from each layer feeds as additional input to the next.
 *
 * Readout uses a linear projection W_out learnable via online ridge regression.
 */
export class DTESNService extends Disposable implements IDTESNService {

	declare readonly _serviceBrand: undefined;

	private readonly _config: DTESNConfig;
	private readonly _layers: ESNLayer[];
	private _W_out: Float64Array;         // outputDim × totalReservoirSize
	private _totalReservoirSize = 0;
	private _totalTicks = 0;
	private _lastOutput: number[] = [];
	private _lastTickTime = 0;
	private readonly _trainingBuffer: DTESNTrainingSample[] = [];

	private readonly _onDidTick = this._register(new Emitter<DTESNForwardResult>());
	readonly onDidTick: Event<DTESNForwardResult> = this._onDidTick.event;

	private readonly _onDidLearn = this._register(new Emitter<{ samplesUsed: number; mse: number }>());
	readonly onDidLearn: Event<{ samplesUsed: number; mse: number }> = this._onDidLearn.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
	) {
		super();

		this._config = { ...DEFAULT_CONFIG, layers: [{ ...DEFAULT_LAYER_CONFIG }] };

		// Build tree layers: layer[0] receives inputDim inputs;
		// layer[k>0] receives inputDim + layer[k-1].reservoirSize inputs.
		this._layers = [];
		let currentInputDim = this._config.inputDim;
		for (let d = 0; d < this._config.treeDepth; d++) {
			const layerCfg = this._config.layers[Math.min(d, this._config.layers.length - 1)];
			const layer = new ESNLayer(d, currentInputDim, layerCfg, 0xC0FFEE + d * 0x1337);
			this._layers.push(layer);
			currentInputDim = this._config.inputDim + layerCfg.reservoirSize;
			this._totalReservoirSize += layerCfg.reservoirSize;
		}

		// Readout: zero-initialised; trained via ridge regression
		this._W_out = createMatrix(this._config.outputDim, this._totalReservoirSize);
		this._lastOutput = new Array(this._config.outputDim).fill(0);

		this.logService.info(
			`DTESNService: initialised — depth=${this._config.treeDepth}, ` +
			`inputDim=${this._config.inputDim}, outputDim=${this._config.outputDim}, ` +
			`totalReservoir=${this._totalReservoirSize}`
		);
		this.membraneService.recordActivity('cerebral');
	}

	// -------------------------------------------------------------------------
	// Forward pass
	// -------------------------------------------------------------------------

	forward(input: number[]): DTESNForwardResult {
		const t0 = Date.now();

		if (input.length !== this._config.inputDim) {
			// Pad or truncate to match configured inputDim
			const padded = new Array(this._config.inputDim).fill(0);
			for (let i = 0; i < Math.min(input.length, this._config.inputDim); i++) {
				padded[i] = input[i];
			}
			input = padded;
		}

		const inputArr = new Float64Array(input);
		const layerStates: DTESNLayerState[] = [];
		let prevActivation: Float64Array | null = null;

		for (let d = 0; d < this._layers.length; d++) {
			const layer = this._layers[d];
			// Build augmented input: original input + previous layer activation
			let augInput: Float64Array;
			if (prevActivation === null) {
				augInput = inputArr;
			} else {
				augInput = new Float64Array(inputArr.length + prevActivation.length);
				augInput.set(inputArr, 0);
				augInput.set(prevActivation, inputArr.length);
			}
			prevActivation = layer.tick(augInput);
			layerStates.push({
				layer: d,
				activation: Array.from(prevActivation),
				lastInput: Array.from(augInput),
			});
		}

		// Concatenate all layer activations for readout
		const combined = new Float64Array(this._totalReservoirSize);
		let offset = 0;
		for (const ls of layerStates) {
			for (const v of ls.activation) {
				combined[offset++] = v;
			}
		}

		// Readout
		const outputArr = new Float64Array(this._config.outputDim);
		matVecMul(this._W_out, combined, this._config.outputDim, this._totalReservoirSize, outputArr);
		this._lastOutput = Array.from(outputArr);
		this._totalTicks++;
		this._lastTickTime = Date.now();

		const result: DTESNForwardResult = {
			output: this._lastOutput,
			layerStates,
			durationMs: Date.now() - t0,
		};

		this._onDidTick.fire(result);
		this.membraneService.recordActivity('cerebral');
		return result;
	}

	resetState(): void {
		for (const layer of this._layers) { layer.resetState(); }
		this._lastOutput = new Array(this._config.outputDim).fill(0);
		this.logService.debug('DTESNService: reservoir state reset');
	}

	getState(): DTESNState {
		return {
			layers: this._layers.map(l => ({
				layer: l.layerIndex,
				activation: Array.from(l.state),
				lastInput: [],
			})),
			lastOutput: [...this._lastOutput],
			totalTicks: this._totalTicks,
			lastTickTime: this._lastTickTime,
		};
	}

	getConfig(): DTESNConfig {
		return { ...this._config, layers: this._config.layers.map((l: DTESNLayerConfig) => ({ ...l })) };
	}

	// -------------------------------------------------------------------------
	// MLOps / online learning
	// -------------------------------------------------------------------------

	recordTrainingSample(input: number[], target: number[], label?: string): void {
		if (this._trainingBuffer.length >= MAX_TRAINING_BUFFER) {
			this._trainingBuffer.shift(); // drop oldest
		}
		this._trainingBuffer.push({ input, target, timestamp: Date.now(), label });
	}

	trainReadout(ridgeAlpha = 1e-4): number {
		const n = this._trainingBuffer.length;
		if (n < 2) {
			return 0;
		}

		// Collect reservoir states for each training sample
		const R_size = this._totalReservoirSize;
		const O_size = this._config.outputDim;

		// Build matrices X (n × R_size) and Y (n × O_size)
		const X: number[][] = [];
		const Y: number[][] = [];

		// Save current state, run samples, restore
		const savedStates = this._layers.map(l => new Float64Array(l.state));

		for (const sample of this._trainingBuffer) {
			const result = this.forward(sample.input);
			// Combined activation = concatenation of all layer activations
			const combined: number[] = [];
			for (const ls of result.layerStates) {
				combined.push(...ls.activation);
			}
			X.push(combined);
			const tgt = sample.target.slice(0, O_size);
			while (tgt.length < O_size) { tgt.push(0); }
			Y.push(tgt);
		}

		// Restore state
		for (let d = 0; d < this._layers.length; d++) {
			const layer = this._layers[d];
			const saved = savedStates[d];
			// Access private state via a cast to bypass readonly
			(layer as unknown as { _state: Float64Array })['_state'] = new Float64Array(saved);
		}

		// Ridge regression: W_out = (X^T X + alpha*I)^{-1} X^T Y
		// For simplicity implement a per-output least-squares via Cholesky-free method
		// using the normal equations with Tikhonov regularisation.
		// X^T X: R×R,  X^T Y: R×O
		const XtX = Array.from({ length: R_size }, () => new Float64Array(R_size));
		const XtY = Array.from({ length: R_size }, () => new Float64Array(O_size));

		for (let i = 0; i < n; i++) {
			for (let r = 0; r < R_size; r++) {
				for (let c = 0; c < R_size; c++) {
					XtX[r][c] += X[i][r] * X[i][c];
				}
				for (let o = 0; o < O_size; o++) {
					XtY[r][o] += X[i][r] * Y[i][o];
				}
			}
		}
		// Add ridge
		for (let r = 0; r < R_size; r++) { XtX[r][r] += ridgeAlpha; }

		// Solve (XtX) W^T = XtY using Gaussian elimination (small matrix)
		const W_out_T = this._solveLinearSystem(XtX, XtY, R_size, O_size);

		// Transpose back into W_out (outputDim × R_size)
		const newW = createMatrix(O_size, R_size);
		for (let r = 0; r < R_size; r++) {
			for (let o = 0; o < O_size; o++) {
				newW[o * R_size + r] = W_out_T[r][o];
			}
		}
		this._W_out = newW;

		// Compute training MSE
		let mse = 0;
		for (let i = 0; i < n; i++) {
			const pred = new Float64Array(O_size);
			const x = new Float64Array(X[i]);
			matVecMul(this._W_out, x, O_size, R_size, pred);
			for (let o = 0; o < O_size; o++) {
				const err = pred[o] - Y[i][o];
				mse += err * err;
			}
		}
		mse /= (n * O_size);

		this.logService.info(`DTESNService: readout trained — samples=${n}, MSE=${mse.toFixed(6)}`);
		this._onDidLearn.fire({ samplesUsed: n, mse });
		this.membraneService.recordActivity('autonomic');
		return mse;
	}

	private _solveLinearSystem(A: Float64Array[], B: Float64Array[], n: number, m: number): Float64Array[] {
		// Augmented matrix [A | B], in-place Gaussian elimination with partial pivoting
		const aug: Float64Array[] = A.map((row, i) => {
			const r = new Float64Array(n + m);
			r.set(row, 0);
			r.set(B[i], n);
			return r;
		});

		for (let col = 0; col < n; col++) {
			// Find pivot
			let maxRow = col;
			for (let row = col + 1; row < n; row++) {
				if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) { maxRow = row; }
			}
			[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

			const pivot = aug[col][col];
			if (Math.abs(pivot) < 1e-12) { continue; }

			for (let row = 0; row < n; row++) {
				if (row === col) { continue; }
				const factor = aug[row][col] / pivot;
				for (let k = col; k < n + m; k++) {
					aug[row][k] -= factor * aug[col][k];
				}
			}
			// Normalise pivot row
			for (let k = col; k < n + m; k++) { aug[col][k] /= pivot; }
		}

		return aug.map(row => row.slice(n) as unknown as Float64Array);
	}

	getTrainingBufferSize(): number { return this._trainingBuffer.length; }

	clearTrainingBuffer(): void { this._trainingBuffer.length = 0; }

	// -------------------------------------------------------------------------
	// Diagnostics
	// -------------------------------------------------------------------------

	getLayerSpectralRadius(layer: number): number {
		if (layer < 0 || layer >= this._layers.length) { return 0; }
		return this._layers[layer].computeSpectralRadius();
	}

	getDiagnosticSummary(): string {
		const state = this.getState();
		const layerInfo = this._layers.map((l, i) => {
			const norm = Math.sqrt(l.state.reduce((s, v) => s + v * v, 0));
			return `L${i}(N=${l.reservoirSize},‖x‖=${norm.toFixed(3)})`;
		}).join(' → ');
		return (
			`DTESN[depth=${this._config.treeDepth}, in=${this._config.inputDim}, ` +
			`out=${this._config.outputDim}] ticks=${state.totalTicks} ` +
			`buf=${this._trainingBuffer.length} | ${layerInfo}`
		);
	}
}
