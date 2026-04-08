const { app, BrowserWindow } = require('electron');
const path = require('path');
const projects = require('../src/projects');
const { createApp } = require('../src/handler');

let mainWindow;
let server;

const PORT = 8770;

function startServer() {
  // Use Electron's userData directory for persistence when running as .app
  const dataDir = path.join(app.getPath('userData'), 'data');
  projects.setDataDir(dataDir);

  return new Promise(resolve => {
    server = createApp().listen(PORT, '127.0.0.1', resolve);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Papa Stud.io',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/?electron=1`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
});
