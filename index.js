'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');
const util = require('util');

module.exports = class DataSlotCollection {
    constructor(collection, {
        assertValidId = () => {},
        buildMetadata = () => ({}),
        buildMissingCartridgeValue = id => {
            throw noSuchCartridge(`id ${id}`, { id });
        },
        log = console.log.bind(console),
        nower = Date.now,
        ...otherOpts
    } = {}) {
        this.assertValidId = assertValidId;
        this.buildMetadata = buildMetadata;
        this.buildMissingCartridgeValue = buildMissingCartridgeValue;
        this.collection = collection;
        this.log = log;
        this.nower = nower;
        this.setTimeout = otherOpts.setTimeout || setTimeout;
    }

    async fetchById(id) {
        let curRecord = await this.collection.findOne({ _id: id });
        if (!curRecord) {
            const defaultValue = this.buildMissingCartridgeValue(id);
            curRecord = toMongoDoc(id, defaultValue,
                    this.buildMetadata(defaultValue), undefined,
                    undefined, undefined);
        }

        const value = extractKeysWithPrefix(curRecord, 'v_');
        const metadata = extractKeysWithPrefix(curRecord, 'm_');

        return {
            id,
            createdAt: curRecord.createdAt,
            metadata,
            updatedAt: curRecord.updatedAt,
            value,
            version: curRecord.version
        };
    }

    async insert(initialValue, { overwrite = false } = {}) {
        assertValidValue(initialValue, 'initialValue');

        if ('id' in initialValue) {
            this.assertValidId(initialValue.id);
        }

        const op = overwrite
                ? async d => {
                    const q = '_id' in d ? { _id: d._id } : {};
                    await this.collection.replaceOne(q, d, { upsert: true });
                }
                : d => this.collection.insertOne(d);

        const metadata = doMetadata.call(this, initialValue);
        const id = initialValue.id;
        const now = new Date(this.nower());
        const version = bs58.encode(crypto.randomBytes(8));

        delete initialValue.id;

        await op(toMongoDoc(id, initialValue, metadata, version, now, now));

        return {
            id,
            createdAt: now,
            metadata,
            updatedAt: now,
            value: initialValue,
            version
        };
    }

    async updateById(id, fn, expectedVersions, { shouldRetry } = {}) {
        if (!shouldRetry || shouldRetry === true) {
            shouldRetry = async tries => {
                await new Promise(resolve => this.setTimeout(resolve, 200));

                return tries < 3
            };
        }

        this.assertValidId(id);

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
            curRecord = await this.collection.findOne({ _id: id });

            if (!curRecord) {
                const defaultValue = this.buildMissingCartridgeValue(id);
                curRecord = toMongoDoc(id, defaultValue,
                        this.buildMetadata(defaultValue), undefined,
                        undefined, undefined);
            }

            if (expectedVersions !== undefined
                    && !expectedVersions.includes(curRecord.version)) {
                throw error('VERSION_ASSERTION_FAILED', `Not an expected `
                        + `version: "${curRecord.version}". Expected one of: `
                        + `${JSON.stringify(expectedVersions)}`);
            }

            const oldValue = extractKeysWithPrefix(curRecord, 'v_');
            const oldMetadata = extractKeysWithPrefix(curRecord, 'm_');
            newVersion = bs58.encode(crypto.randomBytes(8));
            newValue = await fn({ id, ...oldValue }, {
                createdAt: curRecord.createdAt,
                metadata: oldMetadata,
                updatedAt: curRecord.updatedAt,
                version: newVersion
            });

            if (newValue) {
                if ('id' in newValue && newValue.id !== id) {
                    throw error('INVALID_UPDATE',
                            `Cannot modify id. ${id} =/=> ${newValue.id}`);
                }
                delete newValue.id;

                assertValidValue(newValue, 'Result of update function');

                newMetadata = doMetadata.call(this, newValue);
                now = new Date(this.nower());

                try {
                    const { matchedCount, upsertedCount } =
                            await this.collection.replaceOne(
                                    { _id: id, version: curRecord.version },
                                    toMongoDoc(id, newValue, newMetadata,
                                            newVersion,
                                            curRecord.createdAt,
                                            now),
                                    { upsert: true });
                    tries++;

                    success = (matchedCount + upsertedCount) > 0;
                }
                catch (e) {
                    if (e.code !== 11000) {
                        throw error('UNEXPECTED_ERROR', 'Unexpected error.', e);
                    }

                    // MongoServerError 11000. The _id is already present with
                    // a different version number.
                }
            }
            else {
                success = true;
            }
        } while (!success && await shouldRetry(tries));

        if (!success) {
            throw new Error('Ran out of retries attempting to update ' + id);
        }

        return {
            id,
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
        throw new Error(`${v} must be a non-array, non-null object. Was: `
                + util.inspect(cartridge));
    }
}

function doMetadata(value) {
    const metadata = this.buildMetadata(value);

    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('buildMetadata must return a non-array object. '
                + 'Returned: ' + util.inspect(metadata));
    }

    return metadata;
}

function error(code, msg, cause) {
    const e = new Error(msg);
    e.code = code;

    if (cause) {
        e.cause = cause;
    }

    return e;
}

function extractKeysWithPrefix(o, prefix) {
    return Object.fromEntries(
            Object.entries(o)
                    .filter(([k]) => k.startsWith(prefix))
                    .map(([k,v]) => [k.substring(prefix.length), v]));
}

function mapTopLevelKeys(o, map) {
    if (o === undefined) {
        return o;
    }

    return Object.fromEntries(Object.entries(o).map(([k, v]) => [map(k), v]));
}

function noSuchCartridge(description, details) {
    const e = new Error(`No such cartridge: ${description}`);
    e.code = 'NO_SUCH_CARTRIDGE';
    e.details = { description, ...details };
    return e;
}

function toMongoDoc(id, value, metadata, version, createdAt, now) {
    return {
        _id: id,
        createdAt: createdAt || now,
        updatedAt: now,
        version,

        ...mapTopLevelKeys(metadata, k => `m_${k}`),
        ...mapTopLevelKeys(value, k => `v_${k}`)
    };
}

function validateAndNormalizeExpectedVersions(expectedVersions) {
    if (expectedVersions !== undefined) {
        if (!Array.isArray(expectedVersions)) {
            expectedVersions = [expectedVersions];
        }

        for (const v of expectedVersions) {
            if (!/\w{5,15}/.test(v)) {
                throw new Error(`Invalid version: ${v}`);
            }
        }
    }

    return expectedVersions;
}
