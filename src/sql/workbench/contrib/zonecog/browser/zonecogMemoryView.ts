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
import { RunOnceScheduler } from 'vs/base/common/async';

import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';

/** Episodes shown in the episodic section. */
const MAX_EPISODES = 10;

/** Node types shown in the declarative section. */
const MAX_NODE_TYPES = 10;

/** Debounce for hypergraph change events before refreshing declarative counts. */
const REFRESH_DELAY_MS = 1000;

/**
 * Memory Explorer View - completes the Phase 4.2 "memory explorer" roadmap
 * item by surfacing all three memory systems: episodic memory (recorded
 * cognitive episodes), task contexts (goal-oriented procedural groupings),
 * and declarative memory (the hypergraph knowledge base, summarized as
 * node-type counts).
 */
export class MemoryExplorerView extends ViewPane {
	private _episodicSection?: HTMLElement;
	private _tasksSection?: HTMLElement;
	private _declarativeSection?: HTMLElement;

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
		@ICognitiveWorkspaceService private readonly workspaceService: ICognitiveWorkspaceService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const view = append(container, $('.zonecog-view'));

		this._episodicSection = append(view, $('.zonecog-section'));
		append(this._episodicSection, $('.zonecog-section-header')).textContent = localize('zonecog.episodicMemory', 'Episodic Memory');

		this._tasksSection = append(view, $('.zonecog-section'));
		append(this._tasksSection, $('.zonecog-section-header')).textContent = localize('zonecog.taskContexts', 'Task Contexts');

		this._declarativeSection = append(view, $('.zonecog-section'));
		append(this._declarativeSection, $('.zonecog-section-header')).textContent = localize('zonecog.declarativeMemory', 'Declarative Memory');

		const declarativeScheduler = this._register(new RunOnceScheduler(() => this._refreshDeclarative(), REFRESH_DELAY_MS));
		this._register(this.workspaceService.onDidRecordEpisode(() => this._refreshEpisodic()));
		this._register(this.workspaceService.onDidChangeActiveTask(() => this._refreshTasks()));
		this._register(this.hypergraphStore.onDidChangeNode(() => declarativeScheduler.schedule()));

		this._refreshEpisodic();
		this._refreshTasks();
		this._refreshDeclarative();
	}

	private _refreshEpisodic(): void {
		const section = this._episodicSection;
		if (!section) {
			return;
		}
		this._clearSection(section);

		const episodes = this.workspaceService.getRecentEpisodes(MAX_EPISODES);
		if (episodes.length === 0) {
			append(section, $('.zonecog-thinking-idle')).textContent = localize('zonecog.noEpisodes', 'No episodes recorded yet.');
			return;
		}
		const list = append(section, $('.zonecog-wm-list'));
		for (const episode of episodes) {
			const item = append(list, $('.zonecog-wm-item'));
			append(item, $('.zonecog-wm-category')).textContent = localize('zonecog.episode', 'Episode');
			const content = append(item, $('.zonecog-wm-content'));
			content.textContent = episode.title;
			content.title = episode.content;
			append(item, $('.zonecog-wm-relevance')).textContent = `${Math.round(episode.salience * 100)}%`;
		}
	}

	private _refreshTasks(): void {
		const section = this._tasksSection;
		if (!section) {
			return;
		}
		this._clearSection(section);

		const tasks = this.workspaceService.getAllTasks();
		if (tasks.length === 0) {
			append(section, $('.zonecog-thinking-idle')).textContent = localize('zonecog.noTasks', 'No task contexts created yet.');
			return;
		}
		const list = append(section, $('.zonecog-wm-list'));
		for (const task of tasks) {
			const item = append(list, $('.zonecog-wm-item'));
			const badge = append(item, $('.zonecog-wm-category'));
			badge.textContent = task.active
				? localize('zonecog.activeTask', 'Active')
				: localize('zonecog.task', 'Task');
			append(item, $('.zonecog-wm-content')).textContent = task.description;
			append(item, $('.zonecog-wm-relevance')).textContent = localize('zonecog.taskCounts', '{0} wm · {1} ep',
				task.workingMemoryIds.length, task.episodeIds.length);
		}
	}

	private _refreshDeclarative(): void {
		const section = this._declarativeSection;
		if (!section) {
			return;
		}
		this._clearSection(section);

		const counts = new Map<string, number>();
		for (const node of this.hypergraphStore.getAllNodes()) {
			counts.set(node.node_type, (counts.get(node.node_type) ?? 0) + 1);
		}
		if (counts.size === 0) {
			append(section, $('.zonecog-thinking-idle')).textContent = localize('zonecog.noKnowledge', 'The hypergraph knowledge base is empty.');
			return;
		}
		const total = this.hypergraphStore.nodeCount();
		const list = append(section, $('.zonecog-wm-list'));
		const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, MAX_NODE_TYPES);
		for (const [type, count] of top) {
			const item = append(list, $('.zonecog-wm-item'));
			append(item, $('.zonecog-wm-category')).textContent = type;
			append(item, $('.zonecog-wm-content')).textContent = localize('zonecog.nodeTypeCount', '{0} nodes', count);
			append(item, $('.zonecog-wm-relevance')).textContent = `${Math.round((count / Math.max(1, total)) * 100)}%`;
		}
	}

	private _clearSection(section: HTMLElement): void {
		const header = section.querySelector('.zonecog-section-header');
		clearNode(section);
		if (header) {
			section.appendChild(header);
		}
	}
}
