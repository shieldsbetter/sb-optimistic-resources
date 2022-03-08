'use strict';

const { MongoClient } = require('mongodb');

module.exports = fn => async t => {
    const mongoClient =
            await MongoClient.connect(process.env.MONGO_CONNECT_STRING);

    const subtestId = buildSubtestId();
    const dbClient = mongoClient.db(`${process.env.TEST_ID}-${subtestId}-db`);

    try {
        await fn(t, { dbClient });
    }
    finally {
        await dbClient.dropDatabase();
    }
};

function buildSubtestId() {
    const alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    while (result.length < 6) {
        result += alpha.charAt(Math.floor(Math.random() * alpha.length));
    }
    return result;
}
