import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  signLicense, verifyLicenseKey, parseKey, entitlements, gatePacket, FREE_WATERMARK,
} from '../src/lib/license.js';
import { generateKeypair } from '../server/src/keys.js';
import { samplePacket } from './fixtures/sample-packet.js';

const crypto = webcrypto;
const keys = await generateKeypair();
const other = await generateKeypair();

const issue = (claims) => signLicense(claims, keys.privateJwk, { crypto });
const check = (key, jwk = keys.publicJwk, opts = {}) => verifyLicenseKey(key, jwk, { crypto, ...opts });

test('a freshly signed key verifies and carries its claims', async () => {
  const key = await issue({ id: 'lic_1', plan: 'pack', email: 'a@b.test' });
  const result = await check(key);
  assert.equal(result.valid, true);
  assert.equal(result.claims.plan, 'pack');
  assert.equal(result.claims.email, 'a@b.test');
});

test('keys are self-describing and parseable', async () => {
  const key = await issue({ id: 'lic_1', plan: 'pack' });
  assert.ok(key.startsWith('PP1-'));
  assert.ok(parseKey(key));
  assert.equal(parseKey('nonsense'), null);
  assert.equal(parseKey('PP1-onlypayload'), null);
});

test('surrounding whitespace from a copy-paste is tolerated', async () => {
  const key = await issue({ id: 'lic_1', plan: 'pack' });
  assert.equal((await check(`  ${key}\n`)).valid, true);
});

test('a tampered payload is rejected', async () => {
  const key = await issue({ id: 'lic_1', plan: 'free' });
  const [head, sig] = key.split('.');
  const forged = `${head.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}.${sig}`;
  const result = await check(forged);
  assert.equal(result.valid, false);
  assert.ok(['bad-signature', 'malformed'].includes(result.reason));
});

test('a key signed by another keypair is rejected', async () => {
  const key = await signLicense({ id: 'x', plan: 'monthly' }, other.privateJwk, { crypto });
  assert.deepEqual(await check(key), { valid: false, reason: 'bad-signature' });
});

test('an expired subscription key is rejected', async () => {
  const key = await issue({ id: 'lic_1', plan: 'monthly', exp: '2020-01-01T00:00:00.000Z' });
  const result = await check(key);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});

test('a subscription key is valid right up to its expiry', async () => {
  const exp = new Date(Date.now() + 60_000).toISOString();
  const key = await issue({ id: 'lic_1', plan: 'monthly', exp });
  assert.equal((await check(key)).valid, true);
  assert.equal((await check(key, keys.publicJwk, { now: Date.parse(exp) + 1 })).reason, 'expired');
});

test('the one-time pack never expires', async () => {
  const key = await issue({ id: 'lic_1', plan: 'pack' });
  const inTenYears = Date.now() + 10 * 365 * 86400e3;
  assert.equal((await check(key, keys.publicJwk, { now: inTenYears })).valid, true);
});

test('an unknown plan is rejected rather than silently trusted', async () => {
  const key = await issue({ id: 'lic_1', plan: 'enterprise-unlimited' });
  assert.equal((await check(key)).reason, 'unknown-plan');
});

test('malformed input never throws', async () => {
  for (const bad of ['', null, undefined, 'PP1-.', 'PP1-!!!.???', 'PP2-abc.def']) {
    const result = await check(bad);
    assert.equal(result.valid, false);
  }
});

/* --------------------------------------------------------------- gating */

test('no licence means free-tier entitlements', () => {
  const ent = entitlements(null);
  assert.equal(ent.plan, 'free');
  assert.equal(ent.maxThreads, 1);
  assert.equal(ent.canBrand, false);
});

test('an invalid licence falls back to free rather than failing open', () => {
  assert.equal(entitlements({ valid: false, reason: 'expired' }).plan, 'free');
});

test('free packets are trimmed to one thread and forced to carry the watermark', () => {
  const packet = samplePacket({ meta: { watermark: '', logoDataUrl: 'data:image/png;base64,AAA', footer: 'mine' } });
  const { packet: gated, trimmed } = gatePacket(packet, entitlements(null));
  assert.equal(gated.threads.length, 1);
  assert.equal(trimmed, 1);
  assert.equal(gated.meta.watermark, FREE_WATERMARK);
  assert.equal(gated.meta.logoDataUrl, undefined);
  assert.equal(gated.meta.footer, '');
});

test('paid packets keep every thread and all branding', async () => {
  const key = await issue({ id: 'lic_1', plan: 'pack' });
  const ent = entitlements(await check(key));
  const packet = samplePacket({ meta: { watermark: 'DRAFT', logoDataUrl: 'data:image/png;base64,AAA' } });
  const { packet: gated, trimmed } = gatePacket(packet, ent);
  assert.equal(trimmed, 0);
  assert.equal(gated.threads.length, packet.threads.length);
  assert.equal(gated.meta.watermark, 'DRAFT');
  assert.equal(gated.meta.logoDataUrl, 'data:image/png;base64,AAA');
});

test('gating does not mutate the caller\'s packet', () => {
  const packet = samplePacket({ meta: { watermark: 'DRAFT' } });
  gatePacket(packet, entitlements(null));
  assert.equal(packet.threads.length, 2);
  assert.equal(packet.meta.watermark, 'DRAFT');
});

test('unlimited plans survive a JSON round-trip of their entitlements', async () => {
  const key = await issue({ id: 'lic_1', plan: 'monthly', exp: new Date(Date.now() + 86400e3).toISOString() });
  const ent = JSON.parse(JSON.stringify(entitlements(await check(key))));
  const { packet, trimmed } = gatePacket(samplePacket(), ent);
  assert.equal(trimmed, 0);
  assert.equal(packet.threads.length, 2);
});
