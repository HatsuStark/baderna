'use strict';

// Topologia: mesh de voz. Cada pessoa tem um peer "main" com ID aleatório,
// usado pra mídia e dados. O host também segura um peer "beacon" com o ID
// fixo da sala (ROOM_PREFIX + código); quem entra fala com o beacon só pra
// receber a lista de membros e depois conecta direto em cada um.
// Se o host sai, o membro mais antigo (menor seq) assume o beacon.
//
// Mensagens no DataChannel: profile (nome/boneco/mudo), chat, theme (só do
// host), host, screen-stop, bye, movies (lista de filmes, em movies.js),
// watching (quais transmissões cada um tem abertas: só essas recebem vídeo),
// preview (foto da tela de quem transmite, a cada 4 s), caps (o que esta versão
// sabe fazer), screen-live (comecei a transmitir: a chamada de vídeo só sai
// quando alguém abre a transmissão). Tudo que vem de fora é validado antes de
// chegar no DOM; texto sempre via textContent.

const ROOM_PREFIX = 'baderna-v1-';
const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_HOLD_MS = 250;
const MOUTH_HOLD_MS = 90; // boca segue as sílabas; segura só um pouquinho
const RECENT_TALK_MS = 2500; // tela cheia: miniatura fica um pouco depois de parar de falar
const ICE_GRACE_MS = 4000;
const BEACON_RETRY_MS = 2000;
const BEACON_MAX_TRIES = 30;
const WELCOME_TIMEOUT_MS = 10000;
const ROSTER_STALE_MS = 15000;
const CHAT_MAX = 500;
const NAME_MAX = 24;
const CHAT_GROUP_MS = 2 * 60 * 1000;

// Processamento do Chrome no microfone; cada um liga/desliga nas configurações.
const AUDIO_PROCESSING = {
  echoCancellation: 'Cancelamento de eco',
  autoGainControl: 'Ganho automático',
};

// Redução de ruído: Forte = IA (denoise-worklet.js, no lugar da do Chrome);
// Normal = a do Chrome.
const NOISE_MODES = { ai: 'Forte (IA)', normal: 'Normal', off: 'Desligada' };

// Sensibilidade: escala do medidor e do limiar do portão, em dB.
const GATE_DB_MIN = -70;
const GATE_DB_MAX = -10;

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

// Narrador da resenha: cada aviso sorteia uma frase. {n} nome, {b} nome
// antigo, {c} código da sala, {t} tema.
const NARRATION = {
  arrived: [
    '{n} chegou chutando a porta.', '{n} brotou na resenha.', '{n} entrou sem pedir licença.',
    'Olha quem apareceu: {n}.', '{n} chegou fora de hora, como sempre.', '{n} caiu de paraquedas na baderna.',
    'Segura que {n} chegou.', '{n} entrou igual reforço de janela.',
  ],
  left: [
    '{n} vazou.', '{n} foi comprar cigarro.', '{n} meteu o pé.', '{n} saiu de fininho (mas a gente viu).',
    '{n} pediu pra sair. Fraco.', '{n} foi dormir, amanhã tem trampo.', '{n} deu rage quit.',
  ],
  dropped: [
    '{n} caiu igual cone.', 'A internet de {n} pediu arrego.', '{n} sumiu igual sinal de 3G no túnel.',
    '{n} caiu. Culpa do roteador, segundo a pessoa.', '{n} desconectou. O gato deve ter puxado o cabo.',
  ],
  created: [
    'Sala {c} aberta. Manda o código pra galera!', 'Baderna {c} no ar. Chama a galera!',
    'Você abriu a {c}. Agora é esperar o pessoal (que sempre atrasa).',
  ],
  entered: ['Você entrou na sala {c}.', 'Você brotou na {c}. Fala aí!', 'Você chegou na {c} chutando a porta.'],
  newHost: ['{n} agora é o dono da bola.', '{n} pegou a faixa de capitão.', '{n} virou host. Respeita.'],
  meHost: ['Você agora é o dono da bola.', 'A faixa de capitão é sua: você é o host.'],
  hostGone: ['O dono da bola foi embora. Pegando a bola…', 'O host vazou. Assumindo a sala…'],
  renamed: ['{b} agora atende por {n}.', '{b} trocou de nome: agora é {n}.'],
  theme: ['{n} mudou o tema pra {t}.', '{n} redecorou: agora é {t}.', '{n} trocou o cenário pra {t}.'],
};

function narrate(kind, vars = {}) {
  const list = NARRATION[kind];
  return list[Math.floor(Math.random() * list.length)].replace(/\{(\w)\}/g, (_, k) => vars[k] ?? '');
}

const $ = (id) => document.getElementById(id);

// Registro de conexão em baderna.log (pasta do app, só neste PC): ajuda a
// entender quem não conectou e por quê. Sem senhas nem chaves.
function logEvent(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  window.baderna?.log?.(line);
}
const shortId = (id) => String(id).slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  room: null,
  name: null,
  avatar: null,       // meu boneco (salvo no PC)
  theme: DEFAULT_THEME,
  mainPeer: null,
  beacon: null,
  localStream: null,  // microfone cru (mutar desliga esta trilha)
  mic: null,          // { src, gate, dest }: microfone → portão → o que vai pros outros
  sendStream: null,   // saída do portão: é isto que vai nas chamadas
  gateOpen: true,
  gateLevel: 0,       // nível da faixa de voz medido pelo portão
  gateThreshold: 0,   // limiar em uso (o automático muda sozinho)
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
  iceServers: null,   // STUN/TURN usados nas conexões (vêm do main)
  watchingAlso: null, // segunda transmissão aberta, lado a lado
  tuned: new Set(),   // transmissões que abri (coluna da esquerda): só essas recebem vídeo
  previews: new Map(), // peerId -> foto da tela (data:image/jpeg) mostrada na frente do boneco
  splitRestore: null, // lado a lado: a outra metade, pra voltar ao sair da tela cheia
  stats: new Map(),   // prêmios da resenha: nome -> contadores
  statsTimer: 0,
  sessionStart: 0,
  lastTick: 0,
};

// ---------- PeerJS helpers ----------

