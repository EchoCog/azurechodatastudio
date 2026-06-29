"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.NullPolicyService = exports.AbstractPolicyService = exports.IPolicyService = void 0;
const event_1 = require("vs/base/common/event");
const iterator_1 = require("vs/base/common/iterator");
const lifecycle_1 = require("vs/base/common/lifecycle");
const instantiation_1 = require("vs/platform/instantiation/common/instantiation");
exports.IPolicyService = (0, instantiation_1.createDecorator)('policy');
class AbstractPolicyService extends lifecycle_1.Disposable {
    _serviceBrand;
    policyDefinitions = {};
    policies = new Map();
    _onDidChange = this._register(new event_1.Emitter());
    onDidChange = this._onDidChange.event;
    async updatePolicyDefinitions(policyDefinitions) {
        const size = Object.keys(this.policyDefinitions).length;
        this.policyDefinitions = { ...policyDefinitions, ...this.policyDefinitions };
        if (size !== Object.keys(this.policyDefinitions).length) {
            await this._updatePolicyDefinitions(policyDefinitions);
        }
        return iterator_1.Iterable.reduce(this.policies.entries(), (r, [name, value]) => ({ ...r, [name]: value }), {});
    }
    getPolicyValue(name) {
        return this.policies.get(name);
    }
    serialize() {
        return iterator_1.Iterable.reduce(Object.entries(this.policyDefinitions), (r, [name, definition]) => ({ ...r, [name]: { definition, value: this.policies.get(name) } }), {});
    }
}
exports.AbstractPolicyService = AbstractPolicyService;
class NullPolicyService {
    _serviceBrand;
    onDidChange = event_1.Event.None;
    async updatePolicyDefinitions() { return {}; }
    getPolicyValue() { return undefined; }
    serialize() { return undefined; }
}
exports.NullPolicyService = NullPolicyService;
