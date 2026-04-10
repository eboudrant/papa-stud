const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleMaximize: () => ipcRenderer.send('toggle-maximize'),
});
