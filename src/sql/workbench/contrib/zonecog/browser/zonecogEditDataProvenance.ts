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

import { IHypergraphVisualizationService } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveProvenanceService } from 'sql/workbench/services/zonecog/common/cognitiveProvenance';

/**
 * Edit Data Provenance-Linked Cell-Edit Nodes Contribution
 *
 * Completes Phase 6.3 "Edit Data provenance-linked cell-edit nodes".
 *
 * Tracks Edit Data cell edits as provenance-linked hypergraph nodes:
 *   - Each cell edit creates a `CellEdit` hypergraph node recording the
 *     table, column, row, old value, and new value
 *   - Edits are linked to their parent table node (if perceived) via
 *     a `ProvenanceEdit` link
 *   - Commit/revert operations create `EditCommit`/`EditRevert` nodes
 *     linked to all affected cell-edit nodes
 *   - Each mutation is recorded as a cognitive provenance decision
 *   - Pulse animations mark the affected nodes in the visualization
 */
export class ZoneCogEditDataProvenanceContribution extends Disposable implements ext.IWorkbenchContribution {
	static ID = 'zonecog.editDataProvenance';

	private _sessionEdits = new Map<string, string[]>();

	constructor(
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService,
		@ICognitiveProvenanceService private readonly provenanceService: ICognitiveProvenanceService
	) {
		super();
	}

	public getId(): string {
		return ZoneCogEditDataProvenanceContribution.ID;
	}

	/**
	 * Record a single cell edit in the hypergraph with provenance tracking.
	 */
	public recordCellEdit(params: CellEditParams): HypergraphNode {
		this.membraneService.recordActivity('somatic');

		const editNode = this.hypergraphStore.addNode({
			node_type: 'CellEdit',
			content: localize(
				'zonecog.cellEditContent',
				'{0}.{1} row {2}: {3} -> {4}',
				params.tableName, params.columnName, params.rowId,
				this._truncate(params.oldValue ?? 'NULL', 50),
				this._truncate(params.newValue ?? 'NULL', 50)
			),
			links: [],
			metadata: {
				ownerUri: params.ownerUri,
				tableName: params.tableName,
				schemaName: params.schemaName,
				columnName: params.columnName,
				rowId: params.rowId,
				columnId: params.columnId,
				oldValue: params.oldValue,
				newValue: params.newValue,
				editedAt: Date.now()
			},
			salience_score: 0.6
		});

		const tableNodes = this.hypergraphStore.getAllNodes().filter(
			n => n.node_type === 'TableNode' && n.content.includes(params.tableName)
		);
		for (const tableNode of tableNodes) {
			this.hypergraphStore.addLink({
				id: `link-edit-${editNode.id}-${tableNode.id}`,
				link_type: 'ProvenanceEdit',
				outgoing: [tableNode.id, editNode.id],
				metadata: {}
			});
		}

		const sessionKey = params.ownerUri;
		if (!this._sessionEdits.has(sessionKey)) {
			this._sessionEdits.set(sessionKey, []);
		}
		this._sessionEdits.get(sessionKey)!.push(editNode.id);

		this.provenanceService.recordDecision({
			actor: 'editDataProvenance',
			decisionType: 'cell-edit',
			summary: localize(
				'zonecog.cellEditDecision',
				'Cell edit: {0}.{1}[{2}].{3}',
				params.schemaName, params.tableName, params.rowId, params.columnName
			),
			evidenceNodeIds: [editNode.id, ...tableNodes.map(n => n.id)],
			inputs: {
				tableName: params.tableName,
				columnName: params.columnName,
				rowId: params.rowId
			},
			confidence: 1.0
		});

		this.embodiedService.perceive(
			'interaction',
			localize('zonecog.cellEditPercept', 'Edited {0}.{1}[{2}]', params.tableName, params.columnName, params.rowId),
			JSON.stringify({
				tableName: params.tableName,
				columnName: params.columnName,
				rowId: params.rowId,
				oldValue: params.oldValue,
				newValue: params.newValue
			}),
			0.6
		);

		this.visualizationService.scheduleAnimation({
			kind: 'pulse', nodeId: editNode.id, durationMs: 1000,
			payload: { source: 'editDataProvenance' }
		});

		return editNode;
	}

