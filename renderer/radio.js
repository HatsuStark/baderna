'use strict';

// Rádio da sala: quem clica na caixa de som vira DJ e manda o som de um app
// do PC (Spotify, Deezer, navegador…) capturado pelo proc-audio.exe. Só quem
// sintoniza recebe, numa chamada só de áudio (Opus estéreo), igual à
// transmissão: sem vídeo, ~128 kbps por ouvinte.
//
// Mensagens no DataChannel:
//   radio { on, title, since }  DJ anuncia, troca a música ou para (on: false);
//                               vai também pra quem chega depois.
//   radio-tune { on }           quero ouvir / parei. Vai pra todos (fone no
//                               boneco); o DJ liga ou desliga a chamada.
// Chamada: metadata.kind 'radio'. Só aceito a do DJ atual, e só se sintonizei.
// Rádio para (DJ saiu ou parou): ninguém fica sintonizado.

const RADIO_TITLE_POLL_MS = 4000;
const RADIO_TITLE_MAX = 120;
const RADIO_DUCK_LEVEL = 0.3;   // volume enquanto alguém fala
const RADIO_DUCK_DOWN_MS = 120; // abaixa rápido
const RADIO_DUCK_UP_MS = 700;   // volta devagar
// Spotify parado mostra só o nome do app no título da janela.
const RADIO_IDLE_TITLES = /^(spotify( premium| free)?|deezer|tidal|youtube music)$/i;

const radio = {
  dj: null,              // id do DJ (state.myId se sou eu)
  since: 0,              // quando a rádio começou (desempate se 2 viram DJ juntos)
  title: '',
  mine: null,            // sou DJ: { capture, stream, sourceId, timer }
  tuned: false,          // estou ouvindo
  listeners: new Set(),  // ids de quem está ouvindo (eu incluso)
  call: null,            // chamada vinda do DJ
  audio: new Audio(),
  duck: 1,
  applied: -1,
};
radio.audio.autoplay = true;

const isDj = (id) => !!radio.dj && radio.dj === id;
const radioVolume = () => {
  const v = Number(loadPref('radioVol'));
  return loadPref('radioVol') !== '' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6;
};
const radioDuckOn = () => loadPref('radioDuck') !== 'off';

function cleanRadioTitle(raw) {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, RADIO_TITLE_MAX) : '';
  return RADIO_IDLE_TITLES.test(t) ? '' : t;
}

function radioPhones(id) {
  if (isDj(id)) return 'dj';
  return radio.dj && radio.listeners.has(id) ? 'on' : null;
}

// ---------- DJ ----------

async function openRadioPicker() {
  if (!window.baderna?.startMusicAudio) return addSystem('A rádio só funciona no app.');
  if (radio.dj && !isDj(state.myId)) return;
  const dialog = $('radio-dialog');
  $('radio-stop').hidden = !radio.mine;
  $('radio-sources').textContent = 'Carregando…';
  dialog.showModal();
  let sources;
  try {
    sources = (await window.baderna.listScreens()).filter((s) => !s.isScreen);
  } catch (err) {
    console.error(err);
    $('radio-sources').textContent = 'Não consegui listar as janelas.';
    return;
  }
  // Apps de música conhecidos primeiro.
  const known = /spotify|deezer|tidal|youtube|music|música|vlc|winamp|foobar|soundcloud|apple/i;
  sources.sort((a, b) => known.test(b.name) - known.test(a.name));
  $('radio-sources').replaceChildren(...sources.map((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const img = document.createElement('img');
    img.src = s.thumbnail;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = s.name;
    label.title = s.name;
    btn.append(img, label);
    btn.addEventListener('click', () => {
      dialog.close();
      startRadio(s.id);
    });
    return btn;
  }));
  if (!sources.length) $('radio-sources').textContent = 'Nenhuma janela aberta. Abre o app de música e tenta de novo.';
}

async function startRadio(sourceId) {
  if (radio.dj && !isDj(state.myId)) return addSystem('Já tem DJ na sala.');
  const b = window.baderna;
  let capture;
  try {
    capture = await startPcmCapture(sourceId, {
      start: b.startMusicAudio, stop: b.stopMusicAudio, onData: b.onMusicAudioData, onError: b.onMusicAudioError,
      failed: (msg) => {
        addSystem(`A rádio parou: ${msg}`);
        stopRadio();
      },
    });
  } catch (err) {
    console.error(err);
    return addSystem(`Não deu pra ligar a rádio: ${describeError(err)}`);
  }
  if (!state.mainPeer || (radio.dj && !isDj(state.myId))) {
    capture.stop();
    return;
  }
  // Trocou de app sem parar: as chamadas abertas continuam, só troca a trilha.
  const old = radio.mine;
  const stream = old?.stream ?? new MediaStream();
  if (old) {
    clearInterval(old.timer);
    old.capture.stop();
    stream.getTracks().forEach((t) => stream.removeTrack(t));
  }
  stream.addTrack(capture.track);
  radio.mine = { capture, stream, sourceId, timer: setInterval(pollRadioTitle, RADIO_TITLE_POLL_MS) };
  if (old) {
    for (const m of state.members.values()) {
      m.radioOut?.peerConnection?.getSenders().forEach((s) => s.track?.kind === 'audio' && s.replaceTrack(capture.track));
    }
  } else {
    radio.dj = state.myId;
    radio.since = Date.now();
    radio.listeners.clear();
    radio.title = '';
    addSystem('🎧 Você virou DJ. Quem clicar na caixa de som ouve o que sai desse app.');
    logEvent('rádio: virei DJ');
    renderSelf();
  }
  await pollRadioTitle();
  announceRadio();
  for (const id of radio.listeners) {
    const m = state.members.get(id);
    if (m) sendRadioTo(m);
  }
  renderRadio();
}

