'use strict';

// Servidor de repasse da Cloudflare (SFU) pra tela, no esquema híbrido: com
// até 2 pessoas assistindo a tela sai direto (mesh, como sempre); com 3 ou
// mais que suportam, quem transmite manda UMA cópia pro servidor, em 3
// qualidades (simulcast f/h/q), e cada um puxa de lá. O PC codifica uma vez e
// o upload cai pra uma cópia. Se o servidor falhar, volta pro direto.
//
// Credenciais em turn.json (cloudflare.sfuAppId/sfuAppSecret), usadas só no
// processo principal (main.js, sfu:api). Cota: controlada pelo painel da
// Cloudflare, o app não conta.
//
// Mensagens no DataChannel (só pra quem avisou sfu no 'caps'):
//   screen-sfu  quem transmite → todos: { sessionId, audio } publicado;
//               { sessionId, ending } desligando (volta o direto, aguarda);
//               { off } desligado de vez.
//   sfu-rx      quem assiste → quem transmite: { ok } recebo pelo servidor
//               (pode fechar minha cópia direta) / voltei pro direto.

const SFU_MIN_VIEWERS = 3;          // liga com 3+ assistindo
const SFU_OFF_BELOW = 2;            // desliga com menos de 2
const SFU_END_GRACE_MS = 8000;      // desligando: tempo pra cópia direta chegar
const SFU_RETRY_MS = 5 * 60_000;    // falhou: espera antes de tentar de novo
const SFU_CONNECT_MS = 10_000;
const SFU_ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
// Fração do bitrate da qualidade cheia em cada camada.
const SFU_LAYERS = [
  { rid: 'f', scale: 1, share: 1 },
  { rid: 'h', scale: 2, share: 0.35 },
  { rid: 'q', scale: 4, share: 0.12 },
];

state.sfuAvailable = false;
window.baderna?.sfuAvailable?.().then((ok) => { state.sfuAvailable = !!ok; }).catch(() => {});

async function sfuApi(method, apiPath, body) {
  const res = await window.baderna.sfuApi(method, apiPath, body);
  const d = res?.data ?? {};
  const bad = d.tracks?.find((t) => t.errorCode);
  if (!res?.ok || d.errorCode || bad) {
    const code = d.errorCode ?? bad?.errorCode ?? '';
    const desc = d.errorDescription ?? bad?.errorDescription ?? '';
    throw new Error(`${apiPath.split('/').slice(-2).join('/')} ${res?.status ?? '?'} ${code} ${desc}`.trim());
  }
  return d;
}

function sfuIceDone(pc, ms = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function sfuConnected(pc, ms = SFU_CONNECT_MS) {
  if (pc.connectionState === 'connected') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (pc.connectionState === 'connected') done(null);
      else if (['failed', 'closed'].includes(pc.connectionState)) done(new Error(`conexão ${pc.connectionState}`));
    };
    const done = (err) => {
      clearTimeout(timer);
      pc.removeEventListener('connectionstatechange', check);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => done(new Error('conexão não abriu')), ms);
    pc.addEventListener('connectionstatechange', check);
  });
}

// H.264 primeiro: simulcast funciona na placa e é leve de decodificar (quem
// tem decodificador fraco agradece); VP8 se não tiver.
function sfuPreferCodecs(transceiver) {
  const caps = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
  const rank = (c) => {
    const name = c.mimeType.split('/')[1].toUpperCase();
    if (name === 'H264') return /packetization-mode=1/.test(c.sdpFmtpLine ?? '') ? 0 : 1;
    if (name === 'VP8') return 2;
    if (['RTX', 'RED', 'ULPFEC', 'FLEXFEC-03'].includes(name)) return 9;
    return 5;
  };
  try {
    transceiver.setCodecPreferences([...caps].sort((a, b) => rank(a) - rank(b)));
  } catch (err) {
    console.warn('sfu codecs', err);
  }
}

// ---------- Quem transmite ----------

function isSfuViewer(member) {
  const pub = state.screen?.sfu;
  return !!(pub?.ready && !pub.ending && pub.rx.has(member.id));
}

function sfuViewerCount() {
  return [...state.members.values()].filter((m) => m.sfuOk && m.watchingIds?.includes(state.myId)).length;
}

// Roda quando alguém abre/fecha a transmissão, entra ou sai.
function updateSfu() {
  const screen = state.screen;
  if (!screen || !state.sfuAvailable) return;
  const n = sfuViewerCount();
  const pub = screen.sfu;
  if (!pub && n >= SFU_MIN_VIEWERS && Date.now() - (screen.sfuFailedAt ?? 0) > SFU_RETRY_MS) {
    startSfuPublish(screen);
  } else if (pub?.ready && !pub.ending && n < SFU_OFF_BELOW) {
    endSfuPublish(screen, 'pouca gente assistindo');
  }
}

