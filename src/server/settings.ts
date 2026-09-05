// Small persisted user-config store. Lives in the user's home directory
// (~/.ftms/settings.json) so it survives rebuilds and the packaged app's
// read-only dist folder. Currently holds the scene speed multiplier.

import { homedir } from "os";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export interface AppSettings {
  speedMultiplier: number;
}

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  speedMultiplier: 1,
});

export function clampSpeedMultiplier(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.speedMultiplier;
  return Math.min(1000000, Math.max(0.1, v));
}

function settingsPath(): string {
  return join(homedir(), ".ftms", "settings.json");
}

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  constructor() {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Partial<AppSettings>;
      if (typeof parsed.speedMultiplier === "number") {
        this.settings.speedMultiplier = clampSpeedMultiplier(parsed.speedMultiplier);
      }
    } catch {
      // First run (no file yet) or a corrupt file — keep the defaults.
    }
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  set(partial: Partial<AppSettings>): AppSettings {
    if (partial.speedMultiplier !== undefined) {
      this.settings.speedMultiplier = clampSpeedMultiplier(partial.speedMultiplier);
    }
    this.persist();
    return this.get();
  }

  private persist() {
    try {
      const file = settingsPath();
      if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(this.settings, null, 2));
    } catch (err: any) {
      console.warn(`[ftms] could not persist settings: ${err.message}`);
    }
  }
}