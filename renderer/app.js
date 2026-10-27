'use strict';

// Topologia: mesh de voz. Cada pessoa tem um peer "main" com ID aleatório,
// usado pra mídia e dados. O host também segura um peer "beacon" com o ID
// fixo da sala (ROOM_PREFIX + código); quem entra fala com o beacon só pra
// receber a lista de membros e depois conecta direto em cada um.
// Se o host sai, o membro mais antigo (menor seq) assume o beacon.

const ROOM_PREFIX = 'baderna-v1-';
const SPEAKING_THRESHOLD = 0.02;
const ICE_GRACE_MS = 4000;
const BEACON_RETRY_MS = 2000;
const BEACON_MAX_TRIES = 30;
const WELCOME_TIMEOUT_MS = 10000;
const ROSTER_STALE_MS = 15000;

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// Tela vai em mesh também: quem compartilha manda uma cópia pra cada um.
const SHARE_PRESETS = {
  '720p30': { width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_500_000 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, maxBitrate: 8_000_000 },
};
const SCREEN_AUDIO_BITRATE = 128_000;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  room: null,
  name: null,
  mainPeer: null,
  beacon: null,
  localStream: null,
  myId: null,
  seq: 0,          // ordem de entrada; define quem herda o host
  nextSeq: 1,      // só usado pelo host
  hostId: null,
  muted: false,
  leaving: false,
  members: new Map(), // peerId -> member
  roster: new Map(),  // só no host: peerId -> { name, seq }
  selfLi: null,
  audioCtx: null,
  meters: new Map(),  // peerId -> { src, analyser, buf }
  rafId: 0,
  preview: null,      // teste de microfone no lobby: { stream, ctx, raf }
  previewToken: 0,
  screen: null,       // minha tela compartilhada: { stream, preset, mode, audio }
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

// ---------- Entrar / sair ----------

async function join() {
  const name = $('name').value.trim();
  const room = normalizeRoom($('room').value);
  $('room').value = room;
  if (!name || !room) return setLobbyStatus('Preencha nome e código da sala.');
  savePref('name', name);

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
      becomeHost();
    } else {
      await joinViaBeacon();
    }
    showRoom();
    setLobbyStatus('');
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
  for (const id of [...state.members.keys()]) removeMember(id);
  destroyPeer(state.beacon);
  destroyPeer(state.mainPeer);
  state.localStream?.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(state.rafId);
  for (const id of [...state.meters.keys()]) removeMeter(id);
  await state.audioCtx?.close().catch(() => {});

  Object.assign(state, {
    room: null, mainPeer: null, beacon: null, localStream: null, myId: null,
    seq: 0, nextSeq: 1, hostId: null, muted: false, leaving: false,
    roster: new Map(), selfLi: null, audioCtx: null, rafId: 0,
  });
  $('members').replaceChildren();
  $('stage').replaceChildren();
  $('stage').hidden = true;
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
        members: [...state.roster].map(([id, r]) => ({ id, ...r })),
      });
      state.roster.set(conn.peer, { name: conn.metadata?.name ?? '?', seq });
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
}

async function claimBeaconWithRetry() {
  setRoomStatus('Host saiu. Assumindo a sala…');
  // O servidor do PeerJS pode demorar pra liberar o ID se o host caiu sem fechar.
  for (let i = 0; i < BEACON_MAX_TRIES; i++) {
    if (!state.mainPeer || state.hostId !== state.myId) return;
    try {
      if (await tryClaimBeacon()) {
        becomeHost();
        setRoomStatus('Você agora é o host.');
        return;
      }
    } catch (err) {
      console.warn(err);
    }
    await sleep(BEACON_RETRY_MS);
  }
  setRoomStatus('Não deu pra assumir o código da sala. Quem já está aqui continua conectado, mas ninguém novo consegue entrar.');
}

// ---------- Membros ----------

