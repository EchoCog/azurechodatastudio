/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IAutognosisService,
	SelfAssessment,
	SubsystemObservation,
	AutognosisVerdict,
	AutognosisTrend
} from 'sql/workbench/services/zonecog/common/autognosis';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveAnalyticsService } from 'sql/workbench/services/zonecog/common/cognitiveAnalytics';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/** Maximum number of self-assessments retained in the bounded history. */
const MAX_HISTORY = 200;

/** Node type used for persisted self-assessments in the hypergraph store. */
const ASSESSMENT_NODE_TYPE = 'SelfAssessment';

/** Salience assigned to persisted assessment nodes per verdict. */
const VERDICT_SALIENCE: Record<AutognosisVerdict, number> = {
	nominal: 0.3,
	degraded: 0.6,
	critical: 0.9
};

/** Cognitive load above this threshold is flagged as an anomaly. */
const HIGH_LOAD_THRESHOLD = 0.85;

/** Fraction of LLM requests served by fallback above which is flagged as an anomaly. */
const HIGH_FALLBACK_RATIO_THRESHOLD = 0.5;

/** Minimum LLM request count before the fallback-ratio anomaly check applies. */
const MIN_REQUESTS_FOR_FALLBACK_CHECK = 5;

/** Number of most-recent assessments considered when computing the trend. */
const TREND_WINDOW = 5;

let assessmentIdCounter = 0;

function assessmentId(): string {
	return `self-assessment-${Date.now()}-${++assessmentIdCounter}`;
}

/**
 * Implementation of the Autognosis service.
 *
 * Synthesizes a first-person self-assessment from the membrane, embodiment,
 * and analytics subsystems' own reported state, rather than re-measuring
 * anything directly. Self-wires to `IZoneCogService.onDidProcessQuery` so
 * every completed query triggers a fresh assessment.
 */
export class AutognosisService extends Disposable implements IAutognosisService {

	declare readonly _serviceBrand: undefined;

	private readonly _history: SelfAssessment[] = [];

