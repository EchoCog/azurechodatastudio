/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(extensionRoot, 'package.json');

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileExists(relativePath) {
	return fs.existsSync(path.join(extensionRoot, relativePath));
}

function readPngSize(relativePath) {
	const buffer = fs.readFileSync(path.join(extensionRoot, relativePath));
	assert.strictEqual(buffer.toString('ascii', 1, 4), 'PNG', `${relativePath} must be a PNG`);
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20)
	};
}

describe('marketplace readiness', () => {
	const manifest = readJson(packageJsonPath);

	it('has required marketplace identity fields', () => {
		assert.strictEqual(manifest.name, 'zonecog-bridge');
		assert.strictEqual(manifest.publisher, 'EchoCog');
		assert.strictEqual(manifest.displayName, 'Zone-Cog Cognitive Bridge');
		assert.ok(manifest.description && manifest.description.length >= 20, 'description should be informative');
		assert.ok(manifest.version && /^\d+\.\d+\.\d+$/.test(manifest.version), 'version must be semver X.Y.Z');
		assert.strictEqual(manifest.license, 'MIT');
		assert.ok(manifest.repository && manifest.repository.url, 'repository.url is required');
		assert.ok(manifest.engines && manifest.engines.vscode, 'engines.vscode is required');
		assert.ok(Array.isArray(manifest.categories) && manifest.categories.length > 0, 'categories required');
		assert.ok(manifest.categories.includes('Machine Learning'), 'Machine Learning category expected');
	});

	it('ships icon and gallery banner metadata', () => {
		assert.strictEqual(manifest.icon, 'media/icon.png');
		assert.ok(fileExists(manifest.icon), 'icon file missing');
		const iconSize = readPngSize(manifest.icon);
		assert.strictEqual(iconSize.width, 128, 'marketplace icon must be 128px wide');
		assert.strictEqual(iconSize.height, 128, 'marketplace icon must be 128px tall');
		assert.ok(manifest.galleryBanner, 'galleryBanner required');
		assert.strictEqual(manifest.galleryBanner.theme, 'dark');
		assert.ok(/^#[0-9A-Fa-f]{6}$/.test(manifest.galleryBanner.color), 'galleryBanner.color must be hex');
	});

	it('includes README screenshots and packaging assets', () => {
		for (const relativePath of [
			'README.md',
			'CHANGELOG.md',
			'LICENSE',
			'.vscodeignore',
			'media/banner.png',
			'media/screenshot-commands.png',
			'media/screenshot-output.png',
			'media/screenshot-settings.png'
		]) {
			assert.ok(fileExists(relativePath), `missing ${relativePath}`);
		}

		const readme = fs.readFileSync(path.join(extensionRoot, 'README.md'), 'utf8');
		assert.ok(readme.includes('media/banner.png'), 'README should reference banner');
		assert.ok(readme.includes('media/screenshot-commands.png'), 'README should reference command screenshot');
		assert.ok(readme.includes('## Commands'), 'README should document commands');
		assert.ok(readme.includes('## Configuration'), 'README should document configuration');
		assert.ok(readme.includes('## Publishing'), 'README should document publishing');

		const changelog = fs.readFileSync(path.join(extensionRoot, 'CHANGELOG.md'), 'utf8');
		assert.ok(changelog.includes(`## [${manifest.version}]`) || changelog.includes(`## ${manifest.version}`),
			`CHANGELOG must include release notes for ${manifest.version}`);
	});

	it('registers all commands with Zone-Cog category and matching activation events', () => {
		const commands = manifest.contributes && manifest.contributes.commands;
		assert.ok(Array.isArray(commands) && commands.length >= 5, 'expected at least 5 commands');

		const expected = [
			'zonecog.checkBridgeHealth',
			'zonecog.ingestSchema',
			'zonecog.ingestActiveTable',
			'zonecog.runCognitiveAnalysis',
			'zonecog.setBridgeAuthToken'
		];

		const byId = new Map(commands.map(command => [command.command, command]));
		for (const id of expected) {
			const command = byId.get(id);
			assert.ok(command, `missing command ${id}`);
			assert.strictEqual(command.category, 'Zone-Cog', `${id} must use Zone-Cog category`);
			assert.ok(command.title && command.title.trim().length > 0, `${id} needs a title`);
			assert.ok(
				(manifest.activationEvents || []).includes(`onCommand:${id}`),
				`${id} must be listed in activationEvents`
			);
		}
	});

	it('exposes bridge configuration with safe defaults', () => {
		const properties = manifest.contributes.configuration.properties;
		assert.strictEqual(properties['zonecog.bridge.baseUrl'].default, 'http://127.0.0.1:7807');
		assert.strictEqual(properties['zonecog.bridge.requestTimeout'].default, 15000);
		assert.strictEqual(properties['zonecog.bridge.maxResponseBytes'].default, 1048576);
		assert.strictEqual(properties['zonecog.bridge.authToken'], undefined,
			'auth tokens must not be contributed as settings');
	});

	it('defines packaging and pre-publish scripts', () => {
		assert.ok(manifest.scripts['vscode:prepublish'], 'vscode:prepublish required');
		assert.ok(manifest.scripts.package, 'package script required');
		assert.ok(manifest.scripts['package:dry-run'], 'package:dry-run script required');
		assert.ok(manifest.scripts['validate:marketplace'], 'validate:marketplace script required');
		assert.ok(manifest.scripts['prepublish:check'], 'prepublish:check script required');
		assert.ok(manifest.scripts.package.includes('@vscode/vsce'), 'package should invoke vsce');
		assert.ok(manifest.scripts['package:dry-run'].includes('@vscode/vsce'), 'dry-run should invoke vsce');
	});

	it('excludes sources and tests from the VSIX via .vscodeignore', () => {
		const ignore = fs.readFileSync(path.join(extensionRoot, '.vscodeignore'), 'utf8');
		for (const entry of ['src/**', 'test/**', '**/*.map', 'yarn.lock']) {
			assert.ok(ignore.includes(entry), `.vscodeignore should exclude ${entry}`);
		}
	});
});
