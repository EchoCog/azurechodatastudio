/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseReasonPayload, parseSchemaPayload, parseTablePayload } = require('../out/payloads');

test('validates schema payloads', () => {
	assert.deepEqual(parseSchemaPayload('{"tables":[],"foreign_keys":[]}'), { tables: [], foreign_keys: [] });
	assert.throws(() => parseSchemaPayload('{"tables":{}}'), /"tables" array/);
});

test('validates table payloads', () => {
	const payload = { schema: 'dbo', table: 'users', primary_key: 'id', rows: [] };
	assert.deepEqual(parseTablePayload(JSON.stringify(payload)), payload);
	assert.throws(() => parseTablePayload('{"table":"users","primary_key":[],"rows":[]}'), /primary_key/);
});

test('normalizes a bare atom batch into a reasoning request', () => {
	assert.deepEqual(
		parseReasonPayload('{"nodes":[],"links":[]}'),
		{ atoms: { nodes: [], links: [] }, context: {} }
	);
});

test('validates complete reasoning requests', () => {
	const payload = { atoms: { nodes: [], links: [] }, mode: 'schema', context: { source: 'editor' } };
	assert.deepEqual(parseReasonPayload(JSON.stringify(payload)), payload);
	assert.throws(() => parseReasonPayload('{"atoms":{"nodes":[]}}'), /nodes.*links/);
});
