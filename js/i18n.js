// Interface language. English is written straight into the code and is also the lookup key, so the app
// works unchanged without this file. Other languages live in js/lang/<code>.js and load only when chosen.
//
// Two ways text gets translated:
//  1. New code can call t('Log in') or t('Welcome back, {name}.', { name }) and tn(n, '{n} set', '{n} sets').
//  2. Everything already on screen is translated as it appears: a MutationObserver looks up each text node
//     and the placeholder / title / aria-label attributes in the dictionary. Keys with {placeholders} also
//     match text that has values filled in ("Level 3", "Welcome back, Sam."). Text joined with " · " is
//     looked up piece by piece. Anything not in the dictionary stays in English.
// User content (set names, cards, lecture transcripts, usernames) is skipped by the SKIP selector below.
const I18N = (() => {
  const LANGS = [
    ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'],
    ['it', 'Italiano'], ['zh', '中文（简体）'], ['ja', '日本語'], ['ko', '한국어'],
  ];
  const KEY = 'notely.lang';
  const VERSION = 1; // bump when a language file changes, so browsers fetch the new one
  const SKIP = [
    'script', 'style', 'code', 'pre', 'textarea', '[contenteditable]', '[translate="no"]', '[data-no-i18n]',
    '.lec-transcript', '.cardlist', '.tile h2', '.tile-sub', '.play-title b', '.user-chip span', '.side-user b',
    '.name-row h1', '.fc-face p', '.qtext', '.choice', '.account b', '.caught', '.battle-log .name',
    '.tile-front', '.review-item > p', '.review-item small', '.modal-card h3[data-no-i18n]',
  ].join(',');
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  const dicts = { en: {} };
  const compiled = {}; // code -> { exact: Map, patterns: [{ re, names, out }] }
  let lang = 'en', plural = new Intl.PluralRules('en');

  const supported = code => LANGS.some(([c]) => c === code);
  function detect() {
    try { const saved = localStorage.getItem(KEY); if (saved && supported(saved)) return saved; } catch (e) { /* storage blocked */ }
    for (const l of navigator.languages || [navigator.language || 'en']) {
      const base = String(l).toLowerCase().split('-')[0];
      if (supported(base)) return base;
    }
    return 'en';
  }
  function loadScript(code) {
    if (dicts[code]) return Promise.resolve();
    return new Promise(res => {
      const s = document.createElement('script');
      s.src = `js/lang/${code}.js?v=${VERSION}`;
      s.onload = s.onerror = () => res();
      document.head.appendChild(s);
    });
  }

  // ---------- lookup ----------
  const escRe = s => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  function compile(code) {
    if (compiled[code]) return compiled[code];
    const exact = new Map(), patterns = [];
    for (const [k, v] of Object.entries(dicts[code] || {})) {
      const out = v && typeof v === 'object' ? v.other : v;
      if (!out) continue;
      if (!/\{\w+\}/.test(k)) { exact.set(k, out); continue; }
      const names = [];
      const src = escRe(k).replace(/\\?\{(\w+)\\?\}/g, (m, name) => {
        names.push(name);
        if (name === 'n' || name === 'm') return '(\\d[\\d.,/]*%?)';
        if (name === 'rest') return '([\\s\\S]*)';
        return '(.+?)';
      });
      patterns.push({ re: new RegExp('^' + src + '$'), names, out, fixed: k.replace(/\{\w+\}/g, '').length });
    }
    patterns.sort((a, b) => b.fixed - a.fixed); // most specific first
    return (compiled[code] = { exact, patterns });
  }
  const fill = (s, vars) => vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : String(s);

  // Translate one piece of English UI text that may carry filled-in values. Returns null if unknown.
  function lookup(s, depth = 0) {
    const c = compile(lang);
    const hit = c.exact.get(s); if (hit) return hit;
    for (const p of c.patterns) {
      const m = p.re.exec(s); if (!m) continue;
      const vars = {};
      p.names.forEach((name, i) => { const v = m[i + 1]; vars[name] = name === 'when' && depth < 2 ? (lookup(v.replace(/[\s·]+$/, ''), depth + 1) || v) : v; });
      return fill(p.out, vars);
    }
    return null;
  }
  function translateText(s) {
    if (lang === 'en' || !s) return s;
    const lead = s.match(/^[\s·]*/)[0], trail = s.slice(lead.length).match(/[\s·]*$/)[0];
    const core = s.slice(lead.length, s.length - trail.length);
    if (!core || !/\p{L}/u.test(core)) return s;
    let out = lookup(core);
    if (out == null && core.includes('·')) {
      const parts = core.split(/(\s*·\s*)/);
      let changed = false;
      out = parts.map(p => { if (!p.trim() || /^\s*·\s*$/.test(p)) return p; const r = lookup(p.trim()); if (r == null) return p; changed = true; return r; }).join('');
      if (!changed) out = null;
    }
    return out == null ? s : lead + out + trail;
  }

  function t(s, vars) {
    const d = dicts[lang][s];
    const out = d && typeof d === 'object' ? d.other : d;
    return fill(out || s, vars);
  }
  function tn(n, one, other, vars) {
    const e = dicts[lang][other] || dicts[lang][one];
    let s;
    if (e && typeof e === 'object') s = e[plural.select(n)] || e.other;
    else if (n === 1) s = dicts[lang][one] || one;
    else s = dicts[lang][other] || other;
    return fill(s, Object.assign({ n: fmtNum(n) }, vars));
  }
  const fmtNum = n => (typeof n === 'number' ? new Intl.NumberFormat(lang).format(n) : n);

  // ---------- live DOM translation ----------
  const origText = new WeakMap();  // text node -> English source
  const wroteText = new WeakMap(); // text node -> what we last wrote (to ignore our own mutations)
  const origAttr = new WeakMap();  // element -> { attr: English source }
  const skipped = el => !el || !!el.closest(SKIP);

  function doText(node) {
    if (skipped(node.parentElement)) return;
    const cur = node.nodeValue;
    if (wroteText.get(node) !== cur) origText.set(node, cur); // the app wrote new English text
    const src = origText.get(node);
    const out = translateText(src);
    if (out !== cur) { wroteText.set(node, out); node.nodeValue = out; } else wroteText.set(node, cur);
  }
  function doAttrs(el) {
    if (skipped(el)) return;
    let saved = origAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      saved = saved || {};
      const prev = saved[a];
      if (!prev || prev.wrote !== cur) saved[a] = { src: cur, wrote: cur };
      const out = translateText(saved[a].src);
      saved[a].wrote = out;
      if (out !== cur) el.setAttribute(a, out);
    }
    if (saved) origAttr.set(el, saved);
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || skipped(root)) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n; while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  let observer = null;
  function observe() {
    if (observer) return;
    observer = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---------- switching ----------
  async function use(code, remember) {
    if (!supported(code)) code = 'en';
    await loadScript(code);
    if (!dicts[code]) code = 'en'; // the file failed to load: stay usable in English
    lang = code; plural = new Intl.PluralRules(code);
    document.documentElement.lang = code;
    if (remember) { try { localStorage.setItem(KEY, code); } catch (e) { /* ignore */ } }
    document.querySelectorAll('select[data-lang-select]').forEach(s => { s.value = code; s.setAttribute('aria-label', t('Language')); });
    walk(document.body);
    document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: code } }));
    // Text that code built with t() in the old language only changes when the page is drawn again.
    if (remember) window.dispatchEvent(new HashChangeEvent('hashchange'));
    return code;
  }

  // A native <select> so it works with keyboards, screen readers and phones. Any number can be on the page.
  const GLOBE = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  function selectHTML(extraClass = '') {
    return `<label class="lang-pick ${extraClass}" translate="no">${GLOBE}<select data-lang-select aria-label="Language">${LANGS.map(([c, n]) => `<option value="${c}" lang="${c}" ${c === lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
  }
  document.addEventListener('change', e => {
    const s = e.target.closest && e.target.closest('select[data-lang-select]');
    if (s) use(s.value, true);
  });

  // ---------- lectures: English only for now ----------
  // Kokoro and the browser voices used for lectures are English, so a lecture is offered only when the set's
  // own text reads as English. Undecided (very short sets) counts as English.
  const STOP = {
    en: 'the of and to is are what which for with that from by how why does this it an on be was were in',
    es: 'el la los las de que y en es por para con una del se lo como qué cuál son',
    fr: 'le la les des du et est une que pour dans avec sur qui en au aux sont quel quelle',
    de: 'der die das und ist nicht mit ein eine den von zu im auf sich des dem welche wie',
    pt: 'o os as do da dos das que e é não uma com para em no na como qual são',
    it: 'il lo gli le che di e è per una con del della dei nel sono come quale',
  };
  const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
  function textLanguage(text) {
    const s = String(text || '');
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (!letters) return 'unknown';
    const latin = (s.match(/\p{Script=Latin}/gu) || []).length;
    if (latin / letters < 0.6) return 'other';
    const words = s.toLowerCase().match(/\p{L}+/gu) || [];
    const score = {};
    for (const w of words) for (const [k, set] of Object.entries(STOPSETS)) if (set.has(w)) score[k] = (score[k] || 0) + 1;
    const en = score.en || 0;
    const best = Math.max(0, ...Object.entries(score).filter(([k]) => k !== 'en').map(([, v]) => v));
    if (en === 0 && best === 0) return 'unknown';
    return en >= best ? 'en' : 'other';
  }
  function lectureOK(c) {
    if (!c) return false;
    if (c.lecture) return textLanguage(c.lecture.sections.map(x => x.paragraphs.join(' ')).join(' ').slice(0, 4000)) !== 'other';
    const sample = [c.name, c.summary, ...(c.cards || []).slice(0, 30).flatMap(k => [k.front, k.back]), ...(c.questions || []).slice(0, 10).map(q => q.question)].join(' ');
    return textLanguage(sample) !== 'other';
  }

  // ---------- styles for the pieces this file adds ----------
  const css = document.createElement('style');
  css.textContent = `
    .lang-pick{display:inline-flex;align-items:center;gap:.35rem;position:relative;color:inherit}
    .lang-pick .ico{width:1.05rem;height:1.05rem;opacity:.75;pointer-events:none;position:absolute;left:.55rem}
    .lang-pick select{appearance:none;-webkit-appearance:none;font:inherit;font-size:.9rem;color:inherit;background:transparent;border:1px solid transparent;border-radius:.6rem;padding:.4rem .6rem .4rem 1.9rem;cursor:pointer;max-width:9.5rem}
    .lang-pick select:hover{border-color:currentColor}
    .lang-pick select:focus-visible{outline:2px solid currentColor;outline-offset:2px}
    .lang-pick option{color:#111;background:#fff}
    .topbar .lang-pick{margin-left:auto;margin-right:.5rem}
    .lang-pick.boxed{display:flex}.lang-pick.boxed select{border-color:rgba(127,127,127,.45);max-width:none;width:100%;padding-top:.6rem;padding-bottom:.6rem}
    .btn[aria-disabled="true"]{opacity:.5;cursor:not-allowed;pointer-events:auto}
    @media (max-width:520px){.topbar .lang-pick select{max-width:2.6rem;padding-right:.2rem;color:transparent}.topbar .lang-pick .ico{opacity:1}}
    html.i18n-loading body{visibility:hidden}`;
  document.head.appendChild(css);

  // ---------- start ----------
  function mountTopbar() {
    const right = document.getElementById('topRight');
    if (!right || document.querySelector('.topbar .lang-pick')) return;
    right.insertAdjacentHTML('beforebegin', selectHTML());
  }
  const first = detect();
  if (first !== 'en') {
    document.documentElement.classList.add('i18n-loading');
    setTimeout(() => document.documentElement.classList.remove('i18n-loading'), 1500); // never hide the page for long
  }
  function start() {
    mountTopbar(); observe();
    use(first, false).finally(() => document.documentElement.classList.remove('i18n-loading'));
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  return {
    LANGS, detect, use, t, tn, fmtNum, translateText, selectHTML, lectureOK, textLanguage,
    get lang() { return lang; },
    register(code, dict) { dicts[code] = dict; delete compiled[code]; },
  };
})();
window.t = I18N.t; window.tn = I18N.tn;
