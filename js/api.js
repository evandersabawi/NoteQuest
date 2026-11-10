// Generation. The browser calls the Claude API directly with the user's own key (no backend).
// Prompts live in js/prompts.js.
// Also contains client-side image compression helpers.
const API = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const { SCHEMA, SYSTEM, LECTURE_SCHEMA, LECTURE_SYSTEM } = Prompts;

  // Models offered to people who bring their own key. Older saved choices map to their successors.
  const MODELS = [
    ['claude-opus-5-5', 'Claude Opus 5.5 (default, best quality)'],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (cheaper, faster)'],
    ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)'],
    ['claude-fable-5-1', 'Claude Fable 5.1 (most capable, most expensive)'],
  ];
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const RENAMED = { 'claude-opus-5': 'claude-opus-5-5', 'claude-sonnet-5': 'claude-sonnet-5-5' };
  const model = m => { m = RENAMED[m] || m; return MODELS.some(([v]) => v === m) ? m : DEFAULT_MODEL; };

  // Turn an API error into something a student can act on.
  const BILLING_URL = 'https://console.anthropic.com/settings/billing';
  function friendlyError(status, j) {
    const raw = (j && j.error && j.error.message) || '';
    const type = (j && j.error && j.error.type) || '';
    let msg, link = null, kind = 'api';
    if (status === 401 || type === 'authentication_error') { msg = 'Your API key was rejected. Check that it is pasted correctly in Settings.'; kind = 'auth'; }
    else if (type === 'billing_error' || /credit balance|purchase credits|plans & billing|billing/i.test(raw)) {
      msg = 'You are out of Claude credits, so nothing can be generated right now. Add credits (about $5 covers many sets) and try again.'; link = BILLING_URL; kind = 'credits';
    }
    else if (status === 403 || type === 'permission_error') { msg = 'This API key is not allowed to use that model. Pick another model in Settings.'; kind = 'auth'; }
    else if (status === 429) { msg = 'Claude is rate-limiting your key for the moment. Wait a minute and try again.'; kind = 'rate'; }
    else if (status === 529 || status >= 500) { msg = 'Claude is overloaded right now. Try again in a few minutes.'; kind = 'busy'; }
    else if (status === 413) { msg = 'Too many or too large photos in one set. Try fewer photos at once.'; }
    else msg = raw || (status + ' error from the Claude API.');
    const err = new Error(msg); err.kind = kind; err.link = link; err.raw = raw; err.status = status;
    return err;
  }

  // One structured-output request to Claude. Returns the parsed JSON object.
  async function request({ apiKey, model: m, system, content, schema, maxTokens = 16000, effort = 'high' }) {
    if (!apiKey) throw new Error('No API key set. Add one in Settings.');
    const body = {
      model: model(m),
      max_tokens: maxTokens,
      system,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    };
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    // Server-side refusal fallbacks ("default" routing) on the tiers that support it.
    if (/^claude-(opus-5|sonnet-5-5|fable)/.test(body.model)) {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    let res;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      const err = new Error('Could not reach the Claude API. Check your internet connection.'); err.kind = 'network'; throw err;
    }
    if (!res.ok) {
      let j = null;
      try { j = await res.json(); } catch (e) { /* ignore */ }
      throw friendlyError(res.status, j);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      const why = data.stop_details && data.stop_details.explanation ? ' ' + data.stop_details.explanation : '';
      throw new Error('Claude declined this request.' + why);
    }
    if (data.stop_reason === 'max_tokens') throw new Error('The response was cut off. Try fewer photos at once.');
    const out = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed;
    try { parsed = JSON.parse(out); } catch (e) { throw new Error('Could not parse the generated result. Please try again.'); }
    parsed._model = data.model;
    parsed._usage = data.usage;
    return parsed;
  }

  // Photos of notes -> study set.
  async function generate({ images, name, mode, apiKey, model: m, onStatus }) {
    if (!images.length) throw new Error('Add at least one photo of your notes.');
    onStatus && onStatus('Reading your notes with Claude…');
    return request({ apiKey, model: m, system: SYSTEM, content: Prompts.setContent(images, name, mode), schema: SCHEMA });
  }

  // Study set -> spoken lecture script (text only, no photos needed).
  async function lecture({ creation, apiKey, model: m }) {
    return request({ apiKey, model: m, system: LECTURE_SYSTEM, content: Prompts.lectureContent(creation), schema: LECTURE_SCHEMA, maxTokens: 8000, effort: 'medium' });
  }

  // Can this user generate at all? Needs their own Claude API key.
  const canGenerate = apiKey => !!apiKey;

  // ---------- image helpers ----------
  async function loadBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Unsupported image: ' + file.name)); };
        img.src = url;
      });
    }
  }
  function draw(bmp, maxSide) {
    const w = bmp.width, h = bmp.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  // Downscale for the API (longest side 1568px is the sweet spot for vision).
  async function toBase64(file) {
    const bmp = await loadBitmap(file);
    const c = draw(bmp, 1568);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  // Small cover thumbnail stored with the creation.
  async function thumbnail(file) {
    const bmp = await loadBitmap(file);
    return draw(bmp, 480).toDataURL('image/jpeg', 0.7);
  }

  return { generate, lecture, canGenerate, toBase64, thumbnail, friendlyError, SCHEMA, MODELS, DEFAULT_MODEL, model };
})();
