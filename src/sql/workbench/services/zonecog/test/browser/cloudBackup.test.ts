/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	uploadBackupToCloud,
	downloadBackupFromCloud,
	listCloudBackups,
} from 'sql/workbench/services/zonecog/browser/cloudBackup';
import {
	HypergraphBackup,
	BackupImportResult,
	CloudStorageConfig,
	HYPERGRAPH_BACKUP_FORMAT_VERSION,
} from 'sql/workbench/services/zonecog/common/hypergraphPersistence';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeBackup(full = true): HypergraphBackup {
	return {
		formatVersion: HYPERGRAPH_BACKUP_FORMAT_VERSION,
		createdAt: 1000,
		full,
		nodes: [],
		links: [],
	};
}

function makeConfig(endpointUrl = 'https://backup.example.com'): CloudStorageConfig {
	return {
		endpointUrl,
		authToken: 'test-token',
		prefix: 'my-backups',
		timeoutMs: 5000,
	};
}

class StubPersistenceService {
	lastBackupTimestamp?: number;
	lastImportedBackup?: HypergraphBackup;
	backupToReturn: HypergraphBackup = makeBackup();

	async createBackup(sinceTimestamp?: number): Promise<HypergraphBackup> {
		this.lastBackupTimestamp = sinceTimestamp;
		return this.backupToReturn;
	}

	async importBackup(backup: HypergraphBackup): Promise<BackupImportResult> {
		this.lastImportedBackup = backup;
		return { nodesUpserted: backup.nodes.length, linksUpserted: backup.links.length };
	}
}

// ---------------------------------------------------------------------------
// Fetch interception
// ---------------------------------------------------------------------------

type FetchImpl = typeof globalThis.fetch;

interface CapturedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

let captured: CapturedRequest[] = [];
let fetchResponse: { ok: boolean; status: number; json?: unknown } = { ok: true, status: 200 };
let originalFetch: FetchImpl | undefined;

function installFetchStub(): void {
	originalFetch = globalThis.fetch;
	captured = [];

	(globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
		const req: CapturedRequest = {
			url: String(url),
			method: init?.method ?? 'GET',
			headers: {},
		};
		if (init?.headers) {
			const h = init.headers as Record<string, string>;
			for (const [k, v] of Object.entries(h)) {
				req.headers[k] = v;
			}
		}
		if (init?.body) {
			req.body = String(init.body);
		}
		captured.push(req);
		return {
			ok: fetchResponse.ok,
			status: fetchResponse.status,
			json: async () => fetchResponse.json,
		} as Response;
	};
}

