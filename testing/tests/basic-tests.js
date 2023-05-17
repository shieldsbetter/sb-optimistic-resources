'use strict';

const bsonObjectId = require('bson-objectid');
const dateToMs = require('../dates-to-ms');
const hermeticTest = require('../hermetic-test');
const SbOptEnt = require('../../index');
const test = require('ava');
const updateWithInterleaving = require('../update-with-interleaving');

test('basic insert and findOne - with id',
        hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval'
    }));

    t.truthy(insertResult.collectionOperationResult);

    t.deepEqual(insertResult.document, {
        _id: 'foo',
        bar: 'barval',
        createdAt_sbor: 123,
        updatedAt_sbor: 123,
        version_sbor: insertResult.document.version_sbor
    });

    const findResult = dateToMs(await sbor.findOne({ _id: 'foo' }));

    t.deepEqual(findResult, {
        _id: 'foo',
        bar: 'barval',
        createdAt_sbor: 123,
        updatedAt_sbor: 123,
        version_sbor: insertResult.document.version_sbor
    });
}));

test('basic insert and findOne - no id',
        hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        bar: 'barval'
    }));

    t.truthy(insertResult.collectionOperationResult);

    t.deepEqual(insertResult.document, {
        _id: insertResult.document._id,
        bar: 'barval',
        createdAt_sbor: 123,
        updatedAt_sbor: 123,
        version_sbor: insertResult.document.version_sbor
    });

    const findResult =
            dateToMs(await sbor.findOne({ _id: insertResult.document._id }));

    t.deepEqual(findResult, {
        _id: insertResult.document._id,
        bar: 'barval',
        createdAt_sbor: 123,
        updatedAt_sbor: 123,
        version_sbor: insertResult.document.version_sbor
    });
}));

test('basic insert, update, and findOne',
        hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    now = 124;
    const updateResult =
            dateToMs(await sbor.updateOneRecord({ _id: 'foo' }, v => {

        v.plugh = 'plughval';
        delete v.bazz;

        return v;
    }));

    t.truthy(updateResult.collectionOperationResult);

    t.deepEqual(updateResult.document, {
        _id: 'foo',
        bar: 'barval',
        createdAt_sbor: 123,
        plugh: 'plughval',
        updatedAt_sbor: 124,
        version_sbor: updateResult.document.version_sbor
    });

    t.not(updateResult.document.version_sbor,
            insertResult.document.version_sbor);

    const findResult = dateToMs(await sbor.findOne({ _id: 'foo' }));

    t.deepEqual(findResult, {
        _id: 'foo',
        bar: 'barval',
        createdAt_sbor: 123,
        plugh: 'plughval',
        updatedAt_sbor: 124,
        version_sbor: updateResult.document.version_sbor
    });
}));

test('basic insert, update, and findOne - mongo style',
        hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        generateId: () => 'id1',
        log: t.log.bind(t),
        nower: () => now
    });

    const insertResult = dateToMs(await sbor.insertOne({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    t.truthy(insertResult);
    t.falsy(insertResult.document);

    now = 124;
    const updateResult = dateToMs(await sbor.updateOne({ _id: 'foo' }, v => {

        v.plugh = 'plughval';
        delete v.bazz;

        return v;
    }));

    t.truthy(updateResult);
    t.falsy(updateResult.document);

    const findResult = dateToMs(await sbor.findOne({ _id: 'foo' }));

    t.deepEqual(findResult, {
        _id: 'foo',
        bar: 'barval',
        createdAt_sbor: 123,
        plugh: 'plughval',
        updatedAt_sbor: 124,
        version_sbor: findResult.version_sbor
    });
}));

test('different ObjectId implementation ok',
        hermeticTest(async (t, { dbClient }) => {

    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = await sbor.insertOne({
        foo: 'fooval1'
    });
    const updateResult = await sbor.updateOneRecord(
            { _id: insertResult.insertedId },
            v => ({
                _id: bsonObjectId(v._id.toHexString()),
                foo: 'fooval2'
            }));
    const findResult = await sbor.findOne({ _id: insertResult.insertedId });

    t.is(updateResult.document.foo, 'fooval2');
    t.is(findResult.foo, 'fooval2');
}));

