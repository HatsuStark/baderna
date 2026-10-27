'use strict';

// Topologia: mesh de voz. Cada pessoa tem um peer "main" com ID aleatório,
// usado pra mídia e dados. O host também segura um peer "beacon" com o ID
// fixo da sala (ROOM_PREFIX + código); quem entra fala com o beacon só pra
// receber a lista de membros e depois conecta direto em cada um.
// Se o host sai, o membro mais antigo (menor seq) assume o beacon.
//
// Mensagens no DataChannel: profile (nome/boneco/mudo), chat, theme (só do
// host), host, screen-stop, bye. Tudo que vem de fora é validado antes de
// chegar no DOM; texto sempre via textContent.

const ROOM_PREFIX = 'baderna-v1-';
const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_HOLD_MS = 250;
const MOUTH_HOLD_MS = 90; // boca segue as sílabas; segura só um pouquinho
const ICE_GRACE_MS = 4000;
const BEACON_RETRY_MS = 2000;
const BEACON_MAX_TRIES = 30;
const WELCOME_TIMEOUT_MS = 10000;
const ROSTER_STALE_MS = 15000;
const CHAT_MAX = 500;
const NAME_MAX = 24;
const CHAT_GROUP_MS = 2 * 60 * 1000;

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// Tela vai em mesh também: quem compartilha manda uma cópia pra cada um.
const SHARE_PRESETS = {
  '720p30': { width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_500_000 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, maxBitrate: 8_000_000 },
  '1440p60': { width: 2560, height: 1440, frameRate: 60, maxBitrate: 12_000_000 },
};
const SCREEN_AUDIO_BITRATE = 128_000;

// Bitrate pra mesma qualidade, relativo ao VP8 (base dos presets acima).
const CODEC_EFFICIENCY = { AV1: 0.55, H265: 0.6, VP9: 0.65, H264: 0.85, VP8: 1 };
const CODEC_FALLBACK_ORDER = ['AV1', 'H265', 'VP9', 'H264', 'VP8'];
const MIN_SCREEN_BITRATE = 300_000;
const VOICE_RESERVE_BPS = 50_000; // por pessoa: voz Opus + overhead
const UPLOAD_HEADROOM = 0.8;      // usa só 80% do upload informado

const NAME_COLORS = ['#19f0ff', '#ff2bd6', '#b6ff3b', '#ffb627', '#ff8a3d', '#a78bfa', '#4dd4ac'];

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  room: null,
  name: null,
  avatar: null,       // meu boneco (salvo no PC)
  theme: DEFAULT_THEME,
  mainPeer: null,
  beacon: null,
  localStream: null,
  myId: null,
  seq: 0,          // ordem de entrada; define quem herda o host
  nextSeq: 1,      // só usado pelo host
  hostId: null,
  muted: false,
  deaf: false,
  mutedBeforeDeaf: false,
  leaving: false,
  members: new Map(), // peerId -> member
  roster: new Map(),  // só no host: peerId -> { name, seq }
  selfSeat: null,
  audioCtx: null,
  meters: new Map(),  // peerId -> { src, analyser, buf, lastLoud, level }
  rafId: 0,
  preview: null,      // teste de microfone no lobby: { stream, ctx, raf }
  previewToken: 0,
  screen: null,       // minha tela compartilhada: { stream, preset, mode, audio, codecs }
  screens: new Map(), // telas visíveis: peerId -> { stream, label, audible, video, card }
  watching: null,     // peerId da tela aberta por cima do chat
  lastChat: null,     // { author, time, el } pra agrupar mensagens seguidas
  codecOrder: null,   // preferência de codec de vídeo desta máquina (medida uma vez)
  codecOrderPromise: null,
};

// ---------- PeerJS helpers ----------

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    const onError = (err) => {
      destroyPeer(peer);
      reject(err);
    };
    peer.once('open', () => {
      peer.off('error', onError);
      resolve(peer);
    });
    peer.once('error', onError);
  });
}

async function tryClaimBeacon() {
  try {
    state.beacon = await openPeer(ROOM_PREFIX + state.room);
    return true;
  } catch (err) {
    if (err.type === 'unavailable-id') return false;
    throw err;
  }
}

// destroy() emite 'disconnected' antes de marcar destroyed; sem tirar os
// listeners, o handler de reconnect re-registraria o ID.
function destroyPeer(peer) {
  if (!peer) return;
  peer.removeAllListeners();
  peer.destroy();
}

function broadcast(msg) {
  for (const m of state.members.values()) {
    if (m.conn?.open) m.conn.send(msg);
  }
}

function myProfile() {
  return { type: 'profile', name: state.name, avatar: state.avatar, muted: state.muted, deaf: state.deaf };
}

// ---------- Entrar / sair ----------

async function join() {
  const name = $('name').value.trim().slice(0, NAME_MAX);
  const room = normalizeRoom($('room').value);
  $('room').value = room;
  if (!name || !room) return setLobbyStatus('Preencha nome e código da sala.');
  savePref('name', name);
  savePref('lastRoom', room);

  $('join').disabled = true;
  try {
    setLobbyStatus('Abrindo microfone…');
    state.localStream = takePreviewStream() ?? await openMic($('mic').value);

    setLobbyStatus('Conectando…');
    state.name = name;
    state.room = room;
    state.mainPeer = await openPeer();
    state.myId = state.mainPeer.id;
    wireMainPeer();

    if (await tryClaimBeacon()) {
      state.seq = 0;
      // Sala salva volta com o último tema usado nela.
      state.theme = savedRoom(room)?.theme ?? DEFAULT_THEME;
      becomeHost();
    } else {
      await joinViaBeacon();
    }
    showRoom();
    setLobbyStatus('');
    ensureCodecOrder(); // mede em segundo plano; precisa do mic aberto pras stats
  } catch (err) {
    console.error(err);
    setLobbyStatus(describeError(err));
    await teardown();
    startPreview();
  } finally {
    $('join').disabled = false;
  }
}

function joinViaBeacon() {
  return new Promise((resolve, reject) => {
    const conn = state.mainPeer.connect(ROOM_PREFIX + state.room, {
      metadata: { name: state.name },
      reliable: true,
    });
    const timer = setTimeout(() => {
      conn.close();
      reject(new Error('A sala não respondeu. Tente de novo.'));
    }, WELCOME_TIMEOUT_MS);

    conn.on('data', (msg) => {
      if (msg?.type !== 'welcome') return;
      clearTimeout(timer);
      conn.close();
      state.seq = msg.seq;
      state.hostId = msg.hostId;
      if (THEMES[msg.theme]) state.theme = msg.theme;
      for (const m of msg.members) connectTo(m.id, m.name, m.seq);
      resolve();
    });
  });
}

async function leave() {
  state.leaving = true;
  broadcast({ type: 'bye' });
  await sleep(200); // deixa o "bye" sair antes de fechar tudo
  await teardown();
  showLobby();
  startPreview();
}

async function teardown() {
  state.leaving = true;
  stopShare();
  closeWatch();
  for (const id of [...state.members.keys()]) removeMember(id);
  for (const id of [...state.screens.keys()]) unregisterScreen(id);
  destroyPeer(state.beacon);
  destroyPeer(state.mainPeer);
  state.localStream?.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(state.rafId);
  for (const id of [...state.meters.keys()]) removeMeter(id);
  await state.audioCtx?.close().catch(() => {});

  Object.assign(state, {
    room: null, mainPeer: null, beacon: null, localStream: null, myId: null,
    seq: 0, nextSeq: 1, hostId: null, muted: false, deaf: false, mutedBeforeDeaf: false, leaving: false,
    roster: new Map(), selfSeat: null, audioCtx: null, rafId: 0, lastChat: null, theme: DEFAULT_THEME,
  });
  $('seats').replaceChildren();
  $('timeline').replaceChildren();
  $('live-chips').replaceChildren();
  applyTheme(DEFAULT_THEME);
}

