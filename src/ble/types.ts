// TypeScript type definitions for BLE discovered devices and connection states.

export interface DiscoveredDevice {
  id: string;
  name: string | null;
  address: string;
  rssi: number;
  serviceData?: Buffer;
  advertisement?: unknown;
}

export type ConnectionState = "idle" | "scanning" | "connecting" | "connected" | "disconnected" | "error";

export interface ConnectionStateEvent {
  state: ConnectionState;
  deviceId?: string;
  error?: string;
}
