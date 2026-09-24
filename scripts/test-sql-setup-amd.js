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
const zoneSource = fs.readFileSync(require.resolve('zone.js/dist/zone'), 'utf8');
const loadedModules = [];
const commonJsGlobal = {};
const loaderGlobal = {};
let loaderContext;
function NodeModule() { }
const browserGlobal = {
	addEventListener: function addEventListener() { },
	console,
	clearInterval,
	clearTimeout,
	dispatchEvent: function dispatchEvent() { },
	Promise,
	PromiseRejectionEvent: function PromiseRejectionEvent() { },
	removeEventListener: function removeEventListener() { },
	setInterval,
	setImmediate,
	setTimeout,
	window: undefined,
	global: commonJsGlobal
};
browserGlobal.window = browserGlobal;
loaderGlobal.window = browserGlobal;
loaderGlobal.self = browserGlobal;
loaderGlobal.global = commonJsGlobal;
loaderGlobal.exports = {};
loaderGlobal.require = function require() { };
loaderGlobal.module = { exports: loaderGlobal.exports };
loaderGlobal.__filename = require.resolve('zone.js/dist/zone');
loaderGlobal.__dirname = path.dirname(loaderGlobal.__filename);
Object.defineProperty(loaderGlobal, 'Zone', {
	configurable: true,
	get: () => browserGlobal.Zone,
	set: value => browserGlobal.Zone = value
});
NodeModule.prototype._compile = function (content, filename) {
	return vm.runInContext(`(function () {\n${content}\n}).call(this);`, loaderContext, { filename });
};

let anonymousDefinePending = false;
function amdDefine(_dependencies, factory) {
	if (anonymousDefinePending) {
		throw new Error('Can only have one anonymous define call per script file');
	}

	anonymousDefinePending = true;
	try {
		const nodeRequire = moduleId => {
			loadedModules.push(moduleId);
			if (moduleId === 'module') {
				return NodeModule;
			}
			if (moduleId === 'jquery') {
				return function jquery() { };
			}
			if (moduleId === 'zone.js/dist/zone') {
				return NodeModule.prototype._compile(zoneSource, require.resolve(moduleId));
			}
			return {};
		};
		nodeRequire.__$__nodeRequire = nodeRequire;
		factory.call(loaderGlobal, nodeRequire, {});
	} finally {
		anonymousDefinePending = false;
	}
}
amdDefine.amd = {};
loaderGlobal.define = amdDefine;
browserGlobal.define = amdDefine;
commonJsGlobal.define = amdDefine;
loaderGlobal.__amdDefine = amdDefine;
loaderContext = vm.createContext(loaderGlobal);
vm.runInContext('let define = __amdDefine;', loaderContext);

vm.runInNewContext(setupSource, browserGlobal, { filename: 'src/sql/setup.js' });

assert.strictEqual(loaderGlobal.define, amdDefine, 'loader define was not restored');
assert.strictEqual(browserGlobal.define, amdDefine, 'browser define was not restored');
assert.strictEqual(commonJsGlobal.define, amdDefine, 'CommonJS define was not restored');
assert.ok(loadedModules.includes('zone.js/dist/zone'), 'zone.js was not loaded');
assert.ok(loadedModules.includes('zone.js/dist/zone-error'), 'zone-error.js was not loaded');
console.log('SQL setup loaded real zone.js without exposing the AMD loader.');
