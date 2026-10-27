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

// Escurece o miolo da tela, onde fica o chat, sem apagar as bordas.
const CENTER_SHADE = '<ellipse cx="720" cy="360" rx="480" ry="300" fill="#000" opacity=".45" filter="url(#th-soft)"/>';

// Pixel art a partir de linhas de texto: '#' pinta, '.' é vazio.
function pixelArt(rows, x, y, size, color, opacity = 1) {
  let out = '';
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '#') out += `<rect x="${x + c * size}" y="${y + r * size}" width="${size}" height="${size}"/>`;
    });
  });
  return `<g fill="${color}" opacity="${opacity}">${out}</g>`;
}

const PIXEL_HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const PIXEL_BLOB = ['...##...', '..####..', '.######.', '##.##.##', '########', '########', '.######.'];
const PIXEL_ROCKET = ['...#...', '..###..', '..#.#..', '..###..', '.#####.', '##.#.##', '#..#..#'];
const PIXEL_COIN = ['.###.', '#####', '##.##', '#####', '.###.'];

const THEMES = {
  arena: {
    name: 'Arena eSports',
    bg: '#07070f',
    svg: () => {
      const rnd = seeded(11);
      let crowd = '';
      for (let x = -10; x < 1450; x += 26 + rnd() * 10) {
        const y = 800 + rnd() * 40;
        const r = 14 + rnd() * 6;
        crowd += `<circle cx="${x}" cy="${y}" r="${r}" fill="#0c0c16"/><rect x="${x - r - 6}" y="${y + r - 4}" width="${2 * r + 12}" height="80" rx="14" fill="#0c0c16"/>`;
        if (rnd() < 0.25) crowd += `<rect x="${x + 6}" y="${y - 40 - rnd() * 20}" width="6" height="10" rx="1" fill="#fff" opacity=".8" filter="url(#th-glow)"/>`;
      }
      return `
        <defs>
          <pattern id="th-hex" width="48" height="83" patternUnits="userSpaceOnUse">
            <path d="M24 0 L48 14 L48 41 L24 55 L0 41 L0 14 Z M24 55 L24 83" fill="none" stroke="#19f0ff" stroke-width="1.2"/>
          </pattern>
          <linearGradient id="th-led" x1="0" x2="1"><stop offset="0" stop-color="#19f0ff"/><stop offset=".5" stop-color="#ff2bd6"/><stop offset="1" stop-color="#b6ff3b"/></linearGradient>
        </defs>
        <rect width="1440" height="900" fill="#07070f"/>
        <rect width="1440" height="900" fill="url(#th-hex)" opacity=".12"/>
        <polygon points="0,0 160,0 640,900 380,900" fill="#19f0ff" opacity=".07" filter="url(#th-soft)"/>
        <polygon points="1440,0 1280,0 800,900 1060,900" fill="#ff2bd6" opacity=".07" filter="url(#th-soft)"/>
        <circle cx="80" cy="40" r="22" fill="#19f0ff" opacity=".9" filter="url(#th-glow)"/>
        <circle cx="1360" cy="40" r="22" fill="#ff2bd6" opacity=".9" filter="url(#th-glow)"/>
        ${CENTER_SHADE}
        <rect x="0" y="610" width="1440" height="5" fill="url(#th-led)" filter="url(#th-glow)" opacity=".9"/>
        <g font-family="Chakra Petch" font-weight="700">
          <text x="60" y="190" font-size="40" fill="none" stroke="#19f0ff" stroke-width="1.5" opacity=".55" letter-spacing="6">BADERNA CUP</text>
          <text x="60" y="226" font-size="16" fill="#ff3b5c" opacity=".7" letter-spacing="4">● AO VIVO · GRANDE FINAL</text>
          <text x="1110" y="460" font-size="70" fill="none" stroke="#ff2bd6" stroke-width="1.5" opacity=".35">GG</text>
        </g>
        ${crowd}
        ${GRAIN}`;
    },
  },

  estadio: {
    name: 'Estádio',
    bg: '#06101c',
    svg: () => {
      const rnd = seeded(5);
      let stripes = '';
      for (let i = -12; i < 12; i++) {
        const x1 = 720 + i * 60;
        const x2 = 720 + i * 220;
        const x3 = 720 + (i + 1) * 220;
        const x4 = 720 + (i + 1) * 60;
        stripes += `<polygon points="${x1},560 ${x2},900 ${x3},900 ${x4},560" fill="${i % 2 ? '#1e7a3c' : '#23893f'}"/>`;
      }
      let sparks = '';
      for (let i = 0; i < 160; i++) {
        sparks += `<rect x="${rnd() * 1440}" y="${390 + rnd() * 160}" width="3" height="3" fill="#fff" opacity="${0.2 + rnd() * 0.5}"/>`;
      }
      const tower = (x, flip) => {
        let lamps = '';
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
          lamps += `<circle cx="${x - 54 + c * 36}" cy="${70 + r * 30}" r="10" fill="#fffbe6" filter="url(#th-glow)"/>`;
        }
        return `
          <polygon points="${x - 70},140 ${x + 70},140 ${flip ? 300 : 1140},900 ${flip ? 0 : 1440},900" fill="#fffbe6" opacity=".05" filter="url(#th-soft)"/>
          <rect x="${x - 6}" y="140" width="12" height="420" fill="#0b1220"/>
          <rect x="${x - 76}" y="50" width="152" height="100" rx="6" fill="#0b1220" stroke="#1d2a3d" stroke-width="3"/>
          ${lamps}`;
      };
      return `
        <defs>
          <linearGradient id="th-std-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040a14"/><stop offset="1" stop-color="#0c1d30"/></linearGradient>
          <pattern id="th-crowd" width="24" height="14" patternUnits="userSpaceOnUse">
            <rect width="24" height="14" fill="#0d1624"/>
            <circle cx="4" cy="5" r="3" fill="#ff3b5c" opacity=".45"/><circle cx="12" cy="9" r="3" fill="#f8f9fa" opacity=".35"/>
            <circle cx="20" cy="4" r="3" fill="#19f0ff" opacity=".35"/><circle cx="16" cy="12" r="2.5" fill="#ffb627" opacity=".35"/>
          </pattern>
        </defs>
        <rect width="1440" height="900" fill="url(#th-std-sky)"/>
        <rect y="380" width="1440" height="180" fill="url(#th-crowd)"/>
        <rect y="380" width="1440" height="180" fill="#000" opacity=".25"/>
        ${sparks}
        <rect y="552" width="1440" height="10" fill="#0b1220"/>
        ${stripes}
        <g fill="none" stroke="#fff" stroke-width="3" opacity=".45">
          <path d="M0 720 H1440"/><ellipse cx="720" cy="720" rx="230" ry="46"/><path d="M60 562 L0 640 M1380 562 L1440 640"/>
        </g>
        ${tower(150, true)}${tower(1290, false)}
        ${CENTER_SHADE}
        <g transform="translate(250 92)">
          <rect width="250" height="64" rx="8" fill="#05080d" stroke="#1d2a3d" stroke-width="3"/>
          <text x="125" y="44" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="30" fill="#ffb627" letter-spacing="3">BAD 2 × 1 VIS</text>
        </g>
        ${GRAIN}`;
    },
  },

  quadra: {
    name: 'Quadra',
    bg: '#140d09',
    svg: () => {
      let planks = '';
      for (let i = -20; i <= 20; i++) planks += `<path d="M${720 + i * 30} 560 L${720 + i * 120} 900"/>`;
      const flags = ['#ff3b5c', '#ffb627', '#19f0ff', '#b6ff3b', '#ff2bd6'];
      let pennants = '';
      for (let i = 0; i < 24; i++) {
        const x = 30 + i * 60;
        const y = 70 + Math.sin((i / 23) * Math.PI) * 40;
        pennants += `<polygon points="${x},${y} ${x + 44},${y + 2} ${x + 22},${y + 40}" fill="${flags[i % flags.length]}" opacity=".3"/>`;
      }
      return `
        <defs>
          <linearGradient id="th-qd-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e0a08"/><stop offset="1" stop-color="#22160f"/></linearGradient>
          <linearGradient id="th-qd-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4a22"/><stop offset="1" stop-color="#b06d32"/></linearGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#th-qd-wall)"/>
        <rect x="160" y="0" width="260" height="10" fill="#fff6e0" opacity=".7" filter="url(#th-glow)"/>
        <rect x="1020" y="0" width="260" height="10" fill="#fff6e0" opacity=".7" filter="url(#th-glow)"/>
        <path d="M30 70 Q720 150 1410 70" fill="none" stroke="#000" stroke-width="2" opacity=".6"/>
        ${pennants}
        <polygon points="0,560 1440,560 1440,900 0,900" fill="url(#th-qd-floor)"/>
        <g stroke="#000" stroke-width="2" opacity=".15">${planks}</g>
        <ellipse cx="720" cy="620" rx="600" ry="30" fill="#fff" opacity=".05"/>
        <g fill="none" stroke="#fff" stroke-width="4" opacity=".55">
          <path d="M0 600 H1440"/><ellipse cx="720" cy="760" rx="160" ry="40"/><path d="M720 600 V900"/>
        </g>
        <g transform="translate(110 240)">
          <rect x="66" y="150" width="12" height="320" fill="#2b2b2b"/>
          <rect width="150" height="100" rx="4" fill="#f1f3f5" opacity=".9" stroke="#2b2b2b" stroke-width="4"/>
          <rect x="45" y="40" width="60" height="44" fill="none" stroke="#ff6b00" stroke-width="4"/>
          <ellipse cx="75" cy="112" rx="38" ry="8" fill="none" stroke="#ff6b00" stroke-width="5"/>
          <path d="M40 114 L50 160 M58 116 L62 162 M75 118 V164 M92 116 L88 162 M110 114 L100 160 M45 136 H105 M50 152 H100" stroke="#fff" stroke-width="2" opacity=".7"/>
        </g>
        <circle cx="1240" cy="520" r="34" fill="#e8590c" stroke="#2b1408" stroke-width="3"/>
        <path d="M1206 520 H1274 M1240 486 V554 M1216 496 Q1240 520 1216 544 M1264 496 Q1240 520 1264 544" fill="none" stroke="#2b1408" stroke-width="3"/>
        ${CENTER_SHADE}
        <text x="1160" y="250" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="34" fill="#ffb627" opacity=".45" letter-spacing="4">CAMPEÕES 2026</text>
        ${GRAIN}`;
    },
  },

  fliperama: {
    name: 'Fliperama',
    bg: '#0a0614',
    svg: () => {
      const rnd = seeded(3);
      let stars = '';
      for (let i = 0; i < 140; i++) {
        const s = rnd() < 0.8 ? 3 : 5;
        stars += `<rect x="${Math.round(rnd() * 1440)}" y="${Math.round(rnd() * 560)}" width="${s}" height="${s}" fill="${rnd() < 0.7 ? '#fff' : '#19f0ff'}" opacity="${0.3 + rnd() * 0.6}"/>`;
      }
      let hills = '';
      for (let x = 0, h = 80; x < 1440; x += 40) {
        h = Math.max(40, Math.min(220, h + (rnd() - 0.5) * 80));
        hills += `<rect x="${x}" y="${700 - h}" width="40" height="${h + 200}"/>`;
      }
      let blocks = '';
      for (let x = 0; x < 1440; x += 32) blocks += `<rect x="${x + 1}" y="801" width="30" height="30" fill="#3a1f6e"/><rect x="${x + 1}" y="833" width="30" height="30" fill="#2c1656"/>`;
      return `
        <rect width="1440" height="900" fill="#0a0614"/>
        ${stars}
        <g fill="#1d0f3a">${hills}</g>
        <rect y="800" width="1440" height="100" fill="#1a0d33"/>
        ${blocks}
        ${CENTER_SHADE}
        ${pixelArt(PIXEL_HEART, 40, 96, 6, '#ff3b5c')}${pixelArt(PIXEL_HEART, 92, 96, 6, '#ff3b5c')}${pixelArt(PIXEL_HEART, 144, 96, 6, '#ff3b5c', 0.3)}
        ${pixelArt(PIXEL_BLOB, 110, 330, 10, '#b6ff3b', 0.75)}
        ${pixelArt(PIXEL_ROCKET, 1250, 200, 10, '#ff2bd6', 0.75)}
        ${pixelArt(PIXEL_BLOB, 1190, 500, 8, '#19f0ff', 0.6)}
        ${pixelArt(PIXEL_COIN, 260, 450, 8, '#ffd43b', 0.85)}${pixelArt(PIXEL_COIN, 320, 450, 8, '#ffd43b', 0.85)}${pixelArt(PIXEL_COIN, 380, 450, 8, '#ffd43b', 0.85)}
        <g font-family="Chakra Petch" font-weight="700" letter-spacing="4">
          <text x="210" y="128" font-size="22" fill="#fff" opacity=".75">1UP 004200</text>
          <text x="40" y="180" font-size="16" fill="#ffd43b" opacity=".6">HI-SCORE 999999</text>
          <text x="150" y="620" text-anchor="middle" font-size="26" fill="#19f0ff" opacity=".7" filter="url(#th-glow)">INSERT COIN</text>
        </g>
        ${GRAIN}`;
    },
  },

  setup: {
    name: 'Setup Gamer',
    bg: '#0b0b12',
    svg: () => `
      <defs>
        <pattern id="th-foam" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#14141d"/>
          <path d="M0 0 L30 30 L0 60 Z" fill="#1b1b27"/><path d="M60 0 L30 30 L60 60 Z" fill="#101018"/>
          <rect width="60" height="60" fill="none" stroke="#08080c" stroke-width="2"/>
        </pattern>
        <linearGradient id="th-rgb" x1="0" x2="1">
          <stop offset="0" stop-color="#ff3b5c"/><stop offset=".25" stop-color="#ffb627"/><stop offset=".5" stop-color="#b6ff3b"/>
          <stop offset=".75" stop-color="#19f0ff"/><stop offset="1" stop-color="#ff2bd6"/>
        </linearGradient>
      </defs>
      <rect width="1440" height="900" fill="#0b0b12"/>
      <rect x="20" y="100" width="300" height="420" fill="url(#th-foam)" rx="6"/>
      <rect x="1120" y="100" width="300" height="300" fill="url(#th-foam)" rx="6"/>
      <rect y="0" width="1440" height="6" fill="url(#th-rgb)" filter="url(#th-glow)"/>
      <rect y="0" width="1440" height="120" fill="url(#th-rgb)" opacity=".06" filter="url(#th-soft)"/>
      <text x="1270" y="290" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="120" fill="none" stroke="#ff2bd6" stroke-width="4" filter="url(#th-glow)">GG</text>
      <g transform="translate(1180 470)" opacity=".9">
        <rect width="200" height="8" fill="#2a2a38"/>
        <path d="M20 0 V-36 H52 V0 M30 -36 Q36 -56 42 -36" fill="#ffd43b" opacity=".75"/>
        <rect x="80" y="-30" width="30" height="30" rx="4" fill="#7048e8" opacity=".7"/>
        <rect x="124" y="-46" width="22" height="46" rx="4" fill="#19f0ff" opacity=".55"/>
        <circle cx="172" cy="-14" r="14" fill="#ff3b5c" opacity=".6"/>
      </g>
      <g transform="translate(80 370) scale(.9)" fill="none" stroke="#19f0ff" stroke-width="4" filter="url(#th-glow)" opacity=".75">
        <path d="M40 0 H160 Q200 0 210 50 L222 110 Q226 140 196 140 Q180 140 168 112 L156 86 H44 L32 112 Q20 140 4 140 Q-26 140 -22 110 L-10 50 Q0 0 40 0 Z"/>
        <path d="M40 34 V66 M24 50 H56"/><circle cx="150" cy="38" r="7"/><circle cx="170" cy="58" r="7"/>
      </g>
      ${CENTER_SHADE}
      ${GRAIN}`,
  },

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

const DEFAULT_THEME = 'arena';

function themeSvg(id) {
  const theme = THEMES[id] ?? THEMES[DEFAULT_THEME];
  return `<defs>${THEME_DEFS}</defs>${theme.svg()}`;
}
