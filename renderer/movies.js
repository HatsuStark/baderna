'use strict';

// Lista dos filmes que a galera já viu, uma por código de sala. Fica em cada
// PC e se junta com a dos outros quando se encontram na sala: cada filme tem
// id e a hora da última mudança, e vale a versão mais nova. Remover vira uma
// marca "del", pra remoção também se espalhar.
//
// Mensagem no DataChannel: { type: 'movies', list } — a lista inteira quando
// a conexão abre, um filme só quando alguém mexe. Tudo validado em
// sanitizeMovie; texto sempre via textContent.
//
// Notas (1 a 10): ratings = { nome: { v, at } }, v 0 = nota retirada. Juntam
// pessoa por pessoa pela hora de cada uma, separado do resto do filme: duas
// pessoas votando ao mesmo tempo não apagam a nota uma da outra. Só vale (e só
// entra na média) a nota de quem está em "quem assistiu".

const MOVIES_MAX = 400;
const MOVIE_TITLE_MAX = 100;
const MOVIE_WHO_MAX = 16;
const MOVIE_RATINGS_MAX = 32;
const RATING_MAX = 10;
const MOVIE_SEARCH_DELAY_MS = 450;
const POSTER_BASE = 'https://image.tmdb.org/t/p/';
const MOVIE_POSTER_RE = /^\/[A-Za-z0-9_-]{4,64}\.(jpg|jpeg|png)$/;

const movies = {
  room: null,        // código da sala da lista aberta
  editing: null,     // filme sendo editado (null = novo)
  picked: null,      // resultado da busca escolhido: { title, year, poster }
  searchTimer: 0,
  searchToken: 0,
  confirmDelete: false,
  myRating: 0,       // nota no formulário aberto (0 = sem nota)
  sort: loadPref('moviesSort') === 'rank' ? 'rank' : 'recent',
};

// ---------- Dados ----------

function sanitizeMovie(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && /^[a-z0-9]{8,24}$/.test(raw.id) ? raw.id : null;
  const at = Number(raw.at);
  if (!id || !Number.isFinite(at) || at <= 0) return null;
  const base = { id, at: Math.min(at, Date.now() + 86_400_000) };
  if (raw.del) return { ...base, del: true };
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MOVIE_TITLE_MAX) : '';
  if (!title) return null;
  const year = Number(raw.year);
  const who = Array.isArray(raw.who)
    ? [...new Set(raw.who.filter((n) => typeof n === 'string').map(cleanName))].filter((n) => n !== '?').slice(0, MOVIE_WHO_MAX)
    : [];
  return {
    ...base,
    title,
    year: Number.isInteger(year) && year >= 1870 && year <= 2100 ? year : null,
    poster: typeof raw.poster === 'string' && MOVIE_POSTER_RE.test(raw.poster) ? raw.poster : '',
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : '',
    who,
    by: cleanName(raw.by),
    ratings: sanitizeRatings(raw.ratings),
  };
}

function sanitizeRatings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, r] of Object.entries(raw).slice(0, MOVIE_RATINGS_MAX)) {
    const name = cleanName(key);
    const v = Number(r?.v);
    const at = Number(r?.at);
    if (name === '?' || !Number.isInteger(v) || v < 0 || v > RATING_MAX || !Number.isFinite(at) || at <= 0) continue;
    out[name] = { v, at: Math.min(at, Date.now() + 86_400_000) };
  }
  return out;
}

// Junta duas listas de notas: por pessoa, vale a mais nova.
function mergeRatings(a = {}, b = {}) {
  const out = { ...a };
  for (const [name, r] of Object.entries(b)) {
    if ((out[name]?.at ?? 0) < r.at) out[name] = r;
  }
  return out;
}

function sameRatings(a = {}, b = {}) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k]?.at === a[k].at && b[k].v === a[k].v);
}

// Média só de quem viu e deu nota.
function movieScore(m) {
  const votes = m.who.map((n) => m.ratings?.[n]?.v).filter((v) => v > 0);
  if (!votes.length) return null;
  return { avg: votes.reduce((s, v) => s + v, 0) / votes.length, count: votes.length };
}

const formatScore = (avg) => avg.toFixed(1).replace('.', ',');

function myMovieName() {
  return cleanName(state.name ?? loadPref('name'));
}

