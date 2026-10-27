'use strict';

// Bonecos em estilo recorte de papel, sentados na cadeira de cada um.
// O avatar viaja entre os peers e vira SVG via string, então TODO campo é
// validado contra as listas abaixo (sanitizeAvatar) antes de desenhar.

const INK = '#17151c';

const AVATAR_PALETTE = [
  '#ff2bd6', '#19f0ff', '#b6ff3b', '#ffb627', '#ff3b5c', '#ff6b00',
  '#7048e8', '#364fc7', '#2f9e44', '#f8f9fa', '#495057', '#212529',
];

// Camisas que lembram os times pelas cores e listras, sem escudo nem nome.
// main: cor principal (usada nas cadeiras); swatch: CSS do botão no editor;
// draw(a, t): listras dentro do recorte do tronco; t = altura do ombro, pra
// gola acompanhar o tipo de corpo. A área cobre o tronco mais largo.
const KIT_AREA = '<rect x="0" y="80" width="160" height="100" fill="FILL"/>';
const area = (fill) => KIT_AREA.replace('FILL', fill);
const range = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const vCollar = (t) => `<path d="M66 ${t} L80 ${t + 16} L94 ${t}" fill="none" stroke="#f8f9fa" stroke-width="4"/>`;

const KITS = {
  'lisa': { main: null, swatch: 'linear-gradient(135deg, #ff2bd6, #19f0ff)', draw: (a) => area(a.shirt) },
  'rubro-negra': {
    main: '#d1001f', swatch: 'repeating-linear-gradient(0deg, #d1001f 0 5px, #111 5px 10px)',
    draw: () => area('#111') + range(86, 170, 12).map((y) => `<rect x="0" y="${y}" width="160" height="6" fill="#d1001f"/>`).join(''),
  },
  'alvinegra': {
    main: '#212529', swatch: 'repeating-linear-gradient(90deg, #111 0 5px, #f8f9fa 5px 10px)',
    draw: () => area('#f8f9fa') + range(12, 148, 12).map((x) => `<rect x="${x}" y="80" width="6" height="100" fill="#111"/>`).join(''),
  },
  'tricolor faixa': {
    main: '#d1001f', swatch: 'linear-gradient(#f8f9fa 0 35%, #d1001f 35% 50%, #f8f9fa 50% 55%, #111 55% 70%, #f8f9fa 70%)',
    draw: (a, t) => area('#f8f9fa') + `<rect x="0" y="${t + 12}" width="160" height="7" fill="#d1001f"/><rect x="0" y="${t + 24}" width="160" height="7" fill="#111"/>`,
  },
  'verdão': { main: '#0b6b3a', swatch: '#0b6b3a', draw: (a, t) => area('#0b6b3a') + vCollar(t) },
  'faixa diagonal': {
    main: '#212529', swatch: 'linear-gradient(135deg, #111 0 40%, #f8f9fa 40% 60%, #111 60%)',
    draw: (a, t) => area('#111') + `<path d="M30 ${t - 4} L56 ${t - 4} L140 ${t + 52} L140 180 L110 180 Z" fill="#f8f9fa"/>`,
  },
  'tricolor grená': {
    main: '#7a1430', swatch: 'repeating-linear-gradient(90deg, #7a1430 0 6px, #fff 6px 7px, #0b6b3a 7px 13px, #fff 13px 14px)',
    draw: () => area('#7a1430') + range(16, 136, 24).map((x) =>
      `<rect x="${x - 2}" y="80" width="14" height="100" fill="#f8f9fa"/><rect x="${x}" y="80" width="10" height="100" fill="#0b6b3a"/>`).join(''),
  },
  'colorada': { main: '#d1001f', swatch: '#d1001f', draw: (a, t) => area('#d1001f') + vCollar(t) },
  'celeste': {
    main: '#1c3faa', swatch: '#1c3faa',
    draw: (a, t) => area('#1c3faa') + vCollar(t) + `<path d="M0 ${t + 30} H160" stroke="#f8f9fa" stroke-width="2" opacity=".5"/>`,
  },
  'tricolor gaúcha': {
    main: '#0d7fd1', swatch: 'repeating-linear-gradient(90deg, #0d7fd1 0 5px, #111 5px 10px, #fff 10px 11px)',
    draw: () => area('#0d7fd1') + range(4, 148, 16).map((x) =>
      `<rect x="${x}" y="80" width="7" height="100" fill="#111"/><rect x="${x + 7}" y="80" width="2" height="100" fill="#f8f9fa"/>`).join(''),
  },
  'canarinho': {
    main: '#ffd43b', swatch: 'linear-gradient(#ffd43b 0 75%, #0b6b3a 75%)',
    draw: (a, t) => area('#ffd43b') + `<path d="M66 ${t} L80 ${t + 14} L94 ${t}" fill="none" stroke="#0b6b3a" stroke-width="5"/><path d="M0 ${t + 48} H160" stroke="#0b6b3a" stroke-width="3"/>`,
  },
  'alviverde listrada': {
    main: '#0b6b3a', swatch: 'repeating-linear-gradient(0deg, #0b6b3a 0 5px, #f8f9fa 5px 10px)',
    draw: () => area('#f8f9fa') + range(86, 170, 12).map((y) => `<rect x="0" y="${y}" width="160" height="6" fill="#0b6b3a"/>`).join(''),
  },
  'rubro-negra vertical': {
    main: '#c1121f', swatch: 'repeating-linear-gradient(90deg, #c1121f 0 6px, #111 6px 12px)',
    draw: () => area('#111') + range(10, 150, 14).map((x) => `<rect x="${x}" y="80" width="7" height="100" fill="#c1121f"/>`).join(''),
  },
  'tricolor baiana': {
    main: '#1c3faa', swatch: 'linear-gradient(#1c3faa 0 30%, #d1001f 30% 45%, #f8f9fa 45% 55%, #d1001f 55% 70%, #1c3faa 70%)',
    draw: (a, t) => area('#1c3faa') + `<rect x="0" y="${t + 12}" width="160" height="6" fill="#d1001f"/><rect x="0" y="${t + 18}" width="160" height="5" fill="#f8f9fa"/><rect x="0" y="${t + 23}" width="160" height="6" fill="#d1001f"/>`,
  },
  'celeste listrada': {
    main: '#4dabf7', swatch: 'repeating-linear-gradient(90deg, #4dabf7 0 6px, #f8f9fa 6px 12px)',
    draw: () => area('#f8f9fa') + range(10, 150, 14).map((x) => `<rect x="${x}" y="80" width="7" height="100" fill="#4dabf7"/>`).join(''),
  },
  'goleiro neon': {
    main: '#b6ff3b', swatch: 'linear-gradient(90deg, #212529 0 22%, #b6ff3b 22% 78%, #212529 78%)',
    draw: (a, t) => area('#b6ff3b') + `<path d="M0 80 H52 L34 180 H0 Z M160 80 H108 L126 180 H160 Z" fill="#212529"/>`
      + range(40, 120, 16).map((x) => `<path d="M${x} ${t + 36} l8 -7 l8 7" fill="none" stroke="#212529" stroke-width="2.5"/>`).join(''),
  },
  'alvirrubra': {
    main: '#d1001f', swatch: 'repeating-linear-gradient(90deg, #d1001f 0 6px, #f8f9fa 6px 12px)',
    draw: () => area('#f8f9fa') + range(10, 150, 14).map((x) => `<rect x="${x}" y="80" width="7" height="100" fill="#d1001f"/>`).join(''),
  },
  'alvinegra horizontal': {
    main: '#212529', swatch: 'repeating-linear-gradient(0deg, #111 0 5px, #f8f9fa 5px 10px)',
    draw: () => area('#f8f9fa') + range(86, 170, 12).map((y) => `<rect x="0" y="${y}" width="160" height="6" fill="#111"/>`).join(''),
  },
  'alviverde vertical': {
    main: '#0b6b3a', swatch: 'repeating-linear-gradient(90deg, #0b6b3a 0 6px, #f8f9fa 6px 12px)',
    draw: () => area('#f8f9fa') + range(10, 150, 14).map((x) => `<rect x="${x}" y="80" width="7" height="100" fill="#0b6b3a"/>`).join(''),
  },
  'verde e amarela listrada': {
    main: '#2f9e44', swatch: 'repeating-linear-gradient(90deg, #2f9e44 0 6px, #ffd43b 6px 12px)',
    draw: () => area('#ffd43b') + range(10, 150, 14).map((x) => `<rect x="${x}" y="80" width="7" height="100" fill="#2f9e44"/>`).join(''),
  },
  'meio a meio': {
    main: '#d1001f', swatch: 'linear-gradient(90deg, #d1001f 0 50%, #111 50%)',
    draw: () => area('#111') + '<rect x="0" y="80" width="80" height="100" fill="#d1001f"/>',
  },
  'branca faixa verde': {
    main: '#0b6b3a', swatch: 'linear-gradient(#f8f9fa 0 38%, #0b6b3a 38% 62%, #f8f9fa 62%)',
    draw: (a, t) => area('#f8f9fa') + `<rect x="0" y="${t + 14}" width="160" height="14" fill="#0b6b3a"/>`,
  },
  'branca clássica': {
    main: '#212529', swatch: 'linear-gradient(#111 0 12%, #f8f9fa 12%)',
    draw: (a, t) => area('#f8f9fa') + `<path d="M66 ${t} L80 ${t + 14} L94 ${t}" fill="none" stroke="#111" stroke-width="5"/>
      <path d="M0 ${t + 2} H160" stroke="#111" stroke-width="4"/>`,
  },
  'faixa diagonal vermelha': {
    main: '#d1001f', swatch: 'linear-gradient(135deg, #f8f9fa 0 40%, #d1001f 40% 60%, #f8f9fa 60%)',
    draw: (a, t) => area('#f8f9fa') + `<path d="M30 ${t - 4} L56 ${t - 4} L140 ${t + 52} L140 180 L110 180 Z" fill="#d1001f"/>`,
  },
};