	private readonly _onDidCompleteSelfAssessment = this._register(new Emitter<SelfAssessment>());
	readonly onDidCompleteSelfAssessment: Event<SelfAssessment> = this._onDidCompleteSelfAssessment.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService,
		@ICognitiveAnalyticsService private readonly analyticsService: ICognitiveAnalyticsService,
		@IZoneCogService zonecogService: IZoneCogService
	) {
		super();
		this._register(zonecogService.onDidProcessQuery(() => this.performSelfAssessment()));
		this.logService.info('AutognosisService: initialized self-monitoring');
	}

	// -- Self-assessment ---------------------------------------------------------

	performSelfAssessment(): SelfAssessment {
		this.membraneService.recordActivity('autonomic');

		const observations = this._collectObservations();
		const anomalies = this._detectAnomalies();
		const verdict = this._computeVerdict(observations, anomalies);
		const selfConfidence = this._computeSelfConfidence(observations, anomalies);
		const narrative = this._buildNarrative(verdict, observations, anomalies);

		const assessment: SelfAssessment = {
			id: assessmentId(),
			timestamp: Date.now(),
			verdict,
			selfConfidence,
			narrative,
			observations,
			anomalies
		};

		this._history.unshift(assessment);
		while (this._history.length > MAX_HISTORY) {
			const evicted = this._history.pop();
			if (evicted) {
				this.hypergraphStore.removeNode(evicted.id);
			}
		}

		this._persistAssessment(assessment);
		this.logService.info(`AutognosisService: self-assessment ${verdict} (confidence ${selfConfidence.toFixed(2)}, ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'})`);
		this._onDidCompleteSelfAssessment.fire(assessment);
		return assessment;
	}

	getLatestAssessment(): SelfAssessment | undefined {
		return this._history[0];
	}

	getAssessmentHistory(limit?: number): SelfAssessment[] {
		return limit !== undefined && limit >= 0 ? this._history.slice(0, limit) : this._history.slice();
	}

	getTrend(): AutognosisTrend {
		const window = this._history.slice(0, TREND_WINDOW);
		if (window.length < 2) {
			return 'stable';
		}
		// window[0] is most recent, window[window.length - 1] is oldest in the window.
		const delta = window[0].selfConfidence - window[window.length - 1].selfConfidence;
		if (delta > 0.05) {
			return 'improving';
		}
		if (delta < -0.05) {
			return 'degrading';
		}
		return 'stable';
	}

	reset(): void {
		for (const assessment of this._history) {
			this.hypergraphStore.removeNode(assessment.id);
		}
		this._history.length = 0;
		this.logService.info('AutognosisService: assessment history reset');
	}

	// -- Internals ------------------------------------------------------------------------

	private _collectObservations(): SubsystemObservation[] {
		const observations: SubsystemObservation[] = this.membraneService.getAllStatuses().map(status => ({
			subsystem: status.triad,
			healthy: status.healthy,
			detail: `${status.errorCount} error(s), ${status.activeProcesses} activit${status.activeProcesses === 1 ? 'y' : 'ies'} recorded`
		}));

		const proprioception = this.embodiedService.getProprioceptiveState();
		observations.push({
			subsystem: 'embodiment',
			healthy: proprioception.healthy,
			detail: `cognitive load ${(proprioception.cognitiveLoad * 100).toFixed(0)}%, focus=${proprioception.attentionalFocus ?? 'none'}`
		});

		return observations;
	}

	private _detectAnomalies(): string[] {
		const anomalies: string[] = [];

		const proprioception = this.embodiedService.getProprioceptiveState();
		if (proprioception.cognitiveLoad > HIGH_LOAD_THRESHOLD) {
			anomalies.push(`sustained high cognitive load (${(proprioception.cognitiveLoad * 100).toFixed(0)}%)`);
		}

		const snapshot = this.analyticsService.getSnapshot();

		const tokens = snapshot.tokenEconomics;
		if (tokens.requestCount >= MIN_REQUESTS_FOR_FALLBACK_CHECK
			&& (tokens.fallbackCount / tokens.requestCount) > HIGH_FALLBACK_RATIO_THRESHOLD) {
			anomalies.push('most LLM requests are being served by the built-in fallback provider');
		}

		const dtesn = snapshot.dtesnConvergence;
		if (dtesn.trainingRuns > 1 && !dtesn.converging) {
			anomalies.push('DTESN readout training is not converging');
		}

		return anomalies;
	}

	private _computeVerdict(observations: SubsystemObservation[], anomalies: string[]): AutognosisVerdict {
		if (observations.some(o => !o.healthy)) {
			return 'critical';
		}
		if (anomalies.length > 0) {
			return 'degraded';
		}
		return 'nominal';
	}

	private _computeSelfConfidence(observations: SubsystemObservation[], anomalies: string[]): number {
		// The embodiment observation's `healthy` flag is itself derived from
		// overall membrane health (see EmbodiedCognitionService.getProprioceptiveState),
		// so it carries no information beyond the membrane triads already in
		// `observations` -- counting it here would double-penalize the same
		// root cause (one unhealthy triad would otherwise cost 0.4, not 0.2).
		const unhealthyCount = observations.filter(o => o.subsystem !== 'embodiment' && !o.healthy).length;
		const confidence = 1 - (unhealthyCount * 0.2) - (anomalies.length * 0.1);
		return Math.max(0, Math.min(1, confidence));
	}

	private _buildNarrative(verdict: AutognosisVerdict, observations: SubsystemObservation[], anomalies: string[]): string {
		const unhealthy = observations.filter(o => !o.healthy).map(o => o.subsystem);

		if (verdict === 'nominal') {
			return 'I am functioning normally: all monitored subsystems report healthy and no anomalies were detected.';
		}

		const parts: string[] = [];
		if (unhealthy.length > 0) {
			parts.push(`the following subsystem(s) report unhealthy: ${unhealthy.join(', ')}`);
		}
		if (anomalies.length > 0) {
			parts.push(`I have detected ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'}: ${anomalies.join('; ')}`);
		}

		const prefix = verdict === 'critical'
			? 'I am in a critical state.'
			: 'I am degraded but still operating.';
		return `${prefix} ${parts.join(', and ')}.`;
	}

	private _persistAssessment(assessment: SelfAssessment): void {
		this.hypergraphStore.addNode({
			id: assessment.id,
			node_type: ASSESSMENT_NODE_TYPE,
			content: assessment.narrative,
			links: [],
			metadata: {
				verdict: assessment.verdict,
				selfConfidence: assessment.selfConfidence,
				anomalies: assessment.anomalies,
				observations: assessment.observations,
				timestamp: assessment.timestamp
			},
			salience_score: VERDICT_SALIENCE[assessment.verdict]
		});
	}
}
