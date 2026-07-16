"use strict";
/*---------------------------------------------------------------------------------------------
	*  Copyright (c) Microsoft Corporation. All rights reserved.
	*  Licensed under the MIT License. See License.txt in the project root for license information.
	*--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	var desc = Object.getOwnPropertyDescriptor(m, k);
	if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
		desc = { enumerable: true, get: function() { return m[k]; } };
	}
	Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
	if (k2 === undefined) k2 = k;
	o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
	Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
	o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
	var ownKeys = function(o) {
		ownKeys = Object.getOwnPropertyNames || function (o) {
			var ar = [];
			for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
			return ar;
		};
		return ownKeys(o);
	};
	return function (mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
		__setModuleDefault(result, mod);
		return result;
	};
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.importAMDNodeModule = importAMDNodeModule;
const amd_1 = require("vs/base/common/amd");
const network_1 = require("vs/base/common/network");
const platform = __importStar(require("vs/base/common/platform"));
const uri_1 = require("vs/base/common/uri");
class DefineCall {
	id;
	dependencies;
	callback;
	constructor(id, dependencies, callback) {
		this.id = id;
		this.dependencies = dependencies;
		this.callback = callback;
	}
}
class AMDModuleImporter {
	static INSTANCE = new AMDModuleImporter();
	_isWebWorker = (typeof self === 'object' && self.constructor && self.constructor.name === 'DedicatedWorkerGlobalScope');
	_isRenderer = typeof document === 'object';
	_defineCalls = [];
	_initialized = false;
	_amdPolicy;
	constructor() { }
	_initialize() {
		if (this._initialized) {
			return;
		}
		this._initialized = true;
		globalThis.define = (id, dependencies, callback) => {
			if (typeof id !== 'string') {
				callback = dependencies;
				dependencies = id;
				id = null;
			}
			if (typeof dependencies !== 'object' || !Array.isArray(dependencies)) {
				callback = dependencies;
				dependencies = null;
			}
			// if (!dependencies) {
			// 	dependencies = ['require', 'exports', 'module'];
			// }
			this._defineCalls.push(new DefineCall(id, dependencies, callback));
		};
		globalThis.define.amd = true;
		if (this._isRenderer) {
			this._amdPolicy = window.trustedTypes?.createPolicy('amdLoader', {
				createScriptURL(value) {
					if (value.startsWith(window.location.origin)) {
						return value;
					}
					if (value.startsWith('vscode-file://vscode-app')) {
						return value;
					}
					throw new Error(`[trusted_script_src] Invalid script url: ${value}`);
				}
			});
		}
		else if (this._isWebWorker) {
			this._amdPolicy = globalThis.trustedTypes?.createPolicy('amdLoader', {
				createScriptURL(value) {
					return value;
				}
			});
		}
	}
	async load(scriptSrc) {
		this._initialize();
		const defineCall = await (this._isWebWorker ? this._workerLoadScript(scriptSrc) : this._isRenderer ? this._rendererLoadScript(scriptSrc) : this._nodeJSLoadScript(scriptSrc));
		if (!defineCall) {
			throw new Error(`Did not receive a define call from script ${scriptSrc}`);
		}
		// TODO require, exports, module
		if (Array.isArray(defineCall.dependencies) && defineCall.dependencies.length > 0) {
			throw new Error(`Cannot resolve dependencies for script ${scriptSrc}. The dependencies are: ${defineCall.dependencies.join(', ')}`);
		}
		if (typeof defineCall.callback === 'function') {
			return defineCall.callback([]);
		}
		else {
			return defineCall.callback;
		}
	}
	_rendererLoadScript(scriptSrc) {
		return new Promise((resolve, reject) => {
			const scriptElement = document.createElement('script');
			scriptElement.setAttribute('async', 'async');
			scriptElement.setAttribute('type', 'text/javascript');
			const unbind = () => {
				scriptElement.removeEventListener('load', loadEventListener);
				scriptElement.removeEventListener('error', errorEventListener);
			};
			const loadEventListener = (e) => {
				unbind();
				resolve(this._defineCalls.pop());
			};
			const errorEventListener = (e) => {
				unbind();
				reject(e);
			};
			scriptElement.addEventListener('load', loadEventListener);
			scriptElement.addEventListener('error', errorEventListener);
			if (this._amdPolicy) {
				scriptSrc = this._amdPolicy.createScriptURL(scriptSrc);
			}
			scriptElement.setAttribute('src', scriptSrc);
			document.getElementsByTagName('head')[0].appendChild(scriptElement);
		});
	}
	_workerLoadScript(scriptSrc) {
		return new Promise((resolve, reject) => {
			try {
				if (this._amdPolicy) {
					scriptSrc = this._amdPolicy.createScriptURL(scriptSrc);
				}
				importScripts(scriptSrc);
				resolve(this._defineCalls.pop());
			}
			catch (err) {
				reject(err);
			}
		});
	}
	async _nodeJSLoadScript(scriptSrc) {
		try {
			const fs = globalThis._VSCODE_NODE_MODULES['fs'];
			const vm = globalThis._VSCODE_NODE_MODULES['vm'];
			const module = globalThis._VSCODE_NODE_MODULES['module'];
			const filePath = uri_1.URI.parse(scriptSrc).fsPath;
			const content = fs.readFileSync(filePath).toString();
			const scriptSource = module.wrap(content.replace(/^#!.*/, ''));
			const script = new vm.Script(scriptSource);
			const compileWrapper = script.runInThisContext();
			compileWrapper.apply();
			return this._defineCalls.pop();
		}
		catch (error) {
			throw error;
		}
	}
}
const cache = new Map();
let _paths = {};
if (typeof globalThis.require === 'object') {
	_paths = globalThis.require.paths ?? {};
}
/**
	* Utility for importing an AMD node module. This util supports AMD and ESM contexts and should be used while the ESM adoption
	* is on its way.
	*
	* e.g. pass in `vscode-textmate/release/main.js`
	*/
async function importAMDNodeModule(nodeModuleName, pathInsideNodeModule, isBuilt) {
	if (amd_1.isESM) {
		if (isBuilt === undefined) {
			const product = globalThis._VSCODE_PRODUCT_JSON;
			isBuilt = Boolean((product ?? globalThis.vscode?.context?.configuration()?.product)?.commit);
		}
		if (_paths[nodeModuleName]) {
			nodeModuleName = _paths[nodeModuleName];
		}
		const nodeModulePath = `${nodeModuleName}/${pathInsideNodeModule}`;
		if (cache.has(nodeModulePath)) {
			return cache.get(nodeModulePath);
		}
		let scriptSrc;
		if (/^\w[\w\d+.-]*:\/\//.test(nodeModulePath)) {
			// looks like a URL
			// bit of a special case for: src/vs/workbench/services/languageDetection/browser/languageDetectionSimpleWorker.ts
			scriptSrc = nodeModulePath;
		}
		else {
			const useASAR = (isBuilt && !platform.isWeb);
			const actualNodeModulesPath = (useASAR ? network_1.nodeModulesAsarPath : network_1.nodeModulesPath);
			const resourcePath = `${actualNodeModulesPath}/${nodeModulePath}`;
			scriptSrc = network_1.FileAccess.asBrowserUri(resourcePath).toString(true);
		}
		const result = AMDModuleImporter.INSTANCE.load(scriptSrc);
		cache.set(nodeModulePath, result);
		return result;
	}
	else {
		return await Promise.resolve(`${nodeModuleName}`).then(s => __importStar(require(s)));
	}
}
