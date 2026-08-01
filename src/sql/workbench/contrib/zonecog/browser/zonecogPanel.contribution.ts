/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import * as lifecycle from 'vs/base/common/lifecycle';
import * as ext from 'vs/workbench/common/contributions';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainer, ViewContainerLocation, IViewsRegistry } from 'vs/workbench/common/views';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { MenuId, MenuRegistry, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IPaneCompositePartService } from 'vs/workbench/services/panecomposite/browser/panecomposite';
import { Codicon } from 'vs/base/common/codicons';

import {
	ZONECOG_CONTAINER_ID,
	ZONECOG_COGNITIVE_VIEW_ID,
	ZONECOG_MEMBRANE_VIEW_ID,
	ZONECOG_ECAN_VIEW_ID,
	ZONECOG_WORKSPACE_VIEW_ID,
	ZONECOG_DTESN_VIEW_ID,
	ZONECOG_AAR_VIEW_ID,
	ZONECOG_WORKFLOWS_VIEW_ID,
	ZONECOG_AGI_STUDIO_VIEW_ID,
	ZONECOG_THINKING_VIEW_ID,
	ZONECOG_HYPERGRAPH_VIEW_ID,
	ZONECOG_MEMORY_VIEW_ID,
	ZONECOG_SCHEMA_MAP_VIEW_ID,
} from 'sql/workbench/contrib/zonecog/common/zonecog';
import { CognitiveStateView, MembraneHealthView } from 'sql/workbench/contrib/zonecog/browser/zonecogViews';
import { ThinkingProcessView } from 'sql/workbench/contrib/zonecog/browser/zonecogThinkingView';
import { HypergraphExplorerView } from 'sql/workbench/contrib/zonecog/browser/zonecogHypergraphView';
import { MemoryExplorerView } from 'sql/workbench/contrib/zonecog/browser/zonecogMemoryView';
import { SchemaCognitionMapView } from 'sql/workbench/contrib/zonecog/browser/zonecogSchemaMapView';
import { ECANAttentionView, WorkingMemoryView } from 'sql/workbench/contrib/zonecog/browser/zonecogAttentionViews';
import { DTESNNetworkView, AAROrchestrationView, CognitiveWorkflowsView } from 'sql/workbench/contrib/zonecog/browser/zonecogAdvancedViews';
import { AgiStudioView } from 'sql/workbench/contrib/zonecog/browser/agiStudioView';
import { ICognitiveLoopService } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';

/**
 * Badge updater for the Zone-Cog panel showing node count.
 */
export class ZoneCogBadgeUpdater extends lifecycle.Disposable implements ext.IWorkbenchContribution {
	static ID = 'zonecog.badgeUpdater';

	private badgeHandle?: lifecycle.IDisposable;

	constructor(
		@IActivityService private readonly activityService: IActivityService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveLoopService private readonly loopService: ICognitiveLoopService
	) {
		super();

		this._register(this.hypergraphStore.onDidChangeNode(() => this._updateBadge()));
		this._register(this.loopService.onDidCompleteIteration(() => this._updateBadge()));

		// Initial badge
		this._updateBadge();
	}

	private _updateBadge(): void {
		lifecycle.dispose(this.badgeHandle);

		const nodeCount = this.hypergraphStore.nodeCount();
		if (nodeCount > 0) {
			const badge = new NumberBadge(nodeCount, n => localize('zonecog.nodeCountBadge', '{0} hypergraph nodes', n));
			this.badgeHandle = this.activityService.showViewContainerActivity(ZONECOG_CONTAINER_ID, { badge, clazz: 'zonecog-badge' });
		}
	}

	public getId(): string {
		return ZoneCogBadgeUpdater.ID;
	}

	public override dispose(): void {
		lifecycle.dispose(this.badgeHandle);
		super.dispose();
	}
}

/**
 * Action to toggle the Zone-Cog panel visibility.
 */
class ToggleZoneCogPanelAction extends Action2 {
	static ID = 'zonecog.togglePanel';

