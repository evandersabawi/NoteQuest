// The assistant: a command box. Known commands run instantly in the app; anything else goes to Claude
// (cheap Haiku call) with a description of the app, so it can explain features and list the commands.
const Assistant = (() => {
  const I = Icons.icon;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COMMANDS = [
    ['help', 'List these commands'],
    ['play <song or artist>', 'Play a song on Spotify (Premium)'],
    ['pause / resume / next / previous', 'Control Spotify playback'],
    ['study <set name>', 'Open a set in its game mode'],
    ['quiz <set name>', 'Start the quiz for a set'],
    ['lecture <set name>', 'Open the lecture for a set'],
    ['create', 'Create a new set from photos'],
    ['home / creations / music / settings', 'Go to a page'],
    ['theme <midnight|ocean|forest|sunset|candy|paper>', 'Change the app theme'],
    ['logout', 'Log out'],
    ['anything else', 'Ask Claude a question about the app or your studying'],
  ];
  const SYSTEM = `You are the built-in helper of NoteQuest, a personal study web app. Answer briefly and concretely (a few sentences, or a short list). Do not use markdown headings or emoji.

What the app does: the student photographs their notes and Claude turns them into a study set: flash cards, multiple-choice questions, and five monster names. Each set tile has Study (the chosen game mode), Quiz (normal multiple-choice quiz with explanations) and Lecture (Claude writes a spoken lecture; Kokoro voice audio is generated once and the transcript highlights words as they are spoken).
Game modes: Flash Cards (flip, Again/Got it), Notemon (battle monsters by answering questions; wrong answers hurt you; streaks give critical hits), Match (memory pairs of term and answer), Blitz (60-second speed round with streak multipliers).
Home shows the avatar, username, level and XP, stats and recent sets. Sidebar: Home, Your creations, Create, Music, and a Settings gear. Settings: account (username, email, password, security question), Claude API key and model (Haiku 4.5 default, Sonnet 5, Opus 5), lecture audio options (Kokoro voice, GPU), Spotify Client ID, theme, export/import.
Accounts: cloud accounts (username + password, optional email, security question for reset) work on every device; study sets sync; lecture audio is regenerated per device.
Music: Spotify can be connected in Settings (needs a Spotify developer Client ID and a Premium account); the sidebar mini player and the Music page search and play songs; favourites can be starred.
Costs: only generating a set or lecture calls the Claude API (a few cents on Haiku); games, quizzes and playback are free.

Commands the student can type in this box (client-side, instant):
${COMMANDS.map(([c, d]) => `- ${c}: ${d}`).join('\n')}
When asked what commands exist, list them exactly like that.`;

  let open = false, history = [], busy = false;

  function panel() {
    let el = document.getElementById('assist');
    if (el) return el;
    el = document.createElement('div'); el.id = 'assist'; el.className = 'assist'; el.hidden = true;
    el.innerHTML = `<div class="assist-card">
      <div class="assist-head"><b>${I('sparkles')} Ask NoteQuest</b><button class="icon-btn" id="assist-close" aria-label="Close">${I('x')}</button></div>
      <div class="assist-log" id="assist-log"><div class="assist-msg bot">Type a command like <code>play lofi beats</code>, <code>quiz chapter 4</code> or <code>help</code>, or ask me anything about the app.</div></div>
      <form class="assist-form" id="assist-form"><input class="input" id="assist-in" placeholder="Ask or type a command…" autocomplete="off" maxlength="300"><button class="btn primary" type="submit" id="assist-send">${I('arrowRight')}</button></form>
    </div>`;
    document.body.appendChild(el);
    el.onclick = e => { if (e.target === el) toggle(false); };
    el.querySelector('#assist-close').onclick = () => toggle(false);
    el.querySelector('#assist-form').onsubmit = e => { e.preventDefault(); const inp = el.querySelector('#assist-in'); const q = inp.value.trim(); if (!q || busy) return; inp.value = ''; run(q); };
    return el;
  }
  function toggle(on) { const el = panel(); open = on === undefined ? !open : on; el.hidden = !open; if (open) setTimeout(() => el.querySelector('#assist-in').focus(), 50); }
  function say(text, who = 'bot', html = false) {
    const log = panel().querySelector('#assist-log');
    const d = document.createElement('div'); d.className = 'assist-msg ' + who; d.innerHTML = html ? text : esc(text).replace(/\n/g, '<br>');
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  const helpHTML = () => `<b>Commands</b><ul>${COMMANDS.map(([c, d]) => `<li><code>${esc(c)}</code> · ${esc(d)}</li>`).join('')}</ul>`;

  // ctx is supplied by app.js: { sets(), openSet(id, mode), go(hash), setTheme(name), logout(), ask(question) }
  let ctx = null;
  function init(c) { ctx = c; }

  async function run(q) {
    say(q, 'me');
    const lower = q.toLowerCase().trim();
    const arg = q.replace(/^\S+\s*/, '').trim();
    const first = lower.split(/\s+/)[0];
    try {
      if (/^(help|commands|\?)$/.test(lower)) return say(helpHTML(), 'bot', true);
      if (first === 'play' && arg) { const busyMsg = say(`Looking for "${arg}" on Spotify…`); const t = await Music.playQuery(arg); busyMsg.textContent = `Playing ${t.name} by ${t.artists}.`; return; }
      if (/^(play|resume)$/.test(lower)) { await Music.play(); return say('Resumed.'); }
      if (lower === 'pause' || lower === 'stop') { await Music.pause(); return say('Paused.'); }
      if (/^(next|skip)$/.test(lower)) { await Music.next(); return say('Skipped.'); }
      if (/^(previous|prev|back)$/.test(lower)) { await Music.previous(); return say('Went back a track.'); }
      if (/^(study|quiz|lecture)$/.test(first) && arg) {
        const sets = await ctx.sets(); const s = bestMatch(sets, arg);
        if (!s) return say(`I couldn't find a set called "${arg}". Your sets: ${sets.map(x => x.name).join(', ') || 'none yet'}.`);
        say(`Opening ${first} for "${s.name}".`); ctx.openSet(s.id, first); toggle(false); return;
      }
      if (/^(home|creations|create|music|settings)$/.test(lower)) { ctx.go('#' + lower); toggle(false); return; }
      if (first === 'theme' && arg) { const ok = ctx.setTheme(arg.toLowerCase()); return say(ok ? `Theme set to ${arg}.` : `Unknown theme "${arg}". Try midnight, ocean, forest, sunset, candy or paper.`); }
      if (/^(logout|log out|sign out)$/.test(lower)) { toggle(false); ctx.logout(); return; }
      // Otherwise ask Claude.
      busy = true; const thinking = say('Thinking…');
      try {
        const sets = await ctx.sets();
        const answer = await ctx.ask({ system: SYSTEM + `\n\nThe student's sets right now: ${sets.map(x => x.name).join(', ') || 'none yet'}. Current page: ${location.hash || '#home'}.`, history, question: q });
        thinking.textContent = answer;
        history.push({ role: 'user', content: q }, { role: 'assistant', content: answer }); history = history.slice(-8);
      } finally { busy = false; }
    } catch (e) {
      const msg = e.code === 'not-connected' ? 'Spotify is not connected yet. Open Settings → Spotify to connect it.' : (e.message || String(e));
      say(msg, 'bot err');
    }
  }
  function bestMatch(sets, q) {
    const n = q.toLowerCase();
    return sets.find(s => s.name.toLowerCase() === n) || sets.find(s => s.name.toLowerCase().includes(n)) || sets.find(s => n.includes(s.name.toLowerCase())) || sets.find(s => n.split(/\s+/).every(w => s.name.toLowerCase().includes(w))) || null;
  }

  return { init, toggle, run, COMMANDS };
})();
