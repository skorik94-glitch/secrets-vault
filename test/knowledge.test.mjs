import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { knowledgeStore } from "../src/knowledge.mjs";

test("knowledge store: per-service + per-app runbooks, values stripped", async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-kn-")));
  try {
    const k = knowledgeStore(path.join(tmp, "knowledge.json"));

    k.setService("supabase", {
      dashboardUrl: "https://app.supabase.com",
      projectRef: "abcdxyz",
      howTo: ["use `infisical run` to inject", "rotate service key in dashboard"],
      note: "prod project",
      value: "THIS_SHOULD_NOT_PERSIST", // must be stripped
      token: "ALSO_STRIPPED",
    });

    const svc = k.getService("supabase");
    assert.equal(svc.projectRef, "abcdxyz");
    assert.equal(svc.howTo.length, 2);
    assert.ok(svc.updatedAt);
    assert.equal("value" in svc, false, "secret value must not be stored in a runbook");
    assert.equal("token" in svc, false);

    const dump = JSON.stringify(k.all());
    assert.equal(dump.includes("THIS_SHOULD_NOT_PERSIST"), false);
    assert.equal(dump.includes("ALSO_STRIPPED"), false);

    k.setApp("myapp", "supabase", { projectRef: "myapp-ref", note: "staging" });
    assert.equal(k.getApp("myapp").supabase.projectRef, "myapp-ref");

    assert.deepEqual(k.listServices(), ["supabase"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
