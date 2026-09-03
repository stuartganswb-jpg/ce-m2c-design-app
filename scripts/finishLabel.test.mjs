// Shared/finishLabel.takesNoFinish — the ONE reader for the Master Library "Unfinished" tag.
// Run from the repo root (`sh scripts/run-traverse-tests.sh` does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takesNoFinish } from '../src/components/Shared/finishLabel.js';

const item = (unfinished) => ({ id: 'CE-INV-1', legacyErpId: 'H1-138JNR', manufacturingSpecs: { customData: unfinished === undefined ? {} : { unfinished } } });

test('the ITEM tag is the truth — true however the line was stamped (tonight\'s stale S04 lines)', () => {
    assert.equal(takesNoFinish(item(true), { finishCode: 'S04', noFinish: false }), true);
    assert.equal(takesNoFinish(item(true), null), true);
    assert.equal(takesNoFinish(item('TRUE'), undefined), true, '4.5 CSV spelling');
});

test('an untagged item with a plain line takes a finish', () => {
    assert.equal(takesNoFinish(item(false), { finishCode: 'S04' }), false);
    assert.equal(takesNoFinish(item(undefined), { finishCode: 'P14' }), false);
    assert.equal(takesNoFinish({ manufacturingSpecs: {} }, { finishCode: 'P14' }), false);
});

test('a line that says noFinish is a 1.6 pin fact (clear acrylic) — honoured even when the item is untagged', () => {
    assert.equal(takesNoFinish(item(false), { noFinish: true }), true);
    assert.equal(takesNoFinish(null, { noFinish: true }), true, 'no part at hand: the line answers');
    assert.equal(takesNoFinish(null, { finishCode: 'S04' }), false);
    assert.equal(takesNoFinish(null, null), false);
});
