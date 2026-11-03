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

async function addMySound(file) {
  if (sounds.mine.length >= SOUND_MAX_PER_PERSON) return setSoundStatus(`Limite de ${SOUND_MAX_PER_PERSON} áudios por pessoa.`);
  if (file.size > SOUND_MAX_BYTES) return setSoundStatus('Arquivo grande demais (máx. 512 KB). MP3 ou OGG costumam caber.');
  const room = state.room;
  const data = await file.arrayBuffer();
  let buffer;
  try {
    buffer = await decodeSound(data);
  } catch {
    return setSoundStatus('Não consegui abrir esse arquivo como áudio.');
  }
  if (state.room !== room) return;
  if (buffer.duration > SOUND_MAX_SECONDS) return setSoundStatus(`Áudio longo demais (máx. ${SOUND_MAX_SECONDS} s).`);
  const name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, SOUND_NAME_MAX) || 'Áudio';
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
  await addMySound(file);
  $('sound-add').disabled = sounds.mine.length >= SOUND_MAX_PER_PERSON;
});
$('sound-volume').addEventListener('input', () => savePref('soundVolume', String($('sound-volume').value / 100)));
document.addEventListener('pointerdown', (e) => {
  if ($('sound-panel').hidden || e.target.closest('#sound-panel') || e.target.closest('#btn-sounds')) return;
  closeSoundPanel();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSoundPanel(); });
