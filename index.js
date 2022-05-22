'use strict';

// XXX: for one, `vdo run-tests` seems to be running an old image with a
//      spurious console log? for another, do we need a separate `translateXYZ`
//      to handle indexes? dollar signs get messy maybe

const bs58 = require('bs58');
const clone = require('clone');
const crypto = require('crypto');
const deepEqual = require('deep-equal');
const lodash = require('lodash');
const util = require('util');

const { ObjectId } = require('mongodb');

module.exports = class SbOptimisticEntityCollection {
    constructor(collection, {
        log = console.log.bind(console),
        nower = Date.now,
        ...otherOpts
    } = {}) {
        this.collection = collection;
        this.log = log;
        this.nower = nower;
        this.setTimeout = otherOpts.setTimeout || setTimeout;
    }

    async deleteOne(q, opts = {}) {
        return (await this.deleteOneRecord(q, opts))
                .collectionOperationResult;
    }

    async deleteOneRecord(q, opts = {}) {
        return await mutateOneRecord.bind(this)(
                q, deleteMutation.bind(this)(opts.confirmDelete), opts)
    }

    find(q, opts = {}) {
        return this.findRecords(q, opts).map(({ value }) => value);
    }

    findRecords(q, opts = {}) {
        return this.collection
                .find(SbOptimisticEntityCollection.translateQuery(q), {})
                .map(mongoDocToEntityRecord);
    }

    async findOne(q, opts = {}) {
        return (await this.findOneRecord(q, opts)).value;
    }

    async findOneRecord(q, opts = {}) {
        const entityDoc =
                await this.collection.findOne(
                    SbOptimisticEntityCollection.translateQuery(q), opts);

        let result;
        if (entityDoc) {
            result = mongoDocToEntityRecord(entityDoc);
        }
        else {
            // I'd usually prefer throw an exception in this case, but this is a
            // little more "Mongo-like".
            result = { value: null };
        }

        return result;
    }

    async insertOne(initialValue, opts = {}) {
        return (await this.insertOneRecord(initialValue, opts))
                .collectionOperationResult;
    }

    async insertOneRecord(initialValue, opts = {}) {
        assertValidValue(initialValue, 'initialValue');

        if (!('_id' in initialValue)) {
            initialValue._id = new ObjectId();
        }

        const now = new Date(this.nower());
        const version = bs58.encode(crypto.randomBytes(8));

        const collectionOperationResult = await this.collection.insertOne(
                toMongoDoc(initialValue, version, now, now), opts);

        return {
            collectionOperationResult,
            createdAt: now,
            updatedAt: now,
            value: initialValue,
            version
        };
    }

    async updateOne(q, fn, opts) {
        return (await this.updateOneRecord(q, fn, opts))
                .collectionOperationResult;
    }

    async updateOneRecord(q, fn, opts = {}) {
        return await mutateOneRecord.bind(this)(
                q, updateMutation.bind(this)(q, fn), opts)
    }

    static translateIndexKey(indexKeys) {
        return mapKeys(indexKeys, (k, p) => {
            let result;

            if (p.length > 0 || k === '_id' || k === '$**') {
                result = k;
            }
            else {
                result = `v_${k}`
            }

            return result;
        });
    }

    static translateQuery(q) {
        return mapKeys(q, (k, p) => {
            let result;

            if (p.length > 0 || k === '_id' || k.startsWith('$')) {
                result = k;
            }
            else {
                result = `v_${k}`
            }

            return result;
        });
    }
}

function assertValidValue(v, desc) {
    if (typeof v !== 'object' || Array.isArray(v) || v === null) {
        throw error('INVALID_VALUE', `${v} must be a non-array, non-null `
                + `object. Was: ` + util.inspect(v));
    }
}

function deleteMutation(confirmDelete = (() => true)) {
    return async (curRecord, now, { upsert }) => {
        let collectionOperationResult;

        const confirmed = await confirmDelete(curRecord.value, curRecord);
        if (confirmed) {
            collectionOperationResult = await this.collection.deleteOne({
                _id: curRecord.value._id,
                version: curRecord.version
            });
        }
        else {
            collectionOperationResult = {
                acknowledged: true,
                deletedCount: 0
            };
        }

        return {
            collectionOperationResult,
            newValue: confirmed ? undefined : curRecord.value,
            newVersion: confirmed ? undefined : curRecord.version
        };
    };
}

function error(code, msg, cause) {
    const e = new Error(msg);
    e.cause = cause;
    e.code = code;

    return e;
}

function extractKeysWithPrefix(o, prefix) {
    return Object.fromEntries(
            Object.entries(o)
                    .filter(([k]) => k.startsWith(prefix))
                    .map(([k,v]) => [k.substring(prefix.length), v]));
}

function generateDefaultDocForUpsert(query) {
    const result = {};

    for (let [key, value] of Object.entries(query)) {
        if (value && typeof value === 'object') {
            const ops = Object.keys(value).filter(k => k.startsWith('$'));

            if (ops.includes('$eq')) {
                value = value.$eq;
            }
            else if (ops.length > 0) {
                continue;
            }
        }

        // Either null, or not an object, or had an $eq
        lodash.set(result, key, value);
    }

    return result;
}

