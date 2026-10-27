const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// --profile=NOME usa uma pasta de dados separada; permite abrir várias instâncias pra testar.
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) {
  const profile = profileArg.split('=')[1].replace(/[^\w-]/g, '');
  app.setPath('userData', path.join(app.getPath('userData'), `profile-${profile}`));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Libera só microfone/câmera e escolha de saída de som; nega o resto.
  const allowed = new Set(['media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
