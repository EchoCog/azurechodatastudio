/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lifecycle from 'vs/base/common/lifecycle';
import * as ext from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { localize } from 'vs/nls';
import { Action2, MenuId, MenuRegistry, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IPaneCompositePartService } from 'vs/workbench/services/panecomposite/browser/panecomposite';
import { ViewContainerLocation } from 'vs/workbench/common/views';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { VSBuffer } from 'vs/base/common/buffer';

import { IConnectionManagementService } from 'sql/platform/connection/common/connectionManagement';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { IHypergraphVisualizationService } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { IHypergraphSemanticSearchService } from 'sql/workbench/services/zonecog/common/hypergraphSemanticSearch';
import { ZONECOG_CONTAINER_ID, ZONECOG_HYPERGRAPH_VIEW_ID } from 'sql/workbench/contrib/zonecog/common/zonecog';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';

/**
 * ZoneCog Host Integration Contribution - perceives real Data Studio host
 * activity into the hypergraph: connection lifecycle events become
 * SensoryPercept nodes, editor activations become interaction percepts, and
 * every perceived event schedules a pulse animation so the shared
 * visualizations flare in response to workbench activity.
 */
export class ZoneCogHostIntegrationContribution extends lifecycle.Disposable implements ext.IWorkbenchContribution {
	static ID = 'zonecog.hostIntegration';

	private _lastEditorPercept = 0;

	constructor(
		@IConnectionManagementService private readonly connectionService: IConnectionManagementService,
		@IEditorService private readonly editorService: IEditorService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super();

		// Connection lifecycle -> sensory percepts + percept pulses
		this._register(this.connectionService.onConnect(params => {
			this.membraneService.recordActivity('somatic');
			const profile = params.connectionProfile;
			const percept = this.embodiedService.perceive(
				'interaction',
				localize('zonecog.perceiveConnect', 'Connected to {0}', profile?.serverName ?? params.connectionUri),
				JSON.stringify({ connectionUri: params.connectionUri, server: profile?.serverName, database: profile?.databaseName }),
				0.8
			);
			this._pulsePercept(percept.id);
		}));

		this._register(this.connectionService.onDisconnect(params => {
			this.membraneService.recordActivity('somatic');
			const percept = this.embodiedService.perceive(
				'interaction',
				localize('zonecog.perceiveDisconnect', 'Disconnected from {0}', params.connectionUri),
				JSON.stringify({ connectionUri: params.connectionUri }),
				0.5
			);
			this._pulsePercept(percept.id);
		}));

		// Editor activation -> interaction percepts (throttled to avoid noise)
		this._register(this.editorService.onDidActiveEditorChange(() => {
			const now = Date.now();
			if (now - this._lastEditorPercept < 5000) {
				return;
			}
			this._lastEditorPercept = now;
			const active = this.editorService.activeEditor;
			if (!active) {
				return;
			}
			this.membraneService.recordActivity('somatic');
			const percept = this.embodiedService.perceive(
				'interaction',
				localize('zonecog.perceiveEditor', 'Activated editor {0}', active.getName()),
				JSON.stringify({ editor: active.getName(), typeId: active.getTypeId() }),
				0.4
			);
			this._pulsePercept(percept.id);
		}));
	}

	private _pulsePercept(perceptId: string): void {
		// The embodied service persists percepts as SensoryPercept hypergraph
		// nodes; pulse the most recent one in the shared views.
		const percepts = this.hypergraphStore.getNodesByType('SensoryPercept');
		const latest = percepts.sort((a, b) =>
			Number(b.metadata['timestamp'] ?? 0) - Number(a.metadata['timestamp'] ?? 0))[0];
		if (latest) {
			this.visualizationService.scheduleAnimation({
				kind: 'pulse', nodeId: latest.id, durationMs: 1400,
				payload: { source: 'hostIntegration', perceptId }
			});
		}
	}

	public getId(): string {
		return ZoneCogHostIntegrationContribution.ID;
	}
}

