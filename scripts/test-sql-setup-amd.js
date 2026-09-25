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
const reflectMetadataSource = fs.readFileSync(require.resolve('reflect-metadata'), 'utf8');

function verifyLoaderNativeRequireIsolation() {
	const loaderPath = path.join(rootDir, 'src', 'vs', 'loader.js');
	const loaderSource = fs.readFileSync(loaderPath, 'utf8');
	const commonJsGlobal = { define: 'commonjs-define' };
	const loaderModule = { exports: {} };
	let loaderContext;
	const nativeRequire = moduleId => {
		assert.strictEqual(vm.runInContext('typeof define', loaderContext), 'undefined');
		assert.strictEqual(loaderContext.define, undefined);
		assert.strictEqual(commonJsGlobal.define, undefined);
		if (moduleId === 'zone.js/dist/zone') {
			return vm.runInContext(zoneSource, loaderContext, { filename: require.resolve(moduleId) });
		}
		return moduleId;
	};
	nativeRequire.resolve = moduleId => moduleId;
	loaderContext = vm.createContext({
		addEventListener: function addEventListener() { },
		Buffer,
		clearInterval,
		clearTimeout,
		console,
		dispatchEvent: function dispatchEvent() { },
		exports: loaderModule.exports,
		global: commonJsGlobal,
		module: loaderModule,
		performance,
		Promise,
		process,
		removeEventListener: function removeEventListener() { },
		require: nativeRequire,
		setImmediate,
		setInterval,
		setTimeout
	});
	loaderContext.window = loaderContext;
	loaderContext.self = loaderContext;
	vm.runInContext(loaderSource, loaderContext, { filename: loaderPath });
	const amdDefine = loaderContext.define;
	assert.strictEqual(typeof amdDefine, 'function');
	assert.strictEqual(typeof loaderModule.exports.__$__nodeRequireWithoutAMD, 'function');
	assert.strictEqual(loaderModule.exports.__$__commonJSGlobal, commonJsGlobal);
	loaderModule.exports.__$__nodeRequireWithoutAMD('zone.js/dist/zone');
	assert.strictEqual(typeof loaderContext.Zone, 'function', 'zone.js did not take its non-AMD branch');
	assert.strictEqual(loaderContext.define, amdDefine, 'loader define was not restored by the native require helper');
	assert.strictEqual(commonJsGlobal.define, 'commonjs-define', 'CommonJS define was not restored by the native require helper');
}

verifyLoaderNativeRequireIsolation();

const loadedModules = [];
const commonJsGlobal = {};
const rendererVisibleGlobal = {};
const loaderGlobal = {};
let loaderContext;
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
	global: rendererVisibleGlobal
};
browserGlobal.window = browserGlobal;
loaderGlobal.window = browserGlobal;
loaderGlobal.self = browserGlobal;
loaderGlobal.global = commonJsGlobal;
Object.defineProperty(loaderGlobal, 'Zone', {
	configurable: true,
	get: () => browserGlobal.Zone,
	set: value => browserGlobal.Zone = value
});

let anonymousDefinePending = false;
function amdDefine(_dependencies, factory) {
	if (anonymousDefinePending) {
		throw new Error('Can only have one anonymous define call per script file');
	}

	anonymousDefinePending = true;
	try {
		const nodeRequire = moduleId => {
			loadedModules.push(moduleId);
			if (moduleId === 'jquery') {
				return function jquery() { };
			}
			if (moduleId === 'zone.js/dist/zone') {
				return vm.runInContext(zoneSource, loaderContext, { filename: require.resolve(moduleId) });
			}
			if (moduleId === 'reflect-metadata') {
				return vm.runInContext(reflectMetadataSource, loaderContext, { filename: require.resolve(moduleId) });
			}
			return {};
		};
		nodeRequire.__$__nodeRequire = nodeRequire;
		nodeRequire.__$__commonJSGlobal = commonJsGlobal;
		nodeRequire.__$__nodeRequireWithoutAMD = moduleId => {
			const loaderDefine = loaderGlobal.define;
			const browserDefine = browserGlobal.define;
			const commonJsDefine = commonJsGlobal.define;
			vm.runInContext('define = undefined;', loaderContext);
			loaderGlobal.define = undefined;
			browserGlobal.define = undefined;
			commonJsGlobal.define = undefined;
			try {
				return nodeRequire(moduleId);
			} finally {
				loaderGlobal.define = loaderDefine;
				browserGlobal.define = browserDefine;
				commonJsGlobal.define = commonJsDefine;
				vm.runInContext('define = __amdDefine;', loaderContext);
			}
		};
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
assert.strictEqual(typeof browserGlobal.Reflect.getOwnMetadata, 'function', 'reflect-metadata was not exposed to the renderer');
assert.strictEqual(browserGlobal.Reflect, commonJsGlobal.Reflect, 'renderer and CommonJS Reflect objects differ');
console.log('SQL setup loaded real zone.js and reflect-metadata in the renderer realm.');
