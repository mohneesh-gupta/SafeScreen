import { spawn } from "node:child_process";
import { createServer } from "vite";
import electronPath from "electron";

const host = "127.0.0.1";
const preferredPort = Number(process.env.SAFE_SCREEN_DEV_PORT || 4173);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

await run(npmCommand, ["run", "build:electron"], {
  shell: process.platform === "win32"
});

const server = await createServer({
  configFile: "vite.config.ts",
  server: {
    host,
    port: preferredPort,
    strictPort: false
  }
});

await server.listen();
server.printUrls();

const urls = server.resolvedUrls?.local || [];
const devServerUrl =
  urls.find((url) => url.startsWith(`http://${host}`)) || urls[0];

if (!devServerUrl) {
  throw new Error("Vite did not expose a local dev server URL.");
}

const electron = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl
  }
});

const shutdown = async () => {
  electron.kill();
  await server.close();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

electron.on("exit", (code) => {
  void server.close().finally(() => process.exit(code ?? 0));
});
