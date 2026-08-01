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
exports.EmptySubmenuAction = exports.SubmenuAction = exports.Separator = exports.ActionRunner = exports.Action = void 0;
exports.toAction = toAction;
const event_1 = require("vs/base/common/event");
const lifecycle_1 = require("vs/base/common/lifecycle");
const nls = __importStar(require("vs/nls"));
class Action extends lifecycle_1.Disposable {
	_onDidChange = this._register(new event_1.Emitter());
	onDidChange = this._onDidChange.event;
	_id;
	_label;
	_tooltip;
	_cssClass;
	_enabled = true;
	_checked;
	_expanded = false; // {{SQL CARBON EDIT}}
	_actionCallback;
	constructor(id, label = '', cssClass = '', enabled = true, actionCallback) {
		super();
		this._id = id;
		this._label = label;
		this._cssClass = cssClass;
		this._enabled = enabled;
		this._actionCallback = actionCallback;
	}
	get id() {
		return this._id;
	}
	get label() {
		return this._label;
	}
	set label(value) {
		this._setLabel(value);
	}
	_setLabel(value) {
		if (this._label !== value) {
			this._label = value;
			this._onDidChange.fire({ label: value });
		}
	}
	get tooltip() {
		return this._tooltip || '';
	}
	set tooltip(value) {
		this._setTooltip(value);
	}
	_setTooltip(value) {
		if (this._tooltip !== value) {
			this._tooltip = value;
			this._onDidChange.fire({ tooltip: value });
		}
	}
	get class() {
		return this._cssClass;
	}
	set class(value) {
		this._setClass(value);
	}
	_setClass(value) {
		if (this._cssClass !== value) {
			this._cssClass = value;
			this._onDidChange.fire({ class: value });
		}
	}
	get enabled() {
		return this._enabled;
	}
	set enabled(value) {
		this._setEnabled(value);
	}
	_setEnabled(value) {
		if (this._enabled !== value) {
			this._enabled = value;
			this._onDidChange.fire({ enabled: value });
		}
	}
	get checked() {
		return this._checked;
	}
	set checked(value) {
		this._setChecked(value);
	}
	_setChecked(value) {
		if (this._checked !== value) {
			this._checked = value;
			this._onDidChange.fire({ checked: value });
		}
	}
	// {{SQL CARBON EDIT}}
	get expanded() {
		return this._expanded;
	}
	set expanded(value) {
		this._setExpanded(value);
	}
	_setExpanded(value) {
		if (this._expanded !== value) {
			this._expanded = value;
			this._onDidChange.fire({ expanded: value });
		}
	}
	async run(event, data) {
		if (this._actionCallback) {
			await this._actionCallback(event);
		}
	}
}
exports.Action = Action;
class ActionRunner extends lifecycle_1.Disposable {
	_onWillRun = this._register(new event_1.Emitter());
	onWillRun = this._onWillRun.event;
	_onDidRun = this._register(new event_1.Emitter());
	onDidRun = this._onDidRun.event;
	async run(action, context) {
		if (!action.enabled) {
			return;
		}
		this._onWillRun.fire({ action });
		let error = undefined;
		try {
			await this.runAction(action, context);
		}
		catch (e) {
			error = e;
		}
		this._onDidRun.fire({ action, error });
	}
	async runAction(action, context) {
		await action.run(context);
	}
}
exports.ActionRunner = ActionRunner;
class Separator {
	/**
		* Joins all non-empty lists of actions with separators.
		*/
	static join(...actionLists) {
		let out = [];
		for (const list of actionLists) {
			if (!list.length) {
				// skip
			}
			else if (out.length) {
				out = [...out, new Separator(), ...list];
			}
			else {
				out = list;
			}
		}
		return out;
	}
	static ID = 'vs.actions.separator';
	id = Separator.ID;
	label = '';
	tooltip = '';
	class = 'separator';
	enabled = false;
	checked = false;
	async run() { }
}
exports.Separator = Separator;
class SubmenuAction {
	id;
	label;
	class;
	tooltip = '';
	enabled = true;
	checked = undefined;
	_actions;
	get actions() { return this._actions; }
	constructor(id, label, actions, cssClass) {
		this.id = id;
		this.label = label;
		this.class = cssClass;
		this._actions = actions;
	}
	async run() { }
	// {{SQL CARBON EDIT}}
	get expanded() {
		return false;
	}
	set expanded(value) {
	}
	_setExpanded(value) {
	}
}
exports.SubmenuAction = SubmenuAction;
class EmptySubmenuAction extends Action {
	static ID = 'vs.actions.empty';
	constructor() {
		super(EmptySubmenuAction.ID, nls.localize('submenu.empty', '(empty)'), undefined, false);
	}
}
exports.EmptySubmenuAction = EmptySubmenuAction;
function toAction(props) {
	return {
		id: props.id,
		label: props.label,
		class: undefined,
		// {{SQL CARBON EDIT}} - add expanded type
		expanded: false,
		enabled: props.enabled ?? true,
		checked: props.checked ?? false,
		run: async () => props.run(),
		tooltip: props.label
	};
}
