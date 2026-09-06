// Storage. Creations live in IndexedDB (falls back to localStorage if IndexedDB is unavailable).
// Settings and user accounts live in localStorage.
const Store = (() => {
  const DB = 'notequest', VER = 1;
  const LS = 'notequest.creations';
  let idbFailed = !window.indexedDB;

  const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
  const lsSave = list => localStorage.setItem(LS, JSON.stringify(list));

  function open() {
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(DB, VER); } catch (e) { return rej(e); }
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('creations')) db.createObjectStore('creations', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB blocked'));
    });
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('creations', mode);
      const req = fn(t.objectStore('creations'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  async function run(mode, fn, fallback) {
    if (!idbFailed) {
      try { return await tx(mode, fn); }
      catch (e) { idbFailed = true; console.warn('IndexedDB unavailable, using localStorage instead.', e); }
    }
    return fallback();
  }

  const json = (key, def) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch (e) { return def; } };
  const KEY = 'notequest.settings', USERS = 'notequest.users', CUR = 'notequest.currentUser';

  return {
    all: () => run('readonly', s => s.getAll(), lsAll),
    get: id => run('readonly', s => s.get(id), () => lsAll().find(c => c.id === id)),
    put: c => run('readwrite', s => s.put(c), () => { const l = lsAll().filter(x => x.id !== c.id); l.push(c); lsSave(l); }),
    del: id => run('readwrite', s => s.delete(id), () => lsSave(lsAll().filter(x => x.id !== id))),
    clear: () => run('readwrite', s => s.clear(), () => lsSave([])),
    settings: {
      get() { return json(KEY, {}); },
      set(o) { localStorage.setItem(KEY, JSON.stringify(o)); },
      update(patch) { const s = this.get(); Object.assign(s, patch); this.set(s); return s; },
    },
    users: {
      list() { return json(USERS, []); },
      save(list) { localStorage.setItem(USERS, JSON.stringify(list)); },
      // "Stay signed in" keeps the session in localStorage; otherwise it lives in sessionStorage (cleared when the tab closes).
      currentId() { try { return sessionStorage.getItem(CUR) || localStorage.getItem(CUR) || null; } catch (e) { return localStorage.getItem(CUR) || null; } },
      setCurrent(id, persist = true) {
        localStorage.removeItem(CUR);
        try { sessionStorage.removeItem(CUR); } catch (e) { /* ignore */ }
        if (!id) return;
        try { (persist ? localStorage : sessionStorage).setItem(CUR, id); } catch (e) { localStorage.setItem(CUR, id); }
      },
    },
  };
})();
