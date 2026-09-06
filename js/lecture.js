// Lecture mode: Claude writes a spoken lecture from the set; the browser's text-to-speech reads it
// while the transcript highlights the sentence and word being spoken.
const Lecture = (() => {
  const I = Icons.icon;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SPEEDS = [[0.8, 'Slow'], [1, 'Normal'], [1.15, 'Brisk'], [1.35, 'Fast'], [1.6, 'Very fast']];
  const hasTTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  function splitSentences(text) {
    const parts = text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) || [text];
    return parts.map(s => s.trim()).filter(Boolean);
  }
  function words(text) {
    const out = []; const re = /\S+/g; let m;
    while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    return out;
  }

  function render(root, c, ctx) {
    const st = { playing: false, idx: 0, word: -1, rate: +(ctx.settings.lectureRate || 1), voiceURI: ctx.settings.lectureVoice || '', timers: [], utter: null, finished: false, credited: false };
    let sentences = [];

    function stopAll() {
      st.timers.forEach(clearTimeout); st.timers = [];
      if (hasTTS) { st.utter = null; speechSynthesis.cancel(); }
    }
    const cleanup = () => { stopAll(); };

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

    function build() {
      sentences = [];
      const L = c.lecture;
      const html = L.sections.map(sec => `<h3 class="lec-heading">${esc(sec.heading)}</h3>` + sec.paragraphs.map(p => `<p>${splitSentences(p).map(s => {
        const i = sentences.length; sentences.push({ text: s, words: words(s) });
        return `<span class="sent" data-s="${i}">${sentences[i].words.map((w, wi) => `<span class="w" data-w="${wi}">${esc(w.text)}</span>`).join(' ')}</span>`;
      }).join(' ')}</p>`).join('')).join('');
      const totalWords = sentences.reduce((n, s) => n + s.words.length, 0);
      root.innerHTML = `<div class="lecture">
        <div class="lec-controls">
          <button class="btn primary" id="play">${I('play')} Play</button>
          <button class="btn ghost" id="restart" title="Restart">${I('skipBack')}</button>
          <label class="lec-sel">${I('timer')}<select class="input" id="rate">${SPEEDS.map(([v, l]) => `<option value="${v}" ${v === st.rate ? 'selected' : ''}>${l} (${v}x)</option>`).join('')}</select></label>
          <label class="lec-sel">${I('volume')}<select class="input" id="voice"><option value="">Default voice</option></select></label>
          <button class="btn ghost" id="regen" title="Rewrite the lecture with Claude">${I('switch')} Rewrite</button>
        </div>
        <div class="progress"><i id="lec-bar" style="width:0%"></i></div>
        <div class="lec-meta"><span>${sentences.length} sentences · about ${Math.max(1, Math.round(totalWords / 150))} min</span><span id="lec-status">${hasTTS ? 'Press Play to start' : 'No text-to-speech voices in this browser; the transcript will scroll on its own'}</span></div>
        <article class="lec-transcript" id="tr"><h2>${esc(L.title)}</h2>${html}</article>
      </div>`;
      wireControls();
      root.querySelectorAll('.sent').forEach(el => el.onclick = () => jump(+el.dataset.s));
      mark();
    }

    function wireControls() {
      root.querySelector('#play').onclick = () => st.playing ? pause() : play();
      root.querySelector('#restart').onclick = () => { stopAll(); st.idx = 0; st.word = -1; st.finished = false; clearMarks(); mark(); if (st.playing) speak(); };
      root.querySelector('#rate').onchange = e => { st.rate = +e.target.value; ctx.saveSettings({ lectureRate: st.rate }); if (st.playing) { stopAll(); speak(); } };
      const voiceSel = root.querySelector('#voice');
      voiceSel.onchange = e => { st.voiceURI = e.target.value; ctx.saveSettings({ lectureVoice: st.voiceURI }); if (st.playing) { stopAll(); speak(); } };
      root.querySelector('#regen').onclick = async () => {
        if (!(await ctx.confirm('Rewrite this lecture?', 'Claude will write a fresh lecture from your notes. This uses a little API credit.'))) return;
        stopAll(); st.playing = false; c.lecture = null; generate();
      };
      if (hasTTS) { fillVoices(); speechSynthesis.onvoiceschanged = fillVoices; }
      function fillVoices() {
        const all = speechSynthesis.getVoices();
        if (!all.length) return;
        const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
        const sorted = [...all].sort((a, b) => (b.lang.toLowerCase().startsWith(lang) - a.lang.toLowerCase().startsWith(lang)) || (b.localService - a.localService) || a.name.localeCompare(b.name));
        voiceSel.innerHTML = `<option value="">Default voice</option>` + sorted.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === st.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
      }
    }

    function setStatus(t) { const el = root.querySelector('#lec-status'); if (el) el.textContent = t; }
    function play() {
      if (st.finished) { st.idx = 0; st.word = -1; st.finished = false; clearMarks(); }
      st.playing = true;
      root.querySelector('#play').innerHTML = `${I('pause')} Pause`;
      setStatus('Playing');
      speak();
    }
    function pause() {
      st.playing = false; stopAll();
      root.querySelector('#play').innerHTML = `${I('play')} Resume`;
      setStatus('Paused. Click any sentence to jump there.');
    }
    function jump(i) { st.idx = i; st.word = -1; st.finished = false; mark(); if (st.playing) { stopAll(); speak(); } }
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
      st.word = wi;
    }

    function speak() {
      if (st.idx >= sentences.length) return finish();
      mark();
      const s = sentences[st.idx];
      if (!hasTTS) return speakSilently(s);
      const u = new SpeechSynthesisUtterance(s.text);
      u.rate = st.rate;
      const voice = speechSynthesis.getVoices().find(v => v.voiceURI === st.voiceURI); if (voice) u.voice = voice;
      let sawBoundary = false;
      u.onboundary = e => {
        if (e.name && e.name !== 'word') return;
        sawBoundary = true;
        const wi = s.words.findIndex(w => e.charIndex >= w.start && e.charIndex < w.end);
        if (wi >= 0) markWord(wi);
      };
      u.onstart = () => { if (!sawBoundary) scheduleWords(s, 60000 / (165 * st.rate)); };
      u.onend = () => { if (st.utter !== u || !st.playing) return; st.timers.forEach(clearTimeout); st.timers = []; st.idx++; st.word = -1; speak(); };
      u.onerror = e => {
        if (st.utter !== u || ['interrupted', 'canceled'].includes(e.error)) return;
        setStatus('Speech failed in this browser; continuing silently.');
        speakSilently(s);
      };
      st.utter = u;
      speechSynthesis.speak(u);
    }
    // Word timers used when the browser gives no boundary events (or has no voices at all).
    function scheduleWords(s, perWord) {
      st.timers.forEach(clearTimeout); st.timers = [];
      s.words.forEach((w, i) => st.timers.push(setTimeout(() => { if (st.playing && sentences[st.idx] === s) markWord(i); }, i * perWord)));
    }
    function speakSilently(s) {
      const perWord = 60000 / (165 * st.rate);
      scheduleWords(s, perWord);
      st.timers.push(setTimeout(() => { if (!st.playing || sentences[st.idx] !== s) return; st.idx++; st.word = -1; speak(); }, s.words.length * perWord + 250));
    }
  }

  return { render, hasTTS };
})();
