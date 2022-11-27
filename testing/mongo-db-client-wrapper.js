'use strict';

class CollectionWrapper {
    constructor(base) {
        this.base = base;
    }

    deleteMany(...args) {
        return this.base.deleteMany(...args);
    }

    deleteOne(...args) {
        return this.base.deleteOne(...args);
    }

    find(...args) {
        return this.base.find(...args);
    }

    async findOne(...args) {
        return await this.base.findOne(...args);
    }

    async insertOne(...args) {
        if (this.insertOneError) {
            throw this.insertOneError;
        }

        return await this.base.insertOne(...args);
    }

    async replaceOne(...args) {
        if (this.replaceOneError) {
            throw this.replaceOneError;
        }

        return await this.base.replaceOne(...args);
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
