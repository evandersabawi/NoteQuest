// Run with: npm test (inside functions/). Uses in-memory fakes for Firestore, Claude and Stripe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBilling, CONFIG } = require('../billing');

const INC = Symbol('inc');
function fakeDb() {
  const data = new Map(); // "col/id" -> object
  const apply = (cur, patch, merge) => {
    const out = merge ? { ...(cur || {}) } : {};
    for (const [k, v] of Object.entries(patch)) out[k] = v && v[INC] !== undefined ? (out[k] || 0) + v[INC] : v;
    return out;
  };
  const doc = (col, id) => ({
    id,
    async get() { const d = data.get(col + '/' + id); return { exists: !!d, data: () => (d ? { ...d } : undefined), id }; },
    async set(p, o) { data.set(col + '/' + id, apply(data.get(col + '/' + id), p, o && o.merge)); },
    async delete() { data.delete(col + '/' + id); },
  });
  let auto = 0;
  const db = {
    data,
    collection: col => ({
      doc: id => doc(col, id),
      async add(v) { data.set(col + '/auto' + (++auto), v); },
      where: (f, op, val) => ({ limit: () => ({ async get() {
        const docs = [...data.entries()].filter(([k, v]) => k.startsWith(col + '/') && v[f] === val).map(([k]) => ({ id: k.split('/')[1] }));
        return { empty: !docs.length, docs };
      } }) }),
    }),
    async runTransaction(fn) {
      const writes = [];
      const r = await fn({ get: d => d.get(), set: (d, p, o) => writes.push([d, p, o]) });
      for (const [d, p, o] of writes) await d.set(p, o);
      return r;
    },
  };
  return db;
}
const FieldValue = { increment: n => ({ [INC]: n }) };
const quiet = { info() {}, warn() {}, error() {} };

function claudeOk(payload) {
  const calls = [];
  return { calls, beta: { messages: { async create(req) { calls.push(req); return { model: req.model, stop_reason: 'end_turn', usage: { input_tokens: 5000, output_tokens: 6000 }, content: [{ type: 'text', text: JSON.stringify(payload) }] }; } } } };
}
const SET = { title: 'T', subject: 'S', summary: '', cards: [{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }], questions: [], monsters: [] };
const IMG = 'QUJD';

function setup(over = {}) {
  const db = fakeDb();
  const anthropic = over.anthropic || claudeOk(SET);
  const b = createBilling({ db, FieldValue, anthropic, stripe: over.stripe || null, priceIds: { study: 'price_s', plus: 'price_p' }, allowedOrigins: ['https://evandersabawi.github.io'], logger: quiet, now: () => 1000 });
  return { db, b, anthropic };
}

test('free trial allows FREE_TRIAL_SETS sets, then asks for a plan', async () => {
  const { b, anthropic } = setup();
  for (let i = 0; i < CONFIG.FREE_TRIAL_SETS; i++) await b.generateSet('u1', { images: [IMG] });
  await assert.rejects(b.generateSet('u1', { images: [IMG] }), e => e.code === 'resource-exhausted' && e.details.reason === 'trial-over');
  assert.equal(anthropic.calls.length, CONFIG.FREE_TRIAL_SETS);
  const req = anthropic.calls[0];
  assert.equal(req.model, 'claude-sonnet-5-5');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.output_config.format.type, 'json_schema');
});

test('a plan counts sets per billing period and resets in a new period', async () => {
  const { db, b } = setup();
  await db.collection('billing').doc('u2').set({ plan: 'study', status: 'active', periodStart: 100, periodEnd: 200 });
  const limit = CONFIG.PLANS.study.sets;
  for (let i = 0; i < limit; i++) await b.reserve('u2', 'sets');
  await assert.rejects(b.reserve('u2', 'sets'), e => e.code === 'resource-exhausted' && e.details.reason === 'limit');
  // Stripe starts a new period: counters are stale and count as zero.
  await db.collection('billing').doc('u2').set({ periodStart: 200, periodEnd: 300 }, { merge: true });
  assert.equal((await b.status('u2')).sets.used, 0);
  await b.reserve('u2', 'sets');
  const s = await b.status('u2');
  assert.equal(s.sets.used, 1);
  assert.equal(s.plan, 'study');
});

test('a failed Claude call gives the set back', async () => {
  const anthropic = { beta: { messages: { async create() { const e = new Error('overloaded'); e.status = 529; throw e; } } } };
  const { b } = setup({ anthropic });
  await assert.rejects(b.generateSet('u3', { images: [IMG] }), e => e.code === 'unavailable');
  assert.equal((await b.status('u3')).sets.used, 0);
});

