// High-level FTMS client: discovers equipment type, subscribes to data
// characteristic notifications, and exposes control point commands.

import { EventEmitter } from "events";
import { BleConnection } from "../ble/connection.js";
import type { DiscoveredDevice, ConnectionState, ConnectionStateEvent } from "../ble/types.js";
import {
  FTMS_CHAR_UUIDS,
  EquipmentType,
  CONTROL_POINT_RESPONSE_CODES,
} from "./constants.js";
import {
  decodeFitnessMachineFeature,
  decodeIndoorBikeData,
  decodeTreadmillData,
  decodeCrossTrainerData,
  decodeRowerData,
  decodeStepClimberData,
  decodeStairClimberData,
  decodeTrainingStatus,
  decodeFitnessMachineStatus,
} from "./decoder.js";
import {
  requestControl,
  reset,
  startResume,
  stopPause,
  setSpeedTarget,
  setInclinationTarget,
  setResistanceTarget,
  setPowerTarget,
  setHeartRateTarget,
  setIndoorBikeSimulation,
  setWheelCircumference,
} from "./encoder.js";
import type {
  FitnessMachineFeature,
  EquipmentData,
  TrainingStatus,
  FitnessMachineStatus,
} from "./types.js";

export type FtmsDataEvent = EquipmentData & { timestamp: number };

export class FTMSClient extends EventEmitter {
  private connection: BleConnection;
  private equipmentType: EquipmentType = EquipmentType.Unknown;
  private feature?: FitnessMachineFeature;
  private _deviceInfo?: DiscoveredDevice;
  private _status: ConnectionState = "idle";
  private controlPointDataChar: string | null = null;

  constructor() {
    super();
    this.connection = new BleConnection();
    this.connection.on("stateChange", (event: ConnectionStateEvent) => {
      // Mirror the transport's lifecycle onto our own status. Without this an
      // unsolicited drop (the peripheral's own "disconnect") left `status`
      // reading "connected" forever, so /api/status kept reporting a live
      // device and main.ts's reconnect poll — which returns early while
      // connected — never scanned again.
      //
      // "scanning"/"idle" are deliberately not mirrored: a scan issued while
      // connected would otherwise clobber the connected status.
      if (
        event.state === "connecting" ||
        event.state === "connected" ||
        event.state === "disconnected" ||
        event.state === "error"
      ) {
        this._status = event.state;
      }
      if (event.state === "disconnected" || event.state === "error") {
        this._deviceInfo = undefined;
      }
      this.emit("stateChange", event);
    });
    this.connection.on("device", (device: DiscoveredDevice) => {
      this.emit("device", device);
    });
  }

  get status(): ConnectionState {
    return this._status;
  }

  get deviceInfo(): DiscoveredDevice | undefined {
    return this._deviceInfo;
  }

  get equipment(): EquipmentType {
    return this.equipmentType;
  }

  get features(): FitnessMachineFeature | undefined {
    return this.feature;
  }

  async init(): Promise<void> {
    await this.connection.init();
  }

  async scan(timeoutMs = 10000): Promise<DiscoveredDevice[]> {
    return this.connection.scan(timeoutMs);
  }

  async connect(deviceId: string): Promise<void> {
    await this.connection.connect(deviceId);
    // Record which device we landed on; `deviceInfo` was previously declared
    // and exposed but never assigned, so /api/status always reported null.
    this._deviceInfo = this.connection.device ?? undefined;
    this._status = "connected";
    await this.setup();
  }

  private async setup(): Promise<void> {
    try {
      const featureChar = this.connection.getCharacteristic(FTMS_CHAR_UUIDS.FITNESS_MACHINE_FEATURE);
      if (featureChar) {
        const featureBuf = await this.connection.read(FTMS_CHAR_UUIDS.FITNESS_MACHINE_FEATURE);
        this.feature = decodeFitnessMachineFeature(featureBuf);
        this.equipmentType = this.feature.equipmentType;
      }
    } catch (err) {
      this.equipmentType = EquipmentType.Unknown;
    }

    const dataChar = this.resolveDataCharacteristic();
    if (!dataChar) {
      throw new Error("No supported FTMS data characteristic found on device");
    }
    this.controlPointDataChar = dataChar;

    await this.connection.subscribeNotifications(dataChar, (data) => {
      this.handleDataNotification(dataChar, data);
    });

    try {
      await this.connection.subscribeNotifications(FTMS_CHAR_UUIDS.TRAINING_STATUS, (data) => {
        const status = decodeTrainingStatus(data);
        this.emit("trainingStatus", status as TrainingStatus);
      });
    } catch {
    }

    try {
      await this.connection.subscribeNotifications(FTMS_CHAR_UUIDS.FITNESS_MACHINE_STATUS, (data) => {
        const status = decodeFitnessMachineStatus(data);
        this.emit("machineStatus", status as FitnessMachineStatus);
      });
    } catch {
    }

    this.emit("ready", { equipmentType: this.equipmentType });
  }

