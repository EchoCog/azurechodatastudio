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
	// globalThis, or Node's global object. Ask the loader to hide and restore its own binding around each synchronous
	// native require so AMD-first UMD modules deterministically select their non-AMD branch.
	function loadWithoutAMD(moduleId) {
		return require.__$__nodeRequireWithoutAMD(moduleId);
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
	// reflect-metadata selects Node's `global` object when loaded through CommonJS, while Angular runs in the renderer
	// realm and reads `window.Reflect`. Publish the patched Reflect object into that realm before Angular initializes.
	if (typeof global !== 'undefined' && global['Reflect']) {
		window['Reflect'] = global['Reflect'];
	}
	loadWithoutAMD('chart.js');
	loadWithoutAMD('zone.js/dist/zone');
	loadWithoutAMD('zone.js/dist/zone-error');

	window['Zone']['__zone_symbol__ignoreConsoleErrorUncaughtError'] = true;
	window['Zone']['__zone_symbol__unhandledPromiseRejectionHandler'] = e => setImmediate(() => {
		window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', e));
	}); // let window handle this

});
