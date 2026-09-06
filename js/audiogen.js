// Generates lecture audio automatically and keeps it in the creation (IndexedDB), so Play never synthesizes.
// Sources, in order: clips already published in audio/manifest.json (exact word timings), clips already saved
// on this device, the optional local Python helper (tools/start_audio_helper.bat, exact timings), and finally
// Kokoro running inside the browser (kokoro-js, nothing to install; word timing estimated per sentence).
const AudioGen = (() => {
  const DEFAULT_VOICE = 'af_heart';
  const settings = () => Store.settings.get();
  const helperUrl = () => (settings().helperUrl || 'http://localhost:8788').replace(/\/$/, '');
  const voice = () => settings().kokoroVoice || DEFAULT_VOICE;
  const engine = () => settings().audioEngine || 'auto'; // auto | browser | helper

  async function sha256(text) {
    if (!crypto.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- local Python helper (optional) ----------
  let helperCache = { t: 0, ok: null };
  async function helperHealth(force) {
    if (!force && Date.now() - helperCache.t < 15000) return helperCache.ok;
    let ok = null;
    try {
      const r = await fetch(helperUrl() + '/health', { signal: AbortSignal.timeout(1500) });
      ok = r.ok ? await r.json() : null;
    } catch (e) { ok = null; }
    helperCache = { t: Date.now(), ok };
    return ok;
  }
  async function helperSynth(sentences) {
    const r = await fetch(helperUrl() + '/synthesize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentences, voice: voice() }) });
    if (!r.ok) throw new Error('Audio helper error ' + r.status);
    const j = await r.json(); const out = {};
    for (const [h, e] of Object.entries(j.sentences || {})) {
      const bytes = Uint8Array.from(atob(e.data), ch => ch.charCodeAt(0));
      out[h] = { blob: new Blob([bytes], { type: 'audio/ogg; codecs=opus' }), dur: e.dur, words: e.words, voice: e.voice, src: 'helper', approx: false };
    }
    return out;
  }

  // ---------- in-browser Kokoro (web worker) ----------
  let worker = null, ready = null, nextId = 1; const pending = new Map(); const progressListeners = new Set();
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('js/kokoro-worker.js', { type: 'module' });
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { progressListeners.forEach(fn => fn(m)); return; }
      if (m.type === 'ready') { const p = pending.get('load'); if (p) { pending.delete('load'); p.resolve(m); } return; }
      const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
    worker.onerror = e => { const err = new Error('Kokoro worker failed: ' + (e.message || 'unknown')); pending.forEach(p => p.reject(err)); pending.clear(); ready = null; };
    return worker;
  }
  function loadModel(onProgress) {
    if (onProgress) progressListeners.add(onProgress);
    if (!ready) {
      const gpu = !!settings().audioGpu && !!navigator.gpu;
      ready = new Promise((resolve, reject) => {
        pending.set('load', { resolve, reject });
        getWorker().postMessage({ type: 'load', dtype: gpu ? 'fp32' : 'q8', device: gpu ? 'webgpu' : 'wasm' });
      }).catch(err => { ready = null; throw err; });
    }
    return ready.finally(() => { if (onProgress) progressListeners.delete(onProgress); });
  }
  function webSynth(text) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ type: 'synth', id, text, voice: voice() });
    });
  }
  function wavBlob(f32, sr) {
    const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }
  // Word timing estimate for browser-made clips: share the sentence's duration by word length, with a little
  // extra weight for punctuation pauses. Sentence boundaries are exact; word positions are approximate.
  function estimateWords(words, dur) {
    const w = words.map(t => t.length + (/[,;:.!?]$/.test(t) ? 2 : 0) + 1);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    let t = 0.05; const out = [];
    for (const x of w) { const d = (dur - 0.1) * x / total; out.push([+t.toFixed(3), +(t + d).toFixed(3)]); t += d; }
    return out;
  }

  // ---------- the job: make sure every sentence of c.lecture has audio ----------
  const jobs = new Map(); // creation id -> { promise, progress, listeners, c }
  function sentencesOf(lecture) { return (lecture.sections || []).flatMap(s => (s.paragraphs || []).flatMap(p => Lecture.splitSentences(p))); }
  const validClip = k => k && k.blob instanceof Blob && k.blob.size > 0 && Array.isArray(k.words);

  function ensure(c, { onProgress, save } = {}) {
    if (!c || !c.lecture) return Promise.resolve({ generated: 0, missing: 0 });
    let job = jobs.get(c.id);
    if (job) { if (onProgress) { job.listeners.push(onProgress); onProgress(job.progress); } return job.promise.then(r => { Object.assign(c.audioClips = c.audioClips || {}, job.c.audioClips || {}); return r; }); }
    job = { c, listeners: onProgress ? [onProgress] : [], progress: { phase: 'checking', done: 0, total: 0, text: 'Checking audio…' } };
    const report = p => { job.progress = Object.assign(job.progress, p); job.listeners.forEach(fn => { try { fn(job.progress); } catch (e) { /* ignore */ } }); };
    job.promise = (async () => {
      const sents = sentencesOf(c.lecture);
      const hashes = await Promise.all(sents.map(sha256));
      const manifest = await Lecture.loadManifest();
      const published = (manifest && manifest.sentences) || {};
      c.audioClips = c.audioClips || {};
      const missing = [];
      sents.forEach((s, i) => { const h = hashes[i]; if (!h) return; if (published[h] && published[h].words && published[h].words.length === s.split(/\s+/).filter(Boolean).length) return; if (validClip(c.audioClips[h])) return; missing.push({ s, h }); });
      const total = missing.length;
      if (!total) { report({ phase: 'done', done: 0, total: 0, text: 'Audio ready' }); return { generated: 0, missing: 0 }; }
      let generated = 0, source = 'browser';
      const useHelper = engine() !== 'browser' && await helperHealth(true);
      if (useHelper) {
        source = 'helper';
        report({ phase: 'generating', done: 0, total, source, text: `Generating audio on your PC… 0/${total}` });
        for (let i = 0; i < missing.length; i += 6) {
          const batch = missing.slice(i, i + 6);
          const clips = await helperSynth(batch.map(m => m.s));
          for (const m of batch) if (clips[m.h]) { c.audioClips[m.h] = clips[m.h]; generated++; }
          if (save) await save(c);
          report({ done: Math.min(total, i + batch.length), text: `Generating audio on your PC… ${Math.min(total, i + batch.length)}/${total}` });
        }
      } else if (engine() === 'helper') {
        throw new Error('The audio helper is not running. Start tools/start_audio_helper.bat, or switch the audio engine to Auto in Settings.');
      } else {
        report({ phase: 'loading', done: 0, total, source, text: 'Loading the Kokoro voice model…' });
        await loadModel(p => {
          if (p.status === 'progress' && p.file && /onnx|bin/.test(p.file)) report({ text: `Downloading the voice model (one time, ${Math.round((p.total || 0) / 1048576) || '~92'} MB)… ${Math.round(p.progress || 0)}%` });
          else if (p.status === 'ready') report({ text: 'Voice model ready' });
        });
        report({ phase: 'generating', text: `Generating audio in your browser… 0/${total}` });
        const t0 = Date.now();
        for (let i = 0; i < missing.length; i++) {
          const m = missing[i];
          const r = await webSynth(m.s);
          const dur = r.audio.length / r.sr;
          const words = m.s.split(/\s+/).filter(Boolean);
          c.audioClips[m.h] = { blob: wavBlob(r.audio, r.sr), dur: +dur.toFixed(3), words: estimateWords(words, dur), voice: voice(), src: 'browser', approx: true };
          generated++;
          if (save && (generated % 4 === 0 || i === missing.length - 1)) await save(c);
          const per = (Date.now() - t0) / (i + 1), left = Math.round(per * (missing.length - i - 1) / 1000);
          report({ done: i + 1, text: `Generating audio in your browser… ${i + 1}/${total}${left > 5 ? ` · about ${left >= 90 ? Math.round(left / 60) + ' min' : left + ' s'} left` : ''}` });
        }
      }
      report({ phase: 'done', done: total, total, text: 'Audio ready' });
      return { generated, missing: total, source };
    })().catch(err => { report({ phase: 'error', text: err.message || String(err) }); throw err; })
      .finally(() => jobs.delete(c.id));
    jobs.set(c.id, job);
    return job.promise;
  }
  const jobFor = id => jobs.get(id) || null;

  return { ensure, jobFor, helperHealth, loadModel, sentencesOf, sha256, validClip, DEFAULT_VOICE };
})();
