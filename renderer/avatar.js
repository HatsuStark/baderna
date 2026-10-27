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

const AVATAR_OPTIONS = {
  body: Object.keys(BODIES),
  skin: ['#f5d0b0', '#f2c9a0', '#e9b98f', '#c68a5e', '#8d5a3b', '#5c3a24'],
  top: ['nada', 'gorro', 'boné', 'capuz', 'moicano', 'pompons', 'espetado'],
  topColor: [...AVATAR_PALETTE, '#2b1a12', '#c9a227'],
  kit: Object.keys(KITS),
  shirt: AVATAR_PALETTE,
  pants: ['#343a40', '#1864ab', '#2b2b2b', '#5c3d2e', '#7048e8', '#2f9e44'],
  extra: ['nada', 'headset', 'faixa', 'pintura', 'óculos neon', 'fone', 'bochecha', 'óculos'],
  symbol: ['nada', '10', '9', '7', '11', '1', 'bola', 'controle', 'troféu', 'estrela', 'raio', 'coração', 'caveira'],
  chair: ['puff', 'trono', 'banco de reserva', 'bola', 'cadeira de estádio', 'caixote', 'pneus', 'boteco', 'sofá', 'cooler'],
};

const AVATAR_LABELS = {
  body: 'Corpo', skin: 'Pele', top: 'Cabelo / chapéu', topColor: 'Cor do topo e das mãos', kit: 'Camisa',
  shirt: 'Cor da camisa lisa', pants: 'Calça', extra: 'Acessório', symbol: 'Número / estampa', chair: 'Cadeira',
};

function defaultAvatar() {
  return {
    body: 'padrão', skin: '#f2c9a0', top: 'gorro', topColor: '#ff2bd6', kit: 'lisa', shirt: '#19f0ff',
    pants: '#343a40', extra: 'nada', symbol: 'estrela', chair: 'puff',
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
    default:
      return '';
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
  return `<g class="av-head"><g transform="${transform}">
    <ellipse cx="80" cy="66" rx="43" ry="37" fill="${a.skin}" stroke="${INK}" stroke-width="3"/>
    ${avatarTop(a)}
    <ellipse cx="67" cy="62" rx="12" ry="14" fill="#fff" stroke="${INK}" stroke-width="2"/>
    <ellipse cx="93" cy="62" rx="12" ry="14" fill="#fff" stroke="${INK}" stroke-width="2"/>
    <circle cx="71" cy="64" r="2.8" fill="${INK}"/><circle cx="89" cy="64" r="2.8" fill="${INK}"/>
    ${avatarExtra(a)}
    <g class="m-closed"><path d="M72 86 Q80 89 88 86" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/></g>
    <g class="m-open">
      <path d="M62 80 Q80 114 98 80 Q80 86 62 80 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M70 96 Q80 108 90 96 Q80 90 70 96Z" fill="#ff5c7a"/>
      <path d="M66 82 Q80 86 94 82 L93 86 Q80 89 67 86 Z" fill="#fff"/>
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
    ${body.hands.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hands}" stroke="${INK}" stroke-width="2.5"/>`).join('')}
    <rect x="50" y="146" width="26" height="22" rx="4" fill="${a.pants}" stroke="${INK}" stroke-width="3"/>
    <rect x="84" y="146" width="26" height="22" rx="4" fill="${a.pants}" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="60" cy="172" rx="16" ry="7" fill="${INK}" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="100" cy="172" rx="16" ry="7" fill="${INK}" stroke="${INK}" stroke-width="2.5"/>`;
}

// back: atrás do boneco; front: na frente (assento, base). Cadeira que é
// função recebe o avatar e usa a cor da camisa.
const CHAIRS = {
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
  </svg>`;
}

// Só o rosto, pra miniatura no chat.
function avatarFaceSvg(raw) {
  const a = sanitizeAvatar(raw);
  return `<svg class="avatar-face" viewBox="30 10 100 100" aria-hidden="true">
    ${avatarHead(a)}
  </svg>`;
}
