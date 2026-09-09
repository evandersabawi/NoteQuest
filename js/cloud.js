// Cloud accounts (optional). When js/firebase-config.js sets window.FIREBASE_CONFIG, accounts live in
// Firebase Auth and each user's profile + study sets sync through Firestore, so the same account works on
// every device. Without a config the app keeps its local, device-only accounts.
const Cloud = (() => {
  const V = '11.10.0';
  const cfg = () => (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) ? window.FIREBASE_CONFIG : null;
  let A = null, F = null, auth = null, db = null, user = null, prof = null, readyP = null, failed = null;
  const saveTimers = new Map();

  const enabled = () => !!cfg() && !failed;
  const profile = () => (user && prof) ? prof : null;

  function init() {
    if (!cfg()) return Promise.resolve(false);
    if (readyP) return readyP;
    readyP = (async () => {
      const [appM, authM, fsM] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
      ]);
      A = authM; F = fsM;
      const app = appM.initializeApp(cfg());
      auth = A.getAuth(app); db = F.getFirestore(app);
      await new Promise(res => { const un = A.onAuthStateChanged(auth, u => { user = u; un(); res(); }); });
      if (user) prof = await loadProfile(user.uid);
      return true;
    })().catch(e => { failed = e; console.warn('Cloud accounts unavailable, using local accounts.', e); return false; });
    return readyP;
  }

  function friendly(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'No account with that email. Create one?',
      'auth/email-already-in-use': 'That email already has an account. Log in instead.', 'auth/invalid-email': 'That email address does not look right.',
      'auth/weak-password': 'Password needs at least 8 characters.', 'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No internet connection.', 'auth/requires-recent-login': 'Please log out and back in, then try again.',
      'permission-denied': 'The database refused the request. Check the Firestore rules in firestore.rules.',
      'auth/operation-not-allowed': 'Email/Password sign-in is not enabled in the Firebase console (Authentication → Sign-in method).',
      'auth/unauthorized-domain': 'This site is not in the Firebase authorized domains list (Authentication → Settings).',
    };
    if (code.startsWith('auth/api-key-not-valid')) { const err = new Error('The Firebase config in js/firebase-config.js is not valid. Paste the config from the Firebase console.'); err.code = code; return err; }
    const err = new Error(map[code] || (e && e.message) || String(e)); err.code = code; return err;
  }
  const strip = c => { const { audioClips, ...rest } = c; return JSON.parse(JSON.stringify(rest)); };

  async function loadProfile(uid) {
    const snap = await F.getDoc(F.doc(db, 'users', uid));
    const d = snap.exists() ? snap.data() : null;
    if (!d) return null;
    return Object.assign({ id: uid, cloud: true, email: user.email }, d);
  }
  async function saveProfile(p, immediate) {
    if (!user) return;
    prof = p;
    const write = async () => { const { id, cloud, email, ...data } = p; data.email = user.email; data.updatedAt = Date.now(); await F.setDoc(F.doc(db, 'users', user.uid), data, { merge: true }); };
    if (immediate) return write();
    clearTimeout(saveTimers.get('profile')); saveTimers.set('profile', setTimeout(() => write().catch(e => console.warn(e)), 800));
  }

  async function signUp({ email, password, name, avatar, stay, newUser }) {
    try {
      await A.setPersistence(auth, stay ? A.browserLocalPersistence : A.browserSessionPersistence);
      const cred = await A.createUserWithEmailAndPassword(auth, email.trim(), password);
      user = cred.user;
      await A.updateProfile(user, { displayName: name });
      const p = Object.assign(newUser(name, avatar), { id: user.uid, cloud: true, email: user.email, lastLogin: Date.now() });
      await saveProfile(p, true);
      return p;
    } catch (e) { throw friendly(e); }
  }
  async function signIn({ email, password, stay }) {
    try {
      await A.setPersistence(auth, stay ? A.browserLocalPersistence : A.browserSessionPersistence);
      const cred = await A.signInWithEmailAndPassword(auth, email.trim(), password);
      user = cred.user;
      prof = await loadProfile(user.uid);
      if (!prof) throw new Error('This account has no profile yet. Please sign up again.');
      prof.lastLogin = Date.now(); await saveProfile(prof, true);
      return prof;
    } catch (e) { throw friendly(e); }
  }
  async function signOut() { try { await A.signOut(auth); } catch (e) { /* ignore */ } user = null; prof = null; }
  async function resetPassword(email) { try { await A.sendPasswordResetEmail(auth, email.trim()); } catch (e) { throw friendly(e); } }
  async function reauth(password) { const cred = A.EmailAuthProvider.credential(user.email, password); await A.reauthenticateWithCredential(user, cred); }
  async function changePassword(current, next) { try { await reauth(current); await A.updatePassword(user, next); } catch (e) { throw friendly(e); } }
  async function deleteAccount(password) {
    try {
      await reauth(password);
      const snaps = await F.getDocs(F.collection(db, 'users', user.uid, 'creations'));
      for (const d of snaps.docs) await F.deleteDoc(d.ref);
      await F.deleteDoc(F.doc(db, 'users', user.uid));
      await A.deleteUser(user); user = null; prof = null;
    } catch (e) { throw friendly(e); }
  }

  // ---------- study sets ----------
  function pushCreation(c) {
    if (!user || !c || c.owner !== user.uid) return;
    clearTimeout(saveTimers.get(c.id));
    saveTimers.set(c.id, setTimeout(() => {
      const data = strip(c); data.updatedAt = Date.now();
      F.setDoc(F.doc(db, 'users', user.uid, 'creations', c.id), data).catch(e => console.warn('Cloud save failed', e));
    }, 1200));
  }
  async function pushNow(c) { if (!user) return; const data = strip(c); data.updatedAt = Date.now(); await F.setDoc(F.doc(db, 'users', user.uid, 'creations', c.id), data); }
  async function deleteCreation(id) { if (!user) return; try { await F.deleteDoc(F.doc(db, 'users', user.uid, 'creations', id)); } catch (e) { console.warn(e); } }
  async function pullCreations() {
    if (!user) return [];
    const snaps = await F.getDocs(F.collection(db, 'users', user.uid, 'creations'));
    return snaps.docs.map(d => d.data());
  }

  return { enabled, init, profile, user: () => user, signUp, signIn, signOut, resetPassword, changePassword, deleteAccount, saveProfile, pushCreation, pushNow, deleteCreation, pullCreations, friendly };
})();
