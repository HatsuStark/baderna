const { contextBridge, ipcRenderer } = require('electron');

// Registra um listener e devolve a função que remove.
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('baderna', {
  setTitlebarColor: (color) => ipcRenderer.invoke('titlebar:color', color),
  listScreens: () => ipcRenderer.invoke('screen:list'),
  selectScreen: (id) => ipcRenderer.invoke('screen:select', id),
  startScreenAudio: (sourceId) => ipcRenderer.invoke('screen-audio:start', sourceId),
  stopScreenAudio: () => ipcRenderer.invoke('screen-audio:stop'),
  onScreenAudioData: (cb) => subscribe('screen-audio:data', cb),
  onScreenAudioError: (cb) => subscribe('screen-audio:error', cb),
});
