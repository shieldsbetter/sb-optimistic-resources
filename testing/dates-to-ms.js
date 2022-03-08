'use strict';

module.exports = function datesToMs(o) {
    let result;

    if (o === null) {
        result = null;
    }
    else if (Array.isArray(o)) {
        result = o.map(el => el instanceof Date ? el.valueOf() : datesToMs(el));
    }
    else if (typeof o === 'object') {
        result = Object.fromEntries(Object.entries(o).map(
            ([key, value]) =>
                [
                    key,
                    value instanceof Date
                            ? value.valueOf()
                            : datesToMs(value)
                ]));
    }
    else {
        result = o;
    }

    return result;
};
