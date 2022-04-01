'use strict';

const { ObjectId } = require('mongodb');

module.exports = function datesToMs(o) {
    let result;

    if (o === null) {
        result = null;
    }
    else if (o instanceof Date) {
        result = o.valueOf();
    }
    else if (o instanceof ObjectId) {
        result = o;
    }
    else if (Array.isArray(o)) {
        result = o.map(el => el instanceof Date ? el.valueOf() : datesToMs(el));
    }
    else if (typeof o === 'object') {
        result = Object.fromEntries(Object.entries(o).map(
            ([key, value]) =>
                [
                    key,
                    datesToMs(value)
                ]));
    }
    else {
        result = o;
    }

    return result;
};
