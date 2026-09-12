// Cloud accounts (Firebase). Username + password on every device; email is optional (used for reset links
// when present). Password reset without email works through the security question: the account password is
// stored encrypted with a key derived from the answer (PBKDF2 250k + AES-GCM) so the app can sign in and set
// a new password. Firestore layout: users/{uid} profile + users/{uid}/creations, usernames/{name} -> {uid,
// email, realEmail}, recovery/{name} -> {question, salt, iv, blob, uid}.
const Cloud = (() => {
  const V = '11.10.0';
  const FAKE_DOMAIN = 'users.notequest.app';
  const cfg = () => (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) ? window.FIREBASE_CONFIG : null;
  let A = null, F = null, auth = null, db = null, user = null, prof = null, readyP = null, failed = null;
  const saveTimers = new Map();
  // localStorage 'notequest.devLocal' = '1' forces device-only accounts (handy for testing without a cloud login).
  const enabled = () => !!cfg() && !failed && localStorage.getItem('notequest.devLocal') !== '1';
  const profile = () => (user && prof) ? prof : null;
  const lower = n => String(n || '').trim().toLowerCase();
  const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
  const fakeEmail = name => `${lower(name)}@${FAKE_DOMAIN}`;
  const isFake = e => (e || '').endsWith('@' + FAKE_DOMAIN);

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
      if (user) { prof = await loadProfile(user.uid); if (prof) syncUsernameDoc().catch(() => {}); }
      return true;
    })().catch(e => { failed = e; console.warn('Cloud accounts unavailable, using local accounts.', e); return false; });
    return readyP;
  }

  function friendly(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/invalid-credential': 'Wrong username or password.', 'auth/wrong-password': 'Wrong username or password.', 'auth/user-not-found': 'No account with that name.',
      'auth/email-already-in-use': 'That email already has an account.', 'auth/invalid-email': 'That email address does not look right.',
      'auth/weak-password': 'Password needs at least 8 characters.', 'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No internet connection.', 'auth/requires-recent-login': 'Please log out and back in, then try again.',
      'permission-denied': 'The database refused the request. Publish the latest firestore.rules in the Firebase console.',
      'auth/operation-not-allowed': 'That operation is not enabled in the Firebase console.',
      'auth/unauthorized-domain': 'This site is not in the Firebase authorized domains list (Authentication → Settings).',
    };
    if (code.startsWith('auth/api-key-not-valid')) { const err = new Error('The Firebase config in js/firebase-config.js is not valid.'); err.code = code; return err; }
    const err = new Error(map[code] || (e && e.message) || String(e)); err.code = code; return err;
  }
  const strip = c => { const { audioClips, ...rest } = c; return JSON.parse(JSON.stringify(rest)); };
  const D = (...p) => F.doc(db, ...p);

  // ---------- crypto for answer-based recovery ----------
  const enc = s => new TextEncoder().encode(s);
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const normAnswer = a => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
  async function answerKey(answer, salt) {
    const km = await crypto.subtle.importKey('raw', enc(normAnswer(answer)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 250000 }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealPassword(answer, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await answerKey(answer, salt), enc(password));
    return { salt: b64(salt), iv: b64(iv), blob: b64(ct) };
  }
  async function openPassword(answer, rec) {
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, await answerKey(answer, unb64(rec.salt)), unb64(rec.blob));
      return new TextDecoder().decode(pt);
    } catch (e) { const err = new Error('Wrong answer.'); err.code = 'wrong-answer'; throw err; }
  }

  // ---------- profile ----------
  async function loadProfile(uid) {
    const snap = await F.getDoc(D('users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return Object.assign({ id: uid, cloud: true }, d, { email: isFake(user.email) ? '' : user.email });
  }
  async function saveProfile(p, immediate) {
    if (!user) return;
    prof = p;
    const write = async () => { const { id, cloud, email, ...data } = p; data.updatedAt = Date.now(); await F.setDoc(D('users', user.uid), data, { merge: true }); };
    if (immediate) return write();
    clearTimeout(saveTimers.get('profile')); saveTimers.set('profile', setTimeout(() => write().catch(e => console.warn(e)), 800));
  }
  async function syncUsernameDoc() {
    if (!user || !prof || !prof.name) return;
    const ref = D('usernames', lower(prof.name));
    const snap = await F.getDoc(ref);
    const want = { uid: user.uid, email: user.email, realEmail: !isFake(user.email) };
    if (!snap.exists() || snap.data().email !== want.email || snap.data().realEmail !== want.realEmail) await F.setDoc(ref, want);
  }
  async function usernameTaken(name, exceptUid) {
    const snap = await F.getDoc(D('usernames', lower(name)));
    return snap.exists() && snap.data().uid !== exceptUid;
  }
  async function resolveEmail(login) {
    if (isEmail(login)) return login.trim();
    const snap = await F.getDoc(D('usernames', lower(login)));
    if (!snap.exists()) { const err = new Error('No account with that username. If you signed up with an email, log in with the email instead.'); err.code = 'auth/user-not-found'; throw err; }
    return snap.data().email;
  }

  // ---------- auth ----------
  async function signUp({ username, email, password, avatar, securityQ, securityA, stay, newUser }) {
    try {
      const name = username.trim();
      if (await usernameTaken(name)) { const err = new Error('That username is taken.'); err.code = 'username-taken'; throw err; }
      const mail = isEmail(email) ? email.trim() : fakeEmail(name);
      await A.setPersistence(auth, stay ? A.browserLocalPersistence : A.browserSessionPersistence);
      const cred = await A.createUserWithEmailAndPassword(auth, mail, password);
      user = cred.user;
      await A.updateProfile(user, { displayName: name });
      const p = Object.assign(newUser(name, avatar), { id: user.uid, cloud: true, lastLogin: Date.now(), recoveryQ: securityQ });
      await saveProfile(p, true);
      await F.setDoc(D('usernames', lower(name)), { uid: user.uid, email: mail, realEmail: !isFake(mail) });
      await F.setDoc(D('recovery', lower(name)), Object.assign({ uid: user.uid, question: securityQ }, await sealPassword(securityA, password)));
      prof = p; prof.email = isFake(mail) ? '' : mail;
      return prof;
    } catch (e) { throw friendly(e); }
  }
  async function signIn({ login, password, stay }) {
    try {
      const mail = await resolveEmail(login);
      await A.setPersistence(auth, stay ? A.browserLocalPersistence : A.browserSessionPersistence);
      const cred = await A.signInWithEmailAndPassword(auth, mail, password);
      user = cred.user;
      prof = await loadProfile(user.uid);
      if (!prof) throw new Error('This account has no profile yet. Please sign up again.');
      prof.lastLogin = Date.now(); await saveProfile(prof, true);
      syncUsernameDoc().catch(() => {});
      return prof;
    } catch (e) { throw friendly(e); }
  }
  async function signOut() { try { await A.signOut(auth); } catch (e) { /* ignore */ } user = null; prof = null; }

  // Forgot password: what options does this account have?
  async function recoveryInfo(username) {
    try {
      const [u, r] = await Promise.all([F.getDoc(D('usernames', lower(username))), F.getDoc(D('recovery', lower(username)))]);
      if (!u.exists()) { const err = new Error('No account with that username.'); err.code = 'auth/user-not-found'; throw err; }
      return { realEmail: !!u.data().realEmail, email: u.data().realEmail ? u.data().email : '', question: r.exists() ? r.data().question : null };
    } catch (e) { throw friendly(e); }
  }
  async function resetByEmail(username) { try { await A.sendPasswordResetEmail(auth, await resolveEmail(username)); } catch (e) { throw friendly(e); } }
  async function resetByAnswer({ username, answer, newPassword, stay }) {
    try {
      const rec = await F.getDoc(D('recovery', lower(username)));
      if (!rec.exists()) throw new Error('This account has no security question.');
      const oldPassword = await openPassword(answer, rec.data());
      const mail = await resolveEmail(username);
      await A.setPersistence(auth, stay ? A.browserLocalPersistence : A.browserSessionPersistence);
      let cred;
      try { cred = await A.signInWithEmailAndPassword(auth, mail, oldPassword); }
      catch (e) { const err = new Error('The answer is right, but the password was changed another way (probably by email link). Use the email reset instead.'); err.code = 'stale-recovery'; throw err; }
      user = cred.user;
      await A.updatePassword(user, newPassword);
      await F.setDoc(D('recovery', lower(username)), Object.assign({ uid: user.uid, question: rec.data().question }, await sealPassword(answer, newPassword)));
      prof = await loadProfile(user.uid);
      if (prof) { prof.lastLogin = Date.now(); await saveProfile(prof, true); }
      return prof;
    } catch (e) { throw friendly(e); }
  }
  async function reauth(password) { const cred = A.EmailAuthProvider.credential(user.email, password); await A.reauthenticateWithCredential(user, cred); }
  async function changePassword(current, next, answer) {
    try {
      await reauth(current);
      const rec = await F.getDoc(D('recovery', lower(prof.name)));
      if (rec.exists()) {
        if (!answer) { const err = new Error('Enter your security answer so password recovery keeps working.'); err.code = 'need-answer'; throw err; }
        await openPassword(answer, rec.data()); // proves the answer before anything changes
        await A.updatePassword(user, next);
        await F.setDoc(D('recovery', lower(prof.name)), Object.assign({ uid: user.uid, question: rec.data().question }, await sealPassword(answer, next)));
      } else await A.updatePassword(user, next);
    } catch (e) { throw friendly(e); }
  }
  async function setSecurityQuestion(password, question, answer) {
    try {
      await reauth(password);
      await F.setDoc(D('recovery', lower(prof.name)), Object.assign({ uid: user.uid, question }, await sealPassword(answer, password)));
      prof.recoveryQ = question; await saveProfile(prof, true);
    } catch (e) { throw friendly(e); }
  }
  async function changeUsername(newName) {
    try {
      const name = newName.trim();
      if (await usernameTaken(name, user.uid)) { const err = new Error('That username is taken.'); err.code = 'username-taken'; throw err; }
      const oldKey = lower(prof.name), newKey = lower(name);
      const rec = await F.getDoc(D('recovery', oldKey));
      await F.setDoc(D('usernames', newKey), { uid: user.uid, email: user.email, realEmail: !isFake(user.email) });
      if (rec.exists()) await F.setDoc(D('recovery', newKey), rec.data());
      if (newKey !== oldKey) { await F.deleteDoc(D('usernames', oldKey)); if (rec.exists()) await F.deleteDoc(D('recovery', oldKey)); }
      prof.name = name; await A.updateProfile(user, { displayName: name }); await saveProfile(prof, true);
    } catch (e) { throw friendly(e); }
  }
  // Changing email: Firebase sends a verification link to the new address; the change applies when it is clicked.
  async function changeEmail(password, newEmail) {
    try {
      if (!isEmail(newEmail)) throw new Error('That email address does not look right.');
      await reauth(password);
      await A.verifyBeforeUpdateEmail(user, newEmail.trim());
    } catch (e) { throw friendly(e); }
  }
  async function deleteAccount(password) {
    try {
      await reauth(password);
      const snaps = await F.getDocs(F.collection(db, 'users', user.uid, 'creations'));
      for (const d of snaps.docs) await F.deleteDoc(d.ref);
      const key = lower(prof && prof.name);
      if (key) { await F.deleteDoc(D('usernames', key)).catch(() => {}); await F.deleteDoc(D('recovery', key)).catch(() => {}); }
      await F.deleteDoc(D('users', user.uid));
      await A.deleteUser(user); user = null; prof = null;
    } catch (e) { throw friendly(e); }
  }

  // ---------- study sets ----------
  function pushCreation(c) {
    if (!user || !c || c.owner !== user.uid) return;
    clearTimeout(saveTimers.get(c.id));
    saveTimers.set(c.id, setTimeout(() => { const data = strip(c); data.updatedAt = Date.now(); F.setDoc(D('users', user.uid, 'creations', c.id), data).catch(e => console.warn('Cloud save failed', e)); }, 1200));
  }
  async function pushNow(c) { if (!user) return; const data = strip(c); data.updatedAt = Date.now(); await F.setDoc(D('users', user.uid, 'creations', c.id), data); }
  async function deleteCreation(id) { if (!user) return; try { await F.deleteDoc(D('users', user.uid, 'creations', id)); } catch (e) { console.warn(e); } }
  async function pullCreations() { if (!user) return []; const snaps = await F.getDocs(F.collection(db, 'users', user.uid, 'creations')); return snaps.docs.map(d => d.data()); }

  return { enabled, init, profile, user: () => user, signUp, signIn, signOut, recoveryInfo, resetByEmail, resetByAnswer, changePassword, setSecurityQuestion, changeUsername, changeEmail, deleteAccount, saveProfile, pushCreation, pushNow, deleteCreation, pullCreations, friendly, isEmail };
})();
