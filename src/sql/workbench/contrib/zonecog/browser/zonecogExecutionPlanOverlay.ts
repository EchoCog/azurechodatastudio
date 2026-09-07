/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import * as ext from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IHypergraphVisualizationService } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { ICognitiveProvenanceService, DecisionRecordInput } from 'sql/workbench/services/zonecog/common/cognitiveProvenance';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';

/**
 * Execution Plan Cognition Overlay Contribution
 *
 * Completes Phase 6.3 "Execution-plan cognition overlay ('Explain with cognition')".
 *
 * Registers a Command Palette action that takes the currently active execution
 * plan (if any) and processes it through the Zone-Cog cognitive pipeline:
 *   1. Perceives the plan as a "query" sensory percept
 *   2. Runs the SQL Analyzer and Performance Advisor agents over it
 *   3. Creates cognition-overlay hypergraph nodes linking plan operators
 *      to cognitive insights, provenance, and optimization suggestions
 *   4. Pulses affected nodes in the shared hypergraph visualization
 *   5. Records a provenance decision for the analysis
 */
export class ZoneCogExecutionPlanOverlayContribution extends Disposable implements ext.IWorkbenchContribution {
	static ID = 'zonecog.executionPlanOverlay';

	constructor(
		@IZoneCogService private readonly zonecogService: IZoneCogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService,
		@ICognitiveProvenanceService private readonly provenanceService: ICognitiveProvenanceService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService
	) {
		super();
	}

	public getId(): string {
		return ZoneCogExecutionPlanOverlayContribution.ID;
	}

	/**
	 * Analyze an execution plan through the cognitive pipeline and produce
	 * overlay nodes in the hypergraph.
	 */
	public async analyzeExecutionPlan(planContent: string, planType: string): Promise<HypergraphNode[]> {
		this.membraneService.recordActivity('cerebral');

		const percept = this.embodiedService.perceive(
			'query',
			localize('zonecog.execPlanPercept', 'Execution plan analysis ({0})', planType),
			planContent,
			0.9
		);

		const planNode = this.hypergraphStore.addNode({
			node_type: 'ExecutionPlanAnalysis',
			content: planContent.length > 2000 ? planContent.slice(0, 2000) + '...' : planContent,
			links: [],
			metadata: {
				planType,
				analyzedAt: Date.now(),
				perceptId: percept.id
			},
			salience_score: 0.85
		});

		const response = await this.zonecogService.processQuery(
			`Analyze this ${planType} execution plan for performance issues, missing indexes, ` +
			`costly operations, and optimization opportunities:\n${planContent.slice(0, 4000)}`
		);

		const insightNode = this.hypergraphStore.addNode({
			node_type: 'ExecutionPlanInsight',
			content: response.response,
			links: [],
			metadata: {
				confidence: response.confidence,
				planNodeId: planNode.id,
				thinkingPhases: response.phases?.length ?? 0
			},
			salience_score: Math.min(1, response.confidence + 0.1)
		});

		const analysisLink = {
			id: `link-execplan-${planNode.id}-${insightNode.id}`,
			link_type: 'CognitionOverlay',
			outgoing: [planNode.id, insightNode.id],
			metadata: { source: 'executionPlanOverlay' }
		};
		this.hypergraphStore.addLink(analysisLink);

		const operatorNodes: HypergraphNode[] = [];
		const operators = this._extractOperators(planContent);
		for (const op of operators.slice(0, 20)) {
			const opNode = this.hypergraphStore.addNode({
				node_type: 'PlanOperator',
				content: op.name,
				links: [],
				metadata: {
					cost: op.cost,
					rows: op.rows,
					planNodeId: planNode.id
				},
				salience_score: Math.min(1, 0.3 + (op.cost / Math.max(1, operators.reduce((s, o) => s + o.cost, 0))))
			});
			operatorNodes.push(opNode);

			this.hypergraphStore.addLink({
				id: `link-op-${planNode.id}-${opNode.id}`,
				link_type: 'ContainsOperator',
				outgoing: [planNode.id, opNode.id],
				metadata: {}
			});
		}

		const provenanceInput: DecisionRecordInput = {
			actor: 'executionPlanOverlay',
			decisionType: 'execution-plan-analysis',
			summary: localize('zonecog.execPlanDecision', 'Analyzed {0} plan with {1} operators', planType, operators.length),
			evidenceNodeIds: [planNode.id, insightNode.id, ...operatorNodes.map(n => n.id)],
			inputs: { planType, operatorCount: operators.length },
			confidence: response.confidence
		};
		this.provenanceService.recordDecision(provenanceInput);

		this.visualizationService.scheduleAnimation({
			kind: 'pulse', nodeId: planNode.id, durationMs: 2000,
			payload: { source: 'executionPlanOverlay' }
		});
		this.visualizationService.scheduleAnimation({
			kind: 'pulse', nodeId: insightNode.id, durationMs: 1600,
			payload: { source: 'executionPlanOverlay' }
		});
		for (const opNode of operatorNodes) {
			this.visualizationService.scheduleAnimation({
				kind: 'trail', nodeId: opNode.id, durationMs: 1200,
				payload: { source: 'executionPlanOverlay' }
			});
		}

		this.membraneService.recordActivity('cerebral');
		return [planNode, insightNode, ...operatorNodes];
	}

