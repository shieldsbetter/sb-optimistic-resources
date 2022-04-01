'use strict';

const doClone = require('clone');
const sift = require('sift');

const { ObjectId } = require('mongodb');

function clone(c) {
    // Let's just keep this easy...
    if (c instanceof ObjectId) {
        return c;
    }

    return doClone(c);
}

module.exports = (log) => {
    const collections = {};

    return {
        collection(name) {
            if (!collections[name]) {
                collections[name] = [];
            }

            return fakeMongoCollectionClient(collections[name], log);
        },

        dropDatabase() {}
    };
};

function fakeMongoCollectionClient(docs, log) {
    return {
        async findOne(q) {
            const matches = docs.filter(sift(q));

            return clone(matches[0]) || null;
        },

        async insertOne(d) {
            if (!d._id) {
                d = {
                    _id: `${Math.random()}`,
                    ...d
                };
            }

            docs.push(clone(d));
        },

        async replaceOne(q, d, opts = {}) {
            if (this.replaceOneError) {
                throw this.replaceOneError;
            }

            const index = docs.findIndex(sift(q));
            const matches = docs.filter(sift(q));

            let upsertedCount = 0;
            if (index === -1) {
                if (opts.upsert) {
                    if (q._id && docs.find(({ _id }) => _id === q._id)) {
                        // Duplicate id.
                        const e = new Error('Duplicate key error');
                        e.code = 11000;
                        e.index = 0;
                        e.keyPattern = { _id: 1 };
                        e.keyValue = { _id: d._id };

                        throw e;
                    }

                    this.insertOne({ ...q, ...d });
                    upsertedCount = 1;
                }
            }
            else {
                docs[index] = { ...clone(q), ...clone(d) };
            }

            return {
                matchedCount: matches.length,
                upsertedCount
            };
        }
    };
}