test('find by something other than _id',
        hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval'
    }));

    t.truthy(insertResult.collectionOperationResult);

    const findResult = dateToMs(await sbor.findOne({ bar: { $exists: true } }));

    t.deepEqual(findResult, {
        _id: 'foo',
        bar: 'barval',
        createdAt_sbor: 123,
        updatedAt_sbor: 123,
        version_sbor: insertResult.document.version_sbor
    });
}));

test('find many', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult1 = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        toBeReturned: true
    }));

    const insertResult2 = dateToMs(await sbor.insertOneRecord({
        _id: 'bar'
    }));

    const insertResult3 = dateToMs(await sbor.insertOneRecord({
        _id: 'bazz',
        toBeReturned: true
    }));

    const findCursor = sbor.find({ toBeReturned: true });
    const findDocs = (await findCursor.toArray()).map(dateToMs);

    t.deepEqual(findDocs, [
        {
            _id: 'foo',
            createdAt_sbor: 123,
            toBeReturned: true,
            updatedAt_sbor: 123,
            version_sbor: insertResult1.document.version_sbor
        },
        {
            _id: 'bazz',
            createdAt_sbor: 123,
            toBeReturned: true,
            updatedAt_sbor: 123,
            version_sbor: insertResult3.document.version_sbor
        }
    ]);
}));

test('find many with opts', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    dateToMs(await sbor.insertOneRecord({}));
    dateToMs(await sbor.insertOneRecord({}));
    dateToMs(await sbor.insertOneRecord({}));

    const findCursor = sbor.find({}, { limit: 2 });
    const findDocs = (await findCursor.toArray()).map(dateToMs);

    t.deepEqual(findDocs.length, 2);
}));

test('assert wrong version', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    });

    const error = await t.throwsAsync(
            sbor.updateOneRecord({ _id: 'foo' }, v => ({
        ...v,
        plugh: 'plughval'
    }), { expectedVersions: 'abcdefghi' }));

    t.is(error.code, 'VERSION_ASSERTION_FAILED');
}));

test('assert correct version', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    await sbor.updateOneRecord({ _id: 'foo' }, v => ({
        ...v,
        plugh: 'plughval'
    }), insertResult.document.version_sbor);

    t.pass();
}));

test('cannot update id', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo'
    }));

    const e = await t.throwsAsync(sbor.updateOneRecord({ _id: 'foo' }, v => ({
        ...v,

        _id: 'waldo',
    })));

    t.is(e.code, 'INVALID_UPDATE');
}));

test('cannot update createdAt_sbor', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo'
    }));

    const e = await t.throwsAsync(sbor.updateOneRecord({ _id: 'foo' }, v => ({
        ...v,

        createdAt_sbor: new Date(0)
    })));

    t.is(e.code, 'INVALID_UPDATE');
}));

test('cannot update updatedAt_sbor', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo'
    }));

    const e = await t.throwsAsync(sbor.updateOneRecord({ _id: 'foo' }, v => ({
        ...v,

        updatedAt_sbor: new Date(0)
    })));

    t.is(e.code, 'INVALID_UPDATE');
}));

test('cannot update version_sbor', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo'
    }));

    const e = await t.throwsAsync(sbor.updateOneRecord({ _id: 'foo' }, v => ({
        ...v,

        version_sbor: new Date(0)
    })));

    t.is(e.code, 'INVALID_UPDATE');
}));

test('may omit protected fields', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval'
    }));

    const updateResult = dateToMs(await sbor.updateOneRecord(
            { _id: 'foo' }, v => ({
                bazz: 'bazzval'
            })));

    t.deepEqual(updateResult.document, {
        _id: 'foo',
        bazz: 'bazzval',
        createdAt_sbor: insertResult.document.createdAt_sbor,
        updatedAt_sbor: updateResult.document.updatedAt_sbor,
        version_sbor: updateResult.document.version_sbor
    });
}));

