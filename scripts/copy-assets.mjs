// tsc only emits .js for .ts inputs, so the dashboard and ride view under
// src/server/public are not part of the build output. Without this step
// `npm run build && npm start` serves 500 for / and /ride and 404 for every
// script, because http.ts resolves them relative to dist/server/.
import { cpSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { dirname, join, basename, extname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "server", "public");
const to = join(root, "dist", "server", "public");

if (!existsSync(from)) {
  console.error(`[build] static assets not found at ${from}`);
  process.exit(1);
}

mkdirSync(dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`[build] copied static assets -> ${to}`);

// 3D models: the repo-level assets/ folder is the source of truth (the user
// edits models there). Mirror it into the served public dir so both `npm run
// dev` (src) and the packaged app (dist) can fetch them at /assets/*.
const modelRoot = join(root, "assets");
if (existsSync(modelRoot)) {
  for (const dest of [
    join(root, "src", "server", "public", "assets"),
    join(root, "dist", "server", "public", "assets"),
  ]) {
    mkdirSync(dest, { recursive: true });
    cpSync(modelRoot, dest, { recursive: true });
  }
  console.log(`[build] copied 3d models -> src/server/public/assets, dist/server/public/assets`);

  // electron-builder forcibly excludes `*.obj` files from the packaged app
  // (its file matcher appends `!**/*.{...obj...}` after any user `files`
  // globs, so re-including them is impossible). The corridor station loads
  // from /assets/station.obj in dev but 404s once packaged, leaving no
  // station model. Mirror each root-level OBJ to a no-extension twin
  // (station.obj -> station-model) that survives packaging; the scene loads
  // the twin first and falls back to the .obj.
  for (const name of readdirSync(modelRoot)) {
    if (extname(name).toLowerCase() !== ".obj") continue;
    const twin = basename(name, ".obj") + "-model";
    for (const dest of [
      join(root, "src", "server", "public", "assets"),
      join(root, "dist", "server", "public", "assets"),
    ]) {
      copyFileSync(join(modelRoot, name), join(dest, twin));
    }
    console.log(`[build] wrote package-safe twin ${name} -> ${twin} (electron-builder drops *.obj)`);
  }
}
