"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SetMap = void 0;
exports.values = values;
exports.forEach = forEach;
exports.groupBy = groupBy;
exports.diffSets = diffSets;
exports.diffMaps = diffMaps;
// {{ SQL CARBON EDIT }} - BEGIN - Needed to retrive values from IStringDictionary's and INumberDictionary's
const hasOwnProperty = Object.prototype.hasOwnProperty;
/**
 * Returns an array which contains all values that reside
 * in the given dictionary.
 */
function values(from) {
    const result = [];
    for (let key in from) {
        if (hasOwnProperty.call(from, key)) {
            result.push(from[key]);
        }
    }
    return result;
}
function forEach(from, callback) {
    for (let key in from) {
        if (hasOwnProperty.call(from, key)) {
            const result = callback({ key: key, value: from[key] }, function () {
                delete from[key];
            });
            if (result === false) {
                return;
            }
        }
    }
}
// {{ SQL CARBON EDIT }} - END - Adding forEach definition
/**
 * Groups the collection into a dictionary based on the provided
 * group function.
 */
function groupBy(data, groupFn) {
    const result = Object.create(null);
    for (const element of data) {
        const key = groupFn(element);
        let target = result[key];
        if (!target) {
            target = result[key] = [];
        }
        target.push(element);
    }
    return result;
}
function diffSets(before, after) {
    const removed = [];
    const added = [];
    for (const element of before) {
        if (!after.has(element)) {
            removed.push(element);
        }
    }
    for (const element of after) {
        if (!before.has(element)) {
            added.push(element);
        }
    }
    return { removed, added };
}
function diffMaps(before, after) {
    const removed = [];
    const added = [];
    for (const [index, value] of before) {
        if (!after.has(index)) {
            removed.push(value);
        }
    }
    for (const [index, value] of after) {
        if (!before.has(index)) {
            added.push(value);
        }
    }
    return { removed, added };
}
class SetMap {
    map = new Map();
    add(key, value) {
        let values = this.map.get(key);
        if (!values) {
            values = new Set();
            this.map.set(key, values);
        }
        values.add(value);
    }
    delete(key, value) {
        const values = this.map.get(key);
        if (!values) {
            return;
        }
        values.delete(value);
        if (values.size === 0) {
            this.map.delete(key);
        }
    }
    forEach(key, fn) {
        const values = this.map.get(key);
        if (!values) {
            return;
        }
        values.forEach(fn);
    }
    get(key) {
        const values = this.map.get(key);
        if (!values) {
            return new Set();
        }
        return values;
    }
}
exports.SetMap = SetMap;
