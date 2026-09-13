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

	// In order to make packages that probe AMD first (like zone.js) load correctly we must completely hide the AMD
	// `define` global so the modules take their commonjs/global code path. Only flipping `define.amd` to false is not
	// reliable: the loader still has an in-flight anonymous define for this very module (`sql/setup`), so if a UMD
	// module still sees the global `define` function it will enqueue a second anonymous define call and the loader
	// throws. Deleting the global binding entirely (and restoring it in a `finally`) guarantees these modules never
	// reach the AMD branch. We mask `define` around EVERY `nodeRequire` UMD load below (not just zone.js) because any
	// AMD-first UMD module can otherwise collide with the pending anonymous define.
	const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
	function loadWithoutAMD(moduleId) {
		const amdDefine = globalScope.define;
		globalScope.define = undefined;
		try {
			return require.__$__nodeRequire(moduleId);
		} finally {
			globalScope.define = amdDefine;
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