function openPeer(id) {
  return new Promise((resolve, reject) => {
    // STUN/TURN vêm do processo principal (turn.json); sem eles, o padrão do PeerJS.
    const options = state.iceServers ? { config: { iceServers: state.iceServers } } : {};
    const peer = id ? new Peer(id, options) : new Peer(options);
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
    await buildMicChain();

    setLobbyStatus('Conectando…');
    state.iceServers = await window.baderna?.iceServers?.().catch(() => null) ?? null;
    const turns = (state.iceServers ?? []).filter((x) => [].concat(x.urls).some((u) => /^turns?:/.test(u))).length;
    logEvent('entrar', { sala: room, nome: name, turn: turns ? 'sim' : 'não' });
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
  const awards = computeAwards();
  broadcast({ type: 'bye' });
  await sleep(200); // deixa o "bye" sair antes de fechar tudo
  await teardown();
  showLobby();
  startPreview();
  if (awards) showAwards(awards);
}

async function teardown() {
  state.leaving = true;
  for (const w of watchedPaths) await pollPath(w);
  logRelaySummary(true);
  relayUsage.clear();
  watchedPaths.clear();
  relayLogged = 0;
  stopShare();
  closeWatch();
  for (const id of [...state.members.keys()]) removeMember(id);
  for (const id of [...state.screens.keys()]) unregisterScreen(id);
  dialQueue.length = 0;
  clearTimeout(dialTimer);
  dialTimer = 0;
  clearTimeout(state.redialTimer);
  destroyPeer(state.beacon);
  destroyPeer(state.mainPeer);
  state.localStream?.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(state.rafId);
  clearInterval(state.statsTimer);
  for (const id of [...state.meters.keys()]) removeMeter(id);
  await state.audioCtx?.close().catch(() => {});

  Object.assign(state, {
    room: null, mainPeer: null, beacon: null, localStream: null, mic: null, sendStream: null, gateOpen: true, myId: null,
    seq: 0, nextSeq: 1, hostId: null, muted: false, deaf: false, mutedBeforeDeaf: false, leaving: false,
    roster: new Map(), selfSeat: null, audioCtx: null, rafId: 0, lastChat: null, theme: DEFAULT_THEME,
  });
  $('seats').replaceChildren();
  $('timeline').replaceChildren();
  $('live-list').replaceChildren();
  updateLiveRail();
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
  else addSystem(narrate('newHost', { n: state.members.get(state.hostId)?.name ?? 'Alguém' }));
}

async function claimBeaconWithRetry() {
  addSystem(narrate('hostGone'));
  // O servidor do PeerJS pode demorar pra liberar o ID se o host caiu sem fechar.
  for (let i = 0; i < BEACON_MAX_TRIES; i++) {
    if (!state.mainPeer || state.hostId !== state.myId) return;
    try {
      if (await tryClaimBeacon()) {
        becomeHost();
        addSystem(narrate('meHost'));
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
    if (isNew && Number(seq) > state.seq) {
      addSystem(narrate('arrived', { n: member.name }));
      playBlip(true);
    }
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
    call.answer(state.sendStream);
    attachCall(member, call);
  });

  peer.on('disconnected', () => {
    // Caiu só o signaling; as conexões P2P continuam. Reconecta pra novos chegarem.
    logEvent('servidor: caiu a conexão, reconectando');
    if (!peer.destroyed) peer.reconnect();
  });

  // Voltou do servidor: o que estava sendo combinado na hora da queda se
  // perdeu; disca de novo pra quem ainda não abriu.
  peer.on('open', () => {
    logEvent('servidor: reconectado');
    clearTimeout(state.redialTimer);
    state.redialTimer = setTimeout(() => {
      for (const m of state.members.values()) {
        if (m.outgoing && !m.conn?.open && m.connAttempts < CONNECT_ATTEMPTS) redial(m, 'servidor voltou');
      }
    }, REDIAL_AFTER_RECONNECT_MS);
  });

  peer.on('error', (err) => {
    // peer-unavailable: alguém da lista já tinha saído (fantasma). Some da lista.
    if (err.type === 'peer-unavailable') {
      const id = /peer (\S+)/.exec(err.message ?? '')?.[1];
      const m = id && state.members.get(id);
      // Só é fantasma quem EU disquei a partir da lista do host. Quem discou pra
      // mim existe: o "não existe" é ele reconectando ao servidor naquele instante.
      if (m && !m.outgoing) {
        logEvent('servidor: ID sumiu por um instante (ignorado)', m.name, shortId(id));
        return;
      }
      logEvent('servidor: ID não existe mais', id ? shortId(id) : '?');
      if (id) removeMember(id, 'gone');
      return;
    }
    logEvent('peer erro', err.type ?? '', err.message ?? '');
    console.warn('main', err);
  });
}

function connectTo(id, name, seq) {
  if (id === state.myId || state.members.has(id)) return;
  const member = upsertMember(id, { name, seq });
  member.outgoing = true; // eu disco: sou eu que tento de novo se não abrir
  queueDial(member);
}

// Discagem em fila, uma pessoa por vez: discar pra todo mundo de uma vez
// manda centenas de mensagens pelo servidor do PeerJS num instante, e ele
// derruba quem manda demais (o baderna.log mostrou isso ao entrar em sala
// cheia). A voz só é chamada depois que os dados abrem (attachConn).
const DIAL_GAP_MS = 600;
const dialQueue = [];
let dialTimer = 0;

function queueDial(member) {
  if (!dialQueue.includes(member)) dialQueue.push(member);
  if (!dialTimer) dialTimer = setTimeout(dialNext, 0);
}

function dialNext() {
  dialTimer = 0;
  const member = dialQueue.shift();
  if (!member) return;
  if (state.mainPeer && state.members.get(member.id) === member && !member.conn?.open) dialMember(member);
  if (dialQueue.length) dialTimer = setTimeout(dialNext, DIAL_GAP_MS);
}

function dialMember(member) {
  member.connAttempts = (member.connAttempts ?? 0) + 1;
  const old = member.conn;
  attachConn(member, state.mainPeer.connect(member.id, {
    metadata: { name: state.name, seq: state.seq, avatar: state.avatar },
    reliable: true,
  }));
  old?.close();
}

// Conexão que não abriu: quem discou tenta de novo, pela fila.
function redial(member, why) {
  logEvent('dados: tentando de novo', member.connAttempts + 1, why, member.name, shortId(member.id));
  queueDial(member);
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
  applyMemberAudio(m);
  renderSeat(m);
  sortSeats();
  updateCount();
  return m;
}

// Conexão que não abre nesse tempo é desistida: ou a pessoa nem existe mais
// (fantasma de quem fechou o app no meio da entrada) ou a rede bloqueou.
const CONNECT_TIMEOUT_MS = 20_000;
const CONNECT_ATTEMPTS = 3;
const REDIAL_AFTER_RECONNECT_MS = 2000;

function attachConn(member, conn) {
  member.conn = conn;
  logEvent('dados: iniciando', member.name, shortId(member.id));
  const timer = setTimeout(() => {
    if (member.conn !== conn || conn.open || state.members.get(member.id) !== member) return;
    logEvent('dados: não abriu em 20 s', member.name, shortId(member.id));
    if (member.outgoing && member.connAttempts < CONNECT_ATTEMPTS && state.mainPeer) redial(member, 'tempo');
    else removeMember(member.id, 'unreachable');
  }, member.outgoing ? CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS * CONNECT_ATTEMPTS);
  conn.on('data', (msg) => handleMessage(member, msg));
  conn.on('close', () => {
    if (member.conn !== conn) return;
    logEvent('dados: fechou', member.name, shortId(member.id));
    removeMember(member.id);
  });
  conn.on('open', () => {
    clearTimeout(timer);
    logEvent('dados: aberto', member.name, shortId(member.id));
    if (member.outgoing && state.mainPeer && !['connected', 'completed'].includes(member.call?.peerConnection?.iceConnectionState)) {
      attachCall(member, state.mainPeer.call(member.id, state.sendStream), true);
    }
    watchIce(member, conn.peerConnection);
    conn.send(myProfile());
    sendMoviesTo(member);
    conn.send({ type: 'watching', ids: [...state.tuned] });
    conn.send({ type: 'caps', ondemand: true });
    if (state.screen) {
      conn.send({ type: 'screen-live' });
      if (state.previews.has(state.myId)) conn.send({ type: 'preview', img: state.previews.get(state.myId) });
    }
    // Quem chega depois também vê a tela que já está rolando. Espera o 'caps'
    // chegar: versão nova só recebe vídeo quando abrir; versão antiga, já.
    if (state.screen) setTimeout(() => syncScreenOut(member), CAPS_WAIT_MS);
  });
}

// Voz: quem ligou (outgoing) tenta de novo se a chamada falhar com os dados
// ainda conectados; quem recebe só troca pela chamada nova.
const VOICE_RETRY_MAX = 2;
const VOICE_RETRY_DELAY_MS = 3000;

function attachCall(member, call, outgoing = false) {
  const old = member.call;
  member.call = call;
  if (old && old !== call) old.close();
  call.on('stream', (stream) => {
    member.audio.srcObject = stream;
    member.audio.play().catch(() => {});
    addMeter(member.id, stream);
  });
  call.on('close', () => {
    if (member.call !== call) return;
    if (member.conn?.open) retryVoice(member, outgoing);
    else removeMember(member.id);
  });
  const pc = call.peerConnection;
  watchPath(pc, 'voz', member);
  pc?.addEventListener('iceconnectionstatechange', () => {
    if (member.call !== call) return;
    const st = pc.iceConnectionState;
    logEvent('voz:', st, member.name, shortId(member.id));
    if (st === 'connected' || st === 'completed') logVoicePath(member, pc);
    if (st === 'failed') retryVoice(member, outgoing);
  });
}

function retryVoice(member, outgoing) {
  if (!outgoing || !state.members.has(member.id)) return;
  member.voiceRetries = (member.voiceRetries ?? 0) + 1;
  if (member.voiceRetries > VOICE_RETRY_MAX) {
    logEvent('voz: desisti', member.name, shortId(member.id));
    return;
  }
  logEvent('voz: tentando de novo', member.voiceRetries, member.name);
  setTimeout(() => {
    if (!state.members.has(member.id) || !member.conn?.open || !state.mainPeer) return;
    attachCall(member, state.mainPeer.call(member.id, state.sendStream), true);
  }, VOICE_RETRY_DELAY_MS);
}

async function logVoicePath(member, pc) {
  const stats = await pc.getStats().catch(() => null);
  if (!stats) return;
  stats.forEach((r) => {
    if (r.type !== 'transport' || !r.selectedCandidatePairId) return;
    const pair = stats.get(r.selectedCandidatePairId);
    const local = pair && stats.get(pair.localCandidateId);
    const remote = pair && stats.get(pair.remoteCandidateId);
    logEvent('voz: caminho', member.name, `${local?.candidateType}/${local?.protocol} -> ${remote?.candidateType}`,
      pair?.currentRoundTripTime != null ? `${Math.round(pair.currentRoundTripTime * 1000)} ms` : '');
  });
}

// ---------- Cloudflare (TURN) só quando precisa ----------
// Na largada, o caminho pelo TURN às vezes responde antes do direto e o ICE
// fica com ele, mesmo dando pra ir direto (gasto à toa na conta). Os
// candidatos relay só são anunciados RELAY_DELAY_MS depois de criar a
// conexão: o direto tem esse tempo de vantagem; se não der, o TURN entra.
const RELAY_DELAY_MS = 2000;

class BadernaPeerConnection extends RTCPeerConnection {
  constructor(...args) {
    super(...args);
    this.createdAt = performance.now();
    this.iceHandler = null;
  }

  get onicecandidate() {
    return this.iceHandler;
  }

  // PeerJS troca o handler por um vazio quando o ICE completa; o atrasado
  // chama o que estiver valendo na hora.
  set onicecandidate(fn) {
    this.iceHandler = fn;
    super.onicecandidate = fn && ((e) => {
      const wait = this.createdAt + RELAY_DELAY_MS - performance.now();
      if (e.candidate?.type === 'relay' && wait > 0) {
        setTimeout(() => {
          if (this.signalingState !== 'closed') this.iceHandler?.(e);
        }, wait);
        return;
      }
      fn(e);
    });
  }
}
// PeerJS procura RTCPeerConnection no global a cada conexão.
window.RTCPeerConnection = BadernaPeerConnection;

// ---------- Caminho e gasto no TURN (vai pro baderna.log) ----------
// A cada PATH_POLL_MS soma o que passou pelo TURN em cada conexão (voz e
// tela) e anota quando o caminho muda. Resumo a cada RELAY_SUMMARY_MS e ao
// sair da sala, pra bater com a conta da Cloudflare. É só o meu lado: cada
// um tem o seu log.
const PATH_POLL_MS = 30_000;
const RELAY_SUMMARY_MS = 10 * 60_000;
const watchedPaths = new Set();
const relayUsage = new Map(); // "nome · tipo" → bytes
let relayLogged = 0;
let relaySummaryAt = 0;

function watchPath(pc, kind, member) {
  if (!pc) return;
  const w = { pc, kind, member, path: '', bytes: 0 };
  watchedPaths.add(w);
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'connected') pollPath(w);
  });
}

async function pollPath(w) {
  const stats = await w.pc.getStats().catch(() => null);
  if (!stats) return;
  stats.forEach((r) => {
    if (r.type !== 'transport' || !r.selectedCandidatePairId) return;
    const pair = stats.get(r.selectedCandidatePairId);
    if (!pair) return;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    const bytes = (r.bytesSent ?? 0) + (r.bytesReceived ?? 0);
    if (relay && bytes > w.bytes) {
      const key = `${w.member.name} · ${w.kind}`;
      relayUsage.set(key, (relayUsage.get(key) ?? 0) + bytes - w.bytes);
    }
    w.bytes = bytes;
    const path = `${local?.candidateType}/${local?.protocol} -> ${remote?.candidateType}`;
    if (path === w.path) return;
    // A voz já anota o caminho ao conectar (logVoicePath); aqui só a mudança.
    if (w.path || w.kind !== 'voz') {
      logEvent(`${w.kind}: caminho${w.path ? ' mudou' : ''}`, w.member.name, path,
        pair.currentRoundTripTime != null ? `${Math.round(pair.currentRoundTripTime * 1000)} ms` : '');
    }
    w.path = path;
  });
}

async function pollPaths() {
  for (const w of watchedPaths) {
    if (w.pc.connectionState === 'closed') watchedPaths.delete(w);
    else await pollPath(w);
  }
  if (performance.now() - relaySummaryAt >= RELAY_SUMMARY_MS) logRelaySummary();
}

function logRelaySummary(final = false) {
  relaySummaryAt = performance.now();
  const total = [...relayUsage.values()].reduce((a, b) => a + b, 0);
  if (total === relayLogged && !final) return;
  relayLogged = total;
  const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
  const parts = [...relayUsage].sort((a, b) => b[1] - a[1]).map(([k, b]) => `${k} ${mb(b)}`);
  if (total || final) logEvent(final ? 'turn: total da sessão' : 'turn: até agora', mb(total), parts.join(', '));
}

