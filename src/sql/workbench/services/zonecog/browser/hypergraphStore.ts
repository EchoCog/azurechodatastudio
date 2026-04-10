/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHypergraphStore, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * In-memory hypergraph store following the EchoCog HypergraphNode standard.
 *
 * Provides CRUD operations for nodes and links, salience-based attention
 * scoring, and event-driven change notifications.
 */
export class HypergraphStore extends Disposable implements IHypergraphStore {

	declare readonly _serviceBrand: undefined;

	private readonly _nodes = new Map<string, HypergraphNode>();
	private readonly _links = new Map<string, HypergraphLink>();

	/** Deep-copy a node so callers cannot mutate internal state. */
	private static _cloneNode(n: HypergraphNode): HypergraphNode {
		return { ...n, links: [...n.links], metadata: { ...n.metadata } };
	}

	/** Deep-copy a link so callers cannot mutate internal state. */
	private static _cloneLink(l: HypergraphLink): HypergraphLink {
		return { ...l, outgoing: [...l.outgoing], metadata: { ...l.metadata } };
	}

	private readonly _onDidChangeNode = this._register(new Emitter<HypergraphNode>());
	readonly onDidChangeNode: Event<HypergraphNode> = this._onDidChangeNode.event;

	private readonly _onDidChangeLink = this._register(new Emitter<HypergraphLink>());
	readonly onDidChangeLink: Event<HypergraphLink> = this._onDidChangeLink.event;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	// -- Node CRUD -----------------------------------------------------------

	addNode(node: HypergraphNode): void {
		this._nodes.set(node.id, HypergraphStore._cloneNode(node));
		this._onDidChangeNode.fire(node);
		this.logService.trace(`HypergraphStore: added node ${node.id} (${node.node_type})`);
	}

	getNode(id: string): HypergraphNode | undefined {
		const n = this._nodes.get(id);
		return n ? HypergraphStore._cloneNode(n) : undefined;
	}

	updateNode(id: string, patch: Partial<Omit<HypergraphNode, 'id'>>): HypergraphNode | undefined {
		const existing = this._nodes.get(id);
		if (!existing) {
			return undefined;
		}
		const merged = { ...existing, ...patch, id };
		const updated = HypergraphStore._cloneNode(merged);
		this._nodes.set(id, updated);
		this._onDidChangeNode.fire(updated);
		return HypergraphStore._cloneNode(updated);
	}

	removeNode(id: string): boolean {
		const deleted = this._nodes.delete(id);
		if (deleted) {
			this.logService.trace(`HypergraphStore: removed node ${id}`);
		}
		return deleted;
	}

	getNodesByType(nodeType: string): HypergraphNode[] {
		const result: HypergraphNode[] = [];
		for (const n of this._nodes.values()) {
			if (n.node_type === nodeType) {
				result.push(HypergraphStore._cloneNode(n));
			}
		}
		return result;
	}

	getAllNodes(): HypergraphNode[] {
		return Array.from(this._nodes.values()).map(n => HypergraphStore._cloneNode(n));
	}

	// -- Link CRUD -----------------------------------------------------------

	addLink(link: HypergraphLink): void {
		this._links.set(link.id, HypergraphStore._cloneLink(link));
		// Update link references on participating nodes
		for (const nodeId of link.outgoing) {
			const node = this._nodes.get(nodeId);
			if (node && !node.links.includes(link.id)) {
				node.links.push(link.id);
			}
		}
		this._onDidChangeLink.fire(link);
		this.logService.trace(`HypergraphStore: added link ${link.id} (${link.link_type})`);
	}

	getLink(id: string): HypergraphLink | undefined {
		const l = this._links.get(id);
		return l ? HypergraphStore._cloneLink(l) : undefined;
	}

	removeLink(id: string): boolean {
		const link = this._links.get(id);
		if (!link) {
			return false;
		}
		// Remove link reference from participating nodes
		for (const nodeId of link.outgoing) {
			const node = this._nodes.get(nodeId);
			if (node) {
				const idx = node.links.indexOf(id);
				if (idx !== -1) {
					node.links.splice(idx, 1);
				}
			}
		}
		this._links.delete(id);
		this.logService.trace(`HypergraphStore: removed link ${id}`);
		return true;
	}

	getLinksByType(linkType: string): HypergraphLink[] {
		const result: HypergraphLink[] = [];
		for (const l of this._links.values()) {
			if (l.link_type === linkType) {
				result.push(HypergraphStore._cloneLink(l));
			}
		}
		return result;
	}

	getLinksForNode(nodeId: string): HypergraphLink[] {
		const result: HypergraphLink[] = [];
		for (const l of this._links.values()) {
			if (l.outgoing.includes(nodeId)) {
				result.push(HypergraphStore._cloneLink(l));
			}
		}
		return result;
	}

	// -- Salience helpers ----------------------------------------------------

	getTopSalientNodes(n: number): HypergraphNode[] {
		return Array.from(this._nodes.values())
			.sort((a, b) => b.salience_score - a.salience_score)
			.slice(0, n)
			.map(node => HypergraphStore._cloneNode(node));
	}

	decayAllSalience(factor: number): void {
		const clampedFactor = Math.max(0, Math.min(1, factor));
		for (const node of this._nodes.values()) {
			node.salience_score *= clampedFactor;
		}
		this.logService.trace(`HypergraphStore: decayed all salience by factor ${clampedFactor}`);
	}

	// -- Bulk ----------------------------------------------------------------

	clear(): void {
		this._nodes.clear();
		this._links.clear();
		this.logService.info('HypergraphStore: cleared all nodes and links');
	}

	nodeCount(): number {
		return this._nodes.size;
	}

	linkCount(): number {
		return this._links.size;
	}
}
