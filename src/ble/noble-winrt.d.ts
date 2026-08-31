// Type declarations for the noble-winrt BLE library.

declare module "noble-winrt" {
  import { EventEmitter } from "events";

  interface Advertisement {
    localName?: string;
    txPowerLevel?: number;
    manufacturerData?: Buffer | null;
    serviceUuids?: string[];
    serviceData?: unknown[];
    serviceSolicitationUuids?: string[];
  }

  interface NoblePeripheral {
    id: string;
    uuid: string;
    address: string;
    addressType: string;
    connectable: boolean;
    advertisement?: Advertisement;
    rssi: number;
    state: string;
    on(event: "disconnect", listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    connect(callback: (error: Error | null) => void): void;
    disconnect(callback: (error: Error | null) => void): void;
    discoverServices(
      uuids: string[],
      callback: (error: Error | null, services: any[]) => void
    ): void;
  }

  interface Noble extends EventEmitter {
    state: string;
    on(event: "stateChange", listener: (state: string) => void): this;
    on(event: "discover", listener: (peripheral: NoblePeripheral) => void): this;
    startScanning(
      serviceUuids: string[],
      allowDuplicates: boolean,
      callback?: (error: Error | null) => void
    ): void;
    stopScanning(callback?: () => void): void;
  }

  const noble: Noble;
  export default noble;
}