// ---------- Host ----------

function becomeHost() {
  state.hostId = state.myId;
  state.roster = new Map([[state.myId, { name: state.name, seq: state.seq }]]);
  for (const m of state.members.values()) state.roster.set(m.id, { name: m.name, seq: m.seq });
  state.nextSeq = Math.max(...[...state.roster.values()].map((r) => r.seq).filter(Number.isFinite)) + 1;

  state.beacon.on('connection', (conn) => {
    conn.on('open', () => {
      const seq = state.nextSeq++;
      conn.send({
        type: 'welcome',
        seq,
        hostId: state.myId,
        theme: state.theme,
        members: [...state.roster].map(([id, r]) => ({ id, ...r })),
      });
      state.roster.set(conn.peer, { name: cleanName(conn.metadata?.name), seq });
      // Se o recém-chegado não completar a conexão comigo, some da lista.
      setTimeout(() => {
        if (!state.members.has(conn.peer)) state.roster.delete(conn.peer);
      }, ROSTER_STALE_MS);
      setTimeout(() => conn.close(), 1000);
    });
  });
  state.beacon.on('disconnected', () => state.beacon && !state.beacon.destroyed && state.beacon.reconnect());
  state.beacon.on('error', (err) => console.warn('beacon', err));

  broadcast({ type: 'host', hostId: state.myId });
  renderAll();
}

function handleHostLeft() {
  const candidates = [
    { id: state.myId, seq: state.seq },
    ...[...state.members.values()].map((m) => ({ id: m.id, seq: m.seq })),
  ].sort((a, b) => a.seq - b.seq);

  state.hostId = candidates[0].id;
  renderAll();
  if (state.hostId === state.myId) claimBeaconWithRetry();
  else addSystem(`${state.members.get(state.hostId)?.name ?? 'Alguém'} agora é o host.`);
}

async function claimBeaconWithRetry() {
  addSystem('O host saiu. Assumindo a sala…');
  // O servidor do PeerJS pode demorar pra liberar o ID se o host caiu sem fechar.
  for (let i = 0; i < BEACON_MAX_TRIES; i++) {
    if (!state.mainPeer || state.hostId !== state.myId) return;
    try {
      if (await tryClaimBeacon()) {
        becomeHost();
        addSystem('Você agora é o host.');
        return;
      }
    } catch (err) {
      console.warn(err);
    }
    await sleep(BEACON_RETRY_MS);
  }
  addSystem('Não deu pra assumir o código da sala. Quem já está aqui continua conectado, mas ninguém novo consegue entrar.');
}

// ---------- Membros ----------

function wireMainPeer() {
  const peer = state.mainPeer;

  peer.on('connection', (conn) => {
    const { name, seq, avatar } = conn.metadata ?? {};
    const isNew = !state.members.has(conn.peer);
    const member = upsertMember(conn.peer, { name, seq, avatar });
    attachConn(member, conn);
    // Só anuncia quem chegou depois de mim; o resto já estava aqui.
    if (isNew && Number(seq) > state.seq) addSystem(`${member.name} chegou na baderna.`);
  });

  peer.on('call', (call) => {
    const member = upsertMember(call.peer, {});
    if (call.metadata?.kind === 'screen') {
      // Só recebe. Responde na ordem de codec de quem manda: é a ordem da resposta que vale.
      const codecs = sanitizeCodecOrder(call.metadata.codecs);
      call.answer(undefined, { sdpTransform: (sdp) => opusStereo(preferVideoCodecs(sdp, codecs)) });
      attachScreenIn(member, call);
      return;
    }
    call.answer(state.localStream);
    attachCall(member, call);
  });

  peer.on('disconnected', () => {
    // Caiu só o signaling; as conexões P2P continuam. Reconecta pra novos chegarem.
    if (!peer.destroyed) peer.reconnect();
  });

  peer.on('error', (err) => {
    // peer-unavailable: alguém da lista já tinha saído. Ignora.
    if (err.type !== 'peer-unavailable') console.warn('main', err);
  });
}

function connectTo(id, name, seq) {
  if (id === state.myId || state.members.has(id)) return;
  const member = upsertMember(id, { name, seq });
  attachConn(member, state.mainPeer.connect(id, {
    metadata: { name: state.name, seq: state.seq, avatar: state.avatar },
    reliable: true,
  }));
  attachCall(member, state.mainPeer.call(id, state.localStream));
}

function upsertMember(id, { name, seq, avatar, muted, deaf }) {
  let m = state.members.get(id);
  if (!m) {
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = state.deaf;
    applySink(audio);
    m = {
      id, name: '…', seq: Infinity, avatar: null, muted: false, deaf: false,
      conn: null, call: null, audio, iceTimer: 0, seat: null,
      screenIn: null,  // tela dele chegando pra mim
      screenOut: null, // minha tela indo pra ele
    };
    m.seat = createSeat(m);
    state.members.set(id, m);
  }
  if (name !== undefined) m.name = cleanName(name);
  if (seq !== undefined && Number.isFinite(Number(seq))) m.seq = Number(seq);
  if (avatar !== undefined) m.avatar = sanitizeAvatar(avatar);
  if (muted !== undefined) m.muted = !!muted;
  if (deaf !== undefined) m.deaf = !!deaf;
  if (state.hostId === state.myId) state.roster.set(id, { name: m.name, seq: m.seq });
  renderSeat(m);
  sortSeats();
  updateCount();
  return m;
}

function attachConn(member, conn) {
  member.conn = conn;
  conn.on('data', (msg) => handleMessage(member, msg));
  conn.on('close', () => removeMember(member.id));
  conn.on('open', () => {
    watchIce(member, conn.peerConnection);
    conn.send(myProfile());
    // Quem chega depois também recebe a tela que já está rolando.
    if (state.screen) sendScreenTo(member);
  });
}

function attachCall(member, call) {
  member.call = call;
  call.on('stream', (stream) => {
    member.audio.srcObject = stream;
    member.audio.play().catch(() => {});
    addMeter(member.id, stream);
  });
  call.on('close', () => removeMember(member.id));
}

// PeerJS nem sempre dispara "close" quando o outro lado some; olha o ICE.
function watchIce(member, pc) {
  if (!pc) return;
  pc.addEventListener('iceconnectionstatechange', () => {
    const s = pc.iceConnectionState;
    clearTimeout(member.iceTimer);
    if (s === 'failed' || s === 'closed') removeMember(member.id);
    else if (s === 'disconnected') member.iceTimer = setTimeout(() => removeMember(member.id), ICE_GRACE_MS);
  });
}

function handleMessage(member, msg) {
  switch (msg?.type) {
    case 'profile': {
      const before = member.name;
      upsertMember(member.id, { name: msg.name, avatar: msg.avatar, muted: msg.muted, deaf: msg.deaf });
      if (before !== '…' && before !== member.name) addSystem(`${before} agora é ${member.name}.`);
      break;
    }
    case 'chat':
      if (typeof msg.text === 'string' && msg.text.trim()) addChat(member.id, member.name, member.avatar, msg.text);
      break;
    case 'theme':
      // Só o host manda no tema.
      if (member.id === state.hostId && THEMES[msg.theme] && msg.theme !== state.theme) {
        applyTheme(msg.theme);
        addSystem(`${member.name} mudou o tema pra ${THEMES[msg.theme].name}.`);
      }
      break;
    case 'host':
      if (typeof msg.hostId !== 'string') break;
      state.hostId = msg.hostId;
      renderAll();
      break;
    case 'screen-stop':
      closeScreenIn(member);
      break;
    case 'bye':
      removeMember(member.id);
      break;
  }
}

