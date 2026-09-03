// 1.5 slot locator — grouping clusters by the 1.6 slot they were loaded from.
// Fixtures use the PROD shape 1.6 writes (Build :1030 today): id CLUSTER-<slotId>-<ts>, nodes[0] =
// the S<n><MINT>-<PRETTY> prefix, category/position canonical. Run from the repo root
// (`sh scripts/run-traverse-tests.sh` does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotGroupsOf, slotIdFromClusterId, parsePrefix, nodesOfGroup, slotGaps } from '../src/components/Shared/slotGroups.js';

const built = (slotId, n, pretty, extra = {}) => ({
    id: `CLUSTER-${slotId}-${1756900000000 + n}`,
    name: pretty,
    nodes: [`S${n}K7Q2Z-${pretty}`, `S${n}K7Q2Z-${pretty}__0_Body`, `S${n}K7Q2Z-${pretty}__1_Mesh`],
    category: 'POLE', position: 'CENTER', location: '',
    ...extra,
});

test('the three id shapes: 1.6 slot id parses, hand-made and 2D region ids do not', () => {
    assert.equal(slotIdFromClusterId('CLUSTER-short_rod-1756900000123'), 'short_rod');
    assert.equal(slotIdFromClusterId('CLUSTER-slot_1786739405484-1756900000123'), 'slot_1786739405484');
    assert.equal(slotIdFromClusterId('CLUSTER-1756900000123'), null);          // 1.5 handleSaveCluster
    assert.equal(slotIdFromClusterId('CLUSTER-1756900000123-2'), null);        // 2D region additions
    assert.equal(slotIdFromClusterId('AUTO-abc-123'), null);
});

test('the prefix carries the load order in both the Build and the repair spelling', () => {
    assert.deepEqual(parsePrefix('S7K7Q2Z-FRONT-TRACK'), { order: 7, label: 'FRONT-TRACK' });
    assert.deepEqual(parsePrefix('S3-LEFTBRACKET'), { order: 3, label: 'LEFTBRACKET' });
    assert.equal(parsePrefix('Object_0'), null);
    assert.equal(parsePrefix('S7K7Q2Z-FRONT-TRACK__0_Body'), null);   // a child, not the group
});

test('groups sort by load order, take the stamped fields first, and never hide a cluster', () => {
    const clusters = [
        built('rear_track', 5, 'REAR-TRACK'),
        built('fascia', 0, 'FASCIA'),
        // stamped by the 2026-09-03 Build: no parse needed, and the stamp wins over the id
        { id: 'CLUSTER-carriers-1756900000999', name: 'CARRIERS', nodes: ['S9ZZZZZ-CARRIERS'], category: 'OTHER', position: '', slotId: 'carriers', slotLabel: 'Carriers', slotOrder: 2 },
        { id: 'CLUSTER-1756900000500', name: 'HAND MADE', nodes: ['Mesh_12'], category: 'RING', position: 'SHARED' },
        { id: 'AUTO-abc', name: 'PROPOSAL', nodes: ['Mesh_13'], category: '', position: '' },
    ];
    const g = slotGroupsOf(clusters);
    assert.deepEqual(g.map(x => x.label), ['FASCIA', 'Carriers', 'REAR-TRACK', 'Ungrouped']);
    assert.deepEqual(g.map(x => x.order), [0, 2, 5, null]);
    assert.deepEqual(g.map(x => x.source), ['id', 'stamp', 'id', 'ungrouped']);
    assert.equal(g[3].clusters.length, 2, 'both non-1.6 clusters land in Ungrouped');
    assert.equal(g.reduce((n, x) => n + x.clusters.length, 0), clusters.length, 'nothing is dropped');
});

test('an Extend re-upload of the same slot is ONE slot with two clusters (the duplicate-section case)', () => {
    const g = slotGroupsOf([built('rings', 3, 'RINGS'), built('rings', 8, 'RINGS')]);
    assert.equal(g.length, 1);
    assert.equal(g[0].clusters.length, 2);
    assert.equal(g[0].order, 3, 'the first load order names the slot');
    assert.equal(nodesOfGroup(g[0]).length, 6, 'the glow takes every node of both');
});

test('a prefix-only cluster (pre-stamp id lost) still groups by its S<n>', () => {
    const g = slotGroupsOf([{ id: 'CLUSTER-1756900000500', name: 'LEFT BRACKET', nodes: ['S4-LEFTBRACKET', 'S4-LEFTBRACKET__0'], category: 'BRACKET', position: 'LEFT' }]);
    assert.equal(g[0].source, 'prefix');
    assert.equal(g[0].order, 4);
});

test('gaps name what the designer still has to tag, at the cluster level', () => {
    const g = slotGroupsOf([
        { id: 'CLUSTER-x-1756900000001', name: 'X', nodes: ['S1AAAAA-X'], category: 'OTHER', position: '' },
        { id: 'CLUSTER-x-1756900000002', name: 'X', nodes: ['S1AAAAA-X'], category: 'POLE', position: 'CENTER' },
    ]);
    assert.deepEqual(slotGaps(g[0]), ['1 without a category', '1 without a position']);
    assert.deepEqual(slotGaps(slotGroupsOf([built('ok', 0, 'OK')])[0]), []);
});
