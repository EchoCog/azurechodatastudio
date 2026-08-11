/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IHypergraphPersistenceService,
	HypergraphBackup,
	BackupImportResult,
	CloudStorageConfig,
	CloudBackupResult,
} from 'sql/workbench/services/zonecog/common/hypergraphPersistence';

function cloudBase(config: CloudStorageConfig): {
	base: string;
	prefix: string;
	headers: Record<string, string>;
	timeoutMs: number;
} {
	const base = config.endpointUrl.replace(/\/+$/, '');
	const prefix = (config.prefix ?? 'zonecog-backups').replace(/^\/+|\/+$/g, '');
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Accept': 'application/json',
	};
	if (config.authToken) {
		headers['Authorization'] = 'Bearer ' + config.authToken;
	}
	return { base, prefix, headers, timeoutMs: config.timeoutMs ?? 30_000 };
}

/**
 * Create a backup and PUT it to the configured HTTP cloud endpoint.
 * Returns a structured result (never throws for transport failures).
 */
export async function uploadBackupToCloud(
	service: Pick<IHypergraphPersistenceService, 'createBackup'>,
	config: CloudStorageConfig | undefined,
	sinceTimestamp?: number,
	remoteName?: string,
	onWarn?: (msg: string) => void,
): Promise<CloudBackupResult> {
	if (!config?.endpointUrl) {
		return {
			success: false,
			remotePath: '',
			bytesTransferred: 0,
			durationMs: 0,
			error: 'Cloud storage is not configured',
		};
	}
	const started = Date.now();
	const { base, prefix, headers, timeoutMs } = cloudBase(config);
	const backup = await service.createBackup(sinceTimestamp);
	const name = remoteName ?? `backup-${backup.createdAt}${backup.full ? '-full' : '-incr'}.json`;
	const remotePath = `${prefix}/${name}`;
	const body = JSON.stringify(backup);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${base}/${remotePath}`, {
			method: 'PUT',
			headers,
			body,
			signal: controller.signal,
		});
		if (!response.ok) {
			const error = `Cloud upload failed: HTTP ${response.status}`;
			onWarn?.(error);
			return {
				success: false,
				remotePath,
				bytesTransferred: body.length,
				durationMs: Date.now() - started,
				error,
			};
		}
		return {
			success: true,
			remotePath,
			bytesTransferred: body.length,
			durationMs: Date.now() - started,
		};
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		onWarn?.(error);
		return {
			success: false,
			remotePath,
			bytesTransferred: body.length,
			durationMs: Date.now() - started,
			error,
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * GET a backup JSON document from the cloud endpoint and apply it.
 */
export async function downloadBackupFromCloud(
	service: Pick<IHypergraphPersistenceService, 'importBackup'>,
	config: CloudStorageConfig | undefined,
	remotePath: string,
): Promise<BackupImportResult> {
	if (!config?.endpointUrl) {
		throw new Error('Cloud storage is not configured');
	}
	const { base, headers, timeoutMs } = cloudBase(config);
	const path = remotePath.replace(/^\/+/, '');
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${base}/${path}`, {
			method: 'GET',
			headers,
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Cloud download failed: HTTP ${response.status}`);
		}
		const backup = await response.json() as HypergraphBackup;
		return service.importBackup(backup);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * List backup object names under the configured cloud prefix.
 * Expects either a JSON string array or `{ items: string[] }`.
 */
export async function listCloudBackups(config: CloudStorageConfig | undefined): Promise<string[]> {
	if (!config?.endpointUrl) {
		throw new Error('Cloud storage is not configured');
	}
	const { base, prefix, headers, timeoutMs } = cloudBase(config);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${base}/${prefix}?list=1`, {
			method: 'GET',
			headers,
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Cloud list failed: HTTP ${response.status}`);
		}
		const payload = await response.json() as { items?: string[] } | string[];
		if (Array.isArray(payload)) { return payload; }
		return payload.items ?? [];
	} finally {
		clearTimeout(timer);
	}
}
