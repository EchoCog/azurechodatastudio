/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IEmbodiedCognitionService = createDecorator<IEmbodiedCognitionService>('embodiedCognitionService');

// ---------------------------------------------------------------------------
// Sensory channel types
// ---------------------------------------------------------------------------

/**
 * A sensory modality through which the cognitive system perceives its
 * environment.  In a data-workbench context the "senses" map to data
 * sources rather than biological receptors.
 */
export type SensoryModality =
	| 'schema'       // database schema perception
	| 'query'        // SQL / query observation
	| 'result'       // query-result data perception
	| 'file'         // workspace file-system awareness
	| 'interaction'; // user interaction (clicks, selections, navigation)

/**
 * A single sensory percept recorded by the embodied cognition layer.
 */
export interface SensoryPercept {
	/** Unique ID for this percept. */
	id: string;
	/** The modality that produced this percept. */
	modality: SensoryModality;
	/** Human-readable summary of the percept. */
	summary: string;
	/** Raw payload (schema JSON, SQL text, row data, etc.). */
	payload: string;
	/** Relevance / intensity in [0, 1]. */
	salience: number;
	/** Epoch-ms when the percept was captured. */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Motor action types
// ---------------------------------------------------------------------------

/**
 * Categories of motor actions the cognitive system can recommend or
 * execute on the workspace.
 */
export type MotorActionKind =
	| 'query_suggestion'    // suggest a SQL query to run
	| 'schema_recommendation' // recommend schema changes
	| 'insight'             // surface a data insight / pattern
	| 'navigation'          // suggest navigating to a resource
	| 'alert';              // raise an alert about data quality / health

/**
 * A motor action produced by the embodied cognition layer.
 */
export interface MotorAction {
	id: string;
	kind: MotorActionKind;
	/** Short description of the action. */
	label: string;
	/** Detailed payload (SQL text, JSON, markdown, etc.). */
	payload: string;
	/** Confidence that the action is appropriate in [0, 1]. */
	confidence: number;
	/** IDs of the sensory percepts that motivated this action. */
	sourcePercepts: string[];
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Proprioceptive state
// ---------------------------------------------------------------------------

/**
 * The system's self-model -- how the cognitive agent perceives its own
 * internal state (proprioception).
 */
export interface ProprioceptiveState {
	/** Current cognitive load in [0, 1]. */
	cognitiveLoad: number;
	/** Attentional focus description (null = unfocused). */
	attentionalFocus: string | null;
	/** Number of active sensory channels. */
	activeSensoryChannels: number;
	/** Number of pending motor actions. */
	pendingMotorActions: number;
	/** Overall embodiment health. */
	healthy: boolean;
	/** Timestamp of last proprioceptive update. */
	lastUpdate: number;
}

// ---------------------------------------------------------------------------
// Environmental model
// ---------------------------------------------------------------------------

/**
 * A snapshot of the workspace environment as perceived by the embodied
 * cognition layer.
 */
export interface EnvironmentSnapshot {
	/** Known database schemas (table/column summaries). */
	knownSchemas: string[];
	/** Recent query patterns observed. */
	recentQueryPatterns: string[];
	/** Active editor / file context. */
	activeContext: string | null;
	/** Total percepts captured in the current session. */
	totalPercepts: number;
	/** Total motor actions produced in the current session. */
	totalActions: number;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Embodied Cognition Service -- bridges the gap between abstract cognitive
 * processing and the concrete workspace environment.
 *
 * Implements the sensorimotor grounding loop:
 *   Perceive (sensory) --> Think (cognitive) --> Act (motor) --> Observe (proprioception)
 *
 * This is what makes the workbench *embodied* rather than purely symbolic.
 */
export interface IEmbodiedCognitionService {
	readonly _serviceBrand: undefined;

	/** Fired when a new sensory percept is captured. */
	readonly onDidPerceive: Event<SensoryPercept>;

	/** Fired when a motor action is produced. */
	readonly onDidAct: Event<MotorAction>;

	/** Fired when the proprioceptive state changes. */
	readonly onDidUpdateProprioception: Event<ProprioceptiveState>;

	// -- Sensory input -------------------------------------------------------

	/**
	 * Record a sensory percept from the environment.
	 * @param modality The sensory channel.
	 * @param summary Human-readable summary.
	 * @param payload Raw data payload.
	 * @param salience Optional relevance score (defaults to 0.5).
	 */
	perceive(modality: SensoryModality, summary: string, payload: string, salience?: number): SensoryPercept;

	/**
	 * Get recent percepts, optionally filtered by modality.
	 */
	getRecentPercepts(modality?: SensoryModality, limit?: number): SensoryPercept[];

	// -- Motor output --------------------------------------------------------

	/**
	 * Produce a motor action based on cognitive processing.
	 */
	act(kind: MotorActionKind, label: string, payload: string, confidence: number, sourcePercepts?: string[]): MotorAction;

	/**
	 * Get recent motor actions, optionally filtered by kind.
	 */
	getRecentActions(kind?: MotorActionKind, limit?: number): MotorAction[];

	// -- Proprioception ------------------------------------------------------

	/**
	 * Get the current proprioceptive state.
	 */
	getProprioceptiveState(): ProprioceptiveState;

	/**
	 * Set the current attentional focus (or null to unfocus).
	 */
	setAttentionalFocus(focus: string | null): void;

	// -- Environment ---------------------------------------------------------

	/**
	 * Get a snapshot of the environment as perceived by the embodied layer.
	 */
	getEnvironmentSnapshot(): EnvironmentSnapshot;

	/**
	 * Clear all sensory and motor history (reset embodiment).
	 */
	reset(): void;
}
