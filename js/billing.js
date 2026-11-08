// Notely plans: hosted generation on the owner's Claude key, paid for by subscription (see functions/).
// People who add their own Claude API key in Settings skip all of this and call Claude directly.
const Billing = (() => {
  const V = '11.10.0'; // must match the Firebase version in cloud.js
  const REGION = 'us-central1';
  const I = (...a) => Icons.icon(...a);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Use the app's translator when there is one; plain English otherwise.
  const tr = (s, v) => (typeof window.t === 'function' ? window.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)));
  const date = ts => new Date(ts).toLocaleDateString(document.documentElement.lang || undefined, { month: 'short', day: 'numeric' });

  let fnMod = null, fns = null, last = null;
  const signedIn = () => !!(window.Cloud && Cloud.enabled() && Cloud.profile());

  async function functions() {
    if (!fns) {
      const [appM, fM] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-functions.js`),
      ]);
      fnMod = fM; fns = fM.getFunctions(appM.getApp(), REGION);
    }
    return fns;
  }

  // Turn a Functions error into one the Create and Lecture screens already know how to show.
  function friendly(e) {
    const code = String((e && e.code) || '').replace('functions/', '');
    const d = (e && e.details) || {};
    let msg, kind = 'api', link = null;
    if (code === 'resource-exhausted') {
      kind = 'plan'; link = '#settings';
      msg = d.reason === 'limit'
        ? tr('You have used all {n} study sets in your plan this month. Upgrade or wait for your plan to renew.', { n: d.limit })
        : tr('Your free study sets are used up. Pick a plan to keep creating sets, or add your own Claude API key in Settings.');
    } else if (code === 'unauthenticated') { kind = 'auth'; msg = tr('Log in to a cloud account to use Notely plans.'); }
    else if (code === 'unavailable') { kind = 'busy'; msg = tr('Claude is busy right now. Try again in a minute.'); }
    else if (code === 'deadline-exceeded') { kind = 'busy'; msg = tr('That took too long. Try again with fewer photos.'); }
    else if (code === 'not-found' || (code === 'internal' && /not.?found/i.test(e.message || ''))) { msg = tr('Notely plans are not switched on yet. Add your own Claude API key in Settings for now.'); }
    else if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'permission-denied') msg = e.message;
    else if (/network|fetch/i.test((e && e.message) || '')) { kind = 'network'; msg = tr('Could not reach Notely. Check your internet connection.'); }
    else msg = (e && e.message) || tr('Something went wrong. Please try again.');
    const err = new Error(msg); err.kind = kind; err.link = link; err.code = code;
    return err;
  }

  async function call(name, data, timeout = 310000) {
    if (!signedIn()) throw friendly({ code: 'functions/unauthenticated' });
    try {
      const f = await functions();
      return (await fnMod.httpsCallable(f, name, { timeout })(data)).data;
    } catch (e) { throw (e && e.kind ? e : friendly(e)); }
  }

  async function status(force) {
    if (!signedIn()) return null;
    if (last && !force && Date.now() - last.at < 60000) return last.s;
    const s = await call('billingStatus', {}, 30000);
    last = { at: Date.now(), s };
    return s;
  }

  async function generateSet({ images, name, mode, onStatus }) {
    onStatus && onStatus(tr('Reading your notes with Claude…'));
    const r = await call('generateSet', { images, name, mode });
    if (r && r._allowance) { last = { at: Date.now(), s: r._allowance }; delete r._allowance; }
    return r;
  }
  async function generateLecture({ creation: c }) {
    const slim = { name: c.name, subject: c.subject, summary: c.summary, cards: c.cards, questions: (c.questions || []).slice(0, 15) };
    const r = await call('generateLecture', { creation: slim });
    last = null;
    return r;
  }

  const returnUrl = () => location.origin + location.pathname;
  async function go(name, data) {
    const { url } = await call(name, Object.assign({ returnUrl: returnUrl() }, data), 30000);
    location.href = url;
  }

  // ---------- views ----------
  function leftLine(s) {
    if (!s) return '';
    const left = Math.max(0, s.sets.limit - s.sets.used);
    if (s.kind === 'plan') {
      const p = s.plans.find(x => x.id === s.plan) || { name: s.plan };
      const when = s.periodEnd ? (s.cancelAtPeriodEnd ? tr('ends {date}', { date: date(s.periodEnd) }) : tr('renews {date}', { date: date(s.periodEnd) })) : '';
      return tr('{plan} plan: {left} of {limit} sets left this month', { plan: p.name, left, limit: s.sets.limit }) + (when ? ' · ' + when : '');
    }
    return left ? tr('Free trial: {left} of {limit} sets left', { left, limit: s.sets.limit }) : tr('Free trial used up');
  }

  // Line shown at the top of Create. Returns '' when nothing needs saying.
  async function createNotice(hasOwnKey) {
    if (hasOwnKey) return '';
    if (!signedIn()) return `<div class="banner">${I('info')}<div>${tr('To create sets, log in with a cloud account (it includes free sets to try) or add your own Claude API key in <a href="#settings">Settings</a>.')}</div></div>`;
    let s;
    try { s = await status(); } catch (e) { return ''; }
    if (!s) return '';
    const left = s.sets.limit - s.sets.used;
    if (left > 0) return `<p class="free-note">${I('sparkles')} ${esc(leftLine(s))}</p>`;
    return `<div class="banner">${I('info')}<div>${esc(leftLine(s))}. <a class="btn primary small" href="#settings">${tr('See plans')}</a></div></div>`;
  }

  // The Plan section of Settings.
  async function mountPlan(el, { hasOwnKey } = {}) {
    if (!el) return;
    if (!signedIn()) {
      el.innerHTML = `<p class="hint">${tr('Plans need a cloud account so they work on every device. You can still use your own Claude API key below.')}</p>`;
      return;
    }
    el.innerHTML = `<p class="hint"><span class="spinner"></span> ${tr('Checking your plan…')}</p>`;
    let s;
    try { s = await status(true); } catch (e) { el.innerHTML = `<div class="error">${I('info')}<div>${esc(e.message)}</div></div>`; return; }
    const pct = Math.min(100, Math.round(s.sets.used / Math.max(1, s.sets.limit) * 100));
    el.innerHTML = `
      <div class="plan-now">
        <b>${esc(leftLine(s))}</b>
        <span class="plan-meter"><i style="width:${pct}%"></i></span>
        ${hasOwnKey ? `<small>${tr('You have your own API key set, so new sets use it and do not count against your plan.')}</small>` : ''}
      </div>
      <div class="plan-grid">${s.plans.map(p => {
        const current = s.plan === p.id;
        return `<div class="plan-option ${current ? 'current' : ''}">
          <div class="plan-name"><b>${esc(p.name)}</b><span><b>${esc(p.price)}</b> ${tr('/ month')}</span></div>
          <p>${tr('{n} study sets a month, each with a lecture', { n: p.sets })}</p>
          ${current ? `<span class="plan-tag">${I('check')} ${tr('Your plan')}</span>`
            : `<button class="btn ${s.plan ? 'secondary' : 'primary'}" data-plan="${esc(p.id)}" ${p.available ? '' : 'disabled'}>${s.plan ? tr('Switch to {plan}', { plan: esc(p.name) }) : tr('Choose {plan}', { plan: esc(p.name) })}</button>`}
        </div>`;
      }).join('')}</div>
      <div class="row">${s.canManage ? `<button class="btn ghost" id="plan-manage">${I('settings')} ${tr('Manage subscription')}</button>` : ''}</div>
      <p class="hint">${tr('Sets are written by Claude Sonnet 5.5. Payments are handled by Stripe; cancel any time and the plan runs to the end of the month you paid for.')}</p>
      <div class="error" id="plan-err" hidden></div>`;
    const showErr = e => { const x = el.querySelector('#plan-err'); x.hidden = false; x.textContent = e.message; };
    el.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
      b.disabled = true; b.innerHTML = `<span class="spinner"></span> ${tr('Opening checkout…')}`;
      try { await go(s.plan ? 'billingPortal' : 'createCheckout', { plan: b.dataset.plan }); } catch (e) { b.disabled = false; b.textContent = tr('Try again'); showErr(e); }
    });
    const m = el.querySelector('#plan-manage');
    if (m) m.onclick = async () => { m.disabled = true; try { await go('billingPortal', {}); } catch (e) { m.disabled = false; showErr(e); } };
  }

  // After Stripe sends people back, the webhook may land a moment later: poll briefly for the new plan.
  async function afterCheckout(onReady) {
    for (let i = 0; i < 10; i++) {
      try { const s = await status(true); if (s && s.kind === 'plan') return onReady(s); } catch (e) { /* keep trying */ }
      await new Promise(r => setTimeout(r, 1500));
    }
    onReady(null);
  }

  return { signedIn, status, generateSet, generateLecture, createNotice, mountPlan, afterCheckout, leftLine };
})();
