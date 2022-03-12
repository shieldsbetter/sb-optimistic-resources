'use strict';

const DataSlotCollection = require('../../index');
const dateToMs = require('../dates-to-ms');
const hermeticTest = require('../hermetic-test');
const test = require('ava');

test('basic insert and fetch', hermeticTest(async (t, { dbClient }) => {
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
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
