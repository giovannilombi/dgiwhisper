import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc';
import { initAnalytics, trackEvent, AnalyticsEvents } from './services/analytics';
import { safeSend } from './utils/safe-send';
import { registerMediaProtocolHandler, registerMediaProtocolScheme } from './utils/media-protocol';
import packageJson from '../../package.json';

initAnalytics();
registerMediaProtocolScheme();

const APP_DISPLAY_NAME = 'DGI-Whisper';
const APP_USER_MODEL_ID = 'com.dgi-whisper.app';

let mainWindow: BrowserWindow | null = null;
let ipcHandlersRegistered = false;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const appVersion = packageJson.version;

app.setName(APP_DISPLAY_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: appVersion,
  });
}

function createMenu() {
  if (!mainWindow) return;

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            safeSend(mainWindow, 'menu:openFile');
          },
        },
        {
          label: 'Save Transcription...',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            safeSend(mainWindow, 'menu:saveFile');
          },
        },
        { type: 'separator' as const },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          role: 'quit',
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' as const },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' as const },
        {
          label: 'Copy All Transcription',
          accelerator: 'CmdOrCtrl+C',
          click: () => {
            safeSend(mainWindow, 'menu:copyTranscription');
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' as const },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' },
        {
          label: 'Toggle History',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            safeSend(mainWindow, 'menu:toggleHistory');
          },
        },
      ],
    },
    {
      label: 'Transcription',
      submenu: [
        {
          label: 'Start Transcription',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => {
            safeSend(mainWindow, 'menu:startTranscription');
          },
        },
        {
          label: 'Cancel Transcription',
          accelerator: 'Escape',
          click: () => {
            safeSend(mainWindow, 'menu:cancelTranscription');
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About DGI-Whisper',
          click: async () => {
            const repoUrl = 'https://github.com/giovannilombi/dgiwhisper';
            const upstreamUrl = 'https://github.com/PVAS-Development/whisperdesk';

            const result = await dialog.showMessageBox({
              type: 'info',
              title: 'About DGI-Whisper',
              message: `DGI-Whisper ${appVersion}`,
              detail:
                'Maintained by Design Group Italia – Team PM.\nBased on WhisperDesk by Pedro Siqueira.',
              buttons: ['Open Repository', 'Open WhisperDesk', 'Close'],
              cancelId: 2,
            });

            if (result.response === 0) {
              await shell.openExternal(repoUrl);
            } else if (result.response === 1) {
              await shell.openExternal(upstreamUrl);
            }
          },
        },
        { type: 'separator' as const },
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/giovannilombi/dgiwhisper');
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' as const },
        { role: 'services' },
        { type: 'separator' as const },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' as const },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    title: APP_DISPLAY_NAME,
    trafficLightPosition: { x: 20, y: 20 },
  });

  if (!ipcHandlersRegistered) {
    registerIpcHandlers(() => mainWindow);
    ipcHandlersRegistered = true;
  }

  createMenu();

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
};

app.on('ready', () => {
  registerMediaProtocolHandler();
  createWindow();
});

app.on('before-quit', () => {
  trackEvent(AnalyticsEvents.APP_CLOSED);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
