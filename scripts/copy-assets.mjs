// tsc only emits .js for .ts inputs, so the dashboard and ride view under
// src/server/public are not part of the build output. Without this step
// `npm run build && npm start` serves 500 for / and /ride and 404 for every
// script, because http.ts resolves them relative to dist/server/.
import { cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
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
