const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleMaximize: () => ipcRenderer.send('toggle-maximize'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (value) => ipcRenderer.send('set-theme', value),
  startWindowDrag: (x, y) => ipcRenderer.send('start-window-drag', x, y),
  windowDragMove: (x, y) => ipcRenderer.send('window-drag-move', x, y),
  stopWindowDrag: () => ipcRenderer.send('stop-window-drag'),
});
