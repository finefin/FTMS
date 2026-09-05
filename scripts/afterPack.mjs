// electron-builder afterPack hook. Two jobs:
//
// 1. Make noble-winrt spawn BLEServer.exe from a real on-disk path. When
//    noble-winrt's bindings.js computes the path via __dirname it can still
//    end up pointing inside app.asar (e.g. when a module is loaded from the
//    archive rather than app.asar.unpacked). Node's child_process.spawn
//    cannot launch a program through Electron's virtual asar filesystem, so
//    it throws "spawn BLEServer.exe ENOENT" even though the file exists on
//    disk. Rewriting `app.asar` -> `app.asar.unpacked` in the resolved path
//    guarantees that spawn targets the real exe.
//
// 2. Re-add *.obj 3D models. electron-builder's default file filter strips
//    `*.obj` files unconditionally — app-builder-lib/out/fileMatcher.js
//    defines excludedExts = "...mk,a,o,obj,forge-meta" (it means MSVC object
//    files) and appends the exclusion AFTER the user's files patterns, so
//    there is no `files` config that re-includes them. That drops the
//    corridor station model (assets/station.obj) from the packaged app —
//    it loaded in `npm run dev` (served straight from src/) but 404'd from
//    the installer. This hook runs after the copy/filter phase and before
//    the app dir is packed into app.asar, so copying the assets here puts
//    them into the archive.

import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export default async function afterPack({ appOutDir }) {
  copyModels(appOutDir);
  patchNobleWinrt(appOutDir);
}

function copyModels(appOutDir) {
  const src = join(projectDir, "dist", "server", "public", "assets");
  const dest = join(appOutDir, "resources", "app", "dist", "server", "public", "assets");
  if (!existsSync(src)) {
    console.warn(`[afterPack] model assets not found at ${src}; skipping copy`);
    return;
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[afterPack] copied 3D model assets (incl. *.obj) -> ${dest}`);
}

function patchNobleWinrt(appOutDir) {
  const bindingsPath = join(
    appOutDir,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "noble-winrt",
    "bindings.js"
  );

  if (!existsSync(bindingsPath)) {
    console.warn(`[afterPack] noble-winrt bindings.js not found at ${bindingsPath}; skipping patch`);
    return;
  }

  let src = readFileSync(bindingsPath, "utf8");

  if (src.includes("resolveBleServerPath")) {
    console.log("[afterPack] noble-winrt bindings.js already patched; skipping");
    return;
  }

  const originalLine =
    "const BLE_SERVER_EXE = path.resolve(__dirname, 'prebuilt', 'BLEServer.exe');";

  const patched = [
    "function resolveBleServerPath() {",
    "  let p = path.resolve(__dirname, 'prebuilt', 'BLEServer.exe');",
    "  const i = p.indexOf('app.asar');",
    "  if (i !== -1) {",
    "    const unpacked = p.slice(0, i) + 'app.asar.unpacked' + p.slice(i + 'app.asar'.length);",
    "    try { require('fs').realpathSync(unpacked); return unpacked; } catch (e) {}",
    "  }",
    "  return p;",
    "}",
    "const BLE_SERVER_EXE = resolveBleServerPath();",
  ].join("\n");

  if (!src.includes(originalLine)) {
    console.warn("[afterPack] unexpected bindings.js content; cannot patch BLEServer path");
    return;
  }

  src = src.replace(originalLine, patched);
  writeFileSync(bindingsPath, src, "utf8");
  console.log("[afterPack] patched noble-winrt bindings.js -> " + bindingsPath);
}
