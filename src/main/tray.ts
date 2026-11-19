import { app, Menu, Tray, nativeImage } from "electron";
import type { AppContext } from "./types.js";

export function createTray(context: AppContext) {
  const tray = new Tray(
    nativeImage.createFromDataURL(
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iMTQiIGhlaWdodD0iMTQiIHJ4PSIzIiBmaWxsPSIjMDcxMTFmIiBzdHJva2U9IiM3ZGQzZmMiIHN0cm9rZS13aWR0aD0iMS41Ii8+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjMiIGZpbGw9IiM2N2U4ZjkiLz48L3N2Zz4="
    )
  );

  const refreshMenu = () => {
    const snapshot = context.getSnapshot();
    tray.setToolTip(`SafeScreen • ${snapshot.status}`);

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: snapshot.settings.enabled ? "Pause protection" : "Enable protection",
          click: () => {
            void context.applySettings({
              enabled: !snapshot.settings.enabled
            });
          }
        },
        {
          label: "Open controls",
          click: () => {
            context.mainWindow.show();
            context.mainWindow.focus();
          }
        },
        {
          label: "Quit",
          click: () => {
            app.quit();
          }
        }
      ])
    );
  };

  refreshMenu();
  tray.on("double-click", () => {
    context.mainWindow.show();
    context.mainWindow.focus();
  });

  return {
    tray,
    refreshMenu
  };
}
