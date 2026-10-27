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

  cinema: {
    name: 'Cine Baderna',
    bg: '#12060a',
    svg: () => {
      let seats = '';
      for (let row = 0; row < 3; row++) {
        const y = 690 + row * 70;
        const w = 120 + row * 16;
        for (let x = -40 + (row % 2) * (w / 2); x < 1480; x += w + 10) {
          seats += `<path d="M${x} ${y + 90} V${y + 18} Q${x} ${y} ${x + 18} ${y} H${x + w - 18} Q${x + w} ${y} ${x + w} ${y + 18} V${y + 90} Z" fill="${row ? '#2a0d14' : '#3a111b'}"/>`;
        }
      }
      const curtain = (x, dir) => {
        let folds = '';
        for (let i = 0; i < 6; i++) {
          const fx = x + dir * i * 34;
          folds += `<path d="M${fx} 0 Q${fx + dir * 20} 450 ${fx - dir * 6} 900" stroke="#4a0b16" stroke-width="10" fill="none" opacity=".7"/>`;
        }
        return `<path d="M${x} 0 H${x + dir * 230} Q${x + dir * 150} 420 ${x + dir * 200} 900 H${x} Z" fill="#7a1022"/>${folds}`;
      };
      return `
        <defs>
          <linearGradient id="th-cine-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff6d6" stop-opacity=".22"/><stop offset="1" stop-color="#fff6d6" stop-opacity="0"/></linearGradient>
        </defs>
        <rect width="1440" height="900" fill="#12060a"/>
        <rect x="290" y="70" width="860" height="420" rx="10" fill="#1d2433" opacity=".9"/>
        <rect x="290" y="70" width="860" height="420" rx="10" fill="#9ad7ff" opacity=".12" filter="url(#th-soft)"/>
        <polygon points="700,900 740,900 1150,70 290,70" fill="url(#th-cine-beam)"/>
        ${CENTER_SHADE}
        ${curtain(0, 1)}${curtain(1440, -1)}
        <rect x="0" y="0" width="1440" height="40" fill="#5a0c1a"/>
        <path d="M0 40 ${Array.from({ length: 37 }, (_, i) => `Q${i * 40 + 20} 64 ${i * 40 + 40} 40`).join(' ')}" fill="#5a0c1a"/>
        <g transform="translate(720 30)">
          <rect x="-190" y="-2" width="380" height="54" rx="6" fill="#1a0a0d" stroke="#ffb627" stroke-width="2"/>
          ${Array.from({ length: 18 }, (_, i) => `<circle cx="${-180 + i * 21.2}" cy="2" r="3" fill="#ffd36b" filter="url(#th-glow)"/><circle cx="${-180 + i * 21.2}" cy="48" r="3" fill="#ffd36b" filter="url(#th-glow)"/>`).join('')}
          <text y="33" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="20" fill="#ffd36b" letter-spacing="3">SESSÃO DA MADRUGADA</text>
        </g>
        ${seats}
        ${GRAIN}`;
    },
  },

  boteco: {
    name: 'Boteco do Jorge',
    bg: '#0d1712',
    svg: () => `
      <defs>
        <pattern id="th-azulejo" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#dfe9e1"/>
          <rect x="1" y="1" width="58" height="58" fill="none" stroke="#b9c9bd" stroke-width="2"/>
          <path d="M30 10 L50 30 L30 50 L10 30 Z" fill="#2f7a55" opacity=".55"/>
          <circle cx="30" cy="30" r="5" fill="#dfe9e1"/>
        </pattern>
      </defs>
      <rect width="1440" height="560" fill="url(#th-azulejo)"/>
      <rect width="1440" height="560" fill="#04110a" opacity=".72"/>
      <rect y="560" width="1440" height="340" fill="#3b2516"/>
      <rect y="560" width="1440" height="16" fill="#5b3a22"/>
      <g transform="translate(1040 90)">
        <rect width="300" height="190" rx="10" fill="#111" stroke="#2b2b2b" stroke-width="8"/>
        <rect x="14" y="14" width="272" height="162" fill="#1f8a43"/>
        <path d="M150 14 V176 M14 95 H286" stroke="#fff" stroke-width="2" opacity=".6"/>
        <circle cx="150" cy="95" r="28" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/>
        <rect x="20" y="20" width="96" height="22" fill="#000" opacity=".7"/>
        <text x="68" y="36" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="13" fill="#ffb627">FLA 0 × 0 SPI</text>
        <rect x="145" y="190" width="10" height="40" fill="#222"/>
      </g>
      <g transform="translate(90 120)">
        <rect width="360" height="12" y="120" fill="#5b3a22"/>
        <rect width="360" height="12" y="240" fill="#5b3a22"/>
        ${[[20, '#2f9e44'], [70, '#c9a227'], [120, '#7a1430'], [170, '#e8590c'], [220, '#1c7ed6'], [270, '#2f9e44'], [320, '#c9a227']]
          .map(([x, c], i) => `<rect x="${x}" y="${50 + (i % 2) * 10}" width="26" height="${70 - (i % 2) * 10}" rx="6" fill="${c}" opacity=".8"/><rect x="${x + 9}" y="${34 + (i % 2) * 10}" width="8" height="20" fill="${c}" opacity=".8"/>`).join('')}
        ${[[40, '#f8f9fa'], [110, '#ffd43b'], [180, '#f8f9fa'], [250, '#ffd43b']]
          .map(([x, c]) => `<rect x="${x}" y="190" width="40" height="50" rx="4" fill="${c}" opacity=".55"/>`).join('')}
      </g>
      <g transform="translate(720 0)">
        <path d="M0 0 V70" stroke="#222" stroke-width="3"/>
        <circle cy="84" r="16" fill="#ffe8a3" filter="url(#th-glow)"/>
        <ellipse cy="420" rx="520" ry="380" fill="#ffd36b" opacity=".07" filter="url(#th-soft)"/>
      </g>
      ${CENTER_SHADE}
      <g transform="rotate(-3 1190 360)">
        <rect x="1030" y="320" width="320" height="70" fill="#f1e3c6"/>
        <text x="1190" y="366" text-anchor="middle" font-family="Permanent Marker" font-size="28" fill="#c92a2a">FIADO SÓ AMANHÃ</text>
      </g>
      ${GRAIN}`,
  },

  varzea: {
    name: 'Várzea',
    bg: '#1a0f1d',
    svg: () => {
      const rnd = seeded(23);
      let houses = '';
      for (let x = -20; x < 1460; x += 50 + rnd() * 40) {
        const h = 50 + rnd() * 90;
        const y = 470 - h - Math.sin(x / 230) * 40;
        const w = 46 + rnd() * 30;
        houses += `<rect x="${x}" y="${y}" width="${w}" height="${520 - y}" fill="${rnd() < 0.5 ? '#2a1830' : '#33203a'}"/>`;
        if (rnd() < 0.6) houses += `<rect x="${x + 10}" y="${y + 14}" width="10" height="12" fill="#ffd36b" opacity="${0.5 + rnd() * 0.4}"/>`;
      }
      return `
        <defs>
          <linearGradient id="th-varzea-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1640"/><stop offset=".55" stop-color="#d9480f"/><stop offset="1" stop-color="#ffb627"/></linearGradient>
        </defs>
        <rect width="1440" height="560" fill="url(#th-varzea-sky)"/>
        <circle cx="1080" cy="430" r="90" fill="#ffd36b" opacity=".85"/>
        ${houses}
        <path d="M0 150 Q360 210 720 160 T1440 170 M0 175 Q360 235 720 185 T1440 195" stroke="#120a14" stroke-width="2" fill="none"/>
        <rect x="200" y="60" width="10" height="500" fill="#120a14"/><rect x="1220" y="70" width="10" height="490" fill="#120a14"/>
        <g transform="translate(420 120) rotate(18)">
          <path d="M0 0 L36 -40 L72 0 L36 50 Z" fill="#ff2bd6"/><path d="M36 -40 V50 M0 0 H72" stroke="#120a14" stroke-width="2"/>
          <path d="M36 50 Q20 120 60 190" stroke="#120a14" stroke-width="1.5" fill="none"/>
        </g>
        <rect y="520" width="1440" height="380" fill="#8a5a2b"/>
        <rect y="520" width="1440" height="380" fill="#000" opacity=".28"/>
        ${Array.from({ length: 40 }, () => `<ellipse cx="${rnd() * 1440}" cy="${560 + rnd() * 330}" rx="${8 + rnd() * 20}" ry="${2 + rnd() * 4}" fill="#5c3a1b" opacity=".6"/>`).join('')}
        <g fill="none" stroke="#f1e3c6" stroke-width="10" stroke-linejoin="round" opacity=".85">
          <path d="M60 640 L64 470 L262 462 L270 645"/><path d="M1180 645 L1178 462 L1376 470 L1384 640"/>
        </g>
        <path d="M0 700 Q720 650 1440 700" stroke="#f1e3c6" stroke-width="4" fill="none" opacity=".35"/>
        ${CENTER_SHADE}
        ${tags([[90, 420, 34, '#f1e3c6', 0.22, -4, 'VÁRZEA FC · DESDE ONTEM']])}
        ${GRAIN}`;
    },
  },

  palco: {
    name: 'Palco do Rock',
    bg: '#08050c',
    svg: () => {
      const rnd = seeded(31);
      let crowd = '';
      for (let x = -20; x < 1460; x += 28 + rnd() * 12) {
        const y = 820 + rnd() * 30;
        crowd += `<circle cx="${x}" cy="${y}" r="16" fill="#050307"/><rect x="${x - 22}" y="${y + 12}" width="44" height="80" rx="14" fill="#050307"/>`;
        if (rnd() < 0.35) crowd += `<path d="M${x + 10} ${y} L${x + 24} ${y - 70}" stroke="#050307" stroke-width="9" stroke-linecap="round"/><path d="M${x + 20} ${y - 70} l-4 -14 M${x + 28} ${y - 72} l4 -14" stroke="#050307" stroke-width="5" stroke-linecap="round"/>`;
      }
      const amp = (x) => `<g transform="translate(${x} 430)">${[0, 1, 2].map((i) => `
        <rect y="${i * 72}" width="150" height="70" rx="4" fill="#141016" stroke="#2a2430" stroke-width="3"/>
        <rect x="10" y="${i * 72 + 10}" width="130" height="50" fill="#221c26"/>`).join('')}
        <text x="75" y="-8" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="14" fill="#c9a227">MARSHMALLOW</text></g>`;
      const beam = (x, color, tilt) => `<polygon points="${x - 18},40 ${x + 18},40 ${x + tilt + 170},640 ${x + tilt - 170},640" fill="${color}" opacity=".13" filter="url(#th-soft)"/>
        <circle cx="${x}" cy="40" r="16" fill="${color}" filter="url(#th-glow)"/>`;
      return `
        <rect width="1440" height="900" fill="#08050c"/>
        <rect y="0" width="1440" height="26" fill="#1a1520"/>
        ${beam(260, '#ff2bd6', 120)}${beam(560, '#19f0ff', 40)}${beam(880, '#b6ff3b', -40)}${beam(1180, '#ffb627', -120)}
        <rect y="640" width="1440" height="40" fill="#1a1520"/><rect y="640" width="1440" height="4" fill="#3a3044"/>
        ${amp(40)}${amp(1250)}
        <g transform="translate(720 600)" fill="#120e16" stroke="#2a2430" stroke-width="3">
          <ellipse cx="0" cy="0" rx="70" ry="40"/><ellipse cx="-110" cy="-20" rx="34" ry="14"/><ellipse cx="110" cy="-20" rx="34" ry="14"/>
          <path d="M-110 -20 V40 M110 -20 V40" fill="none"/><ellipse cx="-160" cy="-70" rx="40" ry="6" stroke="#c9a227"/><ellipse cx="160" cy="-70" rx="40" ry="6" stroke="#c9a227"/>
        </g>
        ${CENTER_SHADE}
        <g transform="translate(720 120)">
          <rect x="-300" y="-46" width="600" height="80" fill="#120e16" stroke="#ff2bd6" stroke-width="2" opacity=".85"/>
          <text y="12" text-anchor="middle" font-family="Permanent Marker" font-size="40" fill="#ff7ae6" filter="url(#th-glow)">FERRATICA WORLD TOUR</text>
        </g>
        ${crowd}
        ${GRAIN}`;
    },
  },

  espaco: {
    name: 'Nave Baderna',
    bg: '#03040c',
    svg: () => {
      const rnd = seeded(41);
      let stars = '';
      for (let i = 0; i < 220; i++) {
        stars += `<circle cx="${rnd() * 1440}" cy="${rnd() * 640}" r="${rnd() * 1.8 + 0.3}" fill="#fff" opacity="${0.3 + rnd() * 0.7}"/>`;
      }
      return `
        <defs>
          <radialGradient id="th-planet" cx=".35" cy=".35"><stop offset="0" stop-color="#ff9a3c"/><stop offset=".7" stop-color="#b8326a"/><stop offset="1" stop-color="#3a0d3a"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="#03040c"/>
        <ellipse cx="400" cy="300" rx="420" ry="200" fill="#7048e8" opacity=".14" filter="url(#th-soft)"/>
        <ellipse cx="1100" cy="200" rx="300" ry="150" fill="#19f0ff" opacity=".08" filter="url(#th-soft)"/>
        ${stars}
        <g transform="translate(1120 250)">
          <circle r="110" fill="url(#th-planet)"/>
          <ellipse rx="190" ry="34" fill="none" stroke="#ffd36b" stroke-width="10" opacity=".55" transform="rotate(-18)"/>
        </g>
        <g fill="#0b0f1c" stroke="#1f2a44" stroke-width="4">
          <path d="M0 0 H1440 V70 Q720 20 0 70 Z"/>
          <path d="M0 0 V640 Q60 360 70 0 Z"/><path d="M1440 0 V640 Q1380 360 1370 0 Z"/>
          <rect y="600" width="1440" height="300"/>
        </g>
        <path d="M0 600 H1440" stroke="#19f0ff" stroke-width="3" opacity=".6" filter="url(#th-glow)"/>
        ${Array.from({ length: 12 }, (_, i) => `<rect x="${60 + i * 116}" y="630" width="70" height="10" rx="3" fill="${['#19f0ff', '#ff2bd6', '#b6ff3b'][i % 3]}" opacity=".45"/>`).join('')}
        ${CENTER_SHADE}
        <g font-family="Chakra Petch" font-weight="700" fill="#19f0ff" opacity=".55">
          <text x="110" y="130" font-size="16" letter-spacing="3">DESTINO: SEXTA À NOITE</text>
          <text x="110" y="154" font-size="13" letter-spacing="2">COMBUSTÍVEL: REFRI E PIPOCA</text>
        </g>
        ${GRAIN}`;
    },
  },

  dojo: {
    name: 'Dojo',
    bg: '#140a08',
    svg: () => {
      const rnd = seeded(53);
      let petals = '';
      for (let i = 0; i < 60; i++) {
        const x = rnd() * 1440;
        const y = rnd() * 560;
        petals += `<ellipse cx="${x}" cy="${y}" rx="6" ry="3.5" fill="#ffb3c7" opacity="${0.4 + rnd() * 0.5}" transform="rotate(${rnd() * 180} ${x} ${y})"/>`;
      }
      let shoji = '';
      for (let x = 0; x < 1440; x += 240) {
        shoji += `<rect x="${x + 6}" y="0" width="228" height="560" fill="#e9dcc0" opacity=".13"/>`;
        for (let gx = 1; gx < 4; gx++) shoji += `<path d="M${x + 6 + gx * 57} 0 V560" stroke="#3b2414" stroke-width="4"/>`;
        for (let gy = 1; gy < 7; gy++) shoji += `<path d="M${x + 6} ${gy * 80} H${x + 234}" stroke="#3b2414" stroke-width="4"/>`;
      }
      return `
        <rect width="1440" height="900" fill="#140a08"/>
        <circle cx="720" cy="300" r="230" fill="#e03131" opacity=".5"/>
        <circle cx="720" cy="300" r="300" fill="#e03131" opacity=".15" filter="url(#th-soft)"/>
        ${shoji}
        <path d="M0 0 H1440" stroke="#3b2414" stroke-width="30"/>
        ${[0, 240, 480, 720, 960, 1200, 1440].map((x) => `<rect x="${x - 6}" y="0" width="12" height="560" fill="#2a170c"/>`).join('')}
        <rect y="560" width="1440" height="340" fill="#6b5a2e"/>
        ${Array.from({ length: 8 }, (_, i) => `<rect x="${i * 180}" y="560" width="180" height="340" fill="none" stroke="#3b3018" stroke-width="5"/>`).join('')}
        <rect y="560" width="1440" height="340" fill="#000" opacity=".3"/>
        ${petals}
        ${CENTER_SHADE}
        <g transform="translate(160 120)">
          <rect x="-50" y="-20" width="100" height="300" fill="#f1e3c6" opacity=".85"/>
          <text y="70" text-anchor="middle" font-size="72" fill="#1a1a1a" font-family="serif">道</text>
          <text y="170" text-anchor="middle" font-size="72" fill="#1a1a1a" font-family="serif">場</text>
          <circle cy="240" r="16" fill="#c92a2a"/>
        </g>
        ${GRAIN}`;
    },
  },

  praia: {
    name: 'Futevôlei na Praia',
    bg: '#062033',
    svg: () => `
      <defs>
        <linearGradient id="th-praia-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b3d63"/><stop offset="1" stop-color="#36a2c9"/></linearGradient>
      </defs>
      <rect width="1440" height="420" fill="url(#th-praia-sky)"/>
      <circle cx="1180" cy="120" r="64" fill="#ffe08a" filter="url(#th-glow)"/>
      <path d="M0 330 Q200 250 400 310 Q520 260 640 320 L640 420 L0 420 Z" fill="#164f3a" opacity=".8"/>
      <rect y="400" width="1440" height="120" fill="#1772a3"/>
      ${[430, 460, 490].map((y, i) => `<path d="M0 ${y} ${Array.from({ length: 24 }, (_, k) => `q30 -${6 + i * 2} 60 0`).join(' ')}" stroke="#bfe9ff" stroke-width="3" fill="none" opacity="${0.5 - i * 0.12}"/>`).join('')}
      <rect y="515" width="1440" height="385" fill="#e9c98a"/>
      <rect y="515" width="1440" height="385" fill="#000" opacity=".22"/>
      <path d="M150 515 V720 M1290 515 V720" stroke="#f1e3c6" stroke-width="8"/>
      <path d="M150 540 H1290" stroke="#f1e3c6" stroke-width="4"/>
      <g stroke="#f1e3c6" stroke-width="1.5" opacity=".6">
        ${Array.from({ length: 58 }, (_, i) => `<path d="M${150 + i * 20} 540 V600"/>`).join('')}
        <path d="M150 570 H1290 M150 600 H1290"/>
      </g>
      <g transform="translate(1270 620)">
        <path d="M0 0 L-6 260" stroke="#7a4a1f" stroke-width="8"/>
        <path d="M-150 10 Q0 -90 150 10 Z" fill="#e03131"/>
        <path d="M-150 10 Q-75 -60 0 -40 L0 -40 Q75 -60 150 10" fill="none" stroke="#f8f9fa" stroke-width="10" opacity=".8"/>
      </g>
      <circle cx="420" cy="230" r="22" fill="#ffd43b" stroke="#1b1b1b" stroke-width="3"/>
      ${CENTER_SHADE}
      ${tags([[90, 470, 36, '#fff', 0.25, -3, 'FUTEVÔLEI DO JORGE']])}
      ${GRAIN}`,
  },
};

const DEFAULT_THEME = 'arena';

function themeSvg(id) {
  const theme = THEMES[id] ?? THEMES[DEFAULT_THEME];
  return `<defs>${THEME_DEFS}</defs>${theme.svg()}`;
}
