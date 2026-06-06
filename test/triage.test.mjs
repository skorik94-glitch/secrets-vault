import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTriage } from "../src/triage.mjs";

test("buildTriage buckets leaks by priority; git wins over perms", () => {
  const report = {
    leaks: [
      { path: "/a", severity: "critical", flags: ["committed-to-git"], types: ["env"] },
      { path: "/b", severity: "critical", flags: ["group-or-world-readable"], types: ["ssh_key"] },
      { path: "/c", severity: "high", flags: ["group-or-world-readable"], types: ["config"] }, // not perm-fixable
      { path: "/d", severity: "medium", flags: ["untracked-not-gitignored"], types: ["env"] },
      { path: "/e", severity: "critical", flags: ["committed-to-git", "group-or-world-readable"], types: ["env"] },
    ],
  };
  const t = buildTriage(report);
  assert.equal(t.stats.p1, 2); // /a, /e
  assert.equal(t.stats.p2, 2); // /b, /c (NOT /e — git takes priority)
  assert.equal(t.stats.p3, 1); // /d
  assert.equal(t.stats.fixablePerms, 1); // /b only (ssh_key); /c config is not fixable
  assert.ok(t.fixablePerms[0].path === "/b");
});

test("buildTriage handles empty", () => {
  const t = buildTriage({ leaks: [] });
  assert.deepEqual(t.stats, { p1: 0, p2: 0, p3: 0, fixablePerms: 0 });
});
