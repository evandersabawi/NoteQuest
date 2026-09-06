// IndexedDB storage for creations + localStorage for settings.
const Store = (() => {
  const DB = 'notequest', VER = 1;
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('creations')) db.createObjectStore('creations', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
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
  const KEY = 'notequest.settings';
  return {
    all: () => tx('readonly', s => s.getAll()),
    get: id => tx('readonly', s => s.get(id)),
    put: c => tx('readwrite', s => s.put(c)),
    del: id => tx('readwrite', s => s.delete(id)),
    clear: () => tx('readwrite', s => s.clear()),
    settings: {
      get() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } },
      set(o) { localStorage.setItem(KEY, JSON.stringify(o)); },
      update(patch) { const s = this.get(); Object.assign(s, patch); this.set(s); return s; },
    },
  };
})();
