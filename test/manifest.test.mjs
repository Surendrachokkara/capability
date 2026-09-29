/**
 * Packaging guards. These catch the class of bug that only shows up once the
 * extension is loaded in a real browser: a module that the content script
 * imports at runtime but the manifest never exposed, or a file the manifest
 * points at that is not in the folder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));

/** Every path the manifest names, flattened. */
function manifestPaths() {
  const out = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {}),
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  return out.filter(Boolean);
}

/** Resolves the static import graph of a module, relative to src/. */
function importGraph(entry, seen = new Set()) {
  const rel = relative(SRC, entry);
  if (seen.has(rel) || !existsSync(entry)) return seen;
  seen.add(rel);
  const source = readFileSync(entry, 'utf8');
  for (const m of source.matchAll(/(?:^|\n)\s*import[^'"]*['"](\.[^'"]+)['"]/g)) {
    importGraph(resolve(dirname(entry), m[1]), seen);
  }
  return seen;
}

const warPatterns = manifest.web_accessible_resources.flatMap((r) => r.resources);

function isWebAccessible(relPath) {
  return warPatterns.some((pattern) => {
    const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
    return re.test(relPath);
  });
}

test('every file the manifest references exists', () => {
  for (const p of manifestPaths()) {
    assert.ok(existsSync(join(SRC, p)), `manifest points at a missing file: ${p}`);
  }
});

test('the whole content-script import chain is web-accessible', () => {
  // boot.js dynamically imports capture.js, which pulls in the adapters and the
  // shared lib. Chrome refuses any of those that is not declared, and the
  // failure only appears on a real page.
  const reachable = importGraph(join(SRC, 'content/capture.js'));
  reachable.add('content/capture.js');
  for (const rel of reachable) {
    assert.ok(isWebAccessible(rel), `${rel} is imported by the content script but not web-accessible`);
  }
});

test('web-accessible patterns only expose files that exist', () => {
  for (const pattern of warPatterns) {
    if (pattern.includes('*')) continue;
    assert.ok(existsSync(join(SRC, pattern)), `web_accessible_resources lists a missing file: ${pattern}`);
  }
});

test('the extension declares no remote code and no broad host access', () => {
  const hosts = manifest.host_permissions;
  assert.ok(!hosts.includes('<all_urls>') && !hosts.some((h) => h === 'https://*/*'),
    'host permissions must stay scoped to the vendors we support');
  for (const cs of manifest.content_scripts) {
    for (const match of cs.matches) assert.ok(hosts.includes(match), `content script runs on ${match} without a host permission`);
  }
});

test('config.js is present and fails closed by default', () => {
  const config = readFileSync(join(SRC, 'config.js'), 'utf8');
  assert.match(config, /export const CHECKOUT_BASE/);
  assert.match(config, /export const LICENSE_PUBLIC_JWK/);
});
