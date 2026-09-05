// Low-level BLE connection management: scanning, connecting, and subscribing
// to GATT characteristic notifications via a platform-appropriate noble
// backend (noble-winrt on Windows, @abandonware/noble on macOS/Linux).

import { EventEmitter } from "events";
import {
  FTMS_SERVICE_UUID,
  FTMS_SERVICE_UUID_LONG,
} from "../ftms/constants.js";
import type { DiscoveredDevice, ConnectionState, ConnectionStateEvent } from "./types.js";

const DEBUG = process.env.DEBUG_BLE === "1";

const FTMS_SHORT = FTMS_SERVICE_UUID.toLowerCase();
const FTMS_LONG = FTMS_SERVICE_UUID_LONG.toLowerCase();

type NoblePeripheral = any;
type NobleService = any;
type NobleCharacteristic = any;

/**
 * Structural shape both BLE backends satisfy — classic noble's API, which
 * noble-winrt deliberately mirrors. Verified directly against
 * @abandonware/noble's runtime (not its shipped .d.ts, which models the
 * same object as free namespace exports rather than instance methods even
 * though the actual module.exports is a Noble instance): state getter,
 * EventEmitter-style stateChange/discover, startScanning(uuids,
 * allowDuplicates, cb)/stopScanning(cb), peripheral.connect(cb)/
 * discoverServices(uuids, cb), service.discoverCharacteristics(uuids, cb),
 * characteristic.subscribe(cb)/read(cb)/write(data, withoutResponse, cb) —
 * all matching callback signatures. Neither backend's own types are used
 * here; we cast to this minimal interface instead, same spirit as the
 * NobleXxx = any aliases above.
 */
interface Noble extends EventEmitter {
  state: string;
  on(event: "stateChange", listener: (state: string) => void): this;
  on(event: "discover", listener: (peripheral: NoblePeripheral) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  startScanning(
    serviceUuids: string[],
    allowDuplicates: boolean,
    callback?: (error: Error | null) => void
  ): void;
  stopScanning(callback?: () => void): void;
}

let noblePromise: Promise<Noble> | null = null;

/**
 * Loads the platform-appropriate BLE backend on first use. noble-winrt
 * talks to the native Windows Bluetooth LE stack and only works on win32;
 * @abandonware/noble covers macOS (CoreBluetooth) and Linux (BlueZ). Both
 * are native addons, so this is a dynamic import gated on process.platform
 * rather than a static one — importing the wrong one for this OS would
 * fail to load at all.
 */
function loadNoble(): Promise<Noble> {
  if (!noblePromise) {
    noblePromise = (
      process.platform === "win32"
        ? import("noble-winrt")
        : import("@abandonware/noble")
    ).then((m: any) => m.default as Noble);
  }
  return noblePromise;
}

function promisify<T>(fn: (cb: (err: Error | null, ...args: any[]) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn((err: Error | null, ...args: any[]) => {
      if (err) reject(err);
      else resolve(args.length > 1 ? (args as T) : (args[0] as T));
    });
  });
}

function normalizeUuid(uuid: string): string {
  return uuid.replace(/[{}]/g, "").toLowerCase();
}

function shortUuid(uuid: string): string {
  const normalized = normalizeUuid(uuid);
  const first = normalized.split("-")[0];
  return first.length === 8 ? first.slice(4) : first;
}

function toUpperKey(uuid: string): string {
  return normalizeUuid(uuid).toUpperCase();
}

function describePeripheral(peripheral: NoblePeripheral): DiscoveredDevice {
  const id = peripheral.id ?? peripheral.address;
  return {
    id,
    name: peripheral.advertisement?.localName ?? peripheral.address ?? id,
    address: peripheral.address ?? id,
    rssi: peripheral.rssi ?? 0,
    serviceData: peripheral.advertisement?.serviceUuids,
    advertisement: peripheral.advertisement,
  };
}

export class BleConnection extends EventEmitter {
  private peripheral: NoblePeripheral | null = null;
  private ftmsService: NobleService | null = null;
  private characteristics: Map<string, NobleCharacteristic> = new Map();
  private discovered: Map<string, NoblePeripheral> = new Map();
  private descriptions: Map<string, DiscoveredDevice> = new Map();
  private _device: DiscoveredDevice | null = null;
  private _state: ConnectionState = "idle";
  /** Serialises all BLE operations so scan/connect/init/disconnect never race. */
  private _queue: Promise<void> = Promise.resolve();

  get state(): ConnectionState {
    return this._state;
  }

  /** The device currently connected or being connected to, if any. */
  get device(): DiscoveredDevice | null {
    return this._device;
  }

  private getBackend(): Promise<Noble> {
    return loadNoble();
  }