function loadMovies(room) {
  try {
    const list = JSON.parse(loadPref(`movies:${room}`) || '[]');
    return Array.isArray(list) ? list.map(sanitizeMovie).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function storeMovies(room, list) {
  // Passou do limite: saem primeiro as remoções, depois os mais antigos.
  const keep = list.length <= MOVIES_MAX ? list
    : [...list].sort((a, b) => (!!a.del - !!b.del) || b.at - a.at).slice(0, MOVIES_MAX);
  savePref(`movies:${room}`, JSON.stringify(keep));
}

// Junta filmes recebidos na lista da sala; devolve true se mudou algo.
function mergeMovies(room, incoming) {
  const byId = new Map(loadMovies(room).map((m) => [m.id, m]));
  let changed = false;
  for (const raw of incoming.slice(0, MOVIES_MAX)) {
    const m = sanitizeMovie(raw);
    if (!m) continue;
    const cur = byId.get(m.id);
    const base = !cur || m.at > cur.at ? m : cur;
    // Removido não guarda nota; o resto junta as notas dos dois lados.
    const next = base.del ? base : { ...base, ratings: mergeRatings(cur?.ratings, m.ratings) };
    if (next === cur || (cur && base === cur && !cur.del && sameRatings(cur.ratings, next.ratings))) continue;
    byId.set(m.id, next);
    changed = true;
  }
  if (changed) storeMovies(room, [...byId.values()]);
  return changed;
}

function visibleMovies(room) {
  return loadMovies(room)
    .filter((m) => !m.del)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
}

function newMovieId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => (b % 36).toString(36)).join('');
}

// ---------- Rede ----------

function sendMoviesTo(member) {
  if (!state.room) return;
  const list = loadMovies(state.room);
  if (list.length) member.conn?.send({ type: 'movies', list });
}

function handleMoviesMessage(msg) {
  if (!state.room || !Array.isArray(msg.list)) return;
  if (mergeMovies(state.room, msg.list)) refreshMovies();
}

function publishMovie(movie) {
  mergeMovies(movies.room, [movie]);
  if (movies.room === state.room) broadcast({ type: 'movies', list: [movie] });
  refreshMovies();
}

// ---------- Tela da lista ----------

function openMovies(room, label) {
  movies.room = room;
  $('movies-title').textContent = `Filmes · ${label}`;
  showMoviesList();
  $('movies-dialog').showModal();
}

function refreshMovies() {
  updateMoviesChip();
  if ($('movies-dialog').open && $('movie-form').hidden) renderMoviesGrid();
}

function updateMoviesChip() {
  const n = state.room ? visibleMovies(state.room).length : 0;
  $('movies-count').textContent = n ? String(n) : '';
}

function showMoviesList() {
  $('movie-form').hidden = true;
  $('movies-list').hidden = false;
  $('movie-add').hidden = false;
  renderMoviesGrid();
}

// Ranking: maior média primeiro; empate, quem tem mais notas; sem nota no fim.
function rankedMovies(list) {
  const scored = list.map((m) => ({ m, s: movieScore(m) }));
  scored.sort((a, b) => (!a.s - !b.s) || (b.s?.avg ?? 0) - (a.s?.avg ?? 0) || (b.s?.count ?? 0) - (a.s?.count ?? 0));
  return scored.map(({ m }) => m);
}

function setMoviesSort(sort) {
  movies.sort = sort;
  savePref('moviesSort', sort);
  $('movies-sort-recent').classList.toggle('on', sort !== 'rank');
  $('movies-sort-rank').classList.toggle('on', sort === 'rank');
  if (movies.room) renderMoviesGrid();
}

function renderMoviesGrid() {
  const ranking = movies.sort === 'rank';
  const list = ranking ? rankedMovies(visibleMovies(movies.room)) : visibleMovies(movies.room);
  $('movies-sub').textContent = list.length
    ? `${list.length} ${list.length === 1 ? 'filme visto' : 'filmes vistos'}. Clique num filme pra editar ou dar nota.`
    : 'Nenhum filme ainda. Viram algum? Clica em "+ Filme".';
  let pos = 0;
  $('movies-grid').replaceChildren(...list.map((m) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'movie-card';
    card.title = 'Editar';
    if (ranking && movieScore(m)) {
      pos++;
      const place = document.createElement('span');
      place.className = `movie-place p${Math.min(pos, 4)}`;
      place.textContent = `#${pos}`;
      card.append(place);
    }
    const title = document.createElement('b');
    title.textContent = m.title;
    const meta = document.createElement('small');
    meta.textContent = [m.year, m.date && `visto em ${formatMovieDate(m.date)}`].filter(Boolean).join(' · ');
    const who = document.createElement('span');
    who.className = 'movie-who';
    who.textContent = m.who.join(', ');
    const score = movieScore(m);
    const rating = document.createElement('span');
    rating.className = 'movie-score';
    if (score) {
      const num = document.createElement('b');
      num.textContent = formatScore(score.avg);
      rating.append('★ ', num, `/10 · ${score.count} ${score.count === 1 ? 'nota' : 'notas'}`);
    } else {
      rating.classList.add('none');
      rating.textContent = '☆ sem nota';
    }
    card.append(moviePoster(m.title, m.poster, 'w342'), title, meta, rating, who);
    card.addEventListener('click', () => openMovieForm(m));
    return card;
  }));
}

