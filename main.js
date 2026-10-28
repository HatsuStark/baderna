const { app, BrowserWindow, Menu, Tray, nativeImage, session, desktopCapturer, ipcMain, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Instalado, o .exe fica fora do asar (não dá pra executar de dentro dele).
const PROC_AUDIO = app.isPackaged
  ? path.join(process.resourcesPath, 'proc-audio.exe')
  : path.join(__dirname, 'native', 'bin', 'proc-audio.exe');
const PCM_FRAME_BYTES = 4; // 16-bit estéreo

// --profile=NOME usa uma pasta de dados separada; permite abrir várias instâncias pra testar.
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) {
  const profile = profileArg.split('=')[1].replace(/[^\w-]/g, '');
  app.setPath('userData', path.join(app.getPath('userData'), `profile-${profile}`));
}

// Uma instância só: abrir o atalho com o app na bandeja traz a janela de
// volta. Perfis de teste (--profile) ficam livres pra abrir várias.
const gotLock = !!profileArg || app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => showWindow());

// Tela/janela escolhida no seletor do renderer; consumida pelo próximo getDisplayMedia.
let pendingSourceId = null;

// Barra de título própria: o Windows só desenha minimizar/maximizar/fechar
// (titleBarOverlay); a faixa em volta é HTML. A cor acompanha o tema da sala.
const TITLEBAR_HEIGHT = 34;
const TITLEBAR_SYMBOL = '#e8e6ee';

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#07070f',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07070f', symbolColor: TITLEBAR_SYMBOL, height: TITLEBAR_HEIGHT },
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // Minimizado (ex.: transmitindo um jogo), os timers do ajuste de tela,
      // estatísticas e prêmios continuam no ritmo normal.
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow = win;

  // Fechar esconde na bandeja (dá pra desligar nas configurações): quem está
  // numa sala continua conversando. Fechar de verdade é pelo menu da bandeja.
  win.on('close', (e) => {
    if (quitting || !closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      tray.displayBalloon({
        iconType: 'info',
        title: 'O Baderna continua aberto',
        content: trayState.inRoom
          ? 'Você continua na sala. Clique no ícone da bandeja pra voltar.'
          : 'Clique no ícone da bandeja pra voltar.',
      });
    }
  });
  win.on('closed', () => { mainWindow = null; });
}

// ---------- Bandeja ----------

let tray = null;
let quitting = false;
let closeToTray = true;
let trayHintShown = false;
let trayState = { inRoom: false, muted: false, deaf: false, room: '', count: 0 };

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function trayAction(action) {
  mainWindow?.webContents.send('tray:action', action);
}

function trayImage() {
  const off = trayState.inRoom && (trayState.muted || trayState.deaf);
  return nativeImage.createFromPath(path.join(__dirname, 'build', off ? 'tray-muted.png' : 'tray.png'));
}

function updateTray() {
  if (!tray) return;
  const s = trayState;
  tray.setImage(trayImage());
  tray.setToolTip(s.inRoom
    ? `Baderna · ${s.room} · ${s.count} na sala${s.deaf ? ' · surdo' : s.muted ? ' · mutado' : ''}`
    : 'Baderna');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Baderna', click: showWindow },
    { type: 'separator' },
    { label: s.muted ? 'Desmutar microfone' : 'Mutar microfone', enabled: s.inRoom, click: () => trayAction('mute') },
    { label: s.deaf ? 'Voltar a ouvir' : 'Silenciar tudo', enabled: s.inRoom, click: () => trayAction('deaf') },
    { label: 'Sair da sala', enabled: s.inRoom, click: () => trayAction('leave') },
    { type: 'separator' },
    ...(updateReady ? [{ label: `Atualizar pra ${updateReady} e reiniciar`, click: installUpdate }] : []),
    { label: 'Fechar o Baderna', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', showWindow);
  updateTray();
}

ipcMain.on('tray:state', (_e, s) => {
  if (!s || typeof s !== 'object') return;
  trayState = {
    inRoom: !!s.inRoom,
    muted: !!s.muted,
    deaf: !!s.deaf,
    room: String(s.room ?? '').slice(0, 40),
    count: Number.isFinite(s.count) ? s.count : 0,
  };
  updateTray();
});

ipcMain.on('tray:settings', (_e, s) => {
  if (s && typeof s.closeToTray === 'boolean') closeToTray = s.closeToTray;
});

ipcMain.handle('titlebar:color', (event, color) => {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return;
  BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({ color, symbolColor: TITLEBAR_SYMBOL, height: TITLEBAR_HEIGHT });
});

ipcMain.handle('screen:list', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    isScreen: s.id.startsWith('screen:'),
  }));
});

ipcMain.handle('screen:select', (_e, id) => {
  pendingSourceId = typeof id === 'string' ? id : null;
});

// ---------- Registro de conexão (baderna.log) ----------
// Só neste PC, na pasta de dados do app. Passou de 2 MB, vira baderna.old.log.

