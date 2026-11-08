// Plan and pricing config for hosted generation. Change the numbers here, then redeploy the functions.
// The Stripe price ids live in functions/.env (STRIPE_PRICE_STUDY, STRIPE_PRICE_PLUS) so test and live
// mode can use different prices. The `price` labels are only shown in the app; Stripe charges what the
// price id says, so keep the two in step.
module.exports = {
  // The model every hosted request uses. Users with their own API key can still pick any model.
  MODEL: 'claude-sonnet-5-5',

  // New accounts can try this many hosted sets before subscribing (lifetime, not per month).
  FREE_TRIAL_SETS: 3,

  // Lectures are cheaper than sets (text only). Each plan allows this many lecture writes per set.
  LECTURES_PER_SET: 2,

  // Most photos accepted in one hosted request.
  MAX_IMAGES: 10,

  PLANS: {
    study: { name: 'Study', price: '$2.99', interval: 'month', sets: 15, priceEnv: 'STRIPE_PRICE_STUDY' },
    plus: { name: 'Study+', price: '$5.99', interval: 'month', sets: 40, priceEnv: 'STRIPE_PRICE_PLUS' },
  },

  // Claude Sonnet 5.5 list prices in US dollars per million tokens, used only to log an estimated cost
  // per request in the `usage` collection. Check https://claude.com/pricing when they change.
  PRICE_PER_MTOK: { input: 2.0, output: 10.0, cacheRead: 0.2 },
};
