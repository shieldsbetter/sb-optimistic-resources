'use strict';

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

    find(q) {
        return this.findRecords(q).map(({ value }) => value);
    }

    findRecords(q) {
        return this.collection.find(this.translateQuery(q))
                .map(mongoDocToEntityRecord);
    }

    async findOne(q) {
        return (await this.findOneRecord(q)).value;
    }

    async findOneRecord(q) {
        const entityDoc = await this.collection.findOne(this.translateQuery(q));

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

    async insertOne(initialValue) {
        return (await this.insertOneRecord(initialValue))
                .collectionOperationResult;
    }

    async insertOneRecord(initialValue) {
        assertValidValue(initialValue, 'initialValue');

        if (!('_id' in initialValue)) {
            initialValue._id = new ObjectId();
        }

        const now = new Date(this.nower());
        const version = bs58.encode(crypto.randomBytes(8));

        const collectionOperationResult = await this.collection.insertOne(
                toMongoDoc(encodeKeys(initialValue), version, now, now));

        return {
            collectionOperationResult,
            createdAt: now,
            updatedAt: now,
            value: initialValue,
            version
        };
    }

    translateQuery(q) {
        return mapKeys(q, (k, p) => {
            let result;

            if (k === '_id' || k.startsWith('$')) {
                result = k;
            }
            else {
                result = k
                        .replace('%', '%25')
                        .replace('$', '%24')
                        .replace('.', '%2E');

                if (p.length === 0) {
                    result = 'v_' + result;
                }
            }

            return result;
        });
    }

    async updateOne(q, fn, opts) {
        return (await this.updateOneRecord(q, fn, opts))
                .collectionOperationResult;
    }

    async updateOneRecord(
            q, fn, { expectedVersions, shouldRetry, upsert } = {}) {
        if (!shouldRetry || shouldRetry === true) {
            shouldRetry = async tries => {
                await new Promise(resolve => this.setTimeout(resolve, 200));

                return tries < 3;
            };
        }

        expectedVersions =
                validateAndNormalizeExpectedVersions(expectedVersions);

        let collectionOperationResult;
        let curRecord;
        let newValue;
        let newVersion;
        let now;
        let tries = 0;

        do {
            let oldValue;
            curRecord = await this.findOneRecord(q);

            if (expectedVersions !== undefined
                    && !expectedVersions.includes(curRecord.version)) {
                throw error('VERSION_ASSERTION_FAILED', `Not an expected `
                        + `version: "${curRecord.version}". Expected one of: `
                        + `${JSON.stringify(expectedVersions)}`);
            }

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
                newValue = await fn(decodeKeys(curRecord.value), curRecord);

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
                now = new Date(this.nower());

                collectionOperationResult = await op(toMongoDoc(
                        encodeKeys(newValue),
                        newVersion,
                        curRecord.createdAt || now,
                        now));

                tries++;
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
        } while (!collectionOperationResult && await shouldRetry(tries));

        if (!collectionOperationResult) {
            throw error('EXHAUSTED_RETRIES',
                    'Ran out of retries attempting to update by query '
                    + util.inspect(q));
        }

        return {
            collectionOperationResult,
            createdAt: curRecord.createdAt || now,
            updatedAt: now || curRecord.updatedAt,
            value: newValue ? newValue : undefined, // Regularize falsy to undef
            version: newValue ? newVersion : curRecord.version
        };
    }
}

function assertValidValue(v, desc) {
    if (typeof v !== 'object' || Array.isArray(v) || v === null) {
        throw error('INVALID_VALUE', `${v} must be a non-array, non-null `
                + `object. Was: ` + util.inspect(v));
    }
}

function decodeKeys(o) {
    return mapKeys(o,
            s => s.replace('%2E', '.').replace('%24', '$').replace('%25', '%'));
}

function encodeKeys(o) {
    return mapKeys(o,
            s => s.replace('%', '%25').replace('$', '%24').replace('.', '%2E'));
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
    const value = decodeKeys(extractKeysWithPrefix(d, 'v_'));
    value._id = d._id;

    return {
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        value,
        version: d.version
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