function removeMember(id) {
  const m = state.members.get(id);
  if (!m) return;
  state.members.delete(id);
  state.roster.delete(id);
  clearTimeout(m.iceTimer);
  m.conn?.close();
  m.call?.close();
  closeScreenIn(m);
  m.screenOut?.close();
  m.audio.srcObject = null;
  m.seat.remove();
  removeMeter(id);
  updateCount();
  if (state.leaving) return;
  addSystem(`${m.name} saiu.`);
  if (id === state.hostId) handleHostLeft();
}

// ---------- Chat ----------

function sendChat(e) {
  e.preventDefault();
  const text = $('chat-input').value.trim().slice(0, CHAT_MAX);
  if (!text || !state.mainPeer) return;
  $('chat-input').value = '';
  broadcast({ type: 'chat', text });
  addChat(state.myId, state.name, state.avatar, text);
}

function addChat(authorId, name, avatar, rawText) {
  const text = String(rawText).slice(0, CHAT_MAX);
  const now = Date.now();
  const last = state.lastChat;
  const grouped = last && last.author === authorId && now - last.time < CHAT_GROUP_MS;

  const msg = document.createElement('div');
  msg.className = grouped ? 'msg cont' : 'msg';
  const av = document.createElement('div');
  av.className = 'av';
  if (!grouped) av.innerHTML = avatarFaceSvg(avatar); // SVG sanitizado em avatar.js
  const body = document.createElement('div');
  body.className = 'body';
  if (!grouped) {
    const who = document.createElement('div');
    who.className = 'who';
    const b = document.createElement('b');
    b.textContent = name;
    b.style.color = nameColor(authorId);
    const time = document.createElement('time');
    time.textContent = new Date(now).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    who.append(b, time);
    body.append(who);
  }
  const p = document.createElement('p');
  p.textContent = text;
  body.append(p);
  msg.append(av, body);
  appendTimeline(msg);
  state.lastChat = { author: authorId, time: now };
}

function addSystem(text) {
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'sys';
  el.textContent = text;
  appendTimeline(el);
  state.lastChat = null;
}

function appendTimeline(el) {
  const tl = $('timeline');
  const nearBottom = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 120;
  tl.append(el);
  if (nearBottom) tl.scrollTop = tl.scrollHeight;
}

function nameColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

// ---------- Tema da sala ----------

function applyTheme(id) {
  const theme = THEMES[id] ? id : DEFAULT_THEME;
  state.theme = theme;
  $('wall').innerHTML = themeSvg(theme);
  document.documentElement.style.setProperty('--bg', THEMES[theme].bg);
  // Faixa de título e botões do Windows na cor do tema.
  document.documentElement.style.setProperty('--titlebar-bg', THEMES[theme].bg);
  window.baderna?.setTitlebarColor(THEMES[theme].bg);
  $('theme-name').textContent = THEMES[theme].name;
  for (const btn of $('theme-grid').querySelectorAll('button')) {
    btn.classList.toggle('selected', btn.dataset.theme === theme);
  }
}

function setTheme(id) {
  if (state.hostId !== state.myId || !THEMES[id] || id === state.theme) return;
  applyTheme(id);
  broadcast({ type: 'theme', theme: id });
  addSystem(`Você mudou o tema pra ${THEMES[id].name}.`);
  rememberRoomTheme();
}

function buildThemeGrid() {
  if ($('theme-grid').children.length) return;
  for (const [id, theme] of Object.entries(THEMES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.theme = id;
    btn.innerHTML = `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">${themeSvg(id)}</svg>`;
    const label = document.createElement('span');
    label.textContent = theme.name;
    btn.append(label);
    btn.addEventListener('click', () => setTheme(id));
    $('theme-grid').append(btn);
  }
}

// ---------- Compartilhar tela ----------

async function openSharePicker() {
  if (state.screen) return stopShare();
  if (!window.baderna) return addSystem('Compartilhar tela só funciona no app.');

  const dialog = $('share-dialog');
  $('share-quality').value = loadPref('shareQuality') || '1080p30';
  $('share-mode').value = loadPref('shareMode') || 'motion';
  $('share-audio').checked = loadPref('shareAudio') !== 'off';
  $('share-upload').value = loadPref('uploadMbps');
  updateShareEstimate();
  ensureCodecOrder().then(updateShareEstimate);
  $('sources').textContent = 'Carregando…';
  dialog.showModal();

  let sources;
  try {
    sources = await window.baderna.listScreens();
  } catch (err) {
    console.error(err);
    $('sources').textContent = 'Não consegui listar as telas.';
    return;
  }

  const groups = [['Telas', sources.filter((s) => s.isScreen)], ['Janelas', sources.filter((s) => !s.isScreen)]];
  $('sources').replaceChildren();
  for (const [title, list] of groups) {
    if (!list.length) continue;
    const h = document.createElement('h3');
    h.textContent = title;
    $('sources').append(h);
    for (const s of list) {
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
        shareSource(s.id);
      });
      $('sources').append(btn);
    }
  }
}

async function shareSource(sourceId) {
  const presetKey = $('share-quality').value;
  const mode = $('share-mode').value;
  const withAudio = $('share-audio').checked;
  savePref('shareQuality', presetKey);
  savePref('shareMode', mode);
  savePref('shareAudio', withAudio ? 'on' : 'off');
  stopShare();
  try {
    await window.baderna.selectScreen(sourceId);
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    let audio = null;
    if (withAudio) {
      try {
        audio = await startScreenAudio(sourceId);
        stream.addTrack(audio.track);
      } catch (err) {
        console.error(err);
        addSystem(`Tela indo sem áudio: ${err.message}`);
      }
    }
    await beginShare(stream, presetKey, mode, audio);
  } catch (err) {
    console.error(err);
    addSystem(err?.name === 'NotAllowedError'
      ? 'Compartilhamento cancelado ou bloqueado pelo sistema.'
      : `Não deu pra compartilhar: ${describeError(err)}`);
  }
}

// Liga o proc-audio.exe e transforma o PCM dele numa MediaStreamTrack.
async function startScreenAudio(sourceId) {
  const res = await window.baderna.startScreenAudio(sourceId);
  if (!res.ok) throw new Error(res.error);

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const offs = [];
  try {
    await ctx.audioWorklet.addModule('pcm-worklet.js');
  } catch (err) {
    window.baderna.stopScreenAudio();
    ctx.close();
    throw err;
  }
  const player = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  player.connect(dest);

  offs.push(window.baderna.onScreenAudioData((bytes) => {
    const pcm = new Int16Array(bytes.slice().buffer);
    player.port.postMessage(pcm, [pcm.buffer]);
  }));
  offs.push(window.baderna.onScreenAudioError((msg) => addSystem(`Áudio da tela parou: ${msg}`)));

  const track = dest.stream.getAudioTracks()[0];
  track.contentHint = 'music';
  return {
    track,
    stop() {
      offs.forEach((off) => off());
      window.baderna.stopScreenAudio();
      track.stop();
      ctx.close().catch(() => {});
    },
  };
}

// Opus em estéreo e com bitrate de música; o padrão é mono pensado pra voz.
function opusStereo(sdp) {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (_line, params) =>
    `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=${SCREEN_AUDIO_BITRATE}`);
}

// ---------- Codec de vídeo ----------

