// Self-signed TLS certificate for the local HTTPS server.
//
// WebXR only runs in a secure context (https, or localhost) — a headset on
// the LAN needs an https URL, and there's no CA around to hand it a
// properly-chained one, so this generates and caches a self-signed cert
// instead. The Quest browser will show a one-time "connection is not
// private" warning; per the secure-context spec, a page the user has
// manually trusted through that warning still counts as https for
// purposes like WebXR — this is standard practice for local WebXR dev. See
// the README for the (documented, not required) mkcert+ADB fallback if a
// specific browser build turns out to be stricter about this.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { generate } from "selfsigned";

export interface TlsMaterial {
  key: string;
  cert: string;
  /** SHA-1 fingerprint from `selfsigned`, for cert-pinning a trust check (e.g. Electron's certificate-error handler). Not needed just to serve HTTPS. */
  fingerprint?: string;
}

interface CachedMeta {
  hosts: string[];
  notAfter: string;
  fingerprint: string;
}

// ~10 years. Regeneration is driven by host coverage (a changed LAN IP) or
// approaching expiry, not by rotation, so in practice this rarely fires.
const VALIDITY_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function certPaths(dataDir: string) {
  return {
    key: join(dataDir, "cert-key.pem"),
    cert: join(dataDir, "cert.pem"),
    meta: join(dataDir, "cert-meta.json"),
  };
}

function readCached(dataDir: string): (TlsMaterial & CachedMeta) | null {
  const { key, cert, meta } = certPaths(dataDir);
  if (!existsSync(key) || !existsSync(cert) || !existsSync(meta)) return null;
  try {
    const metaJson = JSON.parse(readFileSync(meta, "utf-8")) as CachedMeta;
    return {
      key: readFileSync(key, "utf-8"),
      cert: readFileSync(cert, "utf-8"),
      ...metaJson,
    };
  } catch {
    return null;
  }
}

function coversHosts(meta: CachedMeta, hosts: string[]): boolean {
  // Regenerate a day before expiry rather than exactly at it.
  if (new Date(meta.notAfter).getTime() < Date.now() + 24 * 60 * 60 * 1000) return false;
  const have = new Set(meta.hosts);
  return hosts.every((h) => have.has(h));
}

const isIp = (h: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":");

/**
 * Returns a self-signed cert/key covering `hosts` (typically "localhost",
 * "127.0.0.1", and the current LAN IPs), generating and caching a new one
 * under `dataDir` only when none exists yet, the cached cert doesn't cover
 * every requested host (e.g. the LAN IP changed since last run), or it's
 * about to expire. Previously-covered hosts are kept on regeneration so a
 * cert doesn't lose SANs just because this run has a narrower host list.
 */
export async function getOrCreateCert(dataDir: string, hosts: string[]): Promise<TlsMaterial> {
  const cached = readCached(dataDir);
  if (cached && coversHosts(cached, hosts)) {
    return { key: cached.key, cert: cached.cert, fingerprint: cached.fingerprint };
  }

  const allHosts = Array.from(new Set([...(cached?.hosts ?? []), ...hosts]));
  const notAfterDate = new Date(Date.now() + VALIDITY_MS);
  const pems = await generate([{ name: "commonName", value: allHosts[0] ?? "localhost" }], {
    notAfterDate,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      {
        name: "subjectAltName",
        altNames: allHosts.map((h) =>
          isIp(h) ? { type: 7 as const, ip: h } : { type: 2 as const, value: h }
        ),
      },
    ],
  });

  mkdirSync(dataDir, { recursive: true });
  const { key, cert, meta } = certPaths(dataDir);
  writeFileSync(key, pems.private);
  writeFileSync(cert, pems.cert);
  const metaOut: CachedMeta = {
    hosts: allHosts,
    notAfter: notAfterDate.toISOString(),
    fingerprint: pems.fingerprint,
  };
  writeFileSync(meta, JSON.stringify(metaOut));

  return { key: pems.private, cert: pems.cert, fingerprint: pems.fingerprint };
}
