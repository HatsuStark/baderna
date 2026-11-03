'use strict';

// Cargos da sala: o criador (quem abriu a sala) e o host (quem segura o código
// da sala, ver app.js) podem mutar qualquer um pra todos e retirar da sala. O
// criador manda mais que o host: o host não mexe no criador.
//
// Sem servidor, quem é quem se prova com uma chave: cada instalação tem um par
// ECDSA P-256 salvo no PC. O 'profile' leva a chave pública e a assinatura do
// ID de conexão (novo a cada entrada), então ninguém se passa por outro só
// copiando a chave. O criador é a chave de quem abriu a sala; sala salva
// lembra essa chave e continua com o mesmo criador nas próximas vezes.
//
// Mensagem no DataChannel: mod { action: mute | unmute | kick, target }. Cada
// um confere se quem mandou pode mexer no alvo antes de obedecer, e quem é
// mutado é calado também do lado de quem ouve (cliente alterado não escapa).
// Retirado que tenta voltar fica batendo na porta: o host segura a conexão
// dele e avisa a moderação (knock); o host ou o criador deixa entrar ou
// recusa (knock-answer vai pro host, que decide e avisa todo mundo com
// knock-done). Sem resposta em KNOCK_TIMEOUT_MS, fica de fora. Enquanto está
// na lista, cada um derruba a conexão se a chave (ou o ID) aparecer.

const ID_KEY_PREF = 'identity';
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDSA_SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const PUBKEY_RE = /^[A-Za-z0-9+/]{87}=$/; // 65 bytes (ponto não comprimido) em base64
const MOD_LIST_MAX = 50;
const KNOCK_TIMEOUT_MS = 60_000;
const knocks = new Map(); // só no host: peerId de quem bate → { conn, name, key, timer }

const roles = {
  identity: null,   // { pub (base64), priv (CryptoKey) }
  sig: '',          // assinatura do meu ID de conexão atual
  creatorKey: '',   // chave pública do criador da sala
  muted: new Set(), // chaves (ou IDs, pra quem não tem chave) mutadas pra todos
  kicked: new Set(), // chaves (ou IDs) retiradas da sala
  modMuted: false,  // eu fui mutado por um moderador
  mutedBeforeMod: false,
};

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function ensureIdentity() {
  if (roles.identity) return roles.identity;
  try {
    const saved = JSON.parse(loadPref(ID_KEY_PREF) || 'null');
    if (saved && PUBKEY_RE.test(saved.pub) && saved.priv) {
      const priv = await crypto.subtle.importKey('jwk', saved.priv, ECDSA, false, ['sign']);
      roles.identity = { pub: saved.pub, priv };
      return roles.identity;
    }
  } catch {}
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const pub = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
  savePref(ID_KEY_PREF, JSON.stringify({ pub, priv: await crypto.subtle.exportKey('jwk', pair.privateKey) }));
  roles.identity = { pub, priv: pair.privateKey };
  return roles.identity;
}

// Chamado ao entrar, com o ID de conexão já aberto.
async function signMyId() {
  const { priv } = await ensureIdentity();
  roles.sig = toB64(await crypto.subtle.sign(ECDSA_SIGN, priv, new TextEncoder().encode(state.myId)));
}

function myKey() {
  return roles.identity?.pub ?? '';
}

// Confere a chave que veio no 'profile'. Só marca member.key se a assinatura
// do ID dele bater.
async function verifyMemberKey(member, key, sig) {
  if (typeof key !== 'string' || !PUBKEY_RE.test(key) || typeof sig !== 'string' || sig.length > 200) return;
  if (member.key === key) return;
  try {
    const pub = await crypto.subtle.importKey('raw', fromB64(key), ECDSA, false, ['verify']);
    const ok = await crypto.subtle.verify(ECDSA_SIGN, pub, fromB64(sig), new TextEncoder().encode(member.id));
    if (!ok || state.members.get(member.id) !== member) return;
  } catch {
    return;
  }
  member.key = key;
  if (roles.kicked.has(key)) {
    logEvent('cargos: retirado tentou voltar', member.name, shortId(member.id));
    removeMember(member.id, 'kicked');
    return;
  }
  applyMemberAudio(member);
  renderSeat(member);
  if (personMenuFor === member) renderModMenu(member);
}

// Marca de alguém nas listas: a chave, ou o ID pra quem não tem.
function markOf(member) {
  return member.key || member.id;
}

function isCreatorKey(key) {
  return !!key && key === roles.creatorKey;
}

function isCreator(id) {
  if (id === state.myId) return isCreatorKey(myKey());
  return isCreatorKey(state.members.get(id)?.key);
}

function isHost(id) {
  return !!id && id === state.hostId;
}

function canModerate(id) {
  return isCreator(id) || isHost(id);
}