function wireMainPeer() {
  const peer = state.mainPeer;

  peer.on('connection', (conn) => {
    const { name, seq, muted } = conn.metadata ?? {};
    const member = upsertMember(conn.peer, { name, seq, muted: !!muted });
    attachConn(member, conn);
  });

  peer.on('call', (call) => {
    const member = upsertMember(call.peer, {});
    if (call.metadata?.kind === 'screen') {
      call.answer(undefined, { sdpTransform: opusStereo }); // só recebe
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
    metadata: { name: state.name, seq: state.seq, muted: state.muted },
    reliable: true,
  }));
  attachCall(member, state.mainPeer.call(id, state.localStream));
}

function upsertMember(id, { name, seq, muted }) {
  let m = state.members.get(id);
  if (!m) {
    const audio = new Audio();
    audio.autoplay = true;
    applySink(audio);
    m = {
      id, name: '…', seq: Infinity, muted: false, conn: null, call: null, audio, iceTimer: 0, li: null,
      screenIn: null,  // tela dele chegando pra mim
      screenOut: null, // minha tela indo pra ele
    };
    m.li = createTile(m);
    state.members.set(id, m);
    $('members').append(m.li);
  }
  if (name !== undefined) m.name = name;
  if (seq !== undefined) m.seq = seq;
  if (muted !== undefined) m.muted = muted;
  if (state.hostId === state.myId) state.roster.set(id, { name: m.name, seq: m.seq });
  renderTile(m);
  return m;
}

function attachConn(member, conn) {
  member.conn = conn;
  conn.on('data', (msg) => handleMessage(member, msg));
  conn.on('close', () => removeMember(member.id));
  conn.on('open', () => {
    watchIce(member, conn.peerConnection);
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
    case 'mute':
      member.muted = !!msg.muted;
      renderTile(member);
      break;
    case 'host':
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
  m.li.remove();
  removeMeter(id);
  if (!state.leaving && id === state.hostId) handleHostLeft();
}

// ---------- Compartilhar tela ----------

async function openSharePicker() {
  if (state.screen) return stopShare();
  if (!window.baderna) return setRoomStatus('Compartilhar tela só funciona no app.');

  const dialog = $('share-dialog');
  $('share-quality').value = loadPref('shareQuality') || '1080p30';
  $('share-mode').value = loadPref('shareMode') || 'motion';
  $('share-audio').checked = loadPref('shareAudio') !== 'off';
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
        setRoomStatus(`Tela indo sem áudio: ${err.message}`);
      }
    }
    await beginShare(stream, presetKey, mode, audio);
  } catch (err) {
    console.error(err);
    setRoomStatus(err?.name === 'NotAllowedError'
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
  offs.push(window.baderna.onScreenAudioError((msg) => setRoomStatus(`Áudio da tela parou: ${msg}`)));

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

// Separado do seletor pra dar pra testar com qualquer stream de vídeo.
async function beginShare(stream, presetKey, mode, audio = null) {
  stopShare();
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

  state.screen = { stream, preset, mode, audio };
  for (const m of state.members.values()) sendScreenTo(m);
  showScreen(state.myId, `${state.name} (você)`, stream, false);
  updateShareButton();
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
  hideScreen(state.myId);
  updateShareButton();
  renderSelf();
}

function sendScreenTo(member) {
  if (!state.screen || member.screenOut) return;
  const call = state.mainPeer.call(member.id, state.screen.stream, {
    metadata: { kind: 'screen' },
    sdpTransform: opusStereo,
  });
  if (!call) return;
  member.screenOut = call;
  tuneScreenSender(call.peerConnection, state.screen.preset, state.screen.mode);
  call.on('close', () => {
    if (member.screenOut === call) member.screenOut = null;
  });
}

// Bitrate padrão do WebRTC é baixo pra tela cheia; sobe pro preset escolhido.
function tuneScreenSender(pc, preset, mode) {
  if (!pc) return;
  const apply = async () => {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind === 'audio') {
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = SCREEN_AUDIO_BITRATE;
        await sender.setParameters(params).catch((err) => console.warn('setParameters audio', err));
        continue;
      }
      if (sender.track?.kind !== 'video') continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = preset.maxBitrate;
      params.encodings[0].maxFramerate = preset.frameRate;
      params.degradationPreference = mode === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
      try {
        await sender.setParameters(params);
      } catch {
        delete params.degradationPreference;
        await sender.setParameters(params).catch((err) => console.warn('setParameters', err));
      }
    }
  };
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'connected') apply();
  });
}