  private resolveDataCharacteristic(): string | null {
    switch (this.equipmentType) {
      case EquipmentType.Treadmill:
        return FTMS_CHAR_UUIDS.TREADMILL_DATA;
      case EquipmentType.IndoorBike:
        return FTMS_CHAR_UUIDS.INDOOR_BIKE_DATA;
      case EquipmentType.CrossTrainer:
        return FTMS_CHAR_UUIDS.CROSS_TRAINER_DATA;
      case EquipmentType.Rower:
        return FTMS_CHAR_UUIDS.ROWER_DATA;
      case EquipmentType.StepClimber:
        return FTMS_CHAR_UUIDS.STEP_CLIMBER_DATA;
      case EquipmentType.StairClimber:
        return FTMS_CHAR_UUIDS.STAIR_CLIMBER_DATA;
      default:
        for (const uuid of [
          FTMS_CHAR_UUIDS.TREADMILL_DATA,
          FTMS_CHAR_UUIDS.INDOOR_BIKE_DATA,
          FTMS_CHAR_UUIDS.CROSS_TRAINER_DATA,
          FTMS_CHAR_UUIDS.ROWER_DATA,
        ]) {
          if (this.connection.getCharacteristic(uuid)) return uuid;
        }
        return null;
    }
  }

  private handleDataNotification(dataChar: string, data: Buffer): void {
    let event: FtmsDataEvent;
    switch (dataChar) {
      case FTMS_CHAR_UUIDS.TREADMILL_DATA:
        event = {
          type: EquipmentType.Treadmill,
          data: decodeTreadmillData(data),
          timestamp: Date.now(),
        };
        break;
      case FTMS_CHAR_UUIDS.INDOOR_BIKE_DATA:
        event = {
          type: EquipmentType.IndoorBike,
          data: decodeIndoorBikeData(data),
          timestamp: Date.now(),
        };
        break;
      case FTMS_CHAR_UUIDS.CROSS_TRAINER_DATA:
        event = {
          type: EquipmentType.CrossTrainer,
          data: decodeCrossTrainerData(data),
          timestamp: Date.now(),
        };
        break;
      case FTMS_CHAR_UUIDS.ROWER_DATA:
        event = {
          type: EquipmentType.Rower,
          data: decodeRowerData(data),
          timestamp: Date.now(),
        };
        break;
      case FTMS_CHAR_UUIDS.STEP_CLIMBER_DATA:
        event = {
          type: EquipmentType.StepClimber,
          data: decodeStepClimberData(data),
          timestamp: Date.now(),
        };
        break;
      case FTMS_CHAR_UUIDS.STAIR_CLIMBER_DATA:
        event = {
          type: EquipmentType.StairClimber,
          data: decodeStairClimberData(data),
          timestamp: Date.now(),
        };
        break;
      default:
        return;
    }

    this.emit("data", event);
  }

  private async sendCommand(buf: Buffer): Promise<number> {
    const controlChar = this.connection.getCharacteristic(FTMS_CHAR_UUIDS.FITNESS_MACHINE_CONTROL_POINT);
    if (!controlChar) throw new Error("Control point characteristic not available");

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        controlChar.removeListener("data", onData);
        reject(new Error("Control point response timeout"));
      }, 5000);

      const onData = (data?: Buffer) => {
        if (!data || data.length < 3) return;
        const requestOpCode = data[1];
        const resultCode = data[2];
        if (requestOpCode !== buf[0]) return;

        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        controlChar.removeListener("data", onData);
        resolve(resultCode);
      };

      controlChar.on("data", onData);
      controlChar.write(Buffer.from(buf), false, (err: Error | null) => {
        if (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          controlChar.removeListener("data", onData);
          reject(err);
        }
      });
    });
  }

  async requestControl(): Promise<boolean> {
    const result = await this.sendCommand(requestControl());
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async resetMachine(): Promise<boolean> {
    const result = await this.sendCommand(reset());
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async startWorkout(): Promise<boolean> {
    const result = await this.sendCommand(startResume());
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async stopWorkout(pause: boolean = false): Promise<boolean> {
    const result = await this.sendCommand(stopPause(pause));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async setSpeed(speed: number): Promise<boolean> {
    const result = await this.sendCommand(setSpeedTarget(speed));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async setInclination(inclination: number): Promise<boolean> {
    const result = await this.sendCommand(setInclinationTarget(inclination));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async setResistance(level: number): Promise<boolean> {
    const result = await this.sendCommand(setResistanceTarget(level));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async setPower(power: number): Promise<boolean> {
    const result = await this.sendCommand(setPowerTarget(power));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async setHeartRate(hr: number): Promise<boolean> {
    const result = await this.sendCommand(setHeartRateTarget(hr));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async setSimulation(windSpeed: number, grade: number, crr: number, cw: number): Promise<boolean> {
    const result = await this.sendCommand(setIndoorBikeSimulation(windSpeed, grade, crr, cw));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async setWheelCircumference(cm: number): Promise<boolean> {
    const result = await this.sendCommand(setWheelCircumference(cm));
    return result === CONTROL_POINT_RESPONSE_CODES.SUCCESS;
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
    this._status = "disconnected";
  }
}
