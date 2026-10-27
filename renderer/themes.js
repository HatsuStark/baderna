'use strict';

// Fundos da sala, desenhados em SVG (viewBox 1440x900, cortado pra cobrir).
// O host escolhe; o id viaja pela rede e só é aceito se existir aqui.

const THEME_DEFS = `
  <filter id="th-grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .06 0"/></filter>
  <filter id="th-spray"><feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="2" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="5"/><feGaussianBlur stdDeviation=".6"/></filter>
  <filter id="th-soft"><feGaussianBlur stdDeviation="40"/></filter>
  <filter id="th-glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

const GRAIN = '<rect width="1440" height="900" filter="url(#th-grain)"/>';

// Aleatório determinístico: o mesmo tema fica igual em todo PC.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function tags(list) {
  return `<g font-family="Permanent Marker" filter="url(#th-spray)">${list.map(([x, y, size, color, op, rot, text]) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" opacity="${op}" transform="rotate(${rot} ${x} ${y})">${text}</text>`).join('')}</g>`;
}

const THEMES = {
  grafite: {
    name: 'Grafite',
    bg: '#121214',
    svg: () => `
      <rect width="1440" height="900" fill="#121214"/>
      <circle cx="180" cy="160" r="220" fill="#ff2bd6" opacity=".07" filter="url(#th-soft)"/>
      <circle cx="1280" cy="260" r="260" fill="#19f0ff" opacity=".06" filter="url(#th-soft)"/>
      ${tags([
        [40, 330, 120, '#ff2bd6', 0.07, -8, 'BADERNA'],
        [1080, 140, 70, '#19f0ff', 0.08, 6, 'ZN 2077'],
        [1110, 470, 54, '#b6ff3b', 0.06, -4, 'RUA É NOSSA'],
        [70, 560, 46, '#ffb627', 0.06, 5, '#salve'],
      ])}
      <g stroke="#ff2bd6" stroke-width="5" stroke-linecap="round" opacity=".07">
        <path d="M120 342 v60"/><path d="M196 334 v34"/><path d="M290 322 v80"/><path d="M402 306 v44"/>
      </g>
      <g fill="none" stroke="#19f0ff" stroke-width="4" opacity=".08" filter="url(#th-spray)">
        <path d="M1210 560 l24 -40 l24 40 l-48 -26 h48 z"/>
        <path d="M210 120 q20 -40 40 0 q20 -40 40 0 l-10 30 h-60 z"/>
      </g>
      ${GRAIN}`,
  },

  neon: {
    name: 'Neon City',
    bg: '#0b0820',
    svg: () => {
      const rnd = seeded(7);
      let city = '';
      for (let x = -20; x < 1460;) {
        const w = 40 + rnd() * 70;
        const h = 90 + rnd() * 260;
        const top = 560 - h;
        city += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="#120d26"/>`;
        for (let wy = top + 12; wy < 548; wy += 16) {
          for (let wx = x + 8; wx < x + w - 8; wx += 12) {
            if (rnd() < 0.18) {
              const c = ['#19f0ff', '#ff2bd6', '#ffb627'][Math.floor(rnd() * 3)];
              city += `<rect x="${wx}" y="${wy}" width="5" height="7" fill="${c}" opacity="${0.25 + rnd() * 0.4}"/>`;
            }
          }
        }
        x += w + 4;
      }
      let grid = '';
      for (let i = -12; i <= 12; i++) grid += `<path d="M720 560 L${720 + i * 140} 900"/>`;
      for (let i = 1; i < 9; i++) {
        const y = 560 + Math.pow(i / 8, 2) * 340;
        grid += `<path d="M0 ${y} H1440"/>`;
      }
      return `
        <defs><linearGradient id="th-neon-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#07051a"/><stop offset=".55" stop-color="#1d0b3a"/>
          <stop offset=".62" stop-color="#3a0b4a"/><stop offset="1" stop-color="#07051a"/></linearGradient></defs>
        <rect width="1440" height="900" fill="url(#th-neon-sky)"/>
        <ellipse cx="720" cy="560" rx="700" ry="70" fill="#ff2bd6" opacity=".25" filter="url(#th-soft)"/>
        <g opacity=".75">${city}</g>
        <g stroke="#19f0ff" stroke-width="1.5" opacity=".18">${grid}</g>
        <text x="1180" y="250" font-family="Permanent Marker" font-size="40" fill="none" stroke="#ff2bd6" stroke-width="2" opacity=".5" filter="url(#th-glow)" transform="rotate(-4 1180 250)">2077</text>
        ${GRAIN}`;
    },
  },

  laje: {
    name: 'Laje',
    bg: '#0a1230',
    svg: () => {
      const rnd = seeded(21);
      let stars = '';
      for (let i = 0; i < 120; i++) {
        stars += `<circle cx="${rnd() * 1440}" cy="${rnd() * 420}" r="${0.6 + rnd() * 1.4}" fill="#fff" opacity="${0.2 + rnd() * 0.6}"/>`;
      }
      let houses = '';
      for (let x = -10; x < 1450;) {
        const w = 34 + rnd() * 46;
        const base = 640 - Math.sin((x / 1440) * Math.PI) * 140 + rnd() * 30;
        const h = 30 + rnd() * 40;
        houses += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 300}" fill="${rnd() < 0.5 ? '#141834' : '#11142c'}"/>`;
        if (rnd() < 0.6) houses += `<rect x="${x + w / 2 - 5}" y="${base - h + 10}" width="10" height="12" fill="#ffb627" opacity="${0.35 + rnd() * 0.45}"/>`;
        x += w + 2;
      }
      let bulbs = '';
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const x = 60 + t * 1320;
        const y = 70 + Math.sin(t * Math.PI) * 60;
        bulbs += `<circle cx="${x}" cy="${y}" r="5" fill="#ffd27a" filter="url(#th-glow)" opacity=".85"/>`;
      }
      return `
        <defs><linearGradient id="th-laje-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#060a1f"/><stop offset=".7" stop-color="#1a1f4a"/><stop offset="1" stop-color="#2a1d3a"/></linearGradient></defs>
        <rect width="1440" height="900" fill="url(#th-laje-sky)"/>
        ${stars}
        <circle cx="1210" cy="190" r="46" fill="#f1f3f5" opacity=".85"/>
        <circle cx="1210" cy="190" r="110" fill="#f1f3f5" opacity=".08" filter="url(#th-soft)"/>
        ${houses}
        <path d="M60 70 Q720 190 1380 70" fill="none" stroke="#000" stroke-width="2" opacity=".6"/>
        ${bulbs}
        <g transform="translate(1250 600)" opacity=".9">
          <rect x="0" y="0" width="120" height="70" rx="8" fill="#1c3f7a" stroke="#0a1230" stroke-width="3"/>
          <ellipse cx="60" cy="0" rx="60" ry="12" fill="#2b5aa8" stroke="#0a1230" stroke-width="3"/>
          <path d="M10 70 v60 M110 70 v60" stroke="#0a1230" stroke-width="8"/>
        </g>
        ${tags([[50, 330, 64, '#b6ff3b', 0.14, -6, 'LAJE']])}
        ${GRAIN}`;
    },
  },

  estacao: {
    name: 'Estação',
    bg: '#0f1518',
    svg: () => `
      <defs>
        <pattern id="th-tiles" width="60" height="30" patternUnits="userSpaceOnUse">
          <rect width="60" height="30" fill="#121b1f"/>
          <rect x="1" y="1" width="58" height="28" rx="3" fill="#16242a"/>
        </pattern>
      </defs>
      <rect width="1440" height="900" fill="url(#th-tiles)"/>
      <rect y="0" width="1440" height="900" fill="#000" opacity=".35"/>
      <rect y="380" width="1440" height="34" fill="#ffb627" opacity=".22"/>
      <rect y="418" width="1440" height="8" fill="#19f0ff" opacity=".25"/>
      <g transform="translate(70 120)">
        <rect width="380" height="70" rx="6" fill="#0b0f12" stroke="#2b3a40" stroke-width="3"/>
        <text x="190" y="46" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="28" fill="#e8e6ee" letter-spacing="4">ESTAÇÃO BADERNA</text>
      </g>
      <g>
        <rect x="200" y="0" width="300" height="10" fill="#e8f7ff" opacity=".7" filter="url(#th-glow)"/>
        <rect x="940" y="0" width="300" height="10" fill="#e8f7ff" opacity=".7" filter="url(#th-glow)"/>
        <ellipse cx="350" cy="10" rx="300" ry="60" fill="#e8f7ff" opacity=".07" filter="url(#th-soft)"/>
        <ellipse cx="1090" cy="10" rx="300" ry="60" fill="#e8f7ff" opacity=".07" filter="url(#th-soft)"/>
      </g>
      ${tags([
        [1040, 320, 64, '#ff2bd6', 0.16, -5, 'BDN'],
        [120, 690, 54, '#19f0ff', 0.12, 4, 'linha 4 = rolê'],
        [1100, 700, 44, '#b6ff3b', 0.12, -3, 'ZN'],
      ])}
      ${GRAIN}`,
  },

  garagem: {
    name: 'Garagem',
    bg: '#170b0a',
    svg: () => `
      <defs>
        <pattern id="th-bricks" width="96" height="48" patternUnits="userSpaceOnUse">
          <rect width="96" height="48" fill="#120807"/>
          <rect x="2" y="2" width="92" height="20" rx="2" fill="#2a1412"/>
          <rect x="-46" y="26" width="92" height="20" rx="2" fill="#26110f"/>
          <rect x="50" y="26" width="92" height="20" rx="2" fill="#2c1513"/>
        </pattern>
      </defs>
      <rect width="1440" height="900" fill="url(#th-bricks)"/>
      <rect width="1440" height="900" fill="#000" opacity=".3"/>
      <ellipse cx="1150" cy="190" rx="260" ry="110" fill="#ff2bd6" opacity=".12" filter="url(#th-soft)"/>
      <text x="1150" y="215" text-anchor="middle" font-family="Permanent Marker" font-size="84" fill="none" stroke="#ff7ae6" stroke-width="3" filter="url(#th-glow)" transform="rotate(-4 1150 215)">Baderna</text>
      <path d="M170 210 h120 l-30 -26 M290 210 l-30 26" fill="none" stroke="#19f0ff" stroke-width="4" stroke-linecap="round" filter="url(#th-glow)" opacity=".8"/>
      ${tags([
        [90, 520, 60, '#ffb627', 0.14, -6, 'OFICINA'],
        [1120, 560, 48, '#b6ff3b', 0.1, 5, 'sem hora pra acabar'],
      ])}
      <ellipse cx="380" cy="880" rx="200" ry="30" fill="#000" opacity=".5"/>
      ${GRAIN}`,
  },
};

const DEFAULT_THEME = 'grafite';

function themeSvg(id) {
  const theme = THEMES[id] ?? THEMES[DEFAULT_THEME];
  return `<defs>${THEME_DEFS}</defs>${theme.svg()}`;
}
