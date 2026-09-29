/** Popup: capture the open conversation, review the library, open the Studio. */
const $ = (sel) => document.querySelector(sel);

const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

const SUPPORTED = /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai)\//;

init();

async function init() {
  $('#capture').addEventListener('click', onCapture);
  $('#studio').addEventListener('click', () => send({ type: 'pp:openStudio' }).then(() => window.close()));
  $('#clear').addEventListener('click', async () => {
    await send({ type: 'pp:setThreads', threads: [] });
    render(await send({ type: 'pp:state' }));
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const supported = SUPPORTED.test(tab && tab.url ? tab.url : '');
  $('#capture').disabled = !supported;
  $('#context').textContent = supported
    ? 'Captures every message in the open conversation.'
    : 'Open a ChatGPT or Claude conversation to capture it.';

  render(await send({ type: 'pp:state' }));
}

async function onCapture() {
  const btn = $('#capture');
  btn.disabled = true;
  btn.textContent = 'Capturing…';
  const res = await send({ type: 'pp:capture' });
  btn.textContent = 'Capture this thread';
  btn.disabled = false;

  if (!res.ok) {
    note(res.error, 'error');
    return;
  }
  note(
    `${res.replaced ? 'Updated' : 'Captured'} “${truncate(res.thread.title, 40)}” · ${res.thread.messages.length} messages`,
    'ok',
  );
  render(await send({ type: 'pp:state' }));
}

function render(state) {
  if (!state || !state.ok) return;
  const { threads, entitlements: ent } = state;
  $('#count').textContent = threads.length ? `(${threads.length})` : '';
  $('#empty').hidden = threads.length > 0;
  $('#clear').hidden = threads.length === 0;

  $('#plan').textContent = ent.planLabel;
  $('#plan').className = `badge${ent.plan === 'free' ? '' : ' pro'}`;

  const list = $('#threads');
  list.textContent = '';
  threads.forEach((t) => list.appendChild(row(t)));
}

function row(thread) {
  const li = document.createElement('li');

  const badge = document.createElement('span');
  badge.className = `badge ${thread.vendor}`;
  badge.textContent = thread.vendorLabel;

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = thread.title;
  title.title = thread.title;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${thread.messages.length} msg`;

  const del = document.createElement('button');
  del.className = 'ghost small danger';
  del.textContent = '×';
  del.title = 'Remove from library';
  del.addEventListener('click', async () => {
    await send({ type: 'pp:removeThread', id: thread.id });
    render(await send({ type: 'pp:state' }));
  });

  li.append(badge, title, meta, del);
  return li;
}

function note(text, kind) {
  const el = $('#status');
  el.textContent = text;
  el.className = `notice ${kind}`;
  el.hidden = false;
}

function truncate(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
