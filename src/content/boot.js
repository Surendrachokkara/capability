/**
 * Content-script entry point. MV3 content scripts cannot be ES modules, so this
 * classic script is a thin bridge: it answers the background worker's capture
 * request by dynamically importing the real collector (a web-accessible module)
 * and returns the extracted thread.
 *
 * Nothing runs until the user asks for a capture — no observers, no polling, no
 * page mutation on load.
 */
(() => {
  if (window.__packetPressBooted) return;
  window.__packetPressBooted = true;

  let collectorPromise = null;
  const loadCollector = () => {
    if (!collectorPromise) {
      collectorPromise = import(chrome.runtime.getURL('content/capture.js'));
    }
    return collectorPromise;
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'pp:collect') return false;
    loadCollector()
      .then((mod) => mod.captureCurrentThread())
      .then((thread) => {
        toast(`Captured ${thread.messages.length} message${thread.messages.length === 1 ? '' : 's'}`);
        sendResponse({ ok: true, thread });
      })
      .catch((err) => {
        console.error('PacketPress capture failed', err);
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      });
    return true; // async response
  });

  function toast(text) {
    const el = document.createElement('div');
    el.textContent = `PacketPress · ${text}`;
    Object.assign(el.style, {
      position: 'fixed', zIndex: '2147483647', bottom: '24px', right: '24px',
      background: '#1a1a1a', color: '#fff', padding: '10px 14px', borderRadius: '8px',
      font: '13px/1.4 system-ui, sans-serif', boxShadow: '0 6px 24px rgba(0,0,0,.28)',
      opacity: '0', transition: 'opacity .18s ease',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 250);
    }, 2200);
  }
})();
