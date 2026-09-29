import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/src/store.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'pp-store-'));
  return { store: createStore(join(dir, 'nested', 'licenses.json')), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('saves, reads back and survives a missing file', () => {
  const { store, cleanup } = tempStore();
  try {
    assert.equal(store.get('nope'), null);
    store.save({ id: 'lic_1', plan: 'pack', key: 'PP1-x.y' });
    assert.equal(store.get('lic_1').plan, 'pack');
  } finally { cleanup(); }
});

test('finds a record by any field and revokes it', () => {
  const { store, cleanup } = tempStore();
  try {
    store.save({ id: 'lic_1', subscriptionId: 'sub_9' });
    assert.equal(store.findBy((r) => r.subscriptionId === 'sub_9').id, 'lic_1');
    const revoked = store.revoke('lic_1', 'subscription cancelled');
    assert.ok(revoked.revokedAt);
    assert.equal(store.get('lic_1').revokedReason, 'subscription cancelled');
    assert.equal(store.revoke('missing', 'x'), null);
  } finally { cleanup(); }
});

test('re-saving the same id replaces the record rather than duplicating it', () => {
  const { store, cleanup } = tempStore();
  try {
    store.save({ id: 'lic_1', plan: 'pack' });
    store.save({ id: 'lic_1', plan: 'monthly' });
    assert.equal(store.get('lic_1').plan, 'monthly');
  } finally { cleanup(); }
});
