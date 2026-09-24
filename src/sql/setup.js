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

	// The loader invokes this factory with its own global object as `this`. In Electron that object can be distinct
	// from the browser (`window`/`globalThis`) and CommonJS (`global`) realms. AMD-first UMD modules such as zone.js
	// must not see `define` in any of them while they are synchronously loaded through `nodeRequire`.
	const globalScopes = [this];
	function addGlobalScope(scope) {
		if (scope && globalScopes.indexOf(scope) === -1) {
			globalScopes.push(scope);
		}
	}
	addGlobalScope(typeof globalThis !== 'undefined' ? globalThis : undefined);
	addGlobalScope(typeof window !== 'undefined' ? window : undefined);
	addGlobalScope(typeof global !== 'undefined' ? global : undefined);
	function loadWithoutAMD(moduleId) {
		const amdDefines = globalScopes.map(scope => scope.define);
		globalScopes.forEach(scope => scope.define = undefined);
		try {
			return require.__$__nodeRequire(moduleId);
		} finally {
			globalScopes.forEach((scope, index) => scope.define = amdDefines[index]);
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
