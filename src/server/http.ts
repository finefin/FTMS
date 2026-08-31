// Hono HTTP server with REST API routes for device management, control,
// and static file serving for the live dashboard.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { FTMSClient } from "../ftms/client.js";
import type { WsServer } from "./ws.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "public", "index.html");

export function createApp(
  client: FTMSClient,
  ws: WsServer
) {
  const app = new Hono();

  app.get("/", (c) => {
    try {
      const html = readFileSync(HTML_PATH, "utf-8");
      return c.html(html);
    } catch {
      return c.text("Dashboard not found. Build the project or run via tsx.", 500);
    }
  });

  app.get("/api/status", (c) => {
    return c.json({
      connected: client.status === "connected",
      device: client.deviceInfo?.name ?? null,
      equipment: client.equipment,
    });
  });

  app.get("/api/devices", async (c) => {
    const devices = await client.scan(5000);
    return c.json(devices);
  });

  app.get("/api/connect", async (c) => {
    const deviceId = c.req.query("id");
    if (!deviceId) return c.json({ error: "Missing device id" }, 400);
    try {
      await client.connect(deviceId);
      return c.json({ connected: true, equipment: client.equipment });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/control", async (c) => {
    const op = c.req.query("op");
    const value = Number(c.req.query("value"));

    try {
      let ok = false;
      switch (op) {
        case "start": ok = await client.startWorkout(); break;
        case "stop": ok = await client.stopWorkout(false); break;
        case "pause": ok = await client.stopWorkout(true); break;
        case "speed": ok = await client.setSpeed(value); break;
        case "power": ok = await client.setPower(value); break;
        case "resistance": ok = await client.setResistance(value); break;
        case "inclination": ok = await client.setInclination(value); break;
        default: return c.json({ error: "Unknown operation" }, 400);
      }
      return c.json({ ok });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/disconnect", async (c) => {
    await client.disconnect();
    return c.json({ disconnected: true });
  });

  return app;
}

export async function startServer(
  client: FTMSClient,
  ws: WsServer,
  port = 3000
): Promise<import("http").Server> {
  const app = createApp(client, ws);
  const server = serve({ fetch: app.fetch, port }, (info) => {
    const addr = info as AddressInfo;
    console.log(`FTMS dashboard: http://localhost:${addr.port}`);
  });
  ws.attach(server as unknown as import("http").Server);
  return server as unknown as import("http").Server;
}