  private setState(state: ConnectionState, detail?: { deviceId?: string; error?: string }) {
    this._state = state;
    const event: ConnectionStateEvent = { state, ...detail };
    if (this._device) {
      event.deviceName = this._device.name ?? this._device.address ?? this._device.id;
    }
    this.emit("stateChange", event);
  }

  /** Run a function exclusively: no two calls overlap. */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._queue.then(() => fn(), () => fn());
    // Chain the queue forward — a rejection in `fn` must not block subsequent ops.
    this._queue = next.then(() => {}, () => {});
    return next;
  }

  async init(timeoutMs = 15000): Promise<void> {
    await this.runExclusive(() => this.doInit(timeoutMs));
  }

  async scan(timeoutMs = 10000): Promise<DiscoveredDevice[]> {
    return this.runExclusive(() => this.doScan(timeoutMs));
  }

  async connect(deviceId: string): Promise<void> {
    await this.runExclusive(() => this.doConnect(deviceId));
  }

  async disconnect(): Promise<void> {
    await this.runExclusive(() => this.doDisconnect());
  }

  private async doInit(timeoutMs = 15000): Promise<void> {
    const noble = await this.getBackend();
    if (noble.state === "poweredOn") return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        noble.removeListener("stateChange", onStateChange);
        reject(
          new Error(
            `Bluetooth did not reach "poweredOn" within ${timeoutMs}ms ` +
              `(current state: ${noble.state}).`
          )
        );
      }, timeoutMs);

      const onStateChange = (state: string) => {
        if (DEBUG) console.log(`[ble] adapter state: ${state}`);
        if (state === "poweredOn") {
          clearTimeout(timer);
          noble.removeListener("stateChange", onStateChange);
          resolve();
        } else if (["unsupported", "unauthorized", "unknown"].includes(state)) {
          clearTimeout(timer);
          noble.removeListener("stateChange", onStateChange);
          reject(new Error(`Bluetooth adapter state is "${state}".`));
        }
      };

      noble.on("stateChange", onStateChange);
    });
  }

  private async doScan(timeoutMs = 10000): Promise<DiscoveredDevice[]> {
    const noble = await this.getBackend();
    this.setState("scanning");
    const devices: DiscoveredDevice[] = [];
    const seen = new Set<string>();

    const isFtmsUuid = (uuid: unknown): boolean => {
      if (typeof uuid !== "string") return false;
      const u = normalizeUuid(uuid);
      return u === FTMS_SHORT || u === FTMS_LONG || u.endsWith(FTMS_SHORT);
    };

    const hasFtms = (peripheral: NoblePeripheral): boolean => {
      const advertisement = peripheral.advertisement ?? {};
      const serviceUuids: unknown[] = advertisement.serviceUuids ?? [];
      if (serviceUuids.some(isFtmsUuid)) return true;
      const serviceData = advertisement.serviceData ?? [];
      if (Array.isArray(serviceData) && serviceData.some((d: any) => isFtmsUuid(d?.uuid))) return true;
      if (serviceData && typeof serviceData === "object" && !Array.isArray(serviceData)) {
        if (Object.keys(serviceData).some(isFtmsUuid)) return true;
      }
      const solicitation: unknown[] = advertisement.serviceSolicitationUuids ?? [];
      if (solicitation.some(isFtmsUuid)) return true;
      return false;
    };

    return new Promise((resolve) => {
      const onDiscover = (peripheral: NoblePeripheral) => {
        if (DEBUG) {
          const adv = peripheral.advertisement ?? {};
          console.log(
            `[ble] discover: ${adv.localName ?? "(no name)"} id=${peripheral.id}` +
              ` addr=${peripheral.address} rssi=${peripheral.rssi}` +
              ` uuids=${JSON.stringify(adv.serviceUuids ?? [])}`
          );
        }
        if (!hasFtms(peripheral)) return;
        const id = peripheral.id ?? peripheral.address;
        if (seen.has(id)) return;
        seen.add(id);

        const device = describePeripheral(peripheral);
        this.discovered.set(id, peripheral);
        this.descriptions.set(id, device);
        devices.push(device);
        this.emit("device", device);
      };

      noble.on("discover", onDiscover);
      noble.startScanning([], true, () => {});
      setTimeout(() => {
        noble.removeListener("discover", onDiscover);
        noble.stopScanning(() => {});
        // A scan started while an established connection was live must not
        // clobber the connected state (the dashboard/scene read it).
        if (!this.peripheral) {
          this._state = "idle";
        }
        resolve(devices);
      }, timeoutMs);
    });
  }

  private async doConnect(deviceId: string): Promise<void> {
    const noble = await this.getBackend();

    // Already have a live connection (e.g. the auto-connect loop or a manual
    // scan button re-requesting a connect while streaming). Don't tear it
    // down or report a spurious error — if it's the same device, keep it and
    // just re-assert "connected".
    if (this.peripheral) {
      if (this._device?.id === deviceId) {
        this.setState("connected", { deviceId });
        return;
      }
      await this.doDisconnect();
    }

    this._device = this.descriptions.get(deviceId) ?? null;
    this.setState("connecting", { deviceId });

    let peripheral = this.discovered.get(deviceId);
    if (!peripheral) {
      peripheral = await new Promise<NoblePeripheral>((resolve, reject) => {
        const onDiscover = (p: NoblePeripheral) => {
          const id = p.id ?? p.address;
          if (id === deviceId) {
            clearTimeout(timer);
            noble.removeListener("discover", onDiscover);
            resolve(p);
          }
        };
        const timer = setTimeout(() => {
          noble.removeListener("discover", onDiscover);
          reject(new Error("Device not found during scan"));
        }, 10000);
        noble.on("discover", onDiscover);
        noble.startScanning([], true, () => {});
      });
      noble.stopScanning(() => {});
      this.discovered.set(deviceId, peripheral);
    }

    // Connecting straight to an id (no prior scan in this process) leaves us
    // without a description, so derive one from the peripheral itself.
    if (!this._device && peripheral) {
      this._device = describePeripheral(peripheral);
      this.descriptions.set(deviceId, this._device);
    }

    try {
      peripheral.on("disconnect", () => {
        this.peripheral = null;
        this.ftmsService = null;
        this.characteristics.clear();
        this.setState("disconnected", { deviceId });
        this._device = null;
      });

      await promisify<void>((cb) => peripheral.connect(cb));
      this.peripheral = peripheral;
      this.setState("connected", { deviceId });

      const services = await promisify<NobleService[]>((cb) =>
        peripheral.discoverServices([], cb)
      );
      if (DEBUG) {
        console.log(
          `[ble] discovered services: ` +
            JSON.stringify((services ?? []).map((s: NobleService) => String(s.uuid)))
        );
      }
      const ftmsServices = (services ?? []).filter((s: NobleService) => {
        const u = normalizeUuid(String(s.uuid ?? ""));
        return (
          u === FTMS_SHORT ||
          u === FTMS_LONG ||
          u.endsWith(FTMS_SHORT) ||
          u.includes(FTMS_SHORT)
        );
      });
      if (ftmsServices.length === 0) {
        throw new Error("FTMS service not found on device");
      }

      this.ftmsService = ftmsServices[0];
      const chars = await promisify<NobleCharacteristic[]>((cb) =>
        this.ftmsService.discoverCharacteristics([], cb)
      );
      for (const char of chars) {
        const uuid = normalizeUuid(String(char.uuid ?? ""));
        this.characteristics.set(toUpperKey(uuid), char);
        this.characteristics.set(toUpperKey(shortUuid(uuid)), char);
      }
    } catch (err: any) {
      this.setState("error", { deviceId, error: err.message });
      throw err;
    }
  }

  getCharacteristic(uuid: string): NobleCharacteristic | undefined {
    const short = shortUuid(uuid);
    return (
      this.characteristics.get(toUpperKey(uuid)) ??
      this.characteristics.get(toUpperKey(short))
    );
  }

  async subscribeNotifications(uuid: string, onData: (data: Buffer) => void): Promise<void> {
    const char = this.getCharacteristic(uuid);
    if (!char) throw new Error(`Characteristic ${uuid} not found`);

    char.on("data", (data: Buffer, isNotification: boolean) => {
      if (isNotification && Buffer.isBuffer(data) && data.length > 0) {
        onData(data);
      }
    });

    await promisify<void>((cb) => char.subscribe(cb));
  }

  async read(uuid: string): Promise<Buffer> {
    const char = this.getCharacteristic(uuid);
    if (!char) throw new Error(`Characteristic ${uuid} not found`);
    return promisify<Buffer>((cb) => char.read(cb));
  }

  async write(uuid: string, data: Buffer): Promise<void> {
    const char = this.getCharacteristic(uuid);
    if (!char) throw new Error(`Characteristic ${uuid} not found`);
    await promisify<void>((cb) => char.write(data, false, cb));
  }

  private async doDisconnect(): Promise<void> {
    const noble = await this.getBackend();
    if (this.peripheral) {
      await promisify<void>((cb) => this.peripheral.disconnect(cb)).catch(() => {});
      this.peripheral = null;
      this.ftmsService = null;
      this.characteristics.clear();
      this.setState("disconnected");
      this._device = null;
    }
    noble.stopScanning(() => {});
  }
}