function announceRadio() {
  if (!radio.mine) return;
  broadcast({ type: 'radio', on: true, title: radio.title, since: radio.since });
}

async function pollRadioTitle() {
  const mine = radio.mine;
  if (!mine) return;
  const raw = await window.baderna.musicTitle(mine.sourceId).catch(() => null);
  if (radio.mine !== mine) return;
  // Janela sumiu: app fechado.
  if (raw === '') {
    addSystem('A janela do app de música fechou: a rádio parou.');
    return stopRadio();
  }
  const title = cleanRadioTitle(raw);
  if (title === radio.title) return;
  radio.title = title;
  announceRadio();
  renderRadio();
}

function stopRadio({ silent = false } = {}) {
  const mine = radio.mine;
  if (!mine) return;
  radio.mine = null;
  clearInterval(mine.timer);
  mine.capture.stop();
  for (const m of state.members.values()) closeRadioTo(m);
  if (state.mainPeer) broadcast({ type: 'radio', on: false });
  logEvent('rádio: parei');
  if (!silent) addSystem('Você parou a rádio.');
  clearRadio();
}

function sendRadioTo(member) {
  if (!radio.mine || member.radioOut || !state.mainPeer) return;
  const call = state.mainPeer.call(member.id, radio.mine.stream, {
    metadata: { kind: 'radio' },
    sdpTransform: opusStereo,
  });
  if (!call) return;
  member.radioOut = call;
  watchPath(call.peerConnection, 'rádio enviada', member);
  call.on('close', () => {
    if (member.radioOut === call) member.radioOut = null;
  });
}

function closeRadioTo(member) {
  const call = member.radioOut;
  member.radioOut = null;
  call?.close();
}

// ---------- Ouvinte ----------

function tuneRadio(on) {
  if (!radio.dj || isDj(state.myId) || radio.tuned === on) return;
  radio.tuned = on;
  if (on) radio.listeners.add(state.myId);
  else {
    radio.listeners.delete(state.myId);
    dropRadioCall();
  }
  broadcast({ type: 'radio-tune', on });
  renderRadio();
  renderSelf();
}

function dropRadioCall() {
  const call = radio.call;
  radio.call = null;
  call?.close();
  radio.audio.srcObject = null;
}

// Chamada 'radio' (wireMainPeer em app.js).
function answerRadioCall(call) {
  if (!radio.tuned || call.peer !== radio.dj) {
    call.close();
    return;
  }
  call.answer(undefined, { sdpTransform: opusStereo });
  radio.call?.close();
  radio.call = call;
  const member = state.members.get(call.peer);
  if (member) watchPath(call.peerConnection, 'rádio recebida', member);
  call.on('stream', (stream) => {
    if (radio.call !== call) return;
    radio.audio.srcObject = stream;
    applySink(radio.audio);
    applyRadioVolume();
    radio.audio.play().catch(() => {});
  });
  call.on('close', () => {
    if (radio.call !== call) return;
    radio.call = null;
    radio.audio.srcObject = null;
  });
}

function applyRadioVolume() {
  const v = state.deaf ? 0 : radioVolume() * radio.duck;
  if (Math.abs(v - radio.applied) < 0.005) return;
  radio.applied = v;
  radio.audio.volume = v;
}

// Chamado pelo tick() de app.js: abaixa a música enquanto alguém fala.
function radioDuckTick(othersSpeaking, dt) {
  if (!radio.call) return;
  const target = othersSpeaking && radioDuckOn() ? RADIO_DUCK_LEVEL : 1;
  if (radio.duck === target) return;
  const step = dt / (target < radio.duck ? RADIO_DUCK_DOWN_MS : RADIO_DUCK_UP_MS);
  radio.duck = target < radio.duck ? Math.max(target, radio.duck - step) : Math.min(target, radio.duck + step);
  applyRadioVolume();
}

// ---------- Rede ----------

