// Core bootstrap: BLE client, HTTP/WS server, auto-connect and poll loop.
//
// Pulled out of main.ts so both the CLI entry point and the Electron main
// process can start the same app without inheriting main.ts's
// process.exit(1)-on-error behavior, which would take down the whole
// desktop app on a startup failure instead of just failing to connect.

import { FTMSClient } from "./ftms/client.js";
import { WsServer } from "./server/ws.js";
import { startServer } from "./server/http.js";
import { SettingsStore } from "./server/settings.js";
import type { ConnectionState } from "./ble/types.js";
import type { FtmsDataEvent } from "./ftms/client.js";
import type { DiscoveredDevice } from "./ble/types.js";
import type { TlsMaterial } from "./server/cert.js";

export interface StartFtmsAppOptions {
  port?: number;
  hostname?: string;
  autoConnect?: boolean;
  tls?: TlsMaterial;
}

export interface FtmsApp {
  client: FTMSClient;
  ws: WsServer;
  server: import("http").Server;
  /** Stops the reconnect poll loop and disconnects BLE. Does not close the HTTP server. */
  shutdown(): Promise<void>;
}

export async function startFtmsApp(opts: StartFtmsAppOptions = {}): Promise<FtmsApp> {
  const port = opts.port ?? 3000;
  const autoConnect = opts.autoConnect ?? true;

  const client = new FTMSClient();
  const ws = new WsServer();
  const settings = new SettingsStore();

  ws.emitState("idle");

  client.on("stateChange", (event: { state: ConnectionState; deviceName?: string }) => {
    ws.emitState(event.state, event.deviceName);
    ws.emitStatus(event.state === "connected");
    console.log(`[ftms] state: ${event.state}${event.deviceName ? " (" + event.deviceName + ")" : ""}`);
  });

  client.on("data", (event: FtmsDataEvent) => {
    ws.emitData(event);
  });

  client.on("device", (device: DiscoveredDevice) => {
    console.log(`[ftms] discovered: ${device.name} (${device.id}) rssi=${device.rssi}`);
  });

  const server = await startServer(client, ws, port, opts.hostname, opts.tls, settings);

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Fire-and-forget: the server is already listening by the time this
  // settles, same as before the CLI/Electron split. Errors here (e.g. no
  // Bluetooth adapter) surface as a console message, matching the CLI's
  // original behavior — including its pre-existing quirk that the poll
  // loop never starts if this initial scan/connect throws.
  (async () => {
    try {
      console.log("[ftms] initializing bluetooth...");
      await client.init();
      console.log("[ftms] bluetooth ready - scanning...");

      const devices = await client.scan(10000);
      ws.emitDevices(devices);
      console.log(`[ftms] found ${devices.length} FTMS device(s)`);

      if (autoConnect && devices.length > 0) {
        const target = devices[0];
        console.log(`[ftms] connecting to ${target.name}...`);
        await client.connect(target.id);
        console.log(`[ftms] connected: ${target.name}`);
        pollTimer = pollDevices(client, ws, autoConnect);
      } else {
        console.log("[ftms] no device connected; polling for devices...");
        pollTimer = pollDevices(client, ws, autoConnect);
      }
    } catch (err: any) {
      console.error("[ftms] error:", err.message);
    }
  })();

  return {
    client,
    ws,
    server,
    async shutdown() {
      if (pollTimer) clearInterval(pollTimer);
      await client.disconnect().catch(() => {});
    },
  };
}

function pollDevices(
  client: FTMSClient,
  ws: WsServer,
  autoConnect: boolean,
  intervalMs = 15000
): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      if (client.status === "connected") return;
      const devices = await client.scan(5000);
      ws.emitDevices(devices);
      if (devices.length > 0 && autoConnect) {
        await client.connect(devices[0].id);
      }
    } catch {}
  }, intervalMs);
}
