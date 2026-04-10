const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const projects = require('../src/projects');
const { createApp } = require('../src/handler');

let mainWindow;
let server;
let port;

// --- Logging ---

function setupLogging() {
  const logDir = path.join(app.getPath('userData'));
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'server.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const origLog = console.log;
  const origErr = console.error;
  const ts = () => new Date().toISOString();

  console.log = (...args) => {
    const msg = `[${ts()}] ${args.join(' ')}\n`;
    logStream.write(msg);
    origLog.apply(console, args);
  };
  console.error = (...args) => {
    const msg = `[${ts()}] ERROR ${args.join(' ')}\n`;
    logStream.write(msg);
    origErr.apply(console, args);
  };

  console.log(`Log file: ${logFile}`);
}

// --- Server ---

function startServer() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  projects.setDataDir(dataDir);

  return new Promise((resolve, reject) => {
    server = createApp().listen(0, '127.0.0.1', () => {
      port = server.address().port;
      console.log(`Server running on http://127.0.0.1:${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Papa Stud.io',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 6 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/?electron=1`);
  mainWindow.on('closed', () => { mainWindow = null; });

  // Handle file downloads — save to Downloads folder
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const downloadsPath = app.getPath('downloads');
    const filePath = path.join(downloadsPath, item.getFilename());
    item.setSavePath(filePath);
    item.once('done', (e, state) => {
      if (state === 'completed') {
        console.log(`Downloaded: ${filePath}`);
        require('electron').shell.showItemInFolder(filePath);
      }
    });
  });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Log File',
          click: () => {
            const logFile = path.join(app.getPath('userData'), 'server.log');
            require('electron').shell.openPath(logFile);
          },
        },
        {
          label: 'Open Data Directory',
          click: () => {
            require('electron').shell.openPath(path.join(app.getPath('userData'), 'data'));
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Lifecycle ---

app.whenReady().then(async () => {
  setupLogging();
  buildMenu();
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
});
