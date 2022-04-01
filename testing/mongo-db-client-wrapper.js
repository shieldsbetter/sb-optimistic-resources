'use strict';

class CollectionWrapper {
    constructor(base) {
        this.base = base;
    }

    async findOne(q) {
        return await this.base.findOne(q);
    }

    async insertOne(d) {
        return await this.base.insertOne(d);
    }

    async replaceOne(q, d, opts = {}) {
        if (this.replaceOneError) {
            throw this.replaceOneError;
        }

        return await this.base.replaceOne(q, d, opts);
    }
}

module.exports = class DbClientWrapper {
    constructor(base) {
        this.base = base;
    }

    collection(name) {
        return new CollectionWrapper(this.base.collection(name));
    }

    async dropDatabase() {
        await this.base.dropDatabase();
    }
}
