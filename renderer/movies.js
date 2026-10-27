'use strict';

// Lista dos filmes que a galera já viu, uma por código de sala. Fica em cada
// PC e se junta com a dos outros quando se encontram na sala: cada filme tem
// id e a hora da última mudança, e vale a versão mais nova. Remover vira uma
// marca "del", pra remoção também se espalhar.
//
// Mensagem no DataChannel: { type: 'movies', list } — a lista inteira quando
// a conexão abre, um filme só quando alguém mexe. Tudo validado em
// sanitizeMovie; texto sempre via textContent.

const MOVIES_MAX = 400;
const MOVIE_TITLE_MAX = 100;
const MOVIE_WHO_MAX = 16;
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
  };
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
    if (!m || (byId.get(m.id)?.at ?? 0) >= m.at) continue;
    byId.set(m.id, m);
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

function renderMoviesGrid() {
  const list = visibleMovies(movies.room);
  $('movies-sub').textContent = list.length
    ? `${list.length} ${list.length === 1 ? 'filme visto' : 'filmes vistos'}. Clique num filme pra editar.`
    : 'Nenhum filme ainda. Viram algum? Clica em "+ Filme".';
  $('movies-grid').replaceChildren(...list.map((m) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'movie-card';
    card.title = 'Editar';
    const title = document.createElement('b');
    title.textContent = m.title;
    const meta = document.createElement('small');
    meta.textContent = [m.year, m.date && `visto em ${formatMovieDate(m.date)}`].filter(Boolean).join(' · ');
    const who = document.createElement('span');
    who.className = 'movie-who';
    who.textContent = m.who.join(', ');
    card.append(moviePoster(m.title, m.poster, 'w342'), title, meta, who);
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
  $('movie-search').focus();
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
  publishMovie({
    id: movies.editing?.id ?? newMovieId(),
    at: Date.now(),
    title,
    year: p?.year ?? null,
    poster: p?.poster ?? '',
    date: $('movie-date').value,
    who,
    by: state.name ?? loadPref('name'),
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
