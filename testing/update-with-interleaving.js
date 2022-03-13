'use strict';

module.exports = async (dcc, id, update1, update2,
        log = console.log.bind(console)) => {
    let resolvePause1;
    const pauser1 = new Promise(resolve => { resolvePause1 = resolve; });

    let resolvePause2;
    const pauser2 = new Promise(resolve => { resolvePause2 = resolve; });

    const update1Pr = dcc.updateById(id, async (...args) => {
        const newValue = await update1(...args);
        resolvePause2();

        await pauser1;
        return newValue;
    });

    const update2Pr = dcc.updateById(id, async (...args) => {
        await pauser2;
        const result = await update2(...args);
        return result;
    });

    let error;

    try {
        await update2Pr;
    }
    catch (e) {
        e.interleavedSource = 'update2';
        error = e;
    }

    resolvePause1();

    try {
        await update1Pr;
    }
    catch (e) {
        e.interleavedSource = 'update1';
        error = e;
    }

    if (error) {
        throw error;
    }
}
