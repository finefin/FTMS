// WebSocket server that broadcasts real-time FTMS data, connection state,
// and discovered device lists to connected browser clients.

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { FtmsDataEvent } from "../ftms/client.js";
import type { DiscoveredDevice, ConnectionState } from "../ble/types.js";

type WsMessage =
  | { type: "data"; equipment: string; data: Record<string, unknown>; timestamp: number }
  | { type: "state"; state: ConnectionState; deviceName?: string }
  | { type: "status"; connected: boolean }
  | { type: "devices"; devices: DiscoveredDevice[] };

export class WsServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private lastData: WsMessage | null = null;
  private lastState: WsMessage | null = null;

  attach(server: Server) {
    if (this.wss) return;
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      if (this.lastData) this.send(ws, this.lastData);
      if (this.lastState) this.send(ws, this.lastState);

      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
    });
  }

  private send(ws: WebSocket, message: WsMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: WsMessage) {
    for (const ws of this.clients) {
      this.send(ws, message);
    }
  }

  emitData(event: FtmsDataEvent) {
    const message: WsMessage = {
      type: "data",
      equipment: event.type,
      data: event.data as Record<string, unknown>,
      timestamp: event.timestamp,
    };
    this.lastData = message;
    this.broadcast(message);
  }

  emitState(state: ConnectionState, deviceName?: string) {
    const message: WsMessage = {
      type: "state",
      state,
      deviceName,
    };
    this.lastState = message;
    this.broadcast(message);
  }

  emitStatus(connected: boolean) {
    this.broadcast({ type: "status", connected });
  }

  emitDevices(devices: DiscoveredDevice[]) {
    this.broadcast({ type: "devices", devices });
  }

  close() {
    this.wss?.close();
  }
}