function handleRadioMessage(member, msg) {
  if (msg.type === 'radio-tune') {
    if (msg.on) radio.listeners.add(member.id);
    else radio.listeners.delete(member.id);
    if (radio.mine) {
      if (msg.on) sendRadioTo(member);
      else closeRadioTo(member);
    }
    renderRadio();
    renderSeat(member);
    return;
  }
  if (!msg.on) {
    if (isDj(member.id)) {
      addSystem(`${member.name} parou a rádio.`);
      clearRadio();
    }
    return;
  }
  const since = Number(msg.since) || Date.now();
  if (radio.dj && !isDj(member.id)) {
    // Dois viraram DJ quase juntos: fica quem começou antes (empate: menor id).
    const mineFirst = radio.since < since || (radio.since === since && radio.dj < member.id);
    if (mineFirst) return;
    if (radio.mine) {
      stopRadio({ silent: true });
      addSystem(`${member.name} virou DJ antes de você.`);
    } else clearRadio();
  }
  const isNew = !isDj(member.id);
  radio.dj = member.id;
  radio.since = since;
  radio.title = cleanRadioTitle(msg.title);
  if (isNew) {
    addSystem(`🎧 ${member.name} virou DJ. Clica na caixa de som pra ouvir.`);
    renderSeat(member);
  }
  renderRadio();
}

// Conexão nova abriu (attachConn em app.js).
function radioConnOpen(member, conn) {
  if (radio.mine) conn.send({ type: 'radio', on: true, title: radio.title, since: radio.since });
  // Reconectou com o DJ: avisa de novo que estou ouvindo (ele me tirou da lista).
  if (radio.tuned && isDj(member.id)) conn.send({ type: 'radio-tune', on: true });
}

// Saiu da sala (removeMember em app.js).
function radioMemberGone(member) {
  closeRadioTo(member);
  radio.listeners.delete(member.id);
  if (isDj(member.id)) {
    addSystem(`${member.name} saiu: a rádio parou.`);
    clearRadio();
    return;
  }
  renderRadio();
}

// Sem rádio: ninguém sintonizado, fones saem dos bonecos.
function clearRadio() {
  radio.dj = null;
  radio.since = 0;
  radio.title = '';
  radio.tuned = false;
  radio.listeners.clear();
  radio.duck = 1;
  dropRadioCall();
  renderRadio();
  if (state.mainPeer) renderAll();
}

// Saí da sala (teardown em app.js).
function resetRadio() {
  stopRadio({ silent: true });
  clearRadio();
}

// ---------- Tela ----------

function renderRadio() {
  const on = !!radio.dj;
  const mine = isDj(state.myId);
  const count = radio.listeners.size;
  $('radio-bar').hidden = !on;
  $('radio-box').classList.toggle('on', on);
  $('radio-box').classList.toggle('tuned', radio.tuned || mine);
  $('radio-label').textContent = on ? `● RÁDIO · ${count} OUVINDO` : 'RÁDIO';
  $('radio-box').title = !on ? 'Rádio da sala: clique pra virar DJ'
    : mine ? 'Trocar o app ou parar a rádio'
    : radio.tuned ? 'Parar de ouvir' : 'Ouvir a rádio';
  if (!on) return;
  const djName = mine ? 'você' : state.members.get(radio.dj)?.name ?? '…';
  const title = $('radio-title');
  title.replaceChildren();
  if (radio.title) {
    // "Artista - Música": artista em negrito.
    const [artist, ...rest] = radio.title.split(' - ');
    const b = document.createElement('b');
    b.textContent = rest.length ? artist : radio.title;
    title.append(b);
    if (rest.length) {
      const s = document.createElement('span');
      s.textContent = ` · ${rest.join(' - ')}`;
      title.append(s);
    }
  } else {
    const s = document.createElement('span');
    s.textContent = 'Pausado / sem título';
    title.append(s);
  }
  title.title = radio.title;
  $('radio-dj').textContent = `🎧 DJ ${djName}`;
  $('radio-count').textContent = `${count} ouvindo`;
  $('radio-bar').classList.toggle('playing', (radio.tuned || mine) && !!radio.title);
  $('radio-volume').hidden = !radio.tuned;
  const btn = $('radio-toggle');
  btn.classList.toggle('stop', radio.tuned || mine);
  btn.textContent = mine ? '■' : radio.tuned ? '■' : '▶';
  btn.title = mine ? 'Parar a rádio' : radio.tuned ? 'Parar de ouvir' : 'Ouvir';
}

function radioBoxClick() {
  if (!state.mainPeer) return;
  if (!radio.dj || isDj(state.myId)) return openRadioPicker();
  tuneRadio(!radio.tuned);
}

$('radio-box').addEventListener('click', radioBoxClick);
$('radio-toggle').addEventListener('click', () => {
  if (isDj(state.myId)) stopRadio();
  else tuneRadio(!radio.tuned);
});
$('radio-volume').value = String(radioVolume());
$('radio-volume').addEventListener('input', () => {
  savePref('radioVol', $('radio-volume').value);
  applyRadioVolume();
});
$('radio-cancel').addEventListener('click', () => $('radio-dialog').close());
$('radio-stop').addEventListener('click', () => {
  $('radio-dialog').close();
  stopRadio();
});
$('radio-duck').checked = radioDuckOn();
$('radio-duck').addEventListener('change', () => savePref('radioDuck', $('radio-duck').checked ? 'on' : 'off'));