	/**
	 * Record a row creation in the hypergraph.
	 */
	public recordRowCreate(params: { ownerUri: string; tableName: string; schemaName: string; newRowId: number }): HypergraphNode {
		this.membraneService.recordActivity('somatic');

		const node = this.hypergraphStore.addNode({
			node_type: 'RowCreate',
			content: localize('zonecog.rowCreateContent', 'New row {0} in {1}.{2}', params.newRowId, params.schemaName, params.tableName),
			links: [],
			metadata: {
				ownerUri: params.ownerUri,
				tableName: params.tableName,
				schemaName: params.schemaName,
				newRowId: params.newRowId,
				createdAt: Date.now()
			},
			salience_score: 0.65
		});

		const sessionKey = params.ownerUri;
		if (!this._sessionEdits.has(sessionKey)) {
			this._sessionEdits.set(sessionKey, []);
		}
		this._sessionEdits.get(sessionKey)!.push(node.id);

		this.visualizationService.scheduleAnimation({
			kind: 'pulse', nodeId: node.id, durationMs: 1200,
			payload: { source: 'editDataProvenance', type: 'rowCreate' }
		});

		return node;
	}

	/**
	 * Record a row deletion in the hypergraph.
	 */
	public recordRowDelete(params: { ownerUri: string; tableName: string; schemaName: string; rowId: number }): HypergraphNode {
		this.membraneService.recordActivity('somatic');

		const node = this.hypergraphStore.addNode({
			node_type: 'RowDelete',
			content: localize('zonecog.rowDeleteContent', 'Deleted row {0} from {1}.{2}', params.rowId, params.schemaName, params.tableName),
			links: [],
			metadata: {
				ownerUri: params.ownerUri,
				tableName: params.tableName,
				schemaName: params.schemaName,
				rowId: params.rowId,
				deletedAt: Date.now()
			},
			salience_score: 0.7
		});

		const sessionKey = params.ownerUri;
		if (!this._sessionEdits.has(sessionKey)) {
			this._sessionEdits.set(sessionKey, []);
		}
		this._sessionEdits.get(sessionKey)!.push(node.id);

		this.visualizationService.scheduleAnimation({
			kind: 'decay', nodeId: node.id, durationMs: 1400,
			payload: { source: 'editDataProvenance', type: 'rowDelete' }
		});

		return node;
	}

	/**
	 * Record a commit of all pending edits for a session.
	 */
	public recordCommit(ownerUri: string, tableName: string, schemaName: string): HypergraphNode | undefined {
		const editNodeIds = this._sessionEdits.get(ownerUri);
		if (!editNodeIds || editNodeIds.length === 0) {
			return undefined;
		}

		this.membraneService.recordActivity('cerebral');

		const commitNode = this.hypergraphStore.addNode({
			node_type: 'EditCommit',
			content: localize('zonecog.commitContent', 'Committed {0} edits to {1}.{2}', editNodeIds.length, schemaName, tableName),
			links: [],
			metadata: {
				ownerUri,
				tableName,
				schemaName,
				editCount: editNodeIds.length,
				committedAt: Date.now()
			},
			salience_score: 0.8
		});

		for (const editId of editNodeIds) {
			this.hypergraphStore.addLink({
				id: `link-commit-${commitNode.id}-${editId}`,
				link_type: 'CommittedEdit',
				outgoing: [commitNode.id, editId],
				metadata: {}
			});
		}

		this.provenanceService.recordDecision({
			actor: 'editDataProvenance',
			decisionType: 'edit-commit',
			summary: localize('zonecog.commitDecision', 'Committed {0} edits to {1}.{2}', editNodeIds.length, schemaName, tableName),
			evidenceNodeIds: [commitNode.id, ...editNodeIds],
			inputs: { tableName, editCount: editNodeIds.length },
			confidence: 1.0
		});

		this.visualizationService.scheduleAnimation({
			kind: 'pulse', nodeId: commitNode.id, durationMs: 2000,
			payload: { source: 'editDataProvenance', type: 'commit' }
		});

		this._sessionEdits.delete(ownerUri);
		return commitNode;
	}

