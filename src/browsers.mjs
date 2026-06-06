// Read-only browser history reader. Discovers history SQLite DBs across browsers
// and profiles, reads them via the macOS `sqlite3` CLI (no npm deps), and returns
// normalized visits. ONLY history (urls + counts + times) — never passwords,
// cookies, or any encrypted store.

import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const HOME = os.homedir();
const SUPPORT = path.join(HOME, "Library", "Application Support");

// Chromium-family install dirs (relative to Application Support).
const CHROMIUM = [
  ["Chrome", "Google/Chrome"],
  ["Chrome Beta", "Google/Chrome Beta"],
  ["Chrome Canary", "Google/Chrome Canary"],
  ["Chromium", "Chromium"],
  ["Brave", "BraveSoftware/Brave-Browser"],
  ["Edge", "Microsoft Edge"],
  ["Vivaldi", "Vivaldi"],
  ["Arc", "Arc"],
];

const isProfileDir = (name) =>
  name === "Default" || /^Profile \d+$/.test(name) || name === "Guest Profile";

/** Run a read-only query against a COPY of a sqlite db; returns parsed rows. */
function sqlite(dbCopy, sql) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn("sqlite3", ["-readonly", "-json", dbCopy, sql]);
    } catch {
      resolve({ ok: false, rows: [], error: "sqlite3-missing" });
      return;
    }
    let out = "";
    let err = "";
    p.on("error", () => resolve({ ok: false, rows: [], error: "sqlite3-missing" }));
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (code !== 0) return resolve({ ok: false, rows: [], error: err.trim() || `exit ${code}` });
      try {
        resolve({ ok: true, rows: JSON.parse(out || "[]") });
      } catch {
        resolve({ ok: false, rows: [], error: "parse-failed" });
      }
    });
  });
}

/** Copy a db (+ -wal/-shm) into a temp dir so we can read it while the browser holds a lock. */
async function withDbCopy(dbPath, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "si-hist-"));
  const copy = path.join(dir, "db.sqlite");
  try {
    await fs.copyFile(dbPath, copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) {
        await fs.copyFile(dbPath + suffix, copy + suffix);
      }
    }
    return await fn(copy);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---- timestamp conversions to epoch ms -----------------------------------
export const chromeTime = (us) => (us ? Math.round(us / 1000 - 11644473600000) : 0); // since 1601 (µs)
export const firefoxTime = (us) => (us ? Math.round(us / 1000) : 0); // since 1970 (µs)
export const safariTime = (s) => Math.round((s + 978307200) * 1000); // CFAbsoluteTime (s since 2001)

/** Find all history DBs on this machine. */
export function discoverHistoryDbs() {
  const found = [];

  for (const [label, rel] of CHROMIUM) {
    const base = path.join(SUPPORT, rel);
    if (!existsSync(base)) continue;
    const roots = [base, path.join(base, "User Data")].filter(existsSync);
    for (const root of roots) {
      let entries = [];
      try {
        entries = readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (!ent.isDirectory() || !isProfileDir(ent.name)) continue;
        const db = path.join(root, ent.name, "History");
        if (existsSync(db)) found.push({ browser: label, profile: ent.name, kind: "chromium", db });
      }
    }
  }

  const safari = path.join(HOME, "Library", "Safari", "History.db");
  if (existsSync(safari)) found.push({ browser: "Safari", profile: "default", kind: "safari", db: safari });

  const ffProfiles = path.join(SUPPORT, "Firefox", "Profiles");
  if (existsSync(ffProfiles)) {
    try {
      for (const name of readdirSync(ffProfiles)) {
        const db = path.join(ffProfiles, name, "places.sqlite");
        if (existsSync(db)) found.push({ browser: "Firefox", profile: name, kind: "firefox", db });
      }
    } catch {
      /* ignore */
    }
  }

  return found;
}

const QUERY = {
  chromium: "SELECT url, title, visit_count, last_visit_time AS t FROM urls WHERE visit_count > 0",
  firefox: "SELECT url, title, visit_count, last_visit_date AS t FROM moz_places WHERE visit_count > 0",
  safari:
    "SELECT hi.url AS url, hi.visit_count AS visit_count, MAX(hv.visit_time) AS t " +
    "FROM history_items hi LEFT JOIN history_visits hv ON hv.history_item = hi.id GROUP BY hi.id",
};

const toMs = { chromium: chromeTime, firefox: firefoxTime, safari: safariTime };

/** Read + normalize a single history DB source. */
export async function readHistoryDb(src) {
  try {
    const res = await withDbCopy(src.db, (copy) => sqlite(copy, QUERY[src.kind]));
    if (!res.ok) return { visits: [], rows: 0, error: res.error };
    const conv = toMs[src.kind];
    const visits = res.rows.map((r) => ({
      url: r.url,
      title: r.title || "",
      visitCount: r.visit_count || 0,
      lastVisit: conv(r.t),
      browser: src.browser,
    }));
    return { visits, rows: visits.length };
  } catch (e) {
    return { visits: [], rows: 0, error: e.code || e.message };
  }
}

/**
 * Read history from all discovered browsers.
 * @returns {Promise<{visits: Array, sources: Array, errors: Array}>}
 */
export async function readAllHistory() {
  const dbs = discoverHistoryDbs();
  const visits = [];
  const sources = [];
  const errors = [];

  for (const src of dbs) {
    const res = await readHistoryDb(src);
    if (res.error) {
      errors.push({ browser: src.browser, profile: src.profile, error: res.error });
      continue;
    }
    visits.push(...res.visits);
    sources.push({ browser: src.browser, profile: src.profile, rows: res.rows });
  }

  return { visits, sources, errors };
}