(<ext.IWorkbenchContributionsRegistry>Registry.as(ext.Extensions.Workbench))
	.registerWorkbenchContribution(ZoneCogHostIntegrationContribution, LifecyclePhase.Restored);

// ---------------------------------------------------------------------------
// Command Palette actions: cross-view focus + visualization snapshot export
// ---------------------------------------------------------------------------

/**
 * Focus a hypergraph node across all views ("Show in Hypergraph"). Accepts
 * an optional node id argument; otherwise prompts via semantic search.
 */
class FocusHypergraphNodeAction extends Action2 {
	static ID = 'zonecog.focusNode';

	constructor() {
		super({
			id: FocusHypergraphNodeAction.ID,
			title: { value: localize('zonecog.focusNode', 'Show Node in Hypergraph'), original: 'Show Node in Hypergraph' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor, nodeId?: string): Promise<void> {
		const visualization = accessor.get(IHypergraphVisualizationService);
		const semanticSearch = accessor.get(IHypergraphSemanticSearchService);
		const quickInput = accessor.get(IQuickInputService);
		const paneComposite = accessor.get(IPaneCompositePartService);
		const viewsService = accessor.get(IViewsService);
		const notification = accessor.get(INotificationService);

		let targetId = nodeId;
		if (!targetId) {
			const query = await quickInput.input({
				prompt: localize('zonecog.focusNodePrompt', 'Describe or name the hypergraph node to focus'),
				placeHolder: localize('zonecog.focusNodePlaceholder', 'e.g. the users table schema')
			});
			if (!query) {
				return;
			}
			const results = await semanticSearch.search(query, 5);
			if (results.length === 0) {
				notification.notify({ severity: Severity.Info, message: localize('zonecog.focusNodeNone', 'No hypergraph nodes matched "{0}"', query) });
				return;
			}
			const picks = results.map(r => ({
				label: r.node.content.length > 60 ? `${r.node.content.slice(0, 60)}…` : r.node.content,
				description: `${r.node.node_type} · ${r.score.toFixed(2)}`,
				id: r.node.id
			}));
			const pick = await quickInput.pick(picks, { placeHolder: localize('zonecog.focusNodePick', 'Select the node to focus') });
			if (!pick) {
				return;
			}
			targetId = pick.id;
		}

		// Open the Zone-Cog panel and focus the node across all views.
		await paneComposite.openPaneComposite(ZONECOG_CONTAINER_ID, ViewContainerLocation.Panel, true);
		await viewsService.openView(ZONECOG_HYPERGRAPH_VIEW_ID, true);
		visualization.focusNode(targetId, 'focusNodeCommand');
	}
}
registerAction2(FocusHypergraphNodeAction);

/**
 * Export the current hypergraph subgraph as JSON (nodes + links + layout).
 */
class ExportHypergraphSnapshotAction extends Action2 {
	static ID = 'zonecog.visualize.exportSnapshot';

	constructor() {
		super({
			id: ExportHypergraphSnapshotAction.ID,
			title: { value: localize('zonecog.exportSnapshot', 'Export Hypergraph Snapshot (JSON)'), original: 'Export Hypergraph Snapshot (JSON)' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const hypergraphStore = accessor.get(IHypergraphStore);
		const visualization = accessor.get(IHypergraphVisualizationService);
		const fileDialog = accessor.get(IFileDialogService);
		const fileService = accessor.get(IFileService);
		const membrane = accessor.get(ICognitiveMembraneService);

		membrane.recordActivity('somatic');
		const layout = new Map(visualization.getSimNodes().map(n => [n.node.id, { x: n.x, y: n.y }]));
		const snapshot = {
			formatVersion: 1,
			exportedAt: Date.now(),
			nodes: hypergraphStore.getAllNodes().map(n => ({ ...n, layout: layout.get(n.id) })),
			links: visualization.getSimEdges().map(e => e.link)
		};

		const target = await fileDialog.showSaveDialog({
			title: localize('zonecog.exportSnapshotTitle', 'Export Hypergraph Snapshot'),
			filters: { 'JSON': ['json'] },
			defaultUri: URI.file(`hypergraph-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`)
		});
		if (!target) {
			return;
		}
		await fileService.writeFile(target, VSBuffer.fromString(JSON.stringify(snapshot, null, 2)));
		membrane.recordActivity('cerebral');
	}
}
registerAction2(ExportHypergraphSnapshotAction);

/**
 * Export the hypergraph explorer canvas as a PNG image.
 */
class ExportHypergraphImageAction extends Action2 {
	static ID = 'zonecog.visualize.exportImage';

	constructor() {
		super({
			id: ExportHypergraphImageAction.ID,
			title: { value: localize('zonecog.exportImage', 'Export Hypergraph Image (PNG)'), original: 'Export Hypergraph Image (PNG)' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileDialog = accessor.get(IFileDialogService);
		const fileService = accessor.get(IFileService);
		const membrane = accessor.get(ICognitiveMembraneService);
		const notification = accessor.get(INotificationService);

		membrane.recordActivity('somatic');
		const canvas = document.querySelector<HTMLCanvasElement>('canvas.zonecog-hypergraph-canvas');
		if (!canvas) {
			notification.notify({ severity: Severity.Info, message: localize('zonecog.exportImageNone', 'Open the Hypergraph Explorer view first to capture an image.') });
			return;
		}
		const target = await fileDialog.showSaveDialog({
			title: localize('zonecog.exportImageTitle', 'Export Hypergraph Image'),
			filters: { 'PNG Image': ['png'] },
			defaultUri: URI.file(`hypergraph-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`)
		});
		if (!target) {
			return;
		}
		const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
		if (!blob) {
			notification.notify({ severity: Severity.Error, message: localize('zonecog.exportImageFailed', 'Failed to capture the hypergraph canvas.') });
			return;
		}
		await fileService.writeFile(target, VSBuffer.wrap(new Uint8Array(await blob.arrayBuffer())));
	}
}
registerAction2(ExportHypergraphImageAction);

/**
 * Toggle low-power mode for all hypergraph visualizations (suspends the
 * continuous animation clock; simulation still ticks on data changes).
 */
class ToggleLowPowerModeAction extends Action2 {
	static ID = 'zonecog.visualize.toggleLowPower';

	constructor() {
		super({
			id: ToggleLowPowerModeAction.ID,
			title: { value: localize('zonecog.toggleLowPower', 'Toggle Visualization Low-Power Mode'), original: 'Toggle Visualization Low-Power Mode' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const visualization = accessor.get(IHypergraphVisualizationService);
		const notification = accessor.get(INotificationService);
		const enabled = !visualization.isLowPowerMode();
		visualization.setLowPowerMode(enabled);
		notification.notify({
			severity: Severity.Info,
			message: enabled
				? localize('zonecog.lowPowerOn', 'Zone-Cog visualization low-power mode ON - continuous animations suspended.')
				: localize('zonecog.lowPowerOff', 'Zone-Cog visualization low-power mode OFF - animations active.')
		});
	}
}
registerAction2(ToggleLowPowerModeAction);

/**
 * Open a specific Zone-Cog visualization view by id (used by host-feature
 * integrations to deep-link into a mode).
 */
class OpenVisualizationViewAction extends Action2 {
	static ID = 'zonecog.visualize.openView';

	constructor() {
		super({
			id: OpenVisualizationViewAction.ID,
			title: { value: localize('zonecog.openVizView', 'Open Visualization View'), original: 'Open Visualization View' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: true,
			menu: { id: MenuId.CommandPalette }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const paneComposite = accessor.get(IPaneCompositePartService);
		const viewsService = accessor.get(IViewsService);

		const views: Array<{ label: string; id: string }> = [
			{ label: localize('zonecog.vizHypergraph', 'Hypergraph Explorer'), id: ZONECOG_HYPERGRAPH_VIEW_ID },
			{ label: localize('zonecog.vizHeatmap', 'Attention Heatmap'), id: 'zonecog.attentionHeatmapView' },
			{ label: localize('zonecog.vizTimeline', 'Thinking Timeline'), id: 'zonecog.thinkingTimelineView' },
			{ label: localize('zonecog.vizMembranes', 'Membrane Triads'), id: 'zonecog.membraneDiagramView' },
			{ label: localize('zonecog.vizEpisodes', 'Episode Timeline'), id: 'zonecog.episodeTimelineView' },
			{ label: localize('zonecog.vizReservoir', 'DTESN Reservoir'), id: 'zonecog.reservoirView' },
			{ label: localize('zonecog.vizAAR', 'AAR Graph'), id: 'zonecog.aarGraphView' },
			{ label: localize('zonecog.vizProvenance', 'Provenance Chains'), id: 'zonecog.provenanceView' },
			{ label: localize('zonecog.vizInference', 'PLN Inference'), id: 'zonecog.inferenceView' },
			{ label: localize('zonecog.vizSchemaMap', 'Schema-Cognition Map'), id: 'zonecog.schemaMapView' }
		];
		const pick = await quickInput.pick(views, { placeHolder: localize('zonecog.openVizPick', 'Select the visualization to open') });
		if (!pick) {
			return;
		}
		await paneComposite.openPaneComposite(ZONECOG_CONTAINER_ID, ViewContainerLocation.Panel, true);
		await viewsService.openView(pick.id, true);
	}
}
registerAction2(OpenVisualizationViewAction);

/**
 * "Show in Hypergraph" context-menu contribution for Object Explorer tree
 * nodes: focuses the most salient hypergraph node mentioning the selected
 * schema element across all Zone-Cog views.
 */
class ObjectExplorerShowInHypergraphAction extends Action2 {
	static ID = 'zonecog.objectExplorer.showInHypergraph';

	constructor() {
		super({
			id: ObjectExplorerShowInHypergraphAction.ID,
			title: { value: localize('zonecog.showInHypergraph', 'Show in Hypergraph'), original: 'Show in Hypergraph' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, context?: { nodeInfo?: { label?: string }; name?: string }): Promise<void> {
		const hypergraphStore = accessor.get(IHypergraphStore);
		const visualization = accessor.get(IHypergraphVisualizationService);
		const paneComposite = accessor.get(IPaneCompositePartService);
		const viewsService = accessor.get(IViewsService);
		const notification = accessor.get(INotificationService);
		const membrane = accessor.get(ICognitiveMembraneService);

		const label = context?.nodeInfo?.label ?? context?.name;
		if (!label) {
			notification.notify({ severity: Severity.Info, message: localize('zonecog.showInHypergraphNoNode', 'No object explorer node selected.') });
			return;
		}
		membrane.recordActivity('somatic');
		const match = hypergraphStore.getAllNodes()
			.filter(n => n.content.includes(label))
			.sort((a, b) => b.salience_score - a.salience_score)[0];
		if (!match) {
			notification.notify({
				severity: Severity.Info,
				message: localize('zonecog.showInHypergraphNone', 'The hypergraph has no cognition about "{0}" yet - perceive the schema first.', label)
			});
			return;
		}
		await paneComposite.openPaneComposite(ZONECOG_CONTAINER_ID, ViewContainerLocation.Panel, true);
		await viewsService.openView(ZONECOG_HYPERGRAPH_VIEW_ID, true);
		visualization.focusNode(match.id, 'objectExplorer');
	}
}
registerAction2(ObjectExplorerShowInHypergraphAction);

// Register the Object Explorer context-menu item
MenuRegistry.appendMenuItem(MenuId.ObjectExplorerItemContext, {
	group: 'z_zonecog',
	order: 1,
	command: {
		id: ObjectExplorerShowInHypergraphAction.ID,
		title: localize('zonecog.showInHypergraphMenu', 'Show in Hypergraph')
	}
});
