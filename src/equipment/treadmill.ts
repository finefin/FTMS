// Simplified treadmill snapshot: converts optional-rich FTMS treadmill data
// into a flat structure with null defaults.

import type { TreadmillData } from "../ftms/types.js";

export interface TreadmillSnapshot {
  instantaneousSpeed: number | null;
  averageSpeed: number | null;
  totalDistance: number | null;
  inclination: number | null;
  rampAngle: number | null;
  heartRate: number | null;
  elapsedTime: number | null;
  remainingTime: number | null;
}

export function snapshotTreadmillData(data: TreadmillData): TreadmillSnapshot {
  return {
    instantaneousSpeed: data.instantaneousSpeed ?? null,
    averageSpeed: data.averageSpeed ?? null,
    totalDistance: data.totalDistance ?? null,
    inclination: data.inclination ?? null,
    rampAngle: data.rampAngle ?? null,
    heartRate: data.heartRate ?? null,
    elapsedTime: data.elapsedTime ?? null,
    remainingTime: data.remainingTime ?? null,
  };
}
