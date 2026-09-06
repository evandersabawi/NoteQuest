// App shell: accounts, routing, Home, Your Creations, Create, Settings.
(() => {
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MODES = {
    flash:   { name: 'Flash Cards', icon: '🃏', desc: 'Flip through cards and mark what you know.' },
    notemon: { name: 'Notemon',     icon: '🐉', desc: 'Battle and catch monsters by answering questions.' },
    match:   { name: 'Match',       icon: '🧩', desc: 'Memory game: pair terms with their answers.' },
    blitz:   { name: 'Blitz',       icon: '⚡', desc: '60-second speed round with streak multipliers.' },
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
  const AVATARS = ['🦊', '🐼', '🐸', '🐯', '🦄', '🐙', '🐲', '🤖', '👽', '🧙', '🦉', '🐨', '🦁', '🐧', '🦋', '🐺', '🐶', '🐱', '🦖', '🍄'];
  const COLORS = ['#8b7cff', '#2dd4f5', '#7ee787', '#ff9e5e', '#ff4fa3', '#f5d76e', '#5eead4', '#ff5c7a', '#a3e635', '#fb923c'];

  const settings = () => Object.assign({ model: 'claude-opus-5', theme: 'midnight' }, Store.settings.get());
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const localDay = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  // ---------- users / accounts (stored on this device only) ----------
  const users = () => Store.users.list();
  function currentUser() { const id = Store.users.currentId(); return users().find(u => u.id === id) || null; }
  function saveUser(u) { const list = users(); const i = list.findIndex(x => x.id === u.id); if (i >= 0) list[i] = u; else list.push(u); Store.users.save(list); }
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
  const avatarHTML = (u, cls = '') => `<span class="avatar ${cls}" style="background:${esc(u.avatar?.color || COLORS[0])}">${esc(u.avatar?.emoji || '🦊')}</span>`;
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
    }
    await Store.put(c); saveUser(u); renderChrome();
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

  // Avatar picker (emoji + colour). Resolves with {emoji, color} or null.
  function pickAvatar(current) {
    let emoji = current?.emoji || AVATARS[0], color = current?.color || COLORS[0];
    return modal({
      title: 'Choose your avatar', okText: 'Save',
      body: `<div class="avatar-preview"><span class="avatar xl" id="av-prev" style="background:${color}">${emoji}</span></div>
        <div class="emoji-grid">${AVATARS.map(a => `<button type="button" class="emoji-pick ${a === emoji ? 'active' : ''}" data-e="${a}">${a}</button>`).join('')}</div>
        <div class="color-row">${COLORS.map(c => `<button type="button" class="color-pick ${c === color ? 'active' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`,
      onOpen(m) {
        const prev = m.querySelector('#av-prev');
        m.querySelectorAll('.emoji-pick').forEach(b => b.onclick = () => { emoji = b.dataset.e; prev.textContent = emoji; m.querySelectorAll('.emoji-pick').forEach(x => x.classList.toggle('active', x === b)); });
        m.querySelectorAll('.color-pick').forEach(b => b.onclick = () => { color = b.dataset.c; prev.style.background = color; m.querySelectorAll('.color-pick').forEach(x => x.classList.toggle('active', x === b)); });
      },
    }).then(v => v ? { emoji, color } : null);
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
      top.innerHTML = `<a class="btn ghost" href="#login">Log in</a><a class="btn primary" href="#signup">Sign up</a>`;
      document.getElementById('sideUser').innerHTML = '';
      return;
    }
    top.innerHTML = `<a class="user-chip" href="#home">${avatarHTML(u, 'sm')}<span>${esc(u.name)}</span></a><button class="btn ghost" id="logout">Log out</button>`;
    top.querySelector('#logout').onclick = () => { Store.users.setCurrent(null); toast('Logged out'); location.hash = '#login'; route(); };
    const xp = u.stats.xp, lv = level(xp);
    document.getElementById('sideUser').innerHTML = `<a href="#home" class="side-user-link">${avatarHTML(u, 'md')}<div><b>${esc(u.name)}</b><small>Level ${lv} · ${xp} XP</small></div></a>`;
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
      return renderAuth(path === 'signup' || !users().length ? 'signup' : 'login');
    }
    switch (path) {
      case 'login': return renderAuth('login');
      case 'signup': return renderAuth('signup');
      case 'creations': applyTheme(settings().theme); setNav('creations'); return renderCreations();
      case 'create': applyTheme(createState.theme); setNav('create'); return renderCreate();
      case 'settings': applyTheme(settings().theme); setNav('settings'); return renderSettings();
      case 'study': setNav(''); return renderPlay(id, null);
      case 'quiz': setNav(''); return renderPlay(id, 'quiz');
      default: applyTheme(settings().theme); setNav('home'); return renderHome();
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- auth (local accounts) ----------
  function renderAuth(kind) {
    setNav('');
    const list = users();
    if (kind === 'login' && list.length) {
      app.innerHTML = `<section class="auth">
        <div class="auth-card">
          <div class="auth-logo">📝</div>
          <h1>Welcome back</h1>
          <p class="hint">Pick your account to log in.</p>
          <div class="account-list">${list.map(u => `<button class="account" data-id="${u.id}">${avatarHTML(u, 'md')}<span><b>${esc(u.name)}</b><small>Level ${level(u.stats.xp)} · ${u.stats.xp} XP</small></span></button>`).join('')}</div>
          <p class="hint">New here? <a href="#signup">Sign up</a></p>
        </div></section>`;
      app.querySelectorAll('.account').forEach(b => b.onclick = () => { Store.users.setCurrent(b.dataset.id); location.hash = '#home'; route(); });
      return;
    }
    let avatar = { emoji: AVATARS[Math.floor(Math.random() * AVATARS.length)], color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    app.innerHTML = `<section class="auth">
      <div class="auth-card">
        <div class="auth-logo">📝</div>
        <h1>Create your account</h1>
        <p class="hint">Accounts are saved on this device only. No email or password needed.</p>
        <button type="button" class="avatar-btn" id="pick"><span class="avatar xl" id="av" style="background:${avatar.color}">${avatar.emoji}</span><small>Tap to change avatar</small></button>
        <label class="field"><span>Username</span><input class="input" id="uname" placeholder="e.g. evander" maxlength="24" autocomplete="off"></label>
        <div class="error" id="err" hidden></div>
        <button class="btn primary big wide" id="go">Sign up</button>
        ${list.length ? '<p class="hint">Already have an account? <a href="#login">Log in</a></p>' : ''}
      </div></section>`;
    const nameEl = app.querySelector('#uname'); nameEl.focus();
    app.querySelector('#pick').onclick = async () => { const a = await pickAvatar(avatar); if (a) { avatar = a; const av = app.querySelector('#av'); av.textContent = a.emoji; av.style.background = a.color; } };
    const submit = () => {
      const name = nameEl.value.trim();
      const err = app.querySelector('#err');
      if (name.length < 2) { err.hidden = false; err.textContent = 'Username needs at least 2 characters.'; return; }
      if (list.some(u => u.name.toLowerCase() === name.toLowerCase())) { err.hidden = false; err.textContent = 'That username is already taken on this device.'; return; }
      const u = newUser(name, avatar); saveUser(u); Store.users.setCurrent(u.id);
      toast(`Welcome, ${u.name}!`); location.hash = '#home'; route();
    };
    app.querySelector('#go').onclick = submit;
    nameEl.onkeydown = e => { if (e.key === 'Enter') submit(); };
  }

  // ---------- Home ----------
  async function renderHome() {
    const u = currentUser();
    const list = mine(await Store.all(), u);
    const s = u.stats, xp = s.xp, lv = level(xp), lo = xpForLevel(lv), hi = xpForLevel(lv + 1);
    const avg = s.quizzes ? Math.round(s.quizPctTotal / s.quizzes) : null;
    const st = streak(u);
    const stats = [
      ['📚', list.length, 'sets created'],
      ['📝', s.quizzes, 'quizzes taken'],
      ['🎯', avg == null ? '–' : avg + '%', 'avg quiz score'],
      ['🃏', s.cardsStudied, 'cards studied'],
      ['🐉', s.monstersCaught, 'monsters caught'],
      ['⚡', s.blitzBest, 'blitz best'],
      ['🧩', s.matchBest == null ? '–' : s.matchBest, 'match best (moves)'],
      ['🔥', st, st === 1 ? 'day streak' : 'day streak'],
    ];
    app.innerHTML = `<section class="home">
      <div class="hero">
        <button type="button" class="avatar-btn" id="avatarBtn" title="Change avatar">${avatarHTML(u, 'xl')}</button>
        <div class="hero-text">
          <div class="name-row"><h1>${esc(u.name)}</h1><button class="icon-btn" id="editName" title="Change username">✏️</button></div>
          <div class="level-row"><b>Level ${lv}</b><span class="xpbar"><i style="width:${Math.round((xp - lo) / (hi - lo) * 100)}%"></i></span><small>${xp - lo} / ${hi - lo} XP</small></div>
          <div class="hero-badges"><span class="badge">🔥 ${st}-day streak</span>${s.notemonWins ? `<span class="badge">🏆 ${s.notemonWins} Notemon win${s.notemonWins === 1 ? '' : 's'}</span>` : ''}${s.quizBest ? `<span class="badge">🎯 best quiz ${s.quizBest}%</span>` : ''}</div>
        </div>
        <a class="btn primary big" href="#create">✨ New set</a>
      </div>

      <h2>Your stats</h2>
      <div class="stats-grid">${stats.map(([i, v, l]) => `<div class="stat-card"><span class="stat-ico">${i}</span><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('')}</div>

      <div class="section-head"><h2>Recent notes</h2>${list.length ? '<a href="#creations">See all →</a>' : ''}</div>
      ${list.length ? `<div class="grid">${list.slice(0, 4).map(tileHTML).join('')}</div>`
        : `<div class="empty small"><p>No notes yet. Snap photos of your notes and Claude will turn them into a game.</p><div class="row center"><a class="btn primary" href="#create">＋ Create your first set</a><button class="btn ghost" id="sample">Load a sample</button></div></div>`}
    </section>`;
    app.querySelector('#avatarBtn').onclick = async () => { const a = await pickAvatar(u.avatar); if (a) { u.avatar = a; saveUser(u); renderChrome(); renderHome(); } };
    app.querySelector('#editName').onclick = async () => {
      const v = await modal({ title: 'Change username', okText: 'Save', body: `<input class="input" value="${esc(u.name)}" maxlength="24">` });
      if (v && v.trim().length >= 2) { u.name = v.trim(); saveUser(u); renderChrome(); renderHome(); toast('Username updated'); }
    };
    const smp = app.querySelector('#sample'); if (smp) smp.onclick = async () => { await Store.put(sampleCreation(u)); toast('Sample added'); renderHome(); };
    wireTiles();
  }

  // ---------- Your Creations ----------
  async function renderCreations() {
    const u = currentUser();
    const list = mine(await Store.all(), u);
    const s = settings();
    if (!list.length) {
      app.innerHTML = `<section class="empty">
        <div class="empty-emoji">📚</div>
        <h1>Your creations</h1>
        <p>Nothing here yet. Snap some photos of your notes and let Claude turn them into a game.</p>
        <div class="row center"><a class="btn primary big" href="#create">＋ Create your first set</a><button class="btn ghost" id="sample">Load a sample</button></div>
        ${s.apiKey ? '' : '<p class="hint">You will need a Claude API key. Add it in <a href="#settings">Settings</a>.</p>'}
      </section>`;
      app.querySelector('#sample').onclick = async () => { await Store.put(sampleCreation(u)); toast('Sample added'); renderCreations(); };
      return;
    }
    app.innerHTML = `<section>
      <div class="page-head"><h1>Your creations</h1><a class="btn primary" href="#create">＋ New</a></div>
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
    const cover = c.cover ? `style="background-image:url(${c.cover})"` : '';
    return `<article class="tile" data-theme="${esc(c.theme)}">
      <div class="tile-cover ${c.cover ? '' : 'no-img'}" ${cover}><span class="tile-emoji">${esc(c.emoji || '📝')}</span><span class="tile-mode">${m.icon} ${esc(m.name)}</span></div>
      <div class="tile-body">
        <div class="tile-title-row">
          <h2>${esc(c.name)}</h2>
          <details class="menu"><summary aria-label="More">⋯</summary><div class="menu-list">
            <button data-action="mode" data-id="${c.id}">🎮 Change game mode</button>
            <button data-action="theme" data-id="${c.id}">🎨 Change theme</button>
            <button data-action="rename" data-id="${c.id}">✏️ Rename</button>
            <button data-action="view" data-id="${c.id}">📄 View cards</button>
            <button data-action="delete" data-id="${c.id}" class="danger">🗑 Delete</button>
          </div></details>
        </div>
        <p class="tile-sub">${esc(c.subject || '')}</p>
        <p class="tile-meta">${c.cards.length} cards · ${c.questions.length} questions${best.length ? ' · ' + best.join(' · ') : ''}</p>
        <div class="row tile-actions">
          <a class="btn primary" href="#study/${c.id}">${m.icon} Study</a>
          <a class="btn secondary" href="#quiz/${c.id}">📝 Quiz</a>
        </div>
      </div>
    </article>`;
  }

  async function tileAction(action, id, e) {
    const details = e.target.closest('details'); if (details) details.open = false;
    const c = await Store.get(id); if (!c) return;
    const refresh = () => route();
    if (action === 'mode') {
      const v = await modal({ title: 'Game mode', current: c.mode, options: Object.entries(MODES).map(([k, m]) => ({ value: k, label: m.name, desc: m.desc, icon: m.icon })) });
      if (v) { c.mode = v; await Store.put(c); refresh(); }
    } else if (action === 'theme') {
      const v = await modal({ title: 'Theme', current: c.theme, options: Object.entries(THEMES).map(([k, t]) => ({ value: k, label: t.name, icon: swatchHTML(t) })) });
      if (v) { c.theme = v; await Store.put(c); refresh(); }
    } else if (action === 'rename') {
      const v = await modal({ title: 'Rename', okText: 'Save', body: `<input class="input" value="${esc(c.name)}" maxlength="80">` });
      if (v && v.trim()) { c.name = v.trim(); await Store.put(c); refresh(); }
    } else if (action === 'view') {
      await modal({ title: c.name, okText: 'Close', body: `<div class="cardlist"><p class="summary">${esc(c.summary || '')}</p>${c.cards.map(k => `<div class="cardrow"><b>${esc(k.front)}</b><span>${esc(k.back)}</span></div>`).join('')}</div>` });
    } else if (action === 'delete') {
      const v = await modal({ title: `Delete "${c.name}"?`, okText: 'Delete', body: '<p>This cannot be undone.</p>' });
      if (v) { await Store.del(id); toast('Deleted'); refresh(); }
    }
  }

  // ---------- Create ----------
  const createState = { name: '', files: [], mode: 'flash', theme: settings().theme, busy: false, status: '', error: '' };

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
          <div>📷 <b>Tap to add photos</b><br><small>or drag &amp; drop · several pages at once is fine</small></div>
        </label>
        <div class="previews" id="previews"></div>
      </div>

      <div class="field"><span>Game mode</span>
        <div class="mode-grid">${Object.entries(MODES).map(([k, m]) => `
          <button type="button" class="mode-card ${st.mode === k ? 'active' : ''}" data-mode="${k}"><span class="mode-icon">${m.icon}</span><b>${m.name}</b><small>${m.desc}</small></button>`).join('')}</div>
      </div>

      <div class="field"><span>Theme</span>
        <div class="theme-row">${Object.entries(THEMES).map(([k, t]) => `
          <button type="button" class="theme-chip ${st.theme === k ? 'active' : ''}" data-theme-pick="${k}">${swatchHTML(t)}<span>${t.name}</span></button>`).join('')}</div>
      </div>

      <div class="error" id="error" ${st.error ? '' : 'hidden'}>${esc(st.error)}</div>
      <div class="row">
        <button class="btn primary big" id="go" ${st.busy ? 'disabled' : ''}>${st.busy ? '<span class="spinner"></span> ' + esc(st.status || 'Working…') : '✨ Generate with Claude'}</button>
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
    box.innerHTML = createState.files.map((f, i) => `<div class="preview"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="x" data-rm="${i}" aria-label="Remove">✕</button><span>${i + 1}</span></div>`).join('');
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { createState.files.splice(+b.dataset.rm, 1); renderPreviews(); });
  }
  async function generate() {
    const st = createState, s = settings(), u = currentUser();
    st.error = '';
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
      await Store.put(c);
      u.stats.xp += 25; saveUser(u);
      st.files = []; st.name = ''; st.busy = false; st.status = '';
      toast(`Created "${c.name}" · ${c.cards.length} cards, ${c.questions.length} questions`, 4000);
      location.hash = '#creations';
    } catch (e) {
      st.busy = false; st.status = ''; st.error = e.message || String(e);
      renderCreate();
    }
  }
  function sanitize(r, meta) {
    const cards = (r.cards || []).filter(k => k && k.front && k.back).map(k => ({ front: String(k.front).trim(), back: String(k.back).trim() }));
    const questions = (r.questions || []).filter(q => q && q.question && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4)
      .map(q => ({ question: String(q.question).trim(), choices: q.choices.map(x => String(x).trim()), answer: q.answer, explanation: String(q.explanation || '').trim() }));
    const monsters = (r.monsters || []).filter(m => m && m.name).slice(0, 5).map(m => ({ name: String(m.name).trim(), emoji: (m.emoji || '👾').trim() }));
    if (cards.length < 2) throw new Error('Claude could not find enough content in these photos. Try clearer or closer photos.');
    return {
      id: uid(), createdAt: Date.now(), owner: meta.owner,
      name: meta.name || r.title || 'Untitled notes',
      subject: r.subject || '', emoji: r.emoji || '📝', summary: r.summary || '',
      mode: meta.mode, theme: meta.theme, cover: meta.cover,
      cards, questions, monsters, stats: {}, model: r._model,
    };
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = settings(), u = currentUser();
    app.innerHTML = `<section class="settings">
      <h1>Settings</h1>

      <h2>Account</h2>
      <div class="account-row">${avatarHTML(u, 'md')}<div><b>${esc(u.name)}</b><small>Level ${level(u.stats.xp)} · ${u.stats.xp} XP · joined ${new Date(u.createdAt).toLocaleDateString()}</small></div>
        <div class="row"><button class="btn ghost" id="acc-avatar">Change avatar</button><button class="btn ghost" id="acc-name">Change username</button><button class="btn ghost danger" id="acc-delete">Delete account</button></div></div>

      <h2>Claude</h2>
      <label class="field"><span>Claude API key</span>
        <div class="row nowrap"><input class="input" id="key" type="password" placeholder="sk-ant-…" value="${esc(s.apiKey || '')}" autocomplete="off"><button class="btn ghost" id="show" type="button">Show</button></div>
        <small>Stored only in this browser (localStorage) and sent only to api.anthropic.com. Get one at console.anthropic.com.</small></label>
      <label class="field"><span>Model</span>
        <select class="input" id="model">${MODELS.map(([v, l]) => `<option value="${v}" ${s.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>

      <h2>Appearance</h2>
      <div class="field"><span>App theme</span>
        <div class="theme-row">${Object.entries(THEMES).map(([k, t]) => `<button type="button" class="theme-chip ${s.theme === k ? 'active' : ''}" data-theme-pick="${k}">${swatchHTML(t)}<span>${t.name}</span></button>`).join('')}</div></div>
      <div class="row"><button class="btn primary" id="save">Save settings</button></div>

      <h2>Data</h2>
      <p class="hint">Everything lives in this browser. Export to back up or move to another device.</p>
      <div class="row">
        <button class="btn secondary" id="export">⬇ Export all</button>
        <label class="btn secondary">⬆ Import <input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn ghost" id="sample">Load sample set</button>
        <button class="btn ghost danger" id="wipe">Delete everything</button>
      </div>
    </section>`;
    app.querySelector('#acc-avatar').onclick = async () => { const a = await pickAvatar(u.avatar); if (a) { u.avatar = a; saveUser(u); renderChrome(); renderSettings(); } };
    app.querySelector('#acc-name').onclick = async () => {
      const v = await modal({ title: 'Change username', okText: 'Save', body: `<input class="input" value="${esc(u.name)}" maxlength="24">` });
      if (v && v.trim().length >= 2) { u.name = v.trim(); saveUser(u); renderChrome(); renderSettings(); }
    };
    app.querySelector('#acc-delete').onclick = async () => {
      const v = await modal({ title: `Delete account "${u.name}"?`, okText: 'Delete', body: '<p>Your stats will be removed. Your note sets stay on this device.</p>' });
      if (v) { Store.users.save(users().filter(x => x.id !== u.id)); Store.users.setCurrent(null); toast('Account deleted'); location.hash = '#login'; route(); }
    };
    const key = app.querySelector('#key');
    app.querySelector('#show').onclick = e => { key.type = key.type === 'password' ? 'text' : 'password'; e.target.textContent = key.type === 'password' ? 'Show' : 'Hide'; };
    let theme = s.theme;
    app.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => { theme = b.dataset.themePick; applyTheme(theme); app.querySelectorAll('[data-theme-pick]').forEach(x => x.classList.toggle('active', x === b)); });
    app.querySelector('#save').onclick = () => {
      Store.settings.update({ apiKey: key.value.trim(), model: app.querySelector('#model').value, theme });
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
        for (const c of list) if (c && c.id && Array.isArray(c.cards)) { await Store.put(c); n++; }
        if (Array.isArray(data.users)) { const cur = users(); for (const iu of data.users) if (iu && iu.id && !cur.some(x => x.id === iu.id)) cur.push(iu); Store.users.save(cur); }
        toast(`Imported ${n} set${n === 1 ? '' : 's'}`);
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    app.querySelector('#sample').onclick = async () => { await Store.put(sampleCreation(u)); toast('Sample added'); };
    app.querySelector('#wipe').onclick = async () => {
      const v = await modal({ title: 'Delete everything?', okText: 'Delete all', body: '<p>All accounts, note sets and settings will be removed from this browser.</p>' });
      if (v) { await Store.clear(); localStorage.clear(); toast('All data deleted'); location.hash = '#signup'; route(); }
    };
  }

  // ---------- Study / Quiz ----------
  async function renderPlay(id, forceMode) {
    const c = await Store.get(id);
    if (!c) { app.innerHTML = '<section class="empty"><p>That set no longer exists.</p><a class="btn primary" href="#creations">Back</a></section>'; return; }
    applyTheme(c.theme);
    const modeKey = forceMode || (Games[c.mode] ? c.mode : 'flash');
    const m = forceMode === 'quiz' ? { name: 'Quiz', icon: '📝' } : MODES[modeKey];
    app.innerHTML = `<section class="play">
      <div class="play-head">
        <a class="btn ghost" href="#creations">← Back</a>
        <div class="play-title"><b>${esc(c.name)}</b><span>${m.icon} ${esc(m.name)}</span></div>
        ${forceMode ? `<a class="btn ghost" href="#study/${c.id}">${MODES[c.mode]?.icon || '🎮'} Study</a>`
                    : `<button class="btn ghost" id="switch">🎮 Mode</button>`}
      </div>
      <div class="game" id="game"></div>
    </section>`;
    const sw = app.querySelector('#switch');
    if (sw) sw.onclick = async () => {
      const v = await modal({ title: 'Game mode', current: c.mode, options: Object.entries(MODES).map(([k, mm]) => ({ value: k, label: mm.name, desc: mm.desc, icon: mm.icon })) });
      if (v && v !== c.mode) { c.mode = v; await Store.put(c); route(); }
    };
    const root = app.querySelector('#game');
    const ctx = {
      done: r => onDone(c, r),
      restart: () => { if (cleanup) cleanup(); cleanup = Games[modeKey](root, c, ctx); },
    };
    cleanup = Games[modeKey](root, c, ctx);
  }

  // ---------- sample ----------
  function sampleCreation(u) {
    return {
      id: 'sample-' + uid(), createdAt: Date.now(), owner: u ? u.id : undefined, name: 'Photosynthesis (sample)', subject: 'Biology – Plant Processes', emoji: '🌱',
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
      monsters: [
        { name: 'Chlorophyllis', emoji: '🌿' }, { name: 'Stomatron', emoji: '🐛' }, { name: 'Thylakoid Kid', emoji: '🦎' },
        { name: 'RuBisCOlossus', emoji: '🦕' }, { name: 'Photon Phantom', emoji: '👻' },
      ],
    };
  }

  route();
})();
