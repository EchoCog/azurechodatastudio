"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Computes SHA256 checksums for release artifacts (Part 5.3 of the release
 * build plan: "Checksum Generation - SHA256 checksums for all artifacts").
 *
 * Standalone script - no gulp/vinyl-fs dependency, so it can run with a bare
 * `node` on any published artifact directory without pulling in the full
 * build toolchain.
 *
 * Usage:
 *   node build/azure-pipelines/computeChecksums.js <artifactDir> [outDir]
 *
 * Writes, into <outDir> (default: <artifactDir>):
 *   - SHA256SUMS.txt        one `<hash>  <filename>` line per artifact,
 *                           compatible with `sha256sum -c SHA256SUMS.txt`
 *   - <filename>.sha256     one file per artifact, containing just the hash
 *                           (matches the individual-file convention already
 *                           used for other pinned-tool hashes under
 *                           build/checksums/)
 *
 * This script is intentionally not wired into any Azure Pipelines/GitHub
 * Actions YAML - invoking it as a release step is a CI/CD change that
 * should be reviewed and applied deliberately by a maintainer, at the
 * point in sql-release.yml / product-publish.yml where each platform's
 * artifacts are staged for publishing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeSha256(filePath) {
	const hash = crypto.createHash('sha256');
	hash.update(fs.readFileSync(filePath));
	return hash.digest('hex');
}

function listArtifactFiles(artifactDir) {
	return fs.readdirSync(artifactDir, { withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => entry.name)
		.sort();
}

function computeChecksums(artifactDir, outDir) {
	if (!fs.existsSync(artifactDir) || !fs.statSync(artifactDir).isDirectory()) {
		throw new Error(`Artifact directory does not exist: ${artifactDir}`);
	}
	fs.mkdirSync(outDir, { recursive: true });

	const files = listArtifactFiles(artifactDir);
	const results = files.map(name => ({ name, sha256: computeSha256(path.join(artifactDir, name)) }));

	const combinedPath = path.join(outDir, 'SHA256SUMS.txt');
	const combined = results.map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n') + (results.length ? '\n' : '');
	fs.writeFileSync(combinedPath, combined, 'utf8');

	for (const { name, sha256 } of results) {
		fs.writeFileSync(path.join(outDir, `${name}.sha256`), `${sha256}\n`, 'utf8');
	}

	return results;
}

function main() {
	const [, , artifactDirArg, outDirArg] = process.argv;
	if (!artifactDirArg) {
		console.error('Usage: node computeChecksums.js <artifactDir> [outDir]');
		process.exit(1);
	}

	const artifactDir = path.resolve(artifactDirArg);
	const outDir = path.resolve(outDirArg || artifactDirArg);

	const results = computeChecksums(artifactDir, outDir);

	if (results.length === 0) {
		console.warn(`No files found in ${artifactDir}`);
	} else {
		for (const { name, sha256 } of results) {
			console.log(`${sha256}  ${name}`);
		}
		console.log(`\nWrote ${results.length} checksum(s) to ${path.join(outDir, 'SHA256SUMS.txt')}`);
	}
}

module.exports = { computeSha256, computeChecksums, listArtifactFiles };

if (require.main === module) {
	main();
}
