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
        version: 1
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
        version: 1
    });
}));

test('basic insert, update, and fetch',
        hermeticTest(async (t, { dbClient }) => {

    let now = 123;
    const dsc = new DataSlotCollection(dbClient.collection('foo'), {
        nower: () => now
    });

    await dsc.insert({
        id: 'foo',
        bar: 'barval',
        bazz: 'bazzval'
    });

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
        version: 2
    });

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
        version: 2
    });
}));
