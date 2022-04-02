'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');
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
        return this.collection.find(this.translateQuery(q))
                .map(mongoDocToEntityRecord);
    }

    async findOne(q) {
        const entityDoc = await this.collection.findOne(this.translateQuery(q));

        if (!entityDoc) {
            throw error('NO_SUCH_ENTITY',
                    'No entity matching query ' + util.inspect(q));
        }

        return mongoDocToEntityRecord(entityDoc);
    }

    async insertOne(initialValue) {
        assertValidValue(initialValue, 'initialValue');

        if (!('_id' in initialValue)) {
            initialValue._id = new ObjectId();
        }

        const now = new Date(this.nower());
        const version = bs58.encode(crypto.randomBytes(8));

        await this.collection.insertOne(
                toMongoDoc(encodeKeys(initialValue), version, now, now));

        return {
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

    async updateOne(q, fn, expectedVersions, { shouldRetry } = {}) {
        if (!shouldRetry || shouldRetry === true) {
            shouldRetry = async tries => {
                await new Promise(resolve => this.setTimeout(resolve, 200));

                return tries < 3
            };
        }

        expectedVersions =
                validateAndNormalizeExpectedVersions(expectedVersions);

        let curRecord;
        let newValue;
        let newVersion;
        let now;
        let success;
        let tries = 0;

        do {
            let oldValue;
            curRecord = await this.findOne(q);

            if (expectedVersions !== undefined
                    && !expectedVersions.includes(curRecord.version)) {
                throw error('VERSION_ASSERTION_FAILED', `Not an expected `
                        + `version: "${curRecord.version}". Expected one of: `
                        + `${JSON.stringify(expectedVersions)}`);
            }

            newVersion = bs58.encode(crypto.randomBytes(8));
            newValue = await fn(decodeKeys(curRecord.value), curRecord);

            if (newValue) {
                if ('_id' in newValue && newValue._id !== curRecord.value._id) {
                    throw error('INVALID_UPDATE',
                            `Cannot modify _id. ${newValue._id} =/=> `
                            + `${curRecord.value._id}`);
                }

                assertValidValue(newValue, 'Result of update function');

                now = new Date(this.nower());

                try {
                    const { matchedCount, upsertedCount } =
                            await this.collection.replaceOne(
                                    {
                                        _id: curRecord.value._id,
                                        version: curRecord.version
                                    },
                                    toMongoDoc(encodeKeys(newValue), newVersion,
                                            curRecord.createdAt,
                                            now),
                                    { upsert: true });

                    success = (matchedCount + upsertedCount) > 0;
                }
                catch (e) {
                    if (e.code !== 11000) {
                        throw error('UNEXPECTED_ERROR', 'Unexpected error.', e);
                    }

                    // MongoServerError 11000. The _id is already present with
                    // a different version number.
                }

                tries++;
            }
            else {
                success = true;
            }
        } while (!success && await shouldRetry(tries));

        if (!success) {
            throw error('EXHAUSTED_RETRIES',
                    'Ran out of retries attempting to update by query '
                    + util.inspect(q));
        }

        return {
            createdAt: curRecord.createdAt,
            updatedAt: now,
            value: newValue,
            version: newVersion
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
