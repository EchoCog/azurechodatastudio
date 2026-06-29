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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ViewPane_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewAction = exports.FilterViewPane = exports.ViewPane = exports.VIEWPANE_FILTER_ACTION = exports.ViewPaneShowActions = void 0;
require("vs/css!./media/paneviewlet");
const nls = __importStar(require("vs/nls"));
const event_1 = require("vs/base/common/event");
const colorRegistry_1 = require("vs/platform/theme/common/colorRegistry");
const theme_1 = require("vs/workbench/common/theme");
const dom_1 = require("vs/base/browser/dom");
const lifecycle_1 = require("vs/base/common/lifecycle");
const actions_1 = require("vs/base/common/actions");
const actionbar_1 = require("vs/base/browser/ui/actionbar/actionbar");
const platform_1 = require("vs/platform/registry/common/platform");
const keybinding_1 = require("vs/platform/keybinding/common/keybinding");
const contextView_1 = require("vs/platform/contextview/browser/contextView");
const telemetry_1 = require("vs/platform/telemetry/common/telemetry");
const themeService_1 = require("vs/platform/theme/common/themeService");
const themables_1 = require("vs/base/common/themables");
const paneview_1 = require("vs/base/browser/ui/splitview/paneview");
const configuration_1 = require("vs/platform/configuration/common/configuration");
const views_1 = require("vs/workbench/common/views");
const contextkey_1 = require("vs/platform/contextkey/common/contextkey");
const types_1 = require("vs/base/common/types");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const actions_2 = require("vs/platform/actions/common/actions");
const menuEntryActionViewItem_1 = require("vs/platform/actions/browser/menuEntryActionViewItem");
const linkedText_1 = require("vs/base/common/linkedText");
const opener_1 = require("vs/platform/opener/common/opener");
const button_1 = require("vs/base/browser/ui/button/button");
const link_1 = require("vs/platform/opener/browser/link");
const progressbar_1 = require("vs/base/browser/ui/progressbar/progressbar");
const progressIndicator_1 = require("vs/workbench/services/progress/browser/progressIndicator");
const scrollableElement_1 = require("vs/base/browser/ui/scrollbar/scrollableElement");
const uri_1 = require("vs/base/common/uri");
const iconRegistry_1 = require("vs/platform/theme/common/iconRegistry");
const codicons_1 = require("vs/base/common/codicons");
const actions_3 = require("vs/workbench/browser/actions");
const toolbar_1 = require("vs/platform/actions/browser/toolbar");
const viewFilter_1 = require("vs/workbench/browser/parts/views/viewFilter");
const actionViewItems_1 = require("vs/base/browser/ui/actionbar/actionViewItems");
const serviceCollection_1 = require("vs/platform/instantiation/common/serviceCollection");
const defaultStyles_1 = require("vs/platform/theme/browser/defaultStyles");
var ViewPaneShowActions;
(function (ViewPaneShowActions) {
    /** Show the actions when the view is hovered. This is the default behavior. */
    ViewPaneShowActions[ViewPaneShowActions["Default"] = 0] = "Default";
    /** Always shows the actions when the view is expanded */
    ViewPaneShowActions[ViewPaneShowActions["WhenExpanded"] = 1] = "WhenExpanded";
    /** Always shows the actions */
    ViewPaneShowActions[ViewPaneShowActions["Always"] = 2] = "Always";
})(ViewPaneShowActions || (exports.ViewPaneShowActions = ViewPaneShowActions = {}));
exports.VIEWPANE_FILTER_ACTION = new actions_1.Action('viewpane.action.filter');
const viewPaneContainerExpandedIcon = (0, iconRegistry_1.registerIcon)('view-pane-container-expanded', codicons_1.Codicon.chevronDown, nls.localize('viewPaneContainerExpandedIcon', 'Icon for an expanded view pane container.'));
const viewPaneContainerCollapsedIcon = (0, iconRegistry_1.registerIcon)('view-pane-container-collapsed', codicons_1.Codicon.chevronRight, nls.localize('viewPaneContainerCollapsedIcon', 'Icon for a collapsed view pane container.'));
const viewsRegistry = platform_1.Registry.as(views_1.Extensions.ViewsRegistry);
let ViewWelcomeController = class ViewWelcomeController {
    id;
    contextKeyService;
    _onDidChange = new event_1.Emitter();
    onDidChange = this._onDidChange.event;
    defaultItem;
    items = [];
    get contents() {
        const visibleItems = this.items.filter(v => v.visible);
        if (visibleItems.length === 0 && this.defaultItem) {
            return [this.defaultItem.descriptor];
        }
        return visibleItems.map(v => v.descriptor);
    }
    disposables = new lifecycle_1.DisposableStore();
    constructor(id, contextKeyService) {
        this.id = id;
        this.contextKeyService = contextKeyService;
        contextKeyService.onDidChangeContext(this.onDidChangeContext, this, this.disposables);
        event_1.Event.filter(viewsRegistry.onDidChangeViewWelcomeContent, id => id === this.id)(this.onDidChangeViewWelcomeContent, this, this.disposables);
        this.onDidChangeViewWelcomeContent();
    }
    onDidChangeViewWelcomeContent() {
        const descriptors = viewsRegistry.getViewWelcomeContent(this.id);
        this.items = [];
        for (const descriptor of descriptors) {
            if (descriptor.when === 'default') {
                this.defaultItem = { descriptor, visible: true };
            }
            else {
                const visible = descriptor.when ? this.contextKeyService.contextMatchesRules(descriptor.when) : true;
                this.items.push({ descriptor, visible });
            }
        }
        this._onDidChange.fire();
    }
    onDidChangeContext() {
        let didChange = false;
        for (const item of this.items) {
            if (!item.descriptor.when || item.descriptor.when === 'default') {
                continue;
            }
            const visible = this.contextKeyService.contextMatchesRules(item.descriptor.when);
            if (item.visible === visible) {
                continue;
            }
            item.visible = visible;
            didChange = true;
        }
        if (didChange) {
            this._onDidChange.fire();
        }
    }
    dispose() {
        this.disposables.dispose();
    }
};
ViewWelcomeController = __decorate([
    __param(1, contextkey_1.IContextKeyService)
], ViewWelcomeController);
let ViewPane = class ViewPane extends paneview_1.Pane {
    static { ViewPane_1 = this; }
    keybindingService;
    contextMenuService;
    configurationService;
    contextKeyService;
    viewDescriptorService;
    instantiationService;
    openerService;
    themeService;
    telemetryService;
    static AlwaysShowActionsConfig = 'workbench.view.alwaysShowHeaderActions';
    _onDidFocus = this._register(new event_1.Emitter());
    onDidFocus = this._onDidFocus.event;
    _onDidBlur = this._register(new event_1.Emitter());
    onDidBlur = this._onDidBlur.event;
    _onDidChangeBodyVisibility = this._register(new event_1.Emitter());
    onDidChangeBodyVisibility = this._onDidChangeBodyVisibility.event;
    _onDidChangeTitleArea = this._register(new event_1.Emitter());
    onDidChangeTitleArea = this._onDidChangeTitleArea.event;
    _onDidChangeViewWelcomeState = this._register(new event_1.Emitter());
    onDidChangeViewWelcomeState = this._onDidChangeViewWelcomeState.event;
    _isVisible = false;
    id;
    _title;
    get title() {
        return this._title;
    }
    _titleDescription;
    get titleDescription() {
        return this._titleDescription;
    }
    menuActions;
    progressBar;
    progressIndicator;
    toolbar;
    showActions;
    headerContainer;
    titleContainer;
    titleDescriptionContainer;
    iconContainer;
    twistiesContainer;
    bodyContainer;
    viewWelcomeContainer;
    viewWelcomeDisposable = lifecycle_1.Disposable.None;
    viewWelcomeController;
    scopedContextKeyService;
    constructor(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService) {
        super({ ...options, ...{ orientation: viewDescriptorService.getViewLocationById(options.id) === 1 /* ViewContainerLocation.Panel */ ? 1 /* Orientation.HORIZONTAL */ : 0 /* Orientation.VERTICAL */ } });
        this.keybindingService = keybindingService;
        this.contextMenuService = contextMenuService;
        this.configurationService = configurationService;
        this.contextKeyService = contextKeyService;
        this.viewDescriptorService = viewDescriptorService;
        this.instantiationService = instantiationService;
        this.openerService = openerService;
        this.themeService = themeService;
        this.telemetryService = telemetryService;
        this.id = options.id;
        this._title = options.title;
        this._titleDescription = options.titleDescription;
        this.showActions = options.showActions ?? ViewPaneShowActions.Default;
        this.scopedContextKeyService = this._register(contextKeyService.createScoped(this.element));
        this.scopedContextKeyService.createKey('view', this.id);
        const viewLocationKey = this.scopedContextKeyService.createKey('viewLocation', (0, views_1.ViewContainerLocationToString)(viewDescriptorService.getViewLocationById(this.id)));
        this._register(event_1.Event.filter(viewDescriptorService.onDidChangeLocation, e => e.views.some(view => view.id === this.id))(() => viewLocationKey.set((0, views_1.ViewContainerLocationToString)(viewDescriptorService.getViewLocationById(this.id)))));
        this.menuActions = this._register(this.instantiationService.createChild(new serviceCollection_1.ServiceCollection([contextkey_1.IContextKeyService, this.scopedContextKeyService])).createInstance(actions_3.CompositeMenuActions, options.titleMenuId ?? actions_2.MenuId.ViewTitle, actions_2.MenuId.ViewTitleContext, { shouldForwardArgs: !options.donotForwardArgs }));
        this._register(this.menuActions.onDidChange(() => this.updateActions()));
        this.viewWelcomeController = new ViewWelcomeController(this.id, contextKeyService);
    }
    get headerVisible() {
        return super.headerVisible;
    }
    set headerVisible(visible) {
        super.headerVisible = visible;
        this.element.classList.toggle('merged-header', !visible);
    }
    setVisible(visible) {
        if (this._isVisible !== visible) {
            this._isVisible = visible;
            if (this.isExpanded()) {
                this._onDidChangeBodyVisibility.fire(visible);
            }
        }
    }
    isVisible() {
        return this._isVisible;
    }
    isBodyVisible() {
        return this._isVisible && this.isExpanded();
    }
    setExpanded(expanded) {
        const changed = super.setExpanded(expanded);
        if (changed) {
            this._onDidChangeBodyVisibility.fire(expanded);
        }
        if (this.twistiesContainer) {
            this.twistiesContainer.classList.remove(...themables_1.ThemeIcon.asClassNameArray(this.getTwistyIcon(!expanded)));
            this.twistiesContainer.classList.add(...themables_1.ThemeIcon.asClassNameArray(this.getTwistyIcon(expanded)));
        }
        return changed;
    }
    render() {
        super.render();
        const focusTracker = (0, dom_1.trackFocus)(this.element);
        this._register(focusTracker);
        this._register(focusTracker.onDidFocus(() => this._onDidFocus.fire()));
        this._register(focusTracker.onDidBlur(() => this._onDidBlur.fire()));
    }
    renderHeader(container) {
        this.headerContainer = container;
        this.twistiesContainer = (0, dom_1.append)(container, (0, dom_1.$)(themables_1.ThemeIcon.asCSSSelector(this.getTwistyIcon(this.isExpanded()))));
        this.renderHeaderTitle(container, this.title);
        const actions = (0, dom_1.append)(container, (0, dom_1.$)('.actions'));
        actions.classList.toggle('show-always', this.showActions === ViewPaneShowActions.Always);
        actions.classList.toggle('show-expanded', this.showActions === ViewPaneShowActions.WhenExpanded);
        this.toolbar = this.instantiationService.createInstance(toolbar_1.WorkbenchToolBar, actions, {
            orientation: 0 /* ActionsOrientation.HORIZONTAL */,
            actionViewItemProvider: action => this.getActionViewItem(action),
            ariaLabel: nls.localize('viewToolbarAriaLabel', "{0} actions", this.title),
            getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
            renderDropdownAsChildElement: true,
            actionRunner: this.getActionRunner(),
            resetMenu: this.menuActions.menuId
        });
        this._register(this.toolbar);
        this.setActions();
        this._register((0, dom_1.addDisposableListener)(actions, dom_1.EventType.CLICK, e => e.preventDefault()));
        const viewContainerModel = this.viewDescriptorService.getViewContainerByViewId(this.id);
        if (viewContainerModel) {
            this._register(this.viewDescriptorService.getViewContainerModel(viewContainerModel).onDidChangeContainerInfo(({ title }) => this.updateTitle(this.title)));
        }
        else {
            console.error(`View container model not found for view ${this.id}`);
        }
        const onDidRelevantConfigurationChange = event_1.Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration(ViewPane_1.AlwaysShowActionsConfig));
        this._register(onDidRelevantConfigurationChange(this.updateActionsVisibility, this));
        this.updateActionsVisibility();
    }
    getTwistyIcon(expanded) {
        return expanded ? viewPaneContainerExpandedIcon : viewPaneContainerCollapsedIcon;
    }
    style(styles) {
        super.style(styles);
        const icon = this.getIcon();
        if (this.iconContainer) {
            const fgColor = (0, dom_1.asCssValueWithDefault)(styles.headerForeground, (0, colorRegistry_1.asCssVariable)(colorRegistry_1.foreground));
            if (uri_1.URI.isUri(icon)) {
                // Apply background color to activity bar item provided with iconUrls
                this.iconContainer.style.backgroundColor = fgColor;
                this.iconContainer.style.color = '';
            }
            else {
                // Apply foreground color to activity bar items provided with codicons
                this.iconContainer.style.color = fgColor;
                this.iconContainer.style.backgroundColor = '';
            }
        }
    }
    getIcon() {
        return this.viewDescriptorService.getViewDescriptorById(this.id)?.containerIcon || views_1.defaultViewIcon;
    }
    renderHeaderTitle(container, title) {
        this.iconContainer = (0, dom_1.append)(container, (0, dom_1.$)('.icon', undefined));
        const icon = this.getIcon();
        let cssClass = undefined;
        if (uri_1.URI.isUri(icon)) {
            cssClass = `view-${this.id.replace(/[\.\:]/g, '-')}`;
            const iconClass = `.pane-header .icon.${cssClass}`;
            (0, dom_1.createCSSRule)(iconClass, `
				mask: ${(0, dom_1.asCSSUrl)(icon)} no-repeat 50% 50%;
				mask-size: 24px;
				-webkit-mask: ${(0, dom_1.asCSSUrl)(icon)} no-repeat 50% 50%;
				-webkit-mask-size: 16px;
			`);
        }
        else if (themables_1.ThemeIcon.isThemeIcon(icon)) {
            cssClass = themables_1.ThemeIcon.asClassName(icon);
        }
        if (cssClass) {
            this.iconContainer.classList.add(...cssClass.split(' '));
        }
        const calculatedTitle = this.calculateTitle(title);
        this.titleContainer = (0, dom_1.append)(container, (0, dom_1.$)('h3.title', { title: calculatedTitle }, calculatedTitle));
        if (this._titleDescription) {
            this.setTitleDescription(this._titleDescription);
        }
        this.iconContainer.title = calculatedTitle;
        this.iconContainer.setAttribute('aria-label', calculatedTitle);
    }
    updateTitle(title) {
        const calculatedTitle = this.calculateTitle(title);
        if (this.titleContainer) {
            this.titleContainer.textContent = calculatedTitle;
            this.titleContainer.setAttribute('title', calculatedTitle);
        }
        if (this.iconContainer) {
            this.iconContainer.title = calculatedTitle;
            this.iconContainer.setAttribute('aria-label', calculatedTitle);
        }
        this._title = title;
        this._onDidChangeTitleArea.fire();
    }
    setTitleDescription(description) {
        if (this.titleDescriptionContainer) {
            this.titleDescriptionContainer.textContent = description ?? '';
            this.titleDescriptionContainer.setAttribute('title', description ?? '');
        }
        else if (description && this.titleContainer) {
            this.titleDescriptionContainer = (0, dom_1.after)(this.titleContainer, (0, dom_1.$)('span.description', { title: description }, description));
        }
    }
    updateTitleDescription(description) {
        this.setTitleDescription(description);
        this._titleDescription = description;
        this._onDidChangeTitleArea.fire();
    }
    calculateTitle(title) {
        const viewContainer = this.viewDescriptorService.getViewContainerByViewId(this.id);
        const model = this.viewDescriptorService.getViewContainerModel(viewContainer);
        const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(this.id);
        const isDefault = this.viewDescriptorService.getDefaultContainerById(this.id) === viewContainer;
        if (!isDefault && viewDescriptor?.containerTitle && model.title !== viewDescriptor.containerTitle) {
            return `${viewDescriptor.containerTitle}: ${title}`;
        }
        return title;
    }
    scrollableElement;
    renderBody(container) {
        this.bodyContainer = container;
        const viewWelcomeContainer = (0, dom_1.append)(container, (0, dom_1.$)('.welcome-view'));
        this.viewWelcomeContainer = (0, dom_1.$)('.welcome-view-content', { tabIndex: 0 });
        this.scrollableElement = this._register(new scrollableElement_1.DomScrollableElement(this.viewWelcomeContainer, {
            alwaysConsumeMouseWheel: true,
            horizontal: 2 /* ScrollbarVisibility.Hidden */,
            vertical: 3 /* ScrollbarVisibility.Visible */,
        }));
        (0, dom_1.append)(viewWelcomeContainer, this.scrollableElement.getDomNode());
        const onViewWelcomeChange = event_1.Event.any(this.viewWelcomeController.onDidChange, this.onDidChangeViewWelcomeState);
        this._register(onViewWelcomeChange(this.updateViewWelcome, this));
        this.updateViewWelcome();
    }
    layoutBody(height, width) {
        this.viewWelcomeContainer.style.height = `${height}px`;
        this.viewWelcomeContainer.style.width = `${width}px`;
        this.viewWelcomeContainer.classList.toggle('wide', width > 640);
        this.scrollableElement.scanDomNode();
    }
    onDidScrollRoot() {
        // noop
    }
    getProgressIndicator() {
        if (this.progressBar === undefined) {
            // Progress bar
            this.progressBar = this._register(new progressbar_1.ProgressBar(this.element, defaultStyles_1.defaultProgressBarStyles));
            this.progressBar.hide();
        }
        if (this.progressIndicator === undefined) {
            const that = this;
            this.progressIndicator = new progressIndicator_1.ScopedProgressIndicator((0, types_1.assertIsDefined)(this.progressBar), new class extends progressIndicator_1.AbstractProgressScope {
                constructor() {
                    super(that.id, that.isBodyVisible());
                    this._register(that.onDidChangeBodyVisibility(isVisible => isVisible ? this.onScopeOpened(that.id) : this.onScopeClosed(that.id)));
                }
            }());
        }
        return this.progressIndicator;
    }
    getProgressLocation() {
        return this.viewDescriptorService.getViewContainerByViewId(this.id).id;
    }
    getBackgroundColor() {
        switch (this.viewDescriptorService.getViewLocationById(this.id)) {
            case 1 /* ViewContainerLocation.Panel */:
                return theme_1.PANEL_BACKGROUND;
            case 0 /* ViewContainerLocation.Sidebar */:
            case 2 /* ViewContainerLocation.AuxiliaryBar */:
                return theme_1.SIDE_BAR_BACKGROUND;
        }
        return theme_1.SIDE_BAR_BACKGROUND;
    }
    focus() {
        if (this.shouldShowWelcome()) {
            this.viewWelcomeContainer.focus();
        }
        else if (this.element) {
            this.element.focus();
            this._onDidFocus.fire();
        }
    }
    setActions() {
        if (this.toolbar) {
            const primaryActions = [...this.menuActions.getPrimaryActions()];
            if (this.shouldShowFilterInHeader()) {
                primaryActions.unshift(exports.VIEWPANE_FILTER_ACTION);
            }
            this.toolbar.setActions((0, actionbar_1.prepareActions)(primaryActions), (0, actionbar_1.prepareActions)(this.menuActions.getSecondaryActions()));
            this.toolbar.context = this.getActionsContext();
        }
    }
    updateActionsVisibility() {
        if (!this.headerContainer) {
            return;
        }
        const shouldAlwaysShowActions = this.configurationService.getValue('workbench.view.alwaysShowHeaderActions');
        this.headerContainer.classList.toggle('actions-always-visible', shouldAlwaysShowActions);
    }
    updateActions() {
        this.setActions();
        this._onDidChangeTitleArea.fire();
    }
    getActionViewItem(action, options) {
        if (action.id === exports.VIEWPANE_FILTER_ACTION.id) {
            const that = this;
            return new class extends actionViewItems_1.BaseActionViewItem {
                constructor() { super(null, action); }
                setFocusable() { }
                get trapsArrowNavigation() { return true; }
                render(container) {
                    container.classList.add('viewpane-filter-container');
                    (0, dom_1.append)(container, that.getFilterWidget().element);
                }
            };
        }
        return (0, menuEntryActionViewItem_1.createActionViewItem)(this.instantiationService, action, { ...options, ...{ menuAsChild: action instanceof actions_2.SubmenuItemAction } });
    }
    getActionsContext() {
        return undefined;
    }
    getActionRunner() {
        return undefined;
    }
    getOptimalWidth() {
        return 0;
    }
    saveState() {
        // Subclasses to implement for saving state
    }
    updateViewWelcome() {
        this.viewWelcomeDisposable.dispose();
        if (!this.shouldShowWelcome()) {
            this.bodyContainer.classList.remove('welcome');
            this.viewWelcomeContainer.innerText = '';
            this.scrollableElement.scanDomNode();
            return;
        }
        const contents = this.viewWelcomeController.contents;
        if (contents.length === 0) {
            this.bodyContainer.classList.remove('welcome');
            this.viewWelcomeContainer.innerText = '';
            this.scrollableElement.scanDomNode();
            return;
        }
        const disposables = new lifecycle_1.DisposableStore();
        this.bodyContainer.classList.add('welcome');
        this.viewWelcomeContainer.innerText = '';
        for (const { content, precondition } of contents) {
            const lines = content.split('\n');
            for (let line of lines) {
                line = line.trim();
                if (!line) {
                    continue;
                }
                const linkedText = (0, linkedText_1.parseLinkedText)(line);
                if (linkedText.nodes.length === 1 && typeof linkedText.nodes[0] !== 'string') {
                    const node = linkedText.nodes[0];
                    const buttonContainer = (0, dom_1.append)(this.viewWelcomeContainer, (0, dom_1.$)('.button-container'));
                    const button = new button_1.Button(buttonContainer, { title: node.title, supportIcons: true, ...defaultStyles_1.defaultButtonStyles });
                    button.label = node.label;
                    button.onDidClick(_ => {
                        this.telemetryService.publicLog2('views.welcomeAction', { viewId: this.id, uri: node.href });
                        this.openerService.open(node.href, { allowCommands: true });
                    }, null, disposables);
                    disposables.add(button);
                    if (precondition) {
                        const updateEnablement = () => button.enabled = this.contextKeyService.contextMatchesRules(precondition);
                        updateEnablement();
                        const keys = new Set();
                        precondition.keys().forEach(key => keys.add(key));
                        const onDidChangeContext = event_1.Event.filter(this.contextKeyService.onDidChangeContext, e => e.affectsSome(keys));
                        onDidChangeContext(updateEnablement, null, disposables);
                    }
                }
                else {
                    const p = (0, dom_1.append)(this.viewWelcomeContainer, (0, dom_1.$)('p'));
                    for (const node of linkedText.nodes) {
                        if (typeof node === 'string') {
                            (0, dom_1.append)(p, document.createTextNode(node));
                        }
                        else {
                            const link = disposables.add(this.instantiationService.createInstance(link_1.Link, p, node, {}));
                            if (precondition && node.href.startsWith('command:')) {
                                const updateEnablement = () => link.enabled = this.contextKeyService.contextMatchesRules(precondition);
                                updateEnablement();
                                const keys = new Set();
                                precondition.keys().forEach(key => keys.add(key));
                                const onDidChangeContext = event_1.Event.filter(this.contextKeyService.onDidChangeContext, e => e.affectsSome(keys));
                                onDidChangeContext(updateEnablement, null, disposables);
                            }
                        }
                    }
                }
            }
        }
        this.scrollableElement.scanDomNode();
        this.viewWelcomeDisposable = disposables;
    }
    shouldShowWelcome() {
        return false;
    }
    getFilterWidget() {
        return undefined;
    }
    shouldShowFilterInHeader() {
        return false;
    }
};
exports.ViewPane = ViewPane;
exports.ViewPane = ViewPane = ViewPane_1 = __decorate([
    __param(1, keybinding_1.IKeybindingService),
    __param(2, contextView_1.IContextMenuService),
    __param(3, configuration_1.IConfigurationService),
    __param(4, contextkey_1.IContextKeyService),
    __param(5, views_1.IViewDescriptorService),
    __param(6, instantiation_1.IInstantiationService),
    __param(7, opener_1.IOpenerService),
    __param(8, themeService_1.IThemeService),
    __param(9, telemetry_1.ITelemetryService)
], ViewPane);
let FilterViewPane = class FilterViewPane extends ViewPane {
    filterWidget;
    dimension;
    filterContainer;
    constructor(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
        this.filterWidget = this._register(instantiationService.createChild(new serviceCollection_1.ServiceCollection([contextkey_1.IContextKeyService, this.scopedContextKeyService])).createInstance(viewFilter_1.FilterWidget, options.filterOptions));
    }
    getFilterWidget() {
        return this.filterWidget;
    }
    renderBody(container) {
        super.renderBody(container);
        this.filterContainer = (0, dom_1.append)(container, (0, dom_1.$)('.viewpane-filter-container'));
    }
    layoutBody(height, width) {
        super.layoutBody(height, width);
        this.dimension = new dom_1.Dimension(width, height);
        const wasFilterShownInHeader = !this.filterContainer?.hasChildNodes();
        const shouldShowFilterInHeader = this.shouldShowFilterInHeader();
        if (wasFilterShownInHeader !== shouldShowFilterInHeader) {
            if (shouldShowFilterInHeader) {
                (0, dom_1.reset)(this.filterContainer);
            }
            this.updateActions();
            if (!shouldShowFilterInHeader) {
                (0, dom_1.append)(this.filterContainer, this.filterWidget.element);
            }
        }
        if (!shouldShowFilterInHeader) {
            height = height - 44;
        }
        this.filterWidget.layout(width);
        this.layoutBodyContent(height, width);
    }
    shouldShowFilterInHeader() {
        return !(this.dimension && this.dimension.width < 600 && this.dimension.height > 100);
    }
};
exports.FilterViewPane = FilterViewPane;
exports.FilterViewPane = FilterViewPane = __decorate([
    __param(1, keybinding_1.IKeybindingService),
    __param(2, contextView_1.IContextMenuService),
    __param(3, configuration_1.IConfigurationService),
    __param(4, contextkey_1.IContextKeyService),
    __param(5, views_1.IViewDescriptorService),
    __param(6, instantiation_1.IInstantiationService),
    __param(7, opener_1.IOpenerService),
    __param(8, themeService_1.IThemeService),
    __param(9, telemetry_1.ITelemetryService)
], FilterViewPane);
class ViewAction extends actions_2.Action2 {
    desc;
    constructor(desc) {
        super(desc);
        this.desc = desc;
    }
    run(accessor, ...args) {
        const view = accessor.get(views_1.IViewsService).getActiveViewWithId(this.desc.viewId);
        if (view) {
            return this.runInView(accessor, view, ...args);
        }
    }
}
exports.ViewAction = ViewAction;
