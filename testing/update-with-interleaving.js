'use strict';

const assert = require('assert');

module.exports = async (dcc, id, update1, otherUpdates,
        { log = console.log.bind(console), updateOpts = {} } = {}) => {

    if (!Array.isArray(otherUpdates)) {
        otherUpdates = [otherUpdates];
    }

    let phase1Latch;
    let phase1Release;
    let phase2Latch;
    let phase2Release;
    let phase3Latch;
    let phase3Release;
    let phase4Latch;
    let phase4Release;

    phase3Latch = new Promise(r => { phase3Release = r; });

    phase4Latch = Promise.resolve();
    phase4Release = () => {};

    let moreInterleaving = true;

    const primaryPr = dcc.updateById(id, async (...args) => {
        if (moreInterleaving) {
            phase2Latch = new Promise(r => { phase2Release = r; });

            phase4Release();

            assert(phase1Latch, 'phase 1 ready');
            await phase1Latch;
            phase1Latch = null;
        }

        let newValue;
        try {
            newValue = await update1(...args);
        }
        finally {
            if (moreInterleaving) {
                phase4Latch = new Promise(r => { phase4Release = r; });

                phase2Release();

                assert(phase3Latch, 'phase 3 ready');
                await phase3Latch;
                phase3Latch = null;
            }
        }

        return newValue;
    }, undefined, updateOpts);

    let error;
    let i = 0;
    while (i < otherUpdates.length && !error) {
        const otherUpdate = otherUpdates[i];

        phase1Latch = new Promise(r => { phase1Release = r; });

        phase3Release();

        assert(phase4Latch, 'phase 4 ready');
        await phase4Latch;
        phase4Latch = null;

        try {
            await dcc.updateById(id, async (...args) => {
                const result = await otherUpdate(...args);
                return result;
            });
        }
        catch (e) {
            e.interleavedSource = `interleave${i}`;
            error = e;
        }
        finally {
            phase3Latch = new Promise(r => { phase3Release = r; });

            phase1Release();

            assert(phase2Latch, 'phase 2 ready');
            await phase2Latch;
            phase2Latch = null;
        }

        i++;
    }

    moreInterleaving = false;
    phase3Release();

    try {
        await primaryPr;
    }
    catch (e) {
        e.interleavedSource = 'primary';
        error = e;
    }

    if (error) {
        throw error;
    }
}
