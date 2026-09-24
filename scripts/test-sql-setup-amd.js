/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const setupPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, 'src', 'sql', 'setup.js');
const setupSource = fs.readFileSync(setupPath, 'utf8');
const loadedModules = [];
const commonJsGlobal = {};
const browserGlobal = {
	console,
	PromiseRejectionEvent: function PromiseRejectionEvent() { },
	setImmediate,
	window: undefined,
	global: commonJsGlobal
};
browserGlobal.window = browserGlobal;

let anonymousDefinePending = false;
function amdDefine(_dependencies, factory) {
	if (anonymousDefinePending) {
		throw new Error('Can only have one anonymous define call per script file');
	}

	anonymousDefinePending = true;
	try {
		const nodeRequire = moduleId => {
			loadedModules.push(moduleId);
			assert.strictEqual(browserGlobal.define, undefined, `browser define leaked while loading ${moduleId}`);
			assert.strictEqual(commonJsGlobal.define, undefined, `CommonJS define leaked while loading ${moduleId}`);
			if (moduleId === 'zone.js/dist/zone') {
				browserGlobal.Zone = {};
			}
			return moduleId === 'jquery' ? function jquery() { } : {};
		};
		nodeRequire.__$__nodeRequire = nodeRequire;
		factory.call(browserGlobal, nodeRequire, {});
	} finally {
		anonymousDefinePending = false;
	}
}
amdDefine.amd = {};
browserGlobal.define = amdDefine;
commonJsGlobal.define = amdDefine;

vm.runInNewContext(setupSource, browserGlobal, { filename: 'src/sql/setup.js' });

assert.strictEqual(browserGlobal.define, amdDefine, 'browser define was not restored');
assert.strictEqual(commonJsGlobal.define, amdDefine, 'CommonJS define was not restored');
assert.ok(loadedModules.includes('zone.js/dist/zone'), 'zone.js was not loaded');
assert.ok(loadedModules.includes('zone.js/dist/zone-error'), 'zone-error.js was not loaded');
console.log(`SQL setup loaded ${loadedModules.length} UMD modules without leaking the AMD loader.`);