test('interleaved updated', hermeticTest(async (t, { dbClient }) => {
    const dcc = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dcc.insertOneRecord({
        _id: 'bar',
        bazz: 'bazzval0'
    });

    await updateWithInterleaving(dcc, { _id: 'bar' },
        // This update will be preempted...
        async v => {
            // This will run twice, once before and once after the interleaving
            // update, so we can't assert a specific value of v.bazz

            v.bazz = 'bazzval1';

            return v;
        },

        // ...by this update.
        async v => {
            t.is(v.bazz, 'bazzval0');

            v.bazz = 'bazzval2';

            return v;
        }, { log: t.log.bind(t) }
    );

    const findValue = await dcc.findOne({ _id: 'bar' });

    // Update #2 happened first, and then update #1 retried...
    t.is(findValue.bazz, 'bazzval1');
}));

test('no update', hermeticTest(async (t, { dbClient }) => {
    const dcc = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    await dcc.insertOneRecord({
        _id: 'foo',
        bar: 'barval'
    });

    await dcc.updateOneRecord({ _id: 'foo' }, () => {})

    const findResult = dateToMs(await dcc.findOne({ _id: 'foo' }));

    t.deepEqual(findResult, {
        _id: 'foo',
        bar: 'barval',
        createdAt_sbor: 123,
        updatedAt_sbor: 123,
        version_sbor: findResult.version_sbor
    });
}));

test('run out of retries', hermeticTest(async (t, { dbClient }) => {
    const dcc = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dcc.insertOneRecord({
        _id: 'bar',
        bazz: 'bazzval0'
    });

    const e = await t.throwsAsync(updateWithInterleaving(dcc, { _id: 'bar' },
        // This update will be preempted...
        async v => {
            v.bazz = 'bazzval1';
            return v;
        },

        [
            // ...by this update.
            async v => {
                v.bazz = 'bazzval2';
                return v;
            },

            // ...and this update.
            async v => {
                v.bazz = 'bazzval3';
                return v;
            },

            // ...and this update.
            async v => {
                v.bazz = 'bazzval4';
                return v;
            }
        ], { log: t.log.bind(t) }
    ));

    t.is(e.code, 'EXHAUSTED_RETRIES');
}));

test('run out of retries - shouldRetry = true', hermeticTest(
        async (t, { dbClient }) => {
    const dcc = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dcc.insertOneRecord({
        _id: 'bar',
        bazz: 'bazzval0'
    });

    const e = await t.throwsAsync(updateWithInterleaving(dcc, { _id: 'bar' },
        // This update will be preempted...
        async v => {
            v.bazz = 'bazzval1';
            return v;
        },

        [
            // ...by this update.
            async v => {
                v.bazz = 'bazzval2';
                return v;
            },

            // ...and this update.
            async v => {
                v.bazz = 'bazzval3';
                return v;
            },

            // ...and this update.
            async v => {
                v.bazz = 'bazzval4';
                return v;
            }
        ], { log: t.log.bind(t), updateOpts: { shouldRetry: true } }
    ));

    t.is(e.code, 'EXHAUSTED_RETRIES');
}));

test('bad value type', hermeticTest(async (t, { dbClient }) => {
    const dcc = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const e = await t.throwsAsync(dcc.insertOneRecord(5));

    t.is(e.code, 'INVALID_VALUE');
}));

test('array value', hermeticTest(async (t, { dbClient }) => {
    const dcc = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const e = await t.throwsAsync(dcc.insertOneRecord([{id: 'foo'}]));

    t.is(e.code, 'INVALID_VALUE');
}));

test('null value', hermeticTest(async (t, { dbClient }) => {
    const dcc = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const e = await t.throwsAsync(dcc.insertOneRecord(null));

    t.is(e.code, 'INVALID_VALUE');
}));

test('bad version string', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    const e = await t.throwsAsync(sbor.updateOneRecord({ _id: 'foo' }, v => ({
        _id: v._id,
        bar: v.bar,
        plugh: 'plughval'
    }), { expectedVersions: 'abc' }));

    t.is(e.code, 'INVALID_VERSION');
}));

test('findOne missing', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const findResult = await sbor.findOne({ _id: 'foo' });

    t.is(findResult, null);
}));

