'use strict';

// Bonecos em estilo recorte de papel, sentados na cadeira de cada um.
// O avatar viaja entre os peers e vira SVG via string, então TODO campo é
// validado contra as listas abaixo (sanitizeAvatar) antes de desenhar.

const INK = '#17151c';

const AVATAR_PALETTE = [
  '#ff2bd6', '#19f0ff', '#b6ff3b', '#ffb627', '#ff3b5c', '#ff6b00',
  '#7048e8', '#364fc7', '#2f9e44', '#f8f9fa', '#495057', '#212529',
];

const AVATAR_OPTIONS = {
  skin: ['#f5d0b0', '#f2c9a0', '#e9b98f', '#c68a5e', '#8d5a3b', '#5c3a24'],
  top: ['nada', 'gorro', 'boné', 'capuz', 'moicano', 'pompons', 'espetado'],
  topColor: [...AVATAR_PALETTE, '#2b1a12', '#c9a227'],
  shirt: AVATAR_PALETTE,
  pants: ['#343a40', '#1864ab', '#2b2b2b', '#5c3d2e', '#7048e8', '#2f9e44'],
  extra: ['nada', 'óculos neon', 'fone', 'bochecha', 'óculos'],
  symbol: ['nada', 'estrela', 'raio', 'coração', 'caveira'],
  chair: ['puff', 'trono', 'caixote', 'pneus', 'boteco', 'sofá', 'cooler'],
};

const AVATAR_LABELS = {
  skin: 'Pele', top: 'Cabelo / chapéu', topColor: 'Cor do topo', shirt: 'Roupa',
  pants: 'Calça', extra: 'Acessório', symbol: 'Estampa', chair: 'Cadeira',
};

function defaultAvatar() {
  return {
    skin: '#f2c9a0', top: 'gorro', topColor: '#ff2bd6', shirt: '#19f0ff',
    pants: '#343a40', extra: 'nada', symbol: 'estrela', chair: 'puff',
  };
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
  const fill = a.shirt === '#f8f9fa' ? INK : '#fff';
  switch (a.symbol) {
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

function avatarHead(a) {
  return `
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
    </g>`;
}

function avatarBody(a) {
  const hands = a.topColor;
  return `
    <path d="M46 98 L114 98 L124 150 L36 150 Z" fill="${a.shirt}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M80 100 V150" stroke="${INK}" stroke-width="2" opacity=".35"/>
    ${avatarSymbol(a)}
    <circle cx="40" cy="132" r="10" fill="${hands}" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="120" cy="132" r="10" fill="${hands}" stroke="${INK}" stroke-width="2.5"/>
    <rect x="50" y="146" width="26" height="22" rx="4" fill="${a.pants}" stroke="${INK}" stroke-width="3"/>
    <rect x="84" y="146" width="26" height="22" rx="4" fill="${a.pants}" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="60" cy="172" rx="16" ry="7" fill="${INK}" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="100" cy="172" rx="16" ry="7" fill="${INK}" stroke="${INK}" stroke-width="2.5"/>`;
}

// back: atrás do boneco; front: na frente (assento, base).
const CHAIRS = {
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
  const chair = CHAIRS[a.chair] ?? CHAIRS.puff;
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
