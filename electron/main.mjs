// Electron main process: a config-panel window around the same server
// src/main.ts runs from the CLI, plus automatic HTTPS (a self-signed cert
// generated and cached per-machine — see src/server/cert.ts) so a Quest on
// the LAN gets a usable https:// URL without any manual setup.
//
// This file is hand-written plain ESM (not TypeScript) because it consumes
// the compiled dist/ output the same way "npm start" does — run
// "npm run build" first. It has its own package.json (main.mjs) so it
// doesn't collide with the root package.json's "main", which is the
// library entry point for npm consumers of this package, not this app.

import { app, BrowserWindow, dialog } from "electron";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { startFtmsApp } from "../dist/app.js";
import { getOrCreateCert } from "../dist/server/cert.js";
import { lanAddresses } from "../dist/server/http.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

let ftmsApp = null;
let shuttingDown = false;

async function main() {
  const dataDir = join(app.getPath("userData"), "certs");
  const hosts = ["localhost", "127.0.0.1", ...lanAddresses()];
  const tls = await getOrCreateCert(dataDir, hosts);

  // Trust only the fingerprint of the cert we just generated — this is
  // what lets this window load https://localhost without a warning. It has
  // no bearing on the Quest: over the LAN it sees the same self-signed
  // cert and still has to click through the browser's warning once.
  app.on("certificate-error", (event, _webContents, url, _error, certificate, callback) => {
    try {
      const host = new URL(url).hostname;
      if ((host === "localhost" || host === "127.0.0.1") && certificate.fingerprint === tls.fingerprint) {
        event.preventDefault();
        callback(true);
        return;
      }
    } catch {
      // fall through to reject
    }
    callback(false);
  });

  ftmsApp = await startFtmsApp({ port: PORT, tls });

  const win = new BrowserWindow({
    width: 980,
    height: 760,
    title: "FTMS",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`https://localhost:${PORT}/`);
}

app.whenReady().then(() => {
  main().catch((err) => {
    dialog.showErrorBox("FTMS failed to start", String(err?.stack ?? err));
    app.quit();
  });
});

// Deliberately not the usual mac convention of staying alive with the
// window closed — this app's only job is to run the server while you're
// using it, same mental model as the existing CLI (run it, use it, stop
// it). A tray icon to keep it running in the background after closing the
// window is a reasonable future addition, not built here.
app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (shuttingDown || !ftmsApp) return;
  event.preventDefault();
  shuttingDown = true;
  ftmsApp
    .shutdown()
    .catch(() => {})
    .finally(() => app.quit());
});
