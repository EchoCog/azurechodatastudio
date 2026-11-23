/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/zonecogDashboard';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { $, append, clearNode } from 'vs/base/browser/dom';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';

import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ICognitiveWorkspaceService, WorkingMemoryItem } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';

/**
 * ECAN Attention View - displays the ECAN attention values and spreading activation.
 */
export class ECANAttentionView extends ViewPane {
	private _container?: HTMLElement;
	private _statsSection?: HTMLElement;
	private _attentionBars?: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IECANAttentionService private readonly ecanService: IECANAttentionService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		// Stats Section
		const statsSection = append(this._container, $('.zonecog-section'));
		append(statsSection, $('.zonecog-section-header')).textContent = localize('zonecog.ecanStats', 'ECAN Statistics');
		this._statsSection = append(statsSection, $('.zonecog-ecan-stats'));

		// Attention Bars Section
		const barsSection = append(this._container, $('.zonecog-section'));
		append(barsSection, $('.zonecog-section-header')).textContent = localize('zonecog.attentionDistribution', 'Attention Distribution');
		this._attentionBars = append(barsSection, $('.zonecog-attention-bars'));

		// Subscribe to ECAN changes
		this._register(this.ecanService.onDidChangeAttention(() => this._refreshECAN()));
		this._register(this.ecanService.onDidSpreadingActivation(() => this._refreshECAN()));

