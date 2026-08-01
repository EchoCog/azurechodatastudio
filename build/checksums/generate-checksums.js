/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Generate SHA256 checksum for a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} - SHA256 hash in hex format
 */
async function generateChecksum(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);

		stream.on('data', (data) => hash.update(data));
		stream.on('end', () => resolve(hash.digest('hex')));
		stream.on('error', reject);
	});
}

/**
 * Generate checksums for all release artifacts in a directory
 * @param {string} artifactsDir - Directory containing artifacts
 * @param {string} outputDir - Directory to write checksum files
 */
async function generateChecksums(artifactsDir, outputDir) {
	const extensions = ['.zip', '.tar.gz', '.deb', '.rpm', '.exe', '.dmg', '.app'];

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const files = fs.readdirSync(artifactsDir, { recursive: true });
	const checksums = [];

	for (const file of files) {
		const filePath = path.join(artifactsDir, file);

		if (fs.statSync(filePath).isFile()) {
			const ext = path.extname(filePath).toLowerCase();
			const hasMatchingExt = extensions.some(e =>
				filePath.toLowerCase().endsWith(e)
			);

			if (hasMatchingExt) {
				console.log(`Generating checksum for: ${file}`);
				const checksum = await generateChecksum(filePath);
				const checksumFile = path.join(outputDir, `${path.basename(file)}.sha256`);

				fs.writeFileSync(checksumFile, `${checksum}  ${path.basename(file)}\n`);
				checksums.push({ file: path.basename(file), checksum });
			}
		}
	}

	// Write combined checksums file
	const combinedPath = path.join(outputDir, 'SHA256SUMS.txt');
	const combinedContent = checksums
		.map(({ checksum, file }) => `${checksum}  ${file}`)
		.join('\n');
	fs.writeFileSync(combinedPath, combinedContent + '\n');

	console.log(`\nGenerated ${checksums.length} checksums`);
	console.log(`Combined checksums written to: ${combinedPath}`);

	return checksums;
}

/**
 * Verify checksums for artifacts
 * @param {string} checksumsFile - Path to SHA256SUMS.txt
 * @param {string} artifactsDir - Directory containing artifacts
 */
async function verifyChecksums(checksumsFile, artifactsDir) {
	const content = fs.readFileSync(checksumsFile, 'utf8');
	const lines = content.trim().split('\n');
	let allValid = true;

	for (const line of lines) {
		const [expectedHash, filename] = line.split(/\s+/);
		const filePath = path.join(artifactsDir, filename);

		if (!fs.existsSync(filePath)) {
			console.log(`❌ MISSING: ${filename}`);
			allValid = false;
			continue;
		}

		const actualHash = await generateChecksum(filePath);

		if (actualHash === expectedHash) {
			console.log(`✓ VALID: ${filename}`);
		} else {
			console.log(`❌ INVALID: ${filename}`);
			console.log(`  Expected: ${expectedHash}`);
			console.log(`  Actual:   ${actualHash}`);
			allValid = false;
		}
	}

	return allValid;
}

// CLI interface
if (require.main === module) {
	const args = process.argv.slice(2);
	const command = args[0];

	if (command === 'generate') {
		const artifactsDir = args[1] || '.build';
		const outputDir = args[2] || 'build/checksums/output';

		generateChecksums(artifactsDir, outputDir)
			.then(() => console.log('Done!'))
			.catch((err) => {
				console.error('Error:', err);
				process.exit(1);
			});
	} else if (command === 'verify') {
		const checksumsFile = args[1];
		const artifactsDir = args[2];

		if (!checksumsFile || !artifactsDir) {
			console.error('Usage: node generate-checksums.js verify <SHA256SUMS.txt> <artifacts-dir>');
			process.exit(1);
		}

		verifyChecksums(checksumsFile, artifactsDir)
			.then((valid) => {
				if (!valid) {
					process.exit(1);
				}
				console.log('\nAll checksums valid!');
			})
			.catch((err) => {
				console.error('Error:', err);
				process.exit(1);
			});
	} else {
		console.log('Usage:');
		console.log('  node generate-checksums.js generate [artifacts-dir] [output-dir]');
		console.log('  node generate-checksums.js verify <SHA256SUMS.txt> <artifacts-dir>');
		process.exit(1);
	}
}

module.exports = { generateChecksum, generateChecksums, verifyChecksums };
