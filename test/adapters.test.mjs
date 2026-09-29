import test from 'node:test';
import assert from 'node:assert/strict';
import { makePage, CHATGPT_HTML, CLAUDE_HTML } from './fixtures/dom.js';
import { adapterFor } from '../src/content/adapters/index.js';
import { blocksToText } from '../src/lib/model.js';

function capture(html, url) {
  const { document, location } = makePage(html, url);
  const adapter = adapterFor(location);
  assert.ok(adapter, `no adapter matched ${url}`);
  return adapter.collect(document, location);
}

test('adapter routing matches each vendor host and rejects others', () => {
  assert.equal(adapterFor(new URL('https://chatgpt.com/c/1')).vendor, 'chatgpt');
  assert.equal(adapterFor(new URL('https://chat.openai.com/c/1')).vendor, 'chatgpt');
  assert.equal(adapterFor(new URL('https://claude.ai/chat/1')).vendor, 'claude');
  assert.equal(adapterFor(new URL('https://example.com/c/1')), null);
  // A look-alike host must not match.
  assert.equal(adapterFor(new URL('https://notclaude.ai/chat/1')), null);
});

test('ChatGPT: extracts both roles, model, title and id', () => {
  const thread = capture(CHATGPT_HTML, 'https://chatgpt.com/c/abc123');
  assert.equal(thread.vendor, 'chatgpt');
  assert.equal(thread.id, 'chatgpt:abc123');
  assert.equal(thread.title, 'Retainer pricing');
  assert.equal(thread.model, 'gpt-5-thinking');
  assert.deepEqual(thread.messages.map((m) => m.role), ['user', 'assistant']);
  assert.ok(thread.capturedAt);
});

test('ChatGPT: drops tool turns and UI chrome from the body', () => {
  const thread = capture(CHATGPT_HTML, 'https://chatgpt.com/c/abc123');
  const all = thread.messages.map((m) => blocksToText(m.blocks)).join('\n');
  assert.ok(!all.includes('tool call noise'));
  assert.ok(!/Copy code|Copy|Edit|Good|Bad|You said/.test(all));
});

test('ChatGPT: preserves the answer structure', () => {
  const [, assistant] = capture(CHATGPT_HTML, 'https://chatgpt.com/c/abc123').messages;
  const types = assistant.blocks.map((b) => b.type);
  assert.deepEqual(types, ['heading', 'paragraph', 'list', 'code', 'quote', 'table']);

  const code = assistant.blocks.find((b) => b.type === 'code');
  assert.equal(code.language, 'python');
  assert.equal(code.code, 'def price(v):\n    return v * 0.12');

  const list = assistant.blocks.find((b) => b.type === 'list');
  assert.equal(list.ordered, true);
  assert.deepEqual(list.items.map((i) => i.depth), [0, 1, 0]);

  const table = assistant.blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.head, [['Tier', 'Monthly']]);
});

test('Claude: extracts roles, title, model and id', () => {
  const thread = capture(CLAUDE_HTML, 'https://claude.ai/chat/def456');
  assert.equal(thread.vendor, 'claude');
  assert.equal(thread.id, 'claude:def456');
  assert.equal(thread.title, 'Landing page copy');
  assert.equal(thread.model, 'Claude Opus 5');
  assert.deepEqual(thread.messages.map((m) => m.role), ['user', 'assistant']);
});

test('Claude: keeps answer structure and drops the copy button', () => {
  const [, assistant] = capture(CLAUDE_HTML, 'https://claude.ai/chat/def456').messages;
  assert.deepEqual(assistant.blocks.map((b) => b.type), ['paragraph', 'list', 'code', 'rule', 'paragraph']);
  assert.ok(!blocksToText(assistant.blocks).includes('Copy'));
  assert.equal(assistant.blocks[2].code, '<h1>Ship faster</h1>');
});

test('titles fall back to the document title when the chrome is missing', () => {
  const thread = capture('<title>Some chat - Claude</title><div data-testid="user-message"><p>hi</p></div>',
    'https://claude.ai/chat/x');
  assert.equal(thread.title, 'Some chat');
});

test('every message carries an id and is included by default', () => {
  for (const [html, url] of [[CHATGPT_HTML, 'https://chatgpt.com/c/a'], [CLAUDE_HTML, 'https://claude.ai/chat/b']]) {
    for (const msg of capture(html, url).messages) {
      assert.ok(msg.id, 'message needs an id');
      assert.equal(msg.include, true);
    }
  }
});
