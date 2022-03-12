'use strict';

const sift = require('sift');

module.exports = () => {
    const collections = {};

    return {
        collection(name) {
            if (!collections[name]) {
                collections[name] = [];
            }

            return fakeMongoCollectionClient(collections[name]);
        },

        dropDatabase() {}
    };
};

function fakeMongoCollectionClient(docs) {
    return {
        async findOne(q) {
            const matches = docs.filter(sift(q));

            return matches[0] || null;
        },

        async insertOne(d) {
            if (!d._id) {
                d = {
                    _id: `${Math.random()}`,
                    ...d
                };
            }

            docs.push(d);
        },

        async replaceOne(q, d, opts = {}) {
            const index = docs.findIndex(sift(q));
            const matches = docs.filter(sift(q));

            let upsertedCount = 0;
            if (index === -1) {
                if (opts.upsert) {
                    this.insertOne({ ...q, ...d });
                    upsertedCount = 1;
                }
            }
            else {
                docs[index] = { ...q, ...d };
            }

            return {
                matchedCount: matches.length,
                upsertedCount
            };
        }
    };
}
