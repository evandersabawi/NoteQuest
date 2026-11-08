// Notely backend (Firebase Cloud Functions, 2nd gen).
//
//   generateSet     signed-in user + photos -> study set, written by Claude on the owner's API key
//   generateLecture signed-in user + set     -> spoken lecture script
//   billingStatus   what plan the user is on and how much of it is left this month
//   createCheckout  Stripe Checkout link to start a plan
//   billingPortal   Stripe customer portal link (change plan, update card, cancel)
//   stripeWebhook   keeps billing/{uid} in step with Stripe
//   onUserDeleted   cancels the subscription when an account is deleted
//
// Firestore: billing/{uid} (readable by its owner, written only here) and usage/{id} (server only, one row
// per Claude call with tokens and an estimated cost, so prices can be checked against real usage).
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const functionsV1 = require('firebase-functions/v1');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { createBilling } = require('./billing');

admin.initializeApp();
// A hard ceiling on parallel instances keeps a bug or an attack from running up a large Claude bill.
setGlobalOptions({ region: 'us-central1', maxInstances: 20 });

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_STUDY = defineString('STRIPE_PRICE_STUDY', { default: '' });
const STRIPE_PRICE_PLUS = defineString('STRIPE_PRICE_PLUS', { default: '' });
// Sites allowed as Stripe return addresses, comma separated.
const ALLOWED_ORIGINS = defineString('ALLOWED_ORIGINS', { default: 'https://evandersabawi.github.io,http://localhost:8765' });

let billing = null;
function B() {
  if (!billing) {
    const Anthropic = require('@anthropic-ai/sdk');
    const Stripe = require('stripe');
    billing = createBilling({
      db: admin.firestore(),
      FieldValue: admin.firestore.FieldValue,
      anthropic: new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 280000, maxRetries: 2 }),
      stripe: STRIPE_SECRET_KEY.value() ? new Stripe(STRIPE_SECRET_KEY.value()) : null,
      priceIds: { study: STRIPE_PRICE_STUDY.value(), plus: STRIPE_PRICE_PLUS.value() },
      allowedOrigins: ALLOWED_ORIGINS.value().split(',').map(s => s.trim()).filter(Boolean),
      logger,
    });
  }
  return billing;
}

const needUser = req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Log in to a cloud account to use Notely plans.');
  return req.auth.uid;
};
const aiOpts = { secrets: [ANTHROPIC_API_KEY, STRIPE_SECRET_KEY], timeoutSeconds: 300, memory: '512MiB', cors: true };
const payOpts = { secrets: [ANTHROPIC_API_KEY, STRIPE_SECRET_KEY], cors: true };

exports.generateSet = onCall(aiOpts, req => B().generateSet(needUser(req), req.data || {}));
exports.generateLecture = onCall(aiOpts, req => B().generateLecture(needUser(req), req.data || {}));
exports.billingStatus = onCall(payOpts, req => B().status(needUser(req)));
exports.createCheckout = onCall(payOpts, async req => {
  const uid = needUser(req);
  return B().createCheckout(uid, req.data || {}, req.auth.token && req.auth.token.email);
});
exports.billingPortal = onCall(payOpts, req => B().portal(needUser(req), req.data || {}));

exports.stripeWebhook = onRequest({ secrets: [ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  let event;
  try {
    event = B().stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
  } catch (e) {
    logger.warn('Stripe signature check failed', e.message);
    res.status(400).send('Bad signature'); return;
  }
  try {
    await B().handleStripeEvent(event);
    res.json({ received: true });
  } catch (e) {
    logger.error('Stripe webhook failed', event.type, e);
    res.status(500).send('Webhook handler failed'); // Stripe retries
  }
});

// Deleting an account (from Settings) must not leave a subscription charging.
exports.onUserDeleted = functionsV1.runWith({ secrets: ['ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY'] })
  .auth.user().onDelete(user => B().onUserDeleted(user.uid));
