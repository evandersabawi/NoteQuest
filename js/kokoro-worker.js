// Web worker that runs Kokoro-82M in the browser (kokoro-js on ONNX Runtime Web).
// Nothing to install: the model downloads once from Hugging Face and is cached by the browser.
const CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null;

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (!tts) {
        const { KokoroTTS } = await import(CDN);
        tts = await KokoroTTS.from_pretrained(MODEL, {
          dtype: m.dtype || 'q8',
          device: m.device || 'wasm',
          progress_callback: p => self.postMessage({ type: 'progress', status: p.status, file: p.file, progress: p.progress, loaded: p.loaded, total: p.total }),
        });
      }
      self.postMessage({ type: 'ready', device: m.device, dtype: m.dtype });
    } else if (m.type === 'synth') {
      if (!tts) throw new Error('Model not loaded');
      const r = await tts.generate(m.text, { voice: m.voice || 'af_heart', speed: 1 });
      const audio = r.audio instanceof Float32Array ? r.audio : new Float32Array(r.audio);
      self.postMessage({ type: 'done', id: m.id, audio, sr: r.sampling_rate || 24000 }, [audio.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: (err && err.message) || String(err) });
  }
};
