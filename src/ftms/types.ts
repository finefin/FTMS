// TypeScript interfaces for all FTMS equipment data types, feature flags,
// supported ranges, training status, and machine status objects.

import { EquipmentType } from "./constants.js";

export interface FitnessMachineFeature {
  equipmentType: EquipmentType;
  features: number;
  targetSettingFeatures: number;
}

export interface SupportedRange {
  minimum: number;
  maximum: number;
  increment: number;
}

export interface SupportedRanges {
  speed?: SupportedRange;
  inclination?: SupportedRange;
  resistanceLevel?: SupportedRange;
  heartRate?: SupportedRange;
  power?: SupportedRange;
}

export interface TreadmillData {
  instantaneousSpeed?: number;
  averageSpeed?: number;
  totalDistance?: number;
  inclination?: number;
  rampAngle?: number;
  positiveElevation?: number;
  negativeElevation?: number;
  instantaneousPace?: number;
  averagePace?: number;
  totalEnergy?: number;
  energyPerHour?: number;
  energyPerMinute?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  elapsedTime?: number;
  remainingTime?: number;
  forceOnBelt?: number;
  powerOutput?: number;
}

export interface IndoorBikeData {
  instantaneousSpeed?: number;
  averageSpeed?: number;
  instantaneousCadence?: number;
  averageCadence?: number;
  totalDistance?: number;
  resistanceLevel?: number;
  instantaneousPower?: number;
  averagePower?: number;
  totalEnergy?: number;
  energyPerHour?: number;
  energyPerMinute?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  elapsedTime?: number;
  remainingTime?: number;
}

export interface CrossTrainerData {
  instantaneousSpeed?: number;
  averageSpeed?: number;
  totalDistance?: number;
  stepPerMinute?: number;
  averageStepRate?: number;
  strideCount?: number;
  positiveElevationGain?: number;
  negativeElevationGain?: number;
  inclination?: number;
  rampAngle?: number;
  resistanceLevel?: number;
  instantaneousPower?: number;
  averagePower?: number;
  totalEnergy?: number;
  energyPerHour?: number;
  energyPerMinute?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  elapsedTime?: number;
  remainingTime?: number;
}

export interface RowerData {
  strokeRate?: number;
  strokeCount?: number;
  averageStrokeRate?: number;
  totalDistance?: number;
  instantaneousPace?: number;
  averagePace?: number;
  instantaneousPower?: number;
  averagePower?: number;
  resistanceLevel?: number;
  totalEnergy?: number;
  energyPerHour?: number;
  energyPerMinute?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  elapsedTime?: number;
  remainingTime?: number;
}

export interface StepClimberData {
  floors?: number;
  stepCount?: number;
  stepsPerMinute?: number;
  averageStepsPerMinute?: number;
  positiveElevationGain?: number;
  totalEnergy?: number;
  energyPerHour?: number;
  energyPerMinute?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  elapsedTime?: number;
  remainingTime?: number;
}

export interface StairClimberData {
  floors?: number;
  stepsPerMinute?: number;
  averageStepsPerMinute?: number;
  positiveElevationGain?: number;
  strideCount?: number;
  totalEnergy?: number;
  energyPerHour?: number;
  energyPerMinute?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  elapsedTime?: number;
  remainingTime?: number;
}

export interface TrainingStatus {
  status: number;
  statusCode?: number;
}

export interface FitnessMachineStatus {
  opCode: number;
  parameters?: number[];
}

export type EquipmentData =
  | { type: EquipmentType.Treadmill; data: TreadmillData }
  | { type: EquipmentType.IndoorBike; data: IndoorBikeData }
  | { type: EquipmentType.CrossTrainer; data: CrossTrainerData }
  | { type: EquipmentType.Rower; data: RowerData }
  | { type: EquipmentType.StepClimber; data: StepClimberData }
  | { type: EquipmentType.StairClimber; data: StairClimberData };