test('weird error during update', hermeticTest(async (t, { dbClient }) => {
    const colClient = dbClient.collection('foo');
    const sbor = new SbOptEnt(colClient, {
        log: t.log.bind(t)
    });

    await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    });

    colClient.replaceOneError = new Error('out of cheese');
    const error = await t.throwsAsync(
            sbor.updateOneRecord({ _id: 'foo' }, v => ({
                ...v,
                plugh: 'plugval'
            })));

    t.is(error.message, 'out of cheese');
}));

test('weird error during upsert', hermeticTest(async (t, { dbClient }) => {
    const colClient = dbClient.collection('foo');
    const sbor = new SbOptEnt(colClient, {
        log: t.log.bind(t)
    });

    colClient.insertOneError = new Error('out of cheese');
    const error = await t.throwsAsync(
            sbor.updateOneRecord({ _id: 'foo' }, v => ({
        ...v,
        plugh: 'plughval'
    }), { upsert: true }));

    t.is(error.code, 'UNEXPECTED_ERROR');
    t.is(error.cause.message, 'out of cheese');
}));


test('weird key', hermeticTest(async (t, { dbClient }) => {
    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        '%$%.%bar': 'barval'
    }));

    now = 124;
    const updateResult = dateToMs(await sbor.updateOneRecord(
            { _id: 'foo' }, v => ({
        ...v,
        '%$%.%bar': v['%$%.%bar'] + 'also'
    })));

    t.truthy(updateResult.collectionOperationResult);

    t.deepEqual(updateResult.document, {
        '%$%.%bar': 'barvalalso',
        _id: 'foo',
        createdAt_sbor: 123,
        updatedAt_sbor: 124,
        version_sbor: updateResult.document.version_sbor
    });

    t.not(updateResult.document.version_sbor,
            insertResult.document.version_sbor);

    const findResult = dateToMs(await sbor.findOne({ _id: 'foo' }));

    t.deepEqual(findResult, {
        '%$%.%bar': 'barvalalso',
        _id: 'foo',
        createdAt_sbor: 123,
        updatedAt_sbor: 124,
        version_sbor: updateResult.document.version_sbor
    });
}));

test('weird key in array', hermeticTest(async (t, { dbClient }) => {
    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    const insertResult = dateToMs(await sbor.insertOneRecord({
        _id: 'foo',
        bar: [{ '%$%.%bazz': 'bazzval' }]
    }));

    now = 124;
    const updateResult = dateToMs(await sbor.updateOneRecord(
            { _id: 'foo' }, v => ({
        ...v,

        bar: [{ '%$%.%bazz': v.bar[0]['%$%.%bazz'] + 'also' }]
    })));

    t.truthy(updateResult.collectionOperationResult);

    t.deepEqual(updateResult.document, {
        _id: 'foo',
        bar: [{ '%$%.%bazz': 'bazzvalalso' }],
        createdAt_sbor: 123,
        updatedAt_sbor: 124,
        version_sbor: updateResult.document.version_sbor
    });

    t.not(updateResult.document.version_sbor,
            insertResult.document.version_sbor);

    const findResult = dateToMs(await sbor.findOne({ _id: 'foo' }));

    t.deepEqual(findResult, {
        _id: 'foo',
        bar: [{ '%$%.%bazz': 'bazzvalalso' }],
        createdAt_sbor: 123,
        updatedAt_sbor: 124,
        version_sbor: updateResult.document.version_sbor
    });
}));

test('update non-existent', hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    let ran = false;
    const updateResult = await sbor.updateOneRecord({ _id: 'foo' }, v => {
        ran = true;

        return {
            _id: v._id,
            bar: v.bar,
            plugh: 'plughval'
        }
    });

    t.is(ran, false);

    t.deepEqual(updateResult.collectionOperationResult.matchedCount, 0);
    t.deepEqual(updateResult.collectionOperationResult.modifiedCount, 0);

    t.deepEqual(updateResult.document, null);
}));