// Com capa do TMDB, a imagem; sem, um pôster desenhado com o título.
function moviePoster(title, poster, size) {
  if (poster && MOVIE_POSTER_RE.test(poster)) {
    const img = document.createElement('img');
    img.className = 'poster';
    img.alt = '';
    img.loading = 'lazy';
    img.src = POSTER_BASE + size + poster;
    return img;
  }
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const gen = document.createElement('div');
  gen.className = 'poster gen';
  gen.style.background = `linear-gradient(160deg, hsl(${hue} 70% 42%), hsl(${(hue + 70) % 360} 65% 16%))`;
  const text = document.createElement('span');
  text.textContent = title;
  gen.append(text);
  return gen;
}

function formatMovieDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// ---------- Adicionar / editar ----------

function presentNames() {
  if (!state.room) return [cleanName(loadPref('name') || 'Você')];
  return [state.name, ...[...state.members.values()].map((m) => m.name).filter((n) => n !== '…')];
}

function openMovieForm(movie = null) {
  movies.editing = movie;
  movies.picked = movie ? { title: movie.title, year: movie.year, poster: movie.poster } : null;
  movies.confirmDelete = false;
  $('movies-list').hidden = true;
  $('movie-add').hidden = true;
  $('movie-form').hidden = false;
  $('movie-search').value = movie?.title ?? '';
  $('movie-search-status').textContent = '';
  $('movie-results').replaceChildren();
  $('movie-date').value = movie?.date || todayIso();
  $('movie-who-extra').value = '';
  $('movie-delete').hidden = !movie;
  $('movie-delete').textContent = 'Remover';

  // Filme novo: marca quem está na sala. Editando: marca quem já estava na lista.
  const checked = new Set(movie ? movie.who : presentNames());
  const names = [...new Set([...(movie?.who ?? []), ...presentNames()])];
  $('movie-who').replaceChildren(...names.map((name) => {
    const label = document.createElement('label');
    label.className = 'check who-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = name;
    box.checked = checked.has(name);
    label.append(box, document.createTextNode(name));
    return label;
  }));
  movies.myRating = movie?.ratings?.[myMovieName()]?.v ?? 0;
  renderRating();
  $('movie-search').focus();
}

// ---------- Nota (1 a 10 estrelas) ----------

function iWatched() {
  const me = myMovieName();
  const extra = $('movie-who-extra').value.split(',').map(cleanName);
  return [...$('movie-who').querySelectorAll('input:checked')].some((b) => b.value === me) || extra.includes(me);
}

function renderRating(preview = 0) {
  const can = iWatched();
  const shown = can ? preview || movies.myRating : 0;
  const stars = $('movie-stars');
  if (!stars.children.length) {
    for (let i = 1; i <= RATING_MAX; i++) {
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'star';
      star.textContent = '★';
      star.title = `${i}/10`;
      star.dataset.v = String(i);
      stars.append(star);
    }
  }
  stars.classList.toggle('locked', !can);
  for (const star of stars.children) {
    star.disabled = !can;
    star.classList.toggle('on', Number(star.dataset.v) <= shown);
  }
  $('movie-rating-value').textContent = can
    ? (shown ? `${shown}/10` : 'clique nas estrelas')
    : 'só quem assistiu dá nota: marque seu nome acima';

  // Notas dos outros que viram (do filme salvo).
  const m = movies.editing;
  const me = myMovieName();
  const others = m ? m.who.filter((n) => n !== me && m.ratings?.[n]?.v > 0).map((n) => `${n} ${m.ratings[n].v}`) : [];
  const score = m && movieScore(m);
  $('movie-rating-others').textContent = [
    score && `Média ${formatScore(score.avg)}/10 (${score.count} ${score.count === 1 ? 'nota' : 'notas'})`,
    others.length && `Galera: ${others.join(' · ')}`,
  ].filter(Boolean).join('. ');
}

function clickStar(e) {
  const star = e.target.closest('.star');
  if (!star || star.disabled) return;
  const v = Number(star.dataset.v);
  // Clicar na nota que já está tira a nota.
  movies.myRating = movies.myRating === v ? 0 : v;
  renderRating();
}

function hoverStar(e) {
  const star = e.target.closest('.star');
  renderRating(star && !star.disabled ? Number(star.dataset.v) : 0);
}

function scheduleMovieSearch() {
  const q = $('movie-search').value.trim();
  if (movies.picked && movies.picked.title !== q) {
    movies.picked = null;
    markPickedResult();
  }
  clearTimeout(movies.searchTimer);
  if (q.length < 2 || !window.baderna?.searchMovies) return;
  movies.searchTimer = setTimeout(() => searchMovies(q), MOVIE_SEARCH_DELAY_MS);
}

