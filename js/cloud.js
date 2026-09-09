// Cloud accounts (optional). When js/server-config.js sets window.API_BASE to the NoteQuest server (server/main.py
// deployed on Railway), accounts live there: username + password, security-question reset, and each user's
// profile and study sets sync across devices. Without it the app keeps its local, device-only accounts.
const Cloud = (() => {
  const base = () => (window.API_BASE || '').replace(/\/$/, '');
  const TOKEN = 'notequest.token';
  let prof = null, ready = null, failed = false;
  const saveTimers = new Map();

  const enabled = () => !!base() && !failed;
  const profile = () => prof;
  const token = () => { try { return sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN) || null; } catch (e) { return localStorage.getItem(TOKEN); } };
  function setToken(t, stay) {
    localStorage.removeItem(TOKEN); try { sessionStorage.removeItem(TOKEN); } catch (e) { /* ignore */ }
    if (!t) return;
    try { (stay ? localStorage : sessionStorage).setItem(TOKEN, t); } catch (e) { localStorage.setItem(TOKEN, t); }
  }

  async function api(method, path, body, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    const t = token(); if (t) headers.authorization = 'Bearer ' + t;
    let r;
    try { r = await fetch(base() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined }); }
    catch (e) { const err = new Error('Cannot reach the account server. Check your connection.'); err.code = 'network'; throw err; }
    let j = null; try { j = await r.json(); } catch (e) { /* ignore */ }
    if (!r.ok) { const err = new Error((j && (j.error || j.detail)) || `Server error ${r.status}`); err.status = r.status; if (r.status === 401 && t && !/wrong|attempt/i.test(err.message)) { setToken(null); prof = null; } throw err; }
    return j;
  }

  // Runs once at startup: if a token is stored, load the profile. Never blocks the app for long.
  function init() {
    if (!base()) return Promise.resolve(false);
    if (ready) return ready;
    ready = (async () => {
      if (!token()) return true;
      try { prof = await api('GET', '/me', undefined, { timeout: 8000 }); }
      catch (e) { if (e.code === 'network') { failed = true; console.warn('Account server unreachable; using local accounts for now.'); } else { setToken(null); prof = null; } }
      return !failed;
    })();
    return ready;
  }
  async function health() { try { return await api('GET', '/health', undefined, { timeout: 4000 }); } catch (e) { return null; } }

  async function signUp({ username, password, avatar, securityQ, securityA, stay, newUser }) {
    const local = newUser(username, avatar);
    const r = await api('POST', '/auth/signup', { username, password, avatar, securityQ, securityA, stay, profile: { stats: local.stats, activeDays: [] } });
    setToken(r.token, stay); prof = r.user; return prof;
  }
  async function signIn({ username, password, stay }) {
    const r = await api('POST', '/auth/login', { username, password, stay });
    setToken(r.token, stay); prof = r.user; return prof;
  }
  async function signOut() { setToken(null); prof = null; }
  const getQuestion = username => api('GET', '/auth/question?username=' + encodeURIComponent(username));
  const resetPassword = (username, answer, newPassword) => api('POST', '/auth/reset', { username, answer, newPassword });
  const changePassword = (current, next) => api('POST', '/auth/password', { current, new: next });
  const setQuestion = (question, answer, password) => api('POST', '/auth/question', { question, answer, password });
  async function deleteAccount(password) { await api('POST', '/auth/delete', { password }); setToken(null); prof = null; }

  function saveProfile(p, immediate) {
    prof = p;
    const write = () => api('PUT', '/me', { name: p.name, avatar: p.avatar, stats: p.stats, activeDays: p.activeDays }).then(u => { if (u) Object.assign(prof, { name: u.name, recoveryQ: u.recoveryQ }); });
    if (immediate) return write();
    clearTimeout(saveTimers.get('profile')); saveTimers.set('profile', setTimeout(() => write().catch(e => console.warn('Profile sync failed', e.message)), 800));
    return Promise.resolve();
  }

  // ---------- study sets ----------
  const strip = c => { const { audioClips, ...rest } = c; return rest; };
  function pushCreation(c) {
    if (!prof || !c || c.owner !== prof.id) return;
    clearTimeout(saveTimers.get(c.id));
    saveTimers.set(c.id, setTimeout(() => api('PUT', '/creations/' + encodeURIComponent(c.id), strip(c)).catch(e => console.warn('Set sync failed', e.message)), 1200));
  }
  async function deleteCreation(id) { try { await api('DELETE', '/creations/' + encodeURIComponent(id)); } catch (e) { console.warn(e.message); } }
  async function pullCreations() { const r = await api('GET', '/creations'); return r.creations || []; }
  const pushNow = c => api('PUT', '/creations/' + encodeURIComponent(c.id), strip(c));

  return { enabled, init, health, profile, signUp, signIn, signOut, getQuestion, resetPassword, changePassword, setQuestion, deleteAccount, saveProfile, pushCreation, pushNow, deleteCreation, pullCreations };
})();