// actor pode mexer em target? O criador mexe em todo mundo; o host, em todo
// mundo menos no criador. Ninguém mexe em si mesmo.
function outranks(actorId, targetId) {
  if (actorId === targetId || !canModerate(actorId)) return false;
  return isCreator(actorId) || !isCreator(targetId);
}

function isModMuted(member) {
  return roles.muted.has(markOf(member)) || roles.muted.has(member.id);
}

function rolesForWelcome() {
  return { creator: roles.creatorKey, muted: [...roles.muted], kicked: [...roles.kicked] };
}

function cleanMarks(list) {
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.length <= 100).slice(0, MOD_LIST_MAX) : [];
}

function applyWelcomeRoles(info) {
  if (typeof info?.creator === 'string' && PUBKEY_RE.test(info.creator)) roles.creatorKey = info.creator;
  roles.muted = new Set(cleanMarks(info?.muted));
  roles.kicked = new Set(cleanMarks(info?.kicked));
  rememberRoomCreator();
  if (roles.muted.has(myKey())) applyModMute(true);
}

// Abri a sala: o criador é quem a sala salva lembra; sem isso, eu.
function startRoles(room) {
  const saved = savedRoom(room)?.creator;
  roles.creatorKey = saved && PUBKEY_RE.test(saved) ? saved : myKey();
  roles.muted.clear();
  roles.kicked.clear();
  rememberRoomCreator();
}

function resetRoles() {
  roles.creatorKey = '';
  roles.sig = '';
  roles.muted = new Set();
  roles.kicked = new Set();
  roles.modMuted = false;
  roles.mutedBeforeMod = false;
  for (const k of knocks.values()) clearTimeout(k.timer);
  knocks.clear();
  knockEls.clear();
}

// O host confere quem bate no código da sala antes de mandar a lista.
function isBanned(peerId, key) {
  return roles.kicked.has(peerId) || (!!key && roles.kicked.has(key));
}

// ---------- Ações ----------

function moderate(member, action) {
  if (!outranks(state.myId, member.id) || !state.members.has(member.id)) return;
  broadcast({ type: 'mod', action, target: member.id });
  applyMod(state.name, member, action);
}

function handleModMessage(sender, msg) {
  if (!['mute', 'unmute', 'kick'].includes(msg.action) || typeof msg.target !== 'string') return;
  if (!outranks(sender.id, msg.target)) {
    logEvent('cargos: ação recusada', msg.action, sender.name, shortId(sender.id));
    return;
  }
  if (msg.target === state.myId) {
    applyModOnMe(sender.name, msg.action);
    return;
  }
  const target = state.members.get(msg.target);
  if (target) applyMod(sender.name, target, msg.action);
}

function applyMod(actorName, target, action) {
  const mark = markOf(target);
  if (action === 'kick') {
    roles.kicked.add(mark);
    roles.kicked.add(target.id);
    roles.muted.delete(mark);
    addSystem(`${actorName} retirou ${target.name} da sala.`);
    removeMember(target.id, 'kicked');
    return;
  }
  const mute = action === 'mute';
  if (mute === isModMuted(target)) return;
  if (mute) roles.muted.add(mark);
  else {
    roles.muted.delete(mark);
    roles.muted.delete(target.id);
  }
  addSystem(mute ? `${actorName} mutou ${target.name} pra todo mundo.` : `${actorName} desmutou ${target.name}.`);
  applyMemberAudio(target);
  renderSeat(target);
  if (personMenuFor === target) renderModMenu(target);
}

function applyModOnMe(actorName, action) {
  if (action === 'kick') {
    kickedOut(`${actorName} te retirou da sala.`);
    return;
  }
  const mute = action === 'mute';
  if (mute === roles.modMuted) return;
  if (mute) roles.muted.add(myKey() || state.myId);
  else {
    roles.muted.delete(myKey());
    roles.muted.delete(state.myId);
  }
  applyModMute(mute);
  addSystem(mute ? `${actorName} te mutou pra todo mundo. Só um moderador desfaz.` : `${actorName} te desmutou.`);
}

// Mutado por moderador: o mic fecha e o botão não abre até desmutarem.
function applyModMute(on) {
  roles.modMuted = on;
  if (on) {
    roles.mutedBeforeMod = state.muted;
    setMuted(true);
  } else {
    setMuted(state.deaf || roles.mutedBeforeMod);
  }
  broadcast(myProfile());
  updateDock();
  renderSelf();
}

// ---------- Pedido de volta de quem foi retirado ----------