async function searchMovies(q) {
  const token = ++movies.searchToken;
  $('movie-search-status').textContent = 'Procurando capa…';
  const res = await window.baderna.searchMovies(q).catch(() => ({ ok: false, reason: 'error' }));
  if (token !== movies.searchToken || $('movie-form').hidden) return;
  if (!res?.ok) {
    $('movie-results').replaceChildren();
    $('movie-search-status').textContent = {
      'no-key': 'Sem chave do TMDB configurada: a capa vai ser desenhada pelo app.',
      'bad-key': 'A chave do TMDB foi recusada: a capa vai ser desenhada pelo app.',
    }[res?.reason] ?? 'Não deu pra buscar capas agora: a capa vai ser desenhada pelo app.';
    return;
  }
  const results = res.results
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title.trim().slice(0, MOVIE_TITLE_MAX) : '',
      year: Number.isInteger(r.year) ? r.year : null,
      poster: typeof r.poster === 'string' && MOVIE_POSTER_RE.test(r.poster) ? r.poster : '',
    }))
    .filter((r) => r.title);
  $('movie-search-status').textContent = results.length
    ? 'Escolha o filme (ou só salve com o nome digitado):'
    : 'Nenhum filme com esse nome. Dá pra salvar assim mesmo.';
  $('movie-results').replaceChildren(...results.map((r) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'movie-result';
    btn.title = r.year ? `${r.title} (${r.year})` : r.title;
    const name = document.createElement('small');
    name.textContent = btn.title;
    btn.append(moviePoster(r.title, r.poster, 'w154'), name);
    btn.addEventListener('click', () => {
      movies.picked = r;
      $('movie-search').value = r.title;
      markPickedResult();
    });
    btn.dataset.key = `${r.title}|${r.year}|${r.poster}`;
    return btn;
  }));
  markPickedResult();
}

function markPickedResult() {
  const p = movies.picked;
  const key = p && `${p.title}|${p.year}|${p.poster}`;
  for (const btn of $('movie-results').children) btn.classList.toggle('selected', btn.dataset.key === key);
}

function saveMovieForm(e) {
  e.preventDefault();
  const title = $('movie-search').value.trim().slice(0, MOVIE_TITLE_MAX);
  if (!title) return $('movie-search').focus();
  const p = movies.picked?.title === title ? movies.picked : null;
  const extra = $('movie-who-extra').value.split(',').map((n) => n.trim()).filter(Boolean);
  const who = [...[...$('movie-who').querySelectorAll('input:checked')].map((b) => b.value), ...extra];
  const ratings = { ...(movies.editing?.ratings ?? {}) };
  const me = myMovieName();
  const mine = iWatched() ? movies.myRating : 0;
  if ((ratings[me]?.v ?? 0) !== mine) ratings[me] = { v: mine, at: Date.now() };
  publishMovie({
    id: movies.editing?.id ?? newMovieId(),
    at: Date.now(),
    title,
    year: p?.year ?? null,
    poster: p?.poster ?? '',
    date: $('movie-date').value,
    who,
    by: state.name ?? loadPref('name'),
    ratings,
  });
  showMoviesList();
}

function deleteMovie() {
  // Dois cliques pra remover, pra não apagar sem querer.
  if (!movies.confirmDelete) {
    movies.confirmDelete = true;
    $('movie-delete').textContent = 'Clique de novo pra remover';
    return;
  }
  publishMovie({ id: movies.editing.id, at: Date.now(), del: true });
  showMoviesList();
}

$('movies-chip').addEventListener('click', () => {
  const saved = savedRoom(state.room);
  openMovies(state.room, saved ? saved.name : `sala ${state.room}`);
});
$('movie-add').addEventListener('click', () => openMovieForm());
$('movies-close').addEventListener('click', () => $('movies-dialog').close());
$('movie-search').addEventListener('input', scheduleMovieSearch);
$('movie-form').addEventListener('submit', saveMovieForm);
$('movie-cancel').addEventListener('click', showMoviesList);
$('movie-delete').addEventListener('click', deleteMovie);
$('movies-sort-recent').addEventListener('click', () => setMoviesSort('recent'));
$('movies-sort-rank').addEventListener('click', () => setMoviesSort('rank'));
setMoviesSort(movies.sort);
$('movie-stars').addEventListener('click', clickStar);
$('movie-stars').addEventListener('mouseover', hoverStar);
$('movie-stars').addEventListener('mouseleave', () => renderRating());
// Marcar/desmarcar o próprio nome libera ou trava as estrelas.
$('movie-who').addEventListener('change', () => renderRating());
$('movie-who-extra').addEventListener('input', () => renderRating());
