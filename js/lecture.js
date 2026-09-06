// Lecture mode: Claude writes a spoken lecture from the set. Audio is generated ONCE per lecture (never on
// tap) by AudioGen: published Kokoro clips from audio/manifest.json, clips saved on this device, the optional
// local helper, or Kokoro running in the browser. The transcript highlights the sentence and word being spoken.
const Lecture = (() => {
  const I = Icons.icon;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SPEEDS = [[0.8, 'Slow'], [1, 'Normal'], [1.15, 'Brisk'], [1.35, 'Fast'], [1.6, 'Very fast']];
  const hasTTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const MANIFEST_URL = 'audio/manifest.json';

  // Must match tools/audio_common.py exactly: published audio files are named by the sha256 of these sentences.
  function splitSentences(text) {
    const parts = text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) || [text];
    return parts.map(s => s.trim()).filter(Boolean);
  }
  function words(text) {
    const out = []; const re = /\S+/g; let m;
    while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    return out;
  }
  // "Microsoft Ryan Online (Natural) - English (United Kingdom)" -> "Ryan (UK) · natural"
  const REGION = { 'en-GB': 'UK', 'en-US': 'US', 'en-AU': 'Australia', 'en-CA': 'Canada', 'en-IN': 'India', 'en-IE': 'Ireland', 'en-NZ': 'New Zealand', 'en-ZA': 'South Africa' };
  function friendlyVoice(v) {
    const natural = /natural/i.test(v.name);
    let name = v.name.replace(/^(Microsoft|Google|Apple)\s+/i, '').replace(/\s*\(Natural\)\s*/i, ' ').replace(/\s*Online\s*/i, ' ')
      .replace(/\s+-\s+.*$/, '').replace(/\s+(English|Desktop).*$/i, '').trim() || v.name;
    return `${name} (${REGION[v.lang] || v.lang})${natural ? ' · natural' : ''}`;
  }
  let manifestPromise = null;
  function loadManifest() {
    if (!manifestPromise) manifestPromise = fetch(MANIFEST_URL, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    return manifestPromise;
  }

  function render(root, c, ctx) {
    const st = { playing: false, idx: 0, rate: +(ctx.settings.lectureRate || 1), voice: ctx.settings.lectureVoice || 'kokoro', timers: [], utter: null, tick: null, finished: false, credited: false, token: 0 };
    let sentences = [], manifest = null, covered = 0, objectUrls = [];
    const audioEl = new Audio(); audioEl.preload = 'auto';
    const preloadEl = new Audio(); preloadEl.preload = 'auto';

    function stopAll() {
      st.token++;
      st.timers.forEach(clearTimeout); st.timers = [];
      clearInterval(st.tick); st.tick = null;
      audioEl.onended = audioEl.onerror = audioEl.ontimeupdate = null; audioEl.pause();
      if (hasTTS) { st.utter = null; speechSynthesis.cancel(); }
    }
    const cleanup = () => { stopAll(); audioEl.removeAttribute('src'); audioEl.load(); objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls = []; };

    if (!c.lecture) generate(); else build();
    return cleanup;

    async function generate() {
      root.innerHTML = `<div class="lec-loading"><span class="spinner"></span><p>Writing your lecture with Claude… this takes about half a minute.</p></div>`;
      try {
        const r = await ctx.generate();
        const sections = (r.sections || []).map(s => ({ heading: String(s.heading || '').trim(), paragraphs: (s.paragraphs || []).map(p => String(p).trim()).filter(Boolean) })).filter(s => s.paragraphs.length);
        if (!sections.length) throw new Error('Claude returned an empty lecture. Please try again.');
        c.lecture = { title: r.title || c.name, sections, createdAt: Date.now(), model: r._model };
        c.audioClips = {};
        await ctx.save(c);
        build();
      } catch (e) {
        root.innerHTML = `<div class="error ${e.kind === 'credits' ? 'credits' : ''}">${e.kind === 'credits' ? I('key') : ''}<div>${esc(e.message)}${e.link ? ` <a class="btn primary small" href="${esc(e.link)}" target="_blank" rel="noopener">Add credits</a>` : ''}${e.kind === 'auth' ? ' <a class="btn ghost small" href="#settings">Open Settings</a>' : ''}</div></div>
          <div class="row center"><button class="btn primary" id="retry">${I('switch')} Try again</button><a class="btn ghost" href="#creations">Back</a></div>`;
        root.querySelector('#retry').onclick = generate;
      }
    }

    async function build() {
      sentences = [];
      const L = c.lecture;
      const html = L.sections.map(sec => `<h3 class="lec-heading">${esc(sec.heading)}</h3>` + sec.paragraphs.map(p => `<p>${splitSentences(p).map(s => {
        const i = sentences.length; sentences.push({ text: s, words: words(s), audio: null });
        return `<span class="sent" data-s="${i}">${sentences[i].words.map((w, wi) => `<span class="w" data-w="${wi}">${esc(w.text)}</span>`).join(' ')}</span>`;
      }).join(' ')}</p>`).join('')).join('');
      const totalWords = sentences.reduce((n, s) => n + s.words.length, 0);
      root.innerHTML = `<div class="lecture">
        <div class="lec-controls">
          <button class="btn primary" id="play">${I('play')} Play</button>
          <button class="btn ghost" id="restart" title="Restart">${I('skipBack')}</button>
          <label class="lec-sel">${I('timer')}<select class="input" id="rate">${SPEEDS.map(([v, l]) => `<option value="${v}" ${v === st.rate ? 'selected' : ''}>${l} (${v}x)</option>`).join('')}</select></label>
          <label class="lec-sel" id="voice-wrap">${I('volume')}<select class="input" id="voice"></select></label>
          <button class="btn ghost" id="regen" title="Rewrite the lecture with Claude">${I('switch')} Rewrite</button>
        </div>
        <div class="progress"><i id="lec-bar" style="width:0%"></i></div>
        <div class="lec-meta"><span>${sentences.length} sentences · about ${Math.max(1, Math.round(totalWords / 150))} min</span><span id="lec-status">Checking audio…</span></div>
        <div class="lec-audio-note" id="audio-note" hidden></div>
        <article class="lec-transcript" id="tr"><h2>${esc(L.title)}</h2>${html}</article>
      </div>`;
      wireControls();
      root.querySelectorAll('.sent').forEach(el => el.onclick = () => jump(+el.dataset.s));
      mark();
      await attachAudio();
    }

    // Attach clips: published manifest first, then clips saved on this device. Then generate whatever is missing.
    async function attachAudio() {
      manifest = await loadManifest();
      const entries = (manifest && manifest.sentences) || {};
      const hashes = await Promise.all(sentences.map(s => AudioGen.sha256(s.text)));
      sentences.forEach((s, i) => { s.hash = hashes[i]; });
      refreshClips(entries);
      fillVoices(); updateStatus();
      if (covered < sentences.length) {
        const note = root.querySelector('#audio-note');
        note.hidden = false;
        const setNote = (p, extra = '') => { note.innerHTML = `${p.phase === 'error' ? I('info') : '<span class="spinner"></span>'}<div><b>${esc(p.text)}</b>${extra}${p.total ? `<div class="mini-progress"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></div>` : ''}</div>`; };
        setNote({ text: 'Preparing audio…' });
        try {
          await AudioGen.ensure(c, { save: ctx.save, onProgress: p => { setNote(p); refreshClips(entries); updateStatus(); } });
          refreshClips(entries); note.hidden = true; updateStatus(); fillVoices();
          if (!st.playing) preload(st.idx);
        } catch (e) {
          setNote({ phase: 'error', text: 'Could not generate audio: ' + (e.message || e) }, `<div class="hint">${hasTTS ? 'A browser voice will read the missing sentences for now.' : 'Missing sentences will scroll silently.'} <a href="#" id="retry-audio">Try again</a></div>`);
          const r = note.querySelector('#retry-audio'); if (r) r.onclick = ev => { ev.preventDefault(); attachAudio(); };
          fillVoices(); updateStatus();
        }
      }
    }
    function refreshClips(entries) {
      covered = 0;
      sentences.forEach(s => {
        if (s.audio) { covered++; return; }
        const pub = s.hash && entries[s.hash];
        if (pub && pub.file && Array.isArray(pub.words) && pub.words.length === s.words.length) { s.audio = { file: pub.file, words: pub.words, dur: pub.dur, src: 'published' }; covered++; return; }
        const k = s.hash && c.audioClips && c.audioClips[s.hash];
        if (AudioGen.validClip(k) && k.words.length === s.words.length) { const u = URL.createObjectURL(k.blob); objectUrls.push(u); s.audio = { file: u, words: k.words, dur: k.dur, src: k.src, approx: k.approx }; covered++; }
      });
    }
    function preload(i) { const s = sentences[i]; if (s && s.audio && st.voice === 'kokoro') { preloadEl.src = s.audio.file; } }
    function usingBrowserVoice() { return hasTTS && st.voice !== 'kokoro'; }
    function browserVoice() { return speechSynthesis.getVoices().find(v => v.voiceURI === st.voice) || null; }
    function updateStatus() {
      const kv = (manifest && manifest.voice) || ctx.settings.kokoroVoice || AudioGen.DEFAULT_VOICE;
      if (st.voice === 'kokoro') setStatus(covered === sentences.length ? `Audio ready · Kokoro ${esc(kv)}` : `Kokoro audio for ${covered}/${sentences.length} sentences`);
      else if (usingBrowserVoice()) { const v = browserVoice(); setStatus('Voice: ' + esc(v ? friendlyVoice(v) : 'browser default')); }
      else setStatus(hasTTS ? 'Browser voice' : 'Silent mode');
    }
    // Voice menu: Kokoro first, then US/UK English browser voices with friendly names (natural first, max eight).
    function fillVoices() {
      const sel = root.querySelector('#voice'); if (!sel) return;
      const opts = [['kokoro', `Kokoro ${(manifest && manifest.voice) || ctx.settings.kokoroVoice || AudioGen.DEFAULT_VOICE}`]];
      if (hasTTS) {
        const all = speechSynthesis.getVoices();
        const norm = v => (v.lang || '').replace('_', '-').toLowerCase();
        let keep = all.filter(v => ['en-us', 'en-gb'].includes(norm(v)));
        if (!keep.length) keep = all.filter(v => norm(v).startsWith('en'));
        const byQuality = (a, b) => (/natural/i.test(b.name) - /natural/i.test(a.name)) || friendlyVoice(a).localeCompare(friendlyVoice(b));
        keep.sort(byQuality).slice(0, 8).forEach(v => opts.push([v.voiceURI, friendlyVoice(v)]));
      }
      if (!opts.some(o => o[0] === st.voice)) st.voice = 'kokoro';
      sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === st.voice ? 'selected' : ''}>${esc(l)}</option>`).join('');
    }

    function wireControls() {
      root.querySelector('#play').onclick = () => st.playing ? pause() : play();
      root.querySelector('#restart').onclick = () => { stopAll(); st.idx = 0; st.finished = false; clearMarks(); mark(); if (st.playing) speak(); };
      root.querySelector('#rate').onchange = e => { st.rate = +e.target.value; ctx.saveSettings({ lectureRate: st.rate }); audioEl.playbackRate = st.rate; if (st.playing && usingBrowserVoice()) { stopAll(); speak(); } };
      root.querySelector('#voice').onchange = e => { st.voice = e.target.value; ctx.saveSettings({ lectureVoice: st.voice }); updateStatus(); if (st.playing) { stopAll(); speak(); } };
      root.querySelector('#regen').onclick = async () => {
        if (!(await ctx.confirm('Rewrite this lecture?', 'Claude will write a fresh lecture from your notes. This uses a little API credit, and audio will be generated again.'))) return;
        stopAll(); st.playing = false; c.lecture = null; generate();
      };
      if (hasTTS) speechSynthesis.onvoiceschanged = () => { fillVoices(); updateStatus(); };
    }

    function setStatus(t) { const el = root.querySelector('#lec-status'); if (el) el.innerHTML = t; }
    function play() {
      if (st.finished) { st.idx = 0; st.finished = false; clearMarks(); }
      st.playing = true;
      root.querySelector('#play').innerHTML = `${I('pause')} Pause`;
      speak();
    }
    function pause() {
      st.playing = false; stopAll();
      root.querySelector('#play').innerHTML = `${I('play')} Resume`;
    }
    function jump(i) { st.idx = i; st.finished = false; mark(); if (st.playing) { stopAll(); speak(); } else preload(i); }
    function finish() {
      st.playing = false; st.finished = true; stopAll();
      root.querySelector('#play').innerHTML = `${I('play')} Play again`;
      root.querySelector('#lec-bar').style.width = '100%';
      setStatus('Lecture complete');
      if (!st.credited) { st.credited = true; ctx.done({ type: 'lecture', sentences: sentences.length }); }
    }

    function clearMarks() { root.querySelectorAll('.sent.current, .sent.spoken').forEach(e => e.classList.remove('current', 'spoken')); root.querySelectorAll('.w.current, .w.spoken').forEach(e => e.classList.remove('current', 'spoken')); }
    function mark() {
      const cur = root.querySelector(`.sent[data-s="${st.idx}"]`); if (!cur) return;
      root.querySelectorAll('.sent').forEach(el => { const i = +el.dataset.s; el.classList.toggle('current', i === st.idx); el.classList.toggle('spoken', i < st.idx); el.querySelectorAll('.w').forEach(w => { w.classList.toggle('spoken', i < st.idx); w.classList.remove('current'); }); });
      const bar = root.querySelector('#lec-bar'); if (bar) bar.style.width = Math.round(st.idx / sentences.length * 100) + '%';
      const r = cur.getBoundingClientRect(), vh = window.innerHeight;
      if (r.top < vh * 0.25 || r.bottom > vh * 0.8) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    function markWord(wi) {
      const cur = root.querySelector(`.sent[data-s="${st.idx}"]`); if (!cur) return;
      cur.querySelectorAll('.w').forEach((w, i) => { w.classList.toggle('current', i === wi); w.classList.toggle('spoken', i < wi); });
    }

    function next() { st.idx++; speak(); }
    async function speak() {
      if (st.idx >= sentences.length) return finish();
      mark();
      const s = sentences[st.idx];
      if (st.voice === 'kokoro') {
        // If this sentence's clip is still being generated, wait for it rather than switching voices mid-lecture.
        if (!s.audio && AudioGen.jobFor(c.id)) {
          const token = st.token; setStatus('Waiting for audio…');
          while (!s.audio && AudioGen.jobFor(c.id) && token === st.token) { await new Promise(r => setTimeout(r, 300)); refreshClips((manifest && manifest.sentences) || {}); }
          if (token !== st.token) return;
          updateStatus();
        }
        if (s.audio) return playFile(s);
      }
      if (hasTTS) return speakBrowser(s);
      speakSilently(s);
    }

    // Kokoro clip: play the file and track words from its timings.
    function playFile(s) {
      const token = ++st.token;
      audioEl.src = s.audio.file;
      audioEl.playbackRate = st.rate;
      audioEl.onended = () => { if (token === st.token && st.playing) next(); };
      audioEl.onerror = () => { if (token !== st.token) return; s.audio = null; setStatus('Audio clip failed; using fallback'); speak(); };
      let lastWi = -1;
      const tick = () => {
        if (token !== st.token) return;
        const t = audioEl.currentTime;
        let wi = -1; const W = s.audio.words;
        for (let i = 0; i < W.length; i++) if (t >= W[i][0]) wi = i; else break;
        if (wi >= 0 && wi !== lastWi) { lastWi = wi; markWord(wi); }
      };
      audioEl.ontimeupdate = tick;
      audioEl.play().then(() => { clearInterval(st.tick); st.tick = setInterval(tick, 50); preload(st.idx + 1); })
        .catch(() => { if (token === st.token) { setStatus('Tap Play again to allow audio'); pause(); } });
    }

    // Browser speech synthesis (chosen voice, or fallback when a clip is unavailable).
    function speakBrowser(s) {
      const u = new SpeechSynthesisUtterance(s.text);
      u.rate = st.rate;
      const voice = browserVoice(); if (voice) u.voice = voice;
      let sawBoundary = false;
      u.onboundary = e => {
        if (st.utter !== u || (e.name && e.name !== 'word')) return;
        if (!sawBoundary) { sawBoundary = true; st.timers.forEach(clearTimeout); st.timers = []; }
        const wi = s.words.findIndex(w => e.charIndex >= w.start && e.charIndex < w.end);
        if (wi >= 0) markWord(wi);
      };
      u.onstart = () => { st.timers.push(setTimeout(() => { if (!sawBoundary && st.utter === u && st.playing) scheduleWords(s, 60000 / (165 * st.rate)); }, 450)); };
      u.onend = () => { if (st.utter !== u || !st.playing) return; st.timers.forEach(clearTimeout); st.timers = []; next(); };
      u.onerror = e => { if (st.utter !== u || ['interrupted', 'canceled'].includes(e.error)) return; speakSilently(s); };
      st.utter = u;
      speechSynthesis.speak(u);
    }
    function scheduleWords(s, perWord) {
      st.timers.forEach(clearTimeout); st.timers = [];
      s.words.forEach((w, i) => st.timers.push(setTimeout(() => { if (st.playing && sentences[st.idx] === s) markWord(i); }, i * perWord)));
    }
    function speakSilently(s) {
      const perWord = 60000 / (165 * st.rate);
      scheduleWords(s, perWord);
      st.timers.push(setTimeout(() => { if (st.playing && sentences[st.idx] === s) next(); }, s.words.length * perWord + 250));
    }
  }

  return { render, hasTTS, splitSentences, loadManifest };
})();