setInterval(pollPaths, PATH_POLL_MS);

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
      if (before !== '…' && before !== member.name) addSystem(narrate('renamed', { b: before, n: member.name }));
      break;
    }
    case 'chat':
      if (typeof msg.text === 'string' && msg.text.trim()) addChat(member.id, member.name, member.avatar, msg.text);
      break;
    case 'theme':
      // Só o host manda no tema.
      if (member.id === state.hostId && THEMES[msg.theme] && msg.theme !== state.theme) {
        applyTheme(msg.theme);
        addSystem(narrate('theme', { n: member.name, t: THEMES[msg.theme].name }));
      }
      break;
    case 'host':
      if (typeof msg.hostId !== 'string') break;
      state.hostId = msg.hostId;
      renderAll();
      break;
    case 'screen-stop':
      member.screenLive = false;
      closeScreenIn(member);
      break;
    case 'screen-live':
      member.screenLive = true;
      registerScreen(member.id, `Tela de ${member.name}`, null, true);
      renderSeat(member);
      break;
    case 'caps':
      member.onDemand = !!msg.ondemand;
      if (state.screen) syncScreenOut(member);
      break;
    case 'movies':
      handleMoviesMessage(msg);
      break;
    case 'watching':
      member.watchingIds = Array.isArray(msg.ids) ? msg.ids.filter((x) => typeof x === 'string').slice(0, 8) : [];
      updateLiveRail();
      if (state.screen) {
        syncScreenOut(member);
        retuneScreen();
      }
      break;
    case 'preview':
      handlePreview(member, msg);
      break;
    case 'bye':
      removeMember(member.id, 'bye');
      break;
  }
}

