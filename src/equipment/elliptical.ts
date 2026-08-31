// Simplified cross trainer (elliptical) snapshot: converts optional-rich
// FTMS cross trainer data into a flat structure with null defaults.

import type { CrossTrainerData } from "../ftms/types.js";

export interface EllipticalSnapshot {
  instantaneousSpeed: number | null;
  averageSpeed: number | null;
  totalDistance: number | null;
  stepPerMinute: number | null;
  averageStepRate: number | null;
  strideCount: number | null;
  positiveElevationGain: number | null;
  negativeElevationGain: number | null;
  inclination: number | null;
  resistanceLevel: number | null;
  instantaneousPower: number | null;
  averagePower: number | null;
  heartRate: number | null;
  elapsedTime: number | null;
  remainingTime: number | null;
}

export function snapshotEllipticalData(data: CrossTrainerData): EllipticalSnapshot {
  return {
    instantaneousSpeed: data.instantaneousSpeed ?? null,
    averageSpeed: data.averageSpeed ?? null,
    totalDistance: data.totalDistance ?? null,
    stepPerMinute: data.stepPerMinute ?? null,
    averageStepRate: data.averageStepRate ?? null,
    strideCount: data.strideCount ?? null,
    positiveElevationGain: data.positiveElevationGain ?? null,
    negativeElevationGain: data.negativeElevationGain ?? null,
    inclination: data.inclination ?? null,
    resistanceLevel: data.resistanceLevel ?? null,
    instantaneousPower: data.instantaneousPower ?? null,
    averagePower: data.averagePower ?? null,
    heartRate: data.heartRate ?? null,
    elapsedTime: data.elapsedTime ?? null,
    remainingTime: data.remainingTime ?? null,
  };
}
