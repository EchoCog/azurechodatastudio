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

import { IZoneCogService, ZoneCogState } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ICognitiveLoopService, CognitiveLoopState } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { ICognitiveMembraneService, MembraneStatus, MembraneTriad } from 'sql/workbench/services/zonecog/common/zonecogService';

/**
 * Cognitive State View - displays the overall cognitive system state.
 */
export class CognitiveStateView extends ViewPane {
	private _container?: HTMLElement;
	private _cognitiveStateSection?: HTMLElement;
	private _loopStatusSection?: HTMLElement;
	private _loadGaugeSection?: HTMLElement;

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
		@IZoneCogService private readonly zonecogService: IZoneCogService,
		@ICognitiveLoopService private readonly loopService: ICognitiveLoopService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		// Cognitive State Section
		this._cognitiveStateSection = append(this._container, $('.zonecog-section'));
		append(this._cognitiveStateSection, $('.zonecog-section-header')).textContent = localize('zonecog.cognitiveState', 'Cognitive State');

		// Loop Status Section
		this._loopStatusSection = append(this._container, $('.zonecog-section'));
		append(this._loopStatusSection, $('.zonecog-section-header')).textContent = localize('zonecog.loopStatus', 'Cognitive Loop');

		// Cognitive Load Section
		this._loadGaugeSection = append(this._container, $('.zonecog-section'));
		append(this._loadGaugeSection, $('.zonecog-section-header')).textContent = localize('zonecog.cognitiveLoad', 'Cognitive Load');

		// Subscribe to state changes
		this._register(this.zonecogService.onDidChangeCognitiveState(() => this._refreshCognitiveState()));
		this._register(this.loopService.onDidChangeState(() => this._refreshLoopStatus()));