const LOG_MAX_BYTES = 2 * 1024 * 1024;

ipcMain.on('log', (_e, line) => {
  if (typeof line !== 'string') return;
  const file = path.join(app.getPath('userData'), 'baderna.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) {
      fs.renameSync(file, path.join(app.getPath('userData'), 'baderna.old.log'));
    }
    fs.appendFileSync(file, `${new Date().toISOString()} v${app.getVersion()} ${line.slice(0, 500).replace(/[\r\n]+/g, ' ')}\n`);
  } catch {}
});

// ---------- Atalhos globais (mutar / silenciar) ----------
// Valem com o app minimizado. A ação vai pro renderer igual ao menu da bandeja.

const HOTKEY_RE = /^(?:(?:Ctrl|Alt|Shift)\+){0,3}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/;

ipcMain.handle('hotkeys:set', (_e, keys) => {
  globalShortcut.unregisterAll();
  const result = {};
  for (const action of ['mute', 'deaf']) {
    const accel = typeof keys?.[action] === 'string' ? keys[action] : '';
    if (!accel) continue;
    try {
      result[action] = HOTKEY_RE.test(accel) && globalShortcut.register(accel, () => trayAction(action));
    } catch {
      result[action] = false;
    }
  }
  return result;
});
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- Atualização automática ----------
// Instalado, procura versão nova nos Releases do GitHub (configurado em
// package.json > build.publish), baixa em segundo plano e instala ao fechar
// o app de verdade, ou na hora pelo aviso da barra de título / bandeja.

const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
let updateReady = null; // versão baixada esperando instalar

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = String(info?.version ?? '');
    mainWindow?.webContents.send('update:ready', updateReady);
    updateTray();
  });
  autoUpdater.on('error', (err) => console.warn('update', err?.message ?? err));
  const check = () => autoUpdater.checkForUpdates().catch((err) => console.warn('update', err?.message ?? err));
  check();
  setInterval(check, UPDATE_CHECK_MS);
}

function installUpdate() {
  if (!updateReady) return;
  quitting = true;
  // isSilent: sem telas do instalador; isForceRunAfter: abre de novo depois.
  autoUpdater.quitAndInstall(true, true);
}

ipcMain.on('update:install', installUpdate);
ipcMain.handle('update:status', () => updateReady);
ipcMain.handle('app:version', () => app.getVersion());

// Verificação pedida pelo botão das configurações. Achando versão nova, o
// download segue sozinho (autoDownload) e o aviso chega por 'update:ready'.
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  if (updateReady) return { status: 'ready', version: updateReady };
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = String(result?.updateInfo?.version ?? '');
    if (!result?.isUpdateAvailable || !version) return { status: 'latest' };
    return updateReady ? { status: 'ready', version: updateReady } : { status: 'downloading', version };
  } catch (err) {
    console.warn('update', err?.message ?? err);
    return { status: 'error' };
  }
});

// ---------- Servidores ICE (STUN/TURN) ----------
// STUN descobre o endereço público; TURN repassa o tráfego quando a conexão
// direta é bloqueada (CGNAT/NAT simétrico, comum entre operadoras). O TURN
// padrão do PeerJS saiu do ar, então o app usa o de turn.json (fora do git,
// vai junto no instalador), num destes formatos:
//   { "cloudflare": { "keyId": "...", "apiToken": "..." } }    credenciais de 24 h pela API da Cloudflare
//   { "metered": { "app": "nome-do-app", "apiKey": "..." } }  credenciais pela API da Metered
//   { "iceServers": [{ "urls": "turn:...", "username": "...", "credential": "..." }] }
// Sem turn.json, só STUN: funciona entre redes abertas.

const STUN_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const ICE_CACHE_MS = 6 * 60 * 60 * 1000;
let iceCache = null; // { servers, until }

function readTurnConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'turn.json'), 'utf8'));
  } catch {
    return null;
  }
}

function validIceServers(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && (typeof s.urls === 'string' || Array.isArray(s.urls)))
    .map((s) => ({ urls: s.urls, ...(s.username ? { username: String(s.username), credential: String(s.credential ?? '') } : {}) }));
}

async function turnServers() {
  const cfg = readTurnConfig();
  if (!cfg) return [];
  if (cfg.iceServers) return validIceServers(cfg.iceServers);
  if (cfg.cloudflare?.keyId && cfg.cloudflare?.apiToken) {
    // Credenciais temporárias (24 h) geradas pela API da Cloudflare a cada uso.
    const keyId = encodeURIComponent(String(cfg.cloudflare.keyId));
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.cloudflare.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Cloudflare respondeu ${res.status}`);
    const data = await res.json();
    // Só UDP 3478 e TLS 443 (passa até em rede que bloqueia UDP): cada
    // endereço a mais vira candidatos a mais trocados pelo servidor do PeerJS.
    const keep = (u) => /^turn:.*:3478\?transport=udp$/.test(u) || /^turns:.*:443\?transport=tcp$/.test(u);
    return validIceServers([].concat(data.iceServers ?? []))
      .map((s) => ({ ...s, urls: [].concat(s.urls).filter(keep) }))
      .filter((s) => s.urls.length);
  }
  if (cfg.metered?.app && cfg.metered?.apiKey) {
    const appName = String(cfg.metered.app).replace(/[^\w-]/g, '');
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(cfg.metered.apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Metered respondeu ${res.status}`);
    return validIceServers(await res.json()).filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
  }
  return [];
}

