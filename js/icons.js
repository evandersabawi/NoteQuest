// Inline SVG graphics: line icons (24x24 stroke style), generated creature avatars, and Notemon monsters.
const Icons = (() => {
  const PATHS = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    library: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    switch: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    cards: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    quiz: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    more: '<circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".8" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".8" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".8" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".8" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    gamepad: '<path d="M6 12h4"/><path d="M8 10v4"/><path d="M15 13h.01"/><path d="M18 11h.01"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
    key: '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    menu: '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    dizzy: '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="m8 8 2 2"/><path d="m10 8-2 2"/><path d="m14 8 2 2"/><path d="m16 8-2 2"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5"/><path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    logo: '<rect x="4" y="2" width="16" height="20" rx="3"/><path d="M13.5 6 9 13h3.5L11 18l4.5-7H12z" fill="currentColor" stroke="none"/>',
  };
  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.info}</svg>`;

  // ---------- creature avatars ----------
  // Each kind is a white creature drawn on a coloured disc. Parts are combined by index.
  const INK = '#1c1a33';
  const EARS = {
    none: '',
    cat: '<path d="M18 26 14 12l12 8z"/><path d="M46 26l4-14-12 8z"/>',
    round: '<circle cx="16" cy="18" r="7"/><circle cx="48" cy="18" r="7"/>',
    horns: '<path d="M20 22c-4-3-6-9-4-14 3 3 6 6 8 12z"/><path d="M44 22c4-3 6-9 4-14-3 3-6 6-8 12z"/>',
    antenna: '<path d="M26 18 22 8" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/><circle cx="21" cy="7" r="3"/><path d="M38 18l4-10" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/><circle cx="43" cy="7" r="3"/>',
    bunny: '<path d="M22 24c-6-6-8-14-4-20 4 3 7 10 8 18z"/><path d="M42 24c6-6 8-14 4-20-4 3-7 10-8 18z"/>',
    fin: '<path d="M32 8c-6 4-8 10-6 16h12c2-6 0-12-6-16z"/>',
    leaf: '<path d="M32 10c6-2 10 0 12 6-6 2-10 0-12-6z"/><path d="M32 10c-6-2-10 0-12 6 6 2 10 0 12-6z"/>',
  };
  const BODIES = {
    round: '<circle cx="32" cy="36" r="20"/>',
    square: '<rect x="12" y="16" width="40" height="40" rx="12"/>',
    blob: '<path d="M32 15c12 0 21 8 21 19s-9 22-21 22-21-11-21-22 9-19 21-19z"/>',
    egg: '<path d="M32 14c10 0 18 12 18 24s-8 18-18 18-18-6-18-18 8-24 18-24z"/>',
  };
  const EYES = {
    round: `<circle cx="25" cy="34" r="3.2" fill="${INK}"/><circle cx="39" cy="34" r="3.2" fill="${INK}"/><circle cx="26" cy="33" r="1" fill="#fff"/><circle cx="40" cy="33" r="1" fill="#fff"/>`,
    wide: `<ellipse cx="25" cy="34" rx="4" ry="5" fill="${INK}"/><ellipse cx="39" cy="34" rx="4" ry="5" fill="${INK}"/><circle cx="26.5" cy="32" r="1.4" fill="#fff"/><circle cx="40.5" cy="32" r="1.4" fill="#fff"/>`,
    happy: `<path d="M21 35c2-4 6-4 8 0" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M35 35c2-4 6-4 8 0" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
    dot: `<circle cx="25" cy="34" r="2" fill="${INK}"/><circle cx="39" cy="34" r="2" fill="${INK}"/>`,
    one: `<circle cx="32" cy="33" r="6" fill="${INK}"/><circle cx="34" cy="31" r="2" fill="#fff"/>`,
    sleepy: `<path d="M21 34h8" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/><path d="M35 34h8" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
  };
  const MOUTHS = {
    smile: `<path d="M26 43c3 3 9 3 12 0" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
    grin: `<path d="M24 42c3 5 13 5 16 0z" fill="${INK}"/><path d="M28 42h8v2.5a2 2 0 0 1-8 0z" fill="#fff"/>`,
    o: `<ellipse cx="32" cy="44" rx="3" ry="3.5" fill="${INK}"/>`,
    cat: `<path d="M28 42c2 3 4 3 4 0 0 3 2 3 4 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    tooth: `<path d="M26 43c3 3 9 3 12 0" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M29 43.5h3v3h-3z" fill="#fff" stroke="${INK}" stroke-width="1"/>`,
    line: `<path d="M27 44h10" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
  };
  const KINDS = [
    { name: 'Kit', body: 'round', ears: 'cat', eyes: 'round', mouth: 'cat' },
    { name: 'Bloop', body: 'blob', ears: 'antenna', eyes: 'wide', mouth: 'o' },
    { name: 'Pip', body: 'egg', ears: 'none', eyes: 'happy', mouth: 'smile' },
    { name: 'Boxy', body: 'square', ears: 'round', eyes: 'dot', mouth: 'grin' },
    { name: 'Hop', body: 'round', ears: 'bunny', eyes: 'round', mouth: 'tooth' },
    { name: 'Cyclo', body: 'blob', ears: 'horns', eyes: 'one', mouth: 'smile' },
    { name: 'Sprout', body: 'egg', ears: 'leaf', eyes: 'happy', mouth: 'o' },
    { name: 'Finn', body: 'round', ears: 'fin', eyes: 'wide', mouth: 'smile' },
    { name: 'Dozer', body: 'square', ears: 'cat', eyes: 'sleepy', mouth: 'line' },
    { name: 'Beep', body: 'square', ears: 'antenna', eyes: 'dot', mouth: 'line' },
    { name: 'Puff', body: 'blob', ears: 'round', eyes: 'happy', mouth: 'grin' },
    { name: 'Nib', body: 'egg', ears: 'horns', eyes: 'wide', mouth: 'cat' },
  ];
  function avatar(a = {}, cls = '') {
    const kind = KINDS[(a.kind ?? 0) % KINDS.length] || KINDS[0];
    const color = a.color || '#8b7cff';
    return `<svg class="avatar ${cls}" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="${color}"/>
      <g fill="#fff">${EARS[kind.ears] || ''}${BODIES[kind.body]}</g>
      ${EYES[kind.eyes]}${MOUTHS[kind.mouth]}
      <circle cx="20" cy="41" r="2.6" fill="#ff8fb1" opacity=".55"/><circle cx="44" cy="41" r="2.6" fill="#ff8fb1" opacity=".55"/>
    </svg>`;
  }

  // ---------- Notemon monsters (5 designs, escalating) ----------
  const MONSTERS = [
    // 0: slime
    `<path d="M32 12c14 0 24 12 24 26 0 10-8 16-24 16S8 48 8 38c0-14 10-26 24-26z" fill="var(--m1)"/><path d="M20 26c4-6 10-8 16-6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/><circle cx="25" cy="36" r="4" fill="#1c1a33"/><circle cx="41" cy="36" r="4" fill="#1c1a33"/><circle cx="26" cy="35" r="1.4" fill="#fff"/><circle cx="42" cy="35" r="1.4" fill="#fff"/><path d="M27 45c3 3 7 3 10 0" stroke="#1c1a33" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
    // 1: bat-thing
    `<path d="M6 24c8-2 12 2 14 8-6 0-10 4-12 10-2-6-4-12-2-18z" fill="var(--m2)"/><path d="M58 24c-8-2-12 2-14 8 6 0 10 4 12 10 2-6 4-12 2-18z" fill="var(--m2)"/><ellipse cx="32" cy="36" rx="16" ry="18" fill="var(--m1)"/><path d="M22 20l-2-10 8 6z" fill="var(--m1)"/><path d="M42 20l2-10-8 6z" fill="var(--m1)"/><circle cx="26" cy="34" r="3.5" fill="#ffe66d"/><circle cx="38" cy="34" r="3.5" fill="#ffe66d"/><circle cx="26" cy="34" r="1.5" fill="#1c1a33"/><circle cx="38" cy="34" r="1.5" fill="#1c1a33"/><path d="M26 44h12" stroke="#1c1a33" stroke-width="2.5" stroke-linecap="round"/><path d="M28 44v3M36 44v3" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`,
    // 2: spiky cyclops
    `<path d="M32 6l5 10 11-4-3 11 11 5-10 6 6 10-12-2-3 12-5-10-9 6 2-12-11-3 10-6-5-11 11 3z" fill="var(--m2)"/><circle cx="32" cy="34" r="15" fill="var(--m1)"/><circle cx="32" cy="32" r="8" fill="#fff"/><circle cx="33" cy="32" r="4" fill="#1c1a33"/><circle cx="35" cy="30" r="1.4" fill="#fff"/><path d="M26 44c3 2 9 2 12 0" stroke="#1c1a33" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
    // 3: ghost
    `<path d="M14 58V32a18 18 0 0 1 36 0v26l-6-5-6 5-6-5-6 5-6-5z" fill="var(--m1)"/><path d="M20 30c2-6 6-9 12-9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/><ellipse cx="25" cy="32" rx="3.5" ry="5" fill="#1c1a33"/><ellipse cx="39" cy="32" rx="3.5" ry="5" fill="#1c1a33"/><ellipse cx="32" cy="44" rx="4" ry="5" fill="#1c1a33"/>`,
    // 4: dragon boss
    `<path d="M4 30c6-10 14-12 20-10l-6 12z" fill="var(--m2)"/><path d="M60 30c-6-10-14-12-20-10l6 12z" fill="var(--m2)"/><path d="M14 40c0-14 8-24 18-24s18 10 18 24c0 8-8 14-18 14S14 48 14 40z" fill="var(--m1)"/><path d="M24 16l-2-10 8 7z" fill="var(--m2)"/><path d="M40 16l2-10-8 7z" fill="var(--m2)"/><path d="M32 8l3 8h-6z" fill="var(--m2)"/><path d="M24 30c1-3 3-4 5-2" stroke="#1c1a33" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M40 30c-1-3-3-4-5-2" stroke="#1c1a33" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="26" cy="35" r="3.5" fill="#ffe66d"/><circle cx="38" cy="35" r="3.5" fill="#ffe66d"/><circle cx="26" cy="35" r="1.6" fill="#1c1a33"/><circle cx="38" cy="35" r="1.6" fill="#1c1a33"/><path d="M22 46c6 4 14 4 20 0" stroke="#1c1a33" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M26 46l2 4 2-4M34 46l2 4 2-4" fill="#fff" stroke="#1c1a33" stroke-width="1"/>`,
  ];
  const MONSTER_COLORS = [['#7ee787', '#3fb950'], ['#a78bfa', '#7c3aed'], ['#fb923c', '#ea580c'], ['#93c5fd', '#3b82f6'], ['#f87171', '#b91c1c']];
  function monster(i, cls = '') {
    const k = ((i % MONSTERS.length) + MONSTERS.length) % MONSTERS.length;
    const [m1, m2] = MONSTER_COLORS[k];
    return `<svg class="monster ${cls}" viewBox="0 0 64 64" style="--m1:${m1};--m2:${m2}" aria-hidden="true">${MONSTERS[k]}</svg>`;
  }

  return { icon, avatar, monster, KINDS, PATHS };
})();