function attachScreenIn(member, call) {
  member.screenIn?.close();
  member.screenIn = call;
  call.on('stream', (stream) => {
    showScreen(member.id, member.name, stream, true);
    renderTile(member);
  });
  call.on('close', () => {
    if (member.screenIn === call) closeScreenIn(member);
  });
}

function closeScreenIn(member) {
  const call = member.screenIn;
  member.screenIn = null;
  call?.close();
  hideScreen(member.id);
  if (state.members.has(member.id)) renderTile(member);
}

// audible: toca o áudio da tela. Falso na minha própria prévia (já ouço o original).
function showScreen(id, label, stream, audible) {
  let fig = [...$('stage').children].find((el) => el.dataset.id === id);
  if (!fig) {
    fig = document.createElement('figure');
    fig.className = 'screen';
    fig.dataset.id = id;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = !audible;
    applySink(video);
    const caption = document.createElement('figcaption');
    const name = document.createElement('span');
    caption.append(name);
    if (audible) {
      const volume = document.createElement('input');
      volume.type = 'range';
      volume.min = '0';
      volume.max = '1';
      volume.step = '0.05';
      volume.value = '1';
      volume.title = 'Volume da tela';
      volume.addEventListener('input', () => { video.volume = Number(volume.value); });
      caption.append(volume);
    }
    const full = document.createElement('button');
    full.type = 'button';
    full.textContent = '⛶';
    full.title = 'Tela cheia (ou duplo clique)';
    full.addEventListener('click', () => toggleFullscreen(fig));
    caption.append(full);
    fig.append(video, caption);
    fig.addEventListener('dblclick', () => toggleFullscreen(fig));
    $('stage').append(fig);
  }
  fig.querySelector('span').textContent = label;
  fig.querySelector('video').srcObject = stream;
  $('stage').hidden = false;
}

function hideScreen(id) {
  const fig = [...$('stage').children].find((el) => el.dataset.id === id);
  if (!fig) return;
  if (document.fullscreenElement === fig) document.exitFullscreen().catch(() => {});
  fig.querySelector('video').srcObject = null;
  fig.remove();
  $('stage').hidden = $('stage').children.length === 0;
}

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen().catch((err) => console.warn('fullscreen', err));
}

function updateShareButton() {
  $('share').textContent = state.screen ? '⏹️ Parar de compartilhar' : '🖥️ Compartilhar tela';
  $('share').classList.toggle('active', !!state.screen);
}

// ---------- Microfone ----------

function toggleMute() {
  state.muted = !state.muted;
  state.localStream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; });
  broadcast({ type: 'mute', muted: state.muted });
  $('mute').textContent = state.muted ? '🔇 Desmutar' : '🎤 Mutar';
  $('mute').classList.toggle('active', state.muted);
  renderSelf();
}

// ---------- Indicador de quem está falando ----------

function addMeter(id, stream) {
  removeMeter(id);
  state.audioCtx ??= new AudioContext();
  const src = state.audioCtx.createMediaStreamSource(stream);
  const analyser = state.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  state.meters.set(id, { src, analyser, buf: new Float32Array(analyser.fftSize) });
  if (!state.rafId) tick();
}

function removeMeter(id) {
  const meter = state.meters.get(id);
  if (!meter) return;
  meter.src.disconnect();
  state.meters.delete(id);
}

