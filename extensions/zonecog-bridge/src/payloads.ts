/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type JsonRecord = Record<string, unknown>;

export function parseSchemaPayload(input: string): JsonRecord {
	const payload = parseRecord(input, 'schema');
	requireArray(payload, 'tables', 'Schema payload');
	if (payload.foreign_keys !== undefined) {
		requireArray(payload, 'foreign_keys', 'Schema payload');
	}
	return payload;
}

export function parseTablePayload(input: string): JsonRecord {
	const payload = parseRecord(input, 'table');
	if (typeof payload.table !== 'string' || !payload.table.trim()) {
		throw new Error('Table payload must contain a non-empty "table" string.');
	}
	if (!isPrimaryKey(payload.primary_key)) {
		throw new Error('Table payload must contain "primary_key" as a string or non-empty string array.');
	}
	requireArray(payload, 'rows', 'Table payload');
	if (payload.schema !== undefined && payload.schema !== null && typeof payload.schema !== 'string') {
		throw new Error('Table payload "schema" must be a string or null.');
	}
	return payload;
}

export function parseReasonPayload(input: string): JsonRecord {
	const payload = parseRecord(input, 'reasoning');
	if (isAtomBatch(payload)) {
		return { atoms: payload, context: {} };
	}
	if (!isRecord(payload.atoms) || !isAtomBatch(payload.atoms)) {
		throw new Error('Reasoning payload must be an atom batch or contain an "atoms" batch with "nodes" and "links" arrays.');
	}
	if (payload.mode !== undefined && payload.mode !== null && typeof payload.mode !== 'string') {
		throw new Error('Reasoning payload "mode" must be a string or null.');
	}
	if (payload.context !== undefined && payload.context !== null && !isRecord(payload.context)) {
		throw new Error('Reasoning payload "context" must be an object or null.');
	}
	return payload;
}

function parseRecord(input: string, label: string): JsonRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	} catch {
		throw new Error(`Invalid ${label} JSON.`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`${capitalize(label)} payload must be a JSON object.`);
	}
	return parsed;
}

function requireArray(payload: JsonRecord, key: string, label: string): void {
	if (!Array.isArray(payload[key])) {
		throw new Error(`${label} must contain a "${key}" array.`);
	}
}

function isPrimaryKey(value: unknown): boolean {
	return (typeof value === 'string' && value.trim().length > 0)
		|| (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim().length > 0));
}

function isAtomBatch(value: JsonRecord): boolean {
	return Array.isArray(value.nodes) && Array.isArray(value.links);
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
