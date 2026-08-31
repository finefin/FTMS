// Simplified rower snapshot: converts optional-rich FTMS rower data
// into a flat structure with null defaults.

import type { RowerData } from "../ftms/types.js";

export interface RowerSnapshot {
  strokeRate: number | null;
  strokeCount: number | null;
  averageStrokeRate: number | null;
  totalDistance: number | null;
  instantaneousPace: number | null;
  averagePace: number | null;
  instantaneousPower: number | null;
  averagePower: number | null;
  resistanceLevel: number | null;
  heartRate: number | null;
  elapsedTime: number | null;
  remainingTime: number | null;
}

export function snapshotRowerData(data: RowerData): RowerSnapshot {
  return {
    strokeRate: data.strokeRate ?? null,
    strokeCount: data.strokeCount ?? null,
    averageStrokeRate: data.averageStrokeRate ?? null,
    totalDistance: data.totalDistance ?? null,
    instantaneousPace: data.instantaneousPace ?? null,
    averagePace: data.averagePace ?? null,
    instantaneousPower: data.instantaneousPower ?? null,
    averagePower: data.averagePower ?? null,
    resistanceLevel: data.resistanceLevel ?? null,
    heartRate: data.heartRate ?? null,
    elapsedTime: data.elapsedTime ?? null,
    remainingTime: data.remainingTime ?? null,
  };
}
