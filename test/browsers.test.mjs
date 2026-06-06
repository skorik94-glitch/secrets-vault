import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  chromeTime,
  firefoxTime,
  safariTime,
  readHistoryDb,
  discoverHistoryDbs,
} from "../src/browsers.mjs";
import { aggregateServices } from "../src/services.mjs";

const hasSqlite = () => spawnSync("sqlite3", ["--version"]).status === 0;
const JAN_2021_MS = 1609459200000; // 2021-01-01T00:00:00Z

test("timestamp conversions", () => {
  // chrome: microseconds since 1601
  assert.equal(chromeTime((JAN_2021_MS + 11644473600000) * 1000), JAN_2021_MS);
  // firefox: microseconds since 1970
  assert.equal(firefoxTime(JAN_2021_MS * 1000), JAN_2021_MS);
  // safari: CFAbsoluteTime seconds since 2001; 0 -> 2001-01-01
  assert.equal(safariTime(0), 978307200000);
});

test("discoverHistoryDbs returns an array (no throw)", () => {
  assert.ok(Array.isArray(discoverHistoryDbs()));
});

test("readHistoryDb parses a chromium-schema db", { skip: !hasSqlite() }, async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-bt-")));
  try {
    const db = path.join(dir, "History");
    const chromeTs = (JAN_2021_MS + 11644473600000) * 1000;
    const sql =
      "CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INT, last_visit_time INT);" +
      `INSERT INTO urls(url,title,visit_count,last_visit_time) VALUES ('https://app.supabase.com/p','SB',5,${chromeTs});` +
      "INSERT INTO urls(url,title,visit_count,last_visit_time) VALUES ('https://news.example.com','N',9,0);";
    const r = spawnSync("sqlite3", [db, sql]);
    assert.equal(r.status, 0, "sqlite3 setup failed");

    const res = await readHistoryDb({ kind: "chromium", db, browser: "TestBrowser", profile: "Default" });
    assert.equal(res.error, undefined);
    assert.equal(res.visits.length, 2);

    const sb = res.visits.find((v) => v.url.includes("supabase"));
    assert.equal(sb.visitCount, 5);
    assert.equal(sb.lastVisit, JAN_2021_MS);
    assert.equal(sb.browser, "TestBrowser");

    const agg = aggregateServices(res.visits);
    assert.equal(agg.find((s) => s.service === "supabase").visits, 5);
    assert.equal(agg.find((s) => s.service === "example"), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
