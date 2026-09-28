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
const loaderPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(rootDir, 'src', 'vs', 'loader.js');
const setupSource = fs.readFileSync(setupPath, 'utf8');
const zoneSource = fs.readFileSync(require.resolve('zone.js/dist/zone'), 'utf8');
const reflectMetadataSource = fs.readFileSync(require.resolve('reflect-metadata'), 'utf8');

function verifyWorkbenchSetupOrdering(outputRoot) {
	const bootstrapPath = path.join(outputRoot, 'bootstrap-window.js');
	const workbenchPath = path.join(outputRoot, 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.js');
	const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
	const workbenchSource = fs.readFileSync(workbenchPath, 'utf8');
	const mainLoadMatch = /bootstrapWindow\.load\(\[([\s\S]*?)\],/.exec(workbenchSource);
	assert.ok(mainLoadMatch, `workbench main load was not found in ${workbenchPath}`);
	assert.ok(!mainLoadMatch[1].includes('sql/setup'), 'sql/setup must not load concurrently with workbench main');
	assert.match(bootstrapSource, /await options\.beforeRequire\(\);/, 'bootstrap does not await beforeRequire');
	assert.match(
		workbenchSource,
		/beforeRequire:\s*async function \(\)[\s\S]*?await new Promise\(\(resolve, reject\) => require\(\['sql\/setup'\]/,
		'workbench does not await sql/setup before loading main'
	);
}

const setupRoot = path.dirname(path.dirname(setupPath));
const bootstrapRoot = fs.existsSync(path.join(setupRoot, 'bootstrap-window.js')) ? setupRoot : path.join(rootDir, 'src');
verifyWorkbenchSetupOrdering(bootstrapRoot);

function verifyLoaderNativeRequireIsolation() {
	const loaderSource = fs.readFileSync(loaderPath, 'utf8');
	const commonJsGlobal = { define: 'commonjs-define' };
	const loaderModule = { exports: {} };
	let loaderContext;
	const nativeRequire = moduleId => {
		assert.strictEqual(vm.runInContext('typeof define', loaderContext), 'undefined');
		assert.strictEqual(loaderContext.define, undefined);
		assert.strictEqual(commonJsGlobal.define, undefined);
		if (moduleId === 'module') {
			return require('module');
		}
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
	let localRequire;
	loaderModule.exports.define('local-require-test', ['require'], require => localRequire = require);
	loaderModule.exports('local-require-test');
	assert.strictEqual(
		localRequire.__$__nodeRequireWithoutAMD,
		loaderModule.exports.__$__nodeRequireWithoutAMD,
		'module-local require is missing the native AMD isolation helper'
	);
	assert.strictEqual(localRequire.__$__commonJSGlobal, commonJsGlobal, 'module-local require is missing the CommonJS global');
	const Module = require('module');
	const wrapperBefore = Module.wrapper[0];
	const wrapBefore = Module.wrap;
	loaderModule.exports.__$__nodeRequireWithoutAMD('zone.js/dist/zone');
	assert.strictEqual(typeof loaderContext.Zone, 'function', 'zone.js did not take its non-AMD branch');
	assert.strictEqual(loaderContext.define, amdDefine, 'loader define was not restored by the native require helper');
	assert.strictEqual(commonJsGlobal.define, 'commonjs-define', 'CommonJS define was not restored by the native require helper');
	assert.strictEqual(Module.wrapper[0], wrapperBefore, 'Node module wrapper was not restored by the native require helper');
	assert.strictEqual(Module.wrap, wrapBefore, 'Node Module.wrap was not restored by the native require helper');
}

verifyLoaderNativeRequireIsolation();

function verifyLoaderHelperShadowsStickyGlobalDefine() {
	const os = require('os');
	const fixturePath = path.join(os.tmpdir(), `amd-first-umd-${process.pid}.js`);
	fs.writeFileSync(fixturePath, [
		'(function (root, factory) {',
		'  if (typeof define === "function" && define.amd) {',
		'    define(factory);',
		'  } else if (typeof module === "object" && module.exports) {',
		'    module.exports = { branch: "cjs" };',
		'  } else {',
		'    root.AmdFirstUmd = { branch: "global" };',
		'  }',
		'})(typeof globalThis !== "undefined" ? globalThis : this, function () {',
		'  return { branch: "amd" };',
		'});',
		''
	].join('\n'));

	const amdDefine = function () {
		throw new Error('Can only have one anonymous define call per script file');
	};
	amdDefine.amd = { jQuery: true };
	const previousDescriptor = Object.getOwnPropertyDescriptor(global, 'define');
	Object.defineProperty(global, 'define', {
		configurable: true,
		enumerable: false,
		get() {
			return amdDefine;
		},
		set() {
			// Simulate an Electron renderer binding that assignment cannot hide.
		}
	});

	delete require.cache[require.resolve(loaderPath)];
	const loaderRequire = require(loaderPath);
	assert.strictEqual(typeof loaderRequire.__$__nodeRequireWithoutAMD, 'function');

	try {
		delete require.cache[require.resolve(fixturePath)];
		let directThrew = false;
		try {
			require(fixturePath);
		} catch (err) {
			directThrew = /anonymous define/.test(err.message);
		}
		assert.ok(directThrew, 'fixture should take the AMD branch when define is sticky');

		delete require.cache[require.resolve(fixturePath)];
		const result = loaderRequire.__$__nodeRequireWithoutAMD(fixturePath);
		assert.strictEqual(result && result.branch, 'cjs', 'loader helper did not shadow sticky global define');
		assert.deepStrictEqual(amdDefine.amd, { jQuery: true }, 'define.amd was not restored by the native require helper');
	} finally {
		if (previousDescriptor) {
			Object.defineProperty(global, 'define', previousDescriptor);
		} else {
			delete global.define;
		}
		delete require.cache[require.resolve(fixturePath)];
		fs.unlinkSync(fixturePath);
	}
}

verifyLoaderHelperShadowsStickyGlobalDefine();

function verifyLoaderHelperHandlesElectronModuleWrapper() {
	const os = require('os');
	const Module = require('module');
	const fixturePath = path.join(os.tmpdir(), `amd-first-umd-electron-${process.pid}.js`);
	fs.writeFileSync(fixturePath, [
		'(function (root, factory) {',
		'  if (typeof define === "function" && define.amd) {',
		'    define(factory);',
		'  } else if (typeof module === "object" && module.exports) {',
		'    module.exports = {',
		'      branch: "cjs",',
		'      processPid: typeof process === "object" && process ? process.pid : undefined,',
		'      defineType: typeof define',
		'    };',
		'  } else {',
		'    root.AmdFirstUmd = { branch: "global" };',
		'  }',
		'})(typeof globalThis !== "undefined" ? globalThis : this, function () {',
		'  return { branch: "amd" };',
		'});',
		''
	].join('\n'));

	const electronWrapper0 = '(function (exports, require, module, __filename, __dirname, process, global, Buffer) { ';
	const previousWrapper0 = Module.wrapper[0];
	const previousWrap = Module.wrap;
	const previousCompile = Module.prototype._compile;
	const amdDefine = function () {
		throw new Error('Can only have one anonymous define call per script file');
	};
	amdDefine.amd = { jQuery: true };
	const previousDescriptor = Object.getOwnPropertyDescriptor(global, 'define');
	Object.defineProperty(global, 'define', {
		configurable: true,
		enumerable: false,
		get() {
			return amdDefine;
		},
		set() {
			// Simulate an Electron renderer binding that assignment cannot hide.
		}
	});

	delete require.cache[require.resolve(loaderPath)];
	const loaderRequire = require(loaderPath);

	try {
		Module.wrapper[0] = electronWrapper0;
		Module.prototype._compile = function (content, filename) {
			const wrapped = Module.wrap(content.replace(/^#!.*/, ''));
			const compiled = require('vm').runInThisContext(wrapped, { filename: filename });
			const dirname = path.dirname(filename);
			const moduleRequire = Module.createRequire ? Module.createRequire(filename) : require;
			return compiled.call(
				this.exports,
				this.exports,
				moduleRequire,
				this,
				filename,
				dirname,
				process,
				global,
				Buffer
			);
		};
		delete require.cache[require.resolve(fixturePath)];
		const result = loaderRequire.__$__nodeRequireWithoutAMD(fixturePath);
		assert.strictEqual(result && result.branch, 'cjs', 'loader helper did not isolate AMD-first UMD with Electron module wrapper');
		assert.strictEqual(result.processPid, process.pid, 'injecting define shifted Electron wrapper arguments');
		assert.strictEqual(result.defineType, 'undefined', 'define was not shadowed as the last Electron wrapper argument');
		assert.strictEqual(Module.wrapper[0], electronWrapper0, 'Electron module wrapper was not restored');
		assert.strictEqual(Module.wrap, previousWrap, 'Module.wrap was not restored after Electron wrapper isolation');
		assert.deepStrictEqual(amdDefine.amd, { jQuery: true }, 'define.amd was not restored after Electron wrapper isolation');
	} finally {
		Module.wrapper[0] = previousWrapper0;
		Module.wrap = previousWrap;
		Module.prototype._compile = previousCompile;
		if (previousDescriptor) {
			Object.defineProperty(global, 'define', previousDescriptor);
		} else {
			delete global.define;
		}
		delete require.cache[require.resolve(fixturePath)];
		fs.unlinkSync(fixturePath);
	}
}

verifyLoaderHelperHandlesElectronModuleWrapper();

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
		const localRequire = function localRequire() { };
		localRequire.__$__nodeRequire = nodeRequire;
		localRequire.__$__commonJSGlobal = nodeRequire.__$__commonJSGlobal;
		localRequire.__$__nodeRequireWithoutAMD = nodeRequire.__$__nodeRequireWithoutAMD;
		factory.call(loaderGlobal, localRequire, {});
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
vm.runInContext('define = __amdDefine;', loaderContext);

vm.runInNewContext(setupSource, browserGlobal, { filename: 'src/sql/setup.js' });

assert.strictEqual(loaderGlobal.define, amdDefine, 'loader define was not restored');
assert.strictEqual(browserGlobal.define, amdDefine, 'browser define was not restored');
assert.strictEqual(commonJsGlobal.define, amdDefine, 'CommonJS define was not restored');
assert.ok(loadedModules.includes('zone.js/dist/zone'), 'zone.js was not loaded');
assert.ok(loadedModules.includes('zone.js/dist/zone-error'), 'zone-error.js was not loaded');
assert.strictEqual(typeof browserGlobal.Reflect.getOwnMetadata, 'function', 'reflect-metadata was not exposed to the renderer');
assert.strictEqual(browserGlobal.Reflect, commonJsGlobal.Reflect, 'renderer and CommonJS Reflect objects differ');
console.log('SQL setup loaded real zone.js and reflect-metadata in the renderer realm.');
