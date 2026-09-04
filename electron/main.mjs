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

  // Trust the cert error for this window's own navigation to its own
  // loopback server — not by comparing fingerprints (tried that first: it
  // never matched. selfsigned's `fingerprint` is SHA-1; Electron's
  // Certificate.fingerprint from this event is SHA-256, a different hash
  // of different length, so the strings can never be equal — every load
  // silently failed and left a blank white window). This isn't a
  // meaningful trust decision anyway: the app is loading a URL it
  // constructed itself, on localhost, never attacker-influenced. It has no
  // bearing on the Quest — over the LAN it goes through its own browser's
  // separate warning-then-click-through flow, not this handler.
  app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      // fall through to reject
    }
    const trusted = host === "localhost" || host === "127.0.0.1";
    if (trusted) event.preventDefault();
    callback(trusted);
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

  // Without this, a failed load (wrong port, server not actually up yet,
  // a future cert-trust regression) just leaves a silent blank window —
  // exactly what happened here. Surface it instead of hiding it again.
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[electron] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    dialog.showErrorBox(
      "FTMS window failed to load",
      `${validatedURL}\n\n${errorDescription} (${errorCode})\n\nThe server itself may still be running — check the terminal/log output.`
    );
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
