import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDaemon, type DaemonHandle } from "../daemon/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemon: DaemonHandle | null = null;
let pinned = true;

app.setAppUserModelId("com.codex.widget.desktop");

async function createWindow(): Promise<void> {
  daemon = await startDaemon();

  const preloadPath = path.join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    width: 430,
    height: 610,
    minWidth: 360,
    minHeight: 500,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, "floating");
  moveToBottomRight(mainWindow);

  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) {
    await mainWindow.loadURL(`${url}?daemonPort=${daemon.port}`);
  } else {
    await mainWindow.loadFile(path.join(projectRoot, "dist-renderer", "index.html"), {
      query: { daemonPort: String(daemon.port) }
    });
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.showInactive();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  createTray();
}

function createTray(): void {
  const mascotPath = path.join(projectRoot, "src", "renderer", "assets", "mascot.png");
  const icon = nativeImage.createFromPath(mascotPath).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("Codex Widget");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show widget",
        click: () => {
          mainWindow?.showInactive();
        }
      },
      {
        label: "Hide widget",
        click: () => {
          mainWindow?.hide();
        }
      },
      {
        label: "Always on top",
        type: "checkbox",
        checked: pinned,
        click: () => {
          togglePinned();
        }
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        }
      }
    ])
  );
  tray.on("click", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.showInactive();
    }
  });
}

function moveToBottomRight(window: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const [width, height] = window.getSize();
  window.setPosition(area.x + area.width - width - 22, area.y + area.height - height - 22);
}

function togglePinned(): boolean {
  pinned = !pinned;
  mainWindow?.setAlwaysOnTop(pinned, "floating");
  createTray();
  return pinned;
}

ipcMain.handle("widget:hide", () => {
  mainWindow?.hide();
});

ipcMain.handle("widget:quit", () => {
  app.quit();
});

ipcMain.handle("widget:toggle-pin", () => togglePinned());

app.whenReady().then(() => {
  void createWindow();
});

app.on("window-all-closed", () => {
  // Keep the tray daemon alive until the user explicitly quits.
});

app.on("before-quit", async () => {
  tray?.destroy();
  tray = null;
  if (daemon) {
    await daemon.close();
    daemon = null;
  }
});