// reason 'bye': saiu pelo botão; sem reason: a conexão caiu.
function removeMember(id, reason) {
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
  logEvent('saiu da lista', m.name, shortId(id), reason ?? 'caiu');
  if (state.leaving) return;
  if (personMenuFor === m) closePersonMenu();
  updateLiveRail();
  // Host inalcançável por mim não quer dizer que saiu: os outros ainda o veem.
  if (id === state.hostId && reason !== 'unreachable') handleHostLeft();
  // Nunca chegou a conectar: fantasma some quieto; gente de verdade, um aviso.
  if (reason === 'gone') return;
  if (reason === 'unreachable') {
    addSystem(`Não deu pra conectar com ${m.name} (a rede de um de vocês bloqueou).`);
    return;
  }
  if (reason !== 'bye') statOf(m.name).drops++;
  playBlip(false);
  addSystem(narrate(reason === 'bye' ? 'left' : 'dropped', { n: m.name }));
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
  statOf(name).chats++;
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

// ---------- Prêmios da resenha ----------
// Cada um conta o que vê da própria máquina, por nome: quem cai e volta
// ganha outro ID, mas continua sendo a mesma pessoa pra zoeira.

const STATS_SAMPLE_MS = 1000;
const AWARDS_MIN_SESSION_MS = 60_000;

const AWARDS = [
  { key: 'talk', icon: '🗣️', title: 'Tagarela da Noite', min: 30_000, text: (v) => `falou ${formatDuration(v)}` },
  { key: 'muted', icon: '🧘', title: 'Monge do Mute', min: 60_000, text: (v) => `${formatDuration(v)} no mudo` },
  { key: 'chats', icon: '⌨️', title: 'Dedo Nervoso', min: 5, text: (v) => `${v} mensagens no chat` },
  { key: 'share', icon: '📽️', title: 'Projetor Humano', min: 60_000, text: (v) => `${formatDuration(v)} de telão` },
  { key: 'host', icon: '👑', title: 'Dono da Bola', min: 60_000, text: (v) => `${formatDuration(v)} de host` },
  { key: 'drops', icon: '🚧', title: 'Cone da Rodada', min: 1, text: (v) => (v === 1 ? 'caiu 1 vez' : `caiu ${v} vezes`) },
];

function statOf(name) {
  let s = state.stats.get(name);
  if (!s) {
    s = { talk: 0, muted: 0, chats: 0, share: 0, host: 0, drops: 0, present: 0, avatar: null };
    state.stats.set(name, s);
  }
  return s;
}

function sampleStats() {
  const people = [
    { name: state.name, avatar: state.avatar, muted: state.muted || state.deaf, sharing: !!state.screen, host: state.hostId === state.myId },
    ...[...state.members.values()].filter((m) => m.name !== '…').map((m) => ({
      name: m.name, avatar: m.avatar, muted: m.muted || m.deaf, sharing: state.screens.has(m.id), host: state.hostId === m.id,
    })),
  ];
  for (const p of people) {
    const s = statOf(p.name);
    s.avatar = p.avatar;
    s.present += STATS_SAMPLE_MS;
    if (p.muted) s.muted += STATS_SAMPLE_MS;
    if (p.sharing) s.share += STATS_SAMPLE_MS;
    if (p.host) s.host += STATS_SAMPLE_MS;
  }
}

function computeAwards() {
  const duration = Date.now() - state.sessionStart;
  const people = [...state.stats].filter(([name]) => name !== '…');
  if (!state.sessionStart || duration < AWARDS_MIN_SESSION_MS || people.length < 2) return null;
  const awards = [];
  for (const a of AWARDS) {
    const [name, s] = people.reduce((best, cur) => (cur[1][a.key] > best[1][a.key] ? cur : best));
    if (s[a.key] >= a.min) awards.push({ icon: a.icon, title: a.title, name, avatar: s.avatar, text: a.text(s[a.key]) });
  }
  // Quem ficou a resenha quase toda de mic aberto e quase não falou.
  const talkers = people.filter(([, s]) => s.present >= 120_000 && s.muted < s.present / 2);
  if (talkers.length >= 3) {
    const loudest = Math.max(...talkers.map(([, s]) => s.talk));
    const [name, s] = talkers.reduce((best, cur) => (cur[1].talk < best[1].talk ? cur : best));
    if (s.talk < loudest / 4) awards.push({ icon: '🗿', title: 'Estátua de Praça', name, avatar: s.avatar, text: `falou só ${formatDuration(s.talk)}` });
  }
  return awards.length ? { duration, awards } : null;
}

function showAwards({ duration, awards }) {
  $('awards-sub').textContent = `Resenha de ${formatDuration(duration)}. Os vencedores da noite:`;
  $('awards-list').replaceChildren(...awards.map((a) => {
    const row = document.createElement('div');
    row.className = 'award';
    const face = document.createElement('div');
    face.className = 'face-thumb';
    face.innerHTML = avatarFaceSvg(a.avatar); // SVG sanitizado em avatar.js
    const text = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = `${a.icon} ${a.title}`;
    const who = document.createElement('span');
    who.textContent = a.name;
    const detail = document.createElement('small');
    detail.textContent = a.text;
    text.append(title, who, detail);
    row.append(face, text);
    return row;
  }));
  $('awards-dialog').showModal();
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
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
  $('theme-select').value = theme;
}

function setTheme(id) {
  if (state.hostId !== state.myId || !THEMES[id] || id === state.theme) return;
  applyTheme(id);
  broadcast({ type: 'theme', theme: id });
  addSystem(`Você mudou o tema pra ${THEMES[id].name}.`);
  rememberRoomTheme();
}

$('theme-select').replaceChildren(...Object.entries(THEMES).map(([id, theme]) => new Option(theme.name, id)));
$('theme-select').addEventListener('change', () => setTheme($('theme-select').value));

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
// receber ou para; assim quem entra/sai redistribui o upload. O degrau do
// ajuste automático de cada pessoa é reaplicado em cima do bitrate base.
async function retuneScreen() {
  const screen = state.screen;
  if (!screen) return;
  const members = [...state.members.values()].filter((m) => m.screenOut?.peerConnection?.connectionState === 'connected');
  const viewers = Math.max(1, [...state.members.values()].filter((m) => m.screenOut && wantsMyScreen(m)).length);
  const budget = uploadBudgetBps();

  const updates = [];
  for (const m of members) {
    const on = wantsMyScreen(m);
    for (const sender of m.screenOut.peerConnection.getSenders()) {
      const kind = sender.track?.kind;
      if (kind !== 'audio' && kind !== 'video') continue;
      updates.push(updateSender(sender, (params) => {
        params.encodings[0].active = on;
        if (kind === 'audio') {
          params.encodings[0].maxBitrate = SCREEN_AUDIO_BITRATE;
          return;
        }
        const codec = params.codecs?.[0]?.mimeType.split('/')[1]?.toUpperCase() ?? 'VP8';
        const { perViewer } = screenBitrate({ preset: screen.preset, codec, viewers, withAudio: !!screen.audio, budget });
        const a = adaptOf(sender);
        a.base = perViewer;
        applyAdaptLevel(params, a);
        params.degradationPreference = screen.mode === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
      }));
    }
  }
  await Promise.all(updates);
  if (state.screen === screen) updateShareLabel();
}

// Ajustes de envio de uma conexão em fila: dois setParameters ao mesmo tempo
// no mesmo sender fazem o segundo ser recusado (e o ajuste se perde).
const senderQueues = new WeakMap();

function updateSender(sender, mutate) {
  const run = async () => {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    mutate(params);
    try {
      await sender.setParameters(params);
    } catch (err) {
      if (!('degradationPreference' in params)) throw err;
      delete params.degradationPreference;
      await sender.setParameters(params);
    }
  };
  const next = (senderQueues.get(sender) ?? Promise.resolve()).then(run).catch((err) => console.warn('setParameters', err));
  senderQueues.set(sender, next);
  return next;
}

// Quem abriu minha transmissão recebe o vídeo; o resto só as fotos. Versão
// antiga (nunca mandou 'watching') continua recebendo tudo, como antes.
function wantsMyScreen(m) {
  return m.watchingIds === undefined || m.watchingIds.includes(state.myId);
}

// "1080p30, 4,2 Mbps": a melhor qualidade que está saindo e o upload total
// da tela. Sem ninguém assistindo, só a qualidade escolhida.
function updateShareLabel() {
  if (!state.screen) return;
  let best = Infinity;
  let total = 0;
  for (const m of state.members.values()) {
    const pc = m.screenOut?.peerConnection;
    const sender = pc?.getSenders().find((x) => x.track?.kind === 'video');
    if (!sender || pc.connectionState !== 'connected') continue;
    const enc = sender.getParameters().encodings?.[0];
    if (enc?.active === false) continue;
    total += enc?.maxBitrate ?? 0;
    best = Math.min(best, adaptOf(sender).level);
  }
  setScreenLabel(state.myId, Number.isFinite(best)
    ? `${ladderStep(best).label}, ${mbps(total)} Mbps`
    : ladderStep(0).label);
}

// ---------- Ajuste automático da tela ----------
// Cada pessoa assistindo tem um degrau de qualidade. A cada 2 s olha as
// estatísticas da cópia que vai pra ela: limitada por banda ou CPU por 6 s,
// desce um degrau; folgada por um bom tempo, sobe. Filme perde resolução
// primeiro (mantém a fluidez); texto perde fps primeiro (mantém a nitidez).
// Tudo em silêncio, sem aviso no chat. Upload apertado limita todas as cópias, então todas descem juntas;
// download ruim de um amigo só derruba a cópia dele.

const ADAPT_INTERVAL_MS = 2000;
const ADAPT_DOWN_AFTER = 3;       // amostras limitadas seguidas pra descer
const ADAPT_UP_AFTER = 8;         // amostras folgadas seguidas pra subir
const ADAPT_UP_HOLD_MS = 30_000;  // espera depois de descer; dobra a cada ida e volta
const ADAPT_LADDERS = {
  motion: [{ scale: 1 }, { scale: 1.5 }, { scale: 2, fps: 30 }, { scale: 3, fps: 24 }],
  detail: [{ scale: 1 }, { scale: 1, fps: 15 }, { scale: 1.5, fps: 10 }, { scale: 2, fps: 8 }],
};

const screenAdapt = new WeakMap(); // RTCRtpSender -> { level, base, bad, good, lastDown, bounces }

function adaptOf(sender) {
  let a = screenAdapt.get(sender);
  if (!a) {
    a = { level: 0, base: 0, bad: 0, good: 0, lastDown: 0, bounces: 0 };
    screenAdapt.set(sender, a);
  }
  return a;
}

function adaptLadder() {
  return ADAPT_LADDERS[state.screen?.mode === 'detail' ? 'detail' : 'motion'];
}

function ladderStep(level) {
  const { preset } = state.screen;
  const step = adaptLadder()[level];
  const fps = Math.min(preset.frameRate, step.fps ?? preset.frameRate);
  // Bitrate cresce menos que linear com pixels e fps.
  const factor = Math.max(0.15, (1 / step.scale ** 2) ** 0.75 * (fps / preset.frameRate) ** 0.7);
  return { scale: step.scale, fps, factor, label: `${Math.round(preset.height / step.scale)}p${fps}` };
}

function applyAdaptLevel(params, a) {
  const step = ladderStep(a.level);
  const enc = params.encodings[0];
  enc.scaleResolutionDownBy = step.scale;
  enc.maxFramerate = step.fps;
  enc.maxBitrate = Math.max(MIN_SCREEN_BITRATE, Math.round(a.base * step.factor));
}

async function adaptScreen() {
  const screen = state.screen;
  if (!screen) return;
  const now = Date.now();
  const top = adaptLadder().length - 1;
  let changed = false;
  for (const m of state.members.values()) {
    const pc = m.screenOut?.peerConnection;
    if (pc?.connectionState !== 'connected') continue;
    const sender = pc.getSenders().find((x) => x.track?.kind === 'video');
    if (!sender) continue;
    const a = adaptOf(sender);
    if (!a.base) continue; // retuneScreen ainda não passou por aqui
    if (sender.getParameters().encodings?.[0]?.active === false) {
      a.bad = 0; // ninguém assistindo por aqui: nada a ajustar
      a.good = 0;
      continue;
    }
    const stats = await screenSenderStats(sender);
    if (state.screen !== screen) return;
    if (!stats) continue;
    if (stats.limited) {
      a.bad++;
      a.good = 0;
    } else {
      a.good++;
      a.bad = 0;
    }

    if (a.bad >= ADAPT_DOWN_AFTER && a.level < top) {
      a.level++;
      a.bad = 0;
      a.lastDown = now;
    } else if (a.good >= ADAPT_UP_AFTER && a.level > 0 && now - a.lastDown > ADAPT_UP_HOLD_MS * 2 ** a.bounces) {
      const up = ladderStep(a.level - 1);
      // Só sobe se a estimativa de banda da conexão comporta o degrau de cima.
      if (stats.available && stats.available < a.base * up.factor * 1.2) continue;
      a.level--;
      a.good = 0;
      if (a.lastDown) a.bounces = Math.min(4, a.bounces + 1);
    } else {
      continue;
    }
    await updateSender(sender, (params) => applyAdaptLevel(params, a));
    changed = true;
  }
  if (changed && state.screen === screen) updateShareLabel();
}

// O que o ajuste olha numa cópia da tela. Função separada pra dar pra
// simular conexão ruim nos testes.
async function screenSenderStats(sender) {
  const report = await sender.getStats().catch(() => null);
  if (!report) return null;
  let out = null;
  let available = 0;
  report.forEach((r) => {
    if (r.type === 'outbound-rtp' && r.kind === 'video') out = r;
    if (r.type === 'candidate-pair' && r.nominated && r.availableOutgoingBitrate) available = r.availableOutgoingBitrate;
  });
  if (!out) return null;
  const reason = out.qualityLimitationReason;
  return { limited: reason === 'bandwidth' || reason === 'cpu', reason, available };
}

function updateShareEstimate() {
  const viewers = state.members.size;
  if (!viewers) {
    $('share-estimate').textContent = 'Ninguém assistindo ainda.';
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
    `${viewers} assistindo · ~${mbps(total)} Mbps de upload`
    + (limited ? ' · qualidade reduzida pelo limite' : '');
  $('share-estimate').title = `${mbps(perViewer)} Mbps por pessoa · codec ${codec}`
    + (budget ? ` · limite ${mbps(budget * UPLOAD_HEADROOM)} de ${budgetMbps} Mbps` : '');
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

  state.screen = {
    stream, preset, mode, audio, codecs,
    adaptTimer: setInterval(adaptScreen, ADAPT_INTERVAL_MS),
    previewTimer: setInterval(sharePreview, PREVIEW_MS),
  };
  setTimeout(sharePreview, 600); // primeira foto logo que a imagem chega
  broadcast({ type: 'screen-live' });
  for (const m of state.members.values()) syncScreenOut(m);
  registerScreen(state.myId, 'Sua tela', stream, false);
  addSystem('Você começou a compartilhar a tela.');
  updateDock();
  renderSelf();
}

function stopShare() {
  if (!state.screen) return;
  const { stream, audio, adaptTimer, previewTimer } = state.screen;
  clearInterval(adaptTimer);
  clearInterval(previewTimer);
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

// Chamada de vídeo só pra quem abriu a transmissão (e fecha quando sai): sem
// ela, nada de codificador nem conexão parada ocupando memória. Versão antiga
// (sem 'caps') recebe sempre, como antes.
const CAPS_WAIT_MS = 1500;

function syncScreenOut(member) {
  if (!state.screen || !state.members.has(member.id)) return;
  const wants = member.onDemand ? !!member.watchingIds?.includes(state.myId) : true;
  if (wants) sendScreenTo(member);
  else if (member.screenOut && member.onDemand) {
    const call = member.screenOut;
    member.screenOut = null;
    call.close();
    retuneScreen();
  }
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
  watchPath(pc, 'tela enviada', member);
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
  watchPath(call.peerConnection, 'tela recebida', member);
  call.on('stream', (stream) => {
    registerScreen(member.id, `Tela de ${member.name}`, stream, true);
    renderSeat(member);
  });
  call.on('close', () => {
    if (member.screenIn !== call) return;
    // Versão nova fecha a chamada quando eu saio da transmissão; ela continua
    // ao vivo (foto na frente do boneco). Versão antiga só fecha quando acaba.
    if (member.screenLive) detachScreenIn(member);
    else closeScreenIn(member);
  });
}

function detachScreenIn(member) {
  member.screenIn = null;
  const id = member.id;
  const s = state.screens.get(id);
  if (!s) return;
  s.stream = null;
  s.video.srcObject = null;
  const thumb = s.card?.querySelector('.shot video');
  if (thumb) thumb.srcObject = null;
  syncScreenAudio(id);
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
    s = { video, card: null, audio: null, vol: 1, muted: false };
    state.screens.set(id, s);
  }
  Object.assign(s, { stream, label, audible });
  syncScreenAudio(id);
  // O vídeo do player só recebe o stream quando está aberto (renderWatch):
  // escondido e tocando, gastaria memória de vídeo à toa.
  const isNew = !s.card && !s.seen;
  s.seen = true;
  if (state.tuned.has(id)) {
    const card = createScreenCard(id, label, stream);
    if (s.card) s.card.replaceWith(card);
    else $('live-list').append(card);
    s.card = card;
  }
  updateLiveRail();
  if (isNew && id !== state.myId) announceLive(seatOf(id)?.querySelector('.seat-live'));
  if (watchedIds().includes(id)) renderWatch();
}

function unregisterScreen(id) {
  const s = state.screens.get(id);
  if (!s) return;
  const wasWatched = [state.watching, state.watchingAlso].includes(id);
  state.screens.delete(id);
  s.video.srcObject = null;
  s.audio?.remove();
  s.audio = null;
  s.card?.remove();
  state.tuned.delete(id);
  state.previews.delete(id);
  if (wasWatched) unwatch(id);
  updateLiveRail();
  updateSeatLive(id);
}

// Card da transmissão na coluna "AO VIVO" (canto esquerdo). Duplo clique
// abre no modo janela; se já estiver aberta, vai pra tela cheia.
function createScreenCard(id, label, stream) {
  const card = document.createElement('div');
  card.className = 'live-card';
  card.dataset.id = id;
  card.title = 'Clique duas vezes pra assistir';
  const shot = document.createElement('div');
  shot.className = 'shot';
  const thumb = document.createElement('video');
  thumb.autoplay = true;
  thumb.muted = true;
  thumb.playsInline = true;
  thumb.srcObject = stream;
  const dot = document.createElement('i');
  dot.className = 'live-dot';
  dot.textContent = 'AO VIVO';
  shot.append(thumb, dot);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const face = document.createElement('div');
  face.className = 'av';
  face.innerHTML = avatarFaceSvg(id === state.myId ? state.avatar : state.members.get(id)?.avatar); // sanitizado
  const text = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = id === state.myId ? 'Você' : state.members.get(id)?.name ?? '…';
  b.style.color = nameColor(id);
  const span = document.createElement('span');
  span.textContent = label;
  text.append(b, span);
  meta.append(face, text);
  const viewers = document.createElement('div');
  viewers.className = 'viewers';
  const side = document.createElement('button');
  side.type = 'button';
  side.className = 'side-btn';
  side.textContent = '⧉ lado a lado';
  side.title = 'Abrir junto com a que você está vendo';
  side.addEventListener('click', (e) => {
    e.stopPropagation();
    watchSide(id);
  });
  side.addEventListener('dblclick', (e) => e.stopPropagation());
  shot.append(side);
  card.append(shot, meta, viewers, createCardControls(id));
  card.addEventListener('dblclick', () => {
    if (watchedIds().includes(id) && !document.fullscreenElement) toggleFullscreen();
    else watch(id);
  });
  return card;
}

const SPEAKER_SVG = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="waves" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/><path class="slash" d="M16 9l6 6M22 9l-6 6"/></svg>';

// Som da transmissão já na miniatura (volume e mudo por tela) + Sair.
function createCardControls(id) {
  const bar = document.createElement('div');
  bar.className = 'card-controls';
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'ghost icon card-mute';
  mute.innerHTML = SPEAKER_SVG;
  mute.addEventListener('click', () => toggleScreenMute([id]));
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.05';
  vol.className = 'card-volume';
  vol.setAttribute('aria-label', 'Volume da transmissão');
  vol.addEventListener('input', () => setScreenVolume(Number(vol.value), [id]));
  const leaveBtn = document.createElement('button');
  leaveBtn.type = 'button';
  leaveBtn.className = 'ghost card-leave';
  leaveBtn.textContent = 'Sair';
  leaveBtn.title = 'Sair da transmissão';
  leaveBtn.addEventListener('click', () => untune(id));
  bar.append(mute, vol, leaveBtn);
  bar.addEventListener('dblclick', (e) => e.stopPropagation());
  const s = state.screens.get(id);
  vol.value = String(s?.vol ?? 1);
  mute.hidden = vol.hidden = !s?.audible;
  updateMuteButton(mute, s?.muted);
  return bar;
}

// A que está aberta no centro some da coluna (✕ no centro traz de volta).
function updateLiveRail() {
  const watched = watchedIds();
  const cards = [...$('live-list').children];
  for (const card of cards) card.hidden = watched.includes(card.dataset.id);
  const any = cards.some((card) => !card.hidden);
  $('live-rail').hidden = !any;
  $('room-view').querySelector('.center').classList.toggle('has-live', any);
  for (const id of state.screens.keys()) updateSeatLive(id);
  for (const card of cards) {
    const id = card.dataset.id;
    card.classList.toggle('can-side', !!state.watching && !watched.includes(id));
    const names = [...state.members.values()].filter((m) => m.watchingIds?.includes(id)).map((m) => m.name);
    card.querySelector('.viewers').textContent = names.length ? `👁 ${names.join(', ')}` : '';
  }
}

// Alguém começou a transmitir: card pisca e toca duas notas (dá pra desligar).
function announceLive(card) {
  card.classList.add('fresh');
  setTimeout(() => card.classList.remove('fresh'), 6000);
  if (loadPref('liveAlert') === 'off' || state.deaf || !state.audioCtx) return;
  const ctx = state.audioCtx;
  [[660, 0], [990, 0.13]].forEach(([freq, at]) => {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  });
}

// Até duas transmissões abertas lado a lado: state.watching é a principal
// (abre com duplo clique), state.watchingAlso a do lado (botão "lado a lado").
function watchedIds() {
  return [state.watching, state.watchingAlso].filter((id) => id && state.screens.has(id));
}

function watch(id) {
  if (!state.screens.has(id)) return;
  if (!state.tuned.has(id)) tune(id);
  if (state.watchingAlso === id) state.watchingAlso = null;
  state.watching = id;
  renderWatch();
}

function watchSide(id) {
  if (!state.watching || state.watching === id) return watch(id);
  if (!state.tuned.has(id)) tune(id);
  state.watchingAlso = id;
  renderWatch();
}

// Fecha só uma; se era a principal, a do lado assume.
function unwatch(id) {
  if (state.watchingAlso === id) {
    state.watchingAlso = null;
  } else if (state.watching === id) {
    state.watching = state.watchingAlso;
    state.watchingAlso = null;
  }
  if (state.watching && state.screens.has(state.watching)) renderWatch();
  else closeWatch();
}

function renderWatch() {
  const ids = watchedIds();
  for (const [id, s] of state.screens) {
    if (ids.includes(id)) continue;
    s.video.srcObject = null;
  }
  const tiles = ids.map((id) => {
    const s = state.screens.get(id);
    const tile = document.createElement('div');
    tile.className = 'screen-tile';
    tile.dataset.id = id;
    if (s.video.srcObject !== s.stream) s.video.srcObject = s.stream;
    tile.append(s.video);
    if (ids.length > 1) {
      const name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = s.label;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'ghost icon tile-close';
      close.textContent = '✕';
      close.title = 'Fechar só esta';
      close.addEventListener('click', () => unwatch(id));
      tile.append(name, close);
    }
    s.video.play().catch(() => {});
    return tile;
  });
  $('screen-box').replaceChildren(...tiles);
  $('screen-box').classList.toggle('split', ids.length > 1);
  $('screen-label').textContent = ids.map((id) => state.screens.get(id).label).join('  +  ');
  $('screen-volume').parentElement.hidden = !ids.some((id) => state.screens.get(id).audible);
  syncScreenBar();
  $('screen-view').hidden = false;
  updateLiveRail();
  sendWatching();
}

// Avisa a galera o que estou assistindo (o card mostra "👁 fulano").
function sendWatching() {
  broadcast({ type: 'watching', ids: [...state.tuned] });
}

// ---------- Prévias na frente do boneco ----------
// Quem transmite manda uma foto pequena da tela a cada 4 s pra todo mundo;
// o vídeo de verdade só vai pra quem abriu a transmissão (clicando na foto).

const PREVIEW_MS = 4000;
const PREVIEW_WIDTH = 320;
const PREVIEW_MAX_CHARS = 300_000;
let previewCanvas = null;

function seatOf(id) {
  return id === state.myId ? state.selfSeat : state.members.get(id)?.seat;
}

async function capturePreview() {
  const track = state.screen?.stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') return null;
  try {
    const frame = await new ImageCapture(track).grabFrame();
    const height = Math.min(320, Math.round((PREVIEW_WIDTH * frame.height) / frame.width));
    previewCanvas ??= new OffscreenCanvas(PREVIEW_WIDTH, height);
    const canvas = previewCanvas;
    if (canvas.height !== height) canvas.height = height;
    canvas.getContext('2d').drawImage(frame, 0, 0, PREVIEW_WIDTH, height);
    frame.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function sharePreview() {
  const img = await capturePreview();
  if (!img || !state.screen) return;
  state.previews.set(state.myId, img);
  updateSeatLive(state.myId);
  broadcast({ type: 'preview', img });
}

function handlePreview(member, msg) {
  const img = msg.img;
  if (typeof img !== 'string' || !img.startsWith('data:image/jpeg;base64,') || img.length > PREVIEW_MAX_CHARS) return;
  state.previews.set(member.id, img);
  updateSeatLive(member.id);
}

// Foto + selo AO VIVO + quantos estão vendo, na altura do colo do boneco.
function updateSeatLive(id) {
  const seat = seatOf(id);
  if (!seat) return;
  let box = seat.querySelector('.seat-live');
  if (!state.screens.has(id)) {
    box?.remove();
    return;
  }
  if (!box) {
    box = document.createElement('button');
    box.type = 'button';
    box.className = 'seat-live';
    box.title = 'Clique pra abrir a transmissão';
    box.innerHTML = '<img alt=""><i class="live-dot">AO VIVO</i><span class="seat-viewers"></span>';
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      tune(id);
    });
    box.addEventListener('dblclick', (e) => e.stopPropagation());
    seat.append(box);
  }
  const img = box.querySelector('img');
  const src = state.previews.get(id);
  if (src && img.getAttribute('src') !== src) img.src = src;
  img.hidden = !src;
  box.classList.toggle('tuned', state.tuned.has(id));
  const viewers = [...state.members.values()].filter((m) => m.watchingIds?.includes(id)).length;
  box.querySelector('.seat-viewers').textContent = viewers ? `👁 ${viewers}` : '';
}

// Abre na coluna da esquerda (vídeo ao vivo); ✕ no card fecha.
function tune(id) {
  const s = state.screens.get(id);
  if (!s) return;
  if (!state.tuned.has(id)) {
    state.tuned.add(id);
    s.card = createScreenCard(id, s.label, s.stream);
    $('live-list').append(s.card);
  }
  syncScreenAudio(id);
  updateLiveRail();
  sendWatching();
}

function untune(id) {
  if (watchedIds().includes(id)) unwatch(id);
  state.tuned.delete(id);
  const s = state.screens.get(id);
  s?.card?.remove();
  if (s) s.card = null;
  syncScreenAudio(id);
  updateLiveRail();
  sendWatching();
}

// O som de cada transmissão aberta toca num <audio> próprio desde a
// miniatura: abrir no centro ou voltar pra coluna não corta nada. O vídeo do
// player fica sempre mudo.
function syncScreenAudio(id) {
  const s = state.screens.get(id);
  if (!s) return;
  if (!s.audible || !s.stream || !state.tuned.has(id)) {
    s.audio?.remove();
    s.audio = null;
    return;
  }
  if (!s.audio) {
    s.audio = document.createElement('audio');
    s.audio.autoplay = true;
    applySink(s.audio);
    document.body.append(s.audio);
  }
  if (s.audio.srcObject !== s.stream) s.audio.srcObject = s.stream;
  applyScreenAudio(s);
  s.audio.play().catch(() => {});
}

function applyScreenAudio(s) {
  if (s.audio) {
    s.audio.muted = state.deaf || s.muted;
    s.audio.volume = s.vol;
  }
  const controls = s.card?.querySelector('.card-controls');
  if (controls) {
    controls.querySelector('.card-volume').value = String(s.vol);
    updateMuteButton(controls.querySelector('.card-mute'), s.muted);
  }
}

function updateMuteButton(btn, muted) {
  btn.classList.toggle('off', !!muted);
  btn.title = muted ? 'Desmutar a transmissão (M)' : 'Mutar a transmissão (M)';
}

// A barra do player mostra o som da principal.
function syncScreenBar() {
  const s = state.screens.get(state.watching);
  if (!s) return;
  $('screen-volume').value = String(s.vol);
  updateMuteButton($('screen-mute'), s.muted);
}

// Sem ids: as que estão abertas no centro.
function toggleScreenMute(ids = watchedIds()) {
  const list = ids.map((id) => state.screens.get(id)).filter(Boolean);
  const muted = !list.every((s) => s.muted);
  for (const s of list) {
    s.muted = muted;
    applyScreenAudio(s);
  }
  syncScreenBar();
}

function setScreenVolume(v, ids = watchedIds()) {
  const vol = Math.min(1, Math.max(0, v));
  for (const id of ids) {
    const s = state.screens.get(id);
    if (!s) continue;
    s.vol = vol;
    // Mexer no volume desmuta, igual player de vídeo.
    if (vol > 0) s.muted = false;
    applyScreenAudio(s);
  }
  syncScreenBar();
}

// Sai de vez: para de receber e tira da coluna.
function leaveWatched() {
  for (const id of watchedIds()) untune(id);
}

// Tela cheia: controles aparecem com o mouse e somem depois de parado.
const SCREEN_CONTROLS_HIDE_MS = 2500;
let screenControlsTimer = 0;

function showScreenControls() {
  const view = $('screen-view');
  view.classList.add('controls');
  clearTimeout(screenControlsTimer);
  screenControlsTimer = setTimeout(() => {
    if (!view.querySelector('.screen-bar:hover')) view.classList.remove('controls');
    else showScreenControls();
  }, SCREEN_CONTROLS_HIDE_MS);
}

function closeWatch() {
  for (const id of watchedIds()) state.screens.get(id).video.srcObject = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  state.watching = null;
  state.watchingAlso = null;
  $('screen-box').replaceChildren();
  $('screen-box').classList.remove('split');
  $('screen-view').hidden = true;
  updateLiveRail();
  sendWatching();
}

function setScreenLabel(id, label) {
  const s = state.screens.get(id);
  if (!s) return;
  s.label = label;
  if (s.card) s.card.querySelector('.meta span').textContent = label;
  const ids = watchedIds();
  if (ids.includes(id)) $('screen-label').textContent = ids.map((x) => state.screens.get(x).label).join('  +  ');
  const tileName = $('screen-box').querySelector(`.screen-tile[data-id="${CSS.escape(id)}"] .tile-name`);
  if (tileName) tileName.textContent = label;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $('screen-view').requestFullscreen().catch((err) => console.warn('fullscreen', err));
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
  for (const m of state.members.values()) applyMemberAudio(m);
  for (const s of state.screens.values()) applyScreenAudio(s);
  broadcast(myProfile());
  updateDock();
  renderSelf();
}

// Troca só a entrada do portão: a trilha enviada é a mesma, sem renegociar.
async function switchMic(deviceId) {
  const stream = await openMic(deviceId);
  stream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; });
  connectMicSource(stream);
  state.localStream?.getTracks().forEach((t) => t.stop());
  state.localStream = stream;
  addMeter(state.myId, stream);
}