		// Initial render
		this._refreshECAN();
	}

	private _refreshECAN(): void {
		this._refreshStats();
		this._refreshAttentionBars();
	}

	private _refreshStats(): void {
		if (!this._statsSection) {
			return;
		}

		clearNode(this._statsSection);

		const state = this.ecanService.getState();
		this._statsSection.setAttribute('role', 'status');
		this._statsSection.setAttribute('aria-label', localize('zonecog.ecanStatsSummary', 'ECAN statistics summary'));

		// Total nodes tracked
		const totalCard = append(this._statsSection, $('.zonecog-stat-card'));
		totalCard.tabIndex = 0;
		totalCard.setAttribute('aria-label', `${localize('zonecog.nodesTracked', 'Tracked Nodes')}: ${state.totalNodes}`);
		append(totalCard, $('.zonecog-stat-label')).textContent = localize('zonecog.nodesTracked', 'Tracked Nodes');
		append(totalCard, $('.zonecog-stat-value')).textContent = String(state.totalNodes);

		// Important count
		const importantCard = append(this._statsSection, $('.zonecog-stat-card'));
		importantCard.tabIndex = 0;
		importantCard.setAttribute('aria-label', `${localize('zonecog.importantNodes', 'Important')}: ${state.importantCount}`);
		append(importantCard, $('.zonecog-stat-label')).textContent = localize('zonecog.importantNodes', 'Important');
		const importantValue = append(importantCard, $('.zonecog-stat-value'));
		importantValue.textContent = String(state.importantCount);
		importantValue.classList.add('positive');

		// Total attention
		const attentionCard = append(this._statsSection, $('.zonecog-stat-card'));
		attentionCard.tabIndex = 0;
		attentionCard.setAttribute('aria-label', `${localize('zonecog.totalAttention', 'Total Attention')}: ${state.totalAttention.toFixed(2)}`);
		append(attentionCard, $('.zonecog-stat-label')).textContent = localize('zonecog.totalAttention', 'Total Attention');
		append(attentionCard, $('.zonecog-stat-value')).textContent = state.totalAttention.toFixed(2);

		// Rent cycles
		const rentCard = append(this._statsSection, $('.zonecog-stat-card'));
		rentCard.tabIndex = 0;
		rentCard.setAttribute('aria-label', `${localize('zonecog.rentCycles', 'Rent Cycles')}: ${state.rentCycles}`);
		append(rentCard, $('.zonecog-stat-label')).textContent = localize('zonecog.rentCycles', 'Rent Cycles');
		append(rentCard, $('.zonecog-stat-value')).textContent = String(state.rentCycles);
	}

	private _refreshAttentionBars(): void {
		if (!this._attentionBars) {
			return;
		}

		clearNode(this._attentionBars);
		this._attentionBars.setAttribute('role', 'list');
		this._attentionBars.setAttribute('aria-label', localize('zonecog.attentionDistributionList', 'Attention distribution by node'));

		// Get top nodes by attention
		const topNodes = this.ecanService.getTopByAttention(10);

		if (topNodes.length === 0) {
			const empty = append(this._attentionBars, $('.zonecog-empty-state'));
			empty.textContent = localize('zonecog.noAttentionNodes', 'No nodes with attention values');
			return;
		}

		// Find max attention for scaling
		const maxAttention = Math.max(...topNodes.map(n => n.attentionValue), 1);

		for (const node of topNodes) {
			const barContainer = append(this._attentionBars, $('.zonecog-attention-bar'));
			barContainer.setAttribute('role', 'listitem');
			barContainer.tabIndex = 0;
			barContainer.setAttribute('aria-label', localize('zonecog.attentionBarLabel', '{0}: attention {1}', node.nodeId, node.attentionValue.toFixed(2)));

			// Label
			const label = append(barContainer, $('.zonecog-attention-label'));
			const nodeId = node.nodeId.length > 20 ? node.nodeId.substring(0, 17) + '...' : node.nodeId;
			label.textContent = nodeId;
			label.title = node.nodeId;

			// Bar
			const bar = append(barContainer, $('.zonecog-attention-fill'));
			const width = Math.round((node.attentionValue / maxAttention) * 100);
			bar.style.width = `${width}%`;
			bar.setAttribute('role', 'progressbar');
			bar.setAttribute('aria-valuemin', '0');
			bar.setAttribute('aria-valuemax', String(maxAttention));
			bar.setAttribute('aria-valuenow', node.attentionValue.toFixed(2));
			bar.setAttribute('aria-label', localize('zonecog.attentionFillLabel', '{0} attention level', node.nodeId));

			// STI indicator
			if (node.attentionValue >= this.ecanService.getState().importantThreshold) {
				bar.classList.add('important');
			}

			// Value
			const value = append(barContainer, $('.zonecog-attention-value'));
			value.textContent = node.attentionValue.toFixed(2);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

/**
 * Working Memory View - displays items in working memory.
 */
export class WorkingMemoryView extends ViewPane {
	private _container?: HTMLElement;
	private _memoryList?: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ICognitiveWorkspaceService private readonly workspaceService: ICognitiveWorkspaceService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		// Working Memory Section
		const section = append(this._container, $('.zonecog-section'));
		append(section, $('.zonecog-section-header')).textContent = localize('zonecog.workingMemory', 'Working Memory');
		this._memoryList = append(section, $('.zonecog-working-memory'));
		this._memoryList.setAttribute('role', 'list');
		this._memoryList.setAttribute('aria-label', localize('zonecog.workingMemoryList', 'Working memory items'));
		this._memoryList.setAttribute('aria-live', 'polite');

		// Subscribe to workspace changes
		this._register(this.workspaceService.onDidChangeWorkspace(() => this._refreshWorkingMemory()));

		// Initial render
		this._refreshWorkingMemory();
	}

	private _refreshWorkingMemory(): void {
		if (!this._memoryList) {
			return;
		}

		clearNode(this._memoryList);

		const items = this.workspaceService.getWorkingMemory();

		if (items.length === 0) {
			const empty = append(this._memoryList, $('.zonecog-empty-state'));
			empty.textContent = localize('zonecog.emptyWorkingMemory', 'Working memory is empty');
			return;
		}

		for (const item of items) {
			this._createMemoryItem(this._memoryList, item);
		}
	}

	private _createMemoryItem(container: HTMLElement, item: WorkingMemoryItem): void {
		const itemEl = append(container, $('.zonecog-memory-item'));
		itemEl.setAttribute('role', 'listitem');
		itemEl.tabIndex = 0;
		const displayContent = item.content.length > 50 ? item.content.substring(0, 47) + '...' : item.content;
		itemEl.setAttribute('aria-label', localize('zonecog.memoryItemLabel', '{0}: {1}, activation {2}%', item.type, displayContent, Math.round(item.activation * 100)));

		// Type icon
		const typeIcon = append(itemEl, $('.zonecog-memory-icon'));
		typeIcon.textContent = this._getTypeIcon(item.type);
		typeIcon.setAttribute('aria-hidden', 'true');

		// Content
		const content = append(itemEl, $('.zonecog-memory-content'));

		const label = append(content, $('.zonecog-memory-label'));
		label.textContent = displayContent;
		label.title = item.content;

		const meta = append(content, $('.zonecog-memory-meta'));
		const ageMs = Date.now() - item.timestamp;
		const ageSec = Math.round(ageMs / 1000);
		meta.textContent = localize('zonecog.memoryMeta', '{0} • {1}s ago', item.type, ageSec);

		// Activation
		const activation = append(itemEl, $('.zonecog-memory-activation'));
		const activationPercent = Math.round(item.activation * 100);
		activation.textContent = `${activationPercent}%`;

		// Color based on activation
		if (item.activation > 0.7) {
			itemEl.classList.add('high-activation');
		} else if (item.activation < 0.3) {
			itemEl.classList.add('low-activation');
		}
	}

	private _getTypeIcon(type: string): string {
		switch (type) {
			// allow-any-unicode-next-line
			case 'percept': return '👁️';
			// allow-any-unicode-next-line
			case 'thought': return '💭';
			case 'goal': return '🎯';
			// allow-any-unicode-next-line
			case 'action': return '⚡';
			// allow-any-unicode-next-line
			case 'query': return '🔍';
			// allow-any-unicode-next-line
			case 'result': return '📊';
			// allow-any-unicode-next-line
			default: return '📝';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
