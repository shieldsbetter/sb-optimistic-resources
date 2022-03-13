'use strict';

const DataSlotCollection = require('../../index');
const dateToMs = require('../dates-to-ms');
const hermeticTest = require('../hermetic-test');
const test = require('ava');
const updateWithInterleaving = require('../update-with-interleaving');

test('basic insert and fetch', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = dateToMs(await dsc.insert({
        id: 'foo',
        bar: 'barval'
    }));

    t.deepEqual(insertResult, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 123,
        value: {
            bar: 'barval'
        },
        version: insertResult.version
    });

    const fetchResult = dateToMs(await dsc.fetchById('foo'));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 123,
        value: {
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

    const insertResult = dateToMs(await dsc.insert({
        id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    now = 124;
    const updateResult = dateToMs(await dsc.updateById('foo', v => ({
        id: v.id,
        bar: v.bar,
        plugh: 'plughval'
    })));

    t.deepEqual(updateResult, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 124,
        value: {
            bar: 'barval',
            plugh: 'plughval'
        },
        version: updateResult.version
    });

    t.not(updateResult.version, insertResult.version);

    const fetchResult = dateToMs(await dsc.fetchById('foo'));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 124,
        value: {
            bar: 'barval',
            plugh: 'plughval'
        },
        version: updateResult.version
    });
}));

test('insert w/ overwrite (doesn\'t exist)',
        hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult = dateToMs(await dsc.insert({
        id: 'foo',
        bar: 'barval'
    }, { overwrite: true }));

    t.deepEqual(insertResult, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 123,
        value: {
            bar: 'barval'
        },
        version: insertResult.version
    });

    const fetchResult = dateToMs(await dsc.fetchById('foo'));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 123,
        value: {
            bar: 'barval'
        },
        version: insertResult.version
    });
}));

test('insert w/ overwrite (does exist)',
        hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t),
        nower: () => 123
    });

    const insertResult1 = dateToMs(await dsc.insert({
        id: 'foo',
        bar: 'barval'
    }));

    const insertResult2 = dateToMs(await dsc.insert({
        id: 'foo',
        bazz: 'bazzval'
    }, { overwrite: true }));

    t.not(insertResult1.version, insertResult2.version);

    t.deepEqual(insertResult2, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 123,
        value: {
            bazz: 'bazzval'
        },
        version: insertResult2.version
    });

    const fetchResult = dateToMs(await dsc.fetchById('foo'));

    t.deepEqual(fetchResult, {
        createdAt: 123,
        id: 'foo',
        metadata: {},
        updatedAt: 123,
        value: {
            bazz: 'bazzval'
        },
        version: insertResult2.version
    });
}));

test('assert wrong version', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dsc.insert({
        id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    });

    const error = await t.throwsAsync(dsc.updateById('foo', v => ({
        id: v.id,
        bar: v.bar,
        plugh: 'plughval'
    }), 'abcdefghi'));

    t.is(error.code, 'VERSION_ASSERTION_FAILED');
}));

test('assert correct version', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await dsc.insert({
        id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    await dsc.updateById('foo', v => ({
        id: v.id,
        bar: v.bar,
        plugh: 'plughval'
    }), insertResult.version);

    t.pass();
}));

test('cannot update id', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    const insertResult = dateToMs(await dsc.insert({
        id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    }));

    const e = await t.throwsAsync(dsc.updateById('foo', v => ({
        id: 'waldo',
        bar: v.bar,
        plugh: 'plughval'
    }), insertResult.version));

    t.is(e.code, 'INVALID_UPDATE');
}));

test('first update wins', hermeticTest(async (t, { dbClient }) => {
    const dcc = new DataSlotCollection(dbClient.collection('foo'), {
        log: t.log.bind(t)
    });

    await dcc.insert({
        id: 'bar',
        bazz: 'bazzval0'
    });

    await updateWithInterleaving(dcc, 'bar',
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
        }, t.log.bind(t)
    );

    const fetchValue = await dcc.fetchById('bar');

    // Update #2 happened first, and then update #1 retried...
    t.is(fetchValue.value.bazz, 'bazzval1');
}));
