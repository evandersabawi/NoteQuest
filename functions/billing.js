// Plan quotas, hosted Claude calls and Stripe syncing. Everything external is passed in, so the tests can
// run it against fakes (see test/).
const { HttpsError } = require('firebase-functions/v2/https');
const CONFIG = require('./plans');
let Prompts;
try { Prompts = require('./prompts'); } catch (e) { Prompts = require('../js/prompts'); } // copied in at deploy

const ACTIVE = new Set(['active', 'trialing', 'past_due']); // past_due: Stripe is still retrying the card
const MODES = new Set(['flash', 'notemon', 'match', 'blitz']);

function createBilling({ db, FieldValue, anthropic, stripe, priceIds, allowedOrigins, logger, now = () => Date.now() }) {
  const ref = uid => db.collection('billing').doc(uid);
  const planFor = b => (b && b.plan && CONFIG.PLANS[b.plan] && ACTIVE.has(b.status) ? b.plan : null);

  // What the user can still do, given their billing doc. Monthly counters belong to one Stripe billing
  // period; when a new period starts the stored counters are simply stale and count as zero.
  function allowance(b = {}) {
    const plan = planFor(b);
    if (plan) {
      const fresh = b.usagePeriod === b.periodStart;
      const sets = CONFIG.PLANS[plan].sets;
      return {
        kind: 'plan', plan, fresh,
        sets: { used: fresh ? b.setsUsed || 0 : 0, limit: sets },
        lectures: { used: fresh ? b.lecturesUsed || 0 : 0, limit: sets * CONFIG.LECTURES_PER_SET },
      };
    }
    return {
      kind: 'trial', plan: null,
      sets: { used: b.trialSetsUsed || 0, limit: CONFIG.FREE_TRIAL_SETS },
      lectures: { used: b.trialLecturesUsed || 0, limit: CONFIG.FREE_TRIAL_SETS * CONFIG.LECTURES_PER_SET },
    };
  }

  // Take one set or lecture from the allowance, atomically. Returns a function that gives it back.
  async function reserve(uid, what) {
    const r = ref(uid);
    const taken = await db.runTransaction(async tx => {
      const snap = await tx.get(r);
      const b = snap.exists ? snap.data() : {};
      const a = allowance(b);
      const bucket = a[what];
      if (bucket.used >= bucket.limit) {
        const reason = a.kind === 'plan' ? 'limit' : 'trial-over';
        const msg = a.kind === 'plan'
          ? (what === 'sets' ? `You have used all ${bucket.limit} study sets in your plan this month.` : 'You have used this month\'s lecture allowance.')
          : 'Your free sets are used up. Pick a plan to keep creating sets.';
        throw new HttpsError('resource-exhausted', msg, { reason, plan: a.plan, used: bucket.used, limit: bucket.limit });
      }
      let field;
      if (a.kind === 'plan') {
        field = what === 'sets' ? 'setsUsed' : 'lecturesUsed';
        const patch = { [field]: bucket.used + 1, updatedAt: now() };
        if (!a.fresh) { patch.usagePeriod = b.periodStart; patch[field === 'setsUsed' ? 'lecturesUsed' : 'setsUsed'] = 0; }
        tx.set(r, patch, { merge: true });
      } else {
        field = what === 'sets' ? 'trialSetsUsed' : 'trialLecturesUsed';
        tx.set(r, { [field]: bucket.used + 1, updatedAt: now() }, { merge: true });
      }
      return field;
    });
    return () => r.set({ [taken]: FieldValue.increment(-1) }, { merge: true }).catch(e => logger.error('refund failed', uid, e));
  }

  async function callClaude(uid, kind, { system, content, schema, maxTokens, effort }) {
    let res;
    try {
      res = await anthropic.beta.messages.create({
        model: CONFIG.MODEL,
        max_tokens: maxTokens,
        system,
        thinking: { type: 'adaptive' },
        output_config: { effort, format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content }],
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (e) {
      const status = e && e.status;
      logger.error('Claude call failed', kind, status, e && e.message);
      if (status === 429 || status === 529 || (status >= 500 && status < 600)) throw new HttpsError('unavailable', 'Claude is busy right now. Try again in a minute.');
      if (status === 413) throw new HttpsError('invalid-argument', 'Too many or too large photos in one set. Try fewer photos at once.');
      throw new HttpsError('internal', 'Generation failed. Please try again.');
    }
    logUsage(uid, kind, res);
    if (res.stop_reason === 'refusal') throw new HttpsError('failed-precondition', 'Claude declined this request.', { reason: 'refusal' });
    if (res.stop_reason === 'max_tokens') throw new HttpsError('invalid-argument', 'The response was cut off. Try fewer photos at once.');
    const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      const parsed = JSON.parse(text);
      parsed._model = res.model;
      return parsed;
    } catch (e) { throw new HttpsError('internal', 'Could not read the generated result. Please try again.'); }
  }

  function logUsage(uid, kind, res) {
    const u = res.usage || {};
    const P = CONFIG.PRICE_PER_MTOK;
    const cost = ((u.input_tokens || 0) * P.input + (u.output_tokens || 0) * P.output + (u.cache_read_input_tokens || 0) * P.cacheRead) / 1e6;
    db.collection('usage').add({
      uid, kind, model: res.model || CONFIG.MODEL, at: now(),
      inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, cacheReadTokens: u.cache_read_input_tokens || 0,
      costUsd: Math.round(cost * 1e5) / 1e5,
    }).catch(e => logger.warn('usage log failed', e.message));
  }

  // ---------- callables ----------
  async function generateSet(uid, data) {
    const images = Array.isArray(data.images) ? data.images : [];
    if (!images.length) throw new HttpsError('invalid-argument', 'Add at least one photo of your notes.');
    if (images.length > CONFIG.MAX_IMAGES) throw new HttpsError('invalid-argument', `Use at most ${CONFIG.MAX_IMAGES} photos per set.`);
    if (images.some(s => typeof s !== 'string' || s.length > 3000000 || !/^[A-Za-z0-9+/=]+$/.test(s.slice(0, 200)))) throw new HttpsError('invalid-argument', 'One of the photos could not be read.');
    const name = String(data.name || '').slice(0, 80);
    const mode = MODES.has(data.mode) ? data.mode : 'flash';
    const refund = await reserve(uid, 'sets');
    try {
      const out = await callClaude(uid, 'set', { system: Prompts.SYSTEM, content: Prompts.setContent(images, name, mode), schema: Prompts.SCHEMA, maxTokens: 16000, effort: 'high' });
      out._allowance = await status(uid);
      return out;
    } catch (e) { await refund(); throw e; }
  }

  async function generateLecture(uid, data) {
    const c = data.creation || {};
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    const cards = (Array.isArray(c.cards) ? c.cards : []).slice(0, 120).map(k => ({ front: str(k && k.front, 300), back: str(k && k.back, 300) }));
    const questions = (Array.isArray(c.questions) ? c.questions : []).slice(0, 15)
      .filter(q => q && Array.isArray(q.choices) && Number.isInteger(q.answer))
      .map(q => ({ question: str(q.question, 400), choices: q.choices.slice(0, 4).map(x => str(x, 200)), answer: q.answer }));
    if (cards.length < 2) throw new HttpsError('invalid-argument', 'This set has too few cards for a lecture.');
    const clean = { name: str(c.name, 80), subject: str(c.subject, 120), summary: str(c.summary, 800), cards, questions };
    const refund = await reserve(uid, 'lectures');
    try {
      return await callClaude(uid, 'lecture', { system: Prompts.LECTURE_SYSTEM, content: Prompts.lectureContent(clean), schema: Prompts.LECTURE_SCHEMA, maxTokens: 8000, effort: 'medium' });
    } catch (e) { await refund(); throw e; }
  }

  async function status(uid) {
    const snap = await ref(uid).get();
    const b = snap.exists ? snap.data() : {};
    const a = allowance(b);
    return {
      kind: a.kind, plan: a.plan, status: b.status || null,
      periodEnd: b.periodEnd ? b.periodEnd * 1000 : null, cancelAtPeriodEnd: !!b.cancelAtPeriodEnd,
      sets: a.sets, lectures: a.lectures, model: CONFIG.MODEL,
      plans: Object.entries(CONFIG.PLANS).map(([id, p]) => ({ id, name: p.name, price: p.price, interval: p.interval, sets: p.sets, available: !!priceIds[id] })),
      canManage: !!b.customerId,
    };
  }

  function checkReturnUrl(url) {
    let u;
    try { u = new URL(String(url)); } catch (e) { throw new HttpsError('invalid-argument', 'Bad return address.'); }
    if (!allowedOrigins.includes(u.origin)) throw new HttpsError('permission-denied', `Payments are not enabled for ${u.origin}. Add it to ALLOWED_ORIGINS.`);
    return u.origin + u.pathname;
  }
  const needStripe = () => { if (!stripe) throw new HttpsError('failed-precondition', 'Payments are not set up yet.'); };

  async function createCheckout(uid, data, email) {
    needStripe();
    const plan = data.plan;
    if (!CONFIG.PLANS[plan] || !priceIds[plan]) throw new HttpsError('invalid-argument', 'That plan is not available.');
    const back = checkReturnUrl(data.returnUrl);
    const r = ref(uid);
    const b = (await r.get()).data() || {};
    // Already subscribed: changing plans happens in the customer portal, so nobody ends up with two subscriptions.
    if (planFor(b) && b.customerId) return portal(uid, data);
    let customer = b.customerId;
    if (!customer) {
      const c = await stripe.customers.create({ metadata: { uid }, ...(email && !/@users\.notequest\.app$/.test(email) ? { email } : {}) });
      customer = c.id;
      await r.set({ customerId: customer, updatedAt: now() }, { merge: true });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: uid,
      line_items: [{ price: priceIds[plan], quantity: 1 }],
      subscription_data: { metadata: { uid } },
      allow_promotion_codes: true,
      success_url: back + '#settings/plan-ok',
      cancel_url: back + '#settings',
    });
    return { url: session.url };
  }

  async function portal(uid, data) {
    needStripe();
    const back = checkReturnUrl(data.returnUrl);
    const b = (await ref(uid).get()).data() || {};
    if (!b.customerId) throw new HttpsError('failed-precondition', 'You do not have a subscription yet.');
    const s = await stripe.billingPortal.sessions.create({ customer: b.customerId, return_url: back + '#settings' });
    return { url: s.url };
  }

  // ---------- Stripe -> billing/{uid} ----------
  const planOfPrice = id => Object.keys(CONFIG.PLANS).find(k => priceIds[k] && priceIds[k] === id) || null;

  async function uidFor(sub) {
    if (sub.metadata && sub.metadata.uid) return sub.metadata.uid;
    const q = await db.collection('billing').where('customerId', '==', typeof sub.customer === 'string' ? sub.customer : sub.customer.id).limit(1).get();
    return q.empty ? null : q.docs[0].id;
  }

  // Always re-read the subscription from Stripe, so events that arrive late or out of order cannot
  // overwrite newer state.
  async function syncSubscription(subId, hintUid) {
    const sub = await stripe.subscriptions.retrieve(subId);
    const uid = hintUid || await uidFor(sub);
    if (!uid) { logger.warn('subscription without a user', subId); return; }
    const item = sub.items && sub.items.data && sub.items.data[0];
    const plan = item ? planOfPrice(item.price && item.price.id) : null;
    const periodStart = (item && item.current_period_start) || sub.current_period_start || null;
    const periodEnd = (item && item.current_period_end) || sub.current_period_end || null;
    const r = ref(uid);
    const prev = (await r.get()).data() || {};
    // A newer subscription on the same account wins; ignore stale events about an older one.
    if (prev.subscriptionId && prev.subscriptionId !== sub.id && ACTIVE.has(prev.status) && !ACTIVE.has(sub.status)) return;
    await r.set({
      plan: sub.status === 'canceled' ? null : plan, status: sub.status, subscriptionId: sub.id,
      customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      periodStart, periodEnd, cancelAtPeriodEnd: !!sub.cancel_at_period_end, updatedAt: now(),
    }, { merge: true });
  }

  async function handleStripeEvent(event) {
    const o = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
        if (o.mode === 'subscription' && o.subscription) await syncSubscription(o.subscription, o.client_reference_id);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await syncSubscription(o.id);
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const subId = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
        if (subId) await syncSubscription(typeof subId === 'string' ? subId : subId.id);
        break;
      }
      default: break;
    }
  }

  async function onUserDeleted(uid) {
    const r = ref(uid);
    const b = (await r.get()).data();
    if (b && b.subscriptionId && stripe && ACTIVE.has(b.status)) {
      try { await stripe.subscriptions.cancel(b.subscriptionId); } catch (e) { logger.error('cancel on delete failed', uid, e.message); }
    }
    await r.delete();
  }

  return { allowance, reserve, generateSet, generateLecture, status, createCheckout, portal, handleStripeEvent, syncSubscription, onUserDeleted, stripe };
}

module.exports = { createBilling, CONFIG };