	/**
	 * Record a revert of all pending edits for a session.
	 */
	public recordRevert(ownerUri: string, tableName: string, schemaName: string): HypergraphNode | undefined {
		const editNodeIds = this._sessionEdits.get(ownerUri);
		if (!editNodeIds || editNodeIds.length === 0) {
			return undefined;
		}

		this.membraneService.recordActivity('cerebral');

		const revertNode = this.hypergraphStore.addNode({
			node_type: 'EditRevert',
			content: localize('zonecog.revertContent', 'Reverted {0} edits on {1}.{2}', editNodeIds.length, schemaName, tableName),
			links: [],
			metadata: {
				ownerUri,
				tableName,
				schemaName,
				editCount: editNodeIds.length,
				revertedAt: Date.now()
			},
			salience_score: 0.6
		});

		for (const editId of editNodeIds) {
			this.hypergraphStore.addLink({
				id: `link-revert-${revertNode.id}-${editId}`,
				link_type: 'RevertedEdit',
				outgoing: [revertNode.id, editId],
				metadata: {}
			});
		}

		this.visualizationService.scheduleAnimation({
			kind: 'decay', nodeId: revertNode.id, durationMs: 1600,
			payload: { source: 'editDataProvenance', type: 'revert' }
		});

		this._sessionEdits.delete(ownerUri);
		return revertNode;
	}

	private _truncate(s: string, max: number): string {
		return s.length <= max ? s : s.slice(0, max) + '...';
	}
}

/**
 * Parameters for recording a cell edit in the hypergraph.
 */
export interface CellEditParams {
	ownerUri: string;
	tableName: string;
	schemaName: string;
	columnName: string;
	rowId: number;
	columnId: number;
	oldValue: string | undefined;
	newValue: string | undefined;
}

(<ext.IWorkbenchContributionsRegistry>Registry.as(ext.Extensions.Workbench))
	.registerWorkbenchContribution(ZoneCogEditDataProvenanceContribution, LifecyclePhase.Restored);

/**
 * Command Palette action to show edit data provenance for the current
 * table in the hypergraph.
 */
class ShowEditDataProvenanceAction extends Action2 {
	static ID = 'zonecog.editData.showProvenance';

	constructor() {
		super({
			id: ShowEditDataProvenanceAction.ID,
			title: {
				value: localize('zonecog.showEditProvenance', 'Show Edit Data Provenance in Hypergraph'),
				original: 'Show Edit Data Provenance in Hypergraph'
			},
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const hypergraphStore = accessor.get(IHypergraphStore);
		const visualization = accessor.get(IHypergraphVisualizationService);
		const notification = accessor.get(INotificationService);

		const editNodes = [
			...hypergraphStore.getNodesByType('CellEdit'),
			...hypergraphStore.getNodesByType('RowCreate'),
			...hypergraphStore.getNodesByType('RowDelete'),
			...hypergraphStore.getNodesByType('EditCommit'),
			...hypergraphStore.getNodesByType('EditRevert')
		];

		if (editNodes.length === 0) {
			notification.notify({
				severity: Severity.Info,
				message: localize('zonecog.noEditProvenance', 'No edit data provenance nodes in the hypergraph yet. Edit some table data first.')
			});
			return;
		}

		const latest = editNodes.sort((a, b) =>
			Number(b.metadata['editedAt'] ?? b.metadata['committedAt'] ?? b.metadata['revertedAt'] ?? b.metadata['createdAt'] ?? b.metadata['deletedAt'] ?? 0) -
			Number(a.metadata['editedAt'] ?? a.metadata['committedAt'] ?? a.metadata['revertedAt'] ?? a.metadata['createdAt'] ?? a.metadata['deletedAt'] ?? 0)
		)[0];

		visualization.focusNode(latest.id, 'editDataProvenance');
		notification.notify({
			severity: Severity.Info,
			message: localize('zonecog.editProvenanceFound', 'Found {0} edit provenance nodes. Focused on latest: {1}', editNodes.length, latest.content.slice(0, 80))
		});
	}
}
registerAction2(ShowEditDataProvenanceAction);
