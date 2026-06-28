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
exports.TestInstantiationService = void 0;
exports.createServices = createServices;
const sinon = __importStar(require("sinon"));
const lifecycle_1 = require("vs/base/common/lifecycle");
const descriptors_1 = require("vs/platform/instantiation/common/descriptors");
const instantiationService_1 = require("vs/platform/instantiation/common/instantiationService");
const serviceCollection_1 = require("vs/platform/instantiation/common/serviceCollection");
const isSinonSpyLike = (fn) => fn && 'callCount' in fn;
class TestInstantiationService extends instantiationService_1.InstantiationService {
    _serviceCollection;
    _servciesMap;
    constructor(_serviceCollection = new serviceCollection_1.ServiceCollection(), strict = false, parent) {
        super(_serviceCollection, strict, parent);
        this._serviceCollection = _serviceCollection;
        this._servciesMap = new Map();
    }
    get(service) {
        return super._getOrCreateServiceInstance(service, instantiationService_1.Trace.traceCreation(false, TestInstantiationService));
    }
    set(service, instance) {
        return this._serviceCollection.set(service, instance);
    }
    mock(service) {
        return this._create(service, { mock: true });
    }
    stub(serviceIdentifier, arg2, arg3, arg4) {
        const service = typeof arg2 !== 'string' ? arg2 : undefined;
        const serviceMock = { id: serviceIdentifier, service: service };
        const property = typeof arg2 === 'string' ? arg2 : arg3;
        const value = typeof arg2 === 'string' ? arg3 : arg4;
        const stubObject = this._create(serviceMock, { stub: true }, service && !property);
        if (property) {
            if (stubObject[property]) {
                if (stubObject[property].hasOwnProperty('restore')) {
                    stubObject[property].restore();
                }
                if (typeof value === 'function') {
                    const spy = isSinonSpyLike(value) ? value : sinon.spy(value);
                    stubObject[property] = spy;
                    return spy;
                }
                else {
                    const stub = value ? sinon.stub().returns(value) : sinon.stub();
                    stubObject[property] = stub;
                    return stub;
                }
            }
            else {
                stubObject[property] = value;
            }
        }
        return stubObject;
    }
    stubPromise(arg1, arg2, arg3, arg4) {
        arg3 = typeof arg2 === 'string' ? Promise.resolve(arg3) : arg3;
        arg4 = typeof arg2 !== 'string' && typeof arg3 === 'string' ? Promise.resolve(arg4) : arg4;
        return this.stub(arg1, arg2, arg3, arg4);
    }
    spy(service, fnProperty) {
        const spy = sinon.spy();
        this.stub(service, fnProperty, spy);
        return spy;
    }
    _create(arg1, options, reset = false) {
        if (this.isServiceMock(arg1)) {
            const service = this._getOrCreateService(arg1, options, reset);
            this._serviceCollection.set(arg1.id, service);
            return service;
        }
        return options.mock ? sinon.mock(arg1) : this._createStub(arg1);
    }
    _getOrCreateService(serviceMock, opts, reset) {
        const service = this._serviceCollection.get(serviceMock.id);
        if (!reset && service) {
            if (opts.mock && service['sinonOptions'] && !!service['sinonOptions'].mock) {
                return service;
            }
            if (opts.stub && service['sinonOptions'] && !!service['sinonOptions'].stub) {
                return service;
            }
        }
        return this._createService(serviceMock, opts);
    }
    _createService(serviceMock, opts) {
        serviceMock.service = serviceMock.service ? serviceMock.service : this._servciesMap.get(serviceMock.id);
        const service = opts.mock ? sinon.mock(serviceMock.service) : this._createStub(serviceMock.service);
        service['sinonOptions'] = opts;
        return service;
    }
    _createStub(arg) {
        return typeof arg === 'object' ? arg : sinon.createStubInstance(arg);
    }
    isServiceMock(arg1) {
        return typeof arg1 === 'object' && arg1.hasOwnProperty('id');
    }
    createChild(services) {
        return new TestInstantiationService(services, false, this);
    }
    dispose() {
        sinon.restore();
    }
}
exports.TestInstantiationService = TestInstantiationService;
function createServices(disposables, services) {
    const serviceIdentifiers = [];
    const serviceCollection = new serviceCollection_1.ServiceCollection();
    const define = (id, ctorOrInstance) => {
        if (!serviceCollection.has(id)) {
            if (typeof ctorOrInstance === 'function') {
                serviceCollection.set(id, new descriptors_1.SyncDescriptor(ctorOrInstance));
            }
            else {
                serviceCollection.set(id, ctorOrInstance);
            }
        }
        serviceIdentifiers.push(id);
    };
    for (const [id, ctor] of services) {
        define(id, ctor);
    }
    const instantiationService = disposables.add(new TestInstantiationService(serviceCollection, true));
    disposables.add((0, lifecycle_1.toDisposable)(() => {
        for (const id of serviceIdentifiers) {
            const instanceOrDescriptor = serviceCollection.get(id);
            if (typeof instanceOrDescriptor.dispose === 'function') {
                instanceOrDescriptor.dispose();
            }
        }
    }));
    return instantiationService;
}