ipcMain.handle('ice:servers', async () => {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  let turn = [];
  try {
    turn = await turnServers();
  } catch (err) {
    console.warn('turn', err.message);
  }
  const servers = [...STUN_SERVERS, ...turn];
  // Sem TURN (falhou ou não configurado), tenta de novo na próxima entrada.
  iceCache = turn.length ? { servers, until: Date.now() + ICE_CACHE_MS } : null;
  return servers;
});

// ---------- Capas de filme (TMDB) ----------
// Chave pela variável TMDB_KEY ou no arquivo tmdb-key.txt (fora do git, vai
// junto no instalador). Aceita a chave da API (v3) ou o token de leitura (v4,
// começa com "eyJ"). Sem chave, a lista de filmes desenha capas próprias.

function tmdbKey() {
  if (process.env.TMDB_KEY) return process.env.TMDB_KEY.trim();
  try {
    return fs.readFileSync(path.join(__dirname, 'tmdb-key.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

ipcMain.handle('movies:search', async (_e, query) => {
  const q = String(query ?? '').trim().slice(0, 100);
  const key = tmdbKey();
  if (!key) return { ok: false, reason: 'no-key' };
  if (!q) return { ok: true, results: [] };
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.search = new URLSearchParams({ query: q, language: 'pt-BR', include_adult: 'false' }).toString();
  const headers = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: res.status === 401 ? 'bad-key' : 'error' };
    const data = await res.json();
    return {
      ok: true,
      results: (Array.isArray(data.results) ? data.results : []).slice(0, 8).map((r) => ({
        title: String(r.title ?? ''),
        year: Number(String(r.release_date ?? '').slice(0, 4)) || null,
        poster: typeof r.poster_path === 'string' ? r.poster_path : '',
      })),
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
});

// ---------- Áudio da tela via proc-audio.exe ----------
// Janela: captura só o processo dono (e filhos). Tela inteira: tudo menos a
// Baderna, pra não mandar de volta a voz dos amigos.

let audioProc = null;

function stopScreenAudio() {
  const proc = audioProc;
  audioProc = null;
  if (!proc) return;
  proc.stdin.end();
  proc.kill();
}

ipcMain.handle('screen-audio:start', (event, sourceId) => {
  stopScreenAudio();
  if (process.platform !== 'win32') return { ok: false, error: 'Áudio da tela só funciona no Windows por enquanto.' };
  if (!fs.existsSync(PROC_AUDIO)) return { ok: false, error: 'proc-audio.exe não encontrado (rode npm run build:native).' };

  const win = /^window:(\d+):/.exec(String(sourceId));
  const args = win ? ['window', win[1]] : ['exclude', String(process.pid)];
  const proc = spawn(PROC_AUDIO, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  audioProc = proc;

  const wc = event.sender;
  let pending = Buffer.alloc(0);
  proc.stdout.on('data', (chunk) => {
    // Pipe entrega pedaços de qualquer tamanho; só repassa frames inteiros.
    const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const usable = data.length - (data.length % PCM_FRAME_BYTES);
    pending = data.subarray(usable);
    if (usable && !wc.isDestroyed()) wc.send('screen-audio:data', data.subarray(0, usable));
  });

  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  const report = (msg) => {
    if (!wc.isDestroyed()) wc.send('screen-audio:error', msg);
  };
  proc.on('error', (err) => report(err.message));
  proc.on('exit', (code) => {
    if (audioProc === proc) audioProc = null;
    if (code) report(stderr.trim().split('\n').pop() || `código ${code}`);
  });
  return { ok: true };
});

ipcMain.handle('screen-audio:stop', stopScreenAudio);
app.on('before-quit', () => {
  quitting = true;
  stopScreenAudio();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  // Libera só mic/câmera, saída de som, captura de tela (a fonte é decidida
  // no setDisplayMediaRequestHandler abaixo), tela cheia de elemento e
  // escrita na área de transferência (copiar o código da sala); nega o resto.
  const allowed = new Set(['media', 'speaker-selection', 'display-capture', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const id = pendingSourceId;
    pendingSourceId = null;
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    const source = sources.find((s) => s.id === id);
    // Sem fonte escolhida pelo nosso seletor, nega.
    callback(source ? { video: source } : null);
  });

  createWindow();
  createTray();
  setupUpdates();
});

app.on('window-all-closed', () => app.quit());
