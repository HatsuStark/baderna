const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// Tela/janela escolhida no seletor do renderer; consumida pelo próximo getDisplayMedia.
let pendingSourceId = null;

// Barra de título própria: o Windows só desenha minimizar/maximizar/fechar
// (titleBarOverlay); a faixa em volta é HTML. A cor acompanha o tema da sala.
const TITLEBAR_HEIGHT = 34;
const TITLEBAR_SYMBOL = '#e8e6ee';

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
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

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
app.on('before-quit', stopScreenAudio);

app.whenReady().then(() => {
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
});

app.on('window-all-closed', () => app.quit());
