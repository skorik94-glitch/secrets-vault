import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDevice } from "../src/crypto.mjs";
import { initVault, unlock, authorizeDevice, updateSecrets, revokeDevice, status } from "../src/sync.mjs";

const NOW = "2026-06-06T00:00:00.000Z";
const dev = (id, label) => ({ id, label, ...generateDevice() });

test("E2EE: server sees only ciphertext; cross-device unlock works", () => {
  const SECRET = "SUPERSECRET_VALUE_XYZ";
  const a = dev("A", "macbook");
  const payload = initVault({ TOKEN: SECRET }, a, { now: NOW });

  // zero-knowledge: the full payload must not contain the plaintext
  assert.equal(JSON.stringify(payload).includes(SECRET), false);

  // device A unlocks
  const opened = unlock(payload, "A", a.privateKey);
  assert.deepEqual(opened.secrets, { TOKEN: SECRET });

  // enroll device B (A holds the VEK), B can now unlock the same vault
  const b = dev("B", "iphone");
  authorizeDevice(payload, { id: b.id, label: b.label, publicKey: b.publicKey }, opened.vek, { now: NOW });
  assert.deepEqual(unlock(payload, "B", b.privateKey).secrets, { TOKEN: SECRET });

  // an unenrolled device cannot
  const c = dev("C", "rogue");
  assert.throws(() => unlock(payload, "C", c.privateKey), /not authorized/);
});

test("update secrets keeps the same VEK; status is value-free", () => {
  const a = dev("A", "mac");
  const payload = initVault({ A: "1" }, a, { now: NOW });
  const { vek } = unlock(payload, "A", a.privateKey);
  updateSecrets(payload, { A: "1", B: "2" }, vek, { now: NOW });
  assert.deepEqual(unlock(payload, "A", a.privateKey).secrets, { A: "1", B: "2" });

  const s = status(payload);
  assert.deepEqual(s.devices, [{ id: "A", label: "mac" }]);
  assert.equal(JSON.stringify(s).includes("1"), false);
});

test("revoke rotates the VEK so the removed device is locked out", () => {
  const a = dev("A", "mac");
  const b = dev("B", "phone");
  let payload = initVault({ K: "v" }, a, { now: NOW });
  const { vek } = unlock(payload, "A", a.privateKey);
  authorizeDevice(payload, { id: b.id, label: b.label, publicKey: b.publicKey }, vek, { now: NOW });

  payload = revokeDevice(payload, "B", { K: "v" }, { now: NOW });
  assert.deepEqual(unlock(payload, "A", a.privateKey).secrets, { K: "v" }); // A still works
  assert.throws(() => unlock(payload, "B", b.privateKey), /not authorized/); // B removed
});
