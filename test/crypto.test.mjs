import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, deriveKey, randomKey, generateDevice, wrapKey, unwrapKey } from "../src/crypto.mjs";

test("AES-GCM roundtrip; wrong key and tampering throw", () => {
  const key = randomKey();
  const blob = encrypt("hello world", key);
  assert.equal(decrypt(blob, key).toString("utf8"), "hello world");

  assert.throws(() => decrypt(blob, randomKey()), /./); // wrong key
  const tampered = { ...blob, ct: Buffer.from("AAAA" + blob.ct.slice(4)).toString() };
  assert.throws(() => decrypt({ ...blob, tag: encrypt("x", key).tag }, key), /./); // wrong tag
  assert.throws(() => decrypt(tampered, key), /./); // tampered ciphertext
});

test("scrypt KDF is deterministic per salt", () => {
  const a = deriveKey("correct horse", "AAAAAAAAAAAAAAAAAAAAAA==");
  const b = deriveKey("correct horse", "AAAAAAAAAAAAAAAAAAAAAA==");
  const c = deriveKey("correct horse"); // random salt
  assert.deepEqual(a.key, b.key);
  assert.notDeepEqual(a.key, c.key);
});

test("X25519 key wrap: only the intended recipient can unwrap", () => {
  const alice = generateDevice();
  const bob = generateDevice();
  const vek = randomKey(32);

  const wrapped = wrapKey(vek, bob.publicKey);
  assert.deepEqual(unwrapKey(wrapped, bob.privateKey), vek);
  assert.throws(() => unwrapKey(wrapped, alice.privateKey), /./); // not the recipient
});
