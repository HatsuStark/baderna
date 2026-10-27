const { contextBridge, ipcRenderer } = require('electron');

// Registra um listener e devolve a função que remove.
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('baderna', {
  setTitlebarColor: (color) => ipcRenderer.invoke('titlebar:color', color),
  setTrayState: (s) => ipcRenderer.send('tray:state', s),
  setTraySettings: (s) => ipcRenderer.send('tray:settings', s),
  onTrayAction: (cb) => subscribe('tray:action', cb),
  listScreens: () => ipcRenderer.invoke('screen:list'),
  selectScreen: (id) => ipcRenderer.invoke('screen:select', id),
  startScreenAudio: (sourceId) => ipcRenderer.invoke('screen-audio:start', sourceId),
  stopScreenAudio: () => ipcRenderer.invoke('screen-audio:stop'),
  onScreenAudioData: (cb) => subscribe('screen-audio:data', cb),
  onScreenAudioError: (cb) => subscribe('screen-audio:error', cb),
  searchMovies: (query) => ipcRenderer.invoke('movies:search', query),
  onUpdateReady: (cb) => subscribe('update:ready', cb),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.send('update:install'),
});