// Põe os codecs de vídeo da m-line na ordem pedida; o primeiro que os dois
// lados suportam é o usado. Codecs auxiliares (rtx, red, ulpfec) vão pro fim.
function preferVideoCodecs(sdp, order) {
  const lines = sdp.split('\r\n');
  const start = lines.findIndex((l) => l.startsWith('m=video'));
  if (start < 0) return sdp;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('m='));
  if (end < 0) end = lines.length;

  const codecOf = {};
  for (const l of lines.slice(start, end)) {
    const m = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(l);
    if (m) codecOf[m[1]] = m[2].toUpperCase();
  }
  const rank = (pt) => {
    const i = order.indexOf(codecOf[pt]);
    return i < 0 ? order.length : i;
  };
  const [media, port, proto, ...pts] = lines[start].split(' ');
  lines[start] = [media, port, proto, ...pts.sort((a, b) => rank(a) - rank(b))].join(' ');
  return lines.join('\r\n');
}

function sanitizeCodecOrder(list) {
  const known = Array.isArray(list) ? list.filter((c) => CODEC_FALLBACK_ORDER.includes(c)) : [];
  return [...new Set([...known, ...CODEC_FALLBACK_ORDER])];
}

// Melhor codec com encoder na placa; sem placa, VP9 por software (se a CPU
// aguentar) ou H.264 na placa.
function videoCodecOrder(hw) {
  const first = ['AV1', 'H265'].find((c) => hw[c])
    ?? (navigator.hardwareConcurrency >= 8 || !hw.H264 ? 'VP9' : 'H264');
  return sanitizeCodecOrder([first]);
}

function ensureCodecOrder() {
  state.codecOrderPromise ??= probeHardwareEncoders()
    .catch((err) => {
      console.warn('probeHardwareEncoders', err);
      return {};
    })
    .then((hw) => (state.codecOrder = videoCodecOrder(hw)));
  return state.codecOrderPromise;
}

// mediaCapabilities.powerEfficient não é confiável no Electron, então mede:
// codifica um canvas numa conexão local e olha powerEfficientEncoder nas
// stats (só aparece com captura ativa, por isso roda com o mic aberto).
async function probeHardwareEncoders() {
  const key = `hwEncoders:${navigator.userAgent}`;
  const cached = loadPref(key);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const g = canvas.getContext('2d');
  let n = 0;
  const timer = setInterval(() => {
    g.fillStyle = `hsl(${(n++ * 10) % 360}, 70%, 50%)`;
    g.fillRect(0, 0, canvas.width, canvas.height);
  }, 33);
  const track = canvas.captureStream(30).getVideoTracks()[0];
  const caps = RTCRtpSender.getCapabilities('video')?.codecs ?? [];

  const result = {};
  let measured = false;
  try {
    for (const name of ['AV1', 'H265', 'H264']) {
      const prefs = caps.filter((c) => c.mimeType.toUpperCase() === `VIDEO/${name}`);
      if (!prefs.length) continue;
      const hw = await encodesInHardware(track, prefs);
      if (hw !== undefined) measured = true;
      result[name] = !!hw;
    }
  } finally {
    clearInterval(timer);
    track.stop();
  }
  if (measured) savePref(key, JSON.stringify(result));
  return result;
}

async function encodesInHardware(track, codecPrefs) {
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  try {
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
    a.addTransceiver(track, { direction: 'sendonly' }).setCodecPreferences(codecPrefs);
    await a.setLocalDescription();
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription();
    await a.setRemoteDescription(b.localDescription);
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      let hw;
      (await a.getStats()).forEach((s) => {
        if (s.type === 'outbound-rtp' && s.powerEfficientEncoder !== undefined) hw = s.powerEfficientEncoder;
      });
      if (hw !== undefined) return hw;
    }
    return undefined;
  } finally {
    a.close();
    b.close();
  }
}

// ---------- Orçamento de upload ----------

function uploadBudgetBps() {
  const mbps = Number(loadPref('uploadMbps'));
  return mbps > 0 ? mbps * 1e6 : 0;
}

// Quanto cada pessoa assistindo recebe. Sem limite de upload, vai o ideal do
// preset ajustado pelo codec; com limite, divide o que sobra depois da voz.
function screenBitrate({ preset, codec, viewers, withAudio, budget }) {
  const ideal = preset.maxBitrate * (CODEC_EFFICIENCY[codec] ?? 1);
  if (!budget) return { perViewer: Math.round(ideal), limited: false };
  const voice = VOICE_RESERVE_BPS * Math.max(1, state.members.size);
  const share = (budget * UPLOAD_HEADROOM - voice) / Math.max(1, viewers) - (withAudio ? SCREEN_AUDIO_BITRATE : 0);
  const perViewer = Math.round(Math.max(MIN_SCREEN_BITRATE, Math.min(ideal, share)));
  return { perViewer, limited: perViewer < ideal };
}

const mbps = (bps) => (bps / 1e6).toFixed(1).replace('.', ',');

// Recalcula o bitrate de cada cópia da tela. Roda quando alguém começa a
// receber ou para; assim quem entra/sai redistribui o upload.
async function retuneScreen() {
  const screen = state.screen;
  if (!screen) return;
  const pcs = [...state.members.values()]
    .map((m) => m.screenOut?.peerConnection)
    .filter((pc) => pc?.connectionState === 'connected');
  const viewers = [...state.members.values()].filter((m) => m.screenOut).length;
  const budget = uploadBudgetBps();
  const codecs = new Set();
  let total = 0;

  for (const pc of pcs) {
    for (const sender of pc.getSenders()) {
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      if (sender.track?.kind === 'audio') {
        params.encodings[0].maxBitrate = SCREEN_AUDIO_BITRATE;
        await sender.setParameters(params).catch((err) => console.warn('setParameters audio', err));
        continue;
      }
      if (sender.track?.kind !== 'video') continue;
      const codec = params.codecs?.[0]?.mimeType.split('/')[1]?.toUpperCase() ?? 'VP8';
      codecs.add(codec);
      const { perViewer } = screenBitrate({ preset: screen.preset, codec, viewers, withAudio: !!screen.audio, budget });
      total += perViewer;
      params.encodings[0].maxBitrate = perViewer;
      params.encodings[0].maxFramerate = screen.preset.frameRate;
      params.degradationPreference = screen.mode === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
      try {
        await sender.setParameters(params);
      } catch {
        delete params.degradationPreference;
        await sender.setParameters(params).catch((err) => console.warn('setParameters', err));
      }
    }
  }

  if (state.screen !== screen) return;
  const info = pcs.length
    ? ` · ${[...codecs].join('/')} · ${pcs.length} × ${mbps(total / pcs.length)} Mbps = ${mbps(total)} Mbps`
    : '';
  setScreenLabel(state.myId, `Sua tela${info}`);
}

function updateShareEstimate() {
  const viewers = state.members.size;
  if (!viewers) {
    $('share-estimate').textContent = 'Ninguém na sala pra assistir ainda.';
    return;
  }
  const preset = SHARE_PRESETS[$('share-quality').value];
  const codec = state.codecOrder?.[0] ?? 'VP9';
  const budgetMbps = Number($('share-upload').value);
  const budget = budgetMbps > 0 ? budgetMbps * 1e6 : 0;
  const withAudio = $('share-audio').checked;
  const { perViewer, limited } = screenBitrate({ preset, codec, viewers, withAudio, budget });
  const total = (perViewer + (withAudio ? SCREEN_AUDIO_BITRATE : 0)) * viewers;
  $('share-estimate').textContent =
    `${viewers} assistindo × ${mbps(perViewer)} Mbps ≈ ${mbps(total)} Mbps de upload · codec ${codec}`
    + (budget ? ` · limite ${mbps(budget * UPLOAD_HEADROOM)} de ${budgetMbps} Mbps` : ' · sem limite')
    + (limited ? ' · qualidade reduzida pelo limite' : '');
}