function mapKeys(o, fn, path = []) {
    let result;

    if (typeof o === 'object') {
        if (o === null || o instanceof ObjectId) {
            result = o;
        }
        else if (Array.isArray(o)) {
            result = o.map((el, i) => {
                path.push(i);
                const result = mapKeys(el, fn);
                path.pop();
                return result;
            });
        }
        else {
            result = Object.fromEntries(Object.entries(o).map(
                    ([key, val]) => {
                        const newKey = fn(key, path);
                        path.push(key);
                        const newVal = mapKeys(val, fn, path);
                        path.pop();
                        return [newKey, newVal];
                    }));
        }
    }
    else {
        result = o;
    }

    return result;
}

function mapTopLevelKeys(o, map) {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [map(k), v]));
}

function mongoDocToEntityRecord(d) {
    const value = extractKeysWithPrefix(d, 'v_');
    value._id = d._id;

    return {
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        value,
        version: d.version
    };
}

async function mutateOneRecord(q, fn, opts = {}) {
    let { expectedVersions, shouldRetry } = opts;

    if (!shouldRetry || shouldRetry === true) {
        shouldRetry = async tries => {
            await new Promise(resolve => this.setTimeout(resolve, 200));

            return tries < 3;
        };
    }

    expectedVersions =
            validateAndNormalizeExpectedVersions(expectedVersions);

    let curRecord;
    let collectionOperationResult;
    let newValue;
    let newVersion;
    const now = new Date(this.nower());
    let tries = 0;

    do {
        curRecord = await this.findOneRecord(q);

        if (expectedVersions !== undefined
                && !expectedVersions.includes(curRecord.version)) {
            throw error('VERSION_ASSERTION_FAILED', `Not an expected `
                    + `version: "${curRecord.version}". Expected one of: `
                    + `${JSON.stringify(expectedVersions)}`);
        }

        tries++;

        ({ collectionOperationResult, newValue, newVersion } =
                await fn(curRecord, now, opts));

    } while (!collectionOperationResult && await shouldRetry(tries));

    if (!collectionOperationResult) {
        throw error('EXHAUSTED_RETRIES',
                'Ran out of retries attempting to update by query '
                + util.inspect(q));
    }

    return {
        collectionOperationResult,
        createdAt: newValue ? (curRecord.createdAt || now) : undefined,
        updatedAt: newValue ? now : undefined,
        value: newValue,
        version: newVersion
    };
}

function toMongoDoc(value, version, createdAt, now) {
    const valueWithoutId = { ...value };
    delete valueWithoutId._id;

    const result = {
        createdAt,
        updatedAt: now,
        version,

        ...mapTopLevelKeys(valueWithoutId, k => `v_${k}`)
    };

    if (value._id) {
        result._id = value._id;
    }

    return result;
}

function updateMutation(q, fn) {
    return async (curRecord, now, { upsert }) => {
        let collectionOperationResult;
        let newValue;
        let newVersion;

        let op;
        if (curRecord.value === null) {
            if (upsert) {
                newValue = await fn(
                        generateDefaultDocForUpsert(q), curRecord);

                if (!('_id' in newValue)) {
                    newValue._id = new ObjectId();
                }

                op = async doc => {
                    let result;

                    try {
                        result = await this.collection.insertOne(doc);
                    }
                    catch (e) {
                        if (e.code !== 11000) {
                            throw error('UNEXPECTED_ERROR',
                                    'Unexpected error.', e);
                        }

                        // Somebody else inserted in the meantime. We should
                        // maybe try again...
                    }

                    return result;
                };
            }
        }
        else {
            const oldId = clone(curRecord.value._id);
            newValue = await fn(curRecord.value, curRecord);

            if (newValue && !deepEqual(newValue._id, oldId)) {
                const oldIdStr = util.inspect(oldId);
                const newIdStr = util.inspect(newValue._id);
                throw error('INVALID_UPDATE',
                        `Cannot modify _id. ${newIdStr} != ${oldIdStr}`);
            }

            op = async doc => {
                let result;

                result = await this.collection.replaceOne({
                    _id: curRecord.value._id,
                    version: curRecord.version
                }, doc);

                if (result.matchedCount === 0) {
                    // Someone has updated or deleted out from under us. We
                    // should maybe try again...
                    result = undefined;
                }

                return result;
            };
        }

        if (newValue) {
            assertValidValue(newValue, 'Result of update function');

            newVersion = bs58.encode(crypto.randomBytes(8));

            collectionOperationResult = await op(toMongoDoc(
                    newValue,
                    newVersion,
                    curRecord.createdAt || now,
                    now));
        }
        else {
            collectionOperationResult = {
                acknowledged: true,
                modifiedCount: 0,
                upsertedId: null,
                upsertedCount: 0,
                matchedCount: 0
            };
        }

        return {
            collectionOperationResult,
            newValue: newValue ?
                    newValue : undefined, // Regularize falsey to undefined
            newVersion: newValue ? newVersion : curRecord.version
        };
    };
}

function validateAndNormalizeExpectedVersions(expectedVersions) {
    if (expectedVersions !== undefined) {
        if (!Array.isArray(expectedVersions)) {
            expectedVersions = [expectedVersions];
        }

        for (const v of expectedVersions) {
            if (!/\w{5,15}/.test(v)) {
                throw error('INVALID_VERSION', `Invalid version: ${v}`);
            }
        }
    }

    return expectedVersions;
}