// ---------- Microfone: portão de sensibilidade ----------

function audioContext() {
  if (!state.audioCtx) {
    // 48 kHz: taxa da IA de ruído e do Opus.
    state.audioCtx = new AudioContext({ sampleRate: 48000 });
    applyCtxSink();
  }
  return state.audioCtx;
}

async function buildMicChain() {
  const ctx = audioContext();
  await ctx.resume();
  await ctx.audioWorklet.addModule('gate-worklet.js');
  const gate = new AudioWorkletNode(ctx, 'mic-gate');
  // O portão conta, ~20×/s, se está aberto, o nível da faixa de voz e o limiar em uso.
  gate.port.onmessage = (e) => {
    const d = e.data ?? {};
    state.gateOpen = !!d.open;
    state.gateLevel = Number(d.level) || 0;
    state.gateThreshold = Number(d.threshold) || 0;
  };
  const dest = ctx.createMediaStreamDestination();
  gate.connect(dest);
  state.mic = { src: null, denoise: await createDenoise(ctx, gate), gate, dest };
  state.sendStream = dest.stream;
  connectMicSource(state.localStream);
  applyGate();
}

// IA de ruído na frente do portão; a chance de voz vai direto pra ele por um
// MessagePort. Se não carregar, segue sem ela (só o portão por volume).
async function createDenoise(ctx, gate) {
  try {
    await ctx.audioWorklet.addModule('denoise-worklet.js');
    const node = new AudioWorkletNode(ctx, 'mic-denoise', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    });
    const { port1, port2 } = new MessageChannel();
    node.port.postMessage({ vadPort: port1 }, [port1]);
    gate.port.postMessage({ vadPort: port2 }, [port2]);
    node.connect(gate);
    return node;
  } catch (err) {
    console.warn('denoise', err);
    logEvent('ia-ruido', { erro: String(err?.message ?? err) });
    return null;
  }
}

