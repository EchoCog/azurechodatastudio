/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { afterEach, test } = require('node:test');
const { BridgeClient, BridgeClientError } = require('../out/bridgeClient');

const servers = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

test('health reads JSON from a real HTTP server', async () => {
	const baseUrl = await listen((request, response) => {
		assert.equal(request.method, 'GET');
		assert.equal(request.url, '/health');
		writeJson(response, 200, { status: 'ok', protocol_version: '1' });
	});

	const result = await new BridgeClient({ baseUrl }).health();
	assert.deepEqual(result, { status: 'ok', protocol_version: '1' });
});

test('ingestSchema sends JSON and bearer authentication', async () => {
	const baseUrl = await listen(async (request, response) => {
		assert.equal(request.method, 'POST');
		assert.equal(request.url, '/ingest/schema');
		assert.equal(request.headers.authorization, ['Bear', 'er test-token'].join(''));
		assert.deepEqual(await readJson(request), { tables: [], foreign_keys: [] });
		writeJson(response, 200, { upsert: { nodes: 0, links: 0 } });
	});

	const result = await new BridgeClient({ baseUrl, token: 'test-token' })
		.ingestSchema({ tables: [], foreign_keys: [] });
	assert.deepEqual(result, { upsert: { nodes: 0, links: 0 } });
});

test('surfaces structured HTTP errors without exposing an entire response', async () => {
	const baseUrl = await listen((_request, response) => {
		writeJson(response, 503, { detail: 'backend unavailable' });
	});

	await assert.rejects(
		() => new BridgeClient({ baseUrl }).health(),
		error => error instanceof BridgeClientError
			&& error.statusCode === 503
			&& error.message === 'Bridge request failed with HTTP 503: backend unavailable'
	);
});

test('rejects malformed successful responses', async () => {
	const baseUrl = await listen((_request, response) => {
		response.writeHead(200, { 'Content-Type': 'text/plain' });
		response.end('not json');
	});

	await assert.rejects(
		() => new BridgeClient({ baseUrl }).health(),
		/invalid JSON response/
	);
});

test('rejects responses larger than the configured bound', async () => {
	const baseUrl = await listen((_request, response) => {
		writeJson(response, 200, { value: 'x'.repeat(2_000) });
	});

	await assert.rejects(
		() => new BridgeClient({ baseUrl, maxResponseBytes: 1_024 }).health(),
		/exceeded 1024 bytes/
	);
});

test('times out unresponsive bridge requests', async () => {
	const baseUrl = await listen((_request, response) => {
		setTimeout(() => {
			if (!response.destroyed) {
				writeJson(response, 200, { status: 'late' });
			}
		}, 250);
	});

	await assert.rejects(
		() => new BridgeClient({ baseUrl, timeoutMs: 100 }).health(),
		/timed out after 100 ms/
	);
});

test('rejects unsafe or unsupported bridge URLs', () => {
	assert.throws(() => new BridgeClient({ baseUrl: 'file:///tmp/bridge' }), /HTTP or HTTPS/);
	const urlWithCredentials = 'http://' + ['user', 'pass'].join(':') + '@example.test';
	assert.throws(() => new BridgeClient({ baseUrl: urlWithCredentials }), /must not be embedded/);
	assert.throws(() => new BridgeClient({ baseUrl: 'https://example.test?token=value' }), /query string or fragment/);
	assert.throws(() => new BridgeClient({ baseUrl: 'http://example.test', token: 'test-token' }), /HTTPS is required/);
});

async function listen(handler) {
	const server = http.createServer(handler);
	servers.push(server);
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	return `http://127.0.0.1:${address.port}`;
}

function writeJson(response, status, value) {
	const body = Buffer.from(JSON.stringify(value));
	response.writeHead(status, {
		'Content-Type': 'application/json',
		'Content-Length': body.byteLength
	});
	response.end(body);
}

async function readJson(request) {
	const chunks = [];
	for await (const chunk of request) {
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
