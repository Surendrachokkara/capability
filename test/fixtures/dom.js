/** Builds a DOM plus a matching `location` for adapter tests. */
import { parseHTML } from 'linkedom';

export function makePage(html, url) {
  const { document } = parseHTML(`<!doctype html><html><head><title>${
    /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] || ''
  }</title></head><body>${html}</body></html>`);
  return { document, location: new URL(url) };
}

/**
 * Markup shaped like a real ChatGPT turn pair, chat chrome included: copy
 * buttons, thumbs, an aria-hidden avatar and an sr-only role label.
 */
export const CHATGPT_HTML = `
<title>Retainer pricing — ChatGPT</title>
<nav><ul><li data-active><a href="/c/abc">Retainer pricing</a></li></ul></nav>
<main>
<article data-testid="conversation-turn-2">
  <div class="sr-only">You said:</div>
  <div data-message-author-role="user" data-message-id="u1">
    <div class="whitespace-pre-wrap">How should I price <strong>value-based</strong> retainers?</div>
  </div>
  <div class="message-actions"><button aria-label="Copy">Copy</button><button aria-label="Edit message">Edit</button></div>
</article>
<article data-testid="conversation-turn-3">
  <div aria-hidden="true" class="avatar">GPT</div>
  <div data-message-author-role="assistant" data-message-id="a1" data-message-model-slug="gpt-5-thinking">
    <div class="markdown prose">
      <h2>Anchor on outcomes</h2>
      <p>Price the <em>result</em>, not the hours. See <a href="https://example.com/g">the guide</a>.</p>
      <ol><li>Name the outcome<ul><li>Write it in one sentence</li></ul></li><li>Take 10–15%</li></ol>
      <div class="code-block-header"><span>python</span><button class="copy-code">Copy code</button></div>
      <pre><div class="sticky"><button>Copy</button></div><code class="language-python">def price(v):
    return v * 0.12</code></pre>
      <blockquote><p>Never quote before you understand the outcome.</p></blockquote>
      <table><thead><tr><th>Tier</th><th>Monthly</th></tr></thead>
      <tbody><tr><td>Starter</td><td>$2,000</td></tr></tbody></table>
    </div>
  </div>
  <div class="flex"><button class="thumbs-up">Good</button><button class="thumbs-down">Bad</button></div>
</article>
<div data-message-author-role="tool"><div class="markdown"><p>tool call noise</p></div></div>
</main>`;

/** Markup shaped like a Claude turn pair. */
export const CLAUDE_HTML = `
<title>Landing page copy - Claude</title>
<button data-testid="chat-menu-trigger">Landing page copy</button>
<div data-testid="model-selector-dropdown">Claude Opus 5<svg><path d="M0"/></svg></div>
<div class="flex">
  <div data-testid="user-message"><p>Rewrite the hero section.</p></div>
  <div class="font-claude-message">
    <div>
      <p>Here are two directions:</p>
      <ul><li><strong>Outcome-first:</strong> ship in six weeks</li><li>Proof-first: 40 studios</li></ul>
      <pre><code class="language-html">&lt;h1&gt;Ship faster&lt;/h1&gt;</code></pre>
      <hr>
      <p>Pick whichever matches the buyer's awareness.</p>
    </div>
    <div class="message-actions"><button aria-label="Copy to clipboard">Copy</button></div>
  </div>
</div>`;
