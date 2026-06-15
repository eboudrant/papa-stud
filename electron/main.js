const { app, BrowserWindow, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const projects = require('../src/projects');
const { createApp } = require('../src/handler');
const { migrateDataFiles } = require('../src/dataMigration');

function resolveUserDataDir() {
  const appData = app.getPath('appData');
  const legacyDir = path.join(appData, 'papastud');
  const newDir = path.join(appData, 'PapaStudio');
  if (!fs.existsSync(legacyDir) || fs.existsSync(newDir)) return newDir;
  try {
    fs.renameSync(legacyDir, newDir);
    return newDir;
  } catch (e) {
    console.error('userData migration failed:', e);
    return legacyDir;
  }
}

app.setPath('userData', resolveUserDataDir());

let mainWindow;
let server;
let port;

// Single instance only. Every instance shares the same userData/data/ directory
// (projects.json, scans/, index.json) with no cross-process lock, so a second
// instance racing scans/accepts against the first would clobber data
// last-writer-wins. The embedded server binds 127.0.0.1:0 (a random port), so
// instances don't conflict on the socket — nothing else stops a second launch.
// Take the OS single-instance lock and, on a second launch, focus the existing
// window instead of opening a new one.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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
  migrateDataFiles(dataDir);
  projects.setDataDir(dataDir);
  if (app.isPackaged) process.env.PAPASTUD_VERSION = app.getVersion();

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
  const savedTheme = readTheme();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Papa Stud.io',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: themeBgColor(savedTheme),
    icon: path.join(__dirname, '..', 'static', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/?electron=1`);
  mainWindow.on('closed', () => { mainWindow = null; });

  // External links (target="_blank") open in the user's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

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

function showAbout() {
  const iconPath = path.join(__dirname, '..', 'static', 'icon.png');
  const version = app.isPackaged ? `Version ${app.getVersion()}\n\n` : '';
  dialog.showMessageBox({
    type: 'info',
    buttons: ['OK'],
    defaultId: 0,
    icon: nativeImage.createFromPath(iconPath).resize({ width: 96, height: 96 }),
    title: 'About Papa Stud.io',
    message: 'Papa Stud.io',
    detail: `${version}Screenshot failure reviewer for Android testing tools.`,
    noLink: true,
  });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { label: 'About Papa Stud.io', click: showAbout },
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
          label: 'Report a Bug',
          click: () => {
            require('electron').shell.openExternal(bugReportUrl());
          },
        },
        { type: 'separator' },
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

// --- Theme persistence ---

function themeFilePath() { return path.join(app.getPath('userData'), 'theme.json'); }

function readTheme() {
  try { return JSON.parse(fs.readFileSync(themeFilePath(), 'utf8')).theme || 'system'; }
  catch { return 'system'; }
}

function writeTheme(value) {
  fs.writeFileSync(themeFilePath(), JSON.stringify({ theme: value }));
}

function themeBgColor(theme) {
  if (theme === 'dark') return '#121212';
  if (theme === 'light') return '#f5f5f0';
  // System: check nativeTheme
  const { nativeTheme } = require('electron');
  return nativeTheme.shouldUseDarkColors ? '#121212' : '#f5f5f0';
}

ipcMain.handle('get-theme', () => readTheme());
ipcMain.on('set-theme', (_, value) => writeTheme(value));

function appInfo() {
  return {
    version: app.getVersion(),
    platform: process.platform,
    osRelease: os.release(),
  };
}

function bugReportUrl() {
  const info = appInfo();
  const env = `Papa Stud.io ${info.version} — ${info.platform} ${info.osRelease}`;
  return `https://github.com/eboudrant/papa-stud/issues/new?template=bug_report.yml&environment=${encodeURIComponent(env)}`;
}

ipcMain.handle('get-app-info', () => appInfo());

let _dragStart = null;
ipcMain.on('start-window-drag', (_, x, y) => {
  if (!mainWindow) return;
  const [wx, wy] = mainWindow.getPosition();
  _dragStart = { wx, wy, mx: x, my: y };
});
ipcMain.on('window-drag-move', (_, x, y) => {
  if (!mainWindow || !_dragStart) return;
  mainWindow.setPosition(
    _dragStart.wx + (x - _dragStart.mx),
    _dragStart.wy + (y - _dragStart.my)
  );
});

ipcMain.on('stop-window-drag', () => { _dragStart = null; });

ipcMain.on('toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

// Guard on the lock: the losing instance has already called app.quit() above and
// must not boot a second server/window before it exits.
if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    setupLogging();
    buildMenu();
    // In dev, macOS shows Electron's default dock icon; packaged builds use
    // forge.config.js's icon field automatically.
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(path.join(__dirname, '..', 'static', 'icon.png')); } catch {}
    }
    await startServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
});