async function startSfuPublish(screen) {
  const pub = { pc: null, sessionId: null, ready: false, ending: false, rx: new Set() };
  screen.sfu = pub;
  try {
    const pc = new RTCPeerConnection({ iceServers: SFU_ICE, bundlePolicy: 'max-bundle' });
    pub.pc = pc;
    const full = Math.round(screen.preset.maxBitrate * (CODEC_EFFICIENCY.H264 ?? 1));
    const video = pc.addTransceiver(screen.stream.getVideoTracks()[0], {
      direction: 'sendonly',
      sendEncodings: SFU_LAYERS.map((l) => ({
        rid: l.rid, scaleResolutionDownBy: l.scale, maxBitrate: Math.max(MIN_SCREEN_BITRATE, Math.round(full * l.share)),
      })),
    });
    sfuPreferCodecs(video);
    const audioTrack = screen.stream.getAudioTracks()[0];
    const audio = audioTrack ? pc.addTransceiver(audioTrack, { direction: 'sendonly' }) : null;
    await pc.setLocalDescription(await pc.createOffer());
    await sfuIceDone(pc);

    const { sessionId } = await sfuApi('POST', 'sessions/new');
    pub.sessionId = sessionId;
    const tracks = [{ location: 'local', mid: video.mid, trackName: 'video' }];
    if (audio) tracks.push({ location: 'local', mid: audio.mid, trackName: 'audio' });
    const res = await sfuApi('POST', `sessions/${sessionId}/tracks/new`, {
      sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp },
      tracks,
    });
    await pc.setRemoteDescription({ type: 'answer', sdp: opusStereo(res.sessionDescription.sdp) });
    await sfuConnected(pc);
    if (state.screen !== screen || screen.sfu !== pub) {
      pc.close();
      return;
    }
    pub.ready = true;
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') sfuPublishFailed(screen, pub, 'conexão com o servidor caiu');
    });
    watchPath(pc, 'tela pro servidor', { name: 'Cloudflare' });
    endRelay('servidor ligado'); // relay.js: o servidor já faz o repasse
    broadcast({ type: 'screen-sfu', sessionId, audio: !!audio });
    logEvent('sfu: transmitindo pelo servidor', { assistindo: sfuViewerCount(), qualidade: `${Math.round(full / 1e5) / 10} Mbps` });
    addSystem('📡 Bastante gente assistindo: sua tela agora sai uma vez só pro servidor, que repassa pra galera.');
    updateShareLabel();
  } catch (err) {
    sfuPublishFailed(screen, pub, err.message);
  }
}

function sfuPublishFailed(screen, pub, why) {
  if (screen.sfu !== pub) return;
  logEvent('sfu: falhou ao transmitir', why);
  screen.sfu = null;
  screen.sfuFailedAt = Date.now();
  pub.pc?.close();
  if (pub.ready) broadcast({ type: 'screen-sfu', off: true });
  if (state.screen !== screen) return;
  for (const m of state.members.values()) syncScreenOut(m);
  updateShareLabel();
}

// Desliga sem buraco: avisa, volta a mandar direto pra todo mundo e só fecha
// o servidor quando deu tempo de as cópias diretas chegarem.
function endSfuPublish(screen, why) {
  const pub = screen.sfu;
  if (!pub || pub.ending) return;
  pub.ending = true;
  logEvent('sfu: desligando', why);
  broadcast({ type: 'screen-sfu', sessionId: pub.sessionId, ending: true });
  for (const m of state.members.values()) syncScreenOut(m);
  retuneScreen();
  setTimeout(() => {
    if (screen.sfu !== pub) return;
    screen.sfu = null;
    pub.pc?.close();
    broadcast({ type: 'screen-sfu', off: true });
    if (state.screen === screen) updateShareLabel();
  }, SFU_END_GRACE_MS);
}

// Chamado por stopShare (app.js).
function sfuStopShare(screen) {
  const pub = screen?.sfu;
  if (!pub) return;
  screen.sfu = null;
  pub.pc?.close();
}

// Quem acabou de entrar na sala: avisa se já estou no servidor.
function sfuGreet(member) {
  const pub = state.screen?.sfu;
  if (pub?.ready && !pub.ending) member.conn?.send({ type: 'screen-sfu', sessionId: pub.sessionId, audio: pub.pc.getTransceivers().length > 1 });
}

// ---------- Quem assiste ----------

