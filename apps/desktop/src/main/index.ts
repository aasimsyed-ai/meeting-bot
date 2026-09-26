import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readEnv, nowFrom } from './env';
import { log } from './log';
import { Services, userMessage } from './services';
import { Permissions } from './permissions';
import { CaptureController } from './capture/controller';
import { MeetingDetector } from './detection';
import { UtilityTranscriber } from './transcription/client';
import { modelPaths } from './transcription/models';
import { setupUpdater } from './updater';
import { createIpcHandler } from './ipc-handler';
import { APP_CHANNELS } from '../shared/channels';
import type { AppEvent, CaptureStatus } from '../shared/types';
import { captureHeadline } from '../shared/capture-label';

const env = readEnv(process.env, app.isPackaged);
if (env.fakePermissions) {
  // Test only: Chromium's fake microphone lets CI exercise the real capture path.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
if (process.platform === 'linux')
  app.commandLine.appendSwitch('enable-features', 'PulseaudioLoopbackForScreenShare');

// Development and test builds never touch a real installation's data.
if (env.dataDir) app.setPath('userData', env.dataDir);
else if (env.appEnv !== 'production')
  app.setPath('userData', `${app.getPath('userData')}-${env.appEnv}`);

if (!app.requestSingleInstanceLock()) {
  // Another instance owns this data folder; Electron has asked it to show its window.
  console.error('Meeting Assistant is already running. Showing the open window instead.');
  app.quit();
} else {
  void main();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let services: Services;
let quitting = false;
let blockerId: number | null = null;

function emit(e: AppEvent): void {
  if (e.type === 'capture') onCaptureStatus(e.status);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(APP_CHANNELS.event, e);
}

function rendererUrl(): string | null {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : null;
}

async function main(): Promise<void> {
  await app.whenReady();
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true });
  log.setDirectory(join(dataDir, 'logs'));
  log.info('app_start', {
    version: app.getVersion(),
    env: env.appEnv,
    platform: process.platform,
    packaged: app.isPackaged,
  });

  hardenSessions();
  const permissions = new Permissions(env.fakePermissions);
  let controller: CaptureController | null = null;
  const detector = new MeetingDetector(
    (m) => {
      emit({ type: 'detected-meeting', meeting: m });
      if (
        m &&
        !services.session.isActive &&
        services.settings.get().notifications &&
        services.settings.get().onboardingComplete
      ) {
        notify(
          `${m.title || 'A meeting'} is in progress`,
          'Take notes with Meeting Assistant?',
          () => showWindow('/'),
        );
      }
    },
    () => BrowserWindow.getAllWindows().map((w) => w.getTitle()),
  );

  services = new Services({
    env,
    dataDir,
    now: nowFrom(env),
    encryptor: safeStorage,
    shell: {
      openExternal: (url) => shell.openExternal(url),
      copyText: (t) => clipboard.writeText(t),
      showItemInFolder: (p) => shell.showItemInFolder(p),
      notify,
      appVersion: app.getVersion(),
      osVersion: process.getSystemVersion(),
    },
    permissions,
    createBackend: (session) => {
      controller = new CaptureController(session, permissions, {
        preloadDir: join(__dirname, '../preload'),
        rendererUrl: rendererUrl(),
        rendererDir: join(__dirname, '../renderer'),
        demoSpeed: env.demoSpeed,
        testMeetingAudio: env.testMeetingAudio,
        audioteeBinary: () =>
          app.isPackaged
            ? join(
                process.resourcesPath,
                'app.asar.unpacked',
                'node_modules',
                'audiotee',
                'bin',
                'audiotee',
              )
            : undefined,
      });
      return {
        startLive: (o) => controller!.startLive(o),
        startDemo: () => controller!.startDemo(),
        pause: () => controller!.pause(),
        resume: () => controller!.resume(),
        stop: () => controller!.stop(),
        retry: () => controller!.retry(),
        probeSystemAudio: () => controller!.probeSystemAudio(),
      };
    },
    createTranscriber: () =>
      new UtilityTranscriber(
        join(__dirname, 'transcription-worker.js'),
        modelPaths(join(dataDir, 'models'), services.settings.get().transcription.model),
        2,
      ),
    fetcher: (url, signal) => net.fetch(url, { signal }),
    emit,
    detected: () => detector.detected,
    checkUpdates: () => updater.check(),
    logPath: () => log.path,
    onSettingsChanged: () => syncDetector(),
  });
  const updater = setupUpdater({ enabled: app.isPackaged && env.appEnv === 'production', emit });

  registerIpc();
  createWindow();
  createTray();
  buildMenu();
  const syncDetector = () => {
    const s = services.settings.get();
    if (s.capture.detectMeetings && s.onboardingComplete && env.appEnv !== 'test') detector.start();
    else detector.stop();
  };
  syncDetector();

  const { interrupted } = await services.startup();
  if (interrupted.length) {
    emit({
      type: 'notice',
      tone: 'warning',
      message:
        'A meeting was interrupted before it finished. You can recover its notes from the Meetings page.',
    });
  }

  powerMonitor.on('suspend', () => {
    if (services.session.status().state === 'capturing') {
      void services.backend.pause();
      services.session.pause('asleep');
      log.info('capture_paused_for_sleep');
    }
  });
  powerMonitor.on('resume', () => {
    if (services.session.status().state === 'paused')
      notify(
        'Notes are paused',
        'Your computer was asleep. Open the app to resume taking notes.',
        () => showWindow('/'),
      );
  });

  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    void confirmQuit();
  });
  app.on('window-all-closed', () => {
    // Stay in the tray/menu bar so meeting detection and capture keep working.
  });
}