function noiseMode() {
  const v = loadPref('noise');
  if (v in NOISE_MODES) return v;
  // Antes era só a caixinha do Chrome: quem desligou continua desligado.
  return loadPref('noiseSuppression') === 'off' ? 'off' : 'ai';
}

function connectMicSource(stream) {
  if (!state.mic) return;
  state.mic.src?.disconnect();
  state.mic.src = audioContext().createMediaStreamSource(stream);
  const ai = noiseMode() === 'ai' && state.mic.denoise;
  state.mic.src.connect(ai ? state.mic.denoise : state.mic.gate);
}

// null = automático (sem portão, só a supressão de ruído).
function gateDb() {
  const raw = loadPref('micGate');
  const db = Number(raw);
  return raw && Number.isFinite(db) ? Math.min(GATE_DB_MAX, Math.max(GATE_DB_MIN, db)) : null;
}

function applyGate() {
  const db = gateDb();
  state.mic?.gate.port.postMessage(db === null ? { mode: 'auto' } : { mode: 'manual', threshold: 10 ** (db / 20) });
  placeGateMark(db);
  $('mic-gate-auto').checked = db === null;
  $('mic-gate').disabled = db === null;
  $('mic-gate').value = String(db ?? -45);
}

const gatePct = (db) => Math.min(100, Math.max(0, ((db - GATE_DB_MIN) / (GATE_DB_MAX - GATE_DB_MIN)) * 100));
const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -100);

// Linha do limiar: fixa no manual; no automático (tracejada), onde o portão
// calculou a partir do ruído de fundo (só na sala, onde o portão existe).
function placeGateMark(manualDb) {
  const autoDb = state.mic && state.gateThreshold ? toDb(state.gateThreshold) : null;
  const db = manualDb ?? autoDb;
  $('mic-gate-mark').hidden = db === null;
  $('mic-gate-mark').classList.toggle('auto', manualDb === null);
  if (db !== null) $('mic-gate-mark').style.left = `${gatePct(db)}%`;
  return db;
}

// Na sala mostra o que o portão "ouve" (faixa de voz); no lobby, o mic cru.
function showMicLevel(rawLevel) {
  const db = toDb(state.mic ? state.gateLevel : rawLevel);
  $('mic-level').style.width = `${gatePct(db)}%`;
  const gate = placeGateMark(gateDb());
  $('mic-meter').classList.toggle('below', gate !== null && db < gate);
}

// ---------- Ajustes por pessoa (só pra mim) ----------
// Volume e "silenciar pra mim", lembrados pelo nome neste PC. Chave com
// prefixo pra nome nenhum virar propriedade especial do objeto.