test('upsert non-existent', hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    let ran = false;
    const updateResult = dateToMs(
            await sbor.updateOneRecord({ foo: { $in: ['bar'] } }, v => {
        ran = true;
        t.deepEqual(v, {});

        return {
            _id: 'foo',
            bar: 'bar',
            plugh: 'plughval'
        }
    }, { upsert: true }));

    t.is(ran, true);
    t.truthy(updateResult.collectionOperationResult);

    t.deepEqual(updateResult.document, {
        _id: 'foo',
        bar: 'bar',
        createdAt_sbor: 123,
        plugh: 'plughval',
        updatedAt_sbor: 123,
        version_sbor: updateResult.document.version_sbor
    });
}));

test('upsert non-existent (no id)', hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    let ran = false;
    const updateResult = dateToMs(
            await sbor.updateOneRecord({ foo: { $in: ['bar'] } }, v => {
        ran = true;
        t.deepEqual(v, {});

        return {
            bar: 'bar',
            plugh: 'plughval'
        };
    }, { upsert: true }));

    t.is(ran, true);
    t.truthy(updateResult.collectionOperationResult);

    t.truthy(updateResult.document._id);

    t.deepEqual(updateResult.document, {
        _id: updateResult.document._id,
        bar: 'bar',
        createdAt_sbor: 123,
        plugh: 'plughval',
        updatedAt_sbor: 123,
        version_sbor: updateResult.document.version_sbor
    });
}));

test('upsert non-existent ($eq set provided)',
        hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    let ran = false;
    const updateResult = dateToMs(
            await sbor.updateOneRecord({
                _id: 'foo',
                bar: { $in: ['baz'] },
                'waldo.plugh': { $eq: 'bazz' },
                alice: {
                    bob: 'charlie'
                }
            }, v => {
                ran = true;
                t.deepEqual(v, {
                    _id: 'foo',
                    waldo: {
                        plugh: 'bazz'
                    },
                    alice: {
                        bob: 'charlie'
                    }
                });

                return {
                    _id: 'foo',
                    bar: 'bar',
                    plugh: 'plughval'
                }
            }, { upsert: true }));

    t.is(ran, true);
    t.truthy(updateResult.collectionOperationResult);

    t.truthy(updateResult.document._id);

    t.deepEqual(updateResult.document, {
        _id: updateResult.document._id,
        bar: 'bar',
        createdAt_sbor: 123,
        plugh: 'plughval',
        updatedAt_sbor: 123,
        version_sbor: updateResult.document.version_sbor
    });
}));

test('basic insert and deleteOne', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval'
    });

    const deleteResult = await sbor.deleteOne({ _id: 'foo' });
    t.truthy(deleteResult);

    const findResult = await sbor.findOne({ _id: 'foo' });

    t.deepEqual(findResult, null);
}));

test('deleteOne - confirm true', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval'
    });

    const deleteResult = await sbor.deleteOne(
            { _id: 'foo' }, { confirmDelete: (() => true) });
    t.truthy(deleteResult);

    const findResult = await sbor.findOne({ _id: 'foo' });

    t.deepEqual(findResult, null);
}));

test('deleteOne - confirm false', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = await sbor.insertOneRecord({
        _id: 'foo',
        bar: 'barval'
    });

    const deleteResult = dateToMs(await sbor.deleteOneRecord(
            { _id: 'foo' }, { confirmDelete: (() => false) }));

    t.deepEqual(deleteResult, {
        collectionOperationResult: {
            acknowledged: true,
            deletedCount: 0,
            modifiedCount: 0,
            upsertedId: null,
            upsertedCount: 0,
            matchedCount: 0
        },
        document: {
            _id: 'foo',
            bar: 'barval',
            createdAt_sbor: 123,
            updatedAt_sbor: 123,
            version_sbor: insertResult.document.version_sbor
        }
    });
}));

test('deleteOne - use doc data', hermeticTest(async (t, { dbClient }) => {
    const sbor = new SbOptEnt(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    await sbor.insertOneRecord({
        _id: 'foo',
        shouldDelete: true
    });

    const deleteResult = await sbor.deleteOne(
            { _id: 'foo' }, {
                confirmDelete: (({ shouldDelete } = {}) => shouldDelete)
            });
    t.truthy(deleteResult);

    const findResult = await sbor.findOne({ _id: 'foo' });

    t.deepEqual(findResult, null);
}));
