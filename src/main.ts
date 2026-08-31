// Application entry point: bootstraps BLE, HTTP server, WebSocket server,
// and auto-connects to the first FTMS device found.

import { FTMSClient } from "./ftms/client.js";
import { WsServer } from "./server/ws.js";
import { startServer } from "./server/http.js";
import type { ConnectionState } from "./ble/types.js";
import type { FtmsDataEvent } from "./ftms/client.js";
import type { DiscoveredDevice } from "./ble/types.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTO_CONNECT = process.env.AUTO_CONNECT !== "false";

async function main(): Promise<void> {
  const client = new FTMSClient();
  const ws = new WsServer();

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

  await startServer(client, ws, PORT);

  try {
    console.log("[ftms] initializing bluetooth...");
    await client.init();
    console.log("[ftms] bluetooth ready - scanning...");

    const devices = await client.scan(10000);
    ws.emitDevices(devices);
    console.log(`[ftms] found ${devices.length} FTMS device(s)`);

    if (AUTO_CONNECT && devices.length > 0) {
      const target = devices[0];
      console.log(`[ftms] connecting to ${target.name}...`);
      await client.connect(target.id);
      console.log(`[ftms] connected: ${target.name}`);
      pollDevices(client, ws);
    } else {
      console.log("[ftms] no device connected; polling for devices...");
      pollDevices(client, ws);
    }
  } catch (err: any) {
    console.error("[ftms] error:", err.message);
  }
}

async function pollDevices(client: FTMSClient, ws: WsServer, intervalMs = 15000): Promise<void> {
  setInterval(async () => {
    try {
      if (client.status === "connected") return;
      const devices = await client.scan(5000);
      ws.emitDevices(devices);
      if (devices.length > 0 && AUTO_CONNECT) {
        await client.connect(devices[0].id);
      }
    } catch {}
  }, intervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