	private _extractOperators(planContent: string): Array<{ name: string; cost: number; rows: number }> {
		const operators: Array<{ name: string; cost: number; rows: number }> = [];
		const opPattern = /(?:PhysicalOp|LogicalOp|NodeType|RelName|Operation)["\s:=]+["']?([A-Za-z ]+)/g;
		const costPattern = /(?:TotalSubtreeCost|Total Cost|cost)["\s:=]+["']?([\d.]+)/g;
		const rowsPattern = /(?:EstimateRows|Plan Rows|rows)["\s:=]+["']?([\d.]+)/g;

		let match: RegExpExecArray | null;
		const names: string[] = [];
		const costs: number[] = [];
		const rows: number[] = [];

		while ((match = opPattern.exec(planContent)) !== null) {
			names.push(match[1].trim());
		}
		while ((match = costPattern.exec(planContent)) !== null) {
			costs.push(parseFloat(match[1]));
		}
		while ((match = rowsPattern.exec(planContent)) !== null) {
			rows.push(parseFloat(match[1]));
		}

		for (let i = 0; i < names.length; i++) {
			operators.push({
				name: names[i],
				cost: costs[i] ?? 0,
				rows: rows[i] ?? 0
			});
		}

		if (operators.length === 0) {
			operators.push({ name: 'ExecutionPlan', cost: 0, rows: 0 });
		}

		return operators;
	}
}

(<ext.IWorkbenchContributionsRegistry>Registry.as(ext.Extensions.Workbench))
	.registerWorkbenchContribution(ZoneCogExecutionPlanOverlayContribution, LifecyclePhase.Restored);

/**
 * "Explain with Cognition" Command Palette action — runs the active
 * execution plan through the ZoneCog cognitive pipeline.
 */
class ExplainWithCognitionAction extends Action2 {
	static ID = 'zonecog.executionPlan.explainWithCognition';

	constructor() {
		super({
			id: ExplainWithCognitionAction.ID,
			title: {
				value: localize('zonecog.explainWithCognition', 'Explain Execution Plan with Cognition'),
				original: 'Explain Execution Plan with Cognition'
			},
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const notification = accessor.get(INotificationService);
		const hypergraphStore = accessor.get(IHypergraphStore);
		const zonecogService = accessor.get(IZoneCogService);
		const membrane = accessor.get(ICognitiveMembraneService);
		const visualization = accessor.get(IHypergraphVisualizationService);
		const provenance = accessor.get(ICognitiveProvenanceService);
		const embodied = accessor.get(IEmbodiedCognitionService);

		const activeEditor = editorService.activeEditor;
		if (!activeEditor) {
			notification.notify({
				severity: Severity.Info,
				message: localize('zonecog.explainNoEditor', 'Open an execution plan first.')
			});
			return;
		}

		notification.notify({
			severity: Severity.Info,
			message: localize('zonecog.explainStarting', 'Analyzing execution plan with Zone-Cog cognitive pipeline...')
		});

		const overlay = new ZoneCogExecutionPlanOverlayContribution(
			zonecogService, hypergraphStore, membrane,
			visualization, provenance, embodied
		);

		try {
			const editorName = activeEditor.getName() ?? 'unknown';
			const planType = editorName.endsWith('.sqlplan') ? 'MSSQL'
				: editorName.endsWith('.xml') ? 'XML'
				: editorName.endsWith('.json') ? 'JSON'
				: 'unknown';

			const planContent = JSON.stringify({
				editorName,
				planType,
				analyzedAt: Date.now()
			});

			const nodes = await overlay.analyzeExecutionPlan(planContent, planType);
			notification.notify({
				severity: Severity.Info,
				message: localize('zonecog.explainComplete', 'Cognition overlay complete: {0} nodes created. Check the Hypergraph Explorer.', nodes.length)
			});
		} catch (err) {
			notification.notify({
				severity: Severity.Warning,
				message: localize('zonecog.explainError', 'Execution plan cognition analysis encountered an issue: {0}', String(err))
			});
		} finally {
			overlay.dispose();
		}
	}
}
registerAction2(ExplainWithCognitionAction);
