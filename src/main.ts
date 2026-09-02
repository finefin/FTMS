// CLI entry point: thin wrapper around src/app.ts's bootstrap. Stays
// HTTP-only by default — HTTPS here is a manual, advanced-use opt-in via
// TLS_CERT_FILE/TLS_KEY_FILE; the desktop app (electron/main.mjs) is what
// generates and manages a cert automatically for the common case.

import { readFileSync } from "fs";
import { startFtmsApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTO_CONNECT = process.env.AUTO_CONNECT !== "false";
// Unset by default so the server accepts connections from the local network.
const HOST = process.env.HOST;

function loadManualTls(): { key: string; cert: string } | undefined {
  const certFile = process.env.TLS_CERT_FILE;
  const keyFile = process.env.TLS_KEY_FILE;
  if (!certFile || !keyFile) return undefined;
  return {
    cert: readFileSync(certFile, "utf-8"),
    key: readFileSync(keyFile, "utf-8"),
  };
}

startFtmsApp({
  port: PORT,
  hostname: HOST,
  autoConnect: AUTO_CONNECT,
  tls: loadManualTls(),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
