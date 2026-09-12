// Spotify integration: OAuth (PKCE, no server), search, and playback control. Plays on whatever Spotify
// device is active (phone, desktop app); if none is, the page itself becomes a device through Spotify's
// Web Playback SDK. Spotify allows playback control only for Premium accounts.
const Music = (() => {
  const KEY = 'notequest.spotify';
  const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing streaming user-read-private';
  const clientId = () => (Store.settings.get().spotifyClientId || '').trim();
  const redirectUri = () => location.origin + location.pathname;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const save = t => { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); };
  const connected = () => !!(load() && load().refresh);
  const listeners = new Set();
  let player = null, deviceId = null, sdkReady = null, lastState = null, pollTimer = null;

  // ---------- OAuth PKCE ----------
  const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join(''); };
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function connect() {
    if (!clientId()) throw new Error('Add your Spotify Client ID in Settings first.');
    const verifier = rnd(64);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem('nq.sp.verifier', verifier);
    const u = new URL('https://accounts.spotify.com/authorize');
    u.search = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge, state: 'nq' }).toString();
    location.href = u.toString();
  }
  // Called once at startup: finishes the login if Spotify sent us back with ?code=
  async function handleRedirect() {
    const u = new URL(location.href);
    const code = u.searchParams.get('code'), err = u.searchParams.get('error');
    if (!code && !err) return false;
    history.replaceState({}, '', redirectUri() + '#music');
    if (err) throw new Error('Spotify said: ' + err);
    const verifier = sessionStorage.getItem('nq.sp.verifier');
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier }) });
    const j = await r.json();
    if (!r.ok) throw new Error('Spotify login failed: ' + (j.error_description || j.error || r.status));
    save({ access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000 });
    return true;
  }
  async function token() {
    const t = load(); if (!t) throw Object.assign(new Error('Spotify is not connected.'), { code: 'not-connected' });
    if (Date.now() < t.exp) return t.access;
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), grant_type: 'refresh_token', refresh_token: t.refresh }) });
    const j = await r.json();
    if (!r.ok) { save(null); throw Object.assign(new Error('Spotify session expired. Connect again in Settings.'), { code: 'not-connected' }); }
    save({ access: j.access_token, refresh: j.refresh_token || t.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 });
    return j.access_token;
  }
  function disconnect() { save(null); if (player) { try { player.disconnect(); } catch (e) { /* ignore */ } player = null; deviceId = null; } lastState = null; notify(); }

  // ---------- Web API ----------
  async function api(method, path, body) {
    const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: Object.assign({ authorization: 'Bearer ' + await token() }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204 || r.status === 202) return null;
    let j = null; try { j = await r.json(); } catch (e) { /* ignore */ }
    if (!r.ok) {
      const reason = (j && j.error && j.error.reason) || '', msg = (j && j.error && j.error.message) || ('Spotify error ' + r.status);
      const err = new Error(msg); err.status = r.status; err.reason = reason;
      if (reason === 'NO_ACTIVE_DEVICE' || r.status === 404) err.code = 'no-device';
      if (reason === 'PREMIUM_REQUIRED') { err.code = 'premium'; err.message = 'Spotify only allows playback control for Premium accounts.'; }
      throw err;
    }
    return j;
  }
  const trackOf = t => ({ uri: t.uri, id: t.id, name: t.name, artists: (t.artists || []).map(a => a.name).join(', '), album: t.album && t.album.name, image: t.album && t.album.images && (t.album.images[2] || t.album.images[0]) && (t.album.images[2] || t.album.images[0]).url, duration: t.duration_ms });
  async function search(q, limit = 8) { const j = await api('GET', `/search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`); return ((j && j.tracks && j.tracks.items) || []).map(trackOf); }
  async function state() {
    try { const j = await api('GET', '/me/player'); lastState = j ? { playing: !!j.is_playing, track: j.item ? trackOf(j.item) : null, device: j.device && j.device.name, progress: j.progress_ms } : { playing: false, track: null }; }
    catch (e) { if (e.code === 'not-connected') lastState = null; }
    notify(); return lastState;
  }

  // ---------- in-page player (Web Playback SDK) ----------
  function ensurePlayer() {
    if (deviceId) return Promise.resolve(deviceId);
    if (sdkReady) return sdkReady;
    sdkReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Could not start the in-page player. Open Spotify on your phone or computer and try again.')), 15000);
      const start = () => {
        player = new window.Spotify.Player({ name: 'NoteQuest', getOAuthToken: cb => token().then(cb).catch(() => cb('')), volume: 0.7 });
        player.addListener('ready', ({ device_id }) => { deviceId = device_id; clearTimeout(timeout); resolve(deviceId); });
        player.addListener('not_ready', () => { deviceId = null; });
        player.addListener('player_state_changed', () => { state(); });
        player.addListener('initialization_error', e => { clearTimeout(timeout); reject(new Error(e.message)); });
        player.addListener('authentication_error', e => { clearTimeout(timeout); reject(new Error(e.message)); });
        player.addListener('account_error', () => { clearTimeout(timeout); reject(Object.assign(new Error('Spotify only allows playback control for Premium accounts.'), { code: 'premium' })); });
        player.connect();
      };
      if (window.Spotify && window.Spotify.Player) start();
      else { window.onSpotifyWebPlaybackSDKReady = start; const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js'; s.onerror = () => { clearTimeout(timeout); reject(new Error('Could not load the Spotify player script.')); }; document.head.appendChild(s); }
    }).catch(e => { sdkReady = null; throw e; });
    return sdkReady;
  }

  // ---------- playback ----------
  async function play(uris) {
    const body = uris ? { uris: Array.isArray(uris) ? uris : [uris] } : undefined;
    try { await api('PUT', '/me/player/play', body); }
    catch (e) {
      if (e.code !== 'no-device') throw e;
      const id = await ensurePlayer();
      await api('PUT', '/me/player', { device_ids: [id], play: false });
      await new Promise(r => setTimeout(r, 600));
      await api('PUT', '/me/player/play?device_id=' + id, body);
    }
    setTimeout(state, 800);
  }
  async function playQuery(q) { const t = await search(q, 1); if (!t.length) throw new Error(`No song found for "${q}".`); await play(t[0].uri); return t[0]; }
  const pause = () => api('PUT', '/me/player/pause').then(() => setTimeout(state, 500));
  const next = () => api('POST', '/me/player/next').then(() => setTimeout(state, 800));
  const previous = () => api('POST', '/me/player/previous').then(() => setTimeout(state, 800));
  async function toggle() { const s = lastState || await state(); if (s && s.playing) return pause(); return play(); }

  // ---------- favourites ----------
  const favs = () => Store.settings.get().spotifyFavs || [];
  const isFav = uri => favs().some(f => f.uri === uri);
  function toggleFav(t) { const list = favs(); const i = list.findIndex(f => f.uri === t.uri); if (i >= 0) list.splice(i, 1); else list.unshift({ uri: t.uri, name: t.name, artists: t.artists, image: t.image }); Store.settings.update({ spotifyFavs: list.slice(0, 50) }); notify(); }

  // ---------- change notifications + polling ----------
  const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const notify = () => listeners.forEach(fn => { try { fn(lastState); } catch (e) { /* ignore */ } });
  function poll(on) { clearInterval(pollTimer); pollTimer = null; if (on && connected()) { state(); pollTimer = setInterval(() => { if (document.visibilityState === 'visible') state(); }, 6000); } }

  return { connected, clientId, redirectUri, connect, handleRedirect, disconnect, search, state, play, playQuery, pause, next, previous, toggle, favs, isFav, toggleFav, onChange, poll, last: () => lastState };
})();
