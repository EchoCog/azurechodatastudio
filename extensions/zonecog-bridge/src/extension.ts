/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BridgeClient } from './bridgeClient';
import { parseReasonPayload, parseSchemaPayload, parseTablePayload } from './payloads';

const secretKey = 'zonecog.bridge.authToken';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('Zone-Cog');
	context.subscriptions.push(output);

	await migrateLegacyToken(context);
	registerBridgeCommand(context, output, 'zonecog.checkBridgeHealth', 'Checking cognitive bridge health', async client => client.health());
	registerJsonCommand(context, output, 'zonecog.ingestSchema', 'Ingesting database schema', 'Paste a schema payload with tables and foreign_keys arrays', parseSchemaPayload, (client, payload) => client.ingestSchema(payload));
	registerJsonCommand(context, output, 'zonecog.ingestActiveTable', 'Ingesting table data', 'Paste a table payload with table, primary_key, and rows', parseTablePayload, (client, payload) => client.ingestTable(payload));
	registerJsonCommand(context, output, 'zonecog.runCognitiveAnalysis', 'Running cognitive analysis', 'Paste an atom batch or reasoning request', parseReasonPayload, (client, payload) => client.reason(payload));
	context.subscriptions.push(vscode.commands.registerCommand('zonecog.setBridgeAuthToken', () => setAuthToken(context)));
}

export function deactivate(): void {
	// Resources registered in the extension context are disposed by the host.
}

function registerBridgeCommand(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	command: string,
	title: string,
	operation: (client: BridgeClient) => Promise<unknown>
): void {
	context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
		try {
			const result = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Zone-Cog: ${title}`,
				cancellable: false
			}, async () => operation(await createClient(context)));
			showResult(output, title, result);
		} catch (error) {
			await showCommandError(output, error);
		}
	}));
}

function registerJsonCommand(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	command: string,
	title: string,
	prompt: string,
	parse: (input: string) => Record<string, unknown>,
	operation: (client: BridgeClient, payload: Record<string, unknown>) => Promise<unknown>
): void {
	context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
		try {
			const input = await readJsonInput(prompt);
			if (input === undefined) {
				return;
			}
			const payload = parse(input);
			const result = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Zone-Cog: ${title}`,
				cancellable: false
			}, async () => operation(await createClient(context), payload));
			showResult(output, title, result);
		} catch (error) {
			await showCommandError(output, error);
		}
	}));
}

async function readJsonInput(prompt: string): Promise<string | undefined> {
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const selection = editor.document.getText(editor.selection).trim();
		if (selection) {
			return selection;
		}
		if (editor.document.languageId === 'json') {
			const document = editor.document.getText().trim();
			if (document) {
				return document;
			}
		}
	}
	return vscode.window.showInputBox({
		prompt,
		placeHolder: 'JSON payload',
		ignoreFocusOut: true,
		validateInput: value => value.trim() ? undefined : 'A JSON payload is required.'
	});
}

async function createClient(context: vscode.ExtensionContext): Promise<BridgeClient> {
	const configuration = vscode.workspace.getConfiguration('zonecog.bridge');
	return new BridgeClient({
		baseUrl: configuration.get<string>('baseUrl', 'http://127.0.0.1:7807'),
		token: await context.secrets.get(secretKey),
		timeoutMs: configuration.get<number>('requestTimeout', 15_000),
		maxResponseBytes: configuration.get<number>('maxResponseBytes', 1_048_576)
	});
}

async function setAuthToken(context: vscode.ExtensionContext): Promise<void> {
	const token = await vscode.window.showInputBox({
		prompt: 'Enter the bearer token used by your ZoneCog bridge or leave empty to clear it',
		password: true,
		ignoreFocusOut: true
	});
	if (token === undefined) {
		return;
	}
	if (token.trim()) {
		await context.secrets.store(secretKey, token.trim());
		await vscode.window.showInformationMessage('Zone-Cog bridge token stored securely.');
	} else {
		await context.secrets.delete(secretKey);
		await vscode.window.showInformationMessage('Zone-Cog bridge token cleared.');
	}
}

async function migrateLegacyToken(context: vscode.ExtensionContext): Promise<void> {
	const configuration = vscode.workspace.getConfiguration('zonecog.bridge');
	const legacyToken = configuration.get<string>('authToken');
	if (!legacyToken) {
		return;
	}
	if (!await context.secrets.get(secretKey)) {
		await context.secrets.store(secretKey, legacyToken);
	}

	const inspected = configuration.inspect<string>('authToken');
	const updates: Thenable<void>[] = [];
	if (inspected?.globalValue !== undefined) {
		updates.push(configuration.update('authToken', undefined, vscode.ConfigurationTarget.Global));
	}
	if (inspected?.workspaceValue !== undefined) {
		updates.push(configuration.update('authToken', undefined, vscode.ConfigurationTarget.Workspace));
	}
	if (inspected?.workspaceFolderValue !== undefined) {
		updates.push(configuration.update('authToken', undefined, vscode.ConfigurationTarget.WorkspaceFolder));
	}
	await Promise.all(updates);
}

function showResult(output: vscode.OutputChannel, operation: string, result: unknown): void {
	output.appendLine(`[${new Date().toISOString()}] ${operation}`);
	output.appendLine(JSON.stringify(result, null, 2));
	output.appendLine('');
	output.show(true);
	void vscode.window.showInformationMessage(`Zone-Cog: ${operation} completed.`);
}

async function showCommandError(output: vscode.OutputChannel, error: unknown): Promise<void> {
	const message = error instanceof Error ? error.message : String(error);
	output.appendLine(`[${new Date().toISOString()}] Error: ${message}`);
	output.show(true);
	await vscode.window.showErrorMessage(`Zone-Cog: ${message}`);
}