	constructor() {
		super({
			id: ToggleZoneCogPanelAction.ID,
			title: { value: localize('zonecog.togglePanel', 'Toggle Zone-Cog Panel'), original: 'Toggle Zone-Cog Panel' },
			category: { value: localize('zonecog.category', 'Zone-Cog'), original: 'Zone-Cog' },
			icon: Codicon.circuitBoard,
			f1: true,
			menu: {
				id: MenuId.CommandPalette,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const paneCompositeService = accessor.get(IPaneCompositePartService);
		const pane = paneCompositeService.getActivePaneComposite(ViewContainerLocation.Panel);

		if (pane?.getId() === ZONECOG_CONTAINER_ID) {
			paneCompositeService.hideActivePaneComposite(ViewContainerLocation.Panel);
		} else {
			await paneCompositeService.openPaneComposite(ZONECOG_CONTAINER_ID, ViewContainerLocation.Panel, true);
		}
	}
}

// Register the toggle action
registerAction2(ToggleZoneCogPanelAction);

// Register the Zone-Cog view container (panel)
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: ZONECOG_CONTAINER_ID,
	title: localize('zonecog.panel', 'Zone-Cog'),
	hideIfEmpty: false,
	order: 30,
	icon: Codicon.circuitBoard,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [ZONECOG_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: false,
		donotShowContainerTitleWhenMergedWithContainer: false
	}]),
	storageId: `${ZONECOG_CONTAINER_ID}.storage`
}, ViewContainerLocation.Panel);

// Register views within the container
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([
	{
		id: ZONECOG_COGNITIVE_VIEW_ID,
		name: localize('zonecog.cognitiveState', 'Cognitive State'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(CognitiveStateView),
		order: 1,
	},
	{
		id: ZONECOG_MEMBRANE_VIEW_ID,
		name: localize('zonecog.membranes', 'Membrane Health'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(MembraneHealthView),
		order: 2,
	},
	{
		id: ZONECOG_ECAN_VIEW_ID,
		name: localize('zonecog.ecan', 'ECAN Attention'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(ECANAttentionView),
		order: 3,
	},
	{
		id: ZONECOG_WORKSPACE_VIEW_ID,
		name: localize('zonecog.workspace', 'Working Memory'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(WorkingMemoryView),
		order: 4,
	},
	{
		id: ZONECOG_DTESN_VIEW_ID,
		name: localize('zonecog.dtesn', 'DTESN Network'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(DTESNNetworkView),
		order: 5,
	},
	{
		id: ZONECOG_AAR_VIEW_ID,
		name: localize('zonecog.aar', 'AAR Orchestration'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(AAROrchestrationView),
		order: 6,
	},
	{
		id: ZONECOG_WORKFLOWS_VIEW_ID,
		name: localize('zonecog.workflowsView', 'Workflows'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(CognitiveWorkflowsView),
		order: 7,
	},
	{
		id: ZONECOG_AGI_STUDIO_VIEW_ID,
		name: localize('zonecog.agiStudio', 'AGI Studio'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(AgiStudioView),
		order: 8,
	},
	{
		id: ZONECOG_THINKING_VIEW_ID,
		name: localize('zonecog.thinkingView', 'Thinking Process'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(ThinkingProcessView),
		order: 9,
	},
	{
		id: ZONECOG_HYPERGRAPH_VIEW_ID,
		name: localize('zonecog.hypergraphView', 'Hypergraph Explorer'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(HypergraphExplorerView),
		order: 10,
	},
	{
		id: ZONECOG_MEMORY_VIEW_ID,
		name: localize('zonecog.memoryView', 'Memory Explorer'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(MemoryExplorerView),
		order: 11,
	},
	{
		id: ZONECOG_SCHEMA_MAP_VIEW_ID,
		name: localize('zonecog.schemaMapView', 'Schema-Cognition Map'),
		canToggleVisibility: true,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(SchemaCognitionMapView),
		order: 12,
	},
], VIEW_CONTAINER);

// Register the badge updater
(<ext.IWorkbenchContributionsRegistry>Registry.as(ext.Extensions.Workbench)).registerWorkbenchContribution(ZoneCogBadgeUpdater, LifecyclePhase.Restored);

// Add menu item to View menu
MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '4_panels',
	command: {
		id: ToggleZoneCogPanelAction.ID,
		title: localize({ key: 'miViewZoneCog', comment: ['&& denotes a mnemonic'] }, '&&Zone-Cog')
	},
	order: 5
});
