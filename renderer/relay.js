'use strict';

// Ajuda de upload: quem está assistindo uma transmissão pode emprestar o
// próprio upload. Quem transmite manda uma cópia pro ajudante (só um por
// transmissão) e o ajudante repassa pra quem mais está assistindo, até
// RELAY_MAX_VIEWERS pessoas. O upload de quem transmite cai pra uma cópia (mais
// quem sobrar). Custo: o ajudante codifica de novo (CPU/placa dele, um pouco
// de atraso e de qualidade).
//
// Quem transmite decide quem recebe do ajudante e avisa todo mundo (relay).
// Se o ajudante parar, cair ou sair da transmissão, ou se o repasse não chegar
// em alguém (relay-fail), quem transmite volta a mandar direto. Enquanto
// ajuda, o boneco fica de braços pra cima doando energia.
//
// Mensagens no DataChannel: relay-offer, relay-stop (ajudante → quem
// transmite), relay-busy (resposta: já tem ajudante), relay (quem transmite →
// todos: { helper, viewers, maxBitrate, mode }), relay-fail (quem assiste →
// quem transmite: o repasse não chegou). Só vale pra quem avisou relay no 'caps'.

const RELAY_MAX_VIEWERS = 6;
const RELAY_HANDOFF_MS = 5000; // depois disso, fecha a cópia direta de quem passou pro ajudante

state.relays = new Map(); // quem transmite → { helper, viewers, maxBitrate, mode }
state.helping = null;     // eu ajudando: { streamer, source, calls: Map viewerId → call }

function isHelper(id) {
  if (id === state.myId) return !!state.helping;
  for (const r of state.relays.values()) if (r.helper === id) return true;
  return false;
}

// ---------- Quem transmite ----------

function isRelayedViewer(member) {
  return !!state.screen?.relay?.viewers.has(member.id);
}

function handleRelayOffer(member) {
  const screen = state.screen;
  const ok = screen && member.relayOk && member.watchingIds?.includes(state.myId);
  if (!ok || (screen.relay && screen.relay.helper !== member.id)) {
    member.conn?.send({ type: 'relay-busy' });
    return;
  }
  if (!screen.relay) {
    screen.relay = { helper: member.id, viewers: new Set(), excluded: new Set() };
    addSystem(`🙌 ${member.name} levantou as mãos e tá emprestando upload pra sua transmissão.`);
    logEvent('ajuda: começou', member.name, shortId(member.id));
  }
  updateRelay(true);
}

// Recalcula quem recebe do ajudante. Roda quando alguém abre ou fecha a
// transmissão, sai da sala ou o repasse falha.
function updateRelay(force = false) {
  const screen = state.screen;
  const r = screen?.relay;
  if (!r) return;
  const next = [...state.members.values()]
    .filter((m) => m.id !== r.helper && m.relayOk && m.watchingIds?.includes(state.myId) && !r.excluded.has(m.id))
    .slice(0, RELAY_MAX_VIEWERS)
    .map((m) => m.id);
  const added = next.filter((id) => !r.viewers.has(id));
  const changed = force || added.length || next.length !== r.viewers.size;
  r.viewers = new Set(next);
  const info = { helper: r.helper, viewers: next, maxBitrate: screen.preset.maxBitrate, mode: screen.mode };
  state.relays.set(state.myId, info);
  if (changed) broadcast({ type: 'relay', ...info });
  // Dá tempo da cópia do ajudante chegar antes de cortar a minha.
  for (const id of added) {
    setTimeout(() => {
      const m = state.members.get(id);
      if (state.screen !== screen || !screen.relay?.viewers.has(id) || !m?.screenOut) return;
      const call = m.screenOut;
      m.screenOut = null;
      call.close();
      retuneScreen();
    }, RELAY_HANDOFF_MS);
  }
  for (const m of state.members.values()) syncScreenOut(m);
  renderAll();
}

// helperName: quem saiu da sala já não está em state.members.
function endRelay(why, helperName) {
  const screen = state.screen;
  const r = screen?.relay;
  if (!r) return;
  screen.relay = null;
  state.relays.delete(state.myId);
  broadcast({ type: 'relay', helper: null, viewers: [] });
  const name = helperName ?? state.members.get(r.helper)?.name ?? 'O ajudante';
  addSystem(`${name} parou de emprestar upload. Sua transmissão volta a sair toda daqui.`);
  logEvent('ajuda: acabou', why);
  for (const m of state.members.values()) syncScreenOut(m);
  renderAll();
}

