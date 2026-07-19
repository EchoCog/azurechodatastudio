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

import { ISchemaPerceptionService } from 'sql/workbench/services/zonecog/common/schemaPerception';
import { ISchemaEvolutionService } from 'sql/workbench/services/zonecog/common/schemaEvolution';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';

/** Tables listed per connection. */
const MAX_TABLES = 25;

/** Debounce before recomputing the mapping. */
const REFRESH_DELAY_MS = 750;

/**
 * Schema-to-Cognition Map View - closes the Phase 4.1 "schema-to-cognition
 * mapping explorer" roadmap item. For every perceived table it shows how the
 * cognitive layer has engaged with it: how many hypergraph nodes reference
 * it and how many schema-evolution changes have been recorded for it, making
 * visible which parts of the database the cognition has actually grounded.
 */
export class SchemaCognitionMapView extends ViewPane {
	private _container?: HTMLElement;

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
		@ISchemaPerceptionService private readonly schemaPerception: ISchemaPerceptionService,
		@ISchemaEvolutionService private readonly schemaEvolution: ISchemaEvolutionService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = append(container, $('.zonecog-view'));

		const scheduler = this._register(new RunOnceScheduler(() => this._refresh(), REFRESH_DELAY_MS));
		this._register(this.schemaPerception.onDidPerceiveSchema(() => scheduler.schedule()));
		this._register(this.schemaEvolution.onDidDetectSchemaChanges(() => scheduler.schedule()));
		this._register(this.hypergraphStore.onDidChangeNode(() => scheduler.schedule()));

		this._refresh();
	}

	private _refresh(): void {
		if (!this._container) {
			return;
		}
		clearNode(this._container);

		const connections = this.schemaEvolution.getTrackedConnections();
		if (connections.length === 0) {
			const section = append(this._container, $('.zonecog-section'));
			append(section, $('.zonecog-section-header')).textContent = localize('zonecog.schemaMap', 'Schema-to-Cognition Map');
			append(section, $('.zonecog-thinking-idle')).textContent =
				localize('zonecog.schemaMapEmpty', 'No schemas perceived yet - connect to a database and perceive its schema first.');
			return;
		}

		// Index hypergraph node content once per refresh; each table then does
		// a substring check against this snapshot rather than rescanning the store.
		const nodeContents = this.hypergraphStore.getAllNodes().map(n => n.content);

		for (const connectionUri of connections) {
			const section = append(this._container, $('.zonecog-section'));
			append(section, $('.zonecog-section-header')).textContent = connectionUri;

			const tables = this.schemaPerception.getElementsByType(connectionUri, 'table').slice(0, MAX_TABLES);
			if (tables.length === 0) {
				append(section, $('.zonecog-thinking-idle')).textContent = localize('zonecog.schemaMapNoTables', 'No tables perceived for this connection.');
				continue;
			}

			const changes = this.schemaEvolution.getChangeHistory(connectionUri);
			const list = append(section, $('.zonecog-wm-list'));
			for (const table of tables) {
				const cognitionCount = nodeContents.reduce((acc, content) => acc + (content.includes(table.name) ? 1 : 0), 0);
				const changeCount = changes.reduce((acc, change) => acc + (change.elementId === table.id ? 1 : 0), 0);

				const item = append(list, $('.zonecog-wm-item'));
				append(item, $('.zonecog-wm-category')).textContent = localize('zonecog.tableBadge', 'Table');
				const content = append(item, $('.zonecog-wm-content'));
				content.textContent = table.qualifiedName;
				content.title = table.qualifiedName;
				append(item, $('.zonecog-wm-relevance')).textContent = localize('zonecog.schemaMapCounts', '{0} nodes · {1} changes',
					cognitionCount, changeCount);
			}
		}
	}
}
