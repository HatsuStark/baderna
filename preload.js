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
  onWindowVisible: (cb) => subscribe('window:visible', cb),
  listScreens: () => ipcRenderer.invoke('screen:list'),
  selectScreen: (id) => ipcRenderer.invoke('screen:select', id),
  startScreenAudio: (sourceId) => ipcRenderer.invoke('screen-audio:start', sourceId),
  stopScreenAudio: () => ipcRenderer.invoke('screen-audio:stop'),
  onScreenAudioData: (cb) => subscribe('screen-audio:data', cb),
  onScreenAudioError: (cb) => subscribe('screen-audio:error', cb),
  startMusicAudio: (sourceId) => ipcRenderer.invoke('music-audio:start', sourceId),
  stopMusicAudio: () => ipcRenderer.invoke('music-audio:stop'),
  onMusicAudioData: (cb) => subscribe('music-audio:data', cb),
  onMusicAudioError: (cb) => subscribe('music-audio:error', cb),
  onMusicTitle: (cb) => subscribe('music-audio:title', cb),
  searchMovies: (query) => ipcRenderer.invoke('movies:search', query),
  linkPreview: (url) => ipcRenderer.invoke('link:preview', url),
  openExternal: (url) => ipcRenderer.send('link:open', url),
  setHotkeys: (keys) => ipcRenderer.invoke('hotkeys:set', keys),
  iceServers: () => ipcRenderer.invoke('ice:servers'),
  log: (line) => ipcRenderer.send('log', line),
  onUpdateReady: (cb) => subscribe('update:ready', cb),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.send('update:install'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  appVersion: () => ipcRenderer.invoke('app:version'),
});
