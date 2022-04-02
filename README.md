# sb-optimistic-entities

Optimistic locking library for MongoDb. Perform updates with plain Javascript.

## TL;DR

```javascript
const assert = require('assert');
const OptEntCollection = require('@shieldsbetter/sb-optimistic-entities');
const { MongoClient } = require('mongodb');

async main() {
    const dbClient = await MongoClient
            .connect(process.env.MONGOD_URI)
            .then(mc => mc.db('TestDb'));
    const petsCollection = new OptEntCollection(dbClient.collection('Pets'));

    await petsCollection.insertOne({
        _id: 'Ellie',
        breed: 'Azawakh',
        age: 6
    });

    // If there is a conflicting update, this will retry automatically
    // with the new value.
    await petsCollection.updateOne({ _id: 'Ellie' }, ellie => {
        ellie.age++;
        return ellie;
    });

    const { value } = await petsCollection.findOne({ _id: 'Ellie' });
    assert.equal(value, {
        _id: 'Ellie',
        breed: 'Azawakh',
        age: 7;
    });
}
```
