const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

// --profile=NOME usa uma pasta de dados separada; permite abrir várias instâncias pra testar.
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) {
  const profile = profileArg.split('=')[1].replace(/[^\w-]/g, '');
  app.setPath('userData', path.join(app.getPath('userData'), `profile-${profile}`));
}

// Tela/janela escolhida no seletor do renderer; consumida pelo próximo getDisplayMedia.
let pendingSourceId = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

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

app.whenReady().then(() => {
  // Libera só mic/câmera, saída de som e captura de tela (a fonte é decidida
  // no setDisplayMediaRequestHandler abaixo); nega o resto.
  const allowed = new Set(['media', 'speaker-selection', 'display-capture']);
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
