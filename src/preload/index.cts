import { contextBridge, ipcRenderer } from "electron";
import type {
  RuntimeSnapshot,
  SafeScreenApi,
  UserSettings
} from "../shared/contracts.js";

const IPC_CHANNELS = {
  getSnapshot: "safe-screen:get-snapshot",
  updateSettings: "safe-screen:update-settings",
  chooseFaceProfileImages: "safe-screen:choose-face-profile-images",
  removeFaceProfile: "safe-screen:remove-face-profile",
  runtimeSnapshot: "safe-screen:runtime-snapshot"
} as const;

const api: SafeScreenApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  updateSettings: (next: Partial<UserSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateSettings, next),
  chooseFaceProfileImages: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseFaceProfileImages, name),
  removeFaceProfile: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeFaceProfile, id),
  onSnapshot(listener: (snapshot: RuntimeSnapshot) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: RuntimeSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.runtimeSnapshot, wrapped);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.runtimeSnapshot, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("safeScreen", api);
