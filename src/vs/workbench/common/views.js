"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoTreeViewError = exports.ResolvableTreeItem = exports.TreeItemCollapsibleState = exports.ViewVisibilityState = exports.IViewDescriptorService = exports.IViewsService = exports.ViewContentGroups = exports.ViewContainerLocations = exports.Extensions = exports.defaultViewIcon = void 0;
exports.ViewContainerLocationToString = ViewContainerLocationToString;
const event_1 = require("vs/base/common/event");
const nls_1 = require("vs/nls");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
const lifecycle_1 = require("vs/base/common/lifecycle");
const map_1 = require("vs/base/common/map");
const platform_1 = require("vs/platform/registry/common/platform");
const arrays_1 = require("vs/base/common/arrays");
const collections_1 = require("vs/base/common/collections");
const objects_1 = require("vs/base/common/objects");
const codicons_1 = require("vs/base/common/codicons");
const iconRegistry_1 = require("vs/platform/theme/common/iconRegistry");
exports.defaultViewIcon = (0, iconRegistry_1.registerIcon)('default-view-icon', codicons_1.Codicon.window, (0, nls_1.localize)('defaultViewIcon', 'Default view icon.'));
var Extensions;
(function (Extensions) {
    Extensions.ViewContainersRegistry = 'workbench.registry.view.containers';
    Extensions.ViewsRegistry = 'workbench.registry.view';
})(Extensions || (exports.Extensions = Extensions = {}));
exports.ViewContainerLocations = [0 /* ViewContainerLocation.Sidebar */, 1 /* ViewContainerLocation.Panel */, 2 /* ViewContainerLocation.AuxiliaryBar */];
function ViewContainerLocationToString(viewContainerLocation) {
    switch (viewContainerLocation) {
        case 0 /* ViewContainerLocation.Sidebar */: return 'sidebar';
        case 1 /* ViewContainerLocation.Panel */: return 'panel';
        case 2 /* ViewContainerLocation.AuxiliaryBar */: return 'auxiliarybar';
    }
    return '';
}
class ViewContainersRegistryImpl extends lifecycle_1.Disposable {
    _onDidRegister = this._register(new event_1.Emitter());
    onDidRegister = this._onDidRegister.event;
    _onDidDeregister = this._register(new event_1.Emitter());
    onDidDeregister = this._onDidDeregister.event;
    viewContainers = new Map();
    defaultViewContainers = [];
    get all() {
        return (0, arrays_1.flatten)([...this.viewContainers.values()]);
    }
    registerViewContainer(viewContainerDescriptor, viewContainerLocation, options) {
        const existing = this.get(viewContainerDescriptor.id);
        if (existing) {
            return existing;
        }
        const viewContainer = viewContainerDescriptor;
        viewContainer.openCommandActionDescriptor = options?.doNotRegisterOpenCommand ? undefined : (viewContainer.openCommandActionDescriptor ?? { id: viewContainer.id });
        const viewContainers = (0, map_1.getOrSet)(this.viewContainers, viewContainerLocation, []);
        viewContainers.push(viewContainer);
        if (options?.isDefault) {
            this.defaultViewContainers.push(viewContainer);
        }
        this._onDidRegister.fire({ viewContainer, viewContainerLocation });
        return viewContainer;
    }
    deregisterViewContainer(viewContainer) {
        for (const viewContainerLocation of this.viewContainers.keys()) {
            const viewContainers = this.viewContainers.get(viewContainerLocation);
            const index = viewContainers?.indexOf(viewContainer);
            if (index !== -1) {
                viewContainers?.splice(index, 1);
                if (viewContainers.length === 0) {
                    this.viewContainers.delete(viewContainerLocation);
                }
                this._onDidDeregister.fire({ viewContainer, viewContainerLocation });
                return;
            }
        }
    }
    get(id) {
        return this.all.filter(viewContainer => viewContainer.id === id)[0];
    }
    getViewContainers(location) {
        return [...(this.viewContainers.get(location) || [])];
    }
    getViewContainerLocation(container) {
        return [...this.viewContainers.keys()].filter(location => this.getViewContainers(location).filter(viewContainer => viewContainer?.id === container.id).length > 0)[0];
    }
    getDefaultViewContainer(location) {
        return this.defaultViewContainers.find(viewContainer => this.getViewContainerLocation(viewContainer) === location);
    }
}
platform_1.Registry.add(Extensions.ViewContainersRegistry, new ViewContainersRegistryImpl());
var ViewContentGroups;
(function (ViewContentGroups) {
    ViewContentGroups["Open"] = "2_open";
    ViewContentGroups["Debug"] = "4_debug";
    ViewContentGroups["SCM"] = "5_scm";
    ViewContentGroups["More"] = "9_more";
})(ViewContentGroups || (exports.ViewContentGroups = ViewContentGroups = {}));
function compareViewContentDescriptors(a, b) {
    const aGroup = a.group ?? ViewContentGroups.More;
    const bGroup = b.group ?? ViewContentGroups.More;
    if (aGroup !== bGroup) {
        return aGroup.localeCompare(bGroup);
    }
    return (a.order ?? 5) - (b.order ?? 5);
}
class ViewsRegistry extends lifecycle_1.Disposable {
    _onViewsRegistered = this._register(new event_1.Emitter());
    onViewsRegistered = this._onViewsRegistered.event;
    _onViewsDeregistered = this._register(new event_1.Emitter());
    onViewsDeregistered = this._onViewsDeregistered.event;
    _onDidChangeContainer = this._register(new event_1.Emitter());
    onDidChangeContainer = this._onDidChangeContainer.event;
    _onDidChangeViewWelcomeContent = this._register(new event_1.Emitter());
    onDidChangeViewWelcomeContent = this._onDidChangeViewWelcomeContent.event;
    _viewContainers = [];
    _views = new Map();
    _viewWelcomeContents = new collections_1.SetMap();
    registerViews(views, viewContainer) {
        this.registerViews2([{ views, viewContainer }]);
    }
    registerViews2(views) {
        views.forEach(({ views, viewContainer }) => this.addViews(views, viewContainer));
        this._onViewsRegistered.fire(views);
    }
    deregisterViews(viewDescriptors, viewContainer) {
        const views = this.removeViews(viewDescriptors, viewContainer);
        if (views.length) {
            this._onViewsDeregistered.fire({ views, viewContainer });
        }
    }
    moveViews(viewsToMove, viewContainer) {
        for (const container of this._views.keys()) {
            if (container !== viewContainer) {
                const views = this.removeViews(viewsToMove, container);
                if (views.length) {
                    this.addViews(views, viewContainer);
                    this._onDidChangeContainer.fire({ views, from: container, to: viewContainer });
                }
            }
        }
    }
    getViews(loc) {
        return this._views.get(loc) || [];
    }
    getView(id) {
        for (const viewContainer of this._viewContainers) {
            const viewDescriptor = (this._views.get(viewContainer) || []).filter(v => v.id === id)[0];
            if (viewDescriptor) {
                return viewDescriptor;
            }
        }
        return null;
    }
    getViewContainer(viewId) {
        for (const viewContainer of this._viewContainers) {
            const viewDescriptor = (this._views.get(viewContainer) || []).filter(v => v.id === viewId)[0];
            if (viewDescriptor) {
                return viewContainer;
            }
        }
        return null;
    }
    registerViewWelcomeContent(id, viewContent) {
        this._viewWelcomeContents.add(id, viewContent);
        this._onDidChangeViewWelcomeContent.fire(id);
        return (0, lifecycle_1.toDisposable)(() => {
            this._viewWelcomeContents.delete(id, viewContent);
            this._onDidChangeViewWelcomeContent.fire(id);
        });
    }
    registerViewWelcomeContent2(id, viewContentMap) {
        const disposables = new Map();
        for (const [key, content] of viewContentMap) {
            this._viewWelcomeContents.add(id, content);
            disposables.set(key, (0, lifecycle_1.toDisposable)(() => {
                this._viewWelcomeContents.delete(id, content);
                this._onDidChangeViewWelcomeContent.fire(id);
            }));
        }
        this._onDidChangeViewWelcomeContent.fire(id);
        return disposables;
    }
    getViewWelcomeContent(id) {
        const result = [];
        this._viewWelcomeContents.forEach(id, descriptor => result.push(descriptor));
        return result.sort(compareViewContentDescriptors);
    }
    addViews(viewDescriptors, viewContainer) {
        let views = this._views.get(viewContainer);
        if (!views) {
            views = [];
            this._views.set(viewContainer, views);
            this._viewContainers.push(viewContainer);
        }
        for (const viewDescriptor of viewDescriptors) {
            if (this.getView(viewDescriptor.id) !== null) {
                throw new Error((0, nls_1.localize)('duplicateId', "A view with id '{0}' is already registered", viewDescriptor.id));
            }
            views.push(viewDescriptor);
        }
    }
    removeViews(viewDescriptors, viewContainer) {
        const views = this._views.get(viewContainer);
        if (!views) {
            return [];
        }
        const viewsToDeregister = [];
        const remaningViews = [];
        for (const view of views) {
            if (!viewDescriptors.includes(view)) {
                remaningViews.push(view);
            }
            else {
                viewsToDeregister.push(view);
            }
        }
        if (viewsToDeregister.length) {
            if (remaningViews.length) {
                this._views.set(viewContainer, remaningViews);
            }
            else {
                this._views.delete(viewContainer);
                this._viewContainers.splice(this._viewContainers.indexOf(viewContainer), 1);
            }
        }
        return viewsToDeregister;
    }
}
platform_1.Registry.add(Extensions.ViewsRegistry, new ViewsRegistry());
exports.IViewsService = (0, instantiation_1.createDecorator)('viewsService');
exports.IViewDescriptorService = (0, instantiation_1.createDecorator)('viewDescriptorService');
var ViewVisibilityState;
(function (ViewVisibilityState) {
    ViewVisibilityState[ViewVisibilityState["Default"] = 0] = "Default";
    ViewVisibilityState[ViewVisibilityState["Expand"] = 1] = "Expand";
})(ViewVisibilityState || (exports.ViewVisibilityState = ViewVisibilityState = {}));
var TreeItemCollapsibleState;
(function (TreeItemCollapsibleState) {
    TreeItemCollapsibleState[TreeItemCollapsibleState["None"] = 0] = "None";
    TreeItemCollapsibleState[TreeItemCollapsibleState["Collapsed"] = 1] = "Collapsed";
    TreeItemCollapsibleState[TreeItemCollapsibleState["Expanded"] = 2] = "Expanded";
})(TreeItemCollapsibleState || (exports.TreeItemCollapsibleState = TreeItemCollapsibleState = {}));
class ResolvableTreeItem {
    handle;
    parentHandle;
    collapsibleState;
    label;
    description;
    icon;
    iconDark;
    themeIcon;
    resourceUri;
    tooltip;
    contextValue;
    command;
    children;
    accessibilityInformation;
    resolve;
    resolved = false;
    _hasResolve = false;
    constructor(treeItem, resolve) {
        (0, objects_1.mixin)(this, treeItem);
        this._hasResolve = !!resolve;
        this.resolve = async (token) => {
            if (resolve && !this.resolved) {
                const resolvedItem = await resolve(token);
                if (resolvedItem) {
                    // Resolvable elements. Currently tooltip and command.
                    this.tooltip = this.tooltip ?? resolvedItem.tooltip;
                    this.command = this.command ?? resolvedItem.command;
                }
            }
            if (!token.isCancellationRequested) {
                this.resolved = true;
            }
        };
    }
    get hasResolve() {
        return this._hasResolve;
    }
    resetResolve() {
        this.resolved = false;
    }
    asTreeItem() {
        return {
            handle: this.handle,
            parentHandle: this.parentHandle,
            collapsibleState: this.collapsibleState,
            label: this.label,
            description: this.description,
            icon: this.icon,
            iconDark: this.iconDark,
            themeIcon: this.themeIcon,
            resourceUri: this.resourceUri,
            tooltip: this.tooltip,
            contextValue: this.contextValue,
            command: this.command,
            children: this.children,
            accessibilityInformation: this.accessibilityInformation
        };
    }
}
exports.ResolvableTreeItem = ResolvableTreeItem;
class NoTreeViewError extends Error {
    name = 'NoTreeViewError';
    constructor(treeViewId) {
        super((0, nls_1.localize)('treeView.notRegistered', 'No tree view with id \'{0}\' registered.', treeViewId));
    }
    static is(err) {
        return err.name === 'NoTreeViewError';
    }
}
exports.NoTreeViewError = NoTreeViewError;