function tick() {
  for (const [id, { analyser, buf }] of state.meters) {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const speaking = Math.sqrt(sum / buf.length) > SPEAKING_THRESHOLD;
    const li = id === state.myId ? state.selfLi : state.members.get(id)?.li;
    li?.classList.toggle('speaking', speaking);
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
}

function fillSelect(select, devices, preferred) {
  const current = select.value || preferred;
  select.replaceChildren(...devices.map((d, i) => new Option(d.label || `Dispositivo ${i + 1}`, d.deviceId)));
  if (devices.some((d) => d.deviceId === current)) select.value = current;
}

function applySink(audio) {
  const id = $('speaker').value;
  if (id && audio.setSinkId) audio.setSinkId(id).catch((err) => console.warn('setSinkId', err));
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

// ---------- UI ----------

function createTile(member) {
  const li = document.createElement('li');
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  const name = document.createElement('div');
  name.className = 'member-name';
  const meta = document.createElement('div');
  meta.className = 'member-meta';
  li.append(avatar, name, meta);

  if (member) {
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.05';
    volume.value = '1';
    volume.title = 'Volume';
    volume.addEventListener('input', () => { member.audio.volume = Number(volume.value); });
    li.append(volume);
  }
  return li;
}

function fillTile(li, name, tags) {
  li.querySelector('.avatar').textContent = (name || '?').charAt(0).toUpperCase();
  li.querySelector('.member-name').textContent = name;
  li.querySelector('.member-meta').textContent = tags.filter(Boolean).join(' · ');
}

function renderTile(m) {
  fillTile(m.li, m.name, [m.id === state.hostId && '👑 host', m.muted && '🔇 mutado', m.screenIn && '🖥️ tela']);
}

function renderSelf() {
  if (!state.selfLi) return;
  fillTile(state.selfLi, state.name, [
    'você', state.myId === state.hostId && '👑 host', state.muted && '🔇 mutado', state.screen && '🖥️ tela',
  ]);
}

function renderAll() {
  renderSelf();
  for (const m of state.members.values()) renderTile(m);
  const host = state.hostId === state.myId;
  $('role').textContent = host ? 'host' : 'convidado';
}

function showRoom() {
  state.selfLi = createTile(null);
  $('members').prepend(state.selfLi);
  addMeter(state.myId, state.localStream);
  $('room-title').textContent = `Sala ${state.room}`;
  $('mute').textContent = '🎤 Mutar';
  $('mute').classList.remove('active');
  setRoomStatus('');
  renderAll();
  $('lobby').hidden = true;
  $('room-view').hidden = false;
}

function showLobby() {
  $('room-view').hidden = true;
  $('lobby').hidden = false;
}

function setLobbyStatus(text) { $('lobby-status').textContent = text; }
function setRoomStatus(text) { $('room-status').textContent = text; }

function normalizeRoom(raw) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
}

function randomRoomCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function describeError(err) {
  if (err?.name === 'NotAllowedError') return 'Permissão de microfone negada.';
  if (err?.name === 'NotFoundError') return 'Nenhum microfone encontrado.';
  if (err?.type === 'network' || err?.type === 'server-error') return 'Sem conexão com o servidor do PeerJS.';
  return err?.message || String(err);
}

// ---------- Boot ----------

$('name').value = loadPref('name');
$('mic').addEventListener('change', () => {
  savePref('micId', $('mic').value);
  startPreview();
});
$('speaker').addEventListener('change', () => {
  savePref('speakerId', $('speaker').value);
  for (const m of state.members.values()) applySink(m.audio);
  for (const v of $('stage').querySelectorAll('video')) applySink(v);
});
navigator.mediaDevices.addEventListener('devicechange', () => populateDevices().catch(console.warn));
initDevices().catch(console.warn);
$('gen').addEventListener('click', () => { $('room').value = randomRoomCode(); });
$('join').addEventListener('click', join);
$('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
$('mute').addEventListener('click', toggleMute);
$('leave').addEventListener('click', leave);
$('share').addEventListener('click', openSharePicker);
$('share-cancel').addEventListener('click', () => $('share-dialog').close());
window.addEventListener('beforeunload', () => {
  broadcast({ type: 'bye' });
  destroyPeer(state.beacon);
});
