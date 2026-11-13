'use strict';

// Áudios curtos da sala: cada pessoa põe até 5 e qualquer um toca pra todos.
// Sem servidor: os arquivos ficam no PC de quem colocou (IndexedDB, por código
// de sala) e vão pros outros quando a conexão abre. Quem sai leva os seus; quem
// recebe guarda só na memória, até sair da sala.
//
// Mensagens no DataChannel, só pra quem avisou no 'caps' que sabe tocar (versão
// antiga não recebe os arquivos à toa): sound (arquivo), sound-remove,
// sound-play (quem clicou tocou: cada um toca a própria cópia). Tudo validado
// aqui; nome sempre via textContent.

const SOUND_MAX_PER_PERSON = 5;
const SOUND_MAX_BYTES = 512 * 1024; // 10 s de MP3 a 320 kbps cabem
const SOUND_MAX_SECONDS = 10;
const SOUND_MIN_SECONDS = 0.2;
const SOUND_SOURCE_MAX_BYTES = 30 * 1024 * 1024; // arquivo de onde sai o trecho
const SOUND_CUT_RATE = 24000;
const SOUND_CUT_FADE = 0.008;
const SOUND_LENGTH_TOLERANCE = 0.5;
const SOUND_NAME_MAX = 24;
const SOUND_COOLDOWN_MS = 800;
const SOUND_ID_RE = /^[a-z0-9-]{8,40}$/;
const SOUND_DB = 'baderna-sounds';

const sounds = {
  mine: [],                  // { id, name, data, buffer }
  ready: Promise.resolve(),  // termina quando os meus já foram lidos do disco
  playing: new Map(),        // quem tocou -> som tocando (um por pessoa)
  lastPlay: 0,
};

// ---------- Disco ----------

function openSoundDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SOUND_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('rooms', { keyPath: 'room' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readStoredSounds(room) {
  const db = await openSoundDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('rooms').objectStore('rooms').get(room);
      req.onsuccess = () => resolve(req.result?.items ?? []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function storeMySounds() {
  const items = sounds.mine.map(({ id, name, data }) => ({ id, name, data }));
  const db = await openSoundDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('rooms', 'readwrite');
      tx.objectStore('rooms').put({ room: state.room, items });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function loadMySounds(room) {
  try {
    for (const item of await readStoredSounds(room)) {
      const buffer = await decodeSound(item.data);
      if (state.room !== room) return;
      sounds.mine.push({ ...item, buffer });
    }
  } catch (err) {
    console.warn('loadMySounds', err);
  }
}

function resetSounds() {
  sounds.mine = [];
  sounds.playing.clear();
  closeSoundEditor();
  closeSoundPanel();
}

// ---------- Tocar ----------

// decodeAudioData esvazia o ArrayBuffer que recebe; o original ainda vai pros outros.
function decodeSound(data) {
  return state.audioCtx.decodeAudioData(data.slice(0));
}

function findSound(ownerId, id) {
  if (ownerId === state.myId) return sounds.mine.find((s) => s.id === id);
  return state.members.get(ownerId)?.sounds?.get(id);
}

function soundVolume() {
  const saved = loadPref('soundVolume');
  const vol = saved === null || saved === '' ? 0.8 : Number(saved);
  return Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.8;
}

function playSoundBuffer(playerId, buffer) {
  const ctx = state.audioCtx;
  if (!ctx || state.deaf) return;
  sounds.playing.get(playerId)?.stop();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = soundVolume();
  source.connect(gain).connect(ctx.destination);
  source.addEventListener('ended', () => {
    if (sounds.playing.get(playerId) === source) sounds.playing.delete(playerId);
  });
  sounds.playing.set(playerId, source);
  source.start();
}

function triggerSound(ownerId, id) {
  const sound = findSound(ownerId, id);
  const now = Date.now();
  if (!sound?.buffer || now - sounds.lastPlay < SOUND_COOLDOWN_MS) return;
  sounds.lastPlay = now;
  for (const m of state.members.values()) {
    if (m.soundsOk && m.conn?.open) m.conn.send({ type: 'sound-play', owner: ownerId, id });
  }
  addSystem(`🔊 ${state.name}: ${sound.name}`);
  playSoundBuffer(state.myId, sound.buffer);
}

// ---------- Rede ----------

function soundMessage(sound) {
  return { type: 'sound', id: sound.id, name: sound.name, data: sound.data };
}

async function sendSoundsTo(member) {
  await sounds.ready;
  if (!member.conn?.open) return;
  for (const sound of sounds.mine) member.conn.send(soundMessage(sound));
}

async function handleSoundMessage(member, msg) {
  member.sounds ??= new Map();
  const id = typeof msg.id === 'string' && SOUND_ID_RE.test(msg.id) ? msg.id : null;
  if (!id) return;
  if (msg.type === 'sound-play') {
    const now = Date.now();
    if (now - (member.lastSoundAt ?? 0) < SOUND_COOLDOWN_MS) return;
    const owner = typeof msg.owner === 'string' ? msg.owner : '';
    const sound = findSound(owner, id);
    // Mutado pra todos por um moderador: os áudios dele também não tocam.
    if (!sound?.buffer || isModMuted(member)) return;
    member.lastSoundAt = now;
    addSystem(`🔊 ${member.name}: ${sound.name}`);
    if (!personPref(member.name).mute) playSoundBuffer(member.id, sound.buffer);
  } else if (msg.type === 'sound-remove') {
    member.sounds.delete(id);
    renderSoundPanel();
  } else if (msg.type === 'sound') {
    if (member.sounds.has(id) || member.sounds.size >= SOUND_MAX_PER_PERSON) return;
    // Acima de um pedaço (16 KB), o PeerJS remonta e entrega Uint8Array.
    const isBytes = msg.data instanceof ArrayBuffer || msg.data instanceof Uint8Array;
    if (!isBytes || msg.data.byteLength > SOUND_MAX_BYTES) return;
    const data = msg.data instanceof Uint8Array ? msg.data.slice().buffer : msg.data;
    const name = String(msg.name ?? '').trim().slice(0, SOUND_NAME_MAX) || 'Áudio';
    // Reserva a vaga antes de decodificar: vários chegam juntos.
    const sound = { id, name, buffer: null };
    member.sounds.set(id, sound);
    try {
      const buffer = await decodeSound(data);
      if (buffer.duration > SOUND_MAX_SECONDS + SOUND_LENGTH_TOLERANCE) throw new Error('longo demais');
      sound.buffer = buffer;
    } catch (err) {
      console.warn('sound', err);
      member.sounds.delete(id);
    }
    renderSoundPanel();
  }
}

function broadcastSounds(msg) {
  for (const m of state.members.values()) {
    if (m.soundsOk && m.conn?.open) m.conn.send(msg);
  }
}

// ---------- Meus áudios ----------

// Abre o arquivo e mostra o editor (nome + trecho). Aceita arquivo longo,
// tipo uma música inteira: só o trecho escolhido vai pros outros.
async function pickMySound(file) {
  if (sounds.mine.length >= SOUND_MAX_PER_PERSON) return setSoundStatus(`Limite de ${SOUND_MAX_PER_PERSON} áudios por pessoa.`);
  if (file.size > SOUND_SOURCE_MAX_BYTES) return setSoundStatus('Arquivo grande demais (máx. 30 MB).');
  const room = state.room;
  const data = await file.arrayBuffer();
  let buffer;
  try {
    buffer = await decodeSound(data);
  } catch {
    return setSoundStatus('Não consegui abrir esse arquivo como áudio.');
  }
  if (state.room !== room) return;
  if (buffer.duration < SOUND_MIN_SECONDS) return setSoundStatus('Áudio curto demais.');
  setSoundStatus('');
  openSoundEditor({ name: file.name.replace(/\.[^.]+$/, ''), data, buffer });
}

// Corta o trecho e regrava em WAV mono 24 kHz: 10 s dão ~470 KB, cabe no
// limite e qualquer versão antiga toca. Arquivo que já cabe inteiro vai como veio.
async function cutSound(source, start, end) {
  const whole = start <= 0.01 && end >= source.buffer.duration - 0.01;
  if (whole && source.data.byteLength <= SOUND_MAX_BYTES) return { data: source.data, buffer: source.buffer };
  const length = Math.ceil((end - start) * SOUND_CUT_RATE);
  const offline = new OfflineAudioContext(1, length, SOUND_CUT_RATE);
  const node = offline.createBufferSource();
  node.buffer = source.buffer;
  // Rampa curtinha nas pontas: corte seco no meio da onda estala.
  const gain = offline.createGain();
  const dur = end - start;
  const fade = Math.min(SOUND_CUT_FADE, dur / 4);
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, fade);
  gain.gain.setValueAtTime(1, dur - fade);
  gain.gain.linearRampToValueAtTime(0, dur);
  node.connect(gain).connect(offline.destination);
  node.start(0, start, dur);
  const rendered = await offline.startRendering();
  const data = encodeWav(rendered.getChannelData(0), SOUND_CUT_RATE);
  return { data, buffer: await decodeSound(data) };
}

function encodeWav(samples, rate) {
  const out = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(out);
  const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);        // PCM
  v.setUint16(22, 1, true);        // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

async function addMySound(name, data, buffer) {
  if (sounds.mine.length >= SOUND_MAX_PER_PERSON) return setSoundStatus(`Limite de ${SOUND_MAX_PER_PERSON} áudios por pessoa.`);
  if (data.byteLength > SOUND_MAX_BYTES || buffer.duration > SOUND_MAX_SECONDS + SOUND_LENGTH_TOLERANCE) {
    return setSoundStatus('Esse trecho ficou grande demais.');
  }
  name = name.trim().slice(0, SOUND_NAME_MAX) || 'Áudio';
  const sound = { id: crypto.randomUUID(), name, data, buffer };
  sounds.mine.push(sound);
  try {
    await storeMySounds();
  } catch (err) {
    console.warn('storeMySounds', err);
    sounds.mine = sounds.mine.filter((s) => s !== sound);
    renderSoundPanel();
    return setSoundStatus('Não consegui salvar o áudio neste PC.');
  }
  broadcastSounds(soundMessage(sound));
  setSoundStatus('');
  renderSoundPanel();
}

async function removeMySound(id) {
  sounds.mine = sounds.mine.filter((s) => s.id !== id);
  broadcastSounds({ type: 'sound-remove', id });
  setSoundStatus('');
  renderSoundPanel();
  await storeMySounds().catch((err) => console.warn('storeMySounds', err));
}

// ---------- Editor (nome + trecho) ----------

const SOUND_GRAB_PX = 14; // perto assim da borda, pega a borda

const editor = {
  source: null,   // { name, data, buffer }
  start: 0,
  end: 0,
  peaks: null,    // pico por coluna de pixel
  drag: null,     // { mode: 'start'|'end'|'move', offset }
  preview: null,  // { node, at } tocando o trecho
  raf: 0,
};

function openSoundEditor(source) {
  editor.source = source;
  editor.start = 0;
  editor.end = Math.min(source.buffer.duration, SOUND_MAX_SECONDS);
  editor.peaks = null;
  $('sound-edit-name').value = source.name.trim().slice(0, SOUND_NAME_MAX);
  $('sound-edit-save').disabled = false;
  $('sound-edit').showModal();
  $('sound-edit-name').select();
  drawSoundWave();
}

function closeSoundEditor() {
  stopSoundPreview();
  editor.source = null;
  editor.peaks = null;
  if ($('sound-edit').open) $('sound-edit').close();
}

function formatSeconds(s) {
  return `${s.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

function wavePeaks(buffer, columns) {
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const per = buffer.length / columns;
  const peaks = new Float32Array(columns);
  let top = 0;
  for (let c = 0; c < columns; c++) {
    const from = Math.floor(c * per);
    const to = Math.min(buffer.length, Math.floor((c + 1) * per));
    const step = Math.max(1, Math.floor((to - from) / 400)); // arquivo longo: amostra
    let max = 0;
    for (const ch of chans) for (let i = from; i < to; i += step) max = Math.max(max, Math.abs(ch[i]));
    peaks[c] = max;
    top = Math.max(top, max);
  }
  if (top > 0) for (let c = 0; c < columns; c++) peaks[c] /= top;
  return peaks;
}

function drawSoundWave() {
  const canvas = $('sound-wave');
  const { buffer } = editor.source ?? {};
  if (!buffer) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h || !editor.peaks) {
    canvas.width = w;
    canvas.height = h;
    editor.peaks = wavePeaks(buffer, Math.max(1, Math.floor(w / (3 * dpr))));
  }
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--cyan').trim() || '#19f0ff';
  const muted = css.getPropertyValue('--muted').trim() || '#8b8899';
  const g = canvas.getContext('2d');
  const dur = buffer.duration;
  const xOf = (t) => (t / dur) * w;
  const x0 = xOf(editor.start);
  const x1 = xOf(editor.end);

  g.clearRect(0, 0, w, h);
  g.fillStyle = accent;
  g.globalAlpha = 0.12;
  g.fillRect(x0, 0, x1 - x0, h);

  const bar = w / editor.peaks.length;
  editor.peaks.forEach((p, i) => {
    const x = i * bar;
    const inside = x + bar / 2 >= x0 && x + bar / 2 <= x1;
    const bh = Math.max(2 * dpr, p * (h - 16 * dpr));
    g.globalAlpha = inside ? 0.95 : 0.35;
    g.fillStyle = inside ? accent : muted;
    g.fillRect(x + bar * 0.2, (h - bh) / 2, Math.max(1, bar * 0.6), bh);
  });

  // Bordas com pegador.
  g.globalAlpha = 1;
  g.fillStyle = accent;
  for (const x of [x0, x1]) {
    g.fillRect(x - dpr, 0, 2 * dpr, h);
    g.fillRect(x - 4 * dpr, h / 2 - 12 * dpr, 8 * dpr, 24 * dpr);
  }

  if (editor.preview) {
    const ctx = state.audioCtx;
    const t = editor.start + (ctx.currentTime - editor.preview.at);
    g.fillStyle = '#fff';
    g.fillRect(xOf(Math.min(t, editor.end)) - dpr / 2, 0, dpr, h);
  }

  $('sound-edit-range').textContent =
    `${formatSeconds(editor.start)} → ${formatSeconds(editor.end)} · ${formatSeconds(editor.end - editor.start)}`;
}

function waveTime(e) {
  const rect = $('sound-wave').getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  return { t: f * editor.source.buffer.duration, px: e.clientX - rect.left, rect };
}

// Mexe uma borda. Passou de 10 s, a outra vem junto; nunca menor que o mínimo.
function setSoundEdge(which, t) {
  const dur = editor.source.buffer.duration;
  const span = Math.min(SOUND_MAX_SECONDS, dur);
  if (which === 'start') {
    editor.start = Math.min(Math.max(0, t), dur - SOUND_MIN_SECONDS);
    editor.end = Math.min(Math.max(editor.end, editor.start + SOUND_MIN_SECONDS), editor.start + span, dur);
  } else {
    editor.end = Math.max(Math.min(dur, t), SOUND_MIN_SECONDS);
    editor.start = Math.max(Math.min(editor.start, editor.end - SOUND_MIN_SECONDS), editor.end - span, 0);
  }
}

$('sound-wave').addEventListener('pointerdown', (e) => {
  if (!editor.source) return;
  const { t, px, rect } = waveTime(e);
  const dur = editor.source.buffer.duration;
  const toPx = (s) => (s / dur) * rect.width;
  const dStart = Math.abs(px - toPx(editor.start));
  const dEnd = Math.abs(px - toPx(editor.end));
  if (Math.min(dStart, dEnd) <= SOUND_GRAB_PX) {
    editor.drag = { mode: dStart < dEnd ? 'start' : 'end' };
  } else if (t > editor.start && t < editor.end) {
    editor.drag = { mode: 'move', offset: t - editor.start };
  } else {
    // Clicou fora: puxa a borda mais perto pra lá.
    editor.drag = { mode: t < editor.start ? 'start' : 'end' };
    setSoundEdge(editor.drag.mode, t);
  }
  $('sound-wave').setPointerCapture(e.pointerId);
  stopSoundPreview();
  drawSoundWave();
});

$('sound-wave').addEventListener('pointermove', (e) => {
  if (!editor.drag || !editor.source) return;
  const { t } = waveTime(e);
  if (editor.drag.mode === 'move') {
    const len = editor.end - editor.start;
    const start = Math.min(Math.max(0, t - editor.drag.offset), editor.source.buffer.duration - len);
    editor.start = start;
    editor.end = start + len;
  } else {
    setSoundEdge(editor.drag.mode, t);
  }
  drawSoundWave();
});

for (const ev of ['pointerup', 'pointercancel']) {
  $('sound-wave').addEventListener(ev, () => { editor.drag = null; });
}

function playSoundPreview() {
  const ctx = state.audioCtx;
  if (!ctx || !editor.source) return;
  stopSoundPreview();
  const node = ctx.createBufferSource();
  node.buffer = editor.source.buffer;
  const gain = ctx.createGain();
  gain.gain.value = soundVolume();
  node.connect(gain).connect(ctx.destination);
  node.addEventListener('ended', () => { if (editor.preview?.node === node) stopSoundPreview(); });
  node.start(0, editor.start, editor.end - editor.start);
  editor.preview = { node, at: ctx.currentTime };
  $('sound-edit-play').textContent = '■ Parar';
  const frame = () => {
    if (!editor.preview) return;
    drawSoundWave();
    editor.raf = requestAnimationFrame(frame);
  };
  frame();
}

function stopSoundPreview() {
  const p = editor.preview;
  editor.preview = null;
  cancelAnimationFrame(editor.raf);
  if (p) {
    try { p.node.stop(); } catch {}
    drawSoundWave();
  }
  $('sound-edit-play').textContent = '▶ Ouvir';
}

$('sound-edit-play').addEventListener('click', () => (editor.preview ? stopSoundPreview() : playSoundPreview()));
$('sound-edit-cancel').addEventListener('click', closeSoundEditor);
$('sound-edit').addEventListener('close', closeSoundEditor);
$('sound-edit-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('sound-edit-save').click(); });
$('sound-edit-save').addEventListener('click', async () => {
  const source = editor.source;
  if (!source) return;
  $('sound-edit-save').disabled = true;
  stopSoundPreview();
  const room = state.room;
  const name = $('sound-edit-name').value;
  try {
    const cut = await cutSound(source, editor.start, editor.end);
    if (state.room !== room || editor.source !== source) return;
    closeSoundEditor();
    await addMySound(name, cut.data, cut.buffer);
  } catch (err) {
    console.warn('cutSound', err);
    setSoundStatus('Não consegui cortar esse áudio.');
    closeSoundEditor();
  }
  $('sound-add').disabled = sounds.mine.length >= SOUND_MAX_PER_PERSON;
});

// ---------- Painel ----------

function setSoundStatus(text) {
  $('sound-status').textContent = text;
}

function soundRow(ownerId, sound, removable) {
  const row = document.createElement('div');
  row.className = 'sound-row';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'sound-play';
  play.disabled = !sound.buffer;
  play.textContent = `▶ ${sound.name}`;
  play.title = sound.name;
  play.addEventListener('click', () => triggerSound(ownerId, sound.id));
  row.append(play);
  if (removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost icon';
    remove.textContent = '✕';
    remove.title = 'Remover';
    remove.addEventListener('click', () => removeMySound(sound.id));
    row.append(remove);
  }
  return row;
}

function renderSoundPanel() {
  if ($('sound-panel').hidden) return;
  $('sound-mine-title').textContent = `Seus áudios (${sounds.mine.length}/${SOUND_MAX_PER_PERSON})`;
  $('sound-mine').replaceChildren(...sounds.mine.map((s) => soundRow(state.myId, s, true)));
  $('sound-add').disabled = sounds.mine.length >= SOUND_MAX_PER_PERSON;

  const others = [];
  for (const m of state.members.values()) {
    if (!m.sounds?.size) continue;
    const h = document.createElement('h3');
    h.textContent = m.name;
    others.push(h, ...[...m.sounds.values()].map((s) => soundRow(m.id, s, false)));
  }
  $('sound-others').replaceChildren(...others);
}

function closeSoundPanel() {
  $('sound-panel').hidden = true;
}

$('btn-sounds').addEventListener('click', async () => {
  if (!$('sound-panel').hidden) return closeSoundPanel();
  $('sound-panel').hidden = false;
  $('sound-volume').value = String(Math.round(soundVolume() * 100));
  setSoundStatus('');
  renderSoundPanel();
  await sounds.ready;
  renderSoundPanel();
});
$('sound-add').addEventListener('click', () => $('sound-file').click());
$('sound-file').addEventListener('change', async () => {
  const file = $('sound-file').files[0];
  $('sound-file').value = '';
  if (!file) return;
  $('sound-add').disabled = true;
  await sounds.ready;
  await pickMySound(file);
  $('sound-add').disabled = sounds.mine.length >= SOUND_MAX_PER_PERSON;
});
$('sound-volume').addEventListener('input', () => savePref('soundVolume', String($('sound-volume').value / 100)));
document.addEventListener('pointerdown', (e) => {
  if ($('sound-panel').hidden || e.target.closest('#sound-panel, #btn-sounds, #sound-edit')) return;
  closeSoundPanel();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sound-edit').open) closeSoundPanel(); });
