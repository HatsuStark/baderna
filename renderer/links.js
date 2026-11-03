'use strict';

// Links no chat: viram clicáveis; YouTube e Twitter/X ganham um cartão com
// prévia (título, autor, foto) igual Discord e abrem num painel dentro do app,
// por cima do chat. O resto abre no navegador. A prévia vem do processo
// principal (link:preview), que só devolve texto e fotos dos domínios
// liberados no CSP; texto sempre via textContent.

const LINK_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const LINK_TRAIL_RE = /[.,;:!?)\]}]+$/;
const LINK_MAX_CARDS = 3;
const YT_ID_RE = /^[\w-]{11}$/;
const TWEET_ID_RE = /^\d{1,25}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const TWEET_HOSTS = new Set([
  'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com',
  'fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com',
]);

// Tira pontuação do fim ("olha isso: https://x.com/a)." → sem o ")."), mas
// mantém parêntese que fecha um aberto dentro do link (Wikipedia).
function trimLink(url) {
  let out = url;
  for (;;) {
    const m = LINK_TRAIL_RE.exec(out);
    if (!m) return out;
    const tail = m[0];
    if (tail.startsWith(')') && (out.match(/\(/g) ?? []).length >= (out.match(/\)/g) ?? []).length) return out;
    out = out.slice(0, -1);
  }
}

function findLinks(text) {
  const links = [];
  for (const m of text.matchAll(LINK_RE)) {
    const url = trimLink(m[0]);
    try {
      new URL(url);
      links.push({ url, index: m.index });
    } catch {}
  }
  return links;
}

// { kind: 'youtube', id, start } | { kind: 'tweet', id } | null
function parseEmbed(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be' || YT_HOSTS.has(host)) {
    let id = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
    const path = /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname);
    if (path) id = path[1];
    if (!id || !YT_ID_RE.test(id)) return null;
    // t=90, t=1m30s ou t=90s
    const t = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(u.searchParams.get('t') ?? '');
    const start = t ? (Number(t[1] ?? 0) * 3600 + Number(t[2] ?? 0) * 60 + Number(t[3] ?? 0)) : 0;
    return { kind: 'youtube', id, start };
  }
  if (TWEET_HOSTS.has(host)) {
    const m = /^\/(?:\w{1,15}|i)\/status(?:es)?\/(\d+)/.exec(u.pathname);
    if (m && TWEET_ID_RE.test(m[1])) return { kind: 'tweet', id: m[1] };
  }
  return null;
}

// Escreve o texto no elemento com os links clicáveis.
function linkifyInto(el, text) {
  let pos = 0;
  for (const { url, index } of findLinks(text)) {
    if (index > pos) el.append(text.slice(pos, index));
    const a = document.createElement('a');
    a.className = 'link';
    a.href = url;
    a.textContent = url;
    a.title = parseEmbed(url) ? 'Abrir aqui no app' : 'Abrir no navegador';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openLink(url);
    });
    el.append(a);
    pos = index + url.length;
  }
  if (pos < text.length) el.append(text.slice(pos));
}

// Cartões de prévia embaixo da mensagem.
function addLinkCards(body, text) {
  const seen = new Set();
  for (const { url } of findLinks(text)) {
    const embed = parseEmbed(url);
    const key = embed && `${embed.kind}:${embed.id}`;
    if (!embed || seen.has(key)) continue;
    seen.add(key);
    body.append(linkCard(url, embed));
    if (seen.size >= LINK_MAX_CARDS) break;
  }
}

function linkCard(url, embed) {
  const card = document.createElement('div');
  card.className = `link-card ${embed.kind}`;
  const site = document.createElement('span');
  site.className = 'lc-site';
  site.textContent = embed.kind === 'youtube' ? 'YouTube' : 'X (Twitter)';
  const author = document.createElement('span');
  author.className = 'lc-author';
  const title = document.createElement('b');
  title.className = 'lc-title';
  const desc = document.createElement('p');
  desc.className = 'lc-text';
  const shot = document.createElement('button');
  shot.type = 'button';
  shot.className = 'lc-shot';
  shot.title = 'Abrir aqui no app';
  shot.addEventListener('click', () => openEmbed(url, embed, title.textContent));
  const actions = document.createElement('div');
  actions.className = 'lc-actions';
  const here = document.createElement('button');
  here.type = 'button';
  here.className = 'ghost';
  here.textContent = embed.kind === 'youtube' ? '▶ Assistir aqui' : 'Abrir aqui';
  here.addEventListener('click', () => openEmbed(url, embed, title.textContent));
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'ghost';
  out.textContent = '↗ Navegador';
  out.addEventListener('click', () => window.baderna?.openExternal(url));
  actions.append(here, out);

  if (embed.kind === 'youtube') {
    title.textContent = 'Vídeo do YouTube';
    shot.append(linkImage(`https://i.ytimg.com/vi/${embed.id}/hqdefault.jpg`));
    shot.classList.add('play');
    card.append(site, author, title, shot, actions);
  } else {
    title.textContent = 'Post no X';
    card.append(site, title, desc, shot, actions);
    shot.hidden = true;
  }

  window.baderna?.linkPreview(url).then((info) => {
    if (!info) return;
    if (info.title) title.textContent = info.title;
    if (info.author) author.textContent = info.author;
    if (info.text) desc.textContent = info.text;
    if (embed.kind === 'tweet' && info.image) {
      shot.replaceChildren(linkImage(info.image));
      shot.hidden = false;
    }
  }).catch(() => {});
  return card;
}

function linkImage(src) {
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.src = src;
  return img;
}

function openLink(url) {
  const embed = parseEmbed(url);
  if (embed) openEmbed(url, embed);
  else window.baderna?.openExternal(url);
}

// ---------- Painel por cima do chat ----------

let embedUrl = '';

function openEmbed(url, embed, label) {
  const frame = document.createElement('iframe');
  frame.className = embed.kind;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
  if (embed.kind === 'youtube') {
    const q = new URLSearchParams({ autoplay: '1', rel: '0' });
    if (embed.start) q.set('start', String(embed.start));
    frame.src = `https://www.youtube-nocookie.com/embed/${embed.id}?${q}`;
  } else {
    const q = new URLSearchParams({ id: embed.id, theme: 'dark', dnt: 'true', lang: 'pt' });
    frame.src = `https://platform.twitter.com/embed/Tweet.html?${q}`;
  }
  embedUrl = url;
  $('embed-label').textContent = label && !/^(Vídeo do YouTube|Post no X)$/.test(label)
    ? label : embed.kind === 'youtube' ? 'YouTube' : 'X (Twitter)';
  $('embed-box').replaceChildren(frame);
  $('embed-view').classList.toggle('tweet', embed.kind === 'tweet');
  $('embed-view').hidden = false;
}

function closeEmbed() {
  embedUrl = '';
  $('embed-box').replaceChildren(); // tirar o iframe para o vídeo
  $('embed-view').hidden = true;
}

$('embed-close').addEventListener('click', closeEmbed);
$('embed-browser').addEventListener('click', () => {
  if (embedUrl) window.baderna?.openExternal(embedUrl);
  closeEmbed();
});