// Separado do seletor pra dar pra testar com qualquer stream de vídeo.
async function beginShare(stream, presetKey, mode, audio = null) {
  stopShare();
  const codecs = await ensureCodecOrder();
  const preset = SHARE_PRESETS[presetKey] ?? SHARE_PRESETS['1080p30'];
  const track = stream.getVideoTracks()[0];
  track.contentHint = mode;
  try {
    await track.applyConstraints({
      width: { max: preset.width },
      height: { max: preset.height },
      frameRate: { max: preset.frameRate },
    });
  } catch (err) {
    console.warn('applyConstraints', err);
  }
  // Usuário pode parar pelo próprio sistema (ou a janela fechar).
  track.addEventListener('ended', stopShare);

  state.screen = { stream, preset, mode, audio, codecs };
  for (const m of state.members.values()) sendScreenTo(m);
  registerScreen(state.myId, 'Sua tela', stream, false);
  addSystem('Você começou a compartilhar a tela.');
  updateDock();
  renderSelf();
}

function stopShare() {
  if (!state.screen) return;
  const { stream, audio } = state.screen;
  state.screen = null;
  audio?.stop();
  stream.getTracks().forEach((t) => t.stop());
  for (const m of state.members.values()) {
    m.screenOut?.close();
    m.screenOut = null;
  }
  broadcast({ type: 'screen-stop' });
  unregisterScreen(state.myId);
  updateDock();
  renderSelf();
}

function sendScreenTo(member) {
  if (!state.screen || member.screenOut) return;
  const { codecs } = state.screen;
  const call = state.mainPeer.call(member.id, state.screen.stream, {
    metadata: { kind: 'screen', codecs },
    sdpTransform: (sdp) => opusStereo(preferVideoCodecs(sdp, codecs)),
  });
  if (!call) return;
  member.screenOut = call;
  const pc = call.peerConnection;
  pc?.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'connected') retuneScreen();
  });
  call.on('close', () => {
    if (member.screenOut !== call) return;
    member.screenOut = null;
    retuneScreen();
  });
}

function attachScreenIn(member, call) {
  member.screenIn?.close();
  member.screenIn = call;
  call.on('stream', (stream) => {
    registerScreen(member.id, `Tela de ${member.name}`, stream, true);
    renderSeat(member);
  });
  call.on('close', () => {
    if (member.screenIn === call) closeScreenIn(member);
  });
}

function closeScreenIn(member) {
  const call = member.screenIn;
  member.screenIn = null;
  call?.close();
  unregisterScreen(member.id);
  if (state.members.has(member.id)) renderSeat(member);
}

// ---------- Telas: card no chat + overlay por cima do chat ----------

// audible: toca o áudio da tela. Falso na minha própria prévia (já ouço o original).
function registerScreen(id, label, stream, audible) {
  let s = state.screens.get(id);
  // PeerJS dispara 'stream' uma vez por track (vídeo + áudio): mesmo stream, nada a fazer.
  if (s?.stream === stream) return;
  if (!s) {
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    applySink(video);
    s = { video, card: null };
    state.screens.set(id, s);
  }
  Object.assign(s, { stream, label, audible });
  s.video.srcObject = stream;
  s.card?.classList.add('ended');
  s.card = createScreenCard(id, label, stream);
  appendTimeline(s.card.closest('.msg'));
  state.lastChat = null;
  updateLiveChips();
  if (state.watching === id) watch(id);
}

function unregisterScreen(id) {
  const s = state.screens.get(id);
  if (!s) return;
  if (state.watching === id) closeWatch();
  state.screens.delete(id);
  s.video.srcObject = null;
  if (s.card) {
    s.card.classList.add('ended');
    s.card.querySelector('.shot').replaceChildren();
    s.card.querySelector('button').disabled = true;
  }
  updateLiveChips();
}

function createScreenCard(id, label, stream) {
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  const av = document.createElement('div');
  av.className = 'av';
  const avatar = id === state.myId ? state.avatar : state.members.get(id)?.avatar;
  av.innerHTML = avatarFaceSvg(avatar);
  const body = document.createElement('div');
  body.className = 'body';
  const who = document.createElement('div');
  who.className = 'who';
  const b = document.createElement('b');
  b.textContent = id === state.myId ? state.name : state.members.get(id)?.name ?? '…';
  b.style.color = nameColor(id);
  const time = document.createElement('time');
  time.textContent = 'ao vivo';
  who.append(b, time);

  const card = document.createElement('div');
  card.className = 'card';
  const shot = document.createElement('div');
  shot.className = 'shot';
  const thumb = document.createElement('video');
  thumb.autoplay = true;
  thumb.muted = true;
  thumb.playsInline = true;
  thumb.srcObject = stream;
  shot.append(thumb);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const span = document.createElement('span');
  span.textContent = label;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = id === state.myId ? 'Ver prévia ⤢' : 'Assistir ⤢';
  btn.addEventListener('click', () => watch(id));
  meta.append(span, btn);
  card.append(shot, meta);
  body.append(who, card);
  wrap.append(av, body);
  return card;
}

function watch(id) {
  const s = state.screens.get(id);
  if (!s) return;
  if (state.watching && state.watching !== id) closeWatch();
  state.watching = id;
  $('screen-box').replaceChildren(s.video);
  s.video.volume = Number($('screen-volume').value);
  s.video.muted = !s.audible || state.deaf;
  s.video.play().catch(() => {});
  $('screen-label').textContent = s.label;
  $('screen-volume').parentElement.hidden = !s.audible;
  $('screen-view').hidden = false;
}

function closeWatch() {
  const s = state.screens.get(state.watching);
  if (s) s.video.muted = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  state.watching = null;
  $('screen-box').replaceChildren();
  $('screen-view').hidden = true;
}

function setScreenLabel(id, label) {
  const s = state.screens.get(id);
  if (!s) return;
  s.label = label;
  if (s.card) s.card.querySelector('.meta span').textContent = label;
  if (state.watching === id) $('screen-label').textContent = label;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $('screen-view').requestFullscreen().catch((err) => console.warn('fullscreen', err));
}

function updateLiveChips() {
  const chips = [];
  for (const id of state.screens.keys()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip live';
    btn.textContent = id === state.myId ? 'você ao vivo' : `${state.members.get(id)?.name ?? '…'} ao vivo`;
    btn.addEventListener('click', () => watch(id));
    chips.push(btn);
  }
  $('live-chips').replaceChildren(...chips);
}

// ---------- Microfone / fone ----------

function setMuted(muted) {
  state.muted = muted;
  state.localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
}

function toggleMute() {
  // Mexer no mic estando surdo volta a ouvir e abre o mic, igual Discord.
  if (state.deaf) {
    state.mutedBeforeDeaf = false;
    return toggleDeaf();
  }
  setMuted(!state.muted);
  broadcast(myProfile());
  updateDock();
  renderSelf();
}

function toggleDeaf() {
  state.deaf = !state.deaf;
  if (state.deaf) {
    state.mutedBeforeDeaf = state.muted;
    setMuted(true);
  } else {
    setMuted(state.mutedBeforeDeaf);
  }
  for (const m of state.members.values()) m.audio.muted = state.deaf;
  const s = state.screens.get(state.watching);
  if (s) s.video.muted = !s.audible || state.deaf;
  broadcast(myProfile());
  updateDock();
  renderSelf();
}

