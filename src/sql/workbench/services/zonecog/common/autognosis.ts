/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IAutognosisService = createDecorator<IAutognosisService>('autognosisService');

// ---------------------------------------------------------------------------
// Self-assessment types
// ---------------------------------------------------------------------------

/**
 * Overall self-assessed health verdict.
 */
export type AutognosisVerdict = 'nominal' | 'degraded' | 'critical';

/**
 * A single subsystem's contribution to a self-assessment, as observed by
 * the Autognosis service (not measured directly -- it reads the subsystem's
 * own reported state).
 */
export interface SubsystemObservation {
	/** Subsystem identifier, e.g. a membrane triad name or "embodiment". */
	subsystem: string;
	healthy: boolean;
	/** Human-readable detail backing the healthy/unhealthy verdict. */
	detail: string;
}

/**
 * A point-in-time self-assessment: the cognitive system's introspective
 * read of its own health, synthesized from the membrane, embodiment, and
 * analytics subsystems.
 */
export interface SelfAssessment {
	/** Stable hypergraph node id of this assessment. */
	id: string;
	timestamp: number;
	verdict: AutognosisVerdict;
	/** Self-reported confidence in own reliability, in [0, 1]. */
	selfConfidence: number;
	/** Human-readable, first-person reflective summary. */
	narrative: string;
	observations: SubsystemObservation[];
	/** Short descriptions of anomalies detected during this assessment. */
	anomalies: string[];
}

/**
 * Directional trend across recent self-assessments.
 */
export type AutognosisTrend = 'improving' | 'stable' | 'degrading';

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Autognosis service.
 *
 * Closes the "Autognosis self-monitoring capabilities" roadmap item
 * (Phase 5.3): a meta-cognitive layer that periodically reflects on the
 * cognitive system's *own* state by synthesizing signals already reported
 * by other subsystems (membrane triad health, embodiment proprioception,
 * and cognitive analytics) into a single self-assessment with a verdict,
 * a self-confidence score, a first-person narrative, and any detected
 * anomalies. It does not re-measure raw signals itself -- it interprets
 * what the rest of the system already reports about itself.
 *
 * The service self-wires to `IZoneCogService.onDidProcessQuery`, so every
 * completed query triggers a fresh self-assessment automatically;
 * `performSelfAssessment` can also be invoked directly (e.g. from the
 * Command Palette).
 */
export interface IAutognosisService {
	readonly _serviceBrand: undefined;

	/** Fired whenever a self-assessment completes. */
	readonly onDidCompleteSelfAssessment: Event<SelfAssessment>;

	/**
	 * Synthesize a fresh self-assessment from current subsystem state,
	 * persist it as a SelfAssessment hypergraph node, append it to the
	 * bounded history, and fire `onDidCompleteSelfAssessment`.
	 */
	performSelfAssessment(): SelfAssessment;

	/** The most recent self-assessment, if any has been performed. */
	getLatestAssessment(): SelfAssessment | undefined;

	/** Retained self-assessment history, most recent first. */
	getAssessmentHistory(limit?: number): SelfAssessment[];

	/**
	 * Directional trend in self-confidence across the retained history.
	 * Returns 'stable' when fewer than two assessments have been recorded.
	 */
	getTrend(): AutognosisTrend;

	/** Clear the assessment history and remove persisted SelfAssessment nodes. */
	reset(): void;
}
