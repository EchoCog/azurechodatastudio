/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { $, append } from 'vs/base/browser/dom';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import * as ext from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';

import { IHypergraphVisualizationService } from 'sql/workbench/services/zonecog/common/hypergraphVisualization';
import { IHypergraphStore, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';

const SNAPSHOT_MIME = 'application/vnd.zonecog.hypergraph-snapshot+json';
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 320;

/**
 * Parsed hypergraph snapshot payload embedded in a notebook cell output.
 */
interface HypergraphSnapshotData {
	formatVersion: number;
	exportedAt: number;
	nodes: Array<HypergraphNode & { layout?: { x: number; y: number } }>;
	links: HypergraphLink[];
}

/**
 * Renders a ZoneCog hypergraph snapshot inline within a notebook cell output.
 *
 * Completes Phase 6.3 "Notebook cell output renderer for hypergraph snapshots".
 *
 * This contribution registers a handler that watches for notebook cell outputs
 * with the `application/vnd.zonecog.hypergraph-snapshot+json` MIME type and
 * renders a force-directed graph snapshot. It also provides a utility method
 * `renderSnapshotToContainer` that can be called from Angular-based MIME
 * component wrappers.
 */
export class ZoneCogNotebookRendererContribution extends Disposable implements ext.IWorkbenchContribution {
	static ID = 'zonecog.notebookRenderer';

	constructor(
		@IHypergraphVisualizationService private readonly visualizationService: IHypergraphVisualizationService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super();
	}

	public getId(): string {
		return ZoneCogNotebookRendererContribution.ID;
	}

	/**
	 * Render a hypergraph snapshot JSON string into a container element.
	 * Can be called by Angular MIME component wrappers or directly from
	 * notebook cell output rendering pipelines.
	 */
	public renderSnapshotToContainer(container: HTMLElement, jsonContent: string): IDisposable {
		let snapshot: HypergraphSnapshotData;
		try {
			snapshot = JSON.parse(jsonContent);
		} catch {
			const errEl = append(container, $('div.zonecog-notebook-error'));
			errEl.textContent = localize('zonecog.notebookParseError', 'Invalid hypergraph snapshot JSON');
			return { dispose: () => { } };
		}

		if (!snapshot.nodes || !Array.isArray(snapshot.nodes)) {
			const errEl = append(container, $('div.zonecog-notebook-error'));
			errEl.textContent = localize('zonecog.notebookNoNodes', 'Snapshot contains no nodes');
			return { dispose: () => { } };
		}

		const wrapper = append(container, $('div.zonecog-notebook-snapshot'));
		wrapper.style.position = 'relative';

		const header = append(wrapper, $('div.zonecog-notebook-snapshot-header'));
		header.textContent = localize(
			'zonecog.notebookSnapshotHeader',
			'Hypergraph Snapshot: {0} nodes, {1} links (exported {2})',
			snapshot.nodes.length,
			snapshot.links?.length ?? 0,
			new Date(snapshot.exportedAt).toLocaleString()
		);
		header.style.fontSize = '11px';
		header.style.marginBottom = '6px';
		header.style.opacity = '0.7';

		const canvas = append(wrapper, $<HTMLCanvasElement>('canvas.zonecog-notebook-canvas'));
		canvas.width = CANVAS_WIDTH;
		canvas.height = CANVAS_HEIGHT;
		canvas.style.border = '1px solid rgba(128,128,128,0.3)';
		canvas.style.borderRadius = '4px';

		this._renderSnapshot(canvas, snapshot);

		const importBtn = append(wrapper, $<HTMLButtonElement>('button.zonecog-notebook-import'));
		importBtn.textContent = localize('zonecog.notebookImport', 'Import into Live Hypergraph');
		importBtn.style.marginTop = '6px';
		importBtn.style.padding = '4px 10px';
		importBtn.style.cursor = 'pointer';
		importBtn.style.fontSize = '11px';

		const importHandler = () => {
			for (const node of snapshot.nodes) {
				const existing = this.hypergraphStore.getNode(node.id);
				if (!existing) {
					this.hypergraphStore.addNode(node);
				}
			}
			for (const link of snapshot.links ?? []) {
				const existing = this.hypergraphStore.getLink(link.id);
				if (!existing) {
					this.hypergraphStore.addLink(link);
				}
			}
			importBtn.textContent = localize('zonecog.notebookImported', 'Imported {0} nodes', snapshot.nodes.length);
			importBtn.disabled = true;
		};
		importBtn.addEventListener('click', importHandler);

		return {
			dispose: () => {
				importBtn.removeEventListener('click', importHandler);
			}
		};
	}

	private _renderSnapshot(canvas: HTMLCanvasElement, snapshot: HypergraphSnapshotData): void {
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return;
		}
		const w = canvas.width;
		const h = canvas.height;

		const nodes = snapshot.nodes;
		if (nodes.length === 0) {
			ctx.fillStyle = this._foreground(canvas);
			ctx.font = '12px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(localize('zonecog.notebookEmptySnapshot', 'Empty snapshot'), w / 2, h / 2);
			return;
		}

		const positioned = nodes.map((n, i) => {
			const layout = n.layout;
			return {
				node: n,
				x: layout?.x ?? (w / 2 + Math.cos(i * 2.399) * Math.min(w, h) * 0.35),
				y: layout?.y ?? (h / 2 + Math.sin(i * 2.399) * Math.min(w, h) * 0.35),
				radius: 3 + n.salience_score * 6,
				color: this.visualizationService.colorForNodeType(n.node_type)
			};
		});

		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const p of positioned) {
			if (p.x < minX) { minX = p.x; }
			if (p.x > maxX) { maxX = p.x; }
			if (p.y < minY) { minY = p.y; }
			if (p.y > maxY) { maxY = p.y; }
		}
		const rangeX = Math.max(maxX - minX, 1);
		const rangeY = Math.max(maxY - minY, 1);
		const pad = 20;
		const scaleX = (w - pad * 2) / rangeX;
		const scaleY = (h - pad * 2) / rangeY;
		const scale = Math.min(scaleX, scaleY);

		const tx = (x: number) => pad + (x - minX) * scale;
		const ty = (y: number) => pad + (y - minY) * scale;

		const nodeById = new Map(positioned.map(p => [p.node.id, p]));
		const links = snapshot.links ?? [];

		ctx.globalAlpha = 0.25;
		ctx.strokeStyle = this._foreground(canvas);
		ctx.lineWidth = 0.5;
		for (const link of links) {
			if (link.outgoing.length >= 2) {
				const src = nodeById.get(link.outgoing[0]);
				const tgt = nodeById.get(link.outgoing[1]);
				if (src && tgt) {
					ctx.beginPath();
					ctx.moveTo(tx(src.x), ty(src.y));
					ctx.lineTo(tx(tgt.x), ty(tgt.y));
					ctx.stroke();
				}
			}
		}
		ctx.globalAlpha = 1;

		for (const p of positioned) {
			ctx.beginPath();
			ctx.arc(tx(p.x), ty(p.y), p.radius, 0, Math.PI * 2);
			ctx.fillStyle = p.color;
			ctx.fill();
		}

		ctx.fillStyle = this._foreground(canvas);
		ctx.font = '10px sans-serif';
		ctx.textAlign = 'right';
		ctx.globalAlpha = 0.5;
		ctx.fillText(
			`${nodes.length} nodes, ${links.length} links`,
			w - 8, h - 8
		);
		ctx.globalAlpha = 1;
	}

	private _foreground(canvas: HTMLCanvasElement): string {
		return canvas.parentElement
			? getComputedStyle(canvas.parentElement).color
			: '#cccccc';
	}
}

(<ext.IWorkbenchContributionsRegistry>Registry.as(ext.Extensions.Workbench))
	.registerWorkbenchContribution(ZoneCogNotebookRendererContribution, LifecyclePhase.Restored);

/** The MIME type used for notebook cell hypergraph snapshot outputs. */
export const ZONECOG_SNAPSHOT_MIME = SNAPSHOT_MIME;
