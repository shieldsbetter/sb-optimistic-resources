'use strict';

const DataSlotCollection = require('../../index');
const dateToMs = require('../dates-to-ms');
const hermeticTest = require('../hermetic-test');
const test = require('ava');
const updateWithInterleaving = require('../update-with-interleaving');

test('basic insert and fetch - with id',
        hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = dateToMs(await dsc.insertOne({
        _id: 'foo',
        bar: 'barval'
    }));

    t.deepEqual(insertResult, {
        createdAt: 123,
        updatedAt: 123,
        value: {
            _id: 'foo',
            bar: 'barval'
        },
        version: insertResult.version
    });

    const fetchResult = dateToMs(await dsc.findOne({ _id: 'foo' }));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        updatedAt: 123,
        value: {
            _id: 'foo',
            bar: 'barval'
        },
        version: insertResult.version
    });
}));

test('basic insert and fetch - no id', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = dateToMs(await dsc.insertOne({
        bar: 'barval'
    }));

    t.deepEqual(insertResult, {
        createdAt: 123,
        updatedAt: 123,
        value: {
            _id: insertResult.value._id,
            bar: 'barval'
        },
        version: insertResult.version
    });

    const fetchResult = dateToMs(
            await dsc.findOne({ _id: insertResult.value._id }));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        updatedAt: 123,
        value: {
            _id: insertResult.value._id,
            bar: 'barval'
        },
        version: insertResult.version
    });
}));

test('basic insert, update, and fetch',
        hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    const insertResult = dateToMs(await dsc.insertOne({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    now = 124;
    const updateResult = dateToMs(await dsc.updateOne({ _id: 'foo' }, v => ({
        _id: v._id,
        bar: v.bar,
        plugh: 'plughval'
    })));

    t.deepEqual(updateResult, {
        createdAt: 123,
        updatedAt: 124,
        value: {
            _id: 'foo',
            bar: 'barval',
            plugh: 'plughval'
        },
        version: updateResult.version
    });

    t.not(updateResult.version, insertResult.version);

    const fetchResult = dateToMs(await dsc.findOne({ _id: 'foo' }));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        updatedAt: 124,
        value: {
            _id: 'foo',
            bar: 'barval',
            plugh: 'plughval'
        },
        version: updateResult.version
    });
}));

test('assert wrong version', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dsc.insertOne({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    });

    const error = await t.throwsAsync(dsc.updateOne({ _id: 'foo' }, v => ({
        _id: v._id,
        bar: v.bar,
        plugh: 'plughval'
    }), 'abcdefghi'));

    t.is(error.code, 'VERSION_ASSERTION_FAILED');
}));

test('assert correct version', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await dsc.insertOne({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    await dsc.updateOne({ _id: 'foo' }, v => ({
        _id: v._id,
        bar: v.bar,
        plugh: 'plughval'
    }), insertResult.version);

    t.pass();
}));

test('cannot update id', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await dsc.insertOne({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    const e = await t.throwsAsync(dsc.updateOne({ _id: 'foo' }, v => ({
        _id: 'waldo',
        bar: v.bar,
        plugh: 'plughval'
    }), insertResult.version));

    t.is(e.code, 'INVALID_UPDATE');
}));

test('interleaved updated', hermeticTest(async (t, { dbClient }) => {
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dcc.insertOne({
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

    const fetchValue = await dcc.findOne({ _id: 'bar' });

    // Update #2 happened first, and then update #1 retried...
    t.is(fetchValue.value.bazz, 'bazzval1');
}));

test('no update', hermeticTest(async (t, { dbClient }) => {
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    await dcc.insertOne({
        _id: 'foo',
        bar: 'barval'
    });

    await dcc.updateOne({ _id: 'foo' }, () => {})

    const fetchResult = dateToMs(await dcc.findOne({ _id: 'foo' }));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        updatedAt: 123,
        value: {
            _id: 'foo',
            bar: 'barval'
        },
        version: fetchResult.version
    });
}));

test('run out of retries', hermeticTest(async (t, { dbClient }) => {
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dcc.insertOne({
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
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dcc.insertOne({
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
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const e = await t.throwsAsync(dcc.insertOne(5));

    t.is(e.code, 'INVALID_VALUE');
}));

test('array value', hermeticTest(async (t, { dbClient }) => {
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const e = await t.throwsAsync(dcc.insertOne([{id: 'foo'}]));

    t.is(e.code, 'INVALID_VALUE');
}));

test('null value', hermeticTest(async (t, { dbClient }) => {
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const e = await t.throwsAsync(dcc.insertOne(null));

    t.is(e.code, 'INVALID_VALUE');
}));

test('bad version string', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await dsc.insertOne({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    const e = await t.throwsAsync(dsc.updateOne({ _id: 'foo' }, v => ({
        _id: v._id,
        bar: v.bar,
        plugh: 'plughval'
    }), 'abc'));

    t.is(e.code, 'INVALID_VERSION');
}));

test('fetch missing', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const e = await t.throwsAsync(dsc.findOne({ _id: 'foo' }));

    t.is(e.code, 'NO_SUCH_ENTITY');
}));

test('weird error during update', hermeticTest(async (t, { dbClient }) => {
    const colClient = dbClient.collection('foo');
    const dsc = new DataSlotCollection(colClient, {
        log: t.log.bind(t)
    });

    await dsc.insertOne({
        _id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    });

    colClient.replaceOneError = new Error('out of cheese');
    const error = await t.throwsAsync(dsc.updateOne({ _id: 'foo' }, v => ({
        _id: v._id,
        bar: v.bar,
        plugh: 'plughval'
    })));

    t.is(error.code, 'UNEXPECTED_ERROR');
    t.is(error.cause.message, 'out of cheese');
}));

test('weird key', hermeticTest(async (t, { dbClient }) => {
    let now = 123;
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => now
    });

    const insertResult = dateToMs(await dsc.insertOne({
        _id: 'foo',
        '$.bar': 'barval'
    }));

    now = 124;
    const updateResult = dateToMs(await dsc.updateOne({ _id: 'foo' }, v => ({
        _id: v._id,
        '$.bar': v['$.bar'] + 'also'
    })));

    t.deepEqual(updateResult, {
        createdAt: 123,
        updatedAt: 124,
        value: {
            _id: 'foo',
            '$.bar': 'barvalalso'
        },
        version: updateResult.version
    });

    t.not(updateResult.version, insertResult.version);

    const fetchResult = dateToMs(await dsc.findOne({ _id: 'foo' }));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        updatedAt: 124,
        value: {
            _id: 'foo',
            '$.bar': 'barvalalso'
        },
        version: updateResult.version
    });
}));
