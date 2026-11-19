import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadRoute(window: BrowserWindow, route: "main" | "overlay") {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = route === "main" ? devServerUrl : `${devServerUrl}/#/overlay`;
    await window.loadURL(url);
    return;
  }

  const indexPath = path.join(__dirname, "../../dist/index.html");
  await window.loadFile(indexPath, {
    hash: route === "overlay" ? "/overlay" : undefined
  });
}

export function createMainWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 640,
    minWidth: 420,
    minHeight: 580,
    show: false,
    title: "SafeScreen",
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void loadRoute(win, "main");
  win.once("ready-to-show", () => {
    win.show();
  });

  return win;
}

export function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const bounds = primaryDisplay.bounds;

  const overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, "floating");
  void loadRoute(overlay, "overlay");
  overlay.once("ready-to-show", () => {
    overlay.showInactive();
  });

  return overlay;
}