function restoreFetch(): void {
	if (originalFetch !== undefined) {
		globalThis.fetch = originalFetch;
		originalFetch = undefined;
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('cloudBackup', () => {
	setup(() => {
		fetchResponse = { ok: true, status: 200 };
		installFetchStub();
	});

	teardown(() => {
		restoreFetch();
	});

	// -------------------------------------------------------------------
	// uploadBackupToCloud
	// -------------------------------------------------------------------

	suite('uploadBackupToCloud', () => {
		test('returns error when config is undefined', async () => {
			const svc = new StubPersistenceService();
			const result = await uploadBackupToCloud(svc, undefined);
			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('not configured'));
		});

		test('returns error when endpointUrl is empty', async () => {
			const svc = new StubPersistenceService();
			const result = await uploadBackupToCloud(svc, { endpointUrl: '' });
			assert.strictEqual(result.success, false);
		});

		test('uploads a full backup via PUT', async () => {
			const svc = new StubPersistenceService();
			const result = await uploadBackupToCloud(svc, makeConfig());
			assert.strictEqual(result.success, true);
			assert.ok(result.remotePath.startsWith('my-backups/'));
			assert.ok(result.remotePath.includes('-full'));
			assert.ok(result.bytesTransferred > 0);
			assert.ok(result.durationMs >= 0);

			assert.strictEqual(captured.length, 1);
			assert.strictEqual(captured[0].method, 'PUT');
			assert.ok(captured[0].url.startsWith('https://backup.example.com/my-backups/'));
			assert.strictEqual(captured[0].headers['Authorization'], 'Bearer test-token');
			assert.strictEqual(captured[0].headers['Content-Type'], 'application/json');
		});

		test('uses custom remote name when provided', async () => {
			const svc = new StubPersistenceService();
			const result = await uploadBackupToCloud(svc, makeConfig(), undefined, 'my-custom-name.json');
			assert.strictEqual(result.success, true);
			assert.strictEqual(result.remotePath, 'my-backups/my-custom-name.json');
		});

		test('passes sinceTimestamp to createBackup', async () => {
			const svc = new StubPersistenceService();
			svc.backupToReturn = makeBackup(false);
			await uploadBackupToCloud(svc, makeConfig(), 42);
			assert.strictEqual(svc.lastBackupTimestamp, 42);
		});

		test('returns failure on HTTP error', async () => {
			fetchResponse = { ok: false, status: 503 };
			const svc = new StubPersistenceService();
			const warnings: string[] = [];
			const result = await uploadBackupToCloud(svc, makeConfig(), undefined, undefined, (msg) => warnings.push(msg));
			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('503'));
			assert.strictEqual(warnings.length, 1);
		});

		test('returns failure on network error', async () => {
			restoreFetch();
			(globalThis as any).fetch = async () => { throw new Error('network down'); };
			const svc = new StubPersistenceService();
			const result = await uploadBackupToCloud(svc, makeConfig());
			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('network down'));
		});
	});

	// -------------------------------------------------------------------
	// downloadBackupFromCloud
	// -------------------------------------------------------------------

	suite('downloadBackupFromCloud', () => {
		test('throws when config is undefined', async () => {
			const svc = new StubPersistenceService();
			await assert.rejects(
				() => downloadBackupFromCloud(svc, undefined, 'some/path'),
				/not configured/
			);
		});

		test('downloads and imports a backup', async () => {
			const backup = makeBackup();
			fetchResponse = { ok: true, status: 200, json: backup };
			const svc = new StubPersistenceService();
			const result = await downloadBackupFromCloud(svc, makeConfig(), 'my-backups/backup.json');
			assert.strictEqual(result.nodesUpserted, 0);
			assert.strictEqual(result.linksUpserted, 0);
			assert.ok(svc.lastImportedBackup);

			assert.strictEqual(captured.length, 1);
			assert.strictEqual(captured[0].method, 'GET');
			assert.ok(captured[0].url.includes('my-backups/backup.json'));
		});

		test('throws on HTTP error', async () => {
			fetchResponse = { ok: false, status: 404 };
			const svc = new StubPersistenceService();
			await assert.rejects(
				() => downloadBackupFromCloud(svc, makeConfig(), 'missing.json'),
				/404/
			);
		});
	});

	// -------------------------------------------------------------------
	// listCloudBackups
	// -------------------------------------------------------------------

	suite('listCloudBackups', () => {
		test('throws when config is undefined', async () => {
			await assert.rejects(
				() => listCloudBackups(undefined),
				/not configured/
			);
		});

		test('returns array response directly', async () => {
			fetchResponse = { ok: true, status: 200, json: ['backup-1.json', 'backup-2.json'] };
			const result = await listCloudBackups(makeConfig());
			assert.deepStrictEqual(result, ['backup-1.json', 'backup-2.json']);

			assert.strictEqual(captured.length, 1);
			assert.ok(captured[0].url.includes('?list=1'));
		});

		test('extracts items from object response', async () => {
			fetchResponse = { ok: true, status: 200, json: { items: ['a.json'] } };
			const result = await listCloudBackups(makeConfig());
			assert.deepStrictEqual(result, ['a.json']);
		});

		test('returns empty array when items is missing', async () => {
			fetchResponse = { ok: true, status: 200, json: {} };
			const result = await listCloudBackups(makeConfig());
			assert.deepStrictEqual(result, []);
		});

		test('throws on HTTP error', async () => {
			fetchResponse = { ok: false, status: 500 };
			await assert.rejects(
				() => listCloudBackups(makeConfig()),
				/500/
			);
		});
	});
});