// 'watching' de alguém mudou.
function relayWatchingChanged(member) {
  const r = state.screen?.relay;
  if (!r) return;
  if (r.helper === member.id && !member.watchingIds?.includes(state.myId)) endRelay('ajudante saiu da transmissão');
  else updateRelay();
}

// ---------- Ajudante ----------

function offerHelp(streamerId) {
  const m = state.members.get(streamerId);
  if (!m?.conn?.open || state.screen || state.helping) return;
  m.conn.send({ type: 'relay-offer' });
}

function stopHelping(notify = true) {
  const h = state.helping;
  if (!h) return;
  state.helping = null;
  for (const call of h.calls.values()) call.close();
  if (notify) state.members.get(h.streamer)?.conn?.send({ type: 'relay-stop' });
  renderSelf();
  updateHelpButton();
}

// Abre/fecha os repasses conforme a lista de quem transmite.
function syncRelayOut() {
  const h = state.helping;
  if (!h) return;
  const rel = state.relays.get(h.streamer);
  if (rel?.helper !== state.myId) {
    stopHelping(false);
    return;
  }
  const source = state.screens.get(h.streamer)?.stream ?? null;
  // Cópia de quem transmite reconectou: stream novo, repasses novos.
  if (h.source !== source) {
    for (const call of h.calls.values()) call.close();
    h.calls.clear();
    h.source = source;
  }
  if (!source) return;
  const want = new Set(rel.viewers);
  for (const [id, call] of h.calls) {
    if (want.has(id)) continue;
    h.calls.delete(id);
    call.close();
  }
  for (const id of want) {
    if (!h.calls.has(id) && state.members.has(id)) relayTo(id);
  }
  for (const call of h.calls.values()) tuneRelayCall(call);
}

function relayTo(id) {
  const h = state.helping;
  const codecs = state.codecOrder ?? CODEC_FALLBACK_ORDER;
  const call = state.mainPeer.call(id, h.source, {
    metadata: { kind: 'screen', relayOf: h.streamer, codecs },
    sdpTransform: (sdp) => opusStereo(preferVideoCodecs(sdp, codecs)),
  });
  if (!call) return;
  h.calls.set(id, call);
  const pc = call.peerConnection;
  watchPath(pc, 'tela repassada', state.members.get(id));
  pc?.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'connected') tuneRelayCall(call);
  });
  call.on('close', () => {
    if (h.calls.get(id) === call) h.calls.delete(id);
  });
}

// Bitrate de cada repasse: o ideal da qualidade escolhida por quem transmite,
// no codec daqui; com limite de upload configurado, divide entre os repasses.
function tuneRelayCall(call) {
  const h = state.helping;
  const rel = h && state.relays.get(h.streamer);
  const pc = call.peerConnection;
  if (!rel || pc?.connectionState !== 'connected') return;
  const budget = uploadBudgetBps();
  const n = Math.max(1, h.calls.size);
  for (const sender of pc.getSenders()) {
    const kind = sender.track?.kind;
    if (kind === 'audio') {
      updateSender(sender, (params) => { params.encodings[0].maxBitrate = SCREEN_AUDIO_BITRATE; });
    } else if (kind === 'video') {
      updateSender(sender, (params) => {
        const codec = params.codecs?.[0]?.mimeType.split('/')[1]?.toUpperCase() ?? 'VP8';
        const ideal = (Number(rel.maxBitrate) || SHARE_PRESETS['1080p30'].maxBitrate) * (CODEC_EFFICIENCY[codec] ?? 1);
        const share = budget
          ? (budget * UPLOAD_HEADROOM - VOICE_RESERVE_BPS * state.members.size) / n - SCREEN_AUDIO_BITRATE
          : ideal;
        params.encodings[0].maxBitrate = Math.round(Math.max(MIN_SCREEN_BITRATE, Math.min(ideal, share)));
        params.degradationPreference = rel.mode === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      });
    }
  }
}

