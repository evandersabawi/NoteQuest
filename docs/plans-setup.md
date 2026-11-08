# Turning on Notely plans

Notely plans let people make study sets without their own Claude API key. The Firebase backend in
`functions/` calls Claude Sonnet 5.5 with your key, counts each person's sets per month, and takes
payment through Stripe. People who paste their own key in Settings skip all of this.

| Plan | Price | Sets per month | Lectures per month |
|---|---|---|---|
| Free trial | free | 3 in total (not monthly) | 6 in total |
| Study | $2.99 | 15 | 30 |
| Study+ | $5.99 | 40 | 80 |

Change these numbers in `functions/plans.js` and the prices in Stripe, then redeploy.

## What it costs you

These are estimates until real usage comes in. The backend logs every Claude call to the `usage`
collection in Firestore, with token counts and a cost estimate. Check them after the first week.

- One set from 2 to 3 photos is about 5k input and 6k output tokens on Sonnet 5.5 ($2 / $10 per
  million tokens). That's about 7 cents, and a lecture adds about 3 cents. Call it 10 cents per set.
- Study: 15 sets is $1.50 of Claude at most. Stripe takes about $0.39 (2.9% + 30 cents), leaving at
  least $1.10 profit, and more when people don't use every set.
- Study+: 40 sets is $4.00 of Claude at most. Stripe takes about $0.47, leaving at least $1.52.
- Firebase: Cloud Functions need the Blaze (pay-as-you-go) plan, but this traffic stays inside its
  free monthly quota.
- Each free trial costs you up to about 30 cents. Anyone can make extra accounts to get more free
  trials. If that starts happening, lower `FREE_TRIAL_SETS` or turn on Firebase App Check.

## One-time setup

1. **Firebase Blaze plan.** Firebase console, project `notequest-46236`, then Upgrade. Set a budget
   alert (Google Cloud Billing, then Budgets) at something like $10.
2. **Claude key for the server.** Create a separate key at console.anthropic.com named "Notely
   server". Set a monthly spend limit there too.
3. **Stripe.**
   - Create an account at stripe.com and stay in Test mode at first.
   - Product catalog: add the product "Notely Study" with a recurring price of $2.99 a month, and
     "Notely Study+" at $5.99 a month. Copy both price ids (`price_...`).
   - Settings, Billing, Customer portal: turn it on and allow customers to cancel and to switch
     between the two products.
4. **Install the tools** (once, on your PC): `npm install -g firebase-tools`, then `firebase login`.
5. **Fill in the config.** Copy `functions/.env.example` to `functions/.env` and paste in the two
   price ids. Then set the secrets, one at a time; each command asks you to paste the value:
   ```
   firebase functions:secrets:set ANTHROPIC_API_KEY
   firebase functions:secrets:set STRIPE_SECRET_KEY      (sk_test_... first, sk_live_... later)
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET  (step 7; enter a placeholder for now)
   ```
6. **Deploy** from the project folder:
   ```
   cd functions && npm install && npm test && cd ..
   firebase deploy --only functions,firestore:rules
   ```
7. **Stripe webhook.** In Stripe, go to Developers, Webhooks, Add endpoint, and use
   `https://us-central1-notequest-46236.cloudfunctions.net/stripeWebhook`. Choose these events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`. Copy the signing
   secret (`whsec_...`), run `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` again, and
   redeploy.
8. **Test** with the card 4242 4242 4242 4242 (any future date, any CVC). Settings should show the
   plan within a few seconds of paying.
9. **Go live.** Switch Stripe to live mode, recreate the two prices and the webhook there, and
   update `functions/.env`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with the live values.
   Redeploy.

If the site moves to a new address, add it to `ALLOWED_ORIGINS` in `functions/.env`. Stripe only
sends people back to addresses on that list.

## How it fits together

- `js/billing.js` (browser) shows the Plan section in Settings and the note on Create, and calls
  the functions.
- `js/api.js` calls Claude directly when the user has their own key. Otherwise it goes through
  `Billing`.
- `js/prompts.js` holds the prompts and schemas for both paths. `firebase deploy` copies it into
  `functions/`.
- `functions/billing.js` holds the quota and Stripe logic, and `functions/index.js` holds the
  endpoints. Run `npm test` in `functions/` for the tests, which need no keys.
- Firestore `billing/{uid}` holds the plan, the billing period and the counters. Users can read
  their own document; only the server writes it. `usage/{id}` is server-only.
- Deleting an account cancels its subscription.