// Tipos de corpo: formato do tronco, mãos e ajuste da cabeça (escala e
// altura). Pernas e cadeira não mudam, então todos sentam igual.
const BODIES = {
  'padrão': {
    torso: 'M46 98 L114 98 L124 150 L36 150 Z', top: 98,
    hands: [[40, 132, 10], [120, 132, 10]], head: { sx: 1, sy: 1, dy: 0 },
  },
  'gordinho': {
    torso: 'M38 94 Q80 82 122 94 Q156 124 136 154 L24 154 Q4 124 38 94 Z', top: 92,
    hands: [[14, 136, 11], [146, 136, 11]], head: { sx: 1.2, sy: 1.04, dy: 3 },
  },
  'magrelo': {
    torso: 'M58 90 L102 90 L106 150 L54 150 Z', top: 90, neck: true,
    hands: [[48, 130, 8], [112, 130, 8]], head: { sx: 0.88, sy: 1.08, dy: -10 },
  },
  'baixinho': {
    torso: 'M52 116 L108 116 L116 150 L44 150 Z', top: 116,
    hands: [[42, 140, 9], [118, 140, 9]], head: { sx: 0.86, sy: 0.86, dy: 20 },
  },
  'fortão': {
    torso: 'M26 100 L134 100 L114 150 L46 150 Z', top: 100, shoulders: true,
    hands: [[16, 128, 14], [144, 128, 14]], head: { sx: 0.88, sy: 0.9, dy: 6 },
  },
};

const HAIR_COLORS = ['#2b1a12', '#5c3a24', '#c9a227', '#e8590c', '#adb5bd', '#f8f9fa', '#212529'];

const AVATAR_OPTIONS = {
  body: Object.keys(BODIES),
  skin: ['#f5d0b0', '#f2c9a0', '#e9b98f', '#c68a5e', '#8d5a3b', '#5c3a24'],
  eyes: ['normal', 'feliz', 'bravo', 'sonolento', 'surpreso', 'estrela'],
  brows: ['nada', 'finas', 'grossas', 'bravas', 'preocupadas'],
  mouth: ['normal', 'sorrisão', 'sério', 'de lado', 'dentuço', 'aparelho'],
  facial: ['nada', 'bigode', 'cavanhaque', 'barba', 'barba rala'],
  marks: ['nada', 'sardas', 'cicatriz', 'curativo', 'pintinha'],
  hairColor: HAIR_COLORS,
  top: ['nada', 'gorro', 'boné', 'capuz', 'moicano', 'pompons', 'espetado', 'black power', 'cacheado', 'tranças',
    'careca', 'bandana', 'pescador', 'viseira', 'capacete', 'coroa'],
  topColor: [...AVATAR_PALETTE, '#2b1a12', '#c9a227'],
  extra: ['nada', 'headset', 'faixa', 'pintura', 'óculos neon', 'fone', 'bochecha', 'óculos'],
  kit: Object.keys(KITS),
  shirt: AVATAR_PALETTE,
  symbol: ['nada', '10', '9', '7', '11', '1', 'bola', 'controle', 'troféu', 'estrela', 'raio', 'coração', 'caveira'],
  pants: ['#343a40', '#1864ab', '#2b2b2b', '#5c3d2e', '#7048e8', '#2f9e44'],
  chair: ['puff', 'trono', 'escritório', 'trono de rei', 'banco de reserva', 'bola', 'cadeira de estádio',
    'cadeira de praia', 'rede', 'caixote', 'pneus', 'boteco', 'sofá', 'cooler'],
  item: ['nada', 'controle', 'pipoca', 'refri', 'celular', 'bola', 'cordão'],
};

