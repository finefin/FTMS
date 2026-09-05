// Hono HTTP server with REST API routes for device management, control,
// and static file serving for the live dashboard.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { networkInterfaces } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createServer as createHttpsServer } from "https";
import { FTMSClient } from "../ftms/client.js";
import type { WsServer } from "./ws.js";
import type { TlsMaterial } from "./cert.js";
import { SettingsStore } from "./settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "public", "index.html");
const RIDE_HTML_PATH = join(__dirname, "public", "ride.html");
const SPACE_HTML_PATH = join(__dirname, "public", "space.html");

function assetError(path: string): string {
  return (
    `Static asset not found at ${path}\n\n` +
    `Static files live in src/server/public and are copied into dist/ by ` +
    `"npm run build". If you are running the compiled build, re-run the build; ` +
    `"npm run dev" serves them straight from src.`
  );
}

function serveAsset(c: any, name: string) {
  const file = join(__dirname, "public", name);
  try {
    const buf = readFileSync(file);
    const contentType = name.endsWith(".js")
      ? "application/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "application/octet-stream";
    return c.body(buf, 200, { "Content-Type": contentType as any, "Cache-Control": "no-cache" });
  } catch {
    return c.text(assetError(file), 404);
  }
}

export function createApp(
  client: FTMSClient,
  ws: WsServer,
  info?: { https?: boolean; port?: number },
  settings: SettingsStore = new SettingsStore()
) {
  const app = new Hono();

  app.get("/", (c) => {
    try {
      const html = readFileSync(HTML_PATH, "utf-8");
      return c.html(html);
    } catch {
      return c.text(assetError(HTML_PATH), 500);
    }
  });

  app.get("/ride", (c) => {
    try {
      const html = readFileSync(RIDE_HTML_PATH, "utf-8");
      return c.html(html);
    } catch {
      return c.text(assetError(RIDE_HTML_PATH), 500);
    }
  });

  app.get("/space", (c) => {
    try {
      const html = readFileSync(SPACE_HTML_PATH, "utf-8");
      return c.html(html);
    } catch {
      return c.text(assetError(SPACE_HTML_PATH), 500);
    }
  });

  // Serve any top-level script from public/. The pattern allows a single
  // path segment ending in .js and no dots or slashes before the extension,
  // so it cannot be walked out of the directory, and it is specific enough
  // not to shadow the /api routes registered above.
  app.get("/:name{[A-Za-z0-9_-]+\\.js}", (c) => serveAsset(c, c.req.param("name")));

  // 3D models under /assets (the repo's assets/ folder is copied into
  // public/assets by scripts/copy-assets.mjs). Hono v4's /* wildcard
  // matches but exposes no param, so recover the remainder from c.req.path.
  // Plain filename characters only, so it cannot be walked out of the dir.
  app.get("/assets/*", (c) => {
    const name = c.req.path.slice("/assets/".length);
    if (!name || name.includes("..") || !/^[A-Za-z0-9_./-]+$/.test(name)) {
      return c.text("bad path", 400);
    }
    return serveAsset(c, "assets/" + name);
  });

  app.get("/api/status", (c) => {
    return c.json({
      connected: client.status === "connected",
      device: client.deviceInfo?.name ?? null,
      equipment: client.equipment,
    });
  });

  // Saved dashboard settings (speed multiplier). A GET with a
  // ?speedMultiplier=... query saves and broadcasts; a plain GET reads.
  app.get("/api/settings", (c) => {
    const q = c.req.query("speedMultiplier");
    if (q !== undefined) {
      const next = settings.set({ speedMultiplier: Number(q) });
      ws.emitSettings(next.speedMultiplier);
      return c.json(next);
    }
    return c.json(settings.get());
  });

  // What the dashboard's "connect from your headset" panel needs to build
  // full URLs — the scheme and port aren't otherwise knowable from a page
  // that was itself loaded over the same connection it's describing.
  app.get("/api/server-info", (c) => {
    const scheme = info?.https ? "https" : "http";
    const port = info?.port ?? 3000;
    const hosts = lanAddresses();
    return c.json({
      https: !!info?.https,
      port,
      urls: hosts.map((h) => `${scheme}://${h}:${port}`),
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

/** Non-internal IPv4 addresses, i.e. the ones other devices can reach. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

export async function startServer(
  client: FTMSClient,
  ws: WsServer,
  port = 3000,
  hostname?: string,
  tls?: TlsMaterial,
  settings: SettingsStore = new SettingsStore()
): Promise<import("http").Server> {
  const scheme = tls ? "https" : "http";
  const app = createApp(client, ws, { https: !!tls, port }, settings);
  // With no hostname, Node binds the unspecified address (`::`, dual-stack),
  // which already accepts connections from the network. Passing HOST only
  // narrows it — e.g. HOST=127.0.0.1 to keep the server private.
  const serveOptions = tls
    ? {
        fetch: app.fetch,
        port,
        hostname,
        createServer: createHttpsServer,
        serverOptions: { key: tls.key, cert: tls.cert },
      }
    : { fetch: app.fetch, port, hostname };
  const server = serve(serveOptions as Parameters<typeof serve>[0], (info) => {
    const addr = info as AddressInfo;
    const lan = lanAddresses();
    console.log(`[ftms] listening on ${hostname ?? "all interfaces"}:${addr.port}${tls ? " (https)" : ""}`);
    console.log(`       local    ${scheme}://localhost:${addr.port}/`);
    for (const ip of lan) {
      console.log(`       network  ${scheme}://${ip}:${addr.port}/        (ride view: /ride)`);
    }
    if (lan.length === 0) {
      console.log("       no external network interface found");
    }
    if (hostname && hostname !== "0.0.0.0" && hostname !== "::") {
      console.log(`       NOTE: HOST=${hostname} restricts access; unset HOST to allow other devices.`);
    } else if (process.platform === "win32") {
      console.log("       If another device cannot connect, allow the port through Windows Firewall:");
      console.log(`       netsh advfirewall firewall add rule name="FTMS ${addr.port}" dir=in action=allow protocol=TCP localport=${addr.port}`);
    }
    if (tls) {
      console.log("       self-signed cert — the headset browser will warn once; click through it to continue.");
    }
  });
  ws.attach(server as unknown as import("http").Server);
  return server as unknown as import("http").Server;
}
