import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherChecks, formatDoctor } from "../src/doctor.mjs";

test("gatherChecks returns checks; Node check reflects current runtime", () => {
  const checks = gatherChecks({});
  assert.ok(Array.isArray(checks) && checks.length >= 4);
  const node = checks.find((c) => c.name.startsWith("Node"));
  assert.equal(node.ok, parseInt(process.versions.node, 10) >= 20);
  // Infisical optional check is false with empty env
  assert.equal(checks.find((c) => c.name === "Infisical creds").ok, false);
});

test("formatDoctor reports READY vs NOT READY by required checks", () => {
  const ready = formatDoctor([
    { name: "Node >= 20", ok: true, required: true, detail: "" },
    { name: "git", ok: true, required: true, detail: "" },
    { name: "swift", ok: false, required: false, detail: "" },
  ]);
  assert.match(ready, /READY/);
  assert.doesNotMatch(ready, /NOT READY/);

  const notReady = formatDoctor([
    { name: "Node >= 20", ok: true, required: true, detail: "" },
    { name: "git", ok: false, required: true, detail: "" },
  ]);
  assert.match(notReady, /NOT READY/);
  assert.match(notReady, /git/);
});
