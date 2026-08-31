// Simplified indoor bike snapshot: converts optional-rich FTMS bike data
// into a flat structure with null defaults.

import type { IndoorBikeData } from "../ftms/types.js";

export interface BikeSnapshot {
  instantaneousSpeed: number | null;
  averageSpeed: number | null;
  instantaneousCadence: number | null;
  averageCadence: number | null;
  totalDistance: number | null;
  resistanceLevel: number | null;
  instantaneousPower: number | null;
  averagePower: number | null;
  heartRate: number | null;
  elapsedTime: number | null;
  remainingTime: number | null;
}

export function snapshotBikeData(data: IndoorBikeData): BikeSnapshot {
  return {
    instantaneousSpeed: data.instantaneousSpeed ?? null,
    averageSpeed: data.averageSpeed ?? null,
    instantaneousCadence: data.instantaneousCadence ?? null,
    averageCadence: data.averageCadence ?? null,
    totalDistance: data.totalDistance ?? null,
    resistanceLevel: data.resistanceLevel ?? null,
    instantaneousPower: data.instantaneousPower ?? null,
    averagePower: data.averagePower ?? null,
    heartRate: data.heartRate ?? null,
    elapsedTime: data.elapsedTime ?? null,
    remainingTime: data.remainingTime ?? null,
  };
}
