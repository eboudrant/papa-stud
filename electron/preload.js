const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleMaximize: () => ipcRenderer.send('toggle-maximize'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (value) => ipcRenderer.send('set-theme', value),
});
