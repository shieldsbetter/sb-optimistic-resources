'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');
const ObjectId = require("bson-objectid");
const util = require('util');

module.exports = class DataSlotCollection {
    constructor(collection, {
        buildMetadata = () => ({}),
        log = console.log.bind(console),
        nower = Date.now,
        ...otherOpts
    } = {}) {
        this.buildMetadata = buildMetadata;
        this.collection = collection;
        this.log = log;
        this.nower = nower;
        this.setTimeout = otherOpts.setTimeout || setTimeout;
    }

    async findOne(q) {
        const record = await this.collection.findOne(q);

        if (!record) {
            throw error('NO_SUCH_CARTRIDGE',
                    'No cartridge for query ' + util.inspect(q));
        }

        const value = extractKeysWithPrefix(record, 'v_');
        value._id = record._id;

        const metadata = extractKeysWithPrefix(record, 'm_');

        return {
            createdAt: record.createdAt,
            metadata,
            updatedAt: record.updatedAt,
            value,
            version: record.version
        };
    }

    async insertOne(initialValue) {
        assertValidValue(initialValue, 'initialValue');

        if (!('_id' in initialValue)) {
            initialValue._id = ObjectId();
        }

        const metadata = doMetadata.call(this, initialValue);
        const now = new Date(this.nower());
        const version = bs58.encode(crypto.randomBytes(8));

        await this.collection.insertOne(
                toMongoDoc(initialValue, metadata, version, now, now));

        return {
            createdAt: now,
            metadata,
            updatedAt: now,
            value: initialValue,
            version
        };
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
        let newMetadata;
        let newValue;
        let newVersion;
        let now;
        let success;
        let tries = 0;

        do {
            let oldMetadata, oldValue;
            curRecord = await this.findOne(q);

            if (expectedVersions !== undefined
                    && !expectedVersions.includes(curRecord.version)) {
                throw error('VERSION_ASSERTION_FAILED', `Not an expected `
                        + `version: "${curRecord.version}". Expected one of: `
                        + `${JSON.stringify(expectedVersions)}`);
            }

            newVersion = bs58.encode(crypto.randomBytes(8));
            newValue = await fn(curRecord.value, curRecord);

            if (newValue) {
                if ('_id' in newValue && newValue._id !== curRecord.value._id) {
                    throw error('INVALID_UPDATE',
                            `Cannot modify _id. ${newValue._id} =/=> `
                            + `${curRecord.value._id}`);
                }

                assertValidValue(newValue, 'Result of update function');

                newMetadata = doMetadata.call(this, newValue);
                now = new Date(this.nower());

                try {
                    const { matchedCount, upsertedCount } =
                            await this.collection.replaceOne(
                                    {
                                        _id: curRecord.value._id,
                                        version: curRecord.version
                                    },
                                    toMongoDoc(newValue, newMetadata,
                                            newVersion,
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
            metadata: newMetadata,
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

function doMetadata(value) {
    const metadata = this.buildMetadata(value);

    if (metadata && (typeof metadata !== 'object' || Array.isArray(metadata))) {
        throw error('INVALID_METADATA_VALUE', 'buildMetadata must return a '
                + 'non-array object. Returned: ' + util.inspect(metadata));
    }

    return metadata || {};
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

function mapTopLevelKeys(o, map) {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [map(k), v]));
}

function toMongoDoc(value, metadata, version, createdAt, now) {
    const valueWithoutId = { ...value };
    delete valueWithoutId._id;

    const result = {
        createdAt,
        updatedAt: now,
        version,

        ...mapTopLevelKeys(metadata, k => `m_${k}`),
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