// No host: conexão no código da sala de alguém da lista de retirados.
function knock(conn) {
  const id = conn.peer;
  if (knocks.has(id)) return;
  const name = cleanName(conn.metadata?.name);
  const key = typeof conn.metadata?.key === 'string' && PUBKEY_RE.test(conn.metadata.key) ? conn.metadata.key : '';
  conn.send({ type: 'knock-wait' });
  const timer = setTimeout(() => answerKnock(id, false, ''), KNOCK_TIMEOUT_MS);
  knocks.set(id, { conn, name, key, timer });
  // Desistiu (fechou o app): o pedido some.
  conn.on('close', () => {
    if (knocks.has(id)) answerKnock(id, false, '');
  });
  logEvent('cargos: retirado pedindo pra voltar', name, shortId(id));
  broadcast({ type: 'knock', id, name });
  showKnock(id, name);
}

// No host: decide e avisa todo mundo. by vazio = ninguém respondeu.
function answerKnock(id, allow, by) {
  const k = knocks.get(id);
  if (!k) return;
  clearTimeout(k.timer);
  knocks.delete(id);
  if (allow) {
    if (k.key) roles.kicked.delete(k.key);
    roles.kicked.delete(id);
    sendWelcome(k.conn);
  } else {
    if (k.conn.open) k.conn.send({ type: 'denied' });
    setTimeout(() => k.conn.close(), 1000);
  }
  broadcast({ type: 'knock-done', id, allow, by, key: allow ? k.key : '' });
  closeKnock(id, allow, by, k.name);
}

function respondKnock(id, allow) {
  if (isHost(state.myId)) {
    answerKnock(id, allow, state.name);
    return;
  }
  const host = state.members.get(state.hostId);
  if (host?.conn?.open) host.conn.send({ type: 'knock-answer', id, allow });
}

function handleKnockMessage(sender, msg) {
  if (typeof msg.id !== 'string') return;
  if (msg.type === 'knock') {
    if (isHost(sender.id) && canModerate(state.myId)) showKnock(msg.id, cleanName(msg.name));
  } else if (msg.type === 'knock-answer') {
    if (isHost(state.myId) && canModerate(sender.id)) answerKnock(msg.id, !!msg.allow, sender.name);
  } else if (msg.type === 'knock-done') {
    if (!isHost(sender.id)) return;
    if (msg.allow && typeof msg.key === 'string') roles.kicked.delete(msg.key);
    const name = knockEls.get(msg.id)?.dataset.name ?? '';
    closeKnock(msg.id, !!msg.allow, typeof msg.by === 'string' ? cleanName(msg.by) : '', name);
  }
}

const knockEls = new Map(); // peerId → aviso no chat

// Aviso no chat com os botões, só pra quem pode decidir.
function showKnock(id, name) {
  if (knockEls.has(id)) return;
  const el = document.createElement('div');
  el.className = 'sys knock';
  el.dataset.name = name;
  const text = document.createElement('span');
  text.textContent = `${name} foi retirado e está pedindo pra voltar.`;
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'ghost';
  yes.textContent = 'Deixar entrar';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'ghost danger';
  no.textContent = 'Recusar';
  for (const [btn, allow] of [[yes, true], [no, false]]) {
    btn.addEventListener('click', () => {
      yes.disabled = no.disabled = true;
      respondKnock(id, allow);
    });
  }
  el.append(text, yes, no);
  knockEls.set(id, el);
  appendTimeline(el);
  state.lastChat = null;
  playBlip(true);
}

function closeKnock(id, allow, by, name) {
  const el = knockEls.get(id);
  knockEls.delete(id);
  if (!el) return;
  el.classList.remove('knock');
  el.textContent = !by ? `Ninguém respondeu: ${name} ficou de fora.`
    : allow ? `${by} deixou ${name} voltar.` : `${by} não deixou ${name} voltar.`;
}

// ---------- Menu da pessoa ----------

function renderModMenu(member) {
  const box = $('pm-mod');
  const can = outranks(state.myId, member.id);
  box.hidden = !can;
  if (!can) return;
  $('pm-mod-mute').textContent = isModMuted(member) ? '🎙 Desmutar pra todos' : '🚫 Mutar pra todos';
  const kick = $('pm-mod-kick');
  kick.textContent = '🚪 Retirar da sala';
  kick.classList.remove('confirm');
}

$('pm-mod-mute').addEventListener('click', () => {
  const m = personMenuFor;
  if (m) moderate(m, isModMuted(m) ? 'unmute' : 'mute');
});

// Retirar pede um segundo clique.
$('pm-mod-kick').addEventListener('click', () => {
  const m = personMenuFor;
  if (!m) return;
  const kick = $('pm-mod-kick');
  if (!kick.classList.contains('confirm')) {
    kick.classList.add('confirm');
    kick.textContent = `Retirar ${m.name}? Clique de novo`;
    return;
  }
  closePersonMenu();
  moderate(m, 'kick');
});
