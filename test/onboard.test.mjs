import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildPlan, toPublicPlan } from "../src/onboard.mjs";

const W = (p, c) => fs.writeFile(p, c);
const find = (secrets, name) => secrets.find((s) => s.secretName === name);

test("buildPlan: layout, dedup, naming, value-free public plan", async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-ob-")));
  try {
    await fs.mkdir(path.join(tmp, "app1"));
    await fs.mkdir(path.join(tmp, "app2"));
    await fs.mkdir(path.join(tmp, ".ssh"));
    await fs.mkdir(path.join(tmp, "srcproj"));
    await W(path.join(tmp, "app1", ".env"), "SUPABASE_KEY=eyJshared_value_123\nSUPABASE_URL=https://app1.co\n");
    await W(path.join(tmp, "app2", ".env"), "SUPABASE_KEY=eyJshared_value_123\nAPP2_ONLY=zzz_secret_value\n");
    await W(path.join(tmp, ".ssh", "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----\nGLOBAL\n-----END OPENSSH PRIVATE KEY-----\n");
    await W(path.join(tmp, "srcproj", "app.ts"), 'const t = "ghp_xxx";');

    const report = {
      files: [
        { path: path.join(tmp, "app1", ".env"), project: path.join(tmp, "app1"), types: ["env"], services: ["generic"], detections: [{ via: "name", ruleId: "dotenv" }] },
        { path: path.join(tmp, "app2", ".env"), project: path.join(tmp, "app2"), types: ["env"], services: ["generic"], detections: [{ via: "name", ruleId: "dotenv" }] },
        { path: path.join(tmp, ".ssh", "id_rsa"), project: null, types: ["ssh_key"], services: ["ssh"], detections: [{ via: "name", ruleId: "ssh-private-key" }] },
        { path: path.join(tmp, "srcproj", "app.ts"), project: path.join(tmp, "srcproj"), types: ["api_key"], services: ["github"], detections: [{ via: "content", ruleId: "github-token" }] },
      ],
    };

    const plan = await buildPlan(report, { env: "dev" });

    assert.equal(plan.stats.total, 4);
    assert.equal(plan.stats.shared, 2);
    assert.equal(plan.stats.app, 2);
    assert.equal(plan.stats.dedupedDuplicates, 1);
    assert.equal(plan.stats.manual, 1);

    // shared, deduped credential
    const sb = find(plan.secrets, "SUPABASE_KEY");
    assert.equal(sb.action, "shared");
    assert.equal(sb.targetPath, "/shared/supabase");
    assert.deepEqual(sb.usedBy.sort(), ["app1", "app2"]);

    // app-specific
    assert.equal(find(plan.secrets, "SUPABASE_URL").targetPath, "/apps/app1");
    assert.equal(find(plan.secrets, "APP2_ONLY").targetPath, "/apps/app2");

    // whole-file global key
    const ssh = find(plan.secrets, "SSH_PRIVATE_KEY_ID_RSA");
    assert.equal(ssh.targetPath, "/shared/ssh");
    assert.equal(ssh.multiline, true);
    assert.deepEqual(ssh.usedBy, ["(global)"]);

    // content-only -> manual
    assert.equal(plan.manual.length, 1);
    assert.ok(plan.manual[0].path.endsWith("/app.ts"));

    // values present internally, stripped in public plan
    assert.ok(typeof sb.value === "string" && sb.value.length > 0);
    const pub = toPublicPlan(plan);
    for (const s of pub.secrets) {
      assert.equal(s.value, undefined, "public plan must not contain values");
      assert.ok(s.valueLength > 0);
      assert.ok(s.fingerprint);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
