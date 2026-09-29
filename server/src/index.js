/**
 * PacketPress licence server.
 *
 *   POST /api/checkout            -> { url }  Stripe Checkout for a plan
 *   POST /api/stripe/webhook      -> issues / revokes licences
 *   GET  /success?session_id=...  -> shows the buyer their key (no email needed on day one)
 *   GET  /api/license/status?id=  -> revocation check (the extension calls this opportunistically)
 *   POST /api/license/refresh     -> rotates an expiring subscription key
 *
 * Deliberately one file: it is a payment gate, not an application.
 */
import express from 'express';
import Stripe from 'stripe';
import { signLicense } from '../../src/lib/license.js';
import { loadPrivateJwk, webcrypto } from './keys.js';
import { createStore } from './store.js';

const PORT = process.env.PORT || 8787;
const BASE = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const store = createStore(process.env.LICENSE_DB || new URL('../data/licenses.json', import.meta.url).pathname);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const privateJwk = process.env.NODE_ENV === 'test' ? null : loadPrivateJwk();

/** Subscription keys are short-lived and rotated; the one-pack never expires. */
const SUBSCRIPTION_DAYS = 35;

const PLAN_BY_PRICE = () => ({
  [process.env.STRIPE_PRICE_MONTHLY]: 'monthly',
  [process.env.STRIPE_PRICE_PACK]: 'pack',
});

const app = express();

app.use((req, res, next) => {
  // The extension calls from a chrome-extension:// origin.
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// The webhook needs the raw body for signature verification, so it is mounted
// before the JSON parser.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('webhook signature rejected:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Returning 500 makes Stripe retry, which is what we want for a transient
    // failure; a signed, already-stored licence is idempotent on replay.
    console.error('webhook handler failed:', err);
    return res.status(500).send('handler failed');
  }
  return res.json({ received: true });
});

app.use(express.json());

app.post('/api/checkout', async (req, res) => {
  const plan = req.body && req.body.plan;
  const price = plan === 'monthly' ? process.env.STRIPE_PRICE_MONTHLY
    : plan === 'pack' ? process.env.STRIPE_PRICE_PACK : null;
  if (!price) return res.status(400).json({ error: 'unknown plan' });

  const session = await stripe.checkout.sessions.create({
    mode: plan === 'monthly' ? 'subscription' : 'payment',
    line_items: [{ price, quantity: 1 }],
    customer_email: req.body.email || undefined,
    allow_promotion_codes: true,
    success_url: `${BASE}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE}/cancelled`,
    metadata: { plan },
  });
  return res.json({ url: session.url });
});

app.get('/api/license/status', (req, res) => {
  const record = store.get(String(req.query.id || ''));
  if (!record) return res.status(404).json({ valid: false, reason: 'unknown' });
  return res.json({ valid: !record.revokedAt, revokedAt: record.revokedAt || null });
});

app.post('/api/license/refresh', async (req, res) => {
  const record = store.get(String((req.body && req.body.id) || ''));
  if (!record) return res.status(404).json({ error: 'unknown licence' });
  if (record.revokedAt) return res.status(403).json({ error: 'revoked' });
  if (record.plan !== 'monthly') return res.json({ key: record.key });

  if (record.subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(record.subscriptionId);
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
      return res.status(403).json({ error: `subscription ${sub.status}` });
    }
  }
  const key = await issueKey(record.id, 'monthly', record.email);
  store.save({ ...record, key, refreshedAt: new Date().toISOString() });
  return res.json({ key });
});

app.get('/success', (req, res) => {
  const record = store.findBy((r) => r.checkoutSessionId === req.query.session_id);
  if (!record) {
    // The webhook can land a moment after the redirect.
    return res.status(202).send(page(
      'Almost there',
      '<p>Payment received. Your key is being issued — refresh this page in a few seconds.</p>',
    ));
  }
  return res.send(page(
    'Your PacketPress key',
    `<p>Paste this into the extension (Studio → Licence):</p>
     <textarea readonly rows="4" onclick="this.select()">${escapeHtml(record.key)}</textarea>
     <p class="muted">Plan: ${escapeHtml(record.plan)}. Keep this email/page — it is your receipt.</p>`,
  ));
});

app.get('/cancelled', (_req, res) => res.send(page('Checkout cancelled', '<p>No charge was made.</p>')));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* --------------------------------------------------------------- handlers */

async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const plan = session.metadata?.plan || planFromLineItems(session);
      const id = `lic_${session.id.slice(-18)}`;
      if (store.get(id)) return; // replayed event
      const email = session.customer_details?.email || session.customer_email || null;
      const key = await issueKey(id, plan, email);
      store.save({
        id,
        plan,
        email,
        key,
        checkoutSessionId: session.id,
        customerId: session.customer || null,
        subscriptionId: session.subscription || null,
        createdAt: new Date().toISOString(),
      });
      console.log(`issued ${plan} licence ${id} for ${email || 'unknown email'}`);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const record = store.findBy((r) => r.subscriptionId === sub.id);
      if (record) {
        store.revoke(record.id, 'subscription cancelled');
        console.log(`revoked ${record.id}`);
      }
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      const record = store.findBy((r) => r.customerId && r.customerId === charge.customer);
      if (record) store.revoke(record.id, 'refunded');
      break;
    }
    default:
      break;
  }
}

function planFromLineItems(session) {
  const price = session.line_items?.data?.[0]?.price?.id;
  return PLAN_BY_PRICE()[price] || 'pack';
}

async function issueKey(id, plan, email) {
  const claims = { id, plan, email: email || undefined };
  if (plan === 'monthly') {
    claims.exp = new Date(Date.now() + SUBSCRIPTION_DAYS * 86400e3).toISOString();
  }
  return signLicense(claims, privateJwk, { crypto: webcrypto });
}

/* ----------------------------------------------------------------- views */

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.6 system-ui;max-width:640px;margin:8vh auto;padding:0 24px;color:#1a1a1a}
h1{font-size:26px} textarea{width:100%;font:13px/1.5 ui-monospace,monospace;padding:12px;border:1px solid #d8d8d8;border-radius:8px}
.muted{color:#6b6b6b;font-size:14px}</style>
<h1>${escapeHtml(title)}</h1>${body}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`PacketPress licence server on ${BASE}`));
}

export { app, handleEvent, issueKey };