		// Initial render
		this._refreshCognitiveState();
		this._refreshLoopStatus();
	}

	private _refreshCognitiveState(): void {
		if (!this._cognitiveStateSection) {
			return;
		}

		// Clear existing content except header
		const header = this._cognitiveStateSection.querySelector('.zonecog-section-header');
		clearNode(this._cognitiveStateSection);
		if (header) {
			this._cognitiveStateSection.appendChild(header);
		}

		const state = this.zonecogService.getCognitiveState();
		const grid = append(this._cognitiveStateSection, $('.zonecog-cognitive-state'));

		// Initialized
		this._createStatCard(grid, localize('zonecog.initialized', 'Status'),
			state.isInitialized ? localize('zonecog.active', 'Active') : localize('zonecog.inactive', 'Inactive'),
			state.isInitialized ? 'positive' : 'warning');

		// Thinking Mode
		this._createStatCard(grid, localize('zonecog.thinkingMode', 'Thinking'),
			state.thinkingModeEnabled ? localize('zonecog.enabled', 'Enabled') : localize('zonecog.disabled', 'Disabled'),
			state.thinkingModeEnabled ? 'positive' : '');

		// Hypergraph Nodes
		this._createStatCard(grid, localize('zonecog.nodes', 'Nodes'),
			String(state.hypergraphNodeCount));

		// Membrane Health
		this._createStatCard(grid, localize('zonecog.membranes', 'Membranes'),
			state.membraneHealthy ? localize('zonecog.healthy', 'Healthy') : localize('zonecog.unhealthy', 'Unhealthy'),
			state.membraneHealthy ? 'positive' : 'negative');

		// Cognitive Load Gauge
		this._refreshLoadGauge(state);
	}

	private _refreshLoopStatus(): void {
		if (!this._loopStatusSection) {
			return;
		}

		// Clear existing content except header
		const header = this._loopStatusSection.querySelector('.zonecog-section-header');
		clearNode(this._loopStatusSection);
		if (header) {
			this._loopStatusSection.appendChild(header);
		}

		const loopState = this.loopService.getState();
		const statusContainer = append(this._loopStatusSection, $('.zonecog-loop-status'));

		// Status indicator
		const indicator = append(statusContainer, $('.zonecog-loop-indicator'));
		if (loopState.running && !loopState.paused) {
			indicator.classList.add('running');
		} else if (loopState.paused) {
			indicator.classList.add('paused');
		} else {
			indicator.classList.add('stopped');
		}

		// Status label
		const label = append(statusContainer, $('.zonecog-loop-label'));
		if (loopState.running && !loopState.paused) {
			label.textContent = localize('zonecog.loopRunning', 'Running');
		} else if (loopState.paused) {
			label.textContent = localize('zonecog.loopPaused', 'Paused');
		} else {
			label.textContent = localize('zonecog.loopStopped', 'Stopped');
		}

		// Stats
		const stats = append(statusContainer, $('.zonecog-loop-stats'));
		stats.textContent = localize('zonecog.loopStats', '{0} iterations, avg {1}ms',
			loopState.totalIterations, loopState.averageIterationMs);
	}

	private _refreshLoadGauge(state: ZoneCogState): void {
		if (!this._loadGaugeSection) {
			return;
		}

		// Clear existing content except header
		const header = this._loadGaugeSection.querySelector('.zonecog-section-header');
		clearNode(this._loadGaugeSection);
		if (header) {
			this._loadGaugeSection.appendChild(header);
		}

		const gauge = append(this._loadGaugeSection, $('.zonecog-load-gauge'));
		const fill = append(gauge, $('.zonecog-load-fill'));
		const text = append(gauge, $('.zonecog-load-text'));

		const loadPercent = Math.round(state.cognitiveLoad * 100);
		fill.style.width = `${loadPercent}%`;
		text.textContent = `${loadPercent}%`;
	}

	private _createStatCard(container: HTMLElement, label: string, value: string, className?: string): void {
		const card = append(container, $('.zonecog-stat-card'));
		append(card, $('.zonecog-stat-label')).textContent = label;
		const valueEl = append(card, $('.zonecog-stat-value'));
		valueEl.textContent = value;
		if (className) {
			valueEl.classList.add(className);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

/**
 * Membrane Health View - displays the health of cognitive membrane triads.
 */
export class MembraneHealthView extends ViewPane {
	private _container?: HTMLElement;
	private _membraneGrid?: HTMLElement;

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
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.zonecog-view'));

		const section = append(this._container, $('.zonecog-section'));
		append(section, $('.zonecog-section-header')).textContent = localize('zonecog.membraneTriads', 'Membrane Triads');

		this._membraneGrid = append(section, $('.zonecog-membrane-grid'));

		// Subscribe to membrane status changes
		this._register(this.membraneService.onDidChangeMembraneStatus(() => this._refreshMembranes()));

		// Initial render
		this._refreshMembranes();
	}

	private _refreshMembranes(): void {
		if (!this._membraneGrid) {
			return;
		}

		clearNode(this._membraneGrid);

		const triads: MembraneTriad[] = ['cerebral', 'somatic', 'autonomic'];
		const icons: Record<MembraneTriad, string> = {
			cerebral: '🧠',
			somatic: '💪',
			autonomic: '⚡',
		};

		for (const triad of triads) {
			const status = this.membraneService.getStatus(triad);
			this._createMembraneCard(this._membraneGrid, triad, icons[triad], status);
		}
	}

	private _createMembraneCard(container: HTMLElement, triad: MembraneTriad, icon: string, status: MembraneStatus): void {
		const card = append(container, $('.zonecog-membrane-card'));
		card.classList.add(status.healthy ? 'healthy' : 'unhealthy');

		append(card, $('.zonecog-membrane-icon')).textContent = icon;
		append(card, $('.zonecog-membrane-name')).textContent = triad;

		const statusEl = append(card, $('.zonecog-membrane-status'));
		statusEl.textContent = status.healthy ? localize('zonecog.healthy', 'Healthy') : localize('zonecog.unhealthy', 'Unhealthy');

		const countEl = append(card, $('.zonecog-membrane-count'));
		countEl.textContent = localize('zonecog.processErrors', '{0} processes, {1} errors',
			status.activeProcesses, status.errorCount);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
