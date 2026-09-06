// Lecture mode: Claude writes a spoken lecture from the set. Audio is PRE-GENERATED with Kokoro
// (tools/make_audio.py) into audio/<sha256 of sentence>.opus and listed in audio/manifest.json; the
// app just plays those files and highlights each word from the manifest's timings. Sentences with no
// pre-generated audio fall back to the browser's own voice (if it has one) or a silent timed scroll.
const Lecture = (() => {
  const I = Icons.icon;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SPEEDS = [[0.8, 'Slow'], [1, 'Normal'], [1.15, 'Brisk'], [1.35, 'Fast'], [1.6, 'Very fast']];
  const hasTTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const MANIFEST_URL = 'audio/manifest.json';

  // Must match tools/audio_common.py exactly: audio files are named by the sha256 of these sentences.
  function splitSentences(text) {
    const parts = text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) || [text];
    return parts.map(s => s.trim()).filter(Boolean);
  }
  function words(text) {
    const out = []; const re = /\S+/g; let m;
    while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    return out;
  }
  async function sha256(text) {
    if (!crypto.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let manifestPromise = null;
  function loadManifest() {
    if (!manifestPromise) manifestPromise = fetch(MANIFEST_URL, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    return manifestPromise;
  }

  function render(root, c, ctx) {
    const st = { playing: false, idx: 0, rate: +(ctx.settings.lectureRate || 1), voiceURI: ctx.settings.lectureVoice || '', timers: [], utter: null, tick: null, finished: false, credited: false, token: 0 };
    let sentences = [], manifest = null, covered = 0;
    const audioEl = new Audio(); audioEl.preload = 'auto';
    const preloadEl = new Audio(); preloadEl.preload = 'auto';

    function stopAll() {
      st.token++;
      st.timers.forEach(clearTimeout); st.timers = [];
      clearInterval(st.tick); st.tick = null;
      audioEl.onended = audioEl.onerror = null; audioEl.pause();
      if (hasTTS) { st.utter = null; speechSynthesis.cancel(); }
    }
    const cleanup = () => { stopAll(); audioEl.removeAttribute('src'); audioEl.load(); };

    if (!c.lecture) generate(); else build();
    return cleanup;

    async function generate() {
      root.innerHTML = `<div class="lec-loading"><span class="spinner"></span><p>Writing your lecture with Claude… this takes about half a minute.</p></div>`;
      try {
        const r = await ctx.generate();
        const sections = (r.sections || []).map(s => ({ heading: String(s.heading || '').trim(), paragraphs: (s.paragraphs || []).map(p => String(p).trim()).filter(Boolean) })).filter(s => s.paragraphs.length);
        if (!sections.length) throw new Error('Claude returned an empty lecture. Please try again.');
        c.lecture = { title: r.title || c.name, sections, createdAt: Date.now(), model: r._model };
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
          <button class="btn primary" id="play" disabled>${I('play')} Play</button>
          <button class="btn ghost" id="restart" title="Restart">${I('skipBack')}</button>
          <label class="lec-sel">${I('timer')}<select class="input" id="rate">${SPEEDS.map(([v, l]) => `<option value="${v}" ${v === st.rate ? 'selected' : ''}>${l} (${v}x)</option>`).join('')}</select></label>
          <label class="lec-sel" id="voice-wrap" hidden>${I('volume')}<select class="input" id="voice"><option value="">Browser voice</option></select></label>
          <button class="btn ghost" id="export" title="Download this lecture's text so tools/make_audio.py can generate its audio">${I('download')} For audio</button>
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

    // Look every sentence up in the manifest by the hash of its text.
    async function attachAudio() {
      manifest = await loadManifest();
      const entries = (manifest && manifest.sentences) || {};
      const hashes = await Promise.all(sentences.map(s => sha256(s.text)));
      covered = 0;
      sentences.forEach((s, i) => {
        const e = hashes[i] && entries[hashes[i]];
        if (e && e.file && Array.isArray(e.words) && e.words.length === s.words.length) { s.audio = e; covered++; }
        s.hash = hashes[i];
      });
      const missing = sentences.length - covered;
      const note = root.querySelector('#audio-note');
      const play = root.querySelector('#play'); if (play) play.disabled = false;
      if (missing === 0) {
        setStatus(`Audio ready · Kokoro ${esc((manifest && manifest.voice) || '')}`);
      } else {
        root.querySelector('#voice-wrap').hidden = !hasTTS;
        note.hidden = false;
        note.innerHTML = `${I('volume')}<div><b>${covered ? `${missing} of ${sentences.length} sentences have no pre-generated audio.` : 'This lecture has no pre-generated audio yet.'}</b>
          ${hasTTS ? 'Those sentences will use your browser\'s built-in voice for now.' : 'Your browser has no built-in voice, so those sentences will scroll silently.'}
          To add real audio: press <b>For audio</b>, then run <code>tools/make_audio.py</code> on the downloaded file and push the <code>audio/</code> folder.</div>`;
        setStatus(covered ? `Audio for ${covered}/${sentences.length} sentences` : (hasTTS ? 'Browser voice fallback' : 'Silent mode'));
      }
      preload(st.idx);
    }
    function preload(i) { const s = sentences[i]; if (s && s.audio) { preloadEl.src = s.audio.file; } }

    function wireControls() {
      root.querySelector('#play').onclick = () => st.playing ? pause() : play();
      root.querySelector('#restart').onclick = () => { stopAll(); st.idx = 0; st.finished = false; clearMarks(); mark(); if (st.playing) speak(); };
      root.querySelector('#rate').onchange = e => { st.rate = +e.target.value; ctx.saveSettings({ lectureRate: st.rate }); audioEl.playbackRate = st.rate; if (st.playing && !sentences[st.idx]?.audio) { stopAll(); speak(); } };
      const voiceSel = root.querySelector('#voice');
      voiceSel.onchange = e => { st.voiceURI = e.target.value; ctx.saveSettings({ lectureVoice: st.voiceURI }); if (st.playing && !sentences[st.idx]?.audio) { stopAll(); speak(); } };
      root.querySelector('#export').onclick = () => ctx.exportForAudio(c);
      root.querySelector('#regen').onclick = async () => {
        if (!(await ctx.confirm('Rewrite this lecture?', 'Claude will write a fresh lecture from your notes. This uses a little API credit, and the new sentences will need audio generated again.'))) return;
        stopAll(); st.playing = false; c.lecture = null; generate();
      };
      if (hasTTS) { fillVoices(); speechSynthesis.onvoiceschanged = fillVoices; }
      function fillVoices() {
        const all = speechSynthesis.getVoices();
        if (!all.length) return;
        const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
        const sorted = [...all].sort((a, b) => (b.lang.toLowerCase().startsWith(lang) - a.lang.toLowerCase().startsWith(lang)) || (b.localService - a.localService) || a.name.localeCompare(b.name));
        voiceSel.innerHTML = `<option value="">Browser voice</option>` + sorted.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === st.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
      }
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
    function speak() {
      if (st.idx >= sentences.length) return finish();
      mark();
      const s = sentences[st.idx];
      if (s.audio) return playFile(s);
      if (!hasTTS) return speakSilently(s);
      speakBrowser(s);
    }

    // Pre-generated Kokoro clip: play the file and track words from the manifest timings.
    function playFile(s) {
      const token = ++st.token;
      audioEl.src = s.audio.file;
      audioEl.playbackRate = st.rate;
      audioEl.onended = () => { if (token === st.token && st.playing) next(); };
      audioEl.onerror = () => { if (token !== st.token) return; setStatus('Audio file missing; using fallback'); s.audio = null; speak(); };
      let lastWi = -1;
      const tick = () => {
        if (token !== st.token) return;
        const t = audioEl.currentTime;
        let wi = -1; const W = s.audio.words;
        for (let i = 0; i < W.length; i++) if (t >= W[i][0]) wi = i; else break;
        if (wi >= 0 && wi !== lastWi) { lastWi = wi; markWord(wi); }
      };
      audioEl.ontimeupdate = tick; // fires even in background tabs; the interval keeps it smooth in the foreground
      audioEl.play().then(() => { clearInterval(st.tick); st.tick = setInterval(tick, 50); preload(st.idx + 1); })
        .catch(() => { if (token === st.token) { setStatus('Tap Play again to allow audio'); pause(); } });
    }

    // Browser speech synthesis fallback (only for sentences without a pre-generated clip).
    function speakBrowser(s) {
      const u = new SpeechSynthesisUtterance(s.text);
      u.rate = st.rate;
      const voice = speechSynthesis.getVoices().find(v => v.voiceURI === st.voiceURI); if (voice) u.voice = voice;
      let sawBoundary = false;
      u.onboundary = e => {
        if (st.utter !== u || (e.name && e.name !== 'word')) return;
        if (!sawBoundary) { sawBoundary = true; st.timers.forEach(clearTimeout); st.timers = []; } // real word events win over the backup timers
        const wi = s.words.findIndex(w => e.charIndex >= w.start && e.charIndex < w.end);
        if (wi >= 0) markWord(wi);
      };
      // Some browsers never send word boundaries; if none arrives shortly after start, fall back to timed highlighting.
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

  return { render, hasTTS, splitSentences };
})();
