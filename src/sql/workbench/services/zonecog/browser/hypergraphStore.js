"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var HypergraphStore_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HypergraphStore = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
/**
 * In-memory hypergraph store following the EchoCog HypergraphNode standard.
 *
 * Provides CRUD operations for nodes and links, salience-based attention
 * scoring, and event-driven change notifications.
 */
let HypergraphStore = HypergraphStore_1 = class HypergraphStore extends lifecycle_1.Disposable {
    logService;
    _nodes = new Map();
    _links = new Map();
    /** Deep-copy a node so callers cannot mutate internal state. */
    static _cloneNode(n) {
        return { ...n, links: [...n.links], metadata: { ...n.metadata } };
    }
    /** Deep-copy a link so callers cannot mutate internal state. */
    static _cloneLink(l) {
        return { ...l, outgoing: [...l.outgoing], metadata: { ...l.metadata } };
    }
    _onDidChangeNode = this._register(new event_1.Emitter());
    onDidChangeNode = this._onDidChangeNode.event;
    _onDidChangeLink = this._register(new event_1.Emitter());
    onDidChangeLink = this._onDidChangeLink.event;
    constructor(logService) {
        super();
        this.logService = logService;
    }
    addNode(node) {
        const fullNode = 'id' in node
            ? node
            : {
                ...node,
                id: `hypernode_${Date.now()}_${this._nodes.size + 1}`,
            };
        this._nodes.set(fullNode.id, HypergraphStore_1._cloneNode(fullNode));
        this._onDidChangeNode.fire(fullNode);
        this.logService.trace(`HypergraphStore: added node ${fullNode.id} (${fullNode.node_type})`);
        if (!('id' in node)) {
            return HypergraphStore_1._cloneNode(fullNode);
        }
    }
    getNode(id) {
        const n = this._nodes.get(id);
        return n ? HypergraphStore_1._cloneNode(n) : undefined;
    }
    updateNode(id, patch) {
        const existing = this._nodes.get(id);
        if (!existing) {
            return undefined;
        }
        const merged = { ...existing, ...patch, id };
        const updated = HypergraphStore_1._cloneNode(merged);
        this._nodes.set(id, updated);
        this._onDidChangeNode.fire(HypergraphStore_1._cloneNode(updated));
        return HypergraphStore_1._cloneNode(updated);
    }
    removeNode(id) {
        const deleted = this._nodes.delete(id);
        if (deleted) {
            this.logService.trace(`HypergraphStore: removed node ${id}`);
        }
        return deleted;
    }
    getNodesByType(nodeType) {
        const result = [];
        for (const n of this._nodes.values()) {
            if (n.node_type === nodeType) {
                result.push(HypergraphStore_1._cloneNode(n));
            }
        }
        return result;
    }
    findNodesByType(nodeType) {
        return this.getNodesByType(nodeType);
    }
    getAllNodes() {
        return Array.from(this._nodes.values()).map(n => HypergraphStore_1._cloneNode(n));
    }
    // -- Link CRUD -----------------------------------------------------------
    addLink(link) {
        this._links.set(link.id, HypergraphStore_1._cloneLink(link));
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
    getLink(id) {
        const l = this._links.get(id);
        return l ? HypergraphStore_1._cloneLink(l) : undefined;
    }
    removeLink(id) {
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
    getLinksByType(linkType) {
        const result = [];
        for (const l of this._links.values()) {
            if (l.link_type === linkType) {
                result.push(HypergraphStore_1._cloneLink(l));
            }
        }
        return result;
    }
    getLinksForNode(nodeId) {
        const result = [];
        for (const l of this._links.values()) {
            if (l.outgoing.includes(nodeId)) {
                result.push(HypergraphStore_1._cloneLink(l));
            }
        }
        return result;
    }
    // -- Salience helpers ----------------------------------------------------
    getTopSalientNodes(n) {
        return Array.from(this._nodes.values())
            .sort((a, b) => b.salience_score - a.salience_score)
            .slice(0, n)
            .map(node => HypergraphStore_1._cloneNode(node));
    }
    decayAllSalience(factor) {
        const clampedFactor = Math.max(0, Math.min(1, factor));
        for (const node of this._nodes.values()) {
            node.salience_score *= clampedFactor;
        }
        this.logService.trace(`HypergraphStore: decayed all salience by factor ${clampedFactor}`);
    }
    // -- Bulk ----------------------------------------------------------------
    clear() {
        this._nodes.clear();
        this._links.clear();
        this.logService.info('HypergraphStore: cleared all nodes and links');
    }
    nodeCount() {
        return this._nodes.size;
    }
    linkCount() {
        return this._links.size;
    }
};
exports.HypergraphStore = HypergraphStore;
exports.HypergraphStore = HypergraphStore = HypergraphStore_1 = __decorate([
    __param(0, log_1.ILogService)
], HypergraphStore);
