/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	IAtomSpaceTransportService,
	AtomSpaceTransportConfig,
	AtomSpaceSyncResult,
} from 'sql/workbench/services/zonecog/common/atomSpaceTransport';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';

const DEFAULT_CONFIG: AtomSpaceTransportConfig = {
	baseUrl: 'http://127.0.0.1:7807',
	timeoutMs: 10000,
	authToken: undefined,
};

/** Node type used to persist sync outcomes in the hypergraph store. */
const SYNC_RECORD_NODE_TYPE = 'AtomSpaceSyncRecord';

/** Bound on retained in-memory sync history entries. */
const MAX_HISTORY = 200;

interface HypergraphNodeLike {
	id: string;
	node_type: string;
	content: string;
}

interface HypergraphLinkLike {
	id: string;
	link_type: string;
	outgoing: string[];
}

/** Atom shape matching the Python bridge's Node/Link AtomBatch convention. */
interface Atom {
	type: 'Node' | 'Link';
	node_type?: string;
	link_type?: string;
	name?: string;
	out?: string[];
	uuid: string;
}

function nodeToAtom(node: HypergraphNodeLike): Atom {
	return { type: 'Node', node_type: node.node_type, name: node.content, uuid: node.id };
}

function linkToAtom(link: HypergraphLinkLike): Atom {
	return { type: 'Link', link_type: link.link_type, out: link.outgoing, uuid: link.id };
}

/**
 * Real AtomSpace transport service implementation.
 *
 * Talks to the ZoneCog Python bridge over HTTP (`GET /health`,
 * `POST /ingest/atoms`) to push the hypergraph store's contents out as an
 * atom batch. The bridge is responsible for deciding whether to count atoms
 * in-process or forward them to a real AtomSpace REST backend
 * (`ATOMSPACE_MODE=http`); this service only needs the bridge itself to be
 * reachable, matching the "somatic" triad's role of tracking bridge
 * communication (see `.github/agents/zonecog.agent.md`).
 */
export class AtomSpaceTransportService extends Disposable implements IAtomSpaceTransportService {

	declare readonly _serviceBrand: undefined;

	private _config: AtomSpaceTransportConfig = { ...DEFAULT_CONFIG };
	private _connected = false;
	private _requestCounter = 0;
	private readonly _history: AtomSpaceSyncResult[] = [];

	private readonly _onDidSync = this._register(new Emitter<AtomSpaceSyncResult>());
	readonly onDidSync: Event<AtomSpaceSyncResult> = this._onDidSync.event;

	private readonly _onDidChangeConnectionStatus = this._register(new Emitter<boolean>());
	readonly onDidChangeConnectionStatus: Event<boolean> = this._onDidChangeConnectionStatus.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
	}

	configure(config: Partial<AtomSpaceTransportConfig>): void {
		this._config = { ...this._config, ...config };
		this.logService.info(`[AtomSpaceTransportService] Configured with baseUrl=${this._config.baseUrl}`);
	}

	getConfig(): AtomSpaceTransportConfig {
		return { ...this._config };
	}

	isConnected(): boolean {
		return this._connected;
	}

	async healthCheck(): Promise<boolean> {
		this.membraneService.recordActivity('somatic');
		try {
			const response = await fetch(`${this._config.baseUrl}/health`, {
				method: 'GET',
				headers: this._getHeaders(),
				signal: AbortSignal.timeout(this._config.timeoutMs),
			});
			this._setConnected(response.ok);
			return response.ok;
		} catch (error) {
			this.logService.warn(`[AtomSpaceTransportService] Health check failed: ${error}`);
			this._setConnected(false);
			return false;
		}
	}

	async syncHypergraph(
		nodes: ReadonlyArray<HypergraphNodeLike>,
		links: ReadonlyArray<HypergraphLinkLike>
	): Promise<AtomSpaceSyncResult> {
		this.membraneService.recordActivity('somatic');
		const startTime = Date.now();
		const requestId = `atomspace-sync-${++this._requestCounter}-${startTime}`;
		const nodeAtoms = nodes.map(nodeToAtom);
		const linkAtoms = links.map(linkToAtom);

		let result: AtomSpaceSyncResult;
		try {
			const response = await fetch(`${this._config.baseUrl}/ingest/atoms`, {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify({ atoms: { nodes: nodeAtoms, links: linkAtoms } }),
				signal: AbortSignal.timeout(this._config.timeoutMs),
			});

			if (!response.ok) {
				const text = await response.text();
				throw new Error(`AtomSpace bridge returned HTTP ${response.status}: ${text}`);
			}

			await response.json();
			this._setConnected(true);

			result = {
				requestId,
				timestamp: Date.now(),
				nodeCount: nodes.length,
				linkCount: links.length,
				success: true,
				durationMs: Date.now() - startTime,
			};
		} catch (error) {
			this._setConnected(false);
			result = {
				requestId,
				timestamp: Date.now(),
				nodeCount: nodes.length,
				linkCount: links.length,
				success: false,
				error: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - startTime,
			};
			this.logService.warn(`[AtomSpaceTransportService] Sync failed: ${result.error}`);
		}

		this._recordHistory(result);
		this._onDidSync.fire(result);
		return result;
	}

	getSyncHistory(): AtomSpaceSyncResult[] {
		return [...this._history];
	}

	clearHistory(): void {
		this._history.length = 0;
	}

	private _recordHistory(result: AtomSpaceSyncResult): void {
		this._history.push(result);
		if (this._history.length > MAX_HISTORY) {
			this._history.shift();
		}

		this.hypergraphStore.addNode({
			node_type: SYNC_RECORD_NODE_TYPE,
			content: result.success
				? `Synced ${result.nodeCount} nodes / ${result.linkCount} links to AtomSpace bridge`
				: `AtomSpace sync failed: ${result.error}`,
			links: [],
			metadata: {
				requestId: result.requestId,
				success: result.success,
				nodeCount: result.nodeCount,
				linkCount: result.linkCount,
				durationMs: result.durationMs,
				error: result.error,
			},
			salience_score: result.success ? 0.4 : 0.6,
		});
	}

	private _setConnected(connected: boolean): void {
		if (this._connected !== connected) {
			this._connected = connected;
			this._onDidChangeConnectionStatus.fire(connected);
		}
	}

	private _getHeaders(): Record<string, string> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this._config.authToken) {
			headers['Authorization'] = `Bearer ${this._config.authToken}`;
		}
		return headers;
	}
}