function loadPeople() {
  try {
    const all = JSON.parse(loadPref('people') || '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

function personPref(name) {
  const p = loadPeople()[`n:${name}`];
  const vol = Number(p?.vol);
  return { vol: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 1, mute: !!p?.mute };
}

function setPersonPref(name, patch) {
  const all = loadPeople();
  const next = { ...personPref(name), ...patch };
  if (next.vol === 1 && !next.mute) delete all[`n:${name}`];
  else all[`n:${name}`] = next;
  savePref('people', JSON.stringify(all));
}

function applyMemberAudio(m) {
  const p = personPref(m.name);
  m.audio.volume = p.vol;
  m.audio.muted = state.deaf || p.mute;
}

let personMenuFor = null;

function openPersonMenu(member, seat) {
  if (document.fullscreenElement) return;
  personMenuFor = member;
  const p = personPref(member.name);
  $('pm-name').textContent = member.name;
  $('pm-vol').value = String(Math.round(p.vol * 100));
  $('pm-vol-val').textContent = `${Math.round(p.vol * 100)}%`;
  $('pm-mute').textContent = p.mute ? '🔊 Voltar a ouvir' : '🔇 Silenciar pra mim';
  const menu = $('person-menu');
  menu.hidden = false;
  const r = seat.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
  menu.style.top = `${Math.max(8, r.top - menu.offsetHeight - 8)}px`;
}

function closePersonMenu() {
  personMenuFor = null;
  $('person-menu').hidden = true;
}

// ---------- Sons de entrar/sair ----------
// Gerados na hora, sem arquivo de áudio. Saem pela saída de som escolhida.

function playBlip(up) {
  if (loadPref('sounds') === 'off' || state.deaf || !state.audioCtx) return;
  const ctx = state.audioCtx;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(up ? 520 : 780, t);
  osc.frequency.exponentialRampToValueAtTime(up ? 880 : 440, t + 0.14);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.25);
}

function applyCtxSink() {
  if (!state.audioCtx?.setSinkId) return;
  state.audioCtx.setSinkId($('speaker').value || '').catch((err) => console.warn('ctx setSinkId', err));
}

// ---------- Indicador de quem está falando ----------

function addMeter(id, stream) {
  removeMeter(id);
  const src = audioContext().createMediaStreamSource(stream);
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
const SWAY_EASE = 0.45; // por quadro de 60 Hz; corrigido pelo dt real
// Medidores e balanço a ~30 quadros/s: monitor de 144 Hz não repinta 144×/s.
const TICK_MS = 1000 / 30;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function swayHead(seat, meter, speaking, now, dt) {
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
  const ease = 1 - (1 - SWAY_EASE) ** (dt / (1000 / 60));
  p.x += (t.x - p.x) * ease;
  p.y += (t.y - p.y) * ease;
  p.r += (t.r - p.r) * ease;
  const still = Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.r) < 0.05;
  const transform = still ? '' : `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${p.r.toFixed(1)}deg)`;
  // Parado e já sem transform: nem toca no estilo (nada pra repintar).
  if (meter.transform !== transform) {
    meter.transform = transform;
    head.style.transform = transform;
  }
}

function tick() {
  state.rafId = requestAnimationFrame(tick);
  const now = performance.now();
  if (now - (state.lastTick || 0) < TICK_MS - 2) return;
  const dt = Math.min(200, now - (state.lastTick || now));
  state.lastTick = now;
  for (const [id, meter] of state.meters) {
    meter.analyser.getFloatTimeDomainData(meter.buf);
    let sum = 0;
    for (const v of meter.buf) sum += v * v;
    meter.level = Math.sqrt(sum / meter.buf.length);
    if (meter.level > SPEAKING_THRESHOLD) meter.lastLoud = now;
    // Segura a boca aberta um pouco pra não piscar entre sílabas.
    // Eu: com o portão fechado nada sai, então o boneco também não fala.
    const speaking = now - meter.lastLoud < SPEAKING_HOLD_MS && (id !== state.myId || state.gateOpen);
    const seat = id === state.myId ? state.selfSeat : state.members.get(id)?.seat;
    if (speaking && state.mainPeer) statOf(id === state.myId ? state.name : state.members.get(id)?.name ?? '…').talk += dt;
    if (speaking) meter.lastSpoke = now;
    if (state.windowHidden) continue; // minimizado/na bandeja: só conta, não desenha
    seat?.classList.toggle('speaking', speaking);
    seat?.classList.toggle('recent', now - (meter.lastSpoke ?? -Infinity) < RECENT_TALK_MS);
    seat?.classList.toggle('loud', now - meter.lastLoud < MOUTH_HOLD_MS);
    if (seat) swayHead(seat, meter, speaking, now, dt);
  }
  if ($('settings-dialog').open) {
    const mine = state.meters.get(state.myId);
    if (mine) showMicLevel(mine.level);
  }
}

// ---------- Dispositivos e teste de microfone (lobby) ----------

function micConstraints() {
  return {
    ...Object.fromEntries(Object.keys(AUDIO_PROCESSING).map((k) => [k, loadPref(k) !== 'off'])),
    noiseSuppression: noiseMode() === 'normal',
  };
}

function openMic(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { ...micConstraints(), deviceId: { exact: deviceId } } : micConstraints(),
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
    state.preview.raf = requestAnimationFrame(loop);
    // A barra só aparece nas configurações; fechadas, nada a medir.
    if (!$('settings-dialog').open) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    showMicLevel(Math.sqrt(sum / buf.length));
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
    seat.title = 'Volume e silenciar';
    seat.addEventListener('click', (e) => {
      if (!e.target.closest('.badge')) openPersonMenu(member, seat);
    });
  }
  $('seats').append(seat);
  return seat;
}

function fillSeat(seat, { id, name, avatar, host, muted, deaf, sharing, self, silenced }) {
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
  if (deaf) badge('deaf', 'SURDO');
  else if (muted) badge('muted', 'MUDO');
  if (silenced) badge('silenced', 'SILENCIADO P/ MIM');
  seat.querySelector('.badges').replaceChildren(...badges);
}

function renderSeat(m) {
  fillSeat(m.seat, {
    id: m.id, name: m.name, avatar: m.avatar, host: m.id === state.hostId,
    muted: m.muted, deaf: m.deaf, sharing: state.screens.has(m.id), silenced: personPref(m.name).mute,
  });
  // Nome e rosto podem chegar depois da transmissão: atualiza o card dela.
  const card = state.screens.get(m.id)?.card;
  if (card) {
    card.querySelector('.meta b').textContent = m.name;
    card.querySelector('.av').innerHTML = avatarFaceSvg(m.avatar); // sanitizado
  }
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

// ---------- Arquibancada: bonecos se ajeitam ao espaço ----------
// Folgado: fileira normal. Apertou: encolhem um pouco e depois se espremem
// (sobrepostos, achatados e tortos). Janela alta e ainda sem espaço: sobe
// fileira atrás, menor e mais escura, intercalada; quem chegou depois vai atrás.

const SEAT_W = 170;
const SEAT_H = 266; // cadeira + nome
const SEAT_STEP = 192; // largura + espaço, folgado
const SEAT_MIN_SCALE = 0.8; // encolhe até aqui antes de espremer
const SEAT_MAX_SQUEEZE = 0.35; // fração do passo que pode sobrepor
const ROW_RISE = 170; // quanto cada fileira de trás sobe (cabeças acima das da frente)
const ROW_SHRINK = 0.1; // perspectiva por fileira
const STAGE_MIN_H = 200;
const STAGE_BASE_H = 288;

function pickSeatLayout(n, width, height) {
  const maxRows = Math.min(n, height >= 900 ? 3 : height >= 680 ? 2 : 1);
  for (let rows = 1; rows <= maxRows; rows++) {
    const perSeat = width / Math.ceil(n / rows);
    const scale = Math.min(1, Math.max(SEAT_MIN_SCALE, perSeat / SEAT_STEP));
    const step = Math.min(perSeat, SEAT_STEP * scale);
    const squeeze = 1 - step / (SEAT_STEP * scale);
    if (squeeze <= SEAT_MAX_SQUEEZE || rows === maxRows) {
      if (squeeze <= SEAT_MAX_SQUEEZE) return { rows, scale, step, squeeze };
      // Nem espremido cabe: encolhe o quanto precisar.
      const s = perSeat / (SEAT_STEP * (1 - SEAT_MAX_SQUEEZE));
      return { rows, scale: s, step: perSeat, squeeze: SEAT_MAX_SQUEEZE };
    }
  }
  return { rows: 1, scale: 1, step: SEAT_STEP, squeeze: 0 };
}

function layoutSeats() {
  const box = $('seats');
  const stage = document.querySelector('.stage');
  const seats = [...box.children];
  const packed = box.parentElement === stage;
  box.classList.toggle('packed', packed);
  if (!packed) {
    stage.style.height = '';
    for (const seat of seats) {
      seat.removeAttribute('style');
      seat.classList.remove('back');
    }
    return;
  }
  const n = seats.length;
  if (!n) return;
  const { rows, scale, step, squeeze } = pickSeatLayout(n, box.clientWidth - 40, window.innerHeight);
  const perRow = Math.ceil(n / rows);
  seats.forEach((seat, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const count = Math.min(perRow, n - row * perRow);
    const depth = 1 - ROW_SHRINK * row;
    const rowStep = step * depth;
    // Fileiras de trás deslocadas meio passo: cabeças aparecem entre as da frente.
    const x = (col - (count - 1) / 2 + (row % 2) * 0.5) * rowStep;
    const tilt = squeeze ? (col % 2 ? 1 : -1) * squeeze * 14 : 0;
    seat.classList.toggle('back', row > 0);
    seat.style.setProperty('--x', `${x}px`);
    seat.style.setProperty('--y', `${row * ROW_RISE * scale}px`);
    seat.style.setProperty('--s', String(scale * depth));
    seat.style.setProperty('--sx', String(1 - squeeze * 0.4));
    seat.style.setProperty('--sy', String(1 + squeeze * 0.12));
    seat.style.setProperty('--tilt', `${tilt}deg`);
    seat.style.setProperty('--dim', String(1 - row * 0.18));
    seat.style.zIndex = String((rows - row) * 100 + (count - Math.abs(col - (count - 1) / 2)));
  });
  const h = 22 + (SEAT_H + (rows - 1) * ROW_RISE) * scale;
  stage.style.height = `${Math.round(Math.max(STAGE_MIN_H, Math.min(STAGE_BASE_H, h), rows > 1 ? h : 0))}px`;
}

new ResizeObserver(layoutSeats).observe($('seats'));
new MutationObserver(layoutSeats).observe($('seats'), { childList: true });
window.addEventListener('resize', layoutSeats);

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
  $('theme-select').disabled = !host;
  $('theme-select').title = host ? 'Muda pra todo mundo da sala' : 'Só o host escolhe o tema';
}

// ---------- Editor de boneco ----------

let avatarDraft = null;
// Aba aberta em cada campo com categorias; sem escolha, abre a da opção atual.
let avatarTabs = {};

function openAvatarEditor() {
  avatarDraft = { ...state.avatar };
  avatarTabs = {};
  renderAvatarEditor();
  $('avatar-dialog').showModal();
}

function renderAvatarEditor() {
  const preview = $('avatar-preview');
  preview.innerHTML = '<div class="aura"></div><div class="ring"></div>';
  preview.insertAdjacentHTML('beforeend', avatarSeatSvg(avatarDraft));

  const fields = [];
  for (const [title, keys] of AVATAR_GROUPS) {
    const heading = document.createElement('h3');
    heading.className = 'field-group';
    heading.textContent = title;
    fields.push(heading);
    for (const key of keys) fields.push(avatarField(key, AVATAR_OPTIONS[key]));
  }
  const scroll = $('avatar-fields').scrollTop;
  $('avatar-fields').replaceChildren(...fields);
  $('avatar-fields').scrollTop = scroll;
}

function avatarField(key, options) {
  const field = document.createElement('div');
  field.className = 'field';
  const h = document.createElement('h4');
  h.textContent = AVATAR_LABELS[key];
  field.append(h);
  const cats = AVATAR_CATEGORIES[key];
  if (cats) {
    const current = cats.find(([, values]) => values.includes(avatarDraft[key]))?.[0];
    const open = avatarTabs[key] ?? current ?? cats[0][0];
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    for (const [name] of cats) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.textContent = name;
      tab.classList.toggle('selected', name === open);
      tab.classList.toggle('has-value', name === current);
      tab.addEventListener('click', () => {
        avatarTabs[key] = name;
        renderAvatarEditor();
      });
      tabs.append(tab);
    }
    field.append(tabs);
    options = [...(options.includes('nada') ? ['nada'] : []), ...cats.find(([name]) => name === open)[1]];
  }
  const list = document.createElement('div');
  list.className = 'options';
  for (const value of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isColor = value.startsWith('#');
    btn.className = isColor ? 'swatch' : 'pill';
    if (isColor) btn.style.background = value;
    else btn.textContent = avatarName(key, value);
    if (key === 'kit') {
      const chip = document.createElement('span');
      chip.className = 'kit-chip';
      chip.style.background = value === 'lisa' ? avatarDraft.shirt : KITS[value].swatch;
      btn.prepend(chip);
    }
    btn.title = avatarName(key, value);
    btn.classList.toggle('selected', avatarDraft[key] === value);
    btn.addEventListener('click', () => {
      avatarDraft[key] = value;
      renderAvatarEditor();
    });
    list.append(btn);
  }
  field.append(list);
  return field;
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
  applyTheme(state.theme);
  updateThemeControls();
  $('settings-face').innerHTML = avatarFaceSvg(state.avatar);
  $('settings-dialog').classList.toggle('lobby-mode', !inRoom);
  $('settings-dialog').showModal();
}

// ---------- Telas (lobby/sala) ----------