async function switchMic(deviceId) {
  const stream = await openMic(deviceId);
  const track = stream.getAudioTracks()[0];
  track.enabled = !state.muted;
  for (const m of state.members.values()) {
    const sender = m.call?.peerConnection?.getSenders().find((s) => s.track?.kind === 'audio');
    await sender?.replaceTrack(track).catch((err) => console.warn('replaceTrack', err));
  }
  state.localStream?.getTracks().forEach((t) => t.stop());
  state.localStream = stream;
  addMeter(state.myId, stream);
}

// ---------- Indicador de quem está falando ----------

function addMeter(id, stream) {
  removeMeter(id);
  state.audioCtx ??= new AudioContext();
  const src = state.audioCtx.createMediaStreamSource(stream);
  const analyser = state.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  state.meters.set(id, { src, analyser, buf: new Float32Array(analyser.fftSize), lastLoud: 0, level: 0 });
  if (!state.rafId) tick();
}

function removeMeter(id) {
  const meter = state.meters.get(id);
  if (!meter) return;
  meter.src.disconnect();
  state.meters.delete(id);
}

// Cabeça falando: o volume (em dB) decide o tamanho do balanço, e cada pico
// de volume (sílaba) joga a cabeça pro outro lado. Quanto mais alto, maior e
// mais rápido. A pose persegue o alvo rápido, pra ter cara de recorte.
const SWAY_DB_FLOOR = -45;  // abaixo disso: quase parado
const SWAY_DB_CEIL = -12;   // grito: balanço máximo
const SWAY_MAX = { x: 12, y: 8, r: 18 };
const SWAY_EASE = 0.45;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function swayHead(seat, meter, speaking, now) {
  const head = seat.querySelector('.av-head');
  if (!head) return;
  meter.pose ??= { x: 0, y: 0, r: 0 };
  meter.target ??= { x: 0, y: 0, r: 0 };
  meter.side ??= 1;

  const db = meter.level > 0 ? 20 * Math.log10(meter.level) : -100;
  const amp = Math.min(1, Math.max(0, (db - SWAY_DB_FLOOR) / (SWAY_DB_CEIL - SWAY_DB_FLOOR)));
  const loud = meter.level > SPEAKING_THRESHOLD;
  const onset = loud && !meter.wasLoud;
  meter.wasLoud = loud;

  if (!speaking) {
    meter.target = { x: 0, y: 0, r: 0 };
  } else if (onset || (loud && now - (meter.lastPose ?? 0) > 170 - 90 * amp)) {
    meter.side = -meter.side;
    const jitter = 0.7 + Math.random() * 0.6;
    meter.target = REDUCED_MOTION
      ? { x: 0, y: -3, r: 0 }
      : {
          x: meter.side * (3 + SWAY_MAX.x * amp) * jitter,
          y: -(2 + (SWAY_MAX.y - 2) * amp),
          r: meter.side * (5 + (SWAY_MAX.r - 5) * amp) * jitter,
        };
    meter.lastPose = now;
  }

  const p = meter.pose;
  const t = meter.target;
  p.x += (t.x - p.x) * SWAY_EASE;
  p.y += (t.y - p.y) * SWAY_EASE;
  p.r += (t.r - p.r) * SWAY_EASE;
  const still = Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.r) < 0.05;
  head.style.transform = still ? '' : `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) rotate(${p.r.toFixed(2)}deg)`;
}

function tick() {
  const now = performance.now();
  for (const [id, meter] of state.meters) {
    meter.analyser.getFloatTimeDomainData(meter.buf);
    let sum = 0;
    for (const v of meter.buf) sum += v * v;
    meter.level = Math.sqrt(sum / meter.buf.length);
    if (meter.level > SPEAKING_THRESHOLD) meter.lastLoud = now;
    // Segura a boca aberta um pouco pra não piscar entre sílabas.
    const speaking = now - meter.lastLoud < SPEAKING_HOLD_MS;
    const seat = id === state.myId ? state.selfSeat : state.members.get(id)?.seat;
    seat?.classList.toggle('speaking', speaking);
    seat?.classList.toggle('loud', now - meter.lastLoud < MOUTH_HOLD_MS);
    if (seat) swayHead(seat, meter, speaking, now);
  }
  if ($('settings-dialog').open) {
    const mine = state.meters.get(state.myId);
    if (mine) $('mic-level').style.width = `${Math.min(100, mine.level * 400)}%`;
  }
  state.rafId = requestAnimationFrame(tick);
}

// ---------- Dispositivos e teste de microfone (lobby) ----------

function openMic(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } } : AUDIO_CONSTRAINTS,
    video: false,
  });
}

