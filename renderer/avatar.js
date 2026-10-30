'use strict';

// Bonecos em estilo recorte de papel, sentados na cadeira de cada um.
// O avatar viaja entre os peers e vira SVG via string, então TODO campo é
// validado contra as listas abaixo (sanitizeAvatar) antes de desenhar.

const INK = '#17151c';

// Halloween: fantasias sorteadas ao entrar e tema próprio. O dia vem do PC de
// cada um; a janela folgada cobre véspera e fuso.
const HALLOWEEN = (() => {
  const now = new Date();
  return (now.getMonth() === 9 && now.getDate() >= 30) || (now.getMonth() === 10 && now.getDate() === 1);
})();

const AVATAR_PALETTE = [
  '#ff2bd6', '#19f0ff', '#b6ff3b', '#ffb627', '#ff3b5c', '#ff6b00',
  '#7048e8', '#364fc7', '#2f9e44', '#f8f9fa', '#495057', '#212529',
];

// Camisas que lembram times, bandas, games, animes e filmes só pelas cores e
// pelo corte: sem escudo, logo, nome nem personagem desenhado.
// main: cor principal (usada nas cadeiras); swatch: CSS do botão no editor;
// draw(a, t): listras dentro do recorte do tronco; t = altura do ombro, pra
// gola acompanhar o tipo de corpo. A área cobre o tronco mais largo.
const KIT_AREA = '<rect x="0" y="80" width="160" height="100" fill="FILL"/>';
const area = (fill) => KIT_AREA.replace('FILL', fill);
const range = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const vCollar = (t) => `<path d="M66 ${t} L80 ${t + 16} L94 ${t}" fill="none" stroke="#f8f9fa" stroke-width="4"/>`;
const vBars = (from, to, step, w, fill, op = 1) => range(from, to, step)
  .map((x) => `<rect x="${x}" y="80" width="${w}" height="100" fill="${fill}" opacity="${op}"/>`).join('');
const hBars = (from, to, step, h, fill, op = 1) => range(from, to, step)
  .map((y) => `<rect x="0" y="${y}" width="160" height="${h}" fill="${fill}" opacity="${op}"/>`).join('');
const flames = (y, fill) => `<path d="M0 180 V${y + 8} ${range(0, 144, 16).map((x, i) =>
  `Q${x + 4} ${y - 6 - (i % 2) * 8} ${x + 8} ${y + 4} Q${x + 12} ${y - 4} ${x + 16} ${y + 8}`).join(' ')} V180 Z" fill="${fill}"/>`;
const sparkle = (x, y, r, fill) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${fill}"/>`;
const pixelRows = (rows, x, y, s, fill) => rows.flatMap((row, j) => [...row].map((c, i) =>
  c === 'X' ? `<rect x="${x + i * s}" y="${y + j * s}" width="${s}" height="${s}" fill="${fill}"/>` : '')).join('');
