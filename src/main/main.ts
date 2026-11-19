import { app, dialog, globalShortcut, ipcMain } from "electron";
import type { RuntimeSnapshot, UserSettings } from "../shared/contracts.js";
import { IPC_CHANNELS } from "./ipc.js";
import { RuntimeController } from "./runtime-controller.js";
import { OverlayController } from "./overlay-controller.js";
import { createMainWindow, createOverlayWindow } from "./windows.js";
import { createTray } from "./tray.js";

async function bootstrap() {
  await app.whenReady();

  const mainWindow = createMainWindow();
  const overlayWindow = createOverlayWindow();
  const overlayController = new OverlayController(overlayWindow);

  let trayBindings:
    | {
        refreshMenu: () => void;
      }
    | undefined;

  const runtime = new RuntimeController(overlayController, (snapshot) => {
    const nextSnapshot: RuntimeSnapshot = snapshot;
    mainWindow.webContents.send(IPC_CHANNELS.runtimeSnapshot, nextSnapshot);
    overlayWindow.webContents.send(IPC_CHANNELS.runtimeSnapshot, nextSnapshot);
    trayBindings?.refreshMenu();
  });

  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => runtime.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.updateSettings, (_event, next: Partial<UserSettings>) =>
    runtime.updateSettings(next)
  );
  ipcMain.handle(IPC_CHANNELS.chooseFaceProfileImages, async (_event, name: string) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose reference face images",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: ["jpg", "jpeg", "png", "webp"]
        }
      ]
    });

    if (result.canceled) {
      return runtime.getSnapshot();
    }

    return runtime.addFaceProfile(name, result.filePaths);
  });
  ipcMain.handle(IPC_CHANNELS.removeFaceProfile, (_event, id: string) =>
    runtime.removeFaceProfile(id)
  );

  trayBindings = createTray({
    mainWindow,
    overlayWindow,
    applySettings: (next) => runtime.updateSettings(next),
    getSnapshot: () => runtime.getSnapshot()
  });

  globalShortcut.register("CommandOrControl+Alt+P", () => {
    void runtime.updateSettings({ enabled: false });
    mainWindow.show();
    mainWindow.focus();
  });

  globalShortcut.register("CommandOrControl+Alt+Q", () => {
    app.quit();
  });

  mainWindow.on("close", (event: Electron.Event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  app.on("before-quit", () => {
    app.isQuiting = true;
    globalShortcut.unregisterAll();
    runtime.stop();
  });

  app.on("activate", () => {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
  });

  await runtime.start();
}

declare global {
  namespace Electron {
    interface App {
      isQuiting?: boolean;
    }
  }
}

void bootstrap();
