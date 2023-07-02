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
                collections[name] = fakeMongoCollectionClient([], log);
            }

            return collections[name];
        },

        dropDatabase() {}
    };
};

function fakeMongoCollectionClient(docs, log) {
    const uniquenessConstraints = [];

    function guaranteeUnique(d) {
        for (const c of uniquenessConstraints) {
            const violations = docs.filter(
                    d2 => d._id !== d2._id && c.every(f => d[f] === d2[f]));

            if (violations.length > 0) {
                const e = new Error('E11000 duplicate key error');
                e.code = 11000;
                throw e;
            }
        }
    }

    return {
        createIndex(spec, { unique }) {
            if (unique) {
                uniquenessConstraints.push(spec.map(([key]) => key));
            }
        },

        deleteMany(q) {
            const predicate = sift(q);
            while (docs.some(predicate)) {
                docs.splice(docs.findIndex(predicate), 1);
            }

            return {};
        },

        deleteOne(q) {
            const predicate = sift(q);
            if (docs.some(predicate)) {
                docs.splice(docs.findIndex(predicate), 1);
            }

            return {};
        },

        find(q, { limit = 100 } = {}) {
            const matches = docs.filter(sift(q)).slice(0, limit);

            return fakeFindCursor(matches);
        },

        async findOne(q) {
            const matches = docs.filter(sift(q));

            return clone(matches[0]) || null;
        },

        async insertOne(d) {
            if (this.insertOneError) {
                throw this.insertOneError;
            }

            if (!d._id) {
                d = {
                    _id: `${Math.random()}`,
                    ...d
                };
            }

            guaranteeUnique(d);

            docs.push(clone(d));

            return { insertedId: d._id };
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
                const newValue = { ...clone(q), ...clone(d) };
                guaranteeUnique(newValue);

                docs[index] = newValue;
            }

            return {
                matchedCount: matches.length,
                upsertedCount
            };
        }
    };
}

function fakeFindCursor(docs) {
    return {
        map(fn) {
            if (!this.mappers) {
                this.mappers = [];
            }

            this.mappers.push(fn);

            return this;
        },

        async toArray() {
            let result = docs;
            for (const m of this.mappers || []) {
                result = result.map(m);
            }
            return result;
        }
    };
}