// Seções do editor de boneco.
const AVATAR_GROUPS = [
  ['Corpo e rosto', ['body', 'skin', 'eyes', 'brows', 'mouth', 'facial', 'marks', 'hairColor']],
  ['Cabelo e chapéu', ['top', 'topColor', 'extra']],
  ['Roupa', ['kit', 'shirt', 'symbol', 'pants']],
  ['Cadeira e item', ['chair', 'item']],
];

const AVATAR_LABELS = {
  body: 'Corpo', skin: 'Pele', eyes: 'Olhos', brows: 'Sobrancelha', mouth: 'Boca', facial: 'Barba / bigode',
  marks: 'Detalhe no rosto', hairColor: 'Cor da barba e sobrancelha', top: 'Cabelo / chapéu',
  topColor: 'Cor do cabelo/chapéu e das mãos', extra: 'Acessório', kit: 'Camisa', shirt: 'Cor da camisa lisa',
  symbol: 'Número / estampa', pants: 'Calça', chair: 'Cadeira', item: 'Item',
};

function defaultAvatar() {
  return {
    body: 'padrão', skin: '#f2c9a0', eyes: 'normal', brows: 'nada', mouth: 'normal', facial: 'nada',
    marks: 'nada', hairColor: '#2b1a12', top: 'gorro', topColor: '#ff2bd6', extra: 'nada', kit: 'lisa',
    shirt: '#19f0ff', symbol: 'estrela', pants: '#343a40', chair: 'puff', item: 'nada',
  };
}

function kitMain(a) {
  return KITS[a.kit]?.main ?? a.shirt;
}

function randomAvatar() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return Object.fromEntries(Object.entries(AVATAR_OPTIONS).map(([k, list]) => [k, pick(list)]));
}

function sanitizeAvatar(raw) {
  const base = defaultAvatar();
  if (!raw || typeof raw !== 'object') return base;
  for (const [key, list] of Object.entries(AVATAR_OPTIONS)) {
    if (list.includes(raw[key])) base[key] = raw[key];
  }
  return base;
}

// ---------- Peças ----------

function avatarTop(a) {
  const c = a.topColor;
  const trim = a.shirt;
  switch (a.top) {
    case 'gorro':
      return `<path d="M37 56 Q80 -2 123 56 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>
        <rect x="34" y="48" width="92" height="14" rx="5" fill="${trim}" stroke="${INK}" stroke-width="3"/>
        <circle cx="80" cy="24" r="9" fill="${trim}" stroke="${INK}" stroke-width="2.5"/>`;
    case 'boné':
      return `<path d="M38 54 Q80 6 122 54 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>
        <path d="M110 50 Q140 48 146 58 L114 58 Z" fill="${trim}" stroke="${INK}" stroke-width="3"/>
        <circle cx="80" cy="24" r="4" fill="${trim}"/>`;
    case 'capuz':
      return `<path d="M30 92 Q22 22 80 20 Q138 22 130 92 L120 92 Q124 40 80 38 Q36 40 40 92 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>`;
    case 'moicano':
      return `<path d="M66 32 L70 6 L78 28 L84 2 L90 28 L98 8 L96 34 Z" fill="${c}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
    case 'pompons':
      return `<circle cx="44" cy="40" r="17" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <circle cx="116" cy="40" r="17" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M42 52 Q80 12 118 52 Q80 38 42 52Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>`;
    case 'espetado':
      return `<path d="M40 50 L36 26 L54 36 L56 12 L70 30 L80 6 L90 30 L104 12 L106 36 L124 26 L120 50 Q80 34 40 50 Z" fill="${c}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
    case 'black power':
      return `<path d="M40 50 Q80 22 120 50 Q80 38 40 50 Z" fill="${c}"/>`;
    case 'cacheado':
      return `<path d="M40 54 Q80 20 120 54 Q80 42 40 54 Z" fill="${c}"/>
        ${[[42, 52], [50, 38], [62, 29], [80, 25], [98, 29], [110, 38], [118, 52]].map(([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="11" fill="${c}" stroke="${INK}" stroke-width="2"/>`).join('')}`;
    case 'tranças':
      return `<path d="M38 56 Q80 8 122 56 Q80 36 38 56 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M80 18 V40" stroke="${INK}" stroke-width="1.5" opacity=".5"/>`;
    case 'careca':
      return `<ellipse cx="62" cy="38" rx="10" ry="5" fill="#fff" opacity=".55" transform="rotate(-25 62 38)"/>
        <ellipse cx="74" cy="32" rx="3" ry="2" fill="#fff" opacity=".55"/>`;
    case 'bandana':
      return `<path d="M36 54 Q80 6 124 54 Q80 40 36 54 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        ${[[60, 32], [80, 24], [100, 32], [70, 44], [90, 44]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#fff" opacity=".85"/>`).join('')}
        <path d="M120 46 L138 38 L134 52 Z M120 50 L136 62 L124 64 Z" fill="${c}" stroke="${INK}" stroke-width="2"/>`;
    case 'pescador':
      return `<path d="M44 50 Q80 6 116 50 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M26 54 Q80 38 134 54 L128 66 Q80 52 32 66 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M46 44 Q80 34 114 44" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="3 3" opacity=".6"/>`;
    case 'viseira':
      return `<path d="M38 42 Q80 30 122 42 L122 50 Q80 38 38 50 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M108 44 Q140 42 146 54 L112 54 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>`;
    case 'capacete':
      return `<path d="M30 82 Q26 10 80 8 Q134 10 130 82 L118 82 Q120 32 80 30 Q40 32 42 82 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>
        <path d="M80 9 V30" stroke="#fff" stroke-width="5" opacity=".7"/>
        <rect x="46" y="20" width="68" height="13" rx="6" fill="#212529" opacity=".85" stroke="${INK}" stroke-width="2"/>`;
    case 'coroa':
      return `<path d="M48 36 L52 6 L66 22 L80 2 L94 22 L108 6 L112 36 Z" fill="#ffd43b" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="48" y="30" width="64" height="9" rx="2" fill="#f59f00" stroke="${INK}" stroke-width="2"/>
        <circle cx="64" cy="34.5" r="3" fill="#e03131"/><circle cx="80" cy="34.5" r="3" fill="#1c7ed6"/><circle cx="96" cy="34.5" r="3" fill="#2f9e44"/>`;
    default:
      return '';
  }
}