test('a canceled plan falls back to the (used-up) trial', async () => {
  const { db, b } = setup();
  await db.collection('billing').doc('u4').set({ plan: null, status: 'canceled', trialSetsUsed: CONFIG.FREE_TRIAL_SETS });
  await assert.rejects(b.reserve('u4', 'sets'), e => e.details.reason === 'trial-over');
});

test('input validation rejects bad requests before spending anything', async () => {
  const { b, anthropic } = setup();
  await assert.rejects(b.generateSet('u5', { images: [] }), e => e.code === 'invalid-argument');
  await assert.rejects(b.generateSet('u5', { images: Array(CONFIG.MAX_IMAGES + 1).fill(IMG) }), e => e.code === 'invalid-argument');
  await assert.rejects(b.generateSet('u5', { images: ['<script>'] }), e => e.code === 'invalid-argument');
  await assert.rejects(b.generateLecture('u5', { creation: { cards: [] } }), e => e.code === 'invalid-argument');
  assert.equal(anthropic.calls.length, 0);
  assert.equal((await b.status('u5')).sets.used, 0);
});

test('lectures have their own allowance and a refusal is refunded', async () => {
  const anthropic = { beta: { messages: { async create() { return { model: 'm', stop_reason: 'refusal', usage: {}, content: [] }; } } } };
  const { b } = setup({ anthropic });
  await assert.rejects(b.generateLecture('u6', { creation: SET }), e => e.code === 'failed-precondition');
  assert.equal((await b.status('u6')).lectures.used, 0);
});

test('usage is logged with an estimated cost', async () => {
  const { db, b } = setup();
  await b.generateSet('u7', { images: [IMG] });
  await new Promise(r => setImmediate(r));
  const rows = [...db.data.entries()].filter(([k]) => k.startsWith('usage/')).map(([, v]) => v);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'set');
  assert.equal(rows[0].costUsd, (5000 * 2 + 6000 * 10) / 1e6);
});

test('Stripe webhook events sync the plan from the subscription', async () => {
  const sub = { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { uid: 'u8' }, cancel_at_period_end: false, items: { data: [{ price: { id: 'price_p' }, current_period_start: 500, current_period_end: 900 }] } };
  const stripe = { subscriptions: { async retrieve(id) { assert.equal(id, 'sub_1'); return sub; } } };
  const { b } = setup({ stripe });
  await b.handleStripeEvent({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1', client_reference_id: 'u8' } } });
  let s = await b.status('u8');
  assert.equal(s.plan, 'plus');
  assert.equal(s.sets.limit, CONFIG.PLANS.plus.sets);
  assert.equal(s.periodEnd, 900000);
  sub.status = 'canceled';
  await b.handleStripeEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  s = await b.status('u8');
  assert.equal(s.plan, null);
  assert.equal(s.kind, 'trial');
});

test('checkout only returns to allowed sites and sends subscribers to the portal', async () => {
  const made = [];
  const stripe = {
    customers: { async create(o) { made.push(['customer', o]); return { id: 'cus_9' }; } },
    checkout: { sessions: { async create(o) { made.push(['checkout', o]); return { url: 'https://checkout.stripe.com/x' }; } } },
    billingPortal: { sessions: { async create(o) { made.push(['portal', o]); return { url: 'https://billing.stripe.com/y' }; } } },
  };
  const { db, b } = setup({ stripe });
  await assert.rejects(b.createCheckout('u9', { plan: 'study', returnUrl: 'https://evil.example/' }), e => e.code === 'permission-denied');
  const r = await b.createCheckout('u9', { plan: 'study', returnUrl: 'https://evandersabawi.github.io/NoteQuest/#create' }, 'kid@users.notequest.app');
  assert.equal(r.url, 'https://checkout.stripe.com/x');
  const co = made.find(m => m[0] === 'checkout')[1];
  assert.equal(co.line_items[0].price, 'price_s');
  assert.equal(co.success_url, 'https://evandersabawi.github.io/NoteQuest/#settings/plan-ok');
  assert.equal(made.find(m => m[0] === 'customer')[1].email, undefined); // placeholder emails are not sent to Stripe
  await db.collection('billing').doc('u9').set({ plan: 'study', status: 'active' }, { merge: true });
  const again = await b.createCheckout('u9', { plan: 'plus', returnUrl: 'https://evandersabawi.github.io/NoteQuest/' });
  assert.equal(again.url, 'https://billing.stripe.com/y');
});
