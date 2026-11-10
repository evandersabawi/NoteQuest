// Prompts and output schemas for Claude, shared by the browser (own API key) and the Firebase backend
// (hosted plans). The backend copies this file into functions/ when it deploys (see firebase.json), so
// edit it here only.
(function (root) {
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
- Every card and question must stand completely on its own. The student will see ONLY the text you write, never the photos. Do not write anything that needs a diagram, figure, graph, table, map, picture, worked example, or passage from the notes in order to be answered. Never use phrases such as "in the diagram", "the figure above", "as shown", "in the example", "according to the notes", "on page 2", "label A", or "the following table". If a fact comes from a diagram or example, either rewrite it so all the needed information is stated in words inside the question itself (for example give the numbers, names, or description directly), or leave it out. If it cannot be asked fairly in text alone, skip it.
- Ask only about the subject matter the notes teach. Notes often carry details that are not part of what is being studied: the student's name, the teacher's name, the class or course name, the lesson, unit, or chapter title, page numbers, dates the notes were written, school name, headers, footers, and doodles. Never write cards or questions about these, such as "Whose notes are these?", "What is the title of this lesson?", "What date were these notes taken?", or "Which class are these notes for?". A date, name, or title is fair game only when it is part of the content itself (for example the year a battle happened or the scientist who proposed a theory).
- Before finishing, reread each card and question as someone who has never seen the notes. If it cannot be answered from its own text plus subject knowledge, fix it or remove it.
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

  // Photos of notes -> the user message for a study set. `instructions` is the student's optional
  // free-text request, e.g. "Only chapters 1-3, not 4-6".
  function setContent(images, name, mode, instructions) {
    const content = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    let text = `Here are ${images.length} photo(s) of my notes. Build a complete study set from them.`;
    if (name) text += ` I call this set "${name}".`;
    text += ' ' + modeHint(mode);
    const extra = String(instructions || '').trim().slice(0, 1000);
    if (extra) {
      text += `\n\nMy special instructions for this set (follow them when choosing what to cover and how to write the cards and questions, as long as they fit the required output format; if they limit the material, for example to certain chapters or topics, leave everything else out of the cards, questions, title, and summary):\n<special_instructions>\n${extra}\n</special_instructions>`;
    }
    content.push({ type: 'text', text });
    return content;
  }

  // Study set -> the user message for a spoken lecture (text only, no photos needed).
  function lectureContent(c) {
    const lines = [
      `Set title: ${c.name}`, `Subject: ${c.subject || 'unknown'}`, `Summary: ${c.summary || ''}`, '',
      'Flash cards (front -> back):',
      ...(c.cards || []).map(k => `- ${k.front} -> ${k.back}`), '',
      'Quiz questions the student will face (use them to decide what to emphasise):',
      ...(c.questions || []).slice(0, 15).map(q => `- ${q.question} (answer: ${q.choices[q.answer]})`),
      '', 'Write the lecture now.',
    ];
    return [{ type: 'text', text: lines.join('\n') }];
  }

  const Prompts = { SCHEMA, SYSTEM, LECTURE_SCHEMA, LECTURE_SYSTEM, modeHint, setContent, lectureContent };
  if (typeof module !== 'undefined' && module.exports) module.exports = Prompts;
  else root.Prompts = Prompts;
})(typeof self !== 'undefined' ? self : this);
