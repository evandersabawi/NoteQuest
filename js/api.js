// Talks to the Claude API directly from the browser (no backend).
// Also contains client-side image compression helpers.
const API = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';

  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'subject', 'emoji', 'summary', 'cards', 'questions', 'monsters'],
    properties: {
      title: { type: 'string', description: 'Short title for this set of notes (2-6 words).' },
      subject: { type: 'string', description: 'Subject area, e.g. "Biology - Cell Division".' },
      emoji: { type: 'string', description: 'One emoji that represents the topic.' },
      summary: { type: 'string', description: 'Two or three sentences summarizing the notes.' },
      cards: {
        type: 'array',
        description: 'Flash cards covering every important fact, term, formula, date, or concept in the notes.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['front', 'back'],
          properties: {
            front: { type: 'string', description: 'Term, question, or prompt. Keep it short.' },
            back: { type: 'string', description: 'The answer. Concise: ideally under 15 words.' },
          },
        },
      },
      questions: {
        type: 'array',
        description: 'Multiple-choice quiz questions that test understanding of the notes.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'choices', 'answer', 'explanation'],
          properties: {
            question: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' }, description: 'Exactly 4 plausible choices.' },
            answer: { type: 'integer', description: 'Index (0-3) of the correct choice.' },
            explanation: { type: 'string', description: 'One sentence explaining why the answer is right.' },
          },
        },
      },
      monsters: {
        type: 'array',
        description: 'Exactly 5 playful monster names themed on the subject, for the battle game mode.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'emoji'],
          properties: {
            name: { type: 'string', description: 'A punny monster name related to the notes, e.g. "Mitochondrix".' },
            emoji: { type: 'string', description: 'A single emoji for the monster.' },
          },
        },
      },
    },
  };

  const SYSTEM = `You turn photos of a student's handwritten or typed notes into study material.

Read every photo carefully, including margins, diagrams, tables, and small annotations. Transcribe accurately: do not invent facts that are not in the notes, but you may use general knowledge to make definitions clearer or to write plausible wrong answers.

Guidelines:
- cards: cover ALL important content. Typically 15-40 cards depending on how dense the notes are. Fronts are short prompts; backs are concise answers (under 15 words when possible).
- questions: 12-25 multiple-choice questions. Each has exactly 4 choices, exactly one correct, and the wrong choices must be plausible (common misconceptions, similar terms). Vary which index is correct. Include some questions that require applying or connecting ideas, not just recall.
- monsters: exactly 5, each with a punny name tied to the subject and one emoji.
- Write in the same language as the notes.`;

  function modeHint(mode) {
    return {
      flash: 'The student chose Flash Cards, so prioritize a complete, well-ordered card set.',
      notemon: 'The student chose Notemon (a monster battle game), so make questions fun and varied, and make the monster names extra creative.',
      match: 'The student chose Match (a memory pairing game), so keep card backs especially short (1-6 words) wherever possible.',
      blitz: 'The student chose Blitz (a timed speed round), so questions and choices should be quick to read.',
    }[mode] || '';
  }

  async function generate({ images, name, mode, apiKey, model, onStatus }) {
    if (!apiKey) throw new Error('No API key set. Add one in Settings.');
    if (!images.length) throw new Error('Add at least one photo of your notes.');
    onStatus && onStatus('Reading your notes with Claude…');

    const content = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    let text = `Here are ${images.length} photo(s) of my notes. Build a complete study set from them.`;
    if (name) text += ` I call this set "${name}".`;
    text += ' ' + modeHint(mode);
    content.push({ type: 'text', text });

    const body = {
      model,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    };
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    // Server-side refusal fallbacks are supported on the Opus 5 / Fable tiers.
    if (/^claude-(opus-5|fable)/.test(model)) {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }

    let res;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Network error reaching the Claude API: ' + e.message);
    }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
      if (res.status === 401) msg = 'Invalid API key (401). Check it in Settings.';
      throw new Error(msg);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      const why = data.stop_details && data.stop_details.explanation ? ' ' + data.stop_details.explanation : '';
      throw new Error('Claude declined this request.' + why);
    }
    if (data.stop_reason === 'max_tokens') throw new Error('The response was cut off. Try fewer photos at once.');
    const out = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed;
    try { parsed = JSON.parse(out); } catch (e) { throw new Error('Could not parse the generated study set. Please try again.'); }
    parsed._model = data.model;
    parsed._usage = data.usage;
    return parsed;
  }

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

  return { generate, toBase64, thumbnail, SCHEMA };
})();