const HEART_ROWS = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
function spiderWeb(cx, cy) {
  const angles = range(0, 330, 30).map((d) => d * Math.PI / 180);
  const pt = (r, ang) => `${(cx + r * Math.cos(ang)).toFixed(1)} ${(cy + r * Math.sin(ang)).toFixed(1)}`;
  const spokes = angles.map((ang) => `M${cx} ${cy} L${pt(120, ang)}`).join(' ');
  const rings = [14, 28, 44, 62, 82].map((r) => angles.map((ang, i) => {
    const next = i === angles.length - 1 ? 2 * Math.PI : angles[i + 1];
    return `${i ? '' : `M${pt(r, ang)} `}Q${pt(r * 0.82, (ang + next) / 2)} ${pt(r, next)}`;
  }).join(' ')).join(' ');
  return `<path d="${spokes} ${rings}" fill="none" stroke="${INK}" stroke-width="1.3"/>`;
}

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

  // Bandas: o estilo de cada gênero, sem logo nem nome de banda.
  'rock clássico': {
    main: '#16141a', swatch: 'linear-gradient(#16141a 0 55%, #ff6b00 55% 80%, #ffd43b 80%)',
    draw: () => area('#16141a') + flames(126, '#ff6b00') + flames(138, '#ffd43b'),
  },
  'metal': {
    main: '#111', swatch: 'linear-gradient(#e9ecef 0 18%, #111 18% 82%, #e9ecef 82%)',
    draw: (a, t) => area('#111') + range(0, 150, 10).map((x) =>
      `<path d="M${x} ${t - 2} l5 14 l5 -14 Z M${x} 152 l5 -14 l5 14 Z" fill="#e9ecef"/>`).join(''),
  },
  'punk': {
    main: '#c1121f',
    swatch: 'repeating-linear-gradient(0deg, rgba(0,0,0,.45) 0 4px, transparent 4px 12px), repeating-linear-gradient(90deg, #c1121f 0 8px, #111 8px 11px)',
    draw: () => area('#c1121f') + vBars(6, 146, 20, 6, '#111', 0.7) + hBars(84, 176, 20, 6, '#111', 0.55)
      + vBars(16, 156, 20, 1.5, '#ffd43b') + hBars(94, 176, 20, 1.5, '#ffd43b'),
  },
  'raio': {
    main: '#16141a', swatch: 'linear-gradient(135deg, #16141a 0 40%, #ff3b5c 40% 55%, #19f0ff 55% 62%, #16141a 62%)',
    draw: (a, t) => area('#16141a') + `<path d="M96 ${t - 2} L56 ${t + 30} L78 ${t + 30} L60 156 L106 ${t + 18} L84 ${t + 18} L104 ${t - 2} Z"
      fill="#ff3b5c" stroke="#19f0ff" stroke-width="3" stroke-linejoin="round"/>`,
  },
  'reggae': {
    main: '#2f9e44', swatch: 'linear-gradient(#2f9e44 0 33%, #ffd43b 33% 66%, #e03131 66%)',
    draw: (a, t) => area('#e03131') + `<rect x="0" y="80" width="160" height="${t - 62}" fill="#2f9e44"/>
      <rect x="0" y="${t + 18}" width="160" height="18" fill="#ffd43b"/>`,
  },
  'grunge': {
    main: '#2f6b3a', swatch: 'linear-gradient(90deg, #2f6b3a 0 40%, #f1f3f5 40% 60%, #2f6b3a 60%)',
    draw: () => area('#2f6b3a') + vBars(0, 150, 18, 7, '#14301b', 0.8) + hBars(84, 176, 18, 7, '#14301b', 0.6)
      + vBars(12, 156, 18, 1.5, '#c92a2a', 0.8)
      + `<rect x="68" y="80" width="24" height="100" fill="#f1f3f5"/><path d="M68 80 V180 M92 80 V180" stroke="${INK}" stroke-width="2"/>`,
  },
  'turnê': {
    main: '#212529', swatch: 'linear-gradient(90deg, #111 0 25%, #f1f3f5 25% 75%, #111 75%)',
    draw: () => area('#f1f3f5') + '<path d="M0 80 H56 L30 180 H0 Z M160 80 H104 L130 180 H160 Z" fill="#111"/>',
  },
  'pop': {
    main: '#ff4fa3', swatch: 'radial-gradient(#fff 0 1.5px, transparent 2px) 0 0 / 8px 8px, #ff4fa3',
    draw: (a, t) => area('#ff4fa3') + [[40, t + 14], [120, t + 20], [54, t + 44], [108, t + 46], [80, t + 8]]
      .map(([x, y]) => sparkle(x, y, 6, '#fff')).join(''),
  },
  'xadrez caipira': {
    main: '#e03131',
    swatch: 'repeating-linear-gradient(0deg, rgba(224,49,49,.55) 0 5px, transparent 5px 10px), repeating-linear-gradient(90deg, rgba(224,49,49,.55) 0 5px, #fff 5px 10px)',
    draw: (a, t) => area('#fff') + vBars(0, 156, 12, 6, '#e03131', 0.55) + hBars(80, 176, 12, 6, '#e03131', 0.55)
      + `<path d="M80 ${t + 4} V150" stroke="#9c1c1c" stroke-width="1.5"/>`,
  },

  // Games: cores e elementos clássicos, sem personagem desenhado.
  'cogumelo': {
    main: '#e03131', swatch: 'radial-gradient(#fff 0 3px, transparent 3.5px) 0 0 / 12px 12px, #e03131',
    draw: (a, t) => area('#e03131') + [[44, t + 16, 10], [114, t + 12, 12], [78, t + 42, 8], [124, t + 46, 7], [36, t + 48, 7]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f8f9fa"/>`).join(''),
  },
  'encanador': {
    main: '#e03131', swatch: 'linear-gradient(#e03131 0 40%, #1c3faa 40%)',
    draw: (a, t) => area('#e03131') + `<rect x="0" y="${t + 36}" width="160" height="100" fill="#1c3faa"/>
      <rect x="54" y="${t + 18}" width="52" height="30" fill="#1c3faa"/>
      <path d="M58 ${t + 20} L50 ${t - 4} M102 ${t + 20} L110 ${t - 4}" stroke="#1c3faa" stroke-width="9"/>
      <circle cx="60" cy="${t + 25}" r="4" fill="#ffd43b" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="100" cy="${t + 25}" r="4" fill="#ffd43b" stroke="${INK}" stroke-width="1.5"/>`,
  },
  'herói da espada': {
    main: '#2b8a3e', swatch: 'linear-gradient(#2b8a3e 0 60%, #7a4a1f 60% 72%, #2b8a3e 72%)',
    draw: (a, t) => area('#2b8a3e') + `<path d="M64 ${t - 2} L80 ${t + 14} L96 ${t - 2} Z" fill="#f1f3f5"/>
      <path d="M44 ${t - 2} L124 ${t + 42}" stroke="#7a4a1f" stroke-width="6"/>
      <rect x="0" y="${t + 40}" width="160" height="9" fill="#7a4a1f"/>
      <rect x="73" y="${t + 38}" width="14" height="13" rx="2" fill="none" stroke="#ffd43b" stroke-width="3"/>`,
  },
  'vida cheia': {
    main: '#1b1f3b', swatch: 'radial-gradient(circle, #e03131 0 3px, transparent 3.5px) 0 0 / 10px 10px, #1b1f3b',
    draw: (a, t) => area('#1b1f3b') + [47, 70, 93].map((x) => pixelRows(HEART_ROWS, x, t + 12, 3, '#e03131')).join(''),
  },
  'bloco de grama': {
    main: '#6abe30', swatch: 'linear-gradient(#6abe30 0 30%, #8b5a2b 30%)',
    draw: (a, t) => area('#8b5a2b') + `<rect x="0" y="80" width="160" height="${t - 64}" fill="#6abe30"/>`
      + range(0, 152, 8).map((x, i) => `<rect x="${x}" y="${t + 16}" width="8" height="${[4, 8, 0, 6, 2][i % 5]}" fill="#6abe30"/>`).join('')
      + [[20, 30, '#6b4220'], [44, 42, '#a9743c'], [100, 34, '#6b4220'], [128, 26, '#a9743c'], [60, 26, '#a9743c'], [116, 44, '#6b4220'], [32, 46, '#a9743c'], [84, 46, '#6b4220']]
        .map(([x, dy, c]) => `<rect x="${x}" y="${t + dy}" width="8" height="8" fill="${c}"/>`).join(''),
  },
  'neon retrô': {
    main: '#2a0a4a', swatch: 'linear-gradient(#2a0a4a 0 45%, #ffb627 45% 55%, #ff2bd6 55% 58%, #2a0a4a 58%)',
    draw: (a, t) => {
      const h = t + 30;
      return area('#2a0a4a') + `<circle cx="80" cy="${h}" r="22" fill="#ffb627"/>`
        + [[-12, 2], [-7, 3], [-3, 3]].map(([d, hh]) => `<rect x="50" y="${h + d}" width="60" height="${hh}" fill="#2a0a4a"/>`).join('')
        + `<rect x="0" y="${h}" width="160" height="100" fill="#2a0a4a"/>`
        + [0, 5, 12, 22].map((d) => `<path d="M0 ${h + d} H160" stroke="#ff2bd6" stroke-width="1.5"/>`).join('')
        + range(-160, 320, 40).map((x) => `<path d="M80 ${h} L${x} ${h + 80}" stroke="#ff2bd6" stroke-width="1.5"/>`).join('');
    },
  },
  'camuflado': {
    main: '#4b5a2a',
    swatch: 'radial-gradient(circle at 30% 40%, #2f3a1a 0 5px, transparent 6px), radial-gradient(circle at 70% 70%, #8a7a4a 0 6px, transparent 7px), #4b5a2a',
    draw: () => area('#4b5a2a') + [[30, 100, 18, 10, 20, '#2f3a1a'], [96, 92, 22, 9, -15, '#8a7a4a'], [128, 124, 16, 11, 30, '#2f3a1a'],
      [60, 132, 20, 8, -10, '#8a7a4a'], [20, 140, 14, 9, 0, '#6b7b3a'], [110, 150, 18, 8, 10, '#6b7b3a'], [76, 110, 12, 7, 40, '#2f3a1a']]
      .map(([x, y, rx, ry, r, c]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join(''),
  },
  'anéis dourados': {
    main: '#1c5fd1', swatch: 'radial-gradient(circle, transparent 0 2px, #ffd43b 2.5px 4px, transparent 4.5px) 0 0 / 12px 12px, #1c5fd1',
    draw: (a, t) => area('#1c5fd1') + [[42, t + 14], [62, t + 8], [118, t + 16], [100, t + 40], [40, t + 42], [124, t + 46]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#ffd43b" stroke-width="3"/>`).join(''),
  },
  'blocos caindo': {
    main: '#212529', swatch: 'linear-gradient(90deg, #19f0ff 0 25%, #ffd43b 25% 50%, #b6ff3b 50% 75%, #ff3b5c 75%)',
    draw: (a, t) => area('#212529') + [
      [24, 138, '#19f0ff'], [36, 138, '#19f0ff'], [48, 138, '#19f0ff'], [60, 138, '#19f0ff'], [84, 138, '#ffd43b'], [96, 138, '#ffd43b'],
      [108, 138, '#b6ff3b'], [120, 138, '#b6ff3b'], [132, 138, '#ff3b5c'], [24, 126, '#ff3b5c'], [84, 126, '#ffd43b'], [96, 126, '#ffd43b'],
      [120, 126, '#b6ff3b'], [132, 126, '#ff3b5c'], [36, 126, '#ff3b5c'],
      [92, t + 6, '#7048e8'], [104, t + 6, '#7048e8'], [116, t + 6, '#7048e8'], [104, t + 18, '#7048e8'],
    ].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="12" height="12" fill="${c}" stroke="${INK}" stroke-width="1.5"/>`).join(''),
  },

  // Animes: cores e cortes de roupa que lembram os mais famosos.
  'ninja laranja': {
    main: '#ff7a1a', swatch: 'linear-gradient(#212529 0 25%, #ff7a1a 25%)',
    draw: (a, t) => area('#ff7a1a') + `<rect x="0" y="80" width="160" height="${t - 64}" fill="#212529"/>
      <path d="M80 ${t + 16} V150" stroke="#212529" stroke-width="3"/>
      <path d="M60 ${t + 2} Q80 ${t + 20} 100 ${t + 2}" fill="none" stroke="#f1f3f5" stroke-width="5"/>`,
  },
  'gi de luta': {
    main: '#ff7a1a', swatch: 'linear-gradient(135deg, #ff7a1a 0 45%, #1c3faa 45% 55%, #ff7a1a 55%)',
    draw: (a, t) => area('#ff7a1a') + `<path d="M56 ${t - 2} L80 ${t + 30} L104 ${t - 2} Z" fill="#1c3faa"/>
      <path d="M56 ${t - 2} L88 ${t + 42}" stroke="#d9480f" stroke-width="3"/>
      <rect x="0" y="${t + 40}" width="160" height="9" fill="#1c3faa"/>
      <path d="M84 ${t + 48} l-4 14 M90 ${t + 48} l4 14" stroke="#1c3faa" stroke-width="5"/>`,
  },
  'colete pirata': {
    main: '#d1001f', swatch: 'linear-gradient(90deg, #d1001f 0 38%, #f2c9a0 38% 62%, #d1001f 62%)',
    draw: (a, t) => area('#d1001f') + `<path d="M64 ${t - 2} L70 ${t + 42} H90 L96 ${t - 2} Z" fill="${a.skin}"/>
      <path d="M64 ${t - 2} L70 ${t + 42} M96 ${t - 2} L90 ${t + 42}" stroke="${INK}" stroke-width="2"/>
      <rect x="0" y="${t + 42}" width="160" height="12" fill="#ffd43b"/>`,
  },
  'xadrez verde': {
    main: '#2b8a3e', swatch: 'conic-gradient(#111 0 25%, #2b8a3e 0 50%, #111 0 75%, #2b8a3e 0) 0 0 / 12px 12px',
    draw: () => area('#2b8a3e') + range(0, 144, 16).flatMap((x) => range(80, 176, 16).map((y) =>
      ((x + y) / 16) % 2 ? `<rect x="${x}" y="${y}" width="16" height="16" fill="#111"/>` : '')).join(''),
  },
  'marinheiro': {
    main: '#1c3faa', swatch: 'linear-gradient(#1c3faa 0 30%, #f8f9fa 30%)',
    draw: (a, t) => area('#f8f9fa') + `<path d="M28 ${t - 4} H132 L118 ${t + 22} L80 ${t + 36} L42 ${t + 22} Z" fill="#1c3faa"/>
      <path d="M38 ${t + 14} L80 ${t + 28} L122 ${t + 14}" fill="none" stroke="#f8f9fa" stroke-width="2"/>
      <path d="M66 ${t - 4} L80 ${t + 20} L94 ${t - 4} Z" fill="#f8f9fa"/>
      <path d="M80 ${t + 28} l-12 -7 v14 Z M80 ${t + 28} l12 -7 v14 Z" fill="#e03131" stroke="${INK}" stroke-width="1.5"/>`,
  },
  'jaqueta cadete': {
    main: '#8b5a2b', swatch: 'linear-gradient(90deg, #8b5a2b 0 40%, #f1f3f5 40% 60%, #8b5a2b 60%)',
    draw: (a, t) => area('#f1f3f5') + `<path d="M0 80 H66 L70 ${t + 40} H0 Z M160 80 H94 L90 ${t + 40} H160 Z" fill="#8b5a2b"/>
      <path d="M66 80 L70 ${t + 40} M94 80 L90 ${t + 40}" stroke="${INK}" stroke-width="2"/>
      <path d="M0 ${t + 28} H160 M0 ${t + 42} H160 M50 ${t + 42} L80 152 M110 ${t + 42} L80 152" stroke="#3b2a1a" stroke-width="4"/>`,
  },
  'robô gigante': {
    main: '#1c3faa', swatch: 'linear-gradient(#1c3faa 0 45%, #f1f3f5 45%)',
    draw: (a, t) => area('#f1f3f5') + `<path d="M10 ${t - 4} H150 L132 ${t + 32} H28 Z" fill="#1c3faa" stroke="${INK}" stroke-width="2"/>
      <path d="M40 ${t + 6} h22 v14 h-22 Z M98 ${t + 6} h22 v14 h-22 Z" fill="#ffd43b" stroke="${INK}" stroke-width="1.5"/>
      <path d="M40 ${t + 11} h22 M40 ${t + 15} h22 M98 ${t + 11} h22 M98 ${t + 15} h22" stroke="${INK}" stroke-width="1.2"/>
      <rect x="68" y="${t + 34}" width="24" height="16" fill="#e03131" stroke="${INK}" stroke-width="2"/>`,
  },
  'kimono': {
    main: '#212529', swatch: 'linear-gradient(135deg, #212529 0 42%, #f1f3f5 42% 52%, #212529 52%)',
    draw: (a, t) => area('#212529') + `<path d="M58 ${t - 2} L94 ${t + 44} M102 ${t - 2} L80 ${t + 26}" stroke="#f1f3f5" stroke-width="7"/>
      <rect x="0" y="${t + 42}" width="160" height="10" fill="#495057"/>`,
  },
  'mangá': {
    main: '#212529', swatch: 'radial-gradient(#111 0 1.5px, transparent 2px) 0 0 / 6px 6px, #f8f9fa',
    draw: (a, t) => area('#f8f9fa') + range(0, 345, 15).map((d) => {
      const r = d * Math.PI / 180;
      const p = (k) => `${(80 + k * Math.cos(r)).toFixed(1)} ${(t + 30 + k * Math.sin(r)).toFixed(1)}`;
      return `<path d="M${p(34)} L${p(120)}" stroke="#111" stroke-width="1.5"/>`;
    }).join(''),
  },

  // Filmes: figurinos famosos só pelas cores e pelo corte.
  'teia': {
    main: '#d1001f', swatch: 'linear-gradient(90deg, #1c3faa 0 20%, #d1001f 20% 80%, #1c3faa 80%)',
    draw: (a, t) => area('#d1001f')
      + `<path d="M0 ${t + 16} L40 ${t + 26} L46 180 H0 Z M160 ${t + 16} L120 ${t + 26} L114 180 H160 Z" fill="#1c3faa"/>`
      + spiderWeb(80, t + 24),
  },
  'herói de capa': {
    main: '#1c5fd1', swatch: 'linear-gradient(90deg, #d1001f 0 15%, #1c5fd1 15% 85%, #d1001f 85%)',
    draw: (a, t) => area('#1c5fd1') + `<path d="M0 80 H44 Q34 ${t + 10} 26 180 H0 Z M160 80 H116 Q126 ${t + 10} 134 180 H160 Z" fill="#d1001f"/>
      <rect x="0" y="${t + 44}" width="160" height="7" fill="#ffd43b"/>`,
  },
  'bruxinho': {
    main: '#212529',
    swatch: 'linear-gradient(90deg, #212529 0 40%, #7a1430 40% 46%, #ffd43b 46% 54%, #7a1430 54% 60%, #212529 60%)',
    draw: (a, t) => area('#212529') + `<path d="M60 ${t - 2} L80 ${t + 44} L100 ${t - 2} Z" fill="#f1f3f5"/>
      <path d="M76 ${t + 4} H84 L87 ${t + 38} L80 ${t + 46} L73 ${t + 38} Z" fill="#7a1430"/>
      <path d="M75 ${t + 14} L85 ${t + 10} M74 ${t + 24} L86 ${t + 20} M74 ${t + 34} L86 ${t + 30}" stroke="#ffd43b" stroke-width="2.5"/>
      <path d="M60 ${t - 2} L80 ${t + 44} L100 ${t - 2}" fill="none" stroke="${INK}" stroke-width="2"/>`,
  },
  'smoking': {
    main: '#111', swatch: 'linear-gradient(90deg, #111 0 38%, #f8f9fa 38% 62%, #111 62%)',
    draw: (a, t) => area('#111') + `<path d="M62 ${t - 2} L80 ${t + 46} L98 ${t - 2} Z" fill="#f8f9fa"/>
      <path d="M62 ${t - 2} L72 ${t + 20} L66 ${t + 26} L80 ${t + 46} M98 ${t - 2} L88 ${t + 20} L94 ${t + 26} L80 ${t + 46}" fill="none" stroke="#495057" stroke-width="3"/>
      <path d="M80 ${t + 7} l-9 -5 v10 Z M80 ${t + 7} l9 -5 v10 Z" fill="#111"/>
      <circle cx="80" cy="${t + 20}" r="1.6" fill="#111"/><circle cx="80" cy="${t + 30}" r="1.6" fill="#111"/>`,
  },
  'código verde': {
    main: '#0a0f0a', swatch: 'repeating-linear-gradient(90deg, #0a0f0a 0 5px, #2fe36a 5px 6px)',
    draw: () => area('#0a0f0a') + range(4, 150, 10).map((x, i) => {
      const start = 80 + (i * 37) % 56;
      return range(0, 4, 1).map((k) =>
        `<rect x="${x}" y="${start + k * 9}" width="3" height="6" fill="#2fe36a" opacity="${(0.2 + k * 0.2).toFixed(1)}"/>`).join('');
    }).join(''),
  },
  'caça-fantasma': {
    main: '#c9b48a', swatch: 'linear-gradient(90deg, #c9b48a 0 45%, #6c757d 45% 55%, #c9b48a 55%)',
    draw: (a, t) => area('#c9b48a') + `<path d="M44 ${t} L50 150 M116 ${t} L110 150" stroke="#495057" stroke-width="7"/>
      <path d="M80 ${t + 2} V150" stroke="#6c757d" stroke-width="3"/>
      <rect x="90" y="${t + 12}" width="18" height="8" rx="2" fill="#f8f9fa" stroke="${INK}" stroke-width="1"/>`,
  },
  'manto do mestre': {
    main: '#7a5230', swatch: 'linear-gradient(90deg, #7a5230 0 22%, #e9d8b4 22% 78%, #7a5230 78%)',
    draw: (a, t) => area('#e9d8b4') + `<path d="M58 ${t - 2} L90 ${t + 42} M102 ${t - 2} L76 ${t + 28}" stroke="#a8875a" stroke-width="5"/>
      <rect x="0" y="${t + 42}" width="160" height="12" fill="#6b4220"/>
      <path d="M0 80 H34 L44 180 H0 Z M160 80 H126 L116 180 H160 Z" fill="#7a5230"/>`,
  },
  'astronauta': {
    main: '#e9ecef', swatch: 'linear-gradient(#f1f3f5 0 60%, #1c3faa 60% 70%, #f1f3f5 70%)',
    draw: (a, t) => area('#f1f3f5') + `<rect x="62" y="${t + 18}" width="36" height="22" rx="3" fill="#adb5bd" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="70" cy="${t + 29}" r="3" fill="#e03131"/><circle cx="80" cy="${t + 29}" r="3" fill="#2f9e44"/><circle cx="90" cy="${t + 29}" r="3" fill="#ffd43b"/>
      <rect x="36" y="${t + 6}" width="16" height="11" fill="#1c3faa"/><path d="M36 ${t + 10} h16 M36 ${t + 14} h16" stroke="#e03131" stroke-width="1.5"/>
      <rect x="0" y="${t + 44}" width="160" height="6" fill="#1c3faa"/>`,
  },
  'pirata': {
    main: '#e03131',
    swatch: 'linear-gradient(90deg, #212529 0 22%, transparent 22% 78%, #212529 78%), repeating-linear-gradient(0deg, #e03131 0 5px, #f8f9fa 5px 10px)',
    draw: () => area('#f8f9fa') + hBars(84, 176, 12, 6, '#e03131') + '<path d="M0 80 H56 L62 180 H0 Z M160 80 H104 L98 180 H160 Z" fill="#212529"/>',
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

// Abas do editor. 'nada' aparece em todas as abas do campo que tiver.
const AVATAR_CATEGORIES = {
  top: [
    ['Cabelo', ['moicano', 'pompons', 'espetado', 'black power', 'cacheado', 'tranças', 'careca', 'topete', 'coque', 'liso longo']],
    ['Boné e chapéu', ['gorro', 'boné', 'boné aba reta', 'capuz', 'bandana', 'pescador', 'viseira', 'chapéu de cowboy', 'capacete']],
    ['Fantasia', ['coroa', 'chapéu de palha', 'chapéu de bruxo', 'orelhas de gato', 'chifres', 'tricórnio', 'cartola', 'auréola']],
  ],
  extra: [
    ['Gamer', ['headset', 'fone', 'óculos neon']],
    ['Torcida', ['faixa', 'pintura', 'bochecha']],
    ['Estilo', ['óculos', 'óculos escuros']],
    ['Personagem', ['tapa-olho', 'bandana ninja', 'máscara']],
  ],
  kit: [
    ['Lisa', ['lisa']],
    ['Times', ['rubro-negra', 'alvinegra', 'tricolor faixa', 'verdão', 'faixa diagonal', 'tricolor grená', 'colorada', 'celeste',
      'tricolor gaúcha', 'canarinho', 'alviverde listrada', 'rubro-negra vertical', 'tricolor baiana', 'celeste listrada', 'goleiro neon',
      'alvirrubra', 'alvinegra horizontal', 'alviverde vertical', 'verde e amarela listrada', 'meio a meio', 'branca faixa verde',
      'branca clássica', 'faixa diagonal vermelha']],
    ['Bandas', ['rock clássico', 'metal', 'punk', 'raio', 'reggae', 'grunge', 'turnê', 'pop', 'xadrez caipira']],
    ['Games', ['cogumelo', 'encanador', 'herói da espada', 'vida cheia', 'bloco de grama', 'neon retrô', 'camuflado', 'anéis dourados', 'blocos caindo']],
    ['Animes', ['ninja laranja', 'gi de luta', 'colete pirata', 'xadrez verde', 'marinheiro', 'jaqueta cadete', 'robô gigante', 'kimono', 'mangá']],
    ['Filmes', ['teia', 'herói de capa', 'bruxinho', 'smoking', 'código verde', 'caça-fantasma', 'manto do mestre', 'astronauta', 'pirata']],
  ],
  symbol: [
    ['Número', ['10', '9', '7', '11', '1']],
    ['Esporte', ['bola', 'troféu']],
    ['Rock', ['raio', 'caveira', 'guitarra']],
    ['Geek', ['controle', 'cogumelo', 'shuriken', 'claquete']],
    ['Outros', ['estrela', 'coração']],
  ],
  chair: [
    ['Gamer', ['puff', 'trono', 'escritório', 'cogumelo gigante']],
    ['Esporte', ['banco de reserva', 'bola', 'cadeira de estádio']],
    ['Rolê', ['cadeira de praia', 'rede', 'caixote', 'pneus', 'boteco', 'sofá', 'cooler']],
    ['Show e cinema', ['amplificador', 'poltrona de cinema', 'cadeira de diretor']],
    ['Fantasia', ['trono de rei', 'trono de espadas']],
  ],
  item: [
    ['Gamer', ['controle', 'celular']],
    ['Cinema', ['pipoca', 'refri']],
    ['Esporte', ['bola', 'cordão']],
    ['Bandas', ['guitarra', 'microfone']],
    ['Fantasia', ['katana', 'espada laser', 'varinha', 'onigiri']],
  ],
};
// Nome que aparece no editor pras peças que lembram algo famoso: paródia
// tosca de propósito. O valor salvo e enviado aos amigos continua o de cima.
const AVATAR_NAMES = {
  kit: {
    'rubro-negra': 'Framengo', 'alvinegra': 'Botafofo', 'tricolor faixa': 'San Pirlo', 'verdão': 'Parmeira',
    'faixa diagonal': 'Vasquinho da Gama', 'tricolor grená': 'Flumineiro', 'colorada': 'Internacionau', 'celeste': 'Cruzeta',
    'tricolor gaúcha': 'Grêmiu', 'canarinho': 'Canarinho Pistola', 'alviverde listrada': 'Coxinha FC',
    'rubro-negra vertical': 'Atlético Paranoico', 'tricolor baiana': 'Baêa Sport', 'celeste listrada': 'Hermanos FC',
    'goleiro neon': 'Muralha do Bairro', 'alvirrubra': 'Banguela FC', 'alvinegra horizontal': 'Vovô FC',
    'alviverde vertical': 'Juventudo', 'verde e amarela listrada': 'Brasiliense da Laje', 'meio a meio': 'Meia-Boca FC',
    'branca faixa verde': 'Coritibinha', 'branca clássica': 'Curintia', 'faixa diagonal vermelha': 'Ríver Pleite',
    'rock clássico': 'AC/PC', 'metal': 'Ferratica', 'punk': 'Os Ramonas', 'raio': 'Davi Bauí', 'reggae': 'Bob Marli',
    'grunge': 'Nirvã', 'turnê': 'Iron Maidem', 'pop': 'Taylor Suíte', 'xadrez caipira': 'Chitãozão & Chororó',
    'cogumelo': 'Cogumelo Turbinado', 'encanador': 'Jorge', 'herói da espada': 'Zé Lda', 'vida cheia': 'Vida Extra',
    'bloco de grama': 'Mainicrafte', 'neon retrô': 'Vaporuei', 'camuflado': 'Frifas', 'anéis dourados': 'Sônico',
    'blocos caindo': 'Tétriz',
    'ninja laranja': 'Narutinho', 'gi de luta': 'Goku de Itaquera', 'colete pirata': 'Lufe', 'xadrez verde': 'Tanjirão',
    'marinheiro': 'Sailor Mun', 'jaqueta cadete': 'Ataque dos Tiozão', 'robô gigante': 'Gundão', 'kimono': 'Ichigão',
    'mangá': 'Ora Ora Ora',
    'teia': 'Homem-Aranhiço', 'herói de capa': 'Super Homi', 'bruxinho': 'Rari Póte', 'smoking': 'Jaime Bonde',
    'código verde': 'Matriz', 'caça-fantasma': 'Caça-Assombração', 'manto do mestre': 'Mestre Jedai',
    'astronauta': 'Astronauta de Mármore', 'pirata': 'Jeca Sparrow',
  },
  top: {
    'espetado': 'Super Sayajão', 'topete': 'Elvês', 'chapéu de palha': 'Chapéu do Lufe', 'chapéu de bruxo': 'Chapéu do Gandalfo',
    'tricórnio': 'Tricórnio do Jeca', 'chapéu de cowboy': 'Peão de Barretos',
  },
  extra: { 'bandana ninja': 'Bandana da Folha Seca', 'máscara': 'Zorra' },
  symbol: { 'cogumelo': 'Cogumelo do Jorge' },
  chair: {
    'cogumelo gigante': 'Cogumelão do Jorge', 'amplificador': 'Amplificador Marshmallow', 'cadeira de diretor': 'Cadeira do Espilbergue',
    'trono de espadas': 'Trono das Espadas Paraguaias',
  },
  item: { 'espada laser': 'Sabre de Luz Paraguaio', 'varinha': 'Varinha do Rari Póte', 'katana': 'Katana do Tanjirão' },
  costume: {
    'nada': 'Sem fantasia', 'jason': 'Jeison do Lago', 'myers': 'Maicon Maias', 'freddy': 'Fredão das Garras',
    'leatherface': 'Zé Motosserra', 'ghostface': 'Gritão', 'chucky': 'Boneco do Paraguai', 'art': 'Arnaldo, o Palhaço',
    'pinhead': 'Cabeça de Alfinete', 'pennywise': 'Peniuaise da Sarjeta', 'dracula': 'Drácula da Penha',
    'frankenstein': 'Frankenstênio', 'sadako': 'Sadaquinha do Poço',
  },
};
const avatarName = (key, value) => AVATAR_NAMES[key]?.[value] ?? value;

const allIn = (key) => AVATAR_CATEGORIES[key].flatMap(([, list]) => list);

const AVATAR_OPTIONS = {
  body: Object.keys(BODIES),
  skin: ['#f5d0b0', '#f2c9a0', '#e9b98f', '#c68a5e', '#8d5a3b', '#5c3a24'],
  eyes: ['normal', 'feliz', 'bravo', 'sonolento', 'surpreso', 'estrela'],
  brows: ['nada', 'finas', 'grossas', 'bravas', 'preocupadas'],
  mouth: ['normal', 'sorrisão', 'sério', 'de lado', 'dentuço', 'aparelho'],
  facial: ['nada', 'bigode', 'cavanhaque', 'barba', 'barba rala'],
  marks: ['nada', 'sardas', 'cicatriz', 'curativo', 'pintinha'],
  hairColor: HAIR_COLORS,
  top: ['nada', ...allIn('top')],
  topColor: [...AVATAR_PALETTE, '#2b1a12', '#c9a227'],
  extra: ['nada', ...allIn('extra')],
  kit: allIn('kit'),
  shirt: AVATAR_PALETTE,
  symbol: ['nada', ...allIn('symbol')],
  pants: ['#343a40', '#1864ab', '#2b2b2b', '#5c3d2e', '#7048e8', '#2f9e44'],
  chair: allIn('chair'),
  item: ['nada', ...allIn('item')],
  costume: ['nada', 'jason', 'myers', 'freddy', 'leatherface', 'ghostface', 'chucky', 'art', 'pinhead', 'pennywise', 'dracula', 'frankenstein', 'sadako'],
};

// Seções do editor de boneco.
const AVATAR_GROUPS = HALLOWEEN ? [['Skin premium', ['costume']]] : [
  ['Skin premium', ['costume']],
  ['Corpo e rosto', ['body', 'skin', 'eyes', 'brows', 'mouth', 'facial', 'marks', 'hairColor']],
  ['Cabelo e chapéu', ['top', 'topColor', 'extra']],
  ['Roupa', ['kit', 'shirt', 'symbol', 'pants']],
  ['Cadeira e item', ['chair', 'item']],
];

const AVATAR_LABELS = {
  body: 'Corpo', skin: 'Pele', eyes: 'Olhos', brows: 'Sobrancelha', mouth: 'Boca', facial: 'Barba / bigode',
  marks: 'Detalhe no rosto', hairColor: 'Cor da barba e sobrancelha', top: 'Cabelo / chapéu',
  topColor: 'Cor do cabelo/chapéu e das mãos', extra: 'Acessório', kit: 'Camisa', shirt: 'Cor da camisa lisa',
  symbol: 'Número / estampa', pants: 'Calça', chair: 'Cadeira', item: 'Item', costume: 'Fantasia completa',
};

function defaultAvatar() {
  return {
    body: 'padrão', skin: '#f2c9a0', eyes: 'normal', brows: 'nada', mouth: 'normal', facial: 'nada',
    marks: 'nada', hairColor: '#2b1a12', top: 'gorro', topColor: '#ff2bd6', extra: 'nada', kit: 'lisa',
    shirt: '#19f0ff', symbol: 'estrela', pants: '#343a40', chair: 'puff', item: 'nada', costume: 'nada',
  };
}

function kitMain(a) {
  return KITS[a.kit]?.main ?? a.shirt;
}

function randomAvatar() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  // Fantasia é escolha à parte: o boneco sorteado sai sem.
  return { ...Object.fromEntries(Object.entries(AVATAR_OPTIONS).map(([k, list]) => [k, pick(list)])), costume: 'nada' };
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
    case 'topete':
      return `<path d="M40 52 Q36 30 58 24 Q66 4 96 6 Q124 10 118 30 Q124 40 120 52 Q102 36 80 40 Q58 36 40 52 Z" fill="${c}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M66 20 Q84 10 106 16" fill="none" stroke="${INK}" stroke-width="1.5" opacity=".5"/>`;
    case 'coque':
      return `<circle cx="80" cy="16" r="15" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M38 56 Q80 10 122 56 Q80 40 38 56 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
        <rect x="70" y="26" width="20" height="6" rx="3" fill="${trim}" stroke="${INK}" stroke-width="1.5"/>`;
    case 'liso longo':
      return `<path d="M38 60 Q36 22 80 22 Q124 22 122 60 Q112 42 98 44 Q88 34 76 42 Q60 36 38 60 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>`;
    case 'boné aba reta':
      return `<path d="M38 50 Q80 4 122 50 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>
        <path d="M30 46 H130 L126 56 H34 Z" fill="${trim}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="106" cy="51" r="3.5" fill="#ffd43b" stroke="${INK}" stroke-width="1"/>`;
    case 'chapéu de cowboy':
      return `<path d="M50 46 Q46 14 64 16 Q80 24 96 16 Q114 14 110 46 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>
        <rect x="50" y="36" width="60" height="7" fill="${trim}"/>
        <path d="M10 40 Q24 56 80 50 Q136 56 150 40 Q146 60 80 62 Q14 60 10 40 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>`;
    case 'chapéu de palha':
      return `<path d="M48 46 Q48 14 80 14 Q112 14 112 46 Z" fill="#f2c94c" stroke="${INK}" stroke-width="3"/>
        <rect x="48" y="35" width="64" height="9" fill="#e03131" stroke="${INK}" stroke-width="2"/>
        <ellipse cx="80" cy="48" rx="62" ry="10" fill="#f2c94c" stroke="${INK}" stroke-width="3"/>
        <path d="M30 48 Q80 56 130 48" fill="none" stroke="#c9a227" stroke-width="1.5"/>`;
    case 'chapéu de bruxo':
      return `<path d="M44 48 L82 -6 Q90 -10 96 0 L88 4 L116 48 Z" fill="${c}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        <rect x="50" y="36" width="61" height="8" fill="${trim}"/>
        <path d="M74 20 l2 4 4 .5 -3 2.8 .8 4 -3.8 -2 -3.8 2 .8 -4 -3 -2.8 4 -.5z" fill="#ffd43b"/>
        <ellipse cx="80" cy="50" rx="56" ry="9" fill="${c}" stroke="${INK}" stroke-width="3"/>`;
    case 'orelhas de gato':
      return `<path d="M40 50 L42 10 L70 34 Z M120 50 L118 10 L90 34 Z" fill="${c}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        <path d="M46 40 L47 20 L62 33 Z M114 40 L113 20 L98 33 Z" fill="#ff8fab"/>`;
    case 'chifres':
      return `<path d="M50 36 Q34 20 40 0 Q50 18 64 30 Z M110 36 Q126 20 120 0 Q110 18 96 30 Z" fill="${c}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
    case 'tricórnio':
      return `<path d="M24 46 Q40 8 80 12 Q120 8 136 46 Q108 34 80 40 Q52 34 24 46 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>
        <path d="M28 44 Q52 32 80 38 Q108 32 132 44" fill="none" stroke="#ffd43b" stroke-width="3"/>`;
    case 'cartola':
      return `<rect x="54" y="-6" width="52" height="48" rx="3" fill="${c}" stroke="${INK}" stroke-width="3"/>
        <rect x="55.5" y="28" width="49" height="8" fill="${trim}"/>
        <ellipse cx="80" cy="44" rx="40" ry="7" fill="${c}" stroke="${INK}" stroke-width="3"/>`;
    case 'auréola':
      return `<ellipse cx="80" cy="10" rx="30" ry="8" fill="none" stroke="#ffd43b" stroke-width="6"/>
        <ellipse cx="80" cy="10" rx="30" ry="8" fill="none" stroke="#fff3bf" stroke-width="2"/>`;
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
    case 'liso longo':
      return `<path d="M36 56 Q30 100 36 132 L56 132 Q48 96 50 60 Z M124 56 Q130 100 124 132 L104 132 Q112 96 110 60 Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>`;
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
    case 'óculos escuros':
      return `<path d="M40 49 H120" stroke="#111" stroke-width="4"/>
        <path d="M46 48 H78 Q78 76 64 76 Q48 76 46 48 Z M82 48 H114 Q112 76 96 76 Q82 76 82 48 Z" fill="#111" stroke="${INK}" stroke-width="2.5"/>
        <path d="M52 54 l8 0 M88 54 l8 0" stroke="#fff" stroke-width="2" opacity=".5" stroke-linecap="round"/>`;
    case 'tapa-olho':
      return `<path d="M37 70 L56 60 M78 54 Q100 40 122 44" fill="none" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="67" cy="62" rx="14" ry="15" fill="#111" stroke="${INK}" stroke-width="2"/>`;
    case 'bandana ninja':
      return `<rect x="37" y="36" width="86" height="11" rx="3" fill="${a.topColor}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M120 40 L138 48 L130 54 Z M120 43 L134 60 L124 61 Z" fill="${a.topColor}" stroke="${INK}" stroke-width="2"/>
        <rect x="63" y="33" width="34" height="16" rx="3" fill="#ced4da" stroke="${INK}" stroke-width="2"/>
        <circle cx="67.5" cy="41" r="1.5" fill="${INK}"/><circle cx="92.5" cy="41" r="1.5" fill="${INK}"/>
        <path d="M73 41 h14" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
    case 'máscara':
      return `<path fill-rule="evenodd" d="M34 56 Q50 44 80 52 Q110 44 126 56 Q126 74 108 78 Q92 80 80 70 Q68 80 52 78 Q34 74 34 56 Z
        M57 62 a10 8 0 1 0 20 0 a10 8 0 1 0 -20 0 Z M83 62 a10 8 0 1 0 20 0 a10 8 0 1 0 -20 0 Z"
        fill="${a.topColor}" stroke="${INK}" stroke-width="2.5"/>`;
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
    case 'guitarra':
      return `<g transform="rotate(-35 80 124)">
        <path d="M80 124 V104" stroke="${INK}" stroke-width="3.5"/><rect x="76.5" y="100" width="7" height="6" rx="1" fill="${INK}"/>
        <path d="M80 122 Q88 120 88 128 Q92 132 88 138 Q80 144 72 138 Q68 132 72 128 Q72 120 80 122 Z" fill="${fill}" stroke="${INK}" stroke-width="1.6"/>
        <circle cx="80" cy="131" r="2.5" fill="${INK}"/></g>`;
    case 'cogumelo':
      return `<path d="M66 124 Q66 108 80 108 Q94 108 94 124 Z" fill="#e03131" stroke="${INK}" stroke-width="1.6"/>
        <circle cx="74" cy="116" r="3" fill="#fff"/><circle cx="87" cy="115" r="2.5" fill="#fff"/>
        <rect x="73" y="124" width="14" height="12" rx="3" fill="#f8f9fa" stroke="${INK}" stroke-width="1.6"/>
        <circle cx="77" cy="129" r="1.3" fill="${INK}"/><circle cx="83" cy="129" r="1.3" fill="${INK}"/>`;
    case 'shuriken':
      return `<path d="M80 108 L84 120 L96 124 L84 128 L80 140 L76 128 L64 124 L76 120 Z" fill="${fill}" stroke="${INK}" stroke-width="1.4"/>
        <circle cx="80" cy="124" r="2.6" fill="${INK}"/>`;
    case 'claquete':
      return `<rect x="66" y="118" width="28" height="18" rx="1.5" fill="${fill}" stroke="${INK}" stroke-width="1.6"/>
        <path d="M66 118 L64 110 L92 106 L94 114 Z" fill="${INK}"/>
        <path d="M70 109 l4 7 M77 108 l4 7 M84 107 l4 7" stroke="#fff" stroke-width="2.5"/>`;
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
  const skin = PREMIUM_SKINS[a.costume];
  if (skin) return `<g class="av-head"><g transform="${transform}">${skin.head()}</g></g>`;
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
    ${PREMIUM_SKINS[a.costume]?.over?.(a, t) ?? ''}
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
  const prop = PREMIUM_SKINS[a.costume]?.prop;
  if (prop) return prop(a);
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
    case 'guitarra':
      // No colo, braço apontando pra mão direita; as duas mãos por cima.
      return `<g transform="translate(70 152) rotate(-24)">
        <rect x="4" y="-3.5" width="62" height="7" fill="#7a4a1f" stroke="${INK}" stroke-width="2"/>
        <rect x="64" y="-6" width="14" height="12" rx="2" fill="#212529" stroke="${INK}" stroke-width="2"/>
        <path d="M-30 0 Q-30 -20 -12 -16 Q-2 -24 6 -12 Q12 0 6 12 Q-2 24 -12 16 Q-30 20 -30 0 Z" fill="#d9480f" stroke="${INK}" stroke-width="2.5"/>
        <circle cx="-8" cy="0" r="4.5" fill="${INK}"/>
        <path d="M-20 -7 V7" stroke="#f8f9fa" stroke-width="3"/></g>
        ${bodyOf(a).hands.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${a.topColor}" stroke="${INK}" stroke-width="2.5"/>`).join('')}`;
    case 'microfone':
      return `<g transform="translate(${hx} ${hy - 6}) rotate(-20)">
        <rect x="-3.5" y="-6" width="7" height="22" rx="3" fill="#212529" stroke="${INK}" stroke-width="2"/>
        <circle cx="0" cy="-12" r="8" fill="#adb5bd" stroke="${INK}" stroke-width="2"/>
        <path d="M-6 -14 H6 M-6 -10 H6 M-2 -19 V-5 M2 -19 V-5" stroke="#868e96" stroke-width="1"/></g>${hand}`;
    case 'katana':
      return `<g transform="translate(${hx} ${hy}) rotate(12)">
        <path d="M-2 -6 L-2 -88 Q0 -96 3 -88 L3 -6 Z" fill="#e9ecef" stroke="${INK}" stroke-width="1.8"/>
        <rect x="-7" y="-8" width="15" height="4" rx="1.5" fill="#ffd43b" stroke="${INK}" stroke-width="1.2"/>
        <rect x="-2.5" y="-4" width="6" height="18" fill="#212529" stroke="${INK}" stroke-width="1.5"/></g>${hand}`;
    case 'espada laser':
      return `<g transform="translate(${hx} ${hy}) rotate(12)">
        <rect x="-4.5" y="-88" width="9" height="82" rx="4.5" fill="#19f0ff" opacity=".35"/>
        <rect x="-2" y="-86" width="4" height="80" rx="2" fill="#e3fdff"/>
        <rect x="-3.5" y="-8" width="7" height="22" rx="2" fill="#adb5bd" stroke="${INK}" stroke-width="1.5"/>
        <path d="M-3.5 0 h7 M-3.5 4 h7" stroke="${INK}" stroke-width="1.2"/></g>${hand}`;
    case 'varinha':
      return `<g transform="translate(${hx} ${hy}) rotate(28)">
        <path d="M-1.8 4 L-1.2 -40 L1.2 -40 L1.8 4 Z" fill="#6b4220" stroke="${INK}" stroke-width="1.5"/></g>
        ${sparkle(hx + 20, hy - 39, 7, '#ffd43b')}${hand}`;
    case 'onigiri':
      return `<g transform="translate(${hx} ${hy - 12})">
        <path d="M0 -13 Q3 -13 12 4 Q14 9 9 9 H-9 Q-14 9 -12 4 Q-3 -13 0 -13 Z" fill="#f8f9fa" stroke="${INK}" stroke-width="2"/>
        <rect x="-6" y="0" width="12" height="9" fill="#1b3a1f"/></g>${hand}`;
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
  'cogumelo gigante': {
    back: '',
    front: `<path d="M50 176 Q46 206 56 206 H104 Q114 206 110 176 Z" fill="#f1e3c6" stroke="${INK}" stroke-width="3"/>
      <path d="M6 178 Q10 140 80 140 Q150 140 154 178 Q80 190 6 178 Z" fill="#e03131" stroke="${INK}" stroke-width="3"/>
      ${[[34, 160, 9], [80, 151, 10], [124, 158, 8], [58, 174, 5], [104, 174, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f8f9fa"/>`).join('')}`,
  },
  'amplificador': {
    back: `<rect x="32" y="62" width="96" height="92" rx="5" fill="#1d1b20" stroke="${INK}" stroke-width="3"/>
      <rect x="40" y="70" width="80" height="10" fill="#c9a227" opacity=".8"/>`,
    front: `<rect x="14" y="150" width="132" height="56" rx="5" fill="#1d1b20" stroke="${INK}" stroke-width="3"/>
      <rect x="22" y="158" width="116" height="34" rx="3" fill="#3a363d"/>
      <path d="M22 164 H138 M22 170 H138 M22 176 H138 M22 182 H138 M22 188 H138" stroke="#1d1b20" stroke-width="2"/>
      ${[40, 60, 80, 100, 120].map((x) => `<circle cx="${x}" cy="199" r="3" fill="#c9a227"/>`).join('')}`,
  },
  'poltrona de cinema': {
    back: `<path d="M30 154 L28 64 Q80 50 132 64 L130 154 Z" fill="#a51111" stroke="${INK}" stroke-width="3"/>
      <path d="M50 70 V150 M80 64 V150 M110 70 V150" stroke="#7d0b0b" stroke-width="3"/>`,
    front: `<rect x="22" y="150" width="116" height="24" rx="8" fill="#c92a2a" stroke="${INK}" stroke-width="3"/>
      <rect x="4" y="128" width="24" height="46" rx="6" fill="#7d0b0b" stroke="${INK}" stroke-width="3"/>
      <rect x="132" y="128" width="24" height="46" rx="6" fill="#7d0b0b" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="144" cy="129" rx="9" ry="3.5" fill="#111" stroke="${INK}" stroke-width="2"/>
      <rect x="26" y="174" width="108" height="30" fill="#2b2b2b" stroke="${INK}" stroke-width="3"/>`,
  },
  'cadeira de diretor': {
    back: `<path d="M34 60 V154 M126 60 V154" stroke="#8a5a26" stroke-width="7" stroke-linecap="round"/>
      <rect x="30" y="62" width="100" height="28" fill="#212529" stroke="${INK}" stroke-width="3"/>`,
    front: `<path d="M14 130 H40 M120 130 H146" stroke="#8a5a26" stroke-width="6" stroke-linecap="round"/>
      <path d="M30 164 L130 204 M130 164 L30 204 M30 204 H130" stroke="#8a5a26" stroke-width="7" stroke-linecap="round"/>
      <rect x="24" y="148" width="112" height="14" fill="#212529" stroke="${INK}" stroke-width="3"/>`,
  },
  'trono de espadas': {
    back: `<path d="M24 154 L28 70 Q80 50 132 70 L136 154 Z" fill="#343a40" stroke="${INK}" stroke-width="3"/>
      ${range(14, 146, 11).map((x, i) => {
        const top = 8 + Math.abs(x - 80) * 0.45 + (i % 3) * 9;
        return `<path d="M${x - 3} 154 L${x - 3} ${top + 10} L${x} ${top} L${x + 3} ${top + 10} L${x + 3} 154 Z" fill="#868e96" stroke="${INK}" stroke-width="1.5"/>`;
      }).join('')}`,
    front: `<path d="M2 132 H40 M120 132 H158" stroke="#adb5bd" stroke-width="6"/>
      <path d="M8 124 V140 M152 124 V140" stroke="#495057" stroke-width="5" stroke-linecap="round"/>
      <rect x="20" y="150" width="120" height="20" rx="4" fill="#495057" stroke="${INK}" stroke-width="3"/>
      <rect x="10" y="170" width="140" height="34" fill="#343a40" stroke="${INK}" stroke-width="3"/>`,
  },
};

// ---------- Skin premium ----------
// Fantasia completa: troca corpo, cabeça, roupa, item e cadeira de uma vez.
// Só o id viaja (campo costume); o desenho é sempre o daqui. Os demais campos
// do boneco continuam salvos por baixo, e quem está sem fantasia volta a eles.
// look: campos do boneco trocados pela fantasia. head: cabeça inteira, com as
// duas bocas. over: por cima do tronco, fora do recorte. prop: item na mão.
const skinHead = (fill) => `<ellipse cx="80" cy="66" rx="43" ry="37" fill="${fill}" stroke="${INK}" stroke-width="3"/>`;
const skinMouths = (closed, open) => `<g class="m-closed">${closed}</g><g class="m-open">${open}</g>`;
const skinKnife = (x, y, rot = 8, len = 44) => `<g transform="translate(${x} ${y}) rotate(${rot})">
  <path d="M-3 -6 V${-len} Q5 ${-len + 8} 5 -6 Z" fill="#dee2e6" stroke="${INK}" stroke-width="1.8"/>
  <rect x="-5" y="-7" width="12" height="3.5" fill="#495057" stroke="${INK}" stroke-width="1"/>
  <rect x="-3" y="-4" width="7" height="17" rx="1.5" fill="#212529" stroke="${INK}" stroke-width="1.5"/></g>`;
const skinHand = (a) => {
  const [hx, hy, hr] = bodyOf(a).hands[1];
  return `<circle cx="${hx}" cy="${hy}" r="${hr}" fill="${a.topColor}" stroke="${INK}" stroke-width="2.5"/>`;
};
const skinStitches = (x1, y1, x2, y2, n = 3) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const [nx, ny] = [(-dy / len) * 3.5, (dx / len) * 3.5];
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${INK}" stroke-width="1.8"/>`
    + range(1, n, 1).map((i) => {
      const [cx, cy] = [x1 + (dx * i) / (n + 1), y1 + (dy * i) / (n + 1)];
      return `<path d="M${(cx + nx).toFixed(1)} ${(cy + ny).toFixed(1)} L${(cx - nx).toFixed(1)} ${(cy - ny).toFixed(1)}" stroke="${INK}" stroke-width="1.6"/>`;
    }).join('');
};
const skinPumpkin = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-3 -16 Q-2 -22 4 -23 L5 -18 Q2 -17 3 -14 Z" fill="#2f6b3a" stroke="${INK}" stroke-width="1.5"/>
  <ellipse cx="0" cy="0" rx="20" ry="16" fill="#e8590c" stroke="${INK}" stroke-width="2.5"/>
  <path d="M-8 -14 Q-14 0 -8 14 M8 -14 Q14 0 8 14" fill="none" stroke="#a63a04" stroke-width="2"/>
  <path d="M-11 -5 l5 -3 1 6 Z M11 -5 l-5 -3 -1 6 Z" fill="#ffd43b" stroke="${INK}" stroke-width="1"/>
  <path d="M-11 5 l4 2 2 -2 3 3 2 -3 3 3 2 -3 3 2 2 -2 Q0 15 -11 5 Z" fill="#ffd43b" stroke="${INK}" stroke-width="1"/></g>`;

const PREMIUM_SKINS = {
  jason: {
    look: { body: 'fortão', skin: '#a59378', topColor: '#6f6250', pants: '#2b2b2b' },
    head: () => `${skinHead('#a59378')}
      <path d="M46 44 Q44 30 62 26 L60 34 L72 25 L72 33 L88 24 L88 32 L104 27 L102 35 L116 40 Q100 28 80 28 Q60 28 46 44 Z" fill="#3b3226" stroke="${INK}" stroke-width="1.5"/>
      <path d="M46 48 Q48 29 80 29 Q112 29 114 48 Q118 84 97 99 Q80 108 63 99 Q42 84 46 48 Z" fill="#efe8d4" stroke="${INK}" stroke-width="3"/>
      <path d="M80 35 L90 46 L80 42 L70 46 Z M49 57 L60 54 L53 67 Z M111 57 L100 54 L107 67 Z" fill="#d1001f" stroke="${INK}" stroke-width="1"/>
      <path d="M57 57 Q67 51 75 58 Q70 70 60 67 Q55 63 57 57 Z M103 57 Q93 51 85 58 Q90 70 100 67 Q105 63 103 57 Z" fill="#14110f" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="66" cy="61" r="2" fill="#ffe066"/><circle cx="94" cy="61" r="2" fill="#ffe066"/>
      ${[[64, 76], [72, 79], [80, 80], [88, 79], [96, 76], [68, 86], [76, 88], [84, 88], [92, 86], [72, 95], [80, 97], [88, 95], [80, 50], [70, 44], [90, 44]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#14110f"/>`).join('')}
      <path d="M92 32 L88 42 L94 48" fill="none" stroke="#8a8069" stroke-width="1.5"/>
      ${skinMouths('', '<ellipse cx="80" cy="88" rx="8" ry="4" fill="#14110f"/>')}`,
    kit: {
      main: '#3f4a35',
      draw: (a, t) => area('#3f4a35') + `<path d="M0 ${t + 24} L46 ${t + 34} L38 180 H0 Z" fill="#333c2b"/>
        <path d="M80 ${t + 2} V150" stroke="#23291d" stroke-width="3"/>
        <path d="M108 ${t + 16} l8 12 -7 7 9 13 M56 ${t + 26} l-7 10 6 6" fill="none" stroke="#23291d" stroke-width="2.5"/>`,
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx} ${hy}) rotate(10)">
        <path d="M-4 -8 V-80 Q2 -92 12 -82 L9 -8 Z" fill="#adb5bd" stroke="${INK}" stroke-width="2"/>
        <path d="M6 -70 l-3 12 3 8 -2 14" fill="none" stroke="#c92a2a" stroke-width="2"/>
        <rect x="-5" y="-8" width="14" height="24" rx="2" fill="#3b2414" stroke="${INK}" stroke-width="2"/></g>${skinHand(a)}`;
    },
    chair: {
      back: `<rect x="124" y="26" width="7" height="128" fill="#6b4220" stroke="${INK}" stroke-width="2"/>
        <rect x="104" y="30" width="48" height="26" fill="#a9743c" stroke="${INK}" stroke-width="2.5" transform="rotate(-6 128 43)"/>
        <text x="128" y="49" text-anchor="middle" font-family="Permanent Marker" font-size="13" fill="#d1001f" transform="rotate(-6 128 43)">LAGO</text>`,
      front: `<path d="M18 156 Q16 204 22 206 H138 Q144 204 142 156 Z" fill="#6b4220" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="80" cy="156" rx="62" ry="10" fill="#c49a6c" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="80" cy="156" rx="40" ry="6" fill="none" stroke="#8a5a26" stroke-width="1.5"/>
        <path d="M38 172 V200 M62 176 V204 M98 176 V204 M122 172 V200" stroke="#3b2414" stroke-width="2"/>`,
    },
  },

  myers: {
    look: { body: 'padrão', skin: '#e4dfd2', topColor: '#d9d3c5', pants: '#25344a' },
    head: () => `<path d="M38 72 Q26 26 80 22 Q134 26 122 72 L112 62 Q80 54 48 62 Z" fill="#2f2720" stroke="${INK}" stroke-width="3"/>
      ${skinHead('#e4dfd2')}
      <path d="M40 58 Q38 26 80 25 Q122 26 120 58 L110 42 L104 52 L94 38 L86 50 L76 38 L68 52 L56 40 L52 52 Z" fill="#2f2720" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="66" cy="65" rx="10" ry="7" fill="#0b0a0c"/><ellipse cx="94" cy="65" rx="10" ry="7" fill="#0b0a0c"/>
      <path d="M80 66 L76 78 H84" fill="none" stroke="#a7a093" stroke-width="2"/>
      ${skinMouths('<path d="M69 88 Q80 86 91 88" fill="none" stroke="#6d675c" stroke-width="2.5" stroke-linecap="round"/>',
        '<path d="M70 86 Q80 83 90 86 Q86 94 80 94 Q74 94 70 86 Z" fill="#0b0a0c"/>')}`,
    kit: {
      main: '#25344a',
      draw: (a, t) => area('#25344a') + `<path d="M80 ${t} V180" stroke="#adb5bd" stroke-width="3" stroke-dasharray="3 2"/>
        <path d="M60 ${t} L68 ${t + 18} L80 ${t + 6} L92 ${t + 18} L100 ${t} Z" fill="#2f4260" stroke="${INK}" stroke-width="1.5"/>
        <rect x="52" y="${t + 26}" width="18" height="12" fill="#2f4260" stroke="${INK}" stroke-width="1.2"/>
        <rect x="90" y="${t + 26}" width="18" height="12" fill="#2f4260" stroke="${INK}" stroke-width="1.2"/>`,
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `${skinKnife(hx, hy, 8, 58)}${skinHand(a)}`;
    },
    chair: {
      back: `<rect x="6" y="80" width="148" height="72" fill="#3a2e38" stroke="${INK}" stroke-width="3"/>
        <path d="M6 98 H154 M6 116 H154 M6 134 H154" stroke="#251d24" stroke-width="2"/>
        <rect x="118" y="54" width="10" height="100" fill="#6d5a5a" stroke="${INK}" stroke-width="2"/>
        <rect x="30" y="54" width="10" height="100" fill="#6d5a5a" stroke="${INK}" stroke-width="2"/>`,
      front: `<rect x="14" y="150" width="132" height="18" fill="#7a6a5e" stroke="${INK}" stroke-width="3"/>
        <rect x="4" y="168" width="152" height="18" fill="#6a5b50" stroke="${INK}" stroke-width="3"/>
        <rect x="0" y="186" width="160" height="20" fill="#5a4c42" stroke="${INK}" stroke-width="3"/>
        ${skinPumpkin(30, 174, 0.8)}`,
    },
  },

  freddy: {
    look: { body: 'padrão', skin: '#b5573f', topColor: '#b5573f', pants: '#3b2a1a' },
    head: () => `${skinHead('#b5573f')}
      <path d="M50 62 Q60 56 70 66 M88 60 Q100 52 112 66 M48 84 Q58 78 66 92 M100 84 Q108 82 112 76 M58 42 Q70 50 84 42 M90 46 Q98 52 106 46"
        fill="none" stroke="#7d2e1c" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M62 74 Q68 70 72 78 M94 78 Q100 74 104 82 M76 50 l6 8" fill="none" stroke="#e8967f" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M46 44 Q50 12 80 14 Q110 12 114 44 Z" fill="#6b4220" stroke="${INK}" stroke-width="3"/>
      <rect x="46" y="34" width="68" height="9" fill="#3b2414"/>
      <path d="M24 46 Q50 34 80 38 Q110 34 136 46 Q112 52 80 50 Q48 52 24 46 Z" fill="#6b4220" stroke="${INK}" stroke-width="3"/>
      <circle cx="66" cy="66" r="9" fill="#f8f3df" stroke="${INK}" stroke-width="2"/><circle cx="94" cy="66" r="9" fill="#f8f3df" stroke="${INK}" stroke-width="2"/>
      <circle cx="69" cy="67" r="2.6" fill="${INK}"/><circle cx="91" cy="67" r="2.6" fill="${INK}"/>
      <path d="M56 54 L76 60 M104 54 L84 60" stroke="#6b2415" stroke-width="4.5" stroke-linecap="round"/>
      ${skinMouths(`<path d="M62 84 Q80 98 98 84 Q80 88 62 84 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2"/>
        <path d="M68 86 l3 4 3 -3 3 4 3 -3 3 4 3 -3 3 3 3 -4" fill="none" stroke="#ffec99" stroke-width="2"/>`,
        `<path d="M62 80 Q80 112 98 80 Q80 86 62 80 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2.5"/>
        <path d="M66 82 l3 5 3 -4 3 5 3 -4 3 5 3 -4 3 5 3 -4 3 4" fill="none" stroke="#ffec99" stroke-width="2"/>`)}`,
    kit: {
      main: '#b3122a',
      draw: () => area('#b3122a') + hBars(90, 176, 16, 8, '#2f6b3a'),
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx} ${hy})">
        ${[-9, -3, 3, 9].map((x, i) => `<path d="M${x} -6 Q${x + i * 2 - 3} -24 ${x + i * 4 - 7} -44 Q${x + i * 3 - 1} -24 ${x + 3} -6 Z" fill="#e9ecef" stroke="${INK}" stroke-width="1.5"/>`).join('')}
        <circle r="11" fill="#6b4220" stroke="${INK}" stroke-width="2.5"/>
        <path d="M-8 -4 H8 M-8 2 H8" stroke="#adb5bd" stroke-width="2"/></g>`;
    },
    chair: {
      back: `<rect x="22" y="60" width="116" height="94" rx="6" fill="#343a40" stroke="${INK}" stroke-width="3"/>
        <path d="M44 34 V62 M116 22 V62" stroke="#495057" stroke-width="12"/>
        <path d="M44 34 V62 M116 22 V62" stroke="${INK}" stroke-width="1.5" stroke-dasharray="2 6"/>
        ${[[34, 70], [126, 70], [34, 142], [126, 142]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#868e96"/>`).join('')}`,
      front: `<rect x="14" y="150" width="132" height="56" rx="4" fill="#212529" stroke="${INK}" stroke-width="3"/>
        <rect x="30" y="162" width="100" height="36" rx="3" fill="#0b0a0c" stroke="#495057" stroke-width="3"/>
        ${range(38, 122, 12).map((x, i) => `<path d="M${x} 197 Q${x - 4} ${186 - (i % 3) * 5} ${x + 2} ${176 - (i % 2) * 6} Q${x + 8} 186 ${x + 7} 197 Z" fill="${i % 2 ? '#ff6b00' : '#ffd43b'}"/>`).join('')}
        <path d="M30 162 h100 M42 162 V198 M62 162 V198 M80 162 V198 M98 162 V198 M118 162 V198" stroke="#495057" stroke-width="3" fill="none"/>`,
    },
  },

  leatherface: {
    look: { body: 'gordinho', skin: '#c9a06e', topColor: '#c9a06e', pants: '#4a3b2c' },
    head: () => `<path d="M42 56 L36 40 L50 42 L48 28 L62 34 L66 20 L78 30 L88 18 L96 32 L110 24 L110 40 L126 38 L118 56 Z" fill="#3b2a1a" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      ${skinHead('#c9a06e')}
      <path d="M50 42 L78 36 L82 62 L50 66 Z" fill="#d9b483" stroke="${INK}" stroke-width="1"/>
      <path d="M84 40 L112 46 L110 74 L88 70 Z" fill="#b98c58" stroke="${INK}" stroke-width="1"/>
      <path d="M56 72 L80 74 L82 98 L60 94 Z" fill="#b98c58" stroke="${INK}" stroke-width="1"/>
      ${skinStitches(50, 42, 78, 36)}${skinStitches(84, 40, 112, 46)}${skinStitches(80, 36, 82, 72, 4)}${skinStitches(56, 72, 42, 66, 2)}${skinStitches(88, 72, 110, 76)}
      <ellipse cx="66" cy="58" rx="9" ry="7" fill="#14110f"/><ellipse cx="96" cy="58" rx="9" ry="7" fill="#14110f"/>
      <circle cx="67" cy="59" r="1.8" fill="#f1f3f5"/><circle cx="95" cy="59" r="1.8" fill="#f1f3f5"/>
      ${skinMouths(`<path d="M62 84 Q80 78 98 84 Q80 92 62 84 Z" fill="#3b1a10" stroke="${INK}" stroke-width="2"/>
        <path d="M66 84 V88 M72 83 V89 M78 82 V90 M84 82 V90 M90 83 V89 M95 84 V87" stroke="#d9c98a" stroke-width="2.5"/>`,
        `<path d="M60 80 Q80 74 100 80 Q92 106 80 106 Q68 106 60 80 Z" fill="#3b1a10" stroke="${INK}" stroke-width="2.5"/>
        <path d="M65 80 V86 M72 78 V86 M79 77 V85 M86 78 V86 M94 80 V86" stroke="#d9c98a" stroke-width="3"/>`)}`,
    kit: {
      main: '#7a5230',
      draw: (a, t) => area('#f1f3f5') + `<path d="M36 ${t + 8} L124 ${t + 8} L136 180 H24 Z" fill="#7a5230"/>
        <path d="M60 ${t - 2} L54 ${t + 8} M100 ${t - 2} L106 ${t + 8}" stroke="#5c3d22" stroke-width="5"/>
        <path d="M70 ${t} L80 ${t + 10} L90 ${t} Z" fill="#212529"/>
        <path d="M76 ${t + 10} L84 ${t + 10} L86 ${t + 28} L80 ${t + 34} L74 ${t + 28} Z" fill="#212529"/>
        ${[[56, t + 26, 7], [104, t + 38, 9], [72, t + 50, 5], [120, t + 20, 4], [40, t + 44, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#7d0b0b"/>`).join('')}
        <path d="M104 ${t + 42} v16 M56 ${t + 30} v12" stroke="#7d0b0b" stroke-width="3"/>`,
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx - 2} ${hy - 4}) rotate(-8)">
        <path d="M-8 -22 V-96 Q0 -108 8 -96 V-22 Z" fill="#adb5bd" stroke="${INK}" stroke-width="2.5"/>
        <path d="M-8 -30 l-5 -5 5 -3 -5 -5 5 -3 -5 -5 5 -3 -5 -5 5 -3 -5 -5 5 -3 -5 -5 5 -3 M8 -30 l5 -5 -5 -3 5 -5 -5 -3 5 -5 -5 -3 5 -5 -5 -3 5 -5 -5 -3 5 -5 -5 -3" fill="none" stroke="${INK}" stroke-width="1.8"/>
        <rect x="-16" y="-24" width="32" height="26" rx="4" fill="#e8590c" stroke="${INK}" stroke-width="2.5"/>
        <rect x="-10" y="-18" width="20" height="5" fill="#212529"/><path d="M-10 -8 h20" stroke="${INK}" stroke-width="2"/></g>${skinHand(a)}`;
    },
    chair: {
      back: `<path d="M24 154 V70 Q24 56 34 56 Q44 56 44 70 V154 Z M116 154 V70 Q116 56 126 56 Q136 56 136 70 V154 Z" fill="#e9dcc0" stroke="${INK}" stroke-width="3"/>
        <path d="M44 84 Q80 76 116 84 M44 104 Q80 96 116 104 M44 124 Q80 116 116 124" fill="none" stroke="#e9dcc0" stroke-width="7"/>
        <path d="M44 84 Q80 76 116 84 M44 104 Q80 96 116 104 M44 124 Q80 116 116 124" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="3 5"/>
        <circle cx="34" cy="60" r="11" fill="#e9dcc0" stroke="${INK}" stroke-width="2.5"/><circle cx="126" cy="60" r="11" fill="#e9dcc0" stroke="${INK}" stroke-width="2.5"/>
        <circle cx="30" cy="59" r="2.6" fill="${INK}"/><circle cx="38" cy="59" r="2.6" fill="${INK}"/><circle cx="122" cy="59" r="2.6" fill="${INK}"/><circle cx="130" cy="59" r="2.6" fill="${INK}"/>`,
      front: `<rect x="12" y="150" width="136" height="20" fill="#a9743c" stroke="${INK}" stroke-width="3"/>
        <path d="M24 158 l8 3 M60 156 l14 6 M108 160 l10 -3" stroke="#7d0b0b" stroke-width="4" stroke-linecap="round"/>
        <rect x="22" y="170" width="20" height="36" fill="#6b4220" stroke="${INK}" stroke-width="3"/>
        <rect x="118" y="170" width="20" height="36" fill="#6b4220" stroke="${INK}" stroke-width="3"/>`,
    },
  },

  ghostface: {
    look: { body: 'padrão', skin: '#f4f1e8', topColor: '#111', pants: '#111', chair: 'poltrona de cinema' },
    head: () => `<path d="M28 100 Q18 16 80 14 Q142 16 132 100 Q128 110 112 104 L48 104 Q32 110 28 100 Z" fill="#14131a" stroke="${INK}" stroke-width="3"/>
      <path d="M50 44 Q54 24 80 24 Q106 24 110 44 Q116 78 96 102 Q88 112 80 112 Q72 112 64 102 Q44 78 50 44 Z" fill="#f4f1e8" stroke="${INK}" stroke-width="2.5"/>
      <path d="M60 48 Q72 40 76 56 Q78 72 66 78 Q54 68 60 48 Z M100 48 Q88 40 84 56 Q82 72 94 78 Q106 68 100 48 Z" fill="#0b0a0c"/>
      <path d="M78 74 L80 80 L82 74" fill="none" stroke="#0b0a0c" stroke-width="2"/>
      ${skinMouths('<path d="M73 86 Q80 82 87 86 Q90 98 80 106 Q70 98 73 86 Z" fill="#0b0a0c"/>',
        '<path d="M71 84 Q80 79 89 84 Q93 100 80 110 Q67 100 71 84 Z" fill="#0b0a0c"/>')}`,
    kit: {
      main: '#111',
      draw: (a, t) => area('#14131a') + `<path d="M80 ${t + 4} V180 M56 ${t + 20} L48 180 M104 ${t + 20} L112 180" stroke="#2b2a33" stroke-width="3"/>`,
    },
    over: () => `<path d="M30 108 L20 150 L32 142 L36 156 L46 146 V110 Z M130 108 L140 150 L128 142 L124 156 L114 146 V110 Z" fill="#14131a" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `${skinKnife(hx, hy, 10, 60)}<circle cx="${hx}" cy="${hy}" r="10" fill="#111" stroke="#495057" stroke-width="2"/>`;
    },
  },

  chucky: {
    look: { body: 'baixinho', skin: '#f5d0b0', topColor: '#f5d0b0', pants: '#1c5fd1' },
    head: () => `<path d="M38 60 Q24 30 44 26 L46 12 L58 22 L66 4 L74 20 L86 2 L92 20 L108 8 L108 24 L126 26 Q134 44 122 60 Z" fill="#e8590c" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      ${skinHead('#f5d0b0')}
      <path d="M40 54 Q50 34 80 34 Q110 34 120 54 L106 44 L96 52 L84 42 L74 52 L62 42 L52 54 Z" fill="#e8590c" stroke="${INK}" stroke-width="2"/>
      ${[[48, 80], [54, 84], [58, 78], [102, 78], [106, 84], [112, 80]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#a0522d"/>`).join('')}
      ${skinStitches(92, 76, 112, 58, 3)}${skinStitches(48, 58, 62, 48, 2)}
      <circle cx="66" cy="64" r="11" fill="#fff" stroke="${INK}" stroke-width="2"/><circle cx="94" cy="64" r="11" fill="#fff" stroke="${INK}" stroke-width="2"/>
      <circle cx="69" cy="66" r="5" fill="#1c7ed6"/><circle cx="91" cy="66" r="5" fill="#1c7ed6"/>
      <circle cx="69" cy="66" r="2.4" fill="${INK}"/><circle cx="91" cy="66" r="2.4" fill="${INK}"/>
      <path d="M52 50 L78 60 M108 50 L82 60" stroke="#b5400b" stroke-width="5" stroke-linecap="round"/>
      ${skinMouths(`<path d="M64 84 Q80 96 96 82 Q80 88 64 84 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2"/>
        <path d="M70 87 l2 3 2 -2 3 3 2 -2 3 3 2 -3 3 2 2 -3" fill="none" stroke="#fff" stroke-width="1.6"/>`,
        `<path d="M62 80 Q80 112 98 78 Q80 86 62 80 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2.5"/>
        <path d="M66 82 l3 4 3 -3 3 4 3 -3 3 4 3 -3 3 4 3 -4 3 3" fill="none" stroke="#fff" stroke-width="2"/>`)}`,
    kit: {
      main: '#1c5fd1',
      draw: (a, t) => area('#f8f9fa') + hBars(t, t + 40, 7, 3.5, '#e03131') + hBars(t, t + 40, 14, 3.5, '#2f9e44')
        + `<rect x="56" y="${t + 8}" width="48" height="60" fill="#1c5fd1" stroke="${INK}" stroke-width="1.5"/>
        <path d="M58 ${t + 8} L52 ${t - 2} M102 ${t + 8} L108 ${t - 2}" stroke="#1c5fd1" stroke-width="7"/>
        <circle cx="62" cy="${t + 12}" r="2.4" fill="#ffd43b"/><circle cx="98" cy="${t + 12}" r="2.4" fill="#ffd43b"/>
        <rect x="70" y="${t + 16}" width="20" height="11" fill="#2f6dc2" stroke="${INK}" stroke-width="1"/>`,
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `${skinKnife(hx, hy, 12, 40)}${skinHand(a)}`;
    },
    chair: {
      back: `<rect x="26" y="96" width="108" height="58" fill="#ffd43b" stroke="${INK}" stroke-width="3"/>
        <path d="M26 96 L14 76 L80 72 L146 76 L134 96" fill="#e03131" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      front: `<rect x="12" y="148" width="136" height="58" rx="3" fill="#ffd43b" stroke="${INK}" stroke-width="3"/>
        <path d="M12 148 h136 v14 H12 Z" fill="#e03131" stroke="${INK}" stroke-width="3"/>
        ${[[34, '#1c7ed6', 'B'], [80, '#2f9e44', 'U'], [126, '#e03131', 'H']].map(([x, c, l]) => `<rect x="${x - 14}" y="168" width="28" height="30" rx="3" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
          <text x="${x}" y="191" text-anchor="middle" font-family="Permanent Marker" font-size="22" fill="#fff">${l}</text>`).join('')}`,
    },
  },

  art: {
    look: { body: 'magrelo', skin: '#f4f4f4', topColor: '#f4f4f4', pants: '#111' },
    head: () => `${skinHead('#f4f4f4')}
      <path d="M66 36 L80 2 L94 36 Z" fill="#111" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="80" cy="4" r="5" fill="#f4f4f4" stroke="${INK}" stroke-width="2"/>
      <path d="M52 66 Q56 44 72 54 Q80 62 74 72 Q62 80 52 66 Z M108 66 Q104 44 88 54 Q80 62 86 72 Q98 80 108 66 Z" fill="#111"/>
      <circle cx="66" cy="64" r="4" fill="#f4f4f4"/><circle cx="94" cy="64" r="4" fill="#f4f4f4"/>
      <circle cx="67" cy="65" r="1.8" fill="#111"/><circle cx="93" cy="65" r="1.8" fill="#111"/>
      <path d="M74 74 Q80 70 86 74 Q87 80 80 81 Q73 80 74 74 Z" fill="#111"/>
      ${skinMouths(`<path d="M52 84 Q80 106 108 84 Q80 92 52 84 Z" fill="#111" stroke="${INK}" stroke-width="2"/>
        <path d="M64 89 V94 M72 90 V97 M80 90 V98 M88 90 V97 M96 89 V94" stroke="#d9c98a" stroke-width="3"/>`,
        `<path d="M50 80 Q80 124 110 80 Q80 90 50 80 Z" fill="#111" stroke="${INK}" stroke-width="2.5"/>
        <path d="M60 84 V92 M68 86 V96 M76 87 V94 M86 87 V98 M94 86 V94 M101 84 V90" stroke="#d9c98a" stroke-width="3"/>`)}`,
    kit: {
      main: '#111',
      draw: (a, t) => area('#f4f4f4') + '<rect x="80" y="80" width="80" height="100" fill="#111"/>'
        + [[72, t + 22], [72, t + 42]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#111"/>`).join('')
        + [[88, t + 22], [88, t + 42]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#f4f4f4"/>`).join(''),
    },
    over: (a, t) => `<path d="M52 ${t + 4} L58 ${t - 6} L64 ${t + 2} L70 ${t - 8} L76 ${t + 2} L84 ${t + 2} L90 ${t - 8} L96 ${t + 2} L102 ${t - 6} L108 ${t + 4} L96 ${t + 14} L80 ${t + 8} L64 ${t + 14} Z"
      fill="#f4f4f4" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx} ${hy}) rotate(12)">
        <path d="M-5 -6 H5 V-70 H-5 Z" fill="#adb5bd" stroke="${INK}" stroke-width="2"/>
        <path d="M-5 -14 l-5 -4 5 -4 -5 -4 5 -4 -5 -4 5 -4 -5 -4 5 -4 -5 -4 5 -4 -5 -4 5 -4" fill="none" stroke="${INK}" stroke-width="1.6"/>
        <path d="M5 -6 Q24 -6 24 -30 Q24 -56 5 -66" fill="none" stroke="#212529" stroke-width="4"/>
        <rect x="-5" y="-6" width="11" height="18" rx="2" fill="#212529"/></g>${skinHand(a)}`;
    },
    chair: {
      back: `<path d="M30 154 L22 96 Q24 66 44 74 Q52 54 76 66 Q104 52 116 74 Q138 70 138 96 L130 154 Z" fill="#212529" stroke="${INK}" stroke-width="3"/>
        <path d="M46 88 Q54 110 44 134 M112 90 Q104 112 114 136" fill="none" stroke="#495057" stroke-width="2.5"/>`,
      front: `<path d="M20 150 H140 L132 206 H28 Z" fill="#868e96" stroke="${INK}" stroke-width="3"/>
        <rect x="14" y="144" width="132" height="12" rx="4" fill="#adb5bd" stroke="${INK}" stroke-width="3"/>
        <path d="M46 160 L50 204 M80 160 V204 M114 160 L110 204" stroke="#495057" stroke-width="4"/>`,
    },
  },

  pinhead: {
    look: { body: 'magrelo', skin: '#cfc8c2', topColor: '#cfc8c2', pants: '#1b1a20' },
    head: () => {
      const pins = [];
      for (const y of [38, 50, 62, 74, 86, 98]) {
        for (const x of [44, 56, 68, 80, 92, 104, 116]) {
          const inHead = ((x - 80) / 43) ** 2 + ((y - 66) / 37) ** 2 < 0.92;
          const onFace = (y > 54 && y < 74 && x > 54 && x < 106) || (y > 76 && x > 62 && x < 98);
          if (inHead && !onFace) pins.push([x, y]);
        }
      }
      return `${skinHead('#cfc8c2')}
        <path d="M44 38 H116 M38 50 H122 M37 62 H123 M38 74 H122 M43 86 H117 M56 98 H104 M56 32 V100 M68 30 V102 M80 29 V103 M92 30 V102 M104 32 V100 M44 42 V90 M116 42 V90" stroke="#9a4a4a" stroke-width="1.4"/>
        ${pins.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="#e9ecef" stroke="${INK}" stroke-width="1"/>`).join('')}
        <ellipse cx="68" cy="64" rx="7" ry="5" fill="#0b0a0c"/><ellipse cx="92" cy="64" rx="7" ry="5" fill="#0b0a0c"/>
        <circle cx="68" cy="64" r="1.6" fill="#c7d9e8"/><circle cx="92" cy="64" r="1.6" fill="#c7d9e8"/>
        ${skinMouths('<path d="M71 88 H89" stroke="#5c2a2a" stroke-width="3" stroke-linecap="round"/>',
          '<path d="M70 85 Q80 82 90 85 Q88 96 80 96 Q72 96 70 85 Z" fill="#160a0c" stroke="#5c2a2a" stroke-width="2"/>')}`;
    },
    kit: {
      main: '#1b1a20',
      draw: (a, t) => area('#1b1a20') + `<path d="M72 ${t} L68 ${t + 40} L80 ${t + 56} L92 ${t + 40} L88 ${t} Z" fill="#cfc8c2"/>
        <path d="M68 ${t + 12} L92 ${t + 12} M68 ${t + 26} L92 ${t + 26} M70 ${t + 40} L90 ${t + 40}" stroke="#7d2e2e" stroke-width="2"/>
        <path d="M64 ${t} V150 M96 ${t} V150" stroke="#495057" stroke-width="2.5"/>
        ${[t + 6, t + 18, t + 30, t + 42].map((y) => `<circle cx="64" cy="${y}" r="2" fill="#adb5bd"/><circle cx="96" cy="${y}" r="2" fill="#adb5bd"/>`).join('')}`,
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx} ${hy - 16}) rotate(14)">
        <rect x="-13" y="-13" width="26" height="26" fill="#c9a227" stroke="${INK}" stroke-width="2.5"/>
        <path d="M-13 0 H13 M0 -13 V13 M-13 -13 L13 13 M13 -13 L-13 13" stroke="#6b5310" stroke-width="1.5"/>
        <circle r="5" fill="#111" stroke="#6b5310" stroke-width="1.5"/></g>${skinHand(a)}`;
    },
    chair: {
      back: `<path d="M18 154 V22 L38 34 L58 10 L80 26 L102 10 L122 34 L142 22 V154 Z" fill="#1b1a20" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        ${[[30, 44], [130, 44], [30, 90], [130, 90]].map(([x, y]) => `<path d="M${x} ${y} v40" stroke="#868e96" stroke-width="5" stroke-dasharray="6 3"/><path d="M${x} ${y + 40} q7 8 0 12 q-5 0 -5 -4" fill="none" stroke="#dee2e6" stroke-width="2.5"/>`).join('')}`,
      front: `<rect x="18" y="150" width="124" height="18" fill="#2b2a33" stroke="${INK}" stroke-width="3"/>
        <rect x="8" y="168" width="144" height="38" fill="#1b1a20" stroke="${INK}" stroke-width="3"/>
        <path d="M8 187 H152" stroke="#868e96" stroke-width="5" stroke-dasharray="7 3"/>`,
    },
  },

  pennywise: {
    look: { body: 'magrelo', skin: '#f8f6f0', topColor: '#ced4da', pants: '#ced4da' },
    head: () => `<path d="M42 54 Q14 42 20 18 Q36 20 48 40 Z M118 54 Q146 42 140 18 Q124 20 112 40 Z M40 62 Q18 62 12 46 Q28 42 44 52 Z M120 62 Q142 62 148 46 Q132 42 116 52 Z"
        fill="#e8400c" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M38 66 Q34 16 80 16 Q126 16 122 66 Q118 100 80 104 Q42 100 38 66 Z" fill="#f8f6f0" stroke="${INK}" stroke-width="3"/>
      <path d="M72 46 Q66 56 66 76 M88 46 Q94 56 94 76" stroke="#d1001f" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="64" cy="58" r="8" fill="#ffd43b" stroke="${INK}" stroke-width="2"/><circle cx="96" cy="58" r="8" fill="#ffd43b" stroke="${INK}" stroke-width="2"/>
      <circle cx="66" cy="60" r="2.4" fill="${INK}"/><circle cx="94" cy="60" r="2.4" fill="${INK}"/>
      <path d="M54 46 Q64 42 74 50 M106 46 Q96 42 86 50" fill="none" stroke="#868e96" stroke-width="3" stroke-linecap="round"/>
      <circle cx="80" cy="72" r="4" fill="#d1001f" stroke="${INK}" stroke-width="1.2"/>
      <path d="M50 74 Q54 94 80 96 Q106 94 110 74 Q104 82 92 84 L80 90 L68 84 Q56 82 50 74 Z" fill="#d1001f" opacity=".9"/>
      ${skinMouths(`<path d="M62 82 Q80 96 98 82 Q80 88 62 82 Z" fill="#3b0d14" stroke="${INK}" stroke-width="1.8"/>
        <path d="M76 88 l2 5 2 -5 M82 88 l2 5 2 -5" fill="#fff" stroke="${INK}" stroke-width="1"/>`,
        `<path d="M60 80 Q80 118 100 80 Q80 88 60 80 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2.5"/>
        <path d="M66 83 l3 8 3 -7 3 8 3 -7 3 8 3 -7 3 8 3 -7 3 6" fill="#f8f9fa" stroke="${INK}" stroke-width="1"/>`)}`,
    kit: {
      main: '#ced4da',
      draw: (a, t) => area('#ced4da') + vBars(6, 150, 18, 3, '#adb5bd') + `<circle cx="80" cy="${t + 24}" r="6" fill="#e8590c" stroke="${INK}" stroke-width="1.5"/>
        <circle cx="80" cy="${t + 42}" r="6" fill="#e8590c" stroke="${INK}" stroke-width="1.5"/>`,
    },
    over: (a, t) => `<path d="M42 ${t + 4} Q50 ${t - 12} 60 ${t + 2} Q70 ${t - 14} 80 ${t + 2} Q90 ${t - 14} 100 ${t + 2} Q110 ${t - 12} 118 ${t + 4} Q112 ${t + 16} 100 ${t + 10} Q90 ${t + 20} 80 ${t + 10} Q70 ${t + 20} 60 ${t + 10} Q48 ${t + 16} 42 ${t + 4} Z"
      fill="#f1f3f5" stroke="${INK}" stroke-width="2.5"/>`,
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<path d="M${hx} ${hy} Q${hx + 12} ${hy - 44} ${hx + 2} ${hy - 76}" fill="none" stroke="#f8f9fa" stroke-width="1.5"/>
        <path d="M${hx - 2} ${hy - 76} l4 0 l-2 -5 Z" fill="#d1001f" stroke="${INK}" stroke-width="1"/>
        <ellipse cx="${hx + 2}" cy="${hy - 98}" rx="18" ry="22" fill="#d1001f" stroke="${INK}" stroke-width="2.5"/>
        <ellipse cx="${hx - 5}" cy="${hy - 106}" rx="4" ry="6" fill="#fff" opacity=".6"/>${skinHand(a)}`;
    },
    chair: {
      back: `<rect x="4" y="74" width="152" height="80" rx="4" fill="#495057" stroke="${INK}" stroke-width="3"/>
        <path d="M4 100 H156 M4 128 H156 M40 74 V100 M112 74 V100 M72 100 V128 M136 100 V128 M28 128 V154 M100 128 V154" stroke="#343a40" stroke-width="2.5"/>`,
      front: `<rect x="2" y="150" width="156" height="14" fill="#868e96" stroke="${INK}" stroke-width="3"/>
        <path d="M18 164 H142 V206 H18 Z" fill="#0b0a0c" stroke="${INK}" stroke-width="3"/>
        <path d="M30 164 V206 M50 164 V206 M70 164 V206 M90 164 V206 M110 164 V206 M130 164 V206" stroke="#868e96" stroke-width="6"/>
        <path d="M18 186 H142" stroke="#868e96" stroke-width="4"/>`,
    },
  },

  dracula: {
    look: { body: 'padrão', skin: '#d8d4e4', topColor: '#d8d4e4', pants: '#111' },
    head: () => `${skinHead('#d8d4e4')}
      <path d="M37 66 Q32 22 80 22 Q128 22 123 66 Q116 44 96 40 L80 54 L64 40 Q44 44 37 66 Z" fill="#111" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="66" cy="66" r="8" fill="#fff" stroke="${INK}" stroke-width="2"/><circle cx="94" cy="66" r="8" fill="#fff" stroke="${INK}" stroke-width="2"/>
      <circle cx="68" cy="67" r="3.5" fill="#d1001f"/><circle cx="92" cy="67" r="3.5" fill="#d1001f"/>
      <path d="M54 58 L78 64 M106 58 L82 64" stroke="#111" stroke-width="4" stroke-linecap="round"/>
      <path d="M58 76 Q66 80 70 74 M102 76 Q94 80 90 74" fill="none" stroke="#a79fbd" stroke-width="2"/>
      ${skinMouths(`<path d="M68 86 Q80 92 92 86" fill="none" stroke="#6b1a2b" stroke-width="3" stroke-linecap="round"/>
        <path d="M71 88 L73.5 97 L76 89 Z M84 89 L86.5 97 L89 88 Z" fill="#fff" stroke="${INK}" stroke-width="1.2"/>`,
        `<path d="M64 82 Q80 112 96 82 Q80 88 64 82 Z" fill="#3b0d14" stroke="${INK}" stroke-width="2.5"/>
        <path d="M68 83 L71 96 L75 85 Z M85 85 L89 96 L92 83 Z" fill="#fff" stroke="${INK}" stroke-width="1.2"/>`)}`,
    kit: {
      main: '#111',
      draw: (a, t) => area('#111') + `<path d="M62 ${t - 2} L80 ${t + 48} L98 ${t - 2} Z" fill="#f8f9fa"/>
        <path d="M80 ${t + 8} l-9 -5 v10 Z M80 ${t + 8} l9 -5 v10 Z" fill="#a51111"/>
        <circle cx="80" cy="${t + 24}" r="5" fill="#ffd43b" stroke="#a51111" stroke-width="2.5"/>`,
    },
    over: () => `<path d="M46 98 L24 66 L18 104 L40 150 L60 150 L64 98 Z M114 98 L136 66 L142 104 L120 150 L100 150 L96 98 Z" fill="#a51111" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M46 98 L24 66 L18 104 L40 150 M114 98 L136 66 L142 104 L120 150" fill="none" stroke="#111" stroke-width="5" stroke-linejoin="round"/>`,
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx} ${hy - 22})">
        <path d="M-10 -14 Q-10 6 0 6 Q10 6 10 -14 Z" fill="#7d0b0b" stroke="${INK}" stroke-width="2"/>
        <path d="M-9 -7 Q0 -3 9 -7" fill="none" stroke="#c92a2a" stroke-width="2"/>
        <path d="M0 6 V20 M-7 21 H7" stroke="#adb5bd" stroke-width="3"/></g>${skinHand(a)}`;
    },
    chair: {
      back: `<path d="M50 -6 H110 L134 40 L122 154 H38 L26 40 Z" fill="#2b1a12" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        <path d="M56 2 H104 L124 42 L114 148 H46 L36 42 Z" fill="#7d0b0b" stroke="${INK}" stroke-width="2.5"/>`,
      front: `<rect x="18" y="150" width="124" height="20" rx="3" fill="#2b1a12" stroke="${INK}" stroke-width="3"/>
        <rect x="26" y="170" width="108" height="36" fill="#3b2414" stroke="${INK}" stroke-width="3"/>
        <path d="M80 174 V202 M70 184 H90" stroke="#ffd43b" stroke-width="4"/>`,
    },
  },

  frankenstein: {
    look: { body: 'fortão', skin: '#9ab973', topColor: '#9ab973', pants: '#2b2b2b' },
    head: () => `<path d="M26 74 h12 M122 74 h12" stroke="${INK}" stroke-width="8"/>
      <path d="M26 74 h12 M122 74 h12" stroke="#adb5bd" stroke-width="4"/>
      <path d="M38 66 V38 Q40 26 80 26 Q120 26 122 38 V66 Q122 102 80 104 Q38 102 38 66 Z" fill="#9ab973" stroke="${INK}" stroke-width="3"/>
      <path d="M36 42 V24 Q36 14 80 14 Q124 14 124 24 V42 L112 36 L104 44 L92 36 L84 44 L72 36 L62 44 L50 36 Z" fill="#17151c" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      ${skinStitches(60, 50, 100, 50, 5)}
      <path d="M50 58 H110" stroke="#4e6b33" stroke-width="7" stroke-linecap="round"/>
      <circle cx="66" cy="68" r="7" fill="#f1f3f5" stroke="${INK}" stroke-width="2"/><circle cx="94" cy="68" r="7" fill="#f1f3f5" stroke="${INK}" stroke-width="2"/>
      <circle cx="67" cy="69" r="2.4" fill="${INK}"/><circle cx="93" cy="69" r="2.4" fill="${INK}"/>
      <path d="M58 62 Q66 58 74 62 M86 62 Q94 58 102 62" fill="none" stroke="#6f8e4e" stroke-width="3"/>
      ${skinStitches(100, 74, 112, 92, 2)}
      ${skinMouths(`<path d="M64 90 H96" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
        <path d="M70 87 V93 M80 87 V93 M90 87 V93" stroke="${INK}" stroke-width="1.8"/>`,
        `<path d="M64 84 H96 Q94 100 80 100 Q66 100 64 84 Z" fill="#26120f" stroke="${INK}" stroke-width="2.5"/>
        <path d="M68 85 V91 M76 85 V91 M84 85 V91 M92 85 V91" stroke="#e9dcc0" stroke-width="3"/>`)}`,
    kit: {
      main: '#2b2b2b',
      draw: (a, t) => area('#2b2b2b') + `<path d="M56 ${t} L72 ${t + 50} H88 L104 ${t} Z" fill="#6c757d"/>
        <path d="M56 ${t} L72 ${t + 50} M104 ${t} L88 ${t + 50}" stroke="#111" stroke-width="3"/>
        <path d="M40 ${t + 30} l8 8 M116 ${t + 26} l-8 10 M34 ${t + 44} l10 2" stroke="#111" stroke-width="3"/>`,
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx} ${hy}) rotate(6)">
        <rect x="-3.5" y="-46" width="7" height="50" rx="2" fill="#6b4220" stroke="${INK}" stroke-width="2"/>
        <path d="M-12 -46 Q-16 -62 -6 -70 Q-4 -60 0 -78 Q6 -66 8 -72 Q18 -60 12 -46 Z" fill="#ff6b00" stroke="${INK}" stroke-width="2"/>
        <path d="M-5 -46 Q-7 -56 0 -62 Q7 -54 5 -46 Z" fill="#ffd43b"/></g>${skinHand(a)}`;
    },
    chair: {
      back: `<path d="M14 154 V24 M146 154 V24" stroke="#495057" stroke-width="7"/>
        ${[[14, 28], [14, 40], [14, 52], [146, 28], [146, 40], [146, 52]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="12" ry="4" fill="#c9a227" stroke="${INK}" stroke-width="2"/>`).join('')}
        <circle cx="14" cy="14" r="9" fill="#adb5bd" stroke="${INK}" stroke-width="2.5"/><circle cx="146" cy="14" r="9" fill="#adb5bd" stroke="${INK}" stroke-width="2.5"/>
        <path d="M22 12 L50 22 L42 8 L80 16 L72 2 L110 14 L102 4 L138 12" fill="none" stroke="#19f0ff" stroke-width="3" stroke-linejoin="round"/>
        <path d="M22 12 L50 22 L42 8 L80 16 L72 2 L110 14 L102 4 L138 12" fill="none" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>
        <rect x="30" y="76" width="100" height="78" rx="6" fill="#6c757d" stroke="${INK}" stroke-width="3"/>
        <path d="M40 90 H120 M40 104 H120" stroke="#495057" stroke-width="3"/>`,
      front: `<rect x="6" y="150" width="148" height="18" rx="3" fill="#868e96" stroke="${INK}" stroke-width="3"/>
        <rect x="14" y="168" width="132" height="38" fill="#495057" stroke="${INK}" stroke-width="3"/>
        ${[34, 56].map((x) => `<circle cx="${x}" cy="187" r="7" fill="#212529" stroke="#adb5bd" stroke-width="2"/>`).join('')}
        <rect x="84" y="176" width="46" height="22" fill="#212529" stroke="#adb5bd" stroke-width="2"/>
        <path d="M107 196 L120 180" stroke="#e03131" stroke-width="3"/>`,
    },
  },

  sadako: {
    look: { body: 'magrelo', skin: '#c7ced1', topColor: '#c7ced1', pants: '#e9ecef' },
    head: () => `<path d="M34 110 Q22 20 80 18 Q138 20 126 110 L136 150 L116 132 L108 152 L96 128 L84 150 L74 128 L62 152 L52 132 L28 150 Z" fill="#0b0a0c" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      ${skinHead('#c7ced1')}
      <path d="M36 72 Q34 24 80 22 Q126 24 124 72 L122 114 L108 90 L104 112 L94 86 L90 116 L80 88 L74 114 L66 88 L60 116 L54 88 L44 112 L38 92 Z" fill="#0b0a0c" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M86 56 Q94 50 100 58 Q101 68 96 72 Q90 76 86 68 Z" fill="#c7ced1"/>
      <circle cx="93" cy="62" r="7" fill="#f8f9fa" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="93" cy="62" r="3" fill="#0b0a0c"/>
      <path d="M86 57 Q93 51 100 57" fill="none" stroke="#0b0a0c" stroke-width="2.5"/>
      <path d="M50 44 L56 84 M64 36 L68 76 M78 34 L80 66 M106 38 L110 80" stroke="#2b2a33" stroke-width="1.5"/>
      ${skinMouths('', '<path d="M86 84 Q91 80 96 84 Q95 96 91 96 Q87 96 86 84 Z" fill="#160a0c"/>')}`,
    kit: {
      main: '#e9ecef',
      draw: (a, t) => area('#e9ecef') + `<path d="M64 ${t} Q80 ${t + 14} 96 ${t}" fill="none" stroke="#adb5bd" stroke-width="3"/>
        <path d="M64 ${t + 18} L60 150 M96 ${t + 20} L100 150 M80 ${t + 16} V150" stroke="#ced4da" stroke-width="2.5"/>
        <path d="M58 ${t + 40} l10 6 M92 ${t + 24} l10 8" stroke="#6b7a5a" stroke-width="3" opacity=".6"/>`,
    },
    prop: (a) => {
      const [hx, hy] = bodyOf(a).hands[1];
      return `<g transform="translate(${hx + 2} ${hy - 22}) rotate(-8)">
        <rect x="-18" y="-11" width="36" height="22" rx="2" fill="#212529" stroke="${INK}" stroke-width="2"/>
        <rect x="-13" y="-7" width="26" height="9" fill="#f1f3f5"/>
        <path d="M-10 -3 H10" stroke="#d1001f" stroke-width="2"/>
        <circle cx="-7" cy="6" r="2.6" fill="#868e96"/><circle cx="7" cy="6" r="2.6" fill="#868e96"/></g>${skinHand(a)}`;
    },
    chair: {
      back: `<path d="M16 154 V10 M144 154 V10" stroke="#3b2a1a" stroke-width="8"/>
        <path d="M6 18 L80 -6 L154 18" fill="none" stroke="#3b2a1a" stroke-width="10" stroke-linejoin="round"/>`,
      front: `<path d="M4 136 H156 V206 H4 Z" fill="#6c757d" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="80" cy="136" rx="76" ry="9" fill="#0b0a0c" stroke="${INK}" stroke-width="3"/>
        <path d="M4 158 H156 M4 182 H156 M36 145 V158 M84 145 V158 M128 145 V158 M18 158 V182 M60 158 V182 M108 158 V182 M144 158 V182 M38 182 V206 M84 182 V206 M126 182 V206"
          stroke="#343a40" stroke-width="2.5"/>
        <path d="M14 196 Q22 188 34 194 M110 150 Q120 146 134 154" fill="none" stroke="#2f6b3a" stroke-width="4"/>`,
    },
  },
};

const COSTUMES = Object.keys(PREMIUM_SKINS);
// Peças internas: fora das categorias, o sanitizeAvatar não deixa chegar de
// outro peer. A fantasia entra só pelo campo costume.
for (const [id, skin] of Object.entries(PREMIUM_SKINS)) {
  KITS[`skin:${id}`] = skin.kit;
  skin.look.kit = `skin:${id}`;
  if (skin.chair) {
    CHAIRS[`skin:${id}`] = skin.chair;
    skin.look.chair = `skin:${id}`;
  }
}

function dressed(a) {
  const skin = PREMIUM_SKINS[a.costume];
  return skin ? { ...a, symbol: 'nada', item: 'nada', ...skin.look } : a;
}

// Sorteia uma fantasia, evitando as que já estão na sala enquanto der.
function rollCostume(used = []) {
  const taken = Array.isArray(used) ? used : [];
  const free = COSTUMES.filter((id) => !taken.includes(id));
  const list = free.length ? free : COSTUMES;
  return list[Math.floor(Math.random() * list.length)];
}

// Boneco completo sentado; as duas bocas vão no SVG e o CSS escolhe qual
// aparece (classe .speaking no pai), sem redesenhar a cada frame.
function avatarSeatSvg(raw) {
  const a = dressed(sanitizeAvatar(raw));
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
  const a = dressed(sanitizeAvatar(raw));
  return `<svg class="avatar-face" viewBox="30 10 100 100" aria-hidden="true">
    ${avatarHead(a)}
  </svg>`;
}