// ---------- Mensagens ----------

function handleRelayMessage(sender, msg) {
  switch (msg.type) {
    case 'relay-offer':
      handleRelayOffer(sender);
      break;
    case 'relay-stop':
      if (state.screen?.relay?.helper === sender.id) endRelay('ajudante parou');
      break;
    case 'relay-busy':
      addSystem('Não deu pra ajudar: essa transmissão já tem ajudante (ou acabou).');
      break;
    case 'relay-fail': {
      const r = state.screen?.relay;
      if (!r?.viewers.has(sender.id)) break;
      logEvent('ajuda: repasse não chegou', sender.name, shortId(sender.id));
      r.excluded.add(sender.id);
      updateRelay(true);
      break;
    }
    case 'relay': {
      const before = state.relays.get(sender.id)?.helper ?? null;
      const helper = typeof msg.helper === 'string' && msg.helper ? msg.helper : null;
      if (helper) {
        state.relays.set(sender.id, {
          helper,
          viewers: Array.isArray(msg.viewers) ? msg.viewers.filter((x) => typeof x === 'string').slice(0, RELAY_MAX_VIEWERS) : [],
          maxBitrate: Number(msg.maxBitrate) || 0,
          mode: msg.mode === 'detail' ? 'detail' : 'motion',
        });
      } else {
        state.relays.delete(sender.id);
      }
      if (helper !== before) announceHelper(sender, before, helper);
      if (helper === state.myId && !state.helping && !state.screen) {
        state.helping = { streamer: sender.id, source: null, calls: new Map() };
        renderSelf();
      }
      if (state.helping?.streamer === sender.id) syncRelayOut();
      renderAll();
      updateHelpButton();
      break;
    }
  }
}

function announceHelper(streamer, before, helper) {
  const nameOf = (id) => (id === state.myId ? 'Você' : state.members.get(id)?.name ?? '?');
  if (helper) {
    addSystem(`🙌 ${nameOf(helper)} levantou as mãos e tá emprestando upload pra transmissão de ${streamer.name}.`);
  } else if (before) {
    addSystem(`${nameOf(before)} parou de emprestar upload pra ${streamer.name}.`);
  }
}

// A transmissão acabou ou a pessoa saiu.
function relayStreamerGone(id) {
  if (state.helping?.streamer === id) stopHelping(false);
  if (state.relays.delete(id)) renderAll();
  updateHelpButton();
}

// Saiu alguém da sala.
function relayMemberGone(id, name) {
  relayStreamerGone(id);
  const r = state.screen?.relay;
  if (!r) return;
  if (r.helper === id) endRelay('ajudante saiu da sala', name);
  else updateRelay();
}

// Do lado de quem assiste: o repasse fechou sem a transmissão ter passado de
// volta pra quem transmite. Pede pra receber direto.
function relayInClosed(streamer, call) {
  const rel = state.relays.get(streamer.id);
  if (rel?.helper !== call.peer || !rel.viewers.includes(state.myId)) return;
  if (!state.tuned.has(streamer.id) || !streamer.conn?.open) return;
  streamer.conn.send({ type: 'relay-fail' });
}

function resetRelays() {
  stopHelping(false);
  state.relays.clear();
}

// ---------- Botão no player ----------

function updateHelpButton() {
  const btn = $('screen-help');
  const id = state.watching;
  const m = id && id !== state.myId ? state.members.get(id) : null;
  const rel = m && state.relays.get(m.id);
  const mine = state.helping?.streamer === id;
  const show = !!m && m.relayOk && !state.screen && (mine || (!state.helping && !rel));
  btn.hidden = !show;
  if (!show) return;
  btn.textContent = mine ? '🙌 Parar de ajudar' : '🙌 Emprestar upload';
  btn.classList.toggle('on', mine);
  btn.title = mine
    ? 'Você está repassando a transmissão pra galera'
    : 'Repassa esta transmissão pra quem mais está assistindo, com o seu upload (usa sua placa de vídeo pra codificar)';
}

$('screen-help').addEventListener('click', () => {
  const id = state.watching;
  if (state.helping?.streamer === id) stopHelping();
  else if (id) offerHelp(id);
});
