const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('baderna', {
  listScreens: () => ipcRenderer.invoke('screen:list'),
  selectScreen: (id) => ipcRenderer.invoke('screen:select', id),
});
