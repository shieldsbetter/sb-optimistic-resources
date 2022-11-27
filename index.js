'use strict';

const bs58 = require('bs58');
const clone = require('clone');
const crypto = require('crypto');
const deepEqual = require('deep-equal');
const lodash = require('lodash');
const util = require('util');

const { EJSON, ObjectId } = require('bson');

const pseudoFields = ['createdAt_sboe', 'updatedAt_sboe', 'version_sboe'];

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
        console.log('opts', opts);
        return this.collection.find(q, opts);
    }

    async findOne(q, opts = {}) {
        return await this.collection.findOne(q, opts);
    }

    async insertOne(initialValue, opts = {}) {
        return (await this.insertOneRecord(initialValue, opts))
                .collectionOperationResult;
    }

    async insertOneRecord(initialValue, opts = {}) {
        assertValidValue(initialValue, 'initialValue');

        const now = new Date(this.nower());
        const version = bs58.encode(crypto.randomBytes(8));

        const document = {
            _id: new ObjectId(),  // initialValue can overwrite this
            ...initialValue,

            createdAt_sboe: now,
            updatedAt_sboe: now,
            version_sboe: version
        };

        const collectionOperationResult =
                await this.collection.insertOne(document);

        return { collectionOperationResult, document };
    }

    async updateOne(q, fn, opts) {
        return (await this.updateOneRecord(q, fn, opts))
                .collectionOperationResult;
    }

    async updateOneRecord(q, fn, opts = {}) {
        return await mutateOneRecord.bind(this)(
                q, updateMutation.bind(this)(q, fn), opts)
    }
}

async function applyUpdateFnAndGuardProtectedFields(curDoc, updateFn) {
    const protectedFields = Object.fromEntries(Object.entries(curDoc)
            .filter(([k]) => k === '_id' || pseudoFields.includes(k))
            .map(([k, v]) => [k, clone(v)]));

    let newDoc = await updateFn(curDoc);

    if (newDoc) {
        const notSeen = new Set(Object.keys(protectedFields));

        for (const [key, value] of Object.entries(newDoc)) {
            if (key in protectedFields) {
                notSeen.delete(key);

                const normOldVal =
                        JSON.parse(EJSON.stringify(protectedFields[key]));
                const normNewVal = JSON.parse(EJSON.stringify(newDoc[key]));

                if (!deepEqual(normOldVal, normNewVal)) {
                    const oldValStr =
                            util.inspect(protectedFields[key]);
                    const newIdStr = util.inspect(newDoc[key]);
                    throw error('INVALID_UPDATE',
                            `Cannot modify protected field ${key}. `
                            + `${protectedFields[key]} != ${value}`);
                }

                newDoc[key] = protectedFields[key];
            }
            else if (key.endsWith('_sboe')) {
                throw error('INVALID_UPDATE',
                        `Fields suffixed with "_sboe" are reserved for `
                        + `sb-optimistic-entities. You tried to add `
                        + `field "${key}".`);
            }
        }

        newDoc = {
            ...newDoc,
            ...protectedFields
        };
    }

    if (newDoc) {
        assertValidValue(newDoc);
    }

    return newDoc;
}

function assertValidValue(v, desc) {
    if (typeof v !== 'object' || Array.isArray(v) || v === null) {
        throw error('INVALID_VALUE', `${v} must be a non-array, non-null `
                + `object. Was: ` + util.inspect(v));
    }
}

function deleteMutation(confirmDelete = (() => true)) {
    const deleteUpdate = updateMutation.bind(this)(
            {}, async d => {
                return (await confirmDelete(d)) ? null : undefined;
            });

    return (curRecord, now) => deleteUpdate(curRecord, now);
}

function error(code, msg, cause) {
    const e = new Error(msg);
    e.cause = cause;
    e.code = code;

    return e;
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

    let curDoc;
    let collectionOperationResult;
    let newDoc;
    const now = new Date(this.nower());
    let tries = 0;

    do {
        curDoc = await this.findOne(q);

        if (expectedVersions !== undefined
                && !expectedVersions.includes(curDoc.version_sboe)) {
            throw error('VERSION_ASSERTION_FAILED', `Not an expected `
                    + `version: "${curDoc.version_sboe}". Expected one of: `
                    + `${JSON.stringify(expectedVersions)}`);
        }

        tries++;

        ([ collectionOperationResult, newDoc ] = await fn(curDoc, now, opts));
    } while (!collectionOperationResult && await shouldRetry(tries));

    if (!collectionOperationResult) {
        throw error('EXHAUSTED_RETRIES',
                'Ran out of retries attempting to update by query '
                + util.inspect(q));
    }

    return {
        collectionOperationResult,
        document: newDoc || null
    };
}

function extendIfExists(o, fn) {
    return o ? { ...o, ...fn(o) } : o;
}

function updateMutation(q, updateFn) {
    return async (curDoc, now, { upsert } = {}) => {
        let collectionOperationResult;

        // No curDoc and we're upserting? Apply updateFn to default doc, and
        // ignore `null`, which would be the instruction to delete--but there's
        // no document yet so "delete" (null) and "leave alone" (undefined) are
        // the same.
        // No curDoc and no upsert? Undefined (i.e., leave alone)
        // curDoc? Apply updateFn and respect new document, or `null` for
        // or `undefined` for "leave alone"
        const newDoc = extendIfExists(
                curDoc === null ?
                        upsert ? (await applyUpdateFnAndGuardProtectedFields(
                                generateDefaultDocForUpsert(q), updateFn)
                                || undefined)
                        : undefined
                : await applyUpdateFnAndGuardProtectedFields(curDoc, updateFn),
                ({ _id: maybeId }) => ({
                    _id: maybeId || new ObjectId(),
                    createdAt_sboe: curDoc?.createdAt_sboe || now,
                    updatedAt_sboe: now,
                    version_sboe: bs58.encode(crypto.randomBytes(8))
                }));

        const op = newDoc === null
                ? async () => {
                    let result = this.collection.deleteOne({
                        _id: curDoc._id,
                        version_sboe: curDoc.version_sboe
                    });

                    if (result.matchedCount === 0) {
                        // Someone has updated or deleted out from under us. We
                        // should maybe try again...
                        result = undefined;
                    }

                    return result;
                }
                : curDoc === null
                ? async doc => {
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
                }
                : async doc => {
                    let result = await this.collection.replaceOne({
                        _id: curDoc?._id,
                        version_sboe: curDoc?.version_sboe
                    }, doc);

                    if (result.matchedCount === 0) {
                        // Someone has updated or deleted out from under us. We
                        // should maybe try again...
                        result = undefined;
                    }

                    return result;
                };

        if (newDoc === undefined) {
            collectionOperationResult = {
                acknowledged: true,
                deletedCount: 0,
                modifiedCount: 0,
                upsertedId: null,
                upsertedCount: 0,
                matchedCount: 0
            };
        }
        else {
            collectionOperationResult = await op(newDoc);
        }

        return [
            collectionOperationResult,
            newDoc === undefined ? curDoc : newDoc
        ];
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
