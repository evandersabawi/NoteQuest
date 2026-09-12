// Talks to the Claude API directly from the browser (no backend).
// Also contains client-side image compression helpers.
const API = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';

  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'subject', 'summary', 'cards', 'questions', 'monsters'],
    properties: {
      title: { type: 'string', description: 'Short title for this set of notes (2-6 words).' },
      subject: { type: 'string', description: 'Subject area, e.g. "Biology - Cell Division".' },
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
        description: 'Exactly 5 playful monster names themed on the subject, for the battle game mode. Order them from weakest to strongest.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'A punny monster name related to the notes, e.g. "Mitochondrix".' },
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
- monsters: exactly 5 punny names tied to the subject, ordered weakest to strongest (the last one is the boss).
- Write in the same language as the notes.`;

  const LECTURE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'sections'],
    properties: {
      title: { type: 'string', description: 'Title of the lecture (3-8 words).' },
      sections: {
        type: 'array',
        description: '4 to 7 sections in teaching order.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'paragraphs'],
          properties: {
            heading: { type: 'string', description: 'Short on-screen heading for the section (not spoken).' },
            paragraphs: { type: 'array', items: { type: 'string' }, description: 'Spoken paragraphs, 2-5 sentences each. Plain text only.' },
          },
        },
      },
    },
  };

  const LECTURE_SYSTEM = `You are a warm, engaging teacher recording a spoken lecture for one student, based on that student's own notes.

Write exactly what you would say out loud. Natural spoken sentences only: no markdown, no bullet points, no lists, no stage directions, no headings inside the paragraphs (headings are shown on screen, not spoken). Avoid symbols that read badly aloud; say "carbon dioxide" rather than "CO2" unless the notes are formula-heavy.

Aim for 700 to 1100 words in 4 to 7 sections. Open with a one-or-two-sentence hook about why the topic matters. Teach the ideas in a sensible order so each builds on the last. Use a concrete example or analogy where it helps. Once or twice, ask the student a quick "pause and think" question, then answer it. Finish with a short recap of the key points. Write in the same language as the notes. Do not invent facts that are not supported by the notes.`;

  function modeHint(mode) {
    return {
      flash: 'The student chose Flash Cards, so prioritize a complete, well-ordered card set.',
      notemon: 'The student chose Notemon (a monster battle game), so make questions fun and varied, and make the monster names extra creative.',
      match: 'The student chose Match (a memory pairing game), so keep card backs especially short (1-6 words) wherever possible.',
      blitz: 'The student chose Blitz (a timed speed round), so questions and choices should be quick to read.',
    }[mode] || '';
  }

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
  async function request({ apiKey, model, system, content, schema, maxTokens = 16000 }) {
    if (!apiKey) throw new Error('No API key set. Add one in Settings.');
    const body = {
      model,
      max_tokens: maxTokens,
      system,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema } },
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
  async function generate({ images, name, mode, apiKey, model, onStatus }) {
    if (!images.length) throw new Error('Add at least one photo of your notes.');
    onStatus && onStatus('Reading your notes with Claude…');
    const content = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    let text = `Here are ${images.length} photo(s) of my notes. Build a complete study set from them.`;
    if (name) text += ` I call this set "${name}".`;
    text += ' ' + modeHint(mode);
    content.push({ type: 'text', text });
    return request({ apiKey, model, system: SYSTEM, content, schema: SCHEMA });
  }

  // Study set -> spoken lecture script (text only, no photos needed).
  async function lecture({ creation, apiKey, model }) {
    const c = creation;
    const lines = [
      `Set title: ${c.name}`, `Subject: ${c.subject || 'unknown'}`, `Summary: ${c.summary || ''}`, '',
      'Flash cards (front -> back):',
      ...c.cards.map(k => `- ${k.front} -> ${k.back}`), '',
      'Quiz questions the student will face (use them to decide what to emphasise):',
      ...c.questions.slice(0, 15).map(q => `- ${q.question} (answer: ${q.choices[q.answer]})`),
      '', 'Write the lecture now.',
    ];
    return request({ apiKey, model, system: LECTURE_SYSTEM, content: [{ type: 'text', text: lines.join('\n') }], schema: LECTURE_SCHEMA, maxTokens: 8000 });
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

  return { generate, lecture, toBase64, thumbnail, friendlyError, SCHEMA };
})();