async function startPreview() {
  stopPreview();
  const token = ++state.previewToken;
  let stream;
  try {
    stream = await openMic($('mic').value);
  } catch (err) {
    console.error(err);
    setLobbyStatus(describeError(err));
    return;
  }
  if (token !== state.previewToken) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  state.preview = { stream, ctx, raf: 0 };

  const loop = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    $('mic-level').style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 400)}%`;
    state.preview.raf = requestAnimationFrame(loop);
  };
  loop();
}

function stopPreview() {
  const stream = takePreviewStream();
  stream?.getTracks().forEach((t) => t.stop());
}

// Para o medidor do lobby e devolve o stream aberto, pra reaproveitar na sala.
function takePreviewStream() {
  const p = state.preview;
  if (!p) return null;
  state.preview = null;
  cancelAnimationFrame(p.raf);
  p.ctx.close().catch(() => {});
  $('mic-level').style.width = '0';
  return p.stream;
}

async function populateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  fillSelect($('mic'), devices.filter((d) => d.kind === 'audioinput'), loadPref('micId'));
  fillSelect($('speaker'), devices.filter((d) => d.kind === 'audiooutput'), loadPref('speakerId'));
  updateMicName();
}

function fillSelect(select, devices, preferred) {
  const current = select.value || preferred;
  select.replaceChildren(...devices.map((d, i) => new Option(d.label || `Dispositivo ${i + 1}`, d.deviceId)));
  if (devices.some((d) => d.deviceId === current)) select.value = current;
}

function updateMicName() {
  const opt = $('mic').selectedOptions[0];
  $('mic-name').textContent = opt ? opt.textContent.replace(/^(Default|Padrão) - /, '') : 'Microfone padrão';
}

function applySink(el) {
  const id = $('speaker').value;
  if (id && el.setSinkId) el.setSinkId(id).catch((err) => console.warn('setSinkId', err));
}

async function initDevices() {
  // Abre o mic padrão primeiro: sem permissão, enumerateDevices vem sem nomes.
  await startPreview();
  await populateDevices();
  const usedId = state.preview?.stream.getAudioTracks()[0]?.getSettings().deviceId;
  if ($('mic').value && $('mic').value !== usedId) startPreview();
}

function loadPref(key) {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// ---------- Cadeiras ----------

const SEAT_SKELETON = '<div class="aura"></div><div class="ring"></div><div class="badges"></div><div class="figure"></div><div class="tag"></div>';

function createSeat(member) {
  const seat = document.createElement('div');
  seat.className = 'seat';
  seat.innerHTML = SEAT_SKELETON;
  if (member) {
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.className = 'vol';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = '1';
    vol.title = 'Volume';
    vol.addEventListener('input', () => { member.audio.volume = Number(vol.value); });
    seat.append(vol);
  }
  $('seats').append(seat);
  return seat;
}

function fillSeat(seat, { id, name, avatar, host, muted, deaf, sharing, self }) {
  const key = JSON.stringify(avatar);
  if (seat.dataset.avatar !== key) {
    seat.dataset.avatar = key;
    seat.querySelector('.figure').innerHTML = avatarSeatSvg(avatar); // sanitizado em avatar.js
  }
  seat.dataset.id = id;
  seat.classList.toggle('self', !!self);
  seat.querySelector('.tag').textContent = name;
  const badges = [];
  const badge = (cls, text, onClick) => {
    const el = document.createElement('span');
    el.className = `badge ${cls}`;
    el.textContent = text;
    if (onClick) el.addEventListener('click', onClick);
    badges.push(el);
  };
  if (host) badge('host', 'HOST');
  if (sharing) badge('share', 'AO VIVO', () => watch(id));
  if (deaf) badge('deaf', 'SURDO');
  else if (muted) badge('muted', 'MUDO');
  seat.querySelector('.badges').replaceChildren(...badges);
}

function renderSeat(m) {
  fillSeat(m.seat, {
    id: m.id, name: m.name, avatar: m.avatar, host: m.id === state.hostId,
    muted: m.muted, deaf: m.deaf, sharing: !!m.screenIn,
  });
}

function renderSelf() {
  if (!state.selfSeat) return;
  fillSeat(state.selfSeat, {
    id: state.myId, name: state.name, avatar: state.avatar, host: state.myId === state.hostId,
    muted: state.muted, deaf: state.deaf, sharing: !!state.screen, self: true,
  });
}

function sortSeats() {
  const entries = [...state.members.values()].map((m) => [m.seq, m.seat]);
  if (state.selfSeat) entries.push([state.seq, state.selfSeat]);
  entries.sort((a, b) => a[0] - b[0]);
  for (const [, seat] of entries) $('seats').append(seat);
}

function renderAll() {
  renderSelf();
  for (const m of state.members.values()) renderSeat(m);
  updateThemeControls();
}

function updateCount() {
  if (!state.room) return;
  const n = state.members.size + 1;
  $('count-chip').textContent = `${n} na baderna`;
  syncTray();
}

// Estado mostrado no ícone da bandeja (tooltip, menu e selo de mudo).
function syncTray() {
  window.baderna?.setTrayState({
    inRoom: !!state.mainPeer && !!state.room,
    muted: state.muted,
    deaf: state.deaf,
    room: (state.room && savedRoom(state.room)?.name) || state.room || '',
    count: state.members.size + 1,
  });
}

function updateDock() {
  $('btn-mic').classList.toggle('off', state.muted);
  $('btn-mic').title = state.muted ? 'Desmutar microfone' : 'Mutar microfone';
  $('btn-deaf').classList.toggle('off', state.deaf);
  $('btn-deaf').title = state.deaf ? 'Voltar a ouvir' : 'Silenciar tudo';
  $('btn-share').classList.toggle('on', !!state.screen);
  $('btn-share').title = state.screen ? 'Parar de compartilhar' : 'Compartilhar tela';
  syncTray();
}

function updateThemeControls() {
  const host = state.hostId === state.myId;
  $('theme-chip').disabled = !host;
  $('theme-chip').title = host ? 'Mudar tema da sala' : 'Só o host muda o tema';
  $('theme-note').textContent = host ? 'Você é o host: o tema muda pra todo mundo.' : 'Só o host muda o tema da sala.';
  for (const btn of $('theme-grid').querySelectorAll('button')) btn.disabled = !host;
}

// ---------- Editor de boneco ----------

let avatarDraft = null;

function openAvatarEditor() {
  avatarDraft = { ...state.avatar };
  renderAvatarEditor();
  $('avatar-dialog').showModal();
}

function renderAvatarEditor() {
  const preview = $('avatar-preview');
  preview.innerHTML = '<div class="aura"></div><div class="ring"></div>';
  preview.insertAdjacentHTML('beforeend', avatarSeatSvg(avatarDraft));

  const fields = [];
  for (const [key, options] of Object.entries(AVATAR_OPTIONS)) {
    const field = document.createElement('div');
    field.className = 'field';
    const h = document.createElement('h4');
    h.textContent = AVATAR_LABELS[key];
    const list = document.createElement('div');
    list.className = 'options';
    for (const value of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isColor = value.startsWith('#');
      btn.className = isColor ? 'swatch' : 'pill';
      if (isColor) btn.style.background = value;
      else btn.textContent = value;
      if (key === 'kit') {
        const chip = document.createElement('span');
        chip.className = 'kit-chip';
        chip.style.background = value === 'lisa' ? avatarDraft.shirt : KITS[value].swatch;
        btn.prepend(chip);
      }
      btn.title = value;
      btn.classList.toggle('selected', avatarDraft[key] === value);
      btn.addEventListener('click', () => {
        avatarDraft[key] = value;
        renderAvatarEditor();
      });
      list.append(btn);
    }
    field.append(h, list);
    fields.push(field);
  }
  const scroll = $('avatar-fields').scrollTop;
  $('avatar-fields').replaceChildren(...fields);
  $('avatar-fields').scrollTop = scroll;
}

function saveAvatar() {
  state.avatar = sanitizeAvatar(avatarDraft);
  savePref('avatar', JSON.stringify(state.avatar));
  $('avatar-dialog').close();
  renderLobbySeat();
  $('settings-face').innerHTML = avatarFaceSvg(state.avatar);
  if (state.mainPeer) {
    renderSelf();
    broadcast(myProfile());
  }
}

function renderLobbySeat() {
  if (!$('lobby-seat').firstChild) $('lobby-seat').innerHTML = SEAT_SKELETON;
  fillSeat($('lobby-seat'), { id: 'lobby', name: $('name').value.trim() || 'Você', avatar: state.avatar });
}

function loadAvatar() {
  try {
    const saved = loadPref('avatar');
    if (saved) return sanitizeAvatar(JSON.parse(saved));
  } catch {}
  // Primeira vez: sorteia um, pra ninguém entrar igual.
  const fresh = randomAvatar();
  savePref('avatar', JSON.stringify(fresh));
  return fresh;
}

// ---------- Configurações ----------

function openSettings(inRoom) {
  buildThemeGrid();
  applyTheme(state.theme);
  updateThemeControls();
  $('settings-face').innerHTML = avatarFaceSvg(state.avatar);
  $('settings-dialog').classList.toggle('lobby-mode', !inRoom);
  $('settings-dialog').showModal();
}

// ---------- Telas (lobby/sala) ----------

function showRoom() {
  state.selfSeat = createSeat(null);
  addMeter(state.myId, state.localStream);
  $('room-code').textContent = state.room;
  updateSaveChip();
  touchSavedRoom(state.room);
  applyTheme(state.theme);
  updateDock();
  updateCount();
  renderAll();
  sortSeats();
  $('lobby').hidden = true;
  $('room-view').hidden = false;
  addSystem(state.hostId === state.myId
    ? `Sala ${state.room} criada. Manda o código pra galera!`
    : `Você entrou na sala ${state.room}.`);
  $('chat-input').focus();
}

function showLobby() {
  $('room-view').hidden = true;
  $('lobby').hidden = false;
  $('titlebar-room').textContent = '';
  syncTray();
  renderLobbySeat();
  renderSavedRooms();
}

// ---------- Salas salvas ----------
// Só o código e um apelido, guardados neste PC. A sala em si não existe em
// lugar nenhum: quem entra primeiro com o código vira host e "recria".

const SAVED_MAX = 20;
const SAVED_NAME_MAX = 30;

function loadRooms() {
  try {
    const list = JSON.parse(loadPref('rooms') || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter((r) => r && typeof r.code === 'string' && r.code && normalizeRoom(r.code) === r.code)
      .map((r) => ({
        code: r.code,
        name: String(r.name || r.code).slice(0, SAVED_NAME_MAX),
        theme: THEMES[r.theme] ? r.theme : undefined,
      }));
  } catch {
    return [];
  }
}

function storeRooms(list) {
  savePref('rooms', JSON.stringify(list.slice(0, SAVED_MAX)));
}

function savedRoom(code) {
  return loadRooms().find((r) => r.code === code);
}

// Sala usada sobe pro topo da lista.
function touchSavedRoom(code) {
  const list = loadRooms();
  const i = list.findIndex((r) => r.code === code);
  if (i > 0) storeRooms([list[i], ...list.slice(0, i), ...list.slice(i + 1)]);
}

function rememberRoomTheme() {
  const list = loadRooms();
  const room = list.find((r) => r.code === state.room);
  if (!room) return;
  room.theme = state.theme;
  storeRooms(list);
}

function renderSavedRooms() {
  const rooms = loadRooms();
  $('saved-section').hidden = rooms.length === 0;
  $('saved-rooms').replaceChildren(...rooms.map((r) => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    const enter = document.createElement('button');
    enter.type = 'button';
    enter.className = 'enter';
    enter.title = `Entrar em ${r.name}`;
    const b = document.createElement('b');
    b.textContent = `★ ${r.name}`;
    const small = document.createElement('small');
    small.textContent = r.theme ? `${r.code} · ${THEMES[r.theme].name}` : r.code;
    enter.append(b, small);
    enter.addEventListener('click', () => {
      $('room').value = r.code;
      join();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '✕';
    remove.title = 'Remover dos salvos';
    remove.addEventListener('click', () => {
      storeRooms(loadRooms().filter((x) => x.code !== r.code));
      renderSavedRooms();
    });
    item.append(enter, remove);
    return item;
  }));
}

function updateSaveChip() {
  const saved = state.room && savedRoom(state.room);
  $('save-chip').textContent = saved ? `★ ${saved.name}` : '☆ salvar sala';
  $('save-chip').classList.toggle('is-saved', !!saved);
  $('titlebar-room').textContent = !state.room ? '' : saved ? saved.name : `sala ${state.room}`;
  syncTray();
}

function openSaveDialog() {
  const saved = savedRoom(state.room);
  $('save-name').value = saved?.name ?? '';
  $('save-code').textContent = state.room;
  $('save-remove').hidden = !saved;
  $('save-dialog').showModal();
  $('save-name').focus();
}

function confirmSaveRoom(e) {
  e.preventDefault();
  const name = $('save-name').value.trim().slice(0, SAVED_NAME_MAX) || state.room;
  const list = loadRooms().filter((r) => r.code !== state.room);
  list.unshift({ code: state.room, name, theme: state.theme });
  storeRooms(list);
  $('save-dialog').close();
  updateSaveChip();
  addSystem(`Sala salva como "${name}".`);
}

function removeCurrentRoom() {
  storeRooms(loadRooms().filter((r) => r.code !== state.room));
  $('save-dialog').close();
  updateSaveChip();
  addSystem('Sala removida dos salvos.');
}

function setLobbyStatus(text) { $('lobby-status').textContent = text; }

function cleanName(raw) {
  const name = typeof raw === 'string' ? raw.trim().slice(0, NAME_MAX) : '';
  return name || '?';
}

function normalizeRoom(raw) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
}

function randomRoomCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  // 12 caracteres: dá pra usar como sala fixa sem ninguém adivinhar.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

function describeError(err) {
  if (err?.name === 'NotAllowedError') return 'Permissão de microfone negada.';
  if (err?.name === 'NotFoundError') return 'Nenhum microfone encontrado.';
  if (err?.type === 'network' || err?.type === 'server-error') return 'Sem conexão com o servidor do PeerJS.';
  return err?.message || String(err);
}

// ---------- Boot ----------

state.avatar = loadAvatar();
applyTheme(DEFAULT_THEME);
$('name').value = loadPref('name');
$('room').value = loadPref('lastRoom');
renderLobbySeat();
renderSavedRooms();

$('save-chip').addEventListener('click', openSaveDialog);
$('save-form').addEventListener('submit', confirmSaveRoom);
$('save-cancel').addEventListener('click', () => $('save-dialog').close());
$('save-remove').addEventListener('click', removeCurrentRoom);

$('name').addEventListener('input', renderLobbySeat);
$('mic').addEventListener('change', () => {
  savePref('micId', $('mic').value);
  updateMicName();
  if (state.mainPeer) switchMic($('mic').value).catch((err) => addSystem(`Não deu pra trocar o microfone: ${describeError(err)}`));
  else startPreview();
});
$('speaker').addEventListener('change', () => {
  savePref('speakerId', $('speaker').value);
  for (const m of state.members.values()) applySink(m.audio);
  for (const s of state.screens.values()) applySink(s.video);
});
navigator.mediaDevices.addEventListener('devicechange', () => populateDevices().catch(console.warn));
initDevices().catch(console.warn);

$('gen').addEventListener('click', () => { $('room').value = randomRoomCode(); });
$('join').addEventListener('click', join);
$('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
$('audio-lobby').addEventListener('click', () => openSettings(false));
$('edit-avatar-lobby').addEventListener('click', openAvatarEditor);

$('composer').addEventListener('submit', sendChat);
$('room-chip').addEventListener('click', () => {
  navigator.clipboard.writeText(state.room ?? '').then(
    () => addSystem('Código da sala copiado.'),
    (err) => addSystem(`Não deu pra copiar o código: ${err.message}`),
  );
});
$('theme-chip').addEventListener('click', () => openSettings(true));

$('btn-mic').addEventListener('click', toggleMute);
$('btn-deaf').addEventListener('click', toggleDeaf);
$('btn-share').addEventListener('click', openSharePicker);
$('btn-settings').addEventListener('click', () => openSettings(true));
$('btn-leave').addEventListener('click', leave);

$('screen-close').addEventListener('click', closeWatch);
$('screen-full').addEventListener('click', toggleFullscreen);
$('screen-box').addEventListener('dblclick', toggleFullscreen);
$('screen-volume').addEventListener('input', () => {
  const s = state.screens.get(state.watching);
  if (s) s.video.volume = Number($('screen-volume').value);
});

$('settings-close').addEventListener('click', () => $('settings-dialog').close());
$('edit-avatar-room').addEventListener('click', openAvatarEditor);
$('avatar-random').addEventListener('click', () => {
  avatarDraft = randomAvatar();
  renderAvatarEditor();
});
$('avatar-cancel').addEventListener('click', () => $('avatar-dialog').close());
$('avatar-save').addEventListener('click', saveAvatar);

$('share-cancel').addEventListener('click', () => $('share-dialog').close());
$('share-upload').addEventListener('input', () => {
  savePref('uploadMbps', $('share-upload').value);
  updateShareEstimate();
});
for (const id of ['share-quality', 'share-audio']) $(id).addEventListener('change', updateShareEstimate);

window.addEventListener('beforeunload', () => {
  broadcast({ type: 'bye' });
  destroyPeer(state.beacon);
});
// Bandeja: ações do menu e a opção de fechar pra bandeja.
window.baderna?.onTrayAction((action) => {
  if (!state.mainPeer) return;
  if (action === 'mute') toggleMute();
  else if (action === 'deaf') toggleDeaf();
  else if (action === 'leave') leave();
});
$('close-to-tray').checked = loadPref('closeToTray') !== 'off';
window.baderna?.setTraySettings({ closeToTray: $('close-to-tray').checked });
$('close-to-tray').addEventListener('change', () => {
  savePref('closeToTray', $('close-to-tray').checked ? 'on' : 'off');
  window.baderna?.setTraySettings({ closeToTray: $('close-to-tray').checked });
});

document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
});
