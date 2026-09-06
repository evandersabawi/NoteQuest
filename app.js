// App shell: routing, Your Creations, Create, Settings.
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
  const settings = () => Object.assign({ model: 'claude-opus-5', theme: 'midnight' }, Store.settings.get());
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---------- helpers ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
  }
  function applyTheme(t) { document.body.dataset.theme = THEMES[t] ? t : 'midnight'; }
  function setNav(name) { document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name)); }

  // Simple modal: returns a Promise resolving to the chosen value (or null).
  function modal({ title, body, options, current }) {
    return new Promise(resolve => {
      const m = document.getElementById('modal');
      m.hidden = false;
      m.innerHTML = `<div class="modal-card">
        <h3>${esc(title)}</h3>
        ${body || ''}
        ${options ? `<div class="opt-list">${options.map(o => `<button class="opt ${o.value === current ? 'active' : ''}" data-v="${esc(o.value)}">${o.icon ? `<span class="opt-icon">${o.icon}</span>` : ''}<span><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span></button>`).join('')}</div>` : ''}
        <div class="row right"><button class="btn ghost" id="m-cancel">Cancel</button>${options ? '' : '<button class="btn primary" id="m-ok">OK</button>'}</div>
      </div>`;
      const close = v => { m.hidden = true; m.innerHTML = ''; resolve(v); };
      m.onclick = e => { if (e.target === m) close(null); };
      m.querySelector('#m-cancel').onclick = () => close(null);
      m.querySelectorAll('.opt').forEach(b => b.onclick = () => close(b.dataset.v));
      const ok = m.querySelector('#m-ok');
      if (ok) ok.onclick = () => { const inp = m.querySelector('input'); close(inp ? inp.value : true); };
      const inp = m.querySelector('input'); if (inp) { inp.focus(); inp.select(); inp.onkeydown = e => { if (e.key === 'Enter') ok.click(); }; }
    });
  }

  // ---------- router ----------
  let cleanup = null;
  function route() {
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    const [path, id] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    switch (path) {
      case 'create': applyTheme(createState.theme); setNav('create'); return renderCreate();
      case 'settings': applyTheme(settings().theme); setNav('settings'); return renderSettings();
      case 'study': setNav(''); return renderPlay(id, null);
      case 'quiz': setNav(''); return renderPlay(id, 'quiz');
      default: applyTheme(settings().theme); setNav('home'); return renderHome();
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- Your Creations ----------
  async function renderHome() {
    const list = (await Store.all()).sort((a, b) => b.createdAt - a.createdAt);
    const s = settings();
    if (!list.length) {
      app.innerHTML = `<section class="empty">
        <div class="empty-emoji">📚</div>
        <h1>Your creations</h1>
        <p>Nothing here yet. Snap some photos of your notes and let Claude turn them into a game.</p>
        <div class="row center"><a class="btn primary big" href="#create">＋ Create your first set</a><button class="btn ghost" id="sample">Load a sample</button></div>
        ${s.apiKey ? '' : '<p class="hint">You will need a Claude API key. Add it in <a href="#settings">Settings</a>.</p>'}
      </section>`;
      app.querySelector('#sample').onclick = async () => { await Store.put(sampleCreation()); toast('Sample added'); renderHome(); };
      return;
    }
    app.innerHTML = `<section>
      <div class="page-head"><h1>Your creations</h1><a class="btn primary" href="#create">＋ New</a></div>
      <div class="grid">${list.map(tileHTML).join('')}</div>
    </section>`;
    app.querySelectorAll('[data-action]').forEach(b => b.onclick = e => tileAction(b.dataset.action, b.dataset.id, e));
  }

  function tileHTML(c) {
    const m = MODES[c.mode] || MODES.flash;
    const st = c.stats || {};
    const best = [];
    if (st.quizBest != null) best.push(`Quiz best ${st.quizBest}%`);
    if (st.notemonBest != null) best.push(`Notemon ${st.notemonBest}/5`);
    if (st.blitzBest != null) best.push(`Blitz ${st.blitzBest}`);
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
    if (action === 'mode') {
      const v = await modal({ title: 'Game mode', current: c.mode, options: Object.entries(MODES).map(([k, m]) => ({ value: k, label: m.name, desc: m.desc, icon: m.icon })) });
      if (v) { c.mode = v; await Store.put(c); renderHome(); }
    } else if (action === 'theme') {
      const v = await modal({ title: 'Theme', current: c.theme, options: Object.entries(THEMES).map(([k, t]) => ({ value: k, label: t.name, icon: swatchHTML(t) })) });
      if (v) { c.theme = v; await Store.put(c); renderHome(); }
    } else if (action === 'rename') {
      const v = await modal({ title: 'Rename', body: `<input class="input" value="${esc(c.name)}" maxlength="80">` });
      if (v && v.trim()) { c.name = v.trim(); await Store.put(c); renderHome(); }
    } else if (action === 'view') {
      await modal({ title: c.name, body: `<div class="cardlist"><p class="summary">${esc(c.summary || '')}</p>${c.cards.map(k => `<div class="cardrow"><b>${esc(k.front)}</b><span>${esc(k.back)}</span></div>`).join('')}</div>` });
    } else if (action === 'delete') {
      const v = await modal({ title: `Delete "${c.name}"?`, body: '<p>This cannot be undone.</p>' });
      if (v) { await Store.del(id); toast('Deleted'); renderHome(); }
    }
  }
  const swatchHTML = t => `<span class="swatch">${t.swatch.map(col => `<i style="background:${col}"></i>`).join('')}</span>`;

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
    const st = createState, s = settings();
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
      const c = sanitize(r, { name: st.name.trim(), mode: st.mode, theme: st.theme, cover });
      await Store.put(c);
      st.files = []; st.name = ''; st.busy = false; st.status = '';
      toast(`Created "${c.name}" · ${c.cards.length} cards, ${c.questions.length} questions`, 4000);
      location.hash = '#home';
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
      id: uid(), createdAt: Date.now(),
      name: meta.name || r.title || 'Untitled notes',
      subject: r.subject || '', emoji: r.emoji || '📝', summary: r.summary || '',
      mode: meta.mode, theme: meta.theme, cover: meta.cover,
      cards, questions, monsters, stats: {}, model: r._model,
    };
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = settings();
    app.innerHTML = `<section class="settings">
      <h1>Settings</h1>
      <label class="field"><span>Claude API key</span>
        <div class="row nowrap"><input class="input" id="key" type="password" placeholder="sk-ant-…" value="${esc(s.apiKey || '')}" autocomplete="off"><button class="btn ghost" id="show" type="button">Show</button></div>
        <small>Stored only in this browser (localStorage) and sent only to api.anthropic.com. Get one at console.anthropic.com.</small></label>
      <label class="field"><span>Model</span>
        <select class="input" id="model">${MODELS.map(([v, l]) => `<option value="${v}" ${s.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="field"><span>App theme</span>
        <div class="theme-row">${Object.entries(THEMES).map(([k, t]) => `<button type="button" class="theme-chip ${s.theme === k ? 'active' : ''}" data-theme-pick="${k}">${swatchHTML(t)}<span>${t.name}</span></button>`).join('')}</div></div>
      <div class="row"><button class="btn primary" id="save">Save</button></div>

      <h2>Data</h2>
      <p class="hint">Everything lives in this browser. Export to back up or move to another device.</p>
      <div class="row">
        <button class="btn secondary" id="export">⬇ Export all</button>
        <label class="btn secondary">⬆ Import <input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn ghost" id="sample">Load sample set</button>
        <button class="btn ghost danger" id="wipe">Delete everything</button>
      </div>
    </section>`;
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
      const blob = new Blob([JSON.stringify({ notequest: 1, creations: await Store.all() })], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `notequest-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    };
    app.querySelector('#import').onchange = async e => {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        const list = data.creations || data;
        let n = 0;
        for (const c of list) if (c && c.id && Array.isArray(c.cards)) { await Store.put(c); n++; }
        toast(`Imported ${n} set${n === 1 ? '' : 's'}`);
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    app.querySelector('#sample').onclick = async () => { await Store.put(sampleCreation()); toast('Sample added'); };
    app.querySelector('#wipe').onclick = async () => {
      const v = await modal({ title: 'Delete everything?', body: '<p>All creations and settings will be removed from this browser.</p>' });
      if (v) { await Store.clear(); localStorage.clear(); toast('All data deleted'); renderSettings(); }
    };
  }

  // ---------- Study / Quiz ----------
  async function renderPlay(id, forceMode) {
    const c = await Store.get(id);
    if (!c) { app.innerHTML = '<section class="empty"><p>That set no longer exists.</p><a class="btn primary" href="#home">Back</a></section>'; return; }
    applyTheme(c.theme);
    const modeKey = forceMode || (Games[c.mode] ? c.mode : 'flash');
    const m = forceMode === 'quiz' ? { name: 'Quiz', icon: '📝' } : MODES[modeKey];
    app.innerHTML = `<section class="play">
      <div class="play-head">
        <a class="btn ghost" href="#home">← Back</a>
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
      stat: async (k, v) => { c.stats = c.stats || {}; c.stats[k] = v; await Store.put(c); },
      restart: () => { if (cleanup) cleanup(); cleanup = Games[modeKey](root, c, ctx); },
    };
    cleanup = Games[modeKey](root, c, ctx);
  }

  // ---------- sample ----------
  function sampleCreation() {
    return {
      id: 'sample-' + uid(), createdAt: Date.now(), name: 'Photosynthesis (sample)', subject: 'Biology – Plant Processes', emoji: '🌱',
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
