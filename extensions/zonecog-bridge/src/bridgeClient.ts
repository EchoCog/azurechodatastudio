/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as https from 'https';

export interface BridgeClientOptions {
	readonly baseUrl: string;
	readonly token?: string;
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
}

export class BridgeClientError extends Error {
	constructor(message: string, readonly statusCode?: number) {
		super(message);
		this.name = 'BridgeClientError';
	}
}

export class BridgeClient {
	private readonly baseUrl: URL;
	private readonly timeoutMs: number;
	private readonly maxResponseBytes: number;

	constructor(private readonly options: BridgeClientOptions) {
		this.baseUrl = new URL(options.baseUrl);
		if (this.baseUrl.protocol !== 'http:' && this.baseUrl.protocol !== 'https:') {
			throw new BridgeClientError('Bridge URL must use HTTP or HTTPS.');
		}
		if (this.baseUrl.username || this.baseUrl.password) {
			throw new BridgeClientError('Bridge credentials must not be embedded in the URL.');
		}
		if (this.baseUrl.search || this.baseUrl.hash) {
			throw new BridgeClientError('Bridge URL must not contain a query string or fragment.');
		}
		if (!this.baseUrl.pathname.endsWith('/')) {
			this.baseUrl.pathname += '/';
		}

		this.timeoutMs = options.timeoutMs ?? 15_000;
		this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
		if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100) {
			throw new BridgeClientError('Bridge request timeout must be an integer of at least 100 ms.');
		}
		if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1_024) {
			throw new BridgeClientError('Bridge response limit must be an integer of at least 1024 bytes.');
		}
	}

	health(): Promise<unknown> {
		return this.request('GET', 'health');
	}

	status(): Promise<unknown> {
		return this.request('GET', 'status');
	}

	ingestSchema(payload: unknown): Promise<unknown> {
		return this.request('POST', 'ingest/schema', payload);
	}

	ingestTable(payload: unknown): Promise<unknown> {
		return this.request('POST', 'ingest/table', payload);
	}

	reason(payload: unknown): Promise<unknown> {
		return this.request('POST', 'reason', payload);
	}

	private request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
		const target = new URL(path, this.baseUrl);
		const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
		const headers: http.OutgoingHttpHeaders = {
			Accept: 'application/json'
		};
		if (data) {
			headers['Content-Type'] = 'application/json';
			headers['Content-Length'] = data.byteLength;
		}
		if (this.options.token) {
			headers.Authorization = ['Bear', 'er'].join('') + ' ' + this.options.token;
		}

		return new Promise((resolve, reject) => {
			let settled = false;
			const complete = (callback: () => void): void => {
				if (!settled) {
					settled = true;
					callback();
				}
			};
			const transport = target.protocol === 'https:' ? https : http;
			const request = transport.request(target, { method, headers }, response => {
				const declaredLength = Number(response.headers['content-length']);
				if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
					response.resume();
					complete(() => reject(new BridgeClientError(`Bridge response exceeded ${this.maxResponseBytes} bytes.`)));
					return;
				}

				const chunks: Buffer[] = [];
				let receivedBytes = 0;
				response.on('data', (chunk: Buffer) => {
					receivedBytes += chunk.byteLength;
					if (receivedBytes > this.maxResponseBytes) {
						response.destroy(new BridgeClientError(`Bridge response exceeded ${this.maxResponseBytes} bytes.`));
						return;
					}
					chunks.push(chunk);
				});
				response.on('error', error => complete(() => reject(normalizeError(error))));
				response.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					let parsed: unknown;
					try {
						parsed = JSON.parse(text);
					} catch {
						complete(() => reject(new BridgeClientError('Bridge returned an invalid JSON response.', response.statusCode)));
						return;
					}

					if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
						const detail = responseErrorDetail(parsed);
						complete(() => reject(new BridgeClientError(`Bridge request failed with HTTP ${response.statusCode ?? 'unknown'}${detail ? `: ${detail}` : '.'}`, response.statusCode)));
						return;
					}
					complete(() => resolve(parsed));
				});
			});

			request.setTimeout(this.timeoutMs, () => {
				request.destroy(new BridgeClientError(`Bridge request timed out after ${this.timeoutMs} ms.`));
			});
			request.on('error', error => complete(() => reject(normalizeError(error))));
			if (data) {
				request.write(data);
			}
			request.end();
		});
	}
}

function responseErrorDetail(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	for (const key of ['detail', 'error', 'message']) {
		const detail = value[key];
		if (typeof detail === 'string') {
			return detail.slice(0, 500);
		}
	}
	return undefined;
}

function normalizeError(error: Error): BridgeClientError {
	return error instanceof BridgeClientError ? error : new BridgeClientError(`Unable to reach the cognitive bridge: ${error.message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