function showRoom() {
  state.stats = new Map();
  state.sessionStart = Date.now();
  state.statsTimer = setInterval(sampleStats, STATS_SAMPLE_MS);
  state.selfSeat = createSeat(null);
  addMeter(state.myId, state.localStream);
  $('room-code').textContent = state.room;
  updateSaveChip();
  updateMoviesChip();
  touchSavedRoom(state.room);
  applyTheme(state.theme);
  updateDock();
  updateCount();
  renderAll();
  sortSeats();
  $('lobby').hidden = true;
  $('room-view').hidden = false;
  addSystem(narrate(state.hostId === state.myId ? 'created' : 'entered', { c: state.room }));
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
    const films = document.createElement('button');
    films.type = 'button';
    films.className = 'remove';
    films.textContent = '🎬';
    films.title = 'Filmes que vocês já viram nessa sala';
    films.addEventListener('click', () => openMovies(r.code, r.name));
    item.append(enter, films, remove);
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
  for (const s of state.screens.values()) if (s.audio) applySink(s.audio);
  applyCtxSink();
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

$('btn-mic').addEventListener('click', toggleMute);
$('btn-deaf').addEventListener('click', toggleDeaf);
$('btn-share').addEventListener('click', openSharePicker);
$('btn-settings').addEventListener('click', () => openSettings(true));
$('btn-leave').addEventListener('click', leave);

$('screen-close').addEventListener('click', closeWatch);
$('screen-full').addEventListener('click', toggleFullscreen);
$('screen-box').addEventListener('dblclick', (e) => {
  const tile = e.target.closest('.screen-tile');
  // Lado a lado: duplo clique numa metade põe só ela em tela cheia; ao sair, volta às duas.
  if (tile && $('screen-box').classList.contains('split') && !document.fullscreenElement) {
    state.splitRestore = watchedIds().find((x) => x !== tile.dataset.id) ?? null;
    state.watching = tile.dataset.id;
    state.watchingAlso = null;
    renderWatch();
  }
  toggleFullscreen();
});
$('screen-volume').addEventListener('input', () => setScreenVolume(Number($('screen-volume').value)));
$('screen-mute').addEventListener('click', () => toggleScreenMute());
$('screen-leave').addEventListener('click', leaveWatched);
$('screen-view').addEventListener('mousemove', showScreenControls);
// Atalhos assistindo: M muta, setas sobem/descem o volume.
document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof Element && e.target.closest('input, select, textarea');
  if (!state.watching || typing || document.querySelector('dialog[open]')) return;
  if (e.key === 'm' || e.key === 'M') toggleScreenMute();
  else if (e.key === 'ArrowUp') setScreenVolume(Number($('screen-volume').value) + 0.1);
  else if (e.key === 'ArrowDown') setScreenVolume(Number($('screen-volume').value) - 0.1);
  else return;
  e.preventDefault();
  if (document.fullscreenElement) showScreenControls();
});

$('settings-close').addEventListener('click', () => $('settings-dialog').close());
$('awards-close').addEventListener('click', () => $('awards-dialog').close());
$('edit-avatar-room').addEventListener('click', openAvatarEditor);
$('avatar-random').addEventListener('click', () => {
  avatarDraft = randomAvatar();
  avatarTabs = {};
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
window.baderna?.onWindowVisible((v) => { state.windowHidden = !v; });
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

// Atualização baixada em segundo plano: botão na barra de título instala e
// reabre o app (sai da sala antes, avisando a galera).
let updateReady = null;
function showUpdateReady(version) {
  if (!version) return;
  updateReady = version;
  $('update-chip').hidden = false;
  $('update-chip').textContent = `⬆ Atualizar pra ${version}`;
  $('update-chip').title = 'Reinicia o Baderna na versão nova';
  $('update-check').textContent = 'Reiniciar e atualizar';
  $('update-status').textContent = `Versão ${version} pronta.`;
}
async function installUpdateNow() {
  if (state.mainPeer) {
    broadcast({ type: 'bye' });
    await sleep(200);
  }
  window.baderna.installUpdate();
}
window.baderna?.onUpdateReady(showUpdateReady);
window.baderna?.updateStatus().then(showUpdateReady).catch(() => {});
$('update-chip').addEventListener('click', installUpdateNow);

window.baderna?.appVersion().then((v) => {
  $('app-version').textContent = `v${v}`;
  $('lobby-version').textContent = `v${v}`;
}).catch(() => {});

const UPDATE_MESSAGES = {
  latest: () => 'Você já está na versão mais recente.',
  downloading: (v) => `Baixando a versão ${v}…`,
  dev: () => 'Disponível só no app instalado.',
  error: () => 'Não deu pra verificar agora. Tente mais tarde.',
};
$('update-check').addEventListener('click', async () => {
  if (updateReady) return installUpdateNow();
  $('update-check').disabled = true;
  $('update-status').textContent = 'Verificando…';
  const r = await window.baderna?.checkUpdate().catch(() => null) ?? { status: 'error' };
  $('update-check').disabled = false;
  if (r.status === 'ready') showUpdateReady(r.version);
  else $('update-status').textContent = (UPDATE_MESSAGES[r.status] ?? UPDATE_MESSAGES.error)(r.version);
});

// ---------- Atalhos globais ----------
// Registrados no processo principal (funcionam com o app minimizado); a
// ação chega pelo mesmo caminho do menu da bandeja.

const HOTKEY_PREFS = { mute: 'hotkeyMute', deaf: 'hotkeyDeaf' };
let capturingHotkey = null;

function syncHotkeys() {
  const keys = Object.fromEntries(Object.entries(HOTKEY_PREFS).map(([action, pref]) => [action, loadPref(pref)]));
  renderHotkeys({});
  window.baderna?.setHotkeys(keys).then(renderHotkeys).catch(console.warn);
}

function renderHotkeys(result) {
  const taken = [];
  for (const [action, pref] of Object.entries(HOTKEY_PREFS)) {
    const accel = loadPref(pref);
    $(`hotkey-${action}`).textContent = capturingHotkey === action ? 'Aperte as teclas…' : accel || 'Definir';
    if (accel && result[action] === false) taken.push(accel);
  }
  $('hotkey-status').textContent = capturingHotkey
    ? 'Esc cancela · Backspace remove'
    : taken.length ? `${taken.join(', ')} já está em uso por outro programa.` : '';
}

function accelFromEvent(e) {
  const key = e.code.startsWith('Key') ? e.code.slice(3)
    : e.code.startsWith('Digit') ? e.code.slice(5)
    : /^F([1-9]|1\d|2[0-4])$/.test(e.code) ? e.code : null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  // Tecla sozinha atrapalharia o resto do PC; só F1–F24 pode ir sem modificador.
  if (!mods.length && !/^F\d/.test(key)) return null;
  return [...mods, key].join('+');
}

function startHotkeyCapture(action) {
  capturingHotkey = action;
  renderHotkeys({});
}

window.addEventListener('keydown', (e) => {
  if (!capturingHotkey) return;
  e.preventDefault();
  e.stopPropagation();
  const action = capturingHotkey;
  if (e.key === 'Escape') {
    capturingHotkey = null;
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    savePref(HOTKEY_PREFS[action], '');
    capturingHotkey = null;
  } else {
    const accel = accelFromEvent(e);
    if (!accel) return; // ainda só modificadores
    savePref(HOTKEY_PREFS[action], accel);
    capturingHotkey = null;
  }
  syncHotkeys();
}, true);

document.addEventListener('fullscreenchange', () => {
  const fs = document.fullscreenElement;
  document.body.classList.toggle('is-fullscreen', !!fs);
  // Em tela cheia só o elemento da tela aparece: a fileira de bonecos vai
  // junto pra dentro dele (o mesmo nó, então aura e balanço seguem iguais).
  const stage = document.querySelector('.stage');
  if (fs === $('screen-view')) {
    $('screen-seats-row').append($('seats'));
    showScreenControls();
  }
  else if ($('seats').parentElement !== stage) stage.insertBefore($('seats'), stage.querySelector('.dock'));
  layoutSeats();
  if (!fs && state.splitRestore) {
    const other = state.splitRestore;
    state.splitRestore = null;
    if (state.watching && state.screens.has(other)) {
      state.watchingAlso = other;
      renderWatch();
    }
  }
});

function setFullscreenSeatsHidden(hide) {
  $('screen-view').classList.toggle('hide-seats', hide);
  $('screen-seats-toggle').classList.toggle('off', hide);
  $('screen-seats-toggle').title = hide ? 'Mostrar quem fala' : 'Esconder quem fala';
}
setFullscreenSeatsHidden(loadPref('fsSeats') === 'hide');
$('screen-seats-toggle').addEventListener('click', () => {
  const hide = !$('screen-view').classList.contains('hide-seats');
  setFullscreenSeatsHidden(hide);
  savePref('fsSeats', hide ? 'hide' : 'show');
});

// ---------- Configurações de áudio, pessoa e atalhos ----------

$('mic-gate-auto').addEventListener('change', () => {
  savePref('micGate', $('mic-gate-auto').checked ? '' : '-45');
  applyGate();
});
$('mic-gate').addEventListener('input', () => {
  savePref('micGate', $('mic-gate').value);
  applyGate();
});
applyGate();

// Reabre o mic: a do Chrome muda no getUserMedia e a IA na ligação do portão.
function reopenMic() {
  if (state.mainPeer) switchMic($('mic').value).catch((err) => addSystem(`Não deu pra reabrir o microfone: ${describeError(err)}`));
  else startPreview();
}

$('noise-mode').replaceChildren(...Object.entries(NOISE_MODES).map(([value, label]) => new Option(label, value)));
$('noise-mode').value = noiseMode();
$('noise-mode').addEventListener('change', () => {
  savePref('noise', $('noise-mode').value);
  reopenMic();
});

$('audio-processing').replaceChildren(...Object.entries(AUDIO_PROCESSING).map(([key, label]) => {
  const row = document.createElement('label');
  row.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = loadPref(key) !== 'off';
  box.addEventListener('change', () => {
    savePref(key, box.checked ? 'on' : 'off');
    reopenMic();
  });
  row.append(box, document.createTextNode(label));
  return row;
}));

$('sounds').checked = loadPref('sounds') !== 'off';
$('sounds').addEventListener('change', () => savePref('sounds', $('sounds').checked ? 'on' : 'off'));
$('live-alert').checked = loadPref('liveAlert') !== 'off';
$('live-alert').addEventListener('change', () => savePref('liveAlert', $('live-alert').checked ? 'on' : 'off'));

$('pm-vol').addEventListener('input', () => {
  if (!personMenuFor) return;
  const vol = Number($('pm-vol').value) / 100;
  setPersonPref(personMenuFor.name, { vol });
  $('pm-vol-val').textContent = `${Math.round(vol * 100)}%`;
  applyMemberAudio(personMenuFor);
});
$('pm-mute').addEventListener('click', () => {
  const m = personMenuFor;
  if (!m) return;
  const mute = !personPref(m.name).mute;
  setPersonPref(m.name, { mute });
  $('pm-mute').textContent = mute ? '🔊 Voltar a ouvir' : '🔇 Silenciar pra mim';
  applyMemberAudio(m);
  renderSeat(m);
});
document.addEventListener('pointerdown', (e) => {
  if (!personMenuFor || e.target.closest('#person-menu') || e.target.closest('.seat')) return;
  closePersonMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePersonMenu(); });

for (const action of Object.keys(HOTKEY_PREFS)) {
  $(`hotkey-${action}`).addEventListener('click', () => startHotkeyCapture(action));
}
syncHotkeys();