function hardenSessions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = permission === 'media' && wc === mainWindow?.webContents;
    cb(ok);
  });
  ses.setPermissionCheckHandler(
    (wc, permission) => permission === 'media' && wc === mainWindow?.webContents,
  );
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      const dev = rendererUrl();
      if (!(dev && url.startsWith(dev))) e.preventDefault();
    });
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
}

function registerIpc(): void {
  const handle = createIpcHandler<IpcMainInvokeEvent['sender']>({
    isTrusted: (sender) => !!mainWindow && sender === mainWindow.webContents,
    handlers: services.handlers() as Record<string, (...args: unknown[]) => unknown>,
    log,
    userMessage,
  });
  ipcMain.handle(
    APP_CHANNELS.invoke,
    (event: IpcMainInvokeEvent, channel: unknown, args: unknown) =>
      handle(event.sender, channel, args),
  );
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Meeting Assistant',
    backgroundColor: '#f7f7f8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: iconPath('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  mainWindow.once('ready-to-show', () => {
    if (process.env.MEETING_ASSISTANT_HIDDEN !== '1') mainWindow?.show();
  });
  mainWindow.on('close', (e) => {
    if (quitting) return;
    // Closing the window keeps the app in the tray, so capture never stops by accident.
    e.preventDefault();
    mainWindow?.hide();
    if (services.session.isActive)
      notify('Still taking notes', 'Stop from the menu bar or tray icon when the meeting ends.');
  });
  const url = rendererUrl();
  if (url) void mainWindow.loadURL(url);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function showWindow(route?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow!.show();
  mainWindow!.focus();
  if (route) emit({ type: 'navigate', to: route });
}

function iconPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(__dirname, '../../resources', name);
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

// ------------------------------------------------------------------ capture status, tray and shortcuts

let lastState: CaptureStatus['state'] = 'idle';
let lastHeadline = '';

function onCaptureStatus(s: CaptureStatus): void {
  const headline = captureHeadline(s).text;
  if (headline !== lastHeadline) {
    lastHeadline = headline;
    updateTray(s);
  }
  if (s.state === lastState) return;
  lastState = s.state;
  const active = s.state === 'capturing' || s.state === 'paused';
  if (active && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!active && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
  globalShortcut.unregisterAll();
  if (active) {
    globalShortcut.register('CommandOrControl+Shift+.', () => void stopFromShortcut());
    globalShortcut.register('CommandOrControl+Shift+,', () => void togglePause());
  }
  updateTray(s);
  buildMenu();
}

async function stopFromShortcut(): Promise<void> {
  const s = await services.stopCapture();
  if (s.meetingId) showWindow(`/meetings/${s.meetingId}`);
}

async function togglePause(): Promise<void> {
  const h = services.handlers();
  if (services.session.status().state === 'paused') await h['capture:resume']();
  else await h['capture:pause']();
}

function createTray(): void {
  const img = nativeImage.createFromPath(
    iconPath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'),
  );
  if (process.platform === 'darwin') img.setTemplateImage(true);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Meeting Assistant');
  tray.on('click', () => {
    if (process.platform !== 'darwin') showWindow();
  });
  updateTray(services.session.status());
}

function updateTray(s: CaptureStatus): void {
  if (!tray) return;
  const capturing = s.state === 'capturing';
  const paused = s.state === 'paused';
  const recordingIcon = nativeImage.createFromPath(
    iconPath(process.platform === 'darwin' ? 'trayRecordingTemplate.png' : 'tray-recording.png'),
  );
  const idleIcon = nativeImage.createFromPath(
    iconPath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'),
  );
  const icon = capturing || paused ? recordingIcon : idleIcon;
  if (!icon.isEmpty()) {
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray.setImage(icon);
  }
  const headline = captureHeadline(s);
  tray.setToolTip(
    s.state === 'idle' ? 'Meeting Assistant' : `Meeting Assistant: ${headline.text.toLowerCase()}`,
  );
  if (process.platform === 'darwin')
    tray.setTitle(
      !capturing && !paused
        ? ''
        : headline.tone === 'warn'
          ? ' ! No audio'
          : capturing
            ? ' ● Notes'
            : ' Paused',
    );
  const h = services.handlers();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: capturing ? '● Taking notes' : paused ? 'Notes paused' : 'Meeting Assistant',
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Open Meeting Assistant', click: () => showWindow() },
      ...(capturing || paused
        ? [
            { label: paused ? 'Resume' : 'Pause', click: () => void togglePause() },
            { label: 'Stop taking notes', click: () => void stopFromShortcut() },
          ]
        : [
            {
              label: 'Start taking notes',
              click: () => {
                void Promise.resolve(h['capture:start']({})).then(() => showWindow('/'));
              },
            },
          ]),
      { type: 'separator' },
      { label: 'Settings', click: () => showWindow('/settings') },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function buildMenu(): void {
  const s = services?.session.status();
  const active = s && (s.state === 'capturing' || s.state === 'paused');
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Notes',
      submenu: [
        {
          label: 'Start Taking Notes',
          accelerator: 'CommandOrControl+Shift+N',
          enabled: !active,
          click: () => void services.handlers()['capture:start']({}),
        },
        {
          label: s?.state === 'paused' ? 'Resume' : 'Pause',
          accelerator: 'CommandOrControl+Shift+,',
          enabled: Boolean(active),
          click: () => void togglePause(),
        },
        {
          label: 'Stop Taking Notes',
          accelerator: 'CommandOrControl+Shift+.',
          enabled: Boolean(active),
          click: () => void stopFromShortcut(),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function confirmQuit(): Promise<void> {
  // Tests quit without a prompt; the capture is still saved by shutdown().
  if (services.session.isActive && env.appEnv !== 'test') {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Stop and quit', 'Keep taking notes'],
      defaultId: 1,
      cancelId: 1,
      message: 'Stop taking notes and quit?',
      detail:
        'What has been captured so far will be saved and turned into notes next time you open the app.',
    });
    if (response !== 0) return;
  }
  quitting = true;
  try {
    await services.shutdown();
  } catch (err) {
    log.error('shutdown_failed', { error: err instanceof Error ? err : String(err) });
  }
  globalShortcut.unregisterAll();
  app.quit();
}