function syncSfuIn(member) {
  const pub = member.sfuPub;
  const want = !!pub && state.sfuAvailable && state.tuned.has(member.id) && member.sfuFailedFor !== pub.sessionId;
  if (want && member.sfuIn?.pubSession !== pub.sessionId) {
    closeSfuIn(member);
    startSfuIn(member);
  } else if (!want && member.sfuIn && !member.sfuIn.ending) {
    closeSfuIn(member);
    member.conn?.send({ type: 'sfu-rx', ok: false });
  }
}

async function startSfuIn(member) {
  const pub = member.sfuPub;
  const rx = { pc: null, stream: null, sessionId: null, pubSession: pub.sessionId, ending: false };
  member.sfuIn = rx;
  try {
    const pc = new RTCPeerConnection({ iceServers: SFU_ICE, bundlePolicy: 'max-bundle' });
    rx.pc = pc;
    const stream = new MediaStream();
    pc.addEventListener('track', (e) => stream.addTrack(e.track));
    const { sessionId } = await sfuApi('POST', 'sessions/new');
    rx.sessionId = sessionId;
    const tracks = [{
      location: 'remote', sessionId: pub.sessionId, trackName: 'video',
      simulcast: { preferredRid: 'f', priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' },
    }];
    if (pub.audio) tracks.push({ location: 'remote', sessionId: pub.sessionId, trackName: 'audio' });
    const res = await sfuApi('POST', `sessions/${sessionId}/tracks/new`, { tracks });
    if (member.sfuIn !== rx) return pc.close();
    await pc.setRemoteDescription({ type: 'offer', sdp: opusStereo(res.sessionDescription.sdp) });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription({ type: 'answer', sdp: opusStereo(answer.sdp) });
    await sfuIceDone(pc);
    await sfuApi('PUT', `sessions/${sessionId}/renegotiate`, { sessionDescription: { type: 'answer', sdp: pc.localDescription.sdp } });
    await sfuConnected(pc);
    if (member.sfuIn !== rx) return pc.close();
    rx.stream = stream;
    pc.addEventListener('connectionstatechange', () => {
      if (member.sfuIn === rx && ['failed', 'closed'].includes(pc.connectionState)) sfuInFailed(member, 'conexão com o servidor caiu');
    });
    watchPath(pc, 'tela pelo servidor', member);
    registerScreen(member.id, `Tela de ${member.name}`, stream, true);
    renderSeat(member);
    member.conn?.send({ type: 'sfu-rx', ok: true });
    logEvent('sfu: assistindo pelo servidor', member.name, shortId(member.id));
  } catch (err) {
    if (member.sfuIn === rx) sfuInFailed(member, err.message);
    else rx.pc?.close();
  }
}

function sfuInFailed(member, why) {
  logEvent('sfu: falhou ao assistir', member.name, why);
  member.sfuFailedFor = member.sfuIn?.pubSession;
  closeSfuIn(member);
  member.conn?.send({ type: 'sfu-rx', ok: false });
  // A cópia direta pode ainda estar aberta: volta a mostrar ela.
  const direct = member.screenIn?.remoteStream;
  if (direct) registerScreen(member.id, `Tela de ${member.name}`, direct, true);
}

function closeSfuIn(member) {
  const rx = member.sfuIn;
  member.sfuIn = null;
  rx?.pc?.close();
}

// A cópia direta chegou (attachScreenIn). Devolve true se ela deve ser
// ignorada porque estou bem servido pelo servidor.
function sfuTakesDirect(member) {
  const rx = member.sfuIn;
  if (!rx?.stream) return false;
  if (rx.ending) {
    closeSfuIn(member); // desligando: a cópia direta assume
    return false;
  }
  return true;
}

// ---------- Mensagens ----------

function handleSfuMessage(member, msg) {
  if (msg.type === 'sfu-rx') {
    const pub = state.screen?.sfu;
    if (!pub) return;
    if (msg.ok) pub.rx.add(member.id);
    else pub.rx.delete(member.id);
    syncScreenOut(member);
    retuneScreen();
    return;
  }
  // screen-sfu
  if (msg.off || msg.ending || typeof msg.sessionId !== 'string') {
    member.sfuPub = null;
    const rx = member.sfuIn;
    if (!rx) return;
    if (msg.ending && rx.stream) {
      rx.ending = true; // segue mostrando até a cópia direta chegar
      member.conn?.send({ type: 'sfu-rx', ok: false });
    } else {
      closeSfuIn(member);
      const direct = member.screenIn?.remoteStream;
      if (direct) registerScreen(member.id, `Tela de ${member.name}`, direct, true);
    }
    return;
  }
  member.sfuPub = { sessionId: msg.sessionId.slice(0, 64), audio: !!msg.audio };
  syncSfuIn(member);
}