// Partes do cabelo que ficam atrás da cabeça.
function avatarTopBack(a) {
  const c = a.topColor;
  switch (a.top) {
    case 'black power':
      return `<circle cx="80" cy="50" r="58" fill="${c}" stroke="${INK}" stroke-width="3"/>`;
    case 'tranças':
      return [[38, -4], [122, 4]].map(([x, dx]) => {
        let braid = '';
        for (let i = 0; i < 5; i++) braid += `<ellipse cx="${x + dx}" cy="${80 + i * 12}" rx="7" ry="8" fill="${c}" stroke="${INK}" stroke-width="2"/>`;
        return `${braid}<circle cx="${x + dx}" cy="142" r="4" fill="${a.shirt}" stroke="${INK}" stroke-width="1.5"/>`;
      }).join('');
    default:
      return '';
  }
}

// ---------- Rosto ----------

function avatarEyes(a) {
  const whites = (rx = 12, ry = 14) => `<ellipse cx="67" cy="62" rx="${rx}" ry="${ry}" fill="#fff" stroke="${INK}" stroke-width="2"/>
    <ellipse cx="93" cy="62" rx="${rx}" ry="${ry}" fill="#fff" stroke="${INK}" stroke-width="2"/>`;
  const pupils = (y = 64, r = 2.8) => `<circle cx="71" cy="${y}" r="${r}" fill="${INK}"/><circle cx="89" cy="${y}" r="${r}" fill="${INK}"/>`;
  const star = (x, y) => `<path d="M${x} ${y - 5} l1.5 3.4 3.7 .4 -2.8 2.5 .8 3.7 -3.2 -1.9 -3.2 1.9 .8 -3.7 -2.8 -2.5 3.7 -.4z" fill="#ffd43b" stroke="${INK}" stroke-width="1"/>`;
  switch (a.eyes) {
    case 'feliz':
      return `<path d="M57 66 Q67 52 77 66 M83 66 Q93 52 103 66" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`;
    case 'bravo':
      return `${whites()}${pupils()}
        <path d="M54 46 H80 V60 Z M106 46 H80 V60 Z" fill="${a.skin}"/>
        <path d="M55 48 L80 60 M105 48 L80 60" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'sonolento':
      return `${whites()}${pupils(68)}
        <path d="M55 63 A12 14 0 0 1 79 63 Z M81 63 A12 14 0 0 1 105 63 Z" fill="${a.skin}" stroke="${INK}" stroke-width="2"/>`;
    case 'surpreso':
      return `${whites(14, 16)}<circle cx="67" cy="62" r="2.2" fill="${INK}"/><circle cx="93" cy="62" r="2.2" fill="${INK}"/>`;
    case 'estrela':
      return `${whites()}${star(70, 64)}${star(90, 64)}`;
    default:
      return `${whites()}${pupils()}`;
  }
}

function avatarBrows(a) {
  const c = a.hairColor;
  const line = (d, w) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  switch (a.brows) {
    case 'finas': return line('M58 44 Q67 40 76 44 M84 44 Q93 40 102 44', 2.5);
    case 'grossas': return line('M58 44 Q67 39 76 44 M84 44 Q93 39 102 44', 6);
    case 'bravas': return line('M57 41 L77 48 M103 41 L83 48', 4.5);
    case 'preocupadas': return line('M57 48 L77 41 M103 48 L83 41', 4);
    default: return '';
  }
}

function avatarFacial(a) {
  const c = a.hairColor;
  const stache = `<path d="M66 82 Q72 76 80 80 Q88 76 94 82 Q88 86 80 83 Q72 86 66 82 Z" fill="${c}" stroke="${INK}" stroke-width="1.5"/>`;
  switch (a.facial) {
    case 'bigode': return stache;
    case 'cavanhaque': return `<path d="M72 94 Q80 110 88 94 Q80 99 72 94 Z" fill="${c}" stroke="${INK}" stroke-width="1.5"/>`;
    case 'barba':
      return `<path d="M40 72 Q42 104 80 106 Q118 104 120 72 Q112 92 96 92 Q80 97 64 92 Q48 92 40 72 Z" fill="${c}" stroke="${INK}" stroke-width="2"/>${stache}`;
    case 'barba rala': {
      let dots = '';
      for (let i = 0; i <= 22; i++) {
        const ang = (20 + (140 * i) / 22) * Math.PI / 180;
        for (const k of [0, 1]) {
          dots += `<circle cx="${(80 + (38 - k * 5) * Math.cos(ang)).toFixed(1)}" cy="${(70 + (31 - k * 5) * Math.sin(ang)).toFixed(1)}" r="1.2" fill="${c}" opacity=".85"/>`;
        }
      }
      return dots;
    }
    default: return '';
  }
}

function avatarMarks(a) {
  switch (a.marks) {
    case 'sardas':
      return [[50, 76], [55, 80], [58, 74], [102, 74], [105, 80], [110, 76]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#a0522d" opacity=".75"/>`).join('');
    case 'cicatriz':
      return `<path d="M100 70 L112 88" stroke="#a0522d" stroke-width="2" stroke-linecap="round"/>
        <path d="M101 76 l7 -3 M105 82 l7 -3" stroke="#a0522d" stroke-width="1.5"/>`;
    case 'curativo':
      return `<g transform="rotate(-25 107 77)"><rect x="97" y="73" width="20" height="8" rx="3" fill="#f4c58a" stroke="${INK}" stroke-width="1.2"/>
        <rect x="104" y="73" width="6" height="8" fill="#e9b07a"/></g>`;
    case 'pintinha':
      return `<circle cx="93" cy="90" r="1.8" fill="#3b2314"/>`;
    default: return '';
  }
}

