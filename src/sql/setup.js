/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
define(['require', 'exports'], function (require) {
	// VS Code uses an AMD loader for its own files (and ours) but Node.JS normally uses commonjs. For modules that
	// support UMD this may cause some issues since it will appear to them that AMD exists and so depending on the order
	// they check support for the two types they may end up using either commonjs or AMD. If commonjs is first this is
	// the expected method and so nothing needs to be done - but if it's AMD then the VS Code loader will throw an error
	// (Can only have one anonymous define call per script file) since it only expects to be loading its own files.

	// The Electron loader's `define` can be a lexical global that cannot be hidden by changing properties on window,
	// globalThis, or Node's global object. Temporarily intercept CommonJS compilation and declare a module-local
	// `define` instead. AMD-first UMD modules then deterministically select their non-AMD branch. The patch is scoped
	// to each synchronous require and restored even when module compilation fails.
	const nodeRequire = require.__$__nodeRequire;
	const NodeModule = nodeRequire('module');
	const originalCompile = NodeModule.prototype._compile;
	function shadowAMDDefine(content) {
		return `(function (exports, require, module, __filename, __dirname, define) {\n${content}\n}` +
			`).call(this, exports, require, module, __filename, __dirname);`;
	}
	function loadWithoutAMD(moduleId) {
		NodeModule.prototype._compile = function (content, filename) {
			return originalCompile.call(this, shadowAMDDefine(content), filename);
		};
		try {
			return nodeRequire(moduleId);
		} finally {
			NodeModule.prototype._compile = originalCompile;
		}
	}

	const jquerylib = loadWithoutAMD('jquery');

	window['jQuery'] = jquerylib;
	window['$'] = jquerylib;

	loadWithoutAMD('slickgrid/lib/jquery.event.drag-2.3.0');
	loadWithoutAMD('slickgrid/lib/jquery-ui-1.9.2');
	loadWithoutAMD('slickgrid/slick.core');
	loadWithoutAMD('slickgrid/slick.grid');
	loadWithoutAMD('slickgrid/slick.editors');
	loadWithoutAMD('slickgrid/slick.dataview');
	loadWithoutAMD('slickgrid/plugins/slick.cellrangedecorator');
	loadWithoutAMD('gridstack/dist/h5/gridstack-dd-native');
	loadWithoutAMD('html-to-image/dist/html-to-image.js');
	loadWithoutAMD('reflect-metadata');
	loadWithoutAMD('chart.js');
	loadWithoutAMD('zone.js/dist/zone');
	loadWithoutAMD('zone.js/dist/zone-error');

	window['Zone']['__zone_symbol__ignoreConsoleErrorUncaughtError'] = true;
	window['Zone']['__zone_symbol__unhandledPromiseRejectionHandler'] = e => setImmediate(() => {
		window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', e));
	}); // let window handle this

});
