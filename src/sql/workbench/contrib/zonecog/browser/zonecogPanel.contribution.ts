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
} from 'sql/workbench/contrib/zonecog/common/zonecog';
import { CognitiveStateView, MembraneHealthView } from 'sql/workbench/contrib/zonecog/browser/zonecogViews';
import { ECANAttentionView, WorkingMemoryView } from 'sql/workbench/contrib/zonecog/browser/zonecogAttentionViews';
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
