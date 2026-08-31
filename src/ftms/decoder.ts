// Binary decoders for all FTMS data characteristics (treadmill, indoor bike,
// cross trainer, rower, step climber, stair climber) plus feature and status
// decoders. Implements the Bluetooth Fitness Machine Service specification.

import { EquipmentType } from "./constants.js";
import type {
  FitnessMachineFeature,
  TreadmillData,
  IndoorBikeData,
  CrossTrainerData,
  RowerData,
  StepClimberData,
  StairClimberData,
  TrainingStatus,
  FitnessMachineStatus,
} from "./types.js";

function readUint16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readSint16LE(buf: Buffer, offset: number): number {
  return buf.readInt16LE(offset);
}

function readUint24LE(buf: Buffer, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

function readEnergy(buf: Buffer, offset: number): { offset: number; totalEnergy: number; energyPerHour: number; energyPerMinute: number } {
  const totalEnergy = readUint16LE(buf, offset);
  const energyPerHour = readUint16LE(buf, offset + 2);
  const energyPerMinute = buf[offset + 4];
  return { offset: offset + 5, totalEnergy, energyPerHour, energyPerMinute };
}

export function decodeFitnessMachineFeature(buf: Buffer | null | undefined): FitnessMachineFeature {
  if (!buf || buf.length < 2) {
    return { equipmentType: EquipmentType.Unknown, features: 0, targetSettingFeatures: 0 };
  }
  const equipmentTypeRaw = buf.readUInt16LE(0);
  let equipmentType: EquipmentType;
  switch (equipmentTypeRaw) {
    case 0x01: equipmentType = EquipmentType.Treadmill; break;
    case 0x02: equipmentType = EquipmentType.CrossTrainer; break;
    case 0x04: equipmentType = EquipmentType.StepClimber; break;
    case 0x08: equipmentType = EquipmentType.StairClimber; break;
    case 0x10: equipmentType = EquipmentType.Rower; break;
    case 0x20: equipmentType = EquipmentType.IndoorBike; break;
    default: equipmentType = EquipmentType.Unknown;
  }
  return {
    equipmentType,
    features: buf.length >= 4 ? buf.readUInt32LE(2) : 0,
    targetSettingFeatures: buf.length >= 8 ? buf.readUInt32LE(6) : 0,
  };
}

export function decodeTreadmillData(buf: Buffer): TreadmillData {
  const flags = readUint16LE(buf, 0);
  let o = 2;
  const result: TreadmillData = {};

  if (!(flags & 0x0001)) {
    result.instantaneousSpeed = readUint16LE(buf, o) / 100;
    o += 2;
  }
  if (flags & 0x0002) {
    result.averageSpeed = readUint16LE(buf, o) / 100;
    o += 2;
  }
  if (flags & 0x0004) {
    result.totalDistance = readUint24LE(buf, o);
    o += 3;
  }
  if (flags & 0x0008) {
    result.inclination = readSint16LE(buf, o) / 10;
    o += 2;
    result.rampAngle = readSint16LE(buf, o) / 10;
    o += 2;
  }
  if (flags & 0x0010) {
    result.positiveElevation = readUint16LE(buf, o) / 10;
    o += 2;
    result.negativeElevation = readUint16LE(buf, o) / 10;
    o += 2;
  }
  if (flags & 0x0020) {
    result.instantaneousPace = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x0040) {
    result.averagePace = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x0080) {
    const energy = readEnergy(buf, o);
    o = energy.offset;
    result.totalEnergy = energy.totalEnergy;
    result.energyPerHour = energy.energyPerHour;
    result.energyPerMinute = energy.energyPerMinute;
  }
  if (flags & 0x0100) {
    result.heartRate = buf[o];
    o += 1;
  }
  if (flags & 0x0200) {
    result.metabolicEquivalent = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x0400) {
    result.elapsedTime = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0800) {
    result.remainingTime = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x1000) {
    result.forceOnBelt = readSint16LE(buf, o);
    o += 2;
    result.powerOutput = readSint16LE(buf, o);
    o += 2;
  }
  return result;
}

export function decodeIndoorBikeData(buf: Buffer): IndoorBikeData {
  const flags = readUint16LE(buf, 0);
  let o = 2;
  const result: IndoorBikeData = {};

  if (!(flags & 0x0001)) {
    result.instantaneousSpeed = readUint16LE(buf, o) / 100;
    o += 2;
  }
  if (flags & 0x0002) {
    result.averageSpeed = readUint16LE(buf, o) / 100;
    o += 2;
  }
  if (flags & 0x0004) {
    result.instantaneousCadence = readUint16LE(buf, o) / 2;
    o += 2;
  }
  if (flags & 0x0008) {
    result.averageCadence = readUint16LE(buf, o) / 2;
    o += 2;
  }
  if (flags & 0x0010) {
    result.totalDistance = readUint24LE(buf, o);
    o += 3;
  }
  if (flags & 0x0020) {
    result.resistanceLevel = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0040) {
    result.instantaneousPower = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0080) {
    result.averagePower = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0100) {
    const energy = readEnergy(buf, o);
    o = energy.offset;
    result.totalEnergy = energy.totalEnergy;
    result.energyPerHour = energy.energyPerHour;
    result.energyPerMinute = energy.energyPerMinute;
  }
  if (flags & 0x0200) {
    result.heartRate = buf[o];
    o += 1;
  }
  if (flags & 0x0400) {
    result.metabolicEquivalent = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x0800) {
    result.elapsedTime = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x1000) {
    result.remainingTime = readUint16LE(buf, o);
    o += 2;
  }
  return result;
}

export function decodeCrossTrainerData(buf: Buffer): CrossTrainerData {
  const flags = buf.readUIntLE(0, 3);
  let o = 3;
  const result: CrossTrainerData = {};

  if (!(flags & 0x0001)) {
    result.instantaneousSpeed = readUint16LE(buf, o) / 100;
    o += 2;
  }
  if (flags & 0x0002) {
    result.averageSpeed = readUint16LE(buf, o) / 100;
    o += 2;
  }
  if (flags & 0x0004) {
    result.totalDistance = readUint24LE(buf, o);
    o += 3;
  }
  if (flags & 0x0008) {
    result.stepPerMinute = readUint16LE(buf, o);
    o += 2;
    result.averageStepRate = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0010) {
    result.strideCount = readUint16LE(buf, o) / 10;
    o += 2;
  }
  if (flags & 0x0020) {
    result.positiveElevationGain = readUint16LE(buf, o);
    o += 2;
    result.negativeElevationGain = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0040) {
    result.inclination = readSint16LE(buf, o) / 10;
    o += 2;
    result.rampAngle = readSint16LE(buf, o) / 10;
    o += 2;
  }
  if (flags & 0x0080) {
    result.resistanceLevel = readSint16LE(buf, o) / 10;
    o += 2;
  }
  if (flags & 0x0100) {
    result.instantaneousPower = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0200) {
    result.averagePower = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0400) {
    const energy = readEnergy(buf, o);
    o = energy.offset;
    result.totalEnergy = energy.totalEnergy;
    result.energyPerHour = energy.energyPerHour;
    result.energyPerMinute = energy.energyPerMinute;
  }
  if (flags & 0x0800) {
    result.heartRate = buf[o];
    o += 1;
  }
  if (flags & 0x1000) {
    result.metabolicEquivalent = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x2000) {
    result.elapsedTime = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x4000) {
    result.remainingTime = readUint16LE(buf, o);
    o += 2;
  }
  return result;
}

export function decodeRowerData(buf: Buffer): RowerData {
  const flags = readUint16LE(buf, 0);
  let o = 2;
  const result: RowerData = {};

  if (!(flags & 0x0001)) {
    result.strokeRate = buf[o] / 2;
    o += 1;
    result.strokeCount = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0002) {
    result.averageStrokeRate = buf[o] / 2;
    o += 1;
  }
  if (flags & 0x0004) {
    result.totalDistance = readUint24LE(buf, o);
    o += 3;
  }
  if (flags & 0x0008) {
    result.instantaneousPace = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0010) {
    result.averagePace = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0020) {
    result.instantaneousPower = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0040) {
    result.averagePower = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0080) {
    result.resistanceLevel = readSint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0100) {
    const energy = readEnergy(buf, o);
    o = energy.offset;
    result.totalEnergy = energy.totalEnergy;
    result.energyPerHour = energy.energyPerHour;
    result.energyPerMinute = energy.energyPerMinute;
  }
  if (flags & 0x0200) {
    result.heartRate = buf[o];
    o += 1;
  }
  if (flags & 0x0400) {
    result.metabolicEquivalent = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x0800) {
    result.elapsedTime = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x1000) {
    result.remainingTime = readUint16LE(buf, o);
    o += 2;
  }
  return result;
}

export function decodeStepClimberData(buf: Buffer): StepClimberData {
  const flags = readUint16LE(buf, 0);
  let o = 2;
  const result: StepClimberData = {};

  if (!(flags & 0x0001)) {
    result.floors = readUint16LE(buf, o);
    o += 2;
    result.stepCount = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0002) {
    result.stepsPerMinute = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0004) {
    result.averageStepsPerMinute = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0008) {
    result.positiveElevationGain = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0010) {
    const energy = readEnergy(buf, o);
    o = energy.offset;
    result.totalEnergy = energy.totalEnergy;
    result.energyPerHour = energy.energyPerHour;
    result.energyPerMinute = energy.energyPerMinute;
  }
  if (flags & 0x0020) {
    result.heartRate = buf[o];
    o += 1;
  }
  if (flags & 0x0040) {
    result.metabolicEquivalent = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x0080) {
    result.elapsedTime = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0100) {
    result.remainingTime = readUint16LE(buf, o);
    o += 2;
  }
  return result;
}

export function decodeStairClimberData(buf: Buffer): StairClimberData {
  const flags = readUint16LE(buf, 0);
  let o = 2;
  const result: StairClimberData = {};

  if (!(flags & 0x0001)) {
    result.floors = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0002) {
    result.stepsPerMinute = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0004) {
    result.averageStepsPerMinute = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0008) {
    result.positiveElevationGain = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0010) {
    result.strideCount = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0020) {
    const energy = readEnergy(buf, o);
    o = energy.offset;
    result.totalEnergy = energy.totalEnergy;
    result.energyPerHour = energy.energyPerHour;
    result.energyPerMinute = energy.energyPerMinute;
  }
  if (flags & 0x0040) {
    result.heartRate = buf[o];
    o += 1;
  }
  if (flags & 0x0080) {
    result.metabolicEquivalent = buf[o] / 10;
    o += 1;
  }
  if (flags & 0x0100) {
    result.elapsedTime = readUint16LE(buf, o);
    o += 2;
  }
  if (flags & 0x0200) {
    result.remainingTime = readUint16LE(buf, o);
    o += 2;
  }
  return result;
}

export function decodeTrainingStatus(buf: Buffer): TrainingStatus {
  const status = buf[0];
  const statusCode = buf.length > 1 ? buf[1] : undefined;
  return { status, statusCode };
}

export function decodeFitnessMachineStatus(buf: Buffer): FitnessMachineStatus {
  const opCode = buf[0];
  const parameters = buf.length > 1 ? Array.from(buf.slice(1)) : undefined;
  return { opCode, parameters };
}
