// App shell: accounts, routing, Home, Your Creations, Create, Settings.
(() => {
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = Icons.icon;

  const MODES = {
    flash:   { name: 'Flash Cards', icon: 'cards',  desc: 'Flip through cards and mark what you know.' },
    notemon: { name: 'Notemon',     icon: 'swords', desc: 'Battle and catch monsters by answering questions.' },
    match:   { name: 'Match',       icon: 'grid',   desc: 'Memory game: pair terms with their answers.' },
    blitz:   { name: 'Blitz',       icon: 'zap',    desc: '60-second speed round with streak multipliers.' },
  };
  const THEMES = {
    midnight: { name: 'Midnight', swatch: ['#0f1020', '#8b7cff', '#ff7ce5'] },
    ocean:    { name: 'Ocean',    swatch: ['#061a2b', '#2dd4f5', '#5eead4'] },
    forest:   { name: 'Forest',   swatch: ['#0d1f14', '#7ee787', '#f5d76e'] },
    sunset:   { name: 'Sunset',   swatch: ['#2a0f2e', '#ff9e5e', '#ff5e8a'] },
    candy:    { name: 'Candy',    swatch: ['#fff0f7', '#ff4fa3', '#7c5cff'] },
    paper:    { name: 'Paper',    swatch: ['#f6f1e7', '#c2410c', '#0e7490'] },
  };
  const MODELS = [
    ['claude-opus-5', 'Claude Opus 5 (default, best quality)'],
    ['claude-sonnet-5', 'Claude Sonnet 5 (cheaper, faster)'],
    ['claude-fable-5-1', 'Claude Fable 5.1 (most capable, most expensive)'],
  ];
  const COLORS = ['#8b7cff', '#2dd4f5', '#7ee787', '#ff9e5e', '#ff4fa3', '#f5d76e', '#5eead4', '#ff5c7a', '#a3e635', '#fb923c', '#60a5fa', '#c084fc'];

  const settings = () => Object.assign({ model: 'claude-opus-5', theme: 'midnight' }, Store.settings.get());
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const localDay = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const rnd = n => Math.floor(Math.random() * n);

  // ---------- users / accounts (stored on this device only) ----------
  const users = () => Store.users.list();
  function currentUser() {
    if (Cloud.enabled()) return Cloud.profile();
    const id = Store.users.currentId(); return users().find(u => u.id === id) || null;
  }
  function saveUser(u) {
    if (u && u.cloud) { Cloud.saveProfile(u); return; }
    const list = users(); const i = list.findIndex(x => x.id === u.id); if (i >= 0) list[i] = u; else list.push(u); Store.users.save(list);
  }
  // Creations: local store first, then the cloud copy (without audio blobs) when signed in to a cloud account.
  async function putC(c) { c.updatedAt = Date.now(); await Store.put(c); const me = Cloud.enabled() && Cloud.profile(); if (me && c.owner === me.id) Cloud.pushCreation(c); }
  async function delC(id) { await Store.del(id); if (Cloud.enabled() && Cloud.profile()) Cloud.deleteCreation(id); }
  // After a cloud login: merge the account's sets from the cloud into this device, and push any local ones it lacks.
  async function syncDown(p) {
    try {
      const remote = await Cloud.pullCreations();
      const ids = new Set(remote.map(r => r.id));
      for (const r of remote) {
        const local = await Store.get(r.id);
        if (!local || (r.updatedAt || 0) > (local.updatedAt || 0)) await Store.put(Object.assign({}, r, { audioClips: (local && local.audioClips) || {} }));
      }
      for (const c of await Store.all()) if (c.owner === p.id && !ids.has(c.id)) Cloud.pushCreation(c);
    } catch (e) { toast('Could not sync your sets: ' + (e.message || e), 5000); }
  }
  function newUser(name, avatar) {
    return { id: uid(), name, avatar, createdAt: Date.now(), activeDays: [],
      stats: { quizzes: 0, quizPctTotal: 0, quizBest: 0, cardsStudied: 0, flashRuns: 0, monstersCaught: 0, notemonWins: 0, matchGames: 0, matchBest: null, blitzBest: 0, blitzGames: 0, xp: 0 } };
  }
  function streak(u) {
    const set = new Set(u.activeDays || []); let n = 0; const d = new Date();
    if (!set.has(localDay(d))) d.setDate(d.getDate() - 1);
    while (set.has(localDay(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const level = xp => Math.floor(Math.sqrt(xp / 50)) + 1;
  const xpForLevel = l => (l - 1) * (l - 1) * 50;
  const avatarHTML = (u, cls = '') => Icons.avatar(u.avatar || {}, cls);
  const mine = (list, u) => list.filter(c => !c.owner || c.owner === u.id).sort((a, b) => b.createdAt - a.createdAt);

  // Record a finished game/quiz on both the creation and the user.
  async function onDone(c, r) {
    const u = currentUser(); if (!u) return;
    const s = u.stats; c.stats = c.stats || {};
    const day = localDay(); u.activeDays = u.activeDays || []; if (!u.activeDays.includes(day)) u.activeDays.push(day);
    switch (r.type) {
      case 'flash': c.stats.flashRuns = (c.stats.flashRuns || 0) + 1; s.flashRuns++; s.cardsStudied += r.cards; s.xp += r.cards * 2; break;
      case 'notemon': c.stats.notemonBest = Math.max(c.stats.notemonBest || 0, r.caught); s.monstersCaught += r.caught; if (r.won) s.notemonWins++; s.xp += r.caught * 15 + (r.won ? 50 : 0); break;
      case 'match': c.stats.matchBest = c.stats.matchBest == null ? r.moves : Math.min(c.stats.matchBest, r.moves); s.matchGames++; s.matchBest = s.matchBest == null ? r.moves : Math.min(s.matchBest, r.moves); s.xp += 30; break;
      case 'blitz': c.stats.blitzBest = Math.max(c.stats.blitzBest || 0, r.score); s.blitzGames++; s.blitzBest = Math.max(s.blitzBest, r.score); s.xp += Math.round(r.score / 20); break;
      case 'quiz': c.stats.quizBest = Math.max(c.stats.quizBest || 0, r.pct); s.quizzes++; s.quizPctTotal += r.pct; s.quizBest = Math.max(s.quizBest, r.pct); s.xp += r.score * 10; break;
      case 'lecture': c.stats.lectures = (c.stats.lectures || 0) + 1; s.lectures = (s.lectures || 0) + 1; s.xp += 20; break;
    }
    await putC(c); saveUser(u); renderChrome();
  }

  // ---------- helpers ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
  }
  function applyTheme(t) { document.body.dataset.theme = THEMES[t] ? t : 'midnight'; }
  function setNav(name) { document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name)); }
  const swatchHTML = t => `<span class="swatch">${t.swatch.map(col => `<i style="background:${col}"></i>`).join('')}</span>`;

  // Simple modal: resolves with the chosen value, input text, true (OK) or null (cancel).
  function modal({ title, body, options, current, okText = 'OK', onOpen }) {
    return new Promise(resolve => {
      const m = document.getElementById('modal');
      m.hidden = false;
      m.innerHTML = `<div class="modal-card">
        <h3>${esc(title)}</h3>
        ${body || ''}
        ${options ? `<div class="opt-list">${options.map(o => `<button class="opt ${o.value === current ? 'active' : ''}" data-v="${esc(o.value)}">${o.icon ? `<span class="opt-icon">${o.icon}</span>` : ''}<span><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span></button>`).join('')}</div>` : ''}
        <div class="row right"><button class="btn ghost" id="m-cancel">Cancel</button>${options ? '' : `<button class="btn primary" id="m-ok">${esc(okText)}</button>`}</div>
      </div>`;
      const close = v => { m.hidden = true; m.innerHTML = ''; resolve(v); };
      m.onclick = e => { if (e.target === m) close(null); };
      m.querySelector('#m-cancel').onclick = () => close(null);
      m.querySelectorAll('.opt').forEach(b => b.onclick = () => close(b.dataset.v));
      const ok = m.querySelector('#m-ok');
      if (ok) ok.onclick = () => { const inp = m.querySelector('input.input'); close(inp ? inp.value : true); };
      const inp = m.querySelector('input.input'); if (inp) { inp.focus(); inp.select(); inp.onkeydown = e => { if (e.key === 'Enter') ok.click(); }; }
      if (onOpen) onOpen(m, close);
    });
  }

  // Avatar picker (creature + colour). Resolves with {kind, color} or null.
  function pickAvatar(current) {
    let kind = current?.kind ?? 0, color = current?.color || COLORS[0];
    return modal({
      title: 'Choose your avatar', okText: 'Save',
      body: `<div class="avatar-preview" id="av-prev">${Icons.avatar({ kind, color }, 'xl')}</div>
        <div class="kind-grid">${Icons.KINDS.map((k, i) => `<button type="button" class="kind-pick ${i === kind ? 'active' : ''}" data-k="${i}" title="${esc(k.name)}">${Icons.avatar({ kind: i, color }, 'md')}<small>${esc(k.name)}</small></button>`).join('')}</div>
        <div class="color-row">${COLORS.map(c => `<button type="button" class="color-pick ${c === color ? 'active' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`,
      onOpen(m) {
        const refresh = () => {
          m.querySelector('#av-prev').innerHTML = Icons.avatar({ kind, color }, 'xl');
          m.querySelectorAll('.kind-pick').forEach(b => { b.classList.toggle('active', +b.dataset.k === kind); b.querySelector('svg').outerHTML = Icons.avatar({ kind: +b.dataset.k, color }, 'md'); });
          m.querySelectorAll('.color-pick').forEach(b => b.classList.toggle('active', b.dataset.c === color));
        };
        m.querySelectorAll('.kind-pick').forEach(b => b.onclick = () => { kind = +b.dataset.k; refresh(); });
        m.querySelectorAll('.color-pick').forEach(b => b.onclick = () => { color = b.dataset.c; refresh(); });
      },
    }).then(v => v ? { kind, color } : null);
  }

  // ---------- chrome: top bar + sidebar ----------
  const sidebar = document.getElementById('sidebar'), backdrop = document.getElementById('backdrop');
  function openDrawer(open) { sidebar.classList.toggle('open', open); backdrop.hidden = !open; }
  document.getElementById('menuBtn').onclick = () => openDrawer(!sidebar.classList.contains('open'));
  backdrop.onclick = () => openDrawer(false);
  sidebar.addEventListener('click', e => { if (e.target.closest('a')) openDrawer(false); });

  function renderChrome() {
    const u = currentUser();
    const top = document.getElementById('topRight');
    document.body.classList.toggle('logged-out', !u);
    if (!u) {
      top.innerHTML = `<a class="btn ghost" href="#login" id="top-login">Log in</a><a class="btn primary" href="#signup">Sign up</a>`;
      top.querySelector('#top-login').onclick = () => { loginTarget = null; };
      document.getElementById('sideUser').innerHTML = '';
      return;
    }
    top.innerHTML = `<details class="menu user-menu"><summary class="user-chip">${avatarHTML(u, 'sm')}<span>${esc(u.name)}</span>${I('chevronDown', 'chev')}</summary>
      <div class="menu-list">
        <a href="#home">${I('user')} My profile</a>
        <a href="#settings">${I('settings')} Account settings</a>
        <button id="switch-acc">${I('switch')} Switch account</button>
        <button id="logout" class="danger">${I('logout')} Log out</button>
      </div></details>`;
    const menu = top.querySelector('details');
    menu.querySelectorAll('a').forEach(a => a.onclick = () => { menu.open = false; });
    top.querySelector('#logout').onclick = () => { menu.open = false; logout(false); };
    top.querySelector('#switch-acc').onclick = () => { menu.open = false; logout(true); };
    const xp = u.stats.xp, lv = level(xp);
    document.getElementById('sideUser').innerHTML = `<a href="#home" class="side-user-link">${avatarHTML(u, 'md')}<div><b>${esc(u.name)}</b><small>Level ${lv} · ${xp} XP</small></div></a>`;
  }
  document.addEventListener('click', e => { document.querySelectorAll('details.user-menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); });

  async function logout(switching) {
    const u = currentUser(); if (!u) return;
    if (!switching) {
      const v = await modal({ title: `Log out of ${u.name}?`, okText: 'Log out', body: '<p>Your progress is saved on this device. You will need your password to log back in.</p>' });
      if (!v) return;
    }
    if (Cloud.enabled()) await Cloud.signOut();
    Store.users.setCurrent(null);
    loginTarget = null;
    toast(switching ? 'Choose an account to continue' : `Logged out. See you soon, ${u.name}.`);
    location.hash = '#login'; route();
  }

  // ---------- router ----------
  let cleanup = null;
  function route() {
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    const [path, id] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    openDrawer(false);
    renderChrome();
    const u = currentUser();
    if (!u) {
      applyTheme(settings().theme); setNav('');
      return renderAuth(path === 'signup' ? 'signup' : 'login');
    }
    switch (path) {
      case 'login': return renderAuth('login');
      case 'signup': return renderAuth('signup');
      case 'creations': applyTheme(settings().theme); setNav('creations'); return renderCreations();
      case 'create': applyTheme(createState.theme); setNav('create'); return renderCreate();
      case 'settings': applyTheme(settings().theme); setNav('settings'); return renderSettings();
      case 'study': setNav(''); return renderPlay(id, null);
      case 'quiz': setNav(''); return renderPlay(id, 'quiz');
      case 'lecture': setNav(''); return renderPlay(id, 'lecture');
      default: applyTheme(settings().theme); setNav('home'); return renderHome();
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- auth helpers (local accounts, passwords stored as salted PBKDF2 hashes) ----------
  const enc = s => new TextEncoder().encode(s);
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const Auth = {
    salt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); },
    async hash(secret, salt) {
      if (crypto.subtle) {
        const key = await crypto.subtle.importKey('raw', enc(secret), 'PBKDF2', false, ['deriveBits']);
        return 'pbkdf2:' + hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc(salt), iterations: 100000 }, key, 256));
      }
      // Fallback for insecure contexts (file://) where Web Crypto is unavailable.
      let h = 0x811c9dc5; const s = salt + ':' + secret;
      for (let r = 0; r < 20000; r++) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return 'fnv:' + h.toString(16);
    },
    async setPassword(u, pw) { u.salt = this.salt(); u.passHash = await this.hash(pw, u.salt); u.passwordChangedAt = Date.now(); },
    async verify(u, pw) { return !!u.passHash && (await this.hash(pw, u.salt)) === u.passHash; },
    async setRecovery(u, q, a) { u.recoveryQ = q; u.recoverySalt = this.salt(); u.recoveryHash = await this.hash(a.trim().toLowerCase(), u.recoverySalt); },
    async checkRecovery(u, a) { return !!u.recoveryHash && (await this.hash(a.trim().toLowerCase(), u.recoverySalt)) === u.recoveryHash; },
    strength(pw) {
      if (!pw) return 0; if (pw.length < 8) return 1;
      let s = 1; if (pw.length >= 12) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^\w\s]/.test(pw)) s++;
      return Math.min(4, s);
    },
  };
  const STRENGTH = ['', 'Too short', 'Weak', 'Good', 'Strong'];
  const QUESTIONS = ['What was the name of your first pet?', 'What street did you grow up on?', 'What was your first school called?', 'What is your favourite food?', 'What city were you born in?', 'What is your favourite teacher\'s last name?'];
  const MAX_ATTEMPTS = 5, LOCK_MS = 30000;
  const attempts = {}; // in-memory lockout per account: id -> { n, until }
  let loginTarget = null; // account chosen on the login screen

  function relTime(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    const d = Math.round(h / 24); if (d < 30) return d + ' day' + (d === 1 ? '' : 's') + ' ago';
    return new Date(ts).toLocaleDateString();
  }
  const pwField = (id, label, extra = '') => `<label class="field"><span>${label}</span><div class="pw-wrap"><input class="input" id="${id}" type="password" autocomplete="${id === 'pw' || id === 'cur' ? 'current-password' : 'new-password'}" ${extra}><button type="button" class="pw-eye" data-eye="${id}" aria-label="Show password">${I('eye')}${I('eyeOff')}</button></div></label>`;
  const strengthHTML = id => `<div class="strength" id="${id}" data-level="0"><i></i><span></span></div>`;
  const questionHTML = (id, current) => `<label class="field"><span>Security question <small>(used to reset a forgotten password)</small></span><select class="input" id="${id}">${QUESTIONS.map(q => `<option ${q === current ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select></label>`;
  function wireEyes(root) { root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = root.querySelector('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.classList.toggle('on', i.type === 'text'); i.focus(); }); }
  function wireStrength(input, meter) { const upd = () => { const s = Auth.strength(input.value); meter.dataset.level = s; meter.querySelector('span').textContent = STRENGTH[s]; }; input.addEventListener('input', upd); upd(); }
  function showErr(root, text) {
    const err = root.querySelector('.error'); err.hidden = false; err.textContent = text;
    const card = root.querySelector('.auth-card, .modal-card'); if (card) { card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 400); }
  }
  function checkPasswords(root, newId, confId) {
    const n = root.querySelector('#' + newId).value;
    if (n.length < 8) return 'Password needs at least 8 characters.';
    if (n !== root.querySelector('#' + confId).value) return 'Passwords do not match.';
    return null;
  }
  function locked(u) { const a = attempts[u.id]; return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0; }
  function failAttempt(u) {
    const a = attempts[u.id] || (attempts[u.id] = { n: 0, until: 0 });
    a.n++;
    if (a.n >= MAX_ATTEMPTS) { a.until = Date.now() + LOCK_MS; a.n = 0; return `Too many wrong attempts. Locked for ${LOCK_MS / 1000} seconds.`; }
    const left = MAX_ATTEMPTS - a.n;
    return `Wrong password. ${left} attempt${left === 1 ? '' : 's'} left.`;
  }
  function finishLogin(u, stay, msg) {
    u.lastLogin = Date.now(); saveUser(u); delete attempts[u.id];
    Store.users.setCurrent(u.id, stay); loginTarget = null;
    toast(msg || `Welcome back, ${u.name}.`); location.hash = '#home'; route();
  }
  const authShell = inner => `<section class="auth"><div class="auth-card">${inner}</div></section>`;

  // ---------- auth screens ----------
  function renderAuth(kind) {
    setNav('');
    if (Cloud.enabled()) return kind === 'signup' ? renderCloudSignup() : kind === 'reset' ? renderCloudReset() : renderCloudLogin();
    const list = users();
    if (kind === 'signup') return renderSignup(list);
    if (!list.length) return renderLocalEmpty();
    const target = list.find(u => u.id === loginTarget);
    if (kind === 'reset' && target) return renderReset(target);
    if (target) return target.passHash ? renderPassword(target) : renderFinishSetup(target);
    app.innerHTML = authShell(`
      <div class="auth-logo">${I('logo')}</div>
      <h1>Welcome back</h1>
      <p class="hint">Choose your account to log in.</p>
      <div class="account-list">${list.map(u => `<button class="account" data-id="${u.id}">${avatarHTML(u, 'md')}<span><b>${esc(u.name)}</b><small>Level ${level(u.stats.xp)} · ${u.stats.xp} XP${u.lastLogin ? ' · last login ' + relTime(u.lastLogin) : ''}</small></span>${I('chevronRight', 'chev')}</button>`).join('')}</div>
      <p class="hint">New here? <a href="#signup">Create an account</a></p>`);
    app.querySelectorAll('.account').forEach(b => b.onclick = () => { loginTarget = b.dataset.id; renderAuth('login'); });
  }

  function renderPassword(u) {
    app.innerHTML = authShell(`
      ${avatarHTML(u, 'xl')}
      <h1>Hi, ${esc(u.name)}</h1>
      <p class="hint">Enter your password to continue.</p>
      <form class="auth-form" id="f">
        ${pwField('pw', 'Password')}
        <label class="check"><input type="checkbox" id="stay" checked> Stay signed in on this device</label>
        <div class="error" hidden></div>
        <button class="btn primary big wide" type="submit">${I('lock')} Log in</button>
      </form>
      <p class="hint"><a href="#" id="forgot">Forgot password?</a> · <a href="#" id="switch">Not you? Choose another account</a></p>`);
    wireEyes(app);
    const pw = app.querySelector('#pw'); pw.focus();
    app.querySelector('#f').onsubmit = async e => {
      e.preventDefault();
      const secs = locked(u); if (secs) return showErr(app, `Too many attempts. Try again in ${secs}s.`);
      if (!pw.value) return showErr(app, 'Enter your password.');
      if (!(await Auth.verify(u, pw.value))) { pw.value = ''; return showErr(app, failAttempt(u)); }
      finishLogin(u, app.querySelector('#stay').checked);
    };
    app.querySelector('#forgot').onclick = e => { e.preventDefault(); renderAuth('reset'); };
    app.querySelector('#switch').onclick = e => { e.preventDefault(); loginTarget = null; renderAuth('login'); };
  }

  function renderReset(u) {
    if (!u.recoveryQ) {
      app.innerHTML = authShell(`${avatarHTML(u, 'xl')}<h1>Can't reset password</h1>
        <p class="hint">This account has no security question, so the password can't be reset. If you have a backup export, delete this account and import it again.</p>
        <p class="hint"><a href="#" id="back">Back to log in</a></p>`);
      app.querySelector('#back').onclick = e => { e.preventDefault(); renderAuth('login'); };
      return;
    }
    app.innerHTML = authShell(`
      ${avatarHTML(u, 'xl')}
      <h1>Reset password</h1>
      <p class="hint">Answer your security question to choose a new password.</p>
      <form class="auth-form" id="f">
        <label class="field"><span>${esc(u.recoveryQ)}</span><input class="input" id="ans" autocomplete="off"></label>
        ${pwField('new', 'New password')}${strengthHTML('str')}
        ${pwField('conf', 'Confirm new password')}
        <div class="error" hidden></div>
        <button class="btn primary big wide" type="submit">Reset password</button>
      </form>
      <p class="hint"><a href="#" id="back">Back to log in</a></p>`);
    wireEyes(app); wireStrength(app.querySelector('#new'), app.querySelector('#str'));
    app.querySelector('#ans').focus();
    app.querySelector('#f').onsubmit = async e => {
      e.preventDefault();
      const secs = locked(u); if (secs) return showErr(app, `Too many attempts. Try again in ${secs}s.`);
      if (!(await Auth.checkRecovery(u, app.querySelector('#ans').value))) return showErr(app, failAttempt(u).replace('Wrong password', 'Wrong answer'));
      const bad = checkPasswords(app, 'new', 'conf'); if (bad) return showErr(app, bad);
      await Auth.setPassword(u, app.querySelector('#new').value); saveUser(u); delete attempts[u.id];
      toast('Password reset. Log in with your new password.');
      renderAuth('login');
    };
    app.querySelector('#back').onclick = e => { e.preventDefault(); renderAuth('login'); };
  }

  // Accounts created before passwords existed: set one up on first login.
  function renderFinishSetup(u) {
    app.innerHTML = authShell(`
      ${avatarHTML(u, 'xl')}
      <h1>Finish setting up, ${esc(u.name)}</h1>
      <p class="hint">Your account was created without a password. Add one to keep your progress safe.</p>
      <form class="auth-form" id="f">
        ${pwField('new', 'Password')}${strengthHTML('str')}
        ${pwField('conf', 'Confirm password')}
        ${questionHTML('q')}
        <label class="field"><span>Answer</span><input class="input" id="ans" autocomplete="off" maxlength="60"></label>
        <label class="check"><input type="checkbox" id="stay" checked> Stay signed in on this device</label>
        <div class="error" hidden></div>
        <button class="btn primary big wide" type="submit">Save and log in</button>
      </form>
      <p class="hint"><a href="#" id="switch">Not you? Choose another account</a></p>`);
    wireEyes(app); wireStrength(app.querySelector('#new'), app.querySelector('#str'));
    app.querySelector('#new').focus();
    app.querySelector('#f').onsubmit = async e => {
      e.preventDefault();
      const bad = checkPasswords(app, 'new', 'conf'); if (bad) return showErr(app, bad);
      const ans = app.querySelector('#ans').value.trim(); if (ans.length < 2) return showErr(app, 'Answer your security question (at least 2 characters).');
      await Auth.setPassword(u, app.querySelector('#new').value);
      await Auth.setRecovery(u, app.querySelector('#q').value, ans);
      finishLogin(u, app.querySelector('#stay').checked, `All set. Welcome back, ${u.name}.`);
    };
    app.querySelector('#switch').onclick = e => { e.preventDefault(); loginTarget = null; renderAuth('login'); };
  }

  function renderSignup(list) {
    let avatar = { kind: rnd(Icons.KINDS.length), color: COLORS[rnd(COLORS.length)] };
    app.innerHTML = authShell(`
      <div class="auth-logo">${I('logo')}</div>
      <h1>Create your account</h1>
      <p class="hint">Your account lives on this device. Nothing is sent to a server.</p>
      <button type="button" class="avatar-btn" id="pick"><span id="av">${Icons.avatar(avatar, 'xl')}</span><small>Tap to change avatar</small></button>
      <form class="auth-form" id="f">
        <label class="field"><span>Username</span><input class="input" id="uname" placeholder="2–24 letters, numbers, . _ -" maxlength="24" autocomplete="username"></label>
        ${pwField('new', 'Password')}${strengthHTML('str')}
        ${pwField('conf', 'Confirm password')}
        ${questionHTML('q')}
        <label class="field"><span>Answer</span><input class="input" id="ans" autocomplete="off" maxlength="60"></label>
        <label class="check"><input type="checkbox" id="stay" checked> Stay signed in on this device</label>
        <div class="error" hidden></div>
        <button class="btn primary big wide" type="submit">Create account</button>
      </form>
      ${list.length ? '<p class="hint">Already have an account? <a href="#login" id="to-login">Log in</a></p>' : ''}`);
    wireEyes(app); wireStrength(app.querySelector('#new'), app.querySelector('#str'));
    const nameEl = app.querySelector('#uname'); nameEl.focus();
    app.querySelector('#pick').onclick = async () => { const a = await pickAvatar(avatar); if (a) { avatar = a; app.querySelector('#av').innerHTML = Icons.avatar(avatar, 'xl'); } };
    const toLogin = app.querySelector('#to-login'); if (toLogin) toLogin.onclick = () => { loginTarget = null; };
    app.querySelector('#f').onsubmit = async e => {
      e.preventDefault();
      const name = nameEl.value.trim();
      if (!/^[\w.-]{2,24}$/.test(name)) return showErr(app, 'Username must be 2–24 characters: letters, numbers, dots, dashes or underscores.');
      if (list.some(u => u.name.toLowerCase() === name.toLowerCase())) return showErr(app, 'That username is already taken on this device.');
      const bad = checkPasswords(app, 'new', 'conf'); if (bad) return showErr(app, bad);
      const ans = app.querySelector('#ans').value.trim(); if (ans.length < 2) return showErr(app, 'Answer your security question (at least 2 characters).');
      const u = newUser(name, avatar);
      await Auth.setPassword(u, app.querySelector('#new').value);
      await Auth.setRecovery(u, app.querySelector('#q').value, ans);
      finishLogin(u, app.querySelector('#stay').checked, `Welcome to NoteQuest, ${u.name}.`);
    };
  }

  // ---------- cloud accounts (Firebase, username based) ----------
  function renderCloudLogin() {
    app.innerHTML = authShell(`
      <div class="auth-logo">${I('logo')}</div>
      <h1>Welcome back</h1>
      <p class="hint">Log in with your username (or email) and password. Your account works on every device.</p>
      <form class="auth-form" id="f">
        <label class="field"><span>Username or email</span><input class="input" id="login" autocomplete="username" maxlength="80"></label>
        ${pwField('pw', 'Password')}
        <label class="check"><input type="checkbox" id="stay" checked> Stay signed in on this device</label>
        <div class="error" hidden></div>
        <button class="btn primary big wide" type="submit">${I('lock')} Log in</button>
      </form>
      <p class="hint"><a href="#" id="forgot">Forgot password?</a> · New here? <a href="#signup">Create an account</a></p>`);
    wireEyes(app); app.querySelector('#login').focus();
    app.querySelector('#f').onsubmit = async e => {
      e.preventDefault();
      const login = app.querySelector('#login').value.trim(), pw = app.querySelector('#pw').value;
      if (!login) return showErr(app, 'Enter your username.');
      if (!pw) return showErr(app, 'Enter your password.');
      const btn = app.querySelector('button[type=submit]'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Logging in…';
      try {
        const p = await Cloud.signIn({ login, password: pw, stay: app.querySelector('#stay').checked });
        toast('Syncing your sets…', 3000); await syncDown(p); await adoptLocalSets(p);
        toast(p.recoveryQ ? `Welcome back, ${p.name}.` : `Welcome back, ${p.name}. Set a security question in Settings so you can reset your password.`, p.recoveryQ ? 2600 : 7000);
        location.hash = '#home'; route();
      } catch (err) { btn.disabled = false; btn.innerHTML = `${I('lock')} Log in`; showErr(app, err.message); }
    };
    app.querySelector('#forgot').onclick = e => { e.preventDefault(); renderCloudReset(app.querySelector('#login').value.trim()); };
  }

  function renderCloudSignup() {
    let avatar = { kind: rnd(Icons.KINDS.length), color: COLORS[rnd(COLORS.length)] };
    app.innerHTML = authShell(`
      <div class="auth-logo">${I('logo')}</div>
      <h1>Create your account</h1>
      <p class="hint">One account for all your devices. Your security question resets a forgotten password; email is optional.</p>
      <button type="button" class="avatar-btn" id="pick"><span id="av">${Icons.avatar(avatar, 'xl')}</span><small>Tap to change avatar</small></button>
      <form class="auth-form" id="f">
        <label class="field"><span>Username</span><input class="input" id="uname" placeholder="2–24 letters, numbers, . _ -" maxlength="24" autocomplete="username"></label>
        ${pwField('new', 'Password')}${strengthHTML('str')}
        ${pwField('conf', 'Confirm password')}
        ${questionHTML('q')}
        <label class="field"><span>Answer</span><input class="input" id="ans" autocomplete="off" maxlength="60"></label>
        <label class="field"><span>Email <small>(optional, for reset links)</small></span><input class="input" id="email" type="email" autocomplete="email"></label>
        <label class="check"><input type="checkbox" id="stay" checked> Stay signed in on this device</label>
        <div class="error" hidden></div>
        <button class="btn primary big wide" type="submit">Create account</button>
      </form>
      <p class="hint">Already have an account? <a href="#login">Log in</a></p>`);
    wireEyes(app); wireStrength(app.querySelector('#new'), app.querySelector('#str'));
    app.querySelector('#uname').focus();
    app.querySelector('#pick').onclick = async () => { const a = await pickAvatar(avatar); if (a) { avatar = a; app.querySelector('#av').innerHTML = Icons.avatar(avatar, 'xl'); } };
    app.querySelector('#f').onsubmit = async e => {
      e.preventDefault();
      const name = app.querySelector('#uname').value.trim(), email = app.querySelector('#email').value.trim();
      if (!/^[\w.-]{2,24}$/.test(name)) return showErr(app, 'Username must be 2–24 characters: letters, numbers, dots, dashes or underscores.');
      if (email && !Cloud.isEmail(email)) return showErr(app, 'That email address does not look right (or leave it empty).');
      const bad = checkPasswords(app, 'new', 'conf'); if (bad) return showErr(app, bad);
      const ans = app.querySelector('#ans').value.trim(); if (ans.length < 2) return showErr(app, 'Answer your security question (at least 2 characters).');
      const btn = app.querySelector('button[type=submit]'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…';
      try {
        const p = await Cloud.signUp({ username: name, email, password: app.querySelector('#new').value, avatar, securityQ: app.querySelector('#q').value, securityA: ans, stay: app.querySelector('#stay').checked, newUser });
        await adoptLocalSets(p);
        toast(`Welcome to NoteQuest, ${p.name}.`); location.hash = '#home'; route();
      } catch (err) { btn.disabled = false; btn.innerHTML = 'Create account'; showErr(app, err.message); }
    };
  }

  function renderCloudReset(prefill = '') {
    let info = null, username = prefill;
    const draw = () => {
      app.innerHTML = authShell(`
        <div class="auth-logo">${I('logo')}</div>
        <h1>Reset password</h1>
        <p class="hint">${info ? (info.question ? 'Answer your security question to choose a new password.' : 'This account has no security question.') : 'Enter your username to continue.'}</p>
        <form class="auth-form" id="f">
          <label class="field"><span>Username</span><input class="input" id="uname" value="${esc(username)}" autocomplete="username" ${info ? 'readonly' : ''}></label>
          ${info && info.question ? `<label class="field"><span>${esc(info.question)}</span><input class="input" id="ans" autocomplete="off"></label>${pwField('new', 'New password')}${strengthHTML('str')}${pwField('conf', 'Confirm new password')}` : ''}
          <div class="error" hidden></div>
          ${info && info.question ? `<button class="btn primary big wide" type="submit">Reset password</button>` : info ? '' : `<button class="btn primary big wide" type="submit">Continue</button>`}
        </form>
        ${info && info.realEmail ? `<p class="hint">Or <a href="#" id="mail">email a reset link to ${esc(info.email)}</a></p>` : ''}
        <p class="hint"><a href="#" id="back">Back to log in</a></p>`);
      wireEyes(app); if (info && info.question) wireStrength(app.querySelector('#new'), app.querySelector('#str'));
      (info && info.question ? app.querySelector('#ans') : app.querySelector('#uname')).focus();
      app.querySelector('#back').onclick = e => { e.preventDefault(); renderCloudLogin(); };
      const mail = app.querySelector('#mail'); if (mail) mail.onclick = async e => { e.preventDefault(); try { await Cloud.resetByEmail(username); toast('Reset email sent. Check your inbox (and spam).', 6000); renderCloudLogin(); } catch (err) { showErr(app, err.message); } };
      app.querySelector('#f').onsubmit = async e => {
        e.preventDefault();
        username = app.querySelector('#uname').value.trim();
        if (!username) return showErr(app, 'Enter your username.');
        try {
          if (!info) { info = await Cloud.recoveryInfo(username); return draw(); }
          const bad = checkPasswords(app, 'new', 'conf'); if (bad) return showErr(app, bad);
          const btn = app.querySelector('button[type=submit]'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Resetting…';
          const p = await Cloud.resetByAnswer({ username, answer: app.querySelector('#ans').value, newPassword: app.querySelector('#new').value, stay: true });
          if (p) { await syncDown(p); toast('Password reset. You are logged in.'); location.hash = '#home'; route(); }
          else { toast('Password reset. Log in with your new password.'); renderCloudLogin(); }
        } catch (err) { const btn = app.querySelector('button[type=submit]'); if (btn) { btn.disabled = false; btn.innerHTML = info ? 'Reset password' : 'Continue'; } showErr(app, err.message); }
      };
    };
    draw();
  }

  // ---------- cloud account settings ----------
  function cloudChangePasswordFlow(u) {
    return modal({
      title: 'Change password', okText: 'Save',
      body: `${pwField('cur', 'Current password')}${pwField('new', 'New password')}${strengthHTML('str')}${pwField('conf', 'Confirm new password')}${u.recoveryQ ? `<label class="field"><span>${esc(u.recoveryQ)} <small>(keeps password recovery working)</small></span><input class="input" id="ans" autocomplete="off"></label>` : ''}<div class="error" hidden></div>`,
      onOpen(m, close) {
        wireEyes(m); wireStrength(m.querySelector('#new'), m.querySelector('#str'));
        const ok = m.querySelector('#m-ok');
        ok.onclick = async () => {
          const bad = checkPasswords(m, 'new', 'conf'); if (bad) return showErr(m, bad);
          const ans = m.querySelector('#ans'); if (ans && ans.value.trim().length < 2) return showErr(m, 'Answer your security question.');
          ok.disabled = true;
          try { await Cloud.changePassword(m.querySelector('#cur').value, m.querySelector('#new').value, ans ? ans.value : ''); close(true); } catch (err) { ok.disabled = false; showErr(m, err.message); }
        };
      },
    });
  }
  function cloudQuestionFlow(u) {
    return modal({
      title: 'Security question', okText: 'Save',
      body: `${questionHTML('q', u.recoveryQ)}<label class="field"><span>Answer</span><input class="input" id="ans" autocomplete="off" maxlength="60"></label>${pwField('cur', 'Confirm with your password')}<div class="error" hidden></div>`,
      onOpen(m, close) {
        wireEyes(m);
        const ok = m.querySelector('#m-ok');
        ok.onclick = async () => {
          const ans = m.querySelector('#ans').value.trim(); if (ans.length < 2) return showErr(m, 'Enter an answer (at least 2 characters).');
          ok.disabled = true;
          try { await Cloud.setSecurityQuestion(m.querySelector('#cur').value, m.querySelector('#q').value, ans); close(true); } catch (err) { ok.disabled = false; showErr(m, err.message); }
        };
      },
    });
  }
  function cloudEmailFlow(u) {
    return modal({
      title: u.email ? 'Change email' : 'Add an email', okText: 'Save',
      body: `<p class="hint">${u.email ? `Current: ${esc(u.email)}. ` : ''}A confirmation link is sent to the new address; the change applies when you open it.</p><label class="field"><span>New email</span><input class="input" id="email" type="email" autocomplete="email"></label>${pwField('cur', 'Confirm with your password')}<div class="error" hidden></div>`,
      onOpen(m, close) {
        wireEyes(m);
        const ok = m.querySelector('#m-ok');
        ok.onclick = async () => {
          ok.disabled = true;
          try { await Cloud.changeEmail(m.querySelector('#cur').value, m.querySelector('#email').value.trim()); close(true); } catch (err) { ok.disabled = false; showErr(m, err.message); }
        };
      },
    });
  }

  // Sets made on this device under a device-only account (or before accounts existed) can move into the cloud account.
  async function adoptLocalSets(p) {
    const all = await Store.all();
    const orphans = all.filter(c => c.owner !== p.id && !users().some(x => x.id === c.owner && x.cloud));
    if (!orphans.length) return;
    const v = await modal({ title: `Move ${orphans.length} set${orphans.length === 1 ? '' : 's'} into your account?`, okText: 'Move them', body: `<p>This device has study sets that are not in your cloud account yet (${esc(orphans.slice(0, 4).map(c => c.name).join(', '))}${orphans.length > 4 ? '…' : ''}). Move them so they follow you to other devices?</p>` });
    if (!v) return;
    for (const c of orphans) { c.owner = p.id; c.updatedAt = Date.now(); await Store.put(c); try { await Cloud.pushNow(c); } catch (e) { toast('Could not upload ' + c.name + ': ' + e.message); } }
    toast(`Moved ${orphans.length} set${orphans.length === 1 ? '' : 's'} into your account.`);
  }

  // Local mode on a device that has no accounts: explain, offer import, or create.
  function renderLocalEmpty() {
    app.innerHTML = authShell(`
      <div class="auth-logo">${I('logo')}</div>
      <h1>No accounts on this device yet</h1>
      <p class="hint">Accounts are stored on the device where they were made. Bring yours over from the other device, or create a new one here.</p>
      <label class="btn secondary big wide">${I('upload')} Import my account file <input type="file" id="imp" accept="application/json" hidden></label>
      <p class="hint">On your other device: Settings → Account → <b>Export account</b>. The file holds your profile, password (hashed) and study sets.</p>
      <a class="btn primary big wide" href="#signup">Create a new account</a>`);
    app.querySelector('#imp').onchange = async e => {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        const cur = users(); let nu = 0, nc = 0;
        for (const iu of (data.users || [])) if (iu && iu.id && !cur.some(x => x.id === iu.id)) { cur.push(iu); nu++; }
        Store.users.save(cur);
        for (const c of (data.creations || [])) if (c && c.id && Array.isArray(c.cards)) { await Store.put(c); nc++; }
        toast(`Imported ${nu} account${nu === 1 ? '' : 's'} and ${nc} set${nc === 1 ? '' : 's'}. Log in with your password.`, 5000);
        loginTarget = null; renderAuth('login');
      } catch (err) { toast('Import failed: ' + err.message); }
    };
  }
  function exportAccount(u) {
    Store.all().then(all => {
      const blob = new Blob([JSON.stringify({ notequest: 2, users: [u], creations: mine(all, u).map(c => { const { audioClips, ...rest } = c; return rest; }) })], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `notequest-account-${u.name}.json`; a.click();
      toast('Account file downloaded. Import it on the other device from the log-in screen.', 5000);
    });
  }

  // ---------- account management (used from Settings) ----------
  function changePasswordFlow(u) {
    return modal({
      title: 'Change password', okText: 'Save',
      body: `${pwField('cur', 'Current password')}${pwField('new', 'New password')}${strengthHTML('str')}${pwField('conf', 'Confirm new password')}<div class="error" hidden></div>`,
      onOpen(m, close) {
        wireEyes(m); wireStrength(m.querySelector('#new'), m.querySelector('#str'));
        const ok = m.querySelector('#m-ok');
        ok.onclick = async () => {
          if (!(await Auth.verify(u, m.querySelector('#cur').value))) return showErr(m, 'Current password is wrong.');
          const bad = checkPasswords(m, 'new', 'conf'); if (bad) return showErr(m, bad);
          await Auth.setPassword(u, m.querySelector('#new').value); saveUser(u); close(true);
        };
        m.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') ok.click(); });
      },
    });
  }
  function securityQuestionFlow(u) {
    return modal({
      title: 'Security question', okText: 'Save',
      body: `${questionHTML('q', u.recoveryQ)}<label class="field"><span>Answer</span><input class="input" id="ans" autocomplete="off" maxlength="60"></label>${pwField('cur', 'Confirm with your password')}<div class="error" hidden></div>`,
      onOpen(m, close) {
        wireEyes(m);
        const ok = m.querySelector('#m-ok');
        ok.onclick = async () => {
          const ans = m.querySelector('#ans').value.trim(); if (ans.length < 2) return showErr(m, 'Enter an answer (at least 2 characters).');
          if (!(await Auth.verify(u, m.querySelector('#cur').value))) return showErr(m, 'Password is wrong.');
          await Auth.setRecovery(u, m.querySelector('#q').value, ans); saveUser(u); close(true);
        };
        m.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') ok.click(); });
      },
    });
  }
  function confirmWithPassword(u, title, text, okText) {
    return modal({
      title, okText, body: `<p>${text}</p>${pwField('cur', 'Enter your password to confirm')}<div class="error" hidden></div>`,
      onOpen(m, close) {
        wireEyes(m);
        const ok = m.querySelector('#m-ok');
        ok.onclick = async () => { if (!(await Auth.verify(u, m.querySelector('#cur').value))) return showErr(m, 'Password is wrong.'); close(true); };
        m.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') ok.click(); });
      },
    });
  }

  // ---------- Home ----------
  async function renderHome() {
    const u = currentUser();
    const list = mine(await Store.all(), u);
    const s = u.stats, xp = s.xp, lv = level(xp), lo = xpForLevel(lv), hi = xpForLevel(lv + 1);
    const avg = s.quizzes ? Math.round(s.quizPctTotal / s.quizzes) : null;
    const st = streak(u);
    const stats = [
      ['library', list.length, 'sets created'],
      ['quiz', s.quizzes, 'quizzes taken'],
      ['target', avg == null ? '–' : avg + '%', 'avg quiz score'],
      ['cards', s.cardsStudied, 'cards studied'],
      ['swords', s.monstersCaught, 'monsters caught'],
      ['zap', s.blitzBest, 'blitz best'],
      ['grid', s.matchBest == null ? '–' : s.matchBest, 'match best (moves)'],
      ['lecture', s.lectures || 0, 'lectures heard'],
      ['flame', st, 'day streak'],
    ];
    app.innerHTML = `<section class="home">
      <div class="hero">
        <button type="button" class="avatar-btn" id="avatarBtn" title="Change avatar">${avatarHTML(u, 'xl')}</button>
        <div class="hero-text">
          <div class="name-row"><h1>${esc(u.name)}</h1><button class="icon-btn" id="editName" title="Change username">${I('pencil')}</button></div>
          <div class="level-row"><b>Level ${lv}</b><span class="xpbar"><i style="width:${Math.round((xp - lo) / (hi - lo) * 100)}%"></i></span><small>${xp - lo} / ${hi - lo} XP</small></div>
          <div class="hero-badges"><span class="badge">${I('flame')} ${st}-day streak</span>${s.notemonWins ? `<span class="badge">${I('trophy')} ${s.notemonWins} Notemon win${s.notemonWins === 1 ? '' : 's'}</span>` : ''}${s.quizBest ? `<span class="badge">${I('target')} best quiz ${s.quizBest}%</span>` : ''}</div>
        </div>
        <a class="btn primary big" href="#create">${I('sparkles')} New set</a>
      </div>

      <h2>Your stats</h2>
      <div class="stats-grid">${stats.map(([i, v, l]) => `<div class="stat-card"><span class="stat-ico">${I(i)}</span><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('')}</div>

      <div class="section-head"><h2>Recent notes</h2>${list.length ? `<a href="#creations">See all ${I('arrowRight')}</a>` : ''}</div>
      ${list.length ? `<div class="grid">${list.slice(0, 4).map(tileHTML).join('')}</div>`
        : `<div class="empty small"><p>No notes yet. Snap photos of your notes and Claude will turn them into a game.</p><div class="row center"><a class="btn primary" href="#create">${I('plus')} Create your first set</a><button class="btn ghost" id="sample">Load a sample</button></div></div>`}
    </section>`;
    app.querySelector('#avatarBtn').onclick = async () => { const a = await pickAvatar(u.avatar); if (a) { u.avatar = a; saveUser(u); renderChrome(); renderHome(); } };
    app.querySelector('#editName').onclick = () => renameFlow(u, renderHome);
    const smp = app.querySelector('#sample'); if (smp) smp.onclick = async () => { await putC(await sampleCreation(u)); toast('Sample added'); renderHome(); };
    wireTiles();
  }
  async function renameFlow(u, after) {
    const v = await modal({ title: 'Change username', okText: 'Save', body: `<input class="input" value="${esc(u.name)}" maxlength="24">` });
    if (v == null) return;
    const name = v.trim();
    if (!/^[\w.-]{2,24}$/.test(name)) return toast('Username must be 2–24 characters: letters, numbers, dots, dashes or underscores.', 4000);
    if (users().some(x => x.id !== u.id && x.name.toLowerCase() === name.toLowerCase())) return toast('That username is already taken on this device.');
    if (u.cloud) { try { await Cloud.changeUsername(name); } catch (err) { return toast(err.message, 4000); } }
    else { u.name = name; saveUser(u); }
    renderChrome(); after(); toast('Username updated');
  }

  // ---------- Your Creations ----------
  async function renderCreations() {
    const u = currentUser();
    const list = mine(await Store.all(), u);
    const s = settings();
    if (!list.length) {
      app.innerHTML = `<section class="empty">
        <div class="empty-ico">${I('library')}</div>
        <h1>Your creations</h1>
        <p>Nothing here yet. Snap some photos of your notes and let Claude turn them into a game.</p>
        <div class="row center"><a class="btn primary big" href="#create">${I('plus')} Create your first set</a><button class="btn ghost" id="sample">Load a sample</button></div>
        ${s.apiKey ? '' : '<p class="hint">You will need a Claude API key. Add it in <a href="#settings">Settings</a>.</p>'}
      </section>`;
      app.querySelector('#sample').onclick = async () => { await putC(await sampleCreation(u)); toast('Sample added'); renderCreations(); };
      return;
    }
    app.innerHTML = `<section>
      <div class="page-head"><h1>Your creations</h1><a class="btn primary" href="#create">${I('plus')} New</a></div>
      <div class="grid">${list.map(tileHTML).join('')}</div>
    </section>`;
    wireTiles();
  }
  function wireTiles() { app.querySelectorAll('[data-action]').forEach(b => b.onclick = e => tileAction(b.dataset.action, b.dataset.id, e)); }

  function tileHTML(c) {
    const m = MODES[c.mode] || MODES.flash;
    const st = c.stats || {};
    const best = [];
    if (st.quizBest != null) best.push(`Quiz best ${st.quizBest}%`);
    if (st.notemonBest) best.push(`Notemon ${st.notemonBest}/5`);
    if (st.blitzBest) best.push(`Blitz ${st.blitzBest}`);
    if (st.matchBest != null) best.push(`Match ${st.matchBest} moves`);
    if (st.lectures) best.push(`Lecture heard ${st.lectures}x`);
    const prepping = prep.get(c.id);
    const lectureNote = prepping ? `<span class="tile-prep"><span class="spinner"></span> ${esc(prepping.text)}</span>` : (c.lecture ? `<span class="tile-prep ok">${I('check')} Lecture ready</span>` : '');
    const cover = c.cover ? `style="background-image:url(${c.cover})"` : '';
    return `<article class="tile" data-theme="${esc(c.theme)}">
      <div class="tile-cover ${c.cover ? '' : 'no-img'}" ${cover}>${c.cover ? '' : `<span class="tile-ico">${I('book')}</span>`}<span class="tile-mode">${I(m.icon)} ${esc(m.name)}</span></div>
      <div class="tile-body">
        <div class="tile-title-row">
          <h2>${esc(c.name)}</h2>
          <details class="menu"><summary aria-label="More">${I('more')}</summary><div class="menu-list">
            <button data-action="mode" data-id="${c.id}">${I('gamepad')} Change game mode</button>
            <button data-action="theme" data-id="${c.id}">${I('palette')} Change theme</button>
            <button data-action="rename" data-id="${c.id}">${I('pencil')} Rename</button>
            <button data-action="view" data-id="${c.id}">${I('layers')} View cards</button>
            <button data-action="delete" data-id="${c.id}" class="danger">${I('trash')} Delete</button>
          </div></details>
        </div>
        <p class="tile-sub">${esc(c.subject || '')}</p>
        <p class="tile-meta">${c.cards.length} cards · ${c.questions.length} questions${best.length ? ' · ' + best.join(' · ') : ''}</p>
        ${lectureNote}
        <div class="row tile-actions">
          <a class="btn primary" href="#study/${c.id}">${I(m.icon)} Study</a>
          <a class="btn secondary" href="#quiz/${c.id}">${I('quiz')} Quiz</a>
          <a class="btn secondary" href="#lecture/${c.id}">${I('lecture')} Lecture</a>
        </div>
      </div>
    </article>`;
  }

  async function tileAction(action, id, e) {
    const details = e.target.closest('details'); if (details) details.open = false;
    const c = await Store.get(id); if (!c) return;
    const refresh = () => route();
    if (action === 'mode') {
      const v = await modal({ title: 'Game mode', current: c.mode, options: Object.entries(MODES).map(([k, m]) => ({ value: k, label: m.name, desc: m.desc, icon: I(m.icon) })) });
      if (v) { c.mode = v; await putC(c); refresh(); }
    } else if (action === 'theme') {
      const v = await modal({ title: 'Theme', current: c.theme, options: Object.entries(THEMES).map(([k, t]) => ({ value: k, label: t.name, icon: swatchHTML(t) })) });
      if (v) { c.theme = v; await putC(c); refresh(); }
    } else if (action === 'rename') {
      const v = await modal({ title: 'Rename', okText: 'Save', body: `<input class="input" value="${esc(c.name)}" maxlength="80">` });
      if (v && v.trim()) { c.name = v.trim(); await putC(c); refresh(); }
    } else if (action === 'view') {
      await modal({ title: c.name, okText: 'Close', body: `<div class="cardlist"><p class="summary">${esc(c.summary || '')}</p>${c.cards.map(k => `<div class="cardrow"><b>${esc(k.front)}</b><span>${esc(k.back)}</span></div>`).join('')}</div>` });
    } else if (action === 'delete') {
      const v = await modal({ title: `Delete "${c.name}"?`, okText: 'Delete', body: '<p>This cannot be undone.</p>' });
      if (v) { await delC(id); toast('Deleted'); refresh(); }
    }
  }

  // ---------- Create ----------
  const createState = { name: '', files: [], mode: 'flash', theme: settings().theme, busy: false, status: '', error: '', errorKind: '', errorLink: null };

  function renderCreate() {
    const s = settings();
    const st = createState;
    app.innerHTML = `<section class="create">
      <h1>Create a study set</h1>
      ${s.apiKey ? '' : '<div class="banner">No API key yet. Add your Claude API key in <a href="#settings">Settings</a> before generating.</div>'}

      <label class="field"><span>Name <small>(optional, Claude will title it otherwise)</small></span>
        <input class="input" id="name" placeholder="e.g. Chapter 4 – Cell Division" value="${esc(st.name)}" maxlength="80"></label>

      <div class="field"><span>Photos of your notes</span>
        <label class="dropzone" id="drop">
          <input type="file" id="files" accept="image/*" multiple hidden>
          <div class="drop-ico">${I('camera')}</div>
          <div><b>Tap to add photos</b><br><small>or drag &amp; drop · several pages at once is fine</small></div>
        </label>
        <div class="previews" id="previews"></div>
      </div>

      <div class="field"><span>Game mode</span>
        <div class="mode-grid">${Object.entries(MODES).map(([k, m]) => `
          <button type="button" class="mode-card ${st.mode === k ? 'active' : ''}" data-mode="${k}"><span class="mode-icon">${I(m.icon)}</span><b>${m.name}</b><small>${m.desc}</small></button>`).join('')}</div>
      </div>

      <div class="field"><span>Theme</span>
        <div class="theme-row">${Object.entries(THEMES).map(([k, t]) => `
          <button type="button" class="theme-chip ${st.theme === k ? 'active' : ''}" data-theme-pick="${k}">${swatchHTML(t)}<span>${t.name}</span></button>`).join('')}</div>
      </div>

      <div class="error ${st.errorKind === 'credits' ? 'credits' : ''}" id="error" ${st.error ? '' : 'hidden'}>${st.errorKind === 'credits' ? I('key') : ''}<div>${esc(st.error)}${st.errorLink ? ` <a class="btn primary small" href="${esc(st.errorLink)}" target="_blank" rel="noopener">Add credits</a>` : ''}${st.errorKind === 'auth' ? ' <a class="btn ghost small" href="#settings">Open Settings</a>' : ''}</div></div>
      <div class="row">
        <button class="btn primary big" id="go" ${st.busy ? 'disabled' : ''}>${st.busy ? '<span class="spinner"></span> ' + esc(st.status || 'Working…') : I('sparkles') + ' Generate with Claude'}</button>
      </div>
      <p class="hint">Photos are compressed in your browser and sent only to the Claude API. Nothing is uploaded anywhere else.</p>
    </section>`;

    const nameEl = app.querySelector('#name');
    nameEl.oninput = () => st.name = nameEl.value;
    const fileInput = app.querySelector('#files');
    fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
    const drop = app.querySelector('#drop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
    app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; app.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b)); });
    app.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => { st.theme = b.dataset.themePick; applyTheme(st.theme); app.querySelectorAll('[data-theme-pick]').forEach(x => x.classList.toggle('active', x === b)); });
    app.querySelector('#go').onclick = generate;
    renderPreviews();
  }
  function addFiles(list) {
    for (const f of list) if (f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)) createState.files.push(f);
    renderPreviews();
  }
  function renderPreviews() {
    const box = app.querySelector('#previews'); if (!box) return;
    box.innerHTML = createState.files.map((f, i) => `<div class="preview"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="x" data-rm="${i}" aria-label="Remove">${I('x')}</button><span>${i + 1}</span></div>`).join('');
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { createState.files.splice(+b.dataset.rm, 1); renderPreviews(); });
  }
  async function generate() {
    const st = createState, s = settings(), u = currentUser();
    st.error = ''; st.errorKind = ''; st.errorLink = null;
    if (!st.files.length) { st.error = 'Add at least one photo of your notes.'; return renderCreate(); }
    if (!s.apiKey) { st.error = 'Add your Claude API key in Settings first.'; return renderCreate(); }
    st.busy = true; st.status = 'Compressing photos…'; renderCreate();
    try {
      const images = [];
      for (const f of st.files) images.push(await API.toBase64(f));
      const cover = await API.thumbnail(st.files[0]);
      st.status = 'Reading your notes with Claude… (this can take a minute)'; renderCreate();
      const r = await API.generate({ images, name: st.name.trim(), mode: st.mode, apiKey: s.apiKey, model: s.model, onStatus: m => { st.status = m; renderCreate(); } });
      const c = sanitize(r, { name: st.name.trim(), mode: st.mode, theme: st.theme, cover, owner: u.id });
      await putC(c);
      u.stats.xp += 25; saveUser(u);
      st.files = []; st.name = ''; st.busy = false; st.status = '';
      toast(`Created "${c.name}" · ${c.cards.length} cards, ${c.questions.length} questions`, 4000);
      location.hash = '#creations';
      if (s.autoLecture !== false) prepareLecture(c);
    } catch (e) {
      st.busy = false; st.status = ''; st.error = e.message || String(e); st.errorKind = e.kind || ''; st.errorLink = e.link || null;
      renderCreate();
    }
  }
  function sanitize(r, meta) {
    const cards = (r.cards || []).filter(k => k && k.front && k.back).map(k => ({ front: String(k.front).trim(), back: String(k.back).trim() }));
    const questions = (r.questions || []).filter(q => q && q.question && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4)
      .map(q => ({ question: String(q.question).trim(), choices: q.choices.map(x => String(x).trim()), answer: q.answer, explanation: String(q.explanation || '').trim() }));
    const monsters = (r.monsters || []).filter(m => m && m.name).slice(0, 5).map(m => ({ name: String(m.name).trim() }));
    if (cards.length < 2) throw new Error('Claude could not find enough content in these photos. Try clearer or closer photos.');
    return {
      id: uid(), createdAt: Date.now(), owner: meta.owner,
      name: meta.name || r.title || 'Untitled notes',
      subject: r.subject || '', summary: r.summary || '',
      mode: meta.mode, theme: meta.theme, cover: meta.cover,
      cards, questions, monsters, stats: {}, model: r._model,
    };
  }

  // Background: write the lecture with Claude, then generate its audio, right after a set is created.
  const prep = new Map(); // creation id -> { text }
  async function prepareLecture(c) {
    if (prep.has(c.id)) return;
    prep.set(c.id, { text: 'Writing lecture…' });
    try {
      const s = settings();
      if (!c.lecture) {
        const r = await API.lecture({ creation: c, apiKey: s.apiKey, model: s.model });
        const sections = (r.sections || []).map(x => ({ heading: String(x.heading || '').trim(), paragraphs: (x.paragraphs || []).map(t => String(t).trim()).filter(Boolean) })).filter(x => x.paragraphs.length);
        if (!sections.length) throw new Error('empty lecture');
        c.lecture = { title: r.title || c.name, sections, createdAt: Date.now(), model: r._model };
        c.audioClips = {};
        await putC(c);
      }
      await AudioGen.ensure(c, { save: cc => putC(cc), onProgress: pr => { prep.set(c.id, { text: pr.text }); } });
      toast(`Lecture and audio ready for "${c.name}"`, 4000);
    } catch (e) {
      toast(`Lecture prep for "${c.name}" stopped: ${e.message || e}. Open Lecture to retry.`, 6000);
    } finally { prep.delete(c.id); if (/^#(home|creations)/.test(location.hash) || !location.hash) route(); }
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = settings(), u = currentUser();
    app.innerHTML = `<section class="settings">
      <h1>Settings</h1>

      <h2>Account</h2>
      <div class="account-row">${avatarHTML(u, 'md')}
        <div><b>${esc(u.name)}</b>
          <small>Level ${level(u.stats.xp)} · ${u.stats.xp} XP · joined ${new Date(u.createdAt).toLocaleDateString()}${u.lastLogin ? ' · last login ' + relTime(u.lastLogin) : ''}</small>
          <small>${u.cloud ? `${I('shield')} Cloud account · works on every device · email ${u.email ? esc(u.email) : 'not set'} · security question ${u.recoveryQ ? 'set' : 'not set'}` : `${I('lock')} Password ${u.passHash ? (u.passwordChangedAt ? 'changed ' + relTime(u.passwordChangedAt) : 'set') : 'not set'} · ${I('shield')} Security question ${u.recoveryQ ? 'set' : 'not set'} · this device only`}</small>
        </div>
      </div>
      <div class="row">
        <button class="btn ghost" id="acc-avatar">${I('user')} Change avatar</button>
        <button class="btn ghost" id="acc-name">${I('pencil')} Change username</button>
        <button class="btn ghost" id="acc-pass">${I('key')} Change password</button>
        <button class="btn ghost" id="acc-q">${I('shield')} Security question</button>
        ${u.cloud ? `<button class="btn ghost" id="acc-email">${I('info')} ${u.email ? 'Change email' : 'Add email'}</button>` : `<button class="btn ghost" id="acc-export">${I('download')} Export account</button>`}
        <button class="btn ghost" id="acc-logout">${I('logout')} Log out</button>
        <button class="btn ghost danger" id="acc-delete">${I('trash')} Delete account</button>
      </div>

      <h2>Claude</h2>
      <label class="field"><span>Claude API key</span>
        <div class="row nowrap"><input class="input" id="key" type="password" placeholder="sk-ant-…" value="${esc(s.apiKey || '')}" autocomplete="off"><button class="btn ghost" id="show" type="button">Show</button></div>
        <small>Stored only in this browser (localStorage) and sent only to api.anthropic.com. Get one at console.anthropic.com.</small></label>
      <label class="field"><span>Model</span>
        <select class="input" id="model">${MODELS.map(([v, l]) => `<option value="${v}" ${s.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>

      <h2>Lecture audio</h2>
      <p class="hint">Lectures are read by Kokoro, a free voice model. Audio is generated once per lecture and saved on this device. By default it runs right inside your browser (a 92 MB voice model downloads the first time, then it is cached). Nothing to install.</p>
      <label class="check"><input type="checkbox" id="autoLecture" ${s.autoLecture === false ? '' : 'checked'}> Write the lecture and its audio automatically when I create a set</label>
      <label class="check"><input type="checkbox" id="audioGpu" ${s.audioGpu ? 'checked' : ''} ${navigator.gpu ? '' : 'disabled'}> Use the graphics card (faster; downloads the full 326 MB model)${navigator.gpu ? '' : ' <small>· not available in this browser</small>'}</label>
      <label class="field"><span>Kokoro voice</span>
        <select class="input" id="kokoroVoice">${['af_heart', 'af_bella', 'af_sky', 'af_nicole', 'af_sarah', 'am_michael', 'am_adam', 'bf_emma', 'bm_george', 'bm_lewis'].map(v => `<option value="${v}" ${(s.kokoroVoice || 'af_heart') === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <small>af/am = American female/male, bf/bm = British. Changing the voice only affects lectures generated from now on.</small></label>
      <details class="adv"><summary>Advanced: local audio helper</summary>
        <p class="hint">Optional. On a PC with the Python tools set up, <code>tools\start_audio_helper.bat</code> generates clips faster and with exact word timing. The app uses it automatically when it is running.</p>
        <label class="field"><span>Engine</span><select class="input" id="audioEngine">${[['auto', 'Auto (helper if running, otherwise in-browser)'], ['browser', 'In-browser only'], ['helper', 'Local helper only']].map(([v, l]) => `<option value="${v}" ${(s.audioEngine || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Helper address</span><input class="input" id="helperUrl" value="${esc(s.helperUrl || 'http://localhost:8788')}"></label>
        <p class="hint" id="helper-status">Checking helper…</p>
      </details>

      <h2>Appearance</h2>
      <div class="field"><span>App theme</span>
        <div class="theme-row">${Object.entries(THEMES).map(([k, t]) => `<button type="button" class="theme-chip ${s.theme === k ? 'active' : ''}" data-theme-pick="${k}">${swatchHTML(t)}<span>${t.name}</span></button>`).join('')}</div></div>
      <div class="row"><button class="btn primary" id="save">Save settings</button></div>

      <h2>Data</h2>
      <p class="hint">Everything lives in this browser. Export to back up or move to another device.</p>
      <div class="row">
        <button class="btn secondary" id="export">${I('download')} Export all</button>
        <label class="btn secondary">${I('upload')} Import <input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn ghost" id="sample">Load sample set</button>
        <button class="btn ghost danger" id="wipe">Delete everything</button>
      </div>
    </section>`;
    app.querySelector('#acc-avatar').onclick = async () => { const a = await pickAvatar(u.avatar); if (a) { u.avatar = a; saveUser(u); renderChrome(); renderSettings(); } };
    app.querySelector('#acc-name').onclick = () => renameFlow(u, renderSettings);
    app.querySelector('#acc-pass').onclick = async () => {
      if (u.cloud) { if (await cloudChangePasswordFlow(u)) toast('Password changed'); return; }
      if (!u.passHash) return toast('Log out and back in to set a password.'); if (await changePasswordFlow(u)) { toast('Password changed'); renderSettings(); }
    };
    const accE = app.querySelector('#acc-email'); if (accE) accE.onclick = async () => { if (await cloudEmailFlow(u)) toast('Confirmation link sent to the new address. Open it to finish the change.', 6000); };
    const accQ = app.querySelector('#acc-q'); if (accQ) accQ.onclick = async () => {
      if (u.cloud) { if (await cloudQuestionFlow(u)) { toast('Security question saved'); renderSettings(); } return; }
      if (!u.passHash) return toast('Log out and back in to set a password first.'); if (await securityQuestionFlow(u)) { toast('Security question saved'); renderSettings(); }
    };
    const accX = app.querySelector('#acc-export'); if (accX) accX.onclick = () => exportAccount(u);
    app.querySelector('#acc-logout').onclick = () => logout(false);
    app.querySelector('#acc-delete').onclick = async () => {
      if (u.cloud) {
        const ok = await modal({ title: `Delete account "${u.name}"?`, okText: 'Delete', body: `<p>Your profile and study sets will be removed from the cloud. This cannot be undone.</p>${pwField('cur', 'Enter your password to confirm')}<div class="error" hidden></div>`,
          onOpen(m, close) { wireEyes(m); m.querySelector('#m-ok').onclick = async () => { try { await Cloud.deleteAccount(m.querySelector('#cur').value); close(true); } catch (err) { showErr(m, err.message); } }; } });
        if (ok) { Store.users.setCurrent(null); toast('Account deleted'); location.hash = '#login'; route(); }
        return;
      }
      const v = u.passHash ? await confirmWithPassword(u, `Delete account "${u.name}"?`, 'Your stats will be removed. Your note sets stay on this device.', 'Delete')
        : await modal({ title: `Delete account "${u.name}"?`, okText: 'Delete', body: '<p>Your stats will be removed. Your note sets stay on this device.</p>' });
      if (v) { Store.users.save(users().filter(x => x.id !== u.id)); Store.users.setCurrent(null); loginTarget = null; toast('Account deleted'); location.hash = '#login'; route(); }
    };
    AudioGen.helperHealth(true).then(h => { const el = app.querySelector('#helper-status'); if (el) el.textContent = h ? `Helper is running (voice ${h.voice}, ${h.clips} clips on disk).` : 'Helper not running. That is fine: audio is made in the browser instead.'; });
    const key = app.querySelector('#key');
    app.querySelector('#show').onclick = e => { key.type = key.type === 'password' ? 'text' : 'password'; e.target.textContent = key.type === 'password' ? 'Show' : 'Hide'; };
    let theme = s.theme;
    app.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => { theme = b.dataset.themePick; applyTheme(theme); app.querySelectorAll('[data-theme-pick]').forEach(x => x.classList.toggle('active', x === b)); });
    app.querySelector('#save').onclick = () => {
      Store.settings.update({ apiKey: key.value.trim(), model: app.querySelector('#model').value, theme,
        autoLecture: app.querySelector('#autoLecture').checked, audioGpu: app.querySelector('#audioGpu').checked, kokoroVoice: app.querySelector('#kokoroVoice').value,
        audioEngine: app.querySelector('#audioEngine').value, helperUrl: app.querySelector('#helperUrl').value.trim() || 'http://localhost:8788' });
      createState.theme = theme;
      toast('Settings saved');
    };
    app.querySelector('#export').onclick = async () => {
      const blob = new Blob([JSON.stringify({ notequest: 2, users: users(), creations: await Store.all() })], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `notequest-${localDay()}.json`; a.click();
    };
    app.querySelector('#import').onchange = async e => {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        const list = data.creations || data;
        let n = 0;
        for (const c of list) if (c && c.id && Array.isArray(c.cards)) { await putC(c); n++; }
        if (Array.isArray(data.users)) { const cur = users(); for (const iu of data.users) if (iu && iu.id && !cur.some(x => x.id === iu.id)) cur.push(iu); Store.users.save(cur); }
        toast(`Imported ${n} set${n === 1 ? '' : 's'}`);
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    app.querySelector('#sample').onclick = async () => { await putC(await sampleCreation(u)); toast('Sample added'); };
    app.querySelector('#wipe').onclick = async () => {
      const v = await modal({ title: 'Delete everything?', okText: 'Delete all', body: '<p>All accounts, note sets and settings will be removed from this browser.</p>' });
      if (v) { await Store.clear(); localStorage.clear(); try { sessionStorage.clear(); } catch (e) { /* ignore */ } toast('All data deleted'); location.hash = '#signup'; route(); }
    };
  }

  // ---------- Study / Quiz ----------
  async function renderPlay(id, forceMode) {
    const c = await Store.get(id);
    if (!c) { app.innerHTML = `<section class="empty"><p>That set no longer exists.</p><a class="btn primary" href="#creations">Back</a></section>`; return; }
    applyTheme(c.theme);
    const modeKey = forceMode || (Games[c.mode] ? c.mode : 'flash');
    const m = forceMode === 'quiz' ? { name: 'Quiz', icon: 'quiz' } : forceMode === 'lecture' ? { name: 'Lecture', icon: 'lecture' } : MODES[modeKey];
    app.innerHTML = `<section class="play">
      <div class="play-head">
        <a class="btn ghost" href="#creations">${I('arrowLeft')} Back</a>
        <div class="play-title"><b>${esc(c.name)}</b><span>${I(m.icon)} ${esc(m.name)}</span></div>
        ${forceMode ? `<a class="btn ghost" href="#study/${c.id}">${I(MODES[c.mode]?.icon || 'gamepad')} Study</a>`
                    : `<button class="btn ghost" id="switch">${I('gamepad')} Mode</button>`}
      </div>
      <div class="game" id="game"></div>
    </section>`;
    const sw = app.querySelector('#switch');
    if (sw) sw.onclick = async () => {
      const v = await modal({ title: 'Game mode', current: c.mode, options: Object.entries(MODES).map(([k, mm]) => ({ value: k, label: mm.name, desc: mm.desc, icon: I(mm.icon) })) });
      if (v && v !== c.mode) { c.mode = v; await putC(c); route(); }
    };
    const root = app.querySelector('#game');
    const u = currentUser();
    if (forceMode === 'lecture') {
      const s = settings();
      cleanup = Lecture.render(root, c, {
        settings: s,
        saveSettings: patch => Store.settings.update(patch),
        generate: () => API.lecture({ creation: c, apiKey: s.apiKey, model: s.model }),
        save: cc => putC(cc),
        done: r => onDone(c, r),
        confirm: (title, text) => modal({ title, okText: 'Rewrite', body: `<p>${esc(text)}</p>` }),
        exportForAudio: cc => {
          const blob = new Blob([JSON.stringify({ notequest: 2, creations: [{ id: cc.id, name: cc.name, lecture: cc.lecture }] })], { type: 'application/json' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
          a.download = `lecture-${cc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'set'}.json`; a.click();
          toast('Downloaded. Run tools/make_audio.py on that file, then push the audio folder.', 5000);
        },
      });
      return;
    }
    const ctx = {
      done: r => onDone(c, r),
      player: () => avatarHTML(u, 'sprite-avatar'),
      restart: () => { if (cleanup) cleanup(); cleanup = Games[modeKey](root, c, ctx); },
    };
    cleanup = Games[modeKey](root, c, ctx);
  }

  // ---------- sample ----------
  async function sampleCreation(u) {
    let lecture = null;
    try { const r = await fetch('audio/sample_lecture.json', { cache: 'no-cache' }); if (r.ok) { const L = await r.json(); lecture = { title: L.title, sections: L.sections, createdAt: Date.now(), model: 'sample' }; } } catch (e) { /* offline or file:// */ }
    return {
      lecture,
      id: 'sample-' + uid(), createdAt: Date.now(), owner: u ? u.id : undefined, name: 'Photosynthesis (sample)', subject: 'Biology – Plant Processes',
      summary: 'Photosynthesis converts light energy into chemical energy stored in glucose. It happens in chloroplasts and has two stages: the light-dependent reactions and the Calvin cycle.',
      mode: 'notemon', theme: 'forest', cover: null, stats: {},
      cards: [
        { front: 'Where does photosynthesis take place?', back: 'In the chloroplasts' },
        { front: 'Overall equation for photosynthesis', back: '6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂' },
        { front: 'Pigment that absorbs light', back: 'Chlorophyll' },
        { front: 'Where do light-dependent reactions occur?', back: 'Thylakoid membranes' },
        { front: 'Where does the Calvin cycle occur?', back: 'The stroma' },
        { front: 'Products of the light-dependent reactions', back: 'ATP, NADPH and O₂' },
        { front: 'Source of the oxygen released', back: 'Splitting of water (photolysis)' },
        { front: 'Enzyme that fixes CO₂ in the Calvin cycle', back: 'RuBisCO' },
        { front: 'Molecule that CO₂ combines with in carbon fixation', back: 'RuBP (ribulose bisphosphate)' },
        { front: 'Colours of light chlorophyll absorbs best', back: 'Red and blue' },
        { front: 'Why do leaves look green?', back: 'Green light is reflected, not absorbed' },
        { front: 'Openings in leaves that let CO₂ in', back: 'Stomata' },
        { front: 'Three limiting factors of photosynthesis', back: 'Light intensity, CO₂ concentration, temperature' },
        { front: 'Stack of thylakoids', back: 'Granum (plural grana)' },
      ],
      questions: [
        { question: 'Which stage of photosynthesis produces ATP and NADPH?', choices: ['Calvin cycle', 'Light-dependent reactions', 'Glycolysis', 'Krebs cycle'], answer: 1, explanation: 'The light-dependent reactions in the thylakoids convert light energy into ATP and NADPH used by the Calvin cycle.' },
        { question: 'The oxygen released during photosynthesis comes from…', choices: ['Carbon dioxide', 'Glucose', 'Water', 'Chlorophyll'], answer: 2, explanation: 'Photolysis splits water molecules, releasing O₂ as a by-product.' },
        { question: 'Where does the Calvin cycle take place?', choices: ['Thylakoid membrane', 'Stroma', 'Cytoplasm', 'Mitochondrial matrix'], answer: 1, explanation: 'The Calvin cycle runs in the stroma, the fluid inside the chloroplast.' },
        { question: 'Which enzyme catalyses carbon fixation?', choices: ['ATP synthase', 'Amylase', 'RuBisCO', 'Catalase'], answer: 2, explanation: 'RuBisCO attaches CO₂ to RuBP, the first step of the Calvin cycle.' },
        { question: 'A plant is given plenty of light and water but photosynthesis stays slow. The most likely limiting factor is…', choices: ['Chlorophyll colour', 'CO₂ concentration', 'Leaf size', 'Oxygen level'], answer: 1, explanation: 'With light and water abundant, CO₂ availability is the remaining limiting factor.' },
        { question: 'Why do most leaves appear green?', choices: ['They absorb green light', 'They reflect green light', 'They produce green glucose', 'Green light is the most energetic'], answer: 1, explanation: 'Chlorophyll absorbs red and blue light and reflects green.' },
        { question: 'CO₂ enters the leaf through the…', choices: ['Cuticle', 'Xylem', 'Stomata', 'Phloem'], answer: 2, explanation: 'Stomata are pores, mostly on the underside of the leaf, that allow gas exchange.' },
        { question: 'Which of these is a product, not a reactant, of photosynthesis?', choices: ['Carbon dioxide', 'Water', 'Light', 'Glucose'], answer: 3, explanation: 'Glucose and oxygen are the products; CO₂, water and light are inputs.' },
        { question: 'A stack of thylakoids is called a…', choices: ['Stroma', 'Granum', 'Lamella', 'Cristae'], answer: 1, explanation: 'Grana are stacks of thylakoid discs inside the chloroplast.' },
        { question: 'Which colours of light drive photosynthesis most effectively?', choices: ['Green and yellow', 'Red and blue', 'Orange and green', 'Ultraviolet only'], answer: 1, explanation: 'Chlorophyll absorbs red and blue wavelengths most strongly.' },
      ],
      monsters: [{ name: 'Chlorophyllis' }, { name: 'Stomatron' }, { name: 'Thylakoid Kid' }, { name: 'RuBisCOlossus' }, { name: 'Photon Phantom' }],
    };
  }

  app.innerHTML = '<div class="lec-loading"><span class="spinner"></span></div>';
  Cloud.init().finally(route);
})();
