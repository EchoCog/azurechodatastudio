"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MenuWorkbenchToolBar = exports.WorkbenchToolBar = void 0;
const dom_1 = require("vs/base/browser/dom");
const mouseEvent_1 = require("vs/base/browser/mouseEvent");
const toolbar_1 = require("vs/base/browser/ui/toolbar/toolbar");
const actions_1 = require("vs/base/common/actions");
const arrays_1 = require("vs/base/common/arrays");
const errors_1 = require("vs/base/common/errors");
const event_1 = require("vs/base/common/event");
const lifecycle_1 = require("vs/base/common/lifecycle");
const nls_1 = require("vs/nls");
const menuEntryActionViewItem_1 = require("vs/platform/actions/browser/menuEntryActionViewItem");
const actions_2 = require("vs/platform/actions/common/actions");
const contextkey_1 = require("vs/platform/contextkey/common/contextkey");
const contextView_1 = require("vs/platform/contextview/browser/contextView");
const keybinding_1 = require("vs/platform/keybinding/common/keybinding");
const telemetry_1 = require("vs/platform/telemetry/common/telemetry");
/**
 * The `WorkbenchToolBar` does
 * - support hiding of menu items
 * - lookup keybindings for each actions automatically
 * - send `workbenchActionExecuted`-events for each action
 *
 * See {@link MenuWorkbenchToolBar} for a toolbar that is backed by a menu.
 */