function avatarMouthClosed(a) {
  const smile = `<path d="M72 86 Q80 89 88 86" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
  switch (a.mouth) {
    case 'sorrisão':
      return `<path d="M66 82 Q80 100 94 82 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M68 83 Q80 87 92 83 L91 86 Q80 89 69 86 Z" fill="#fff"/>`;
    case 'sério': return `<path d="M72 87 H88" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'de lado': return `<path d="M70 88 Q82 88 90 82" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'dentuço':
      return `${smile}<rect x="75" y="87" width="5" height="6" rx="1" fill="#fff" stroke="${INK}" stroke-width="1.3"/>
        <rect x="80" y="87" width="5" height="6" rx="1" fill="#fff" stroke="${INK}" stroke-width="1.3"/>`;
    case 'aparelho':
      return `<path d="M68 82 Q80 96 92 82 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M69 83 Q80 87 91 83 L90 86 Q80 89 70 86 Z" fill="#fff"/>
        <path d="M70 85 Q80 88 90 85" fill="none" stroke="#adb5bd" stroke-width="1.6"/>`;
    default: return smile;
  }
}

function avatarExtra(a) {
  switch (a.extra) {
    case 'óculos neon':
      return `<rect x="38" y="40" width="84" height="7" fill="${INK}"/>
        <rect x="50" y="32" width="26" height="18" rx="7" fill="#19f0ff" stroke="${INK}" stroke-width="3"/>
        <rect x="84" y="32" width="26" height="18" rx="7" fill="#19f0ff" stroke="${INK}" stroke-width="3"/>
        <rect x="55" y="36" width="8" height="4" rx="2" fill="#fff" opacity=".8"/>`;
    case 'fone':
      return `<path d="M36 64 Q36 14 80 14 Q124 14 124 64" fill="none" stroke="${INK}" stroke-width="6"/>
        <rect x="28" y="56" width="16" height="26" rx="6" fill="${a.topColor}" stroke="${INK}" stroke-width="3"/>
        <rect x="116" y="56" width="16" height="26" rx="6" fill="${a.topColor}" stroke="${INK}" stroke-width="3"/>`;
    case 'headset':
      return `<path d="M34 66 Q34 12 80 12 Q126 12 126 66" fill="none" stroke="${INK}" stroke-width="7"/>
        <path d="M34 66 Q34 12 80 12 Q126 12 126 66" fill="none" stroke="${a.topColor}" stroke-width="3"/>
        <rect x="24" y="52" width="20" height="32" rx="8" fill="#212529" stroke="${INK}" stroke-width="3"/>
        <rect x="116" y="52" width="20" height="32" rx="8" fill="#212529" stroke="${INK}" stroke-width="3"/>
        <circle cx="34" cy="68" r="5" fill="${a.topColor}"/><circle cx="126" cy="68" r="5" fill="${a.topColor}"/>
        <path d="M36 80 Q42 98 62 94" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="64" cy="94" r="4.5" fill="${a.topColor}" stroke="${INK}" stroke-width="2"/>`;
    case 'faixa':
      return `<rect x="37" y="36" width="86" height="11" rx="3" fill="${a.topColor}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M120 40 L134 34 L132 48 Z" fill="${a.topColor}" stroke="${INK}" stroke-width="2"/>`;
    case 'pintura': {
      const c = kitMain(a);
      return `<path d="M46 80 L60 76 M46 87 L60 83" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
        <path d="M100 76 L114 80 M100 83 L114 87" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
        <path d="M46 83.5 L60 79.5 M100 79.5 L114 83.5" stroke="#f8f9fa" stroke-width="2.5" stroke-linecap="round"/>`;
    }
    case 'bochecha':
      return `<ellipse cx="54" cy="80" rx="6" ry="3.5" fill="#ff6b8b" opacity=".6"/>
        <ellipse cx="106" cy="80" rx="6" ry="3.5" fill="#ff6b8b" opacity=".6"/>`;
    case 'óculos':
      return `<circle cx="67" cy="62" r="15" fill="none" stroke="${INK}" stroke-width="3.5"/>
        <circle cx="93" cy="62" r="15" fill="none" stroke="${INK}" stroke-width="3.5"/>
        <path d="M82 62 H78" stroke="${INK}" stroke-width="3"/>`;
    default:
      return '';
  }
}

function avatarSymbol(a) {
  const fill = a.kit === 'lisa' && a.shirt === '#f8f9fa' ? INK : '#fff';
  if (/^\d+$/.test(a.symbol)) {
    return `<text x="80" y="138" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="25"
      fill="${fill}" stroke="${INK}" stroke-width="1.6" paint-order="stroke">${a.symbol}</text>`;
  }
  switch (a.symbol) {
    case 'bola':
      return `<circle cx="80" cy="124" r="12" fill="#f8f9fa" stroke="${INK}" stroke-width="2"/>
        <path d="M80 118 l5 3.6 -2 6 h-6 l-2 -6 z" fill="${INK}"/>
        <path d="M80 112 V118 M85 121.6 L91.5 119 M83 127.6 L87 133.5 M77 127.6 L73 133.5 M75 121.6 L68.5 119" stroke="${INK}" stroke-width="1.5"/>`;
    case 'controle':
      return `<path d="M68 116 H92 Q100 116 101 126 L102 133 Q102 137 98 137 Q95 137 93 133 L91 129 H69 L67 133 Q65 137 62 137 Q58 137 58 133 L59 126 Q60 116 68 116 Z"
        fill="${fill}" stroke="${INK}" stroke-width="1.6"/>
        <path d="M68 121 V128 M64.5 124.5 H71.5" stroke="${INK}" stroke-width="2"/>
        <circle cx="90" cy="122" r="2" fill="${INK}"/><circle cx="94" cy="126" r="2" fill="${INK}"/>`;
    case 'troféu':
      return `<path d="M70 112 H90 V120 Q90 130 80 131 Q70 130 70 120 Z" fill="#ffd43b" stroke="${INK}" stroke-width="1.6"/>
        <path d="M70 115 H64 Q64 124 71 124 M90 115 H96 Q96 124 89 124" fill="none" stroke="${INK}" stroke-width="1.6"/>
        <rect x="77" y="131" width="6" height="5" fill="#ffd43b" stroke="${INK}" stroke-width="1.2"/>
        <rect x="72" y="136" width="16" height="4" fill="#ffd43b" stroke="${INK}" stroke-width="1.2"/>`;
    case 'estrela':
      return `<path d="M80 112 l4 9 10 1 -8 6 3 10 -9 -6 -9 6 3 -10 -8 -6 10 -1z" fill="${fill}"/>`;
    case 'raio':
      return `<path d="M84 108 L72 126 H80 L76 142 L90 120 H82 Z" fill="${fill}"/>`;
    case 'coração':
      return `<path d="M80 138 C64 126 66 112 74 112 C78 112 80 116 80 116 C80 116 82 112 86 112 C94 112 96 126 80 138 Z" fill="${fill}"/>`;
    case 'caveira':
      return `<path d="M70 120 Q70 108 80 108 Q90 108 90 120 L87 124 V130 H73 V124 Z" fill="${fill}"/>
        <circle cx="76" cy="118" r="2.6" fill="${a.shirt}"/><circle cx="84" cy="118" r="2.6" fill="${a.shirt}"/>`;
    default:
      return '';
  }
}

function bodyOf(a) {
  return BODIES[a.body] ?? BODIES['padrão'];
}

function avatarHead(a) {
  const { sx, sy, dy } = bodyOf(a).head;
  // Escala em volta do centro da cabeça (80,66): chapéu e rosto acompanham.
  const transform = `translate(80 ${66 + dy}) scale(${sx} ${sy}) translate(-80 -66)`;
  // .av-head: o CSS solta e balança a cabeça quando a pessoa fala.
  // Camadas: cabelo de trás, cabeça, detalhes, barba, sobrancelha, chapéu
  // (cobre a testa), olhos, acessório e as duas bocas.
  return `<g class="av-head"><g transform="${transform}">
    ${avatarTopBack(a)}
    <ellipse cx="80" cy="66" rx="43" ry="37" fill="${a.skin}" stroke="${INK}" stroke-width="3"/>
    ${avatarMarks(a)}
    ${avatarFacial(a)}
    ${avatarBrows(a)}
    ${avatarTop(a)}
    ${avatarEyes(a)}
    ${avatarExtra(a)}
    <g class="m-closed">${avatarMouthClosed(a)}</g>
    <g class="m-open">
      <path d="M62 80 Q80 114 98 80 Q80 86 62 80 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M70 96 Q80 108 90 96 Q80 90 70 96Z" fill="#ff5c7a"/>
      <path d="M66 82 Q80 86 94 82 L93 86 Q80 89 67 86 Z" fill="#fff"/>
      ${a.mouth === 'aparelho' ? '<path d="M67 84.5 Q80 88.5 93 84.5" fill="none" stroke="#adb5bd" stroke-width="1.6"/>' : ''}
    </g>
  </g></g>`;
}

// id único por SVG: o Chrome resolve url(#id) pelo primeiro do documento, e
// se esse estiver escondido (lobby durante a sala) o recorte some.
let avatarUid = 0;

function avatarBody(a) {
  const clipId = `av-torso-${++avatarUid}`;
  const hands = a.topColor;
  const kit = KITS[a.kit] ?? KITS.lisa;
  const body = bodyOf(a);
  const t = body.top;
  const shoulders = body.shoulders
    ? `<circle cx="30" cy="108" r="17" fill="${kitMain(a)}" stroke="${INK}" stroke-width="3"/>
       <circle cx="130" cy="108" r="17" fill="${kitMain(a)}" stroke="${INK}" stroke-width="3"/>`
    : '';
  const neck = body.neck ? `<rect x="72" y="${t - 14}" width="16" height="18" fill="${a.skin}" stroke="${INK}" stroke-width="2.5"/>` : '';
  return `
    ${neck}${shoulders}
    <defs><clipPath id="${clipId}"><path d="${body.torso}"/></clipPath></defs>
    <g clip-path="url(#${clipId})">${kit.draw(a, t)}</g>
    <path d="${body.torso}" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    ${a.kit === 'lisa'
      ? `<path d="M80 ${t + 2} V150" stroke="${INK}" stroke-width="2" opacity=".35"/>`
      : `<path d="M66 ${t} Q80 ${t + 8} 94 ${t}" fill="none" stroke="${INK}" stroke-width="2.5"/>`}
    ${avatarSymbol(a)}
    ${avatarNeckItem(a)}
    ${body.hands.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hands}" stroke="${INK}" stroke-width="2.5"/>`).join('')}
    <rect x="50" y="146" width="26" height="22" rx="4" fill="${a.pants}" stroke="${INK}" stroke-width="3"/>
    <rect x="84" y="146" width="26" height="22" rx="4" fill="${a.pants}" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="60" cy="172" rx="16" ry="7" fill="${INK}" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="100" cy="172" rx="16" ry="7" fill="${INK}" stroke="${INK}" stroke-width="2.5"/>`;
}

// Itens: o cordão vai no corpo (embaixo da cabeça); o resto vai no colo ou
// na mão direita, por cima de tudo.
function avatarNeckItem(a) {
  if (a.item !== 'cordão') return '';
  const t = bodyOf(a).top;
  return `<path d="M64 ${t} Q80 ${t + 24} 96 ${t}" fill="none" stroke="#fcc419" stroke-width="3" stroke-dasharray="3 1.5"/>
    <circle cx="80" cy="${t + 18}" r="5.5" fill="#fcc419" stroke="${INK}" stroke-width="1.5"/>`;
}

function avatarHandItem(a) {
  const [hx, hy, hr] = bodyOf(a).hands[1];
  const hand = `<circle cx="${hx}" cy="${hy}" r="${hr}" fill="${a.topColor}" stroke="${INK}" stroke-width="2.5"/>`;
  switch (a.item) {
    case 'controle':
      return `<g transform="translate(80 146)">
        <path d="M-22 -8 H22 Q30 -8 31 2 L32 10 Q32 15 27 15 Q23 15 21 11 L19 6 H-19 L-21 11 Q-23 15 -27 15 Q-32 15 -32 10 L-31 2 Q-30 -8 -22 -8 Z" fill="#212529" stroke="${INK}" stroke-width="2.5"/>
        <path d="M-20 -2 V8 M-25 3 H-15" stroke="#adb5bd" stroke-width="2.5"/>
        <circle cx="16" cy="0" r="2.6" fill="#ff3b5c"/><circle cx="22" cy="5" r="2.6" fill="#19f0ff"/></g>`;
    case 'bola':
      return `<g transform="translate(80 150)">
        <circle r="14" fill="#f8f9fa" stroke="${INK}" stroke-width="2.5"/>
        <path d="M0 -6 l5.7 4.1 -2.2 6.7 h-7 l-2.2 -6.7 z" fill="${INK}"/>
        <path d="M0 -14 V-6 M5.7 -1.9 L13 -4.5 M3.5 4.8 L8 11 M-3.5 4.8 L-8 11 M-5.7 -1.9 L-13 -4.5" stroke="${INK}" stroke-width="1.5"/></g>`;
    case 'pipoca':
      return `<g transform="translate(${hx} ${hy - 14})">
        <path d="M-11 -4 L11 -4 L8 20 L-8 20 Z" fill="#f8f9fa" stroke="${INK}" stroke-width="2"/>
        <path d="M-6 -4 L-4.5 20 M0 -4 V20 M6 -4 L4.5 20" stroke="#e03131" stroke-width="3"/>
        <circle cx="-7" cy="-6" r="5" fill="#fff3bf" stroke="${INK}" stroke-width="1.5"/>
        <circle cx="7" cy="-6" r="5" fill="#fff3bf" stroke="${INK}" stroke-width="1.5"/>
        <circle cx="0" cy="-9" r="5.5" fill="#fff3bf" stroke="${INK}" stroke-width="1.5"/></g>${hand}`;
    case 'refri':
      return `<g transform="translate(${hx} ${hy - 12})">
        <rect x="-7" y="-12" width="14" height="24" rx="3" fill="#e03131" stroke="${INK}" stroke-width="2"/>
        <path d="M-7 0 Q0 -5 7 2" stroke="#fff" stroke-width="2.5" fill="none"/>
        <rect x="-5" y="-14" width="10" height="3" rx="1" fill="#adb5bd" stroke="${INK}" stroke-width="1"/></g>${hand}`;
    case 'celular':
      return `<g transform="translate(${hx - 4} ${hy - 13}) rotate(-12)">
        <rect x="-6" y="-11" width="12" height="22" rx="3" fill="#212529" stroke="${INK}" stroke-width="2"/>
        <rect x="-4" y="-8" width="8" height="15" rx="1.5" fill="#19f0ff" opacity=".85"/></g>${hand}`;
    default:
      return '';
  }
}

// back: atrás do boneco; front: na frente (assento, base). Cadeira que é
// função recebe o avatar e usa a cor da camisa.
const CHAIRS = {
  'escritório': {
    back: `<rect x="40" y="58" width="80" height="96" rx="16" fill="#495057" stroke="${INK}" stroke-width="3"/>
      <path d="M52 72 H108 M52 86 H108 M52 100 H108 M52 114 H108 M52 128 H108" stroke="#343a40" stroke-width="2"/>`,
    front: `<rect x="26" y="148" width="108" height="16" rx="7" fill="#343a40" stroke="${INK}" stroke-width="3"/>
      <rect x="74" y="164" width="12" height="20" fill="#868e96" stroke="${INK}" stroke-width="2"/>
      <path d="M34 196 L80 186 L126 196 M80 186 V200 M56 200 L80 186 L104 200" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
      ${[[34, 198], [56, 202], [80, 202], [104, 202], [126, 198]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#212529" stroke="${INK}" stroke-width="1.5"/>`).join('')}`,
  },
  'trono de rei': {
    back: `<path d="M26 152 L22 34 L40 44 L52 12 L66 36 L80 0 L94 36 L108 12 L120 44 L138 34 L134 152 Z" fill="#a51111" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M34 146 L31 50 L44 56 L54 30 L66 50 L80 20 L94 50 L106 30 L116 56 L129 50 L126 146" fill="none" stroke="#ffd43b" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="80" cy="10" r="4" fill="#4dabf7" stroke="${INK}" stroke-width="1.5"/>`,
    front: `<rect x="2" y="116" width="28" height="56" rx="9" fill="#ffd43b" stroke="${INK}" stroke-width="3"/>
      <rect x="130" y="116" width="28" height="56" rx="9" fill="#ffd43b" stroke="${INK}" stroke-width="3"/>
      <rect x="18" y="150" width="124" height="24" rx="7" fill="#c92a2a" stroke="${INK}" stroke-width="3"/>
      <path d="M26 174 L22 204 M134 174 L138 204" stroke="#f59f00" stroke-width="7" stroke-linecap="round"/>`,
  },
  'cadeira de praia': {
    back: `<path d="M34 154 L46 66 L118 66 L128 154 Z" fill="#f8f9fa" stroke="${INK}" stroke-width="3"/>
      <path d="M57 70 L53 152 M82 68 L82 152 M107 70 L111 152" stroke="#1c7ed6" stroke-width="11"/>
      <path d="M34 154 L46 66 L118 66 L128 154 Z" fill="none" stroke="#b07a3c" stroke-width="4"/>`,
    front: `<path d="M24 158 H136" stroke="#b07a3c" stroke-width="8" stroke-linecap="round"/>
      <path d="M34 158 L122 204 M126 158 L38 204" stroke="#b07a3c" stroke-width="6" stroke-linecap="round"/>
      <path d="M24 158 H136" stroke="${INK}" stroke-width="2" opacity=".35"/>`,
  },
  'rede': {
    back: `<path d="M4 30 L26 146 M156 30 L134 146" stroke="#c9a227" stroke-width="3"/>`,
    front: `<path d="M0 136 Q80 214 160 136 L160 152 Q80 234 0 152 Z" fill="#e8590c" stroke="${INK}" stroke-width="3"/>
      <path d="M0 142 Q80 222 160 142 M0 147 Q80 228 160 147" fill="none" stroke="#ffd43b" stroke-width="3"/>
      ${[20, 40, 60, 80, 100, 120, 140].map((x) => {
        const y = 152 + 41 * (1 - ((x - 80) / 80) ** 2);
        return `<path d="M${x} ${y.toFixed(0)} v8" stroke="#ffd43b" stroke-width="2"/>`;
      }).join('')}`,
  },
  'banco de reserva': (a) => ({
    back: `<rect x="4" y="80" width="152" height="72" rx="12" fill="${kitMain(a)}" stroke="${INK}" stroke-width="3"/>
      <rect x="14" y="88" width="132" height="10" rx="5" fill="#fff" opacity=".18"/>`,
    front: `<rect x="2" y="148" width="156" height="20" rx="7" fill="#2b2b2b" stroke="${INK}" stroke-width="3"/>
      <path d="M16 168 V204 M144 168 V204 M80 168 V204" stroke="#868e96" stroke-width="6" stroke-linecap="round"/>
      <path d="M16 168 V204 M144 168 V204 M80 168 V204" stroke="${INK}" stroke-width="2" opacity=".4"/>`,
  }),
  'bola': () => ({
    back: '',
    front: `<circle cx="80" cy="178" r="36" fill="#f8f9fa" stroke="${INK}" stroke-width="3"/>
      <path d="M80 166 l11 8 -4 13 h-14 l-4 -13 z" fill="${INK}"/>
      <path d="M80 142 V166 M91 174 L114 166 M87 187 L100 206 M73 187 L60 206 M69 174 L46 166" stroke="${INK}" stroke-width="2.5"/>
      <path d="M48 150 l10 4 -2 10 M112 150 l-10 4 2 10" fill="none" stroke="${INK}" stroke-width="2.5"/>`,
  }),
  'cadeira de estádio': (a) => ({
    back: `<rect x="36" y="64" width="88" height="90" rx="16" fill="${kitMain(a)}" stroke="${INK}" stroke-width="3"/>
      <rect x="66" y="72" width="28" height="14" rx="3" fill="#f8f9fa" stroke="${INK}" stroke-width="2"/>
      <text x="80" y="83" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="11" fill="${INK}">12</text>`,
    front: `<rect x="30" y="148" width="100" height="18" rx="7" fill="${kitMain(a)}" stroke="${INK}" stroke-width="3"/>
      <rect x="0" y="170" width="160" height="36" fill="#3a3f47" stroke="${INK}" stroke-width="3"/>
      <path d="M0 182 H160" stroke="#fff" stroke-width="2" opacity=".15"/>`,
  }),
  'trono': {
    back: `<path d="M34 120 L30 6 Q80 -12 130 6 L126 120 Z" fill="#1d1b24" stroke="${INK}" stroke-width="3"/>
      <path d="M50 10 L54 116 M110 10 L106 116" stroke="#ff2bd6" stroke-width="7"/>
      <path d="M18 26 L34 18 L36 70 L20 74 Z M142 26 L126 18 L124 70 L140 74 Z" fill="#2a2733" stroke="${INK}" stroke-width="3"/>`,
    front: `<rect x="24" y="150" width="112" height="18" rx="8" fill="#26232e" stroke="${INK}" stroke-width="3"/>
      <rect x="74" y="168" width="12" height="20" fill="#3b3746" stroke="${INK}" stroke-width="2.5"/>
      <path d="M40 196 L80 186 L120 196" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="40" cy="200" r="6" fill="#ff2bd6" stroke="${INK}" stroke-width="2"/>
      <circle cx="120" cy="200" r="6" fill="#ff2bd6" stroke="${INK}" stroke-width="2"/>
      <circle cx="80" cy="198" r="6" fill="#ff2bd6" stroke="${INK}" stroke-width="2"/>`,
  },
  'puff': {
    back: '',
    front: `<ellipse cx="80" cy="182" rx="70" ry="22" fill="#2b1f4a" stroke="${INK}" stroke-width="3"/>
      <path d="M10 170 Q10 148 80 148 Q150 148 150 170 L150 182 Q150 204 80 204 Q10 204 10 182 Z" fill="#5b3fd1" stroke="${INK}" stroke-width="3"/>
      <path d="M14 178 Q80 196 146 178" fill="none" stroke="#19f0ff" stroke-width="4"/>
      <circle cx="40" cy="163" r="3" fill="#19f0ff"/><circle cx="80" cy="158" r="3" fill="#19f0ff"/><circle cx="120" cy="163" r="3" fill="#19f0ff"/>`,
  },
  'caixote': {
    back: '',
    front: `<rect x="22" y="152" width="116" height="52" fill="#b07a3c" stroke="${INK}" stroke-width="3"/>
      <path d="M22 169 H138 M22 186 H138" stroke="${INK}" stroke-width="2" opacity=".55"/>
      <path d="M22 152 L138 204 M138 152 L22 204" stroke="#8a5a26" stroke-width="5" opacity=".55"/>
      <text x="80" y="185" text-anchor="middle" font-family="Permanent Marker" font-size="16" fill="#1b1b1b" opacity=".8" transform="rotate(-6 80 185)">FRÁGIL</text>
      <circle cx="30" cy="160" r="2" fill="${INK}"/><circle cx="130" cy="160" r="2" fill="${INK}"/>
      <circle cx="30" cy="196" r="2" fill="${INK}"/><circle cx="130" cy="196" r="2" fill="${INK}"/>`,
  },
  'pneus': {
    back: '',
    front: `<ellipse cx="80" cy="190" rx="64" ry="16" fill="#222" stroke="${INK}" stroke-width="3"/>
      <rect x="16" y="168" width="128" height="22" fill="#2b2b2b" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="80" cy="168" rx="64" ry="16" fill="#333" stroke="${INK}" stroke-width="3"/>
      <rect x="20" y="152" width="120" height="16" fill="#2b2b2b" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="80" cy="152" rx="60" ry="14" fill="#3a3a3a" stroke="${INK}" stroke-width="3"/>
      <path d="M30 176 l8 8 M46 178 l8 8 M62 179 l8 8 M78 179 l8 8 M94 179 l8 8 M110 178 l8 8" stroke="#555" stroke-width="3"/>
      <text x="80" y="187" text-anchor="middle" font-family="Permanent Marker" font-size="13" fill="#b6ff3b" opacity=".9">ZN</text>`,
  },
  'boteco': {
    back: `<path d="M38 124 L34 40 Q80 22 126 40 L122 124 Z" fill="#e2333f" stroke="${INK}" stroke-width="3"/>
      <path d="M52 52 H108 M52 66 H108 M52 80 H108" stroke="#b81f2b" stroke-width="5" stroke-linecap="round"/>`,
    front: `<path d="M26 150 L134 150 L128 166 L32 166 Z" fill="#e2333f" stroke="${INK}" stroke-width="3"/>
      <path d="M36 166 L26 206 M124 166 L134 206 M58 166 L54 200 M102 166 L106 200" stroke="#c42531" stroke-width="7" stroke-linecap="round"/>
      <path d="M36 166 L26 206 M124 166 L134 206" stroke="${INK}" stroke-width="2" opacity=".5"/>`,
  },
  'sofá': {
    back: `<rect x="8" y="78" width="144" height="74" rx="16" fill="#2f9e44" stroke="${INK}" stroke-width="3"/>
      <path d="M30 92 Q36 100 30 108 M120 96 Q128 104 122 112" stroke="#1f6e30" stroke-width="3" fill="none"/>`,
    front: `<rect x="0" y="132" width="26" height="54" rx="10" fill="#37b24d" stroke="${INK}" stroke-width="3"/>
      <rect x="134" y="132" width="26" height="54" rx="10" fill="#37b24d" stroke="${INK}" stroke-width="3"/>
      <rect x="20" y="152" width="120" height="34" rx="8" fill="#37b24d" stroke="${INK}" stroke-width="3"/>
      <rect x="96" y="160" width="22" height="12" rx="2" fill="#ffd43b" stroke="${INK}" stroke-width="2" transform="rotate(-12 107 166)"/>
      <path d="M14 186 v14 M146 186 v14" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
  },
  'cooler': {
    back: '',
    front: `<rect x="20" y="150" width="120" height="54" rx="8" fill="#1c7ed6" stroke="${INK}" stroke-width="3"/>
      <rect x="16" y="144" width="128" height="14" rx="5" fill="#f8f9fa" stroke="${INK}" stroke-width="3"/>
      <rect x="60" y="134" width="40" height="10" rx="4" fill="#f8f9fa" stroke="${INK}" stroke-width="2.5"/>
      <text x="80" y="188" text-anchor="middle" font-family="Permanent Marker" font-size="15" fill="#fff" opacity=".9">GELADA</text>`,
  },
};

// Boneco completo sentado; as duas bocas vão no SVG e o CSS escolhe qual
// aparece (classe .speaking no pai), sem redesenhar a cada frame.
function avatarSeatSvg(raw) {
  const a = sanitizeAvatar(raw);
  const def = CHAIRS[a.chair] ?? CHAIRS.puff;
  const chair = typeof def === 'function' ? def(a) : def;
  return `<svg class="avatar-seat" viewBox="0 -8 160 216" aria-hidden="true">
    <ellipse cx="80" cy="206" rx="70" ry="7" fill="#000" opacity=".45"/>
    ${chair.back}
    ${avatarBody(a)}
    ${avatarHead(a)}
    ${chair.front}
    ${avatarHandItem(a)}
  </svg>`;
}

// Só o rosto, pra miniatura no chat.
function avatarFaceSvg(raw) {
  const a = sanitizeAvatar(raw);
  return `<svg class="avatar-face" viewBox="30 10 100 100" aria-hidden="true">
    ${avatarHead(a)}
  </svg>`;
}