let WorkbenchToolBar = class WorkbenchToolBar extends toolbar_1.ToolBar {
    _options;
    _menuService;
    _contextKeyService;
    _contextMenuService;
    _sessionDisposables = this._store.add(new lifecycle_1.DisposableStore());
    constructor(container, _options, _menuService, _contextKeyService, _contextMenuService, keybindingService, telemetryService) {
        super(container, _contextMenuService, {
            // defaults
            getKeyBinding: (action) => keybindingService.lookupKeybinding(action.id) ?? undefined,
            // options (override defaults)
            ..._options,
            // mandatory (overide options)
            allowContextMenu: true,
            skipTelemetry: typeof _options?.telemetrySource === 'string',
        });
        this._options = _options;
        this._menuService = _menuService;
        this._contextKeyService = _contextKeyService;
        this._contextMenuService = _contextMenuService;
        // telemetry logic
        const telemetrySource = _options?.telemetrySource;
        if (telemetrySource) {
            this._store.add(this.actionBar.onDidRun(e => telemetryService.publicLog2('workbenchActionExecuted', { id: e.action.id, from: telemetrySource })));
        }
    }
    setActions(_primary, _secondary = [], menuIds) {
        this._sessionDisposables.clear();
        const primary = _primary.slice();
        const secondary = _secondary.slice();
        const toggleActions = [];
        let toggleActionsCheckedCount = 0;
        const extraSecondary = [];
        let someAreHidden = false;
        // unless disabled, move all hidden items to secondary group or ignore them
        if (this._options?.hiddenItemStrategy !== -1 /* HiddenItemStrategy.NoHide */) {
            for (let i = 0; i < primary.length; i++) {
                const action = primary[i];
                if (!(action instanceof actions_2.MenuItemAction) && !(action instanceof actions_2.SubmenuItemAction)) {
                    // console.warn(`Action ${action.id}/${action.label} is not a MenuItemAction`);
                    continue;
                }
                if (!action.hideActions) {
                    continue;
                }
                // collect all toggle actions
                toggleActions.push(action.hideActions.toggle);
                if (action.hideActions.toggle.checked) {
                    toggleActionsCheckedCount++;
                }
                // hidden items move into overflow or ignore
                if (action.hideActions.isHidden) {
                    someAreHidden = true;
                    primary[i] = undefined;
                    if (this._options?.hiddenItemStrategy !== 0 /* HiddenItemStrategy.Ignore */) {
                        extraSecondary[i] = action;
                    }
                }
            }
        }
        // count for max
        if (this._options?.maxNumberOfItems !== undefined) {
            let count = 0;
            for (let i = 0; i < primary.length; i++) {
                const action = primary[i];
                if (!action) {
                    continue;
                }
                if (++count >= this._options.maxNumberOfItems) {
                    primary[i] = undefined;
                    extraSecondary[i] = action;
                }
            }
        }
        (0, arrays_1.coalesceInPlace)(primary);
        (0, arrays_1.coalesceInPlace)(extraSecondary);
        super.setActions(primary, actions_1.Separator.join(extraSecondary, secondary));
        // add context menu for toggle actions
        if (toggleActions.length > 0) {
            this._sessionDisposables.add((0, dom_1.addDisposableListener)(this.getElement(), 'contextmenu', e => {
                const event = new mouseEvent_1.StandardMouseEvent(e);
                const action = this.getItemAction(event.target);
                if (!(action)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                let noHide = false;
                // last item cannot be hidden when using ignore strategy
                if (toggleActionsCheckedCount === 1 && this._options?.hiddenItemStrategy === 0 /* HiddenItemStrategy.Ignore */) {
                    noHide = true;
                    for (let i = 0; i < toggleActions.length; i++) {
                        if (toggleActions[i].checked) {
                            toggleActions[i] = (0, actions_1.toAction)({
                                id: action.id,
                                label: action.label,
                                checked: true,
                                enabled: false,
                                run() { }
                            });
                            break; // there is only one
                        }
                    }
                }
                // add "hide foo" actions
                let hideAction;
                if (!noHide && (action instanceof actions_2.MenuItemAction || action instanceof actions_2.SubmenuItemAction)) {
                    if (!action.hideActions) {
                        // no context menu for MenuItemAction instances that support no hiding
                        // those are fake actions and need to be cleaned up
                        return;
                    }
                    hideAction = action.hideActions.hide;
                }
                else {
                    hideAction = (0, actions_1.toAction)({
                        id: 'label',
                        label: (0, nls_1.localize)('hide', "Hide"),
                        enabled: false,
                        run() { }
                    });
                }
                const actions = actions_1.Separator.join([hideAction], toggleActions);
                // add "Reset Menu" action
                if (this._options?.resetMenu && !menuIds) {
                    menuIds = [this._options.resetMenu];
                }
                if (someAreHidden && menuIds) {
                    actions.push(new actions_1.Separator());
                    actions.push((0, actions_1.toAction)({
                        id: 'resetThisMenu',
                        label: (0, nls_1.localize)('resetThisMenu', "Reset Menu"),
                        run: () => this._menuService.resetHiddenStates(menuIds)
                    }));
                }
                this._contextMenuService.showContextMenu({
                    getAnchor: () => event,
                    getActions: () => actions,
                    // add context menu actions (iff appicable)
                    menuId: this._options?.contextMenu,
                    menuActionOptions: { renderShortTitle: true, ...this._options?.menuOptions },
                    skipTelemetry: typeof this._options?.telemetrySource === 'string',
                    contextKeyService: this._contextKeyService,
                });
            }));
        }
    }
};
exports.WorkbenchToolBar = WorkbenchToolBar;
exports.WorkbenchToolBar = WorkbenchToolBar = __decorate([
    __param(2, actions_2.IMenuService),
    __param(3, contextkey_1.IContextKeyService),
    __param(4, contextView_1.IContextMenuService),
    __param(5, keybinding_1.IKeybindingService),
    __param(6, telemetry_1.ITelemetryService)
], WorkbenchToolBar);
/**
 * A {@link WorkbenchToolBar workbench toolbar} that is purely driven from a {@link MenuId menu}-identifier.
 *
 * *Note* that Manual updates via `setActions` are NOT supported.
 */
let MenuWorkbenchToolBar = class MenuWorkbenchToolBar extends WorkbenchToolBar {
    _onDidChangeMenuItems = this._store.add(new event_1.Emitter());
    onDidChangeMenuItems = this._onDidChangeMenuItems.event;
    constructor(container, menuId, options, menuService, contextKeyService, contextMenuService, keybindingService, telemetryService) {
        super(container, { resetMenu: menuId, ...options }, menuService, contextKeyService, contextMenuService, keybindingService, telemetryService);
        // update logic
        const menu = this._store.add(menuService.createMenu(menuId, contextKeyService, { emitEventsForSubmenuChanges: true }));
        const updateToolbar = () => {
            const primary = [];
            const secondary = [];
            (0, menuEntryActionViewItem_1.createAndFillInActionBarActions)(menu, options?.menuOptions, { primary, secondary }, options?.toolbarOptions?.primaryGroup, options?.toolbarOptions?.shouldInlineSubmenu, options?.toolbarOptions?.useSeparatorsInPrimaryActions);
            super.setActions(primary, secondary);
        };
        this._store.add(menu.onDidChange(() => {
            updateToolbar();
            this._onDidChangeMenuItems.fire(this);
        }));
        updateToolbar();
    }
    /**
     * @deprecated The WorkbenchToolBar does not support this method because it works with menus.
     */
    setActions() {
        throw new errors_1.BugIndicatingError('This toolbar is populated from a menu.');
    }
};
exports.MenuWorkbenchToolBar = MenuWorkbenchToolBar;
exports.MenuWorkbenchToolBar = MenuWorkbenchToolBar = __decorate([
    __param(3, actions_2.IMenuService),
    __param(4, contextkey_1.IContextKeyService),
    __param(5, contextView_1.IContextMenuService),
    __param(6, keybinding_1.IKeybindingService),
    __param(7, telemetry_1.ITelemetryService)
], MenuWorkbenchToolBar);
