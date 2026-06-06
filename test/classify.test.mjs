import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContext,
  classifyByName,
  classifyByContent,
  looksBinary,
  fingerprint,
} from "../src/classify.mjs";

const ids = (dets) => dets.map((d) => d.ruleId).sort();

test("name rules: ssh private key under ~/.ssh", () => {
  const ctx = buildContext("/Users/x/.ssh/id_ed25519", "/Users/x");
  const det = classifyByName(ctx);
  assert.ok(ids(det).includes("ssh-private-key"));
  assert.equal(det.find((d) => d.ruleId === "ssh-private-key").severity, "critical");
});

test("name rules: .pub key is NOT a private key", () => {
  const ctx = buildContext("/Users/x/.ssh/id_ed25519.pub", "/Users/x");
  assert.equal(ids(classifyByName(ctx)).includes("ssh-private-key"), false);
});

test("name rules: .env matches, .env.example excluded", () => {
  assert.ok(ids(classifyByName(buildContext("/p/.env", "/p"))).includes("dotenv"));
  assert.equal(ids(classifyByName(buildContext("/p/.env.example", "/p"))).includes("dotenv"), false);
  assert.equal(ids(classifyByName(buildContext("/p/.env.sample", "/p"))).includes("dotenv"), false);
});

test("name rules: apple .p8 and service account json", () => {
  assert.ok(ids(classifyByName(buildContext("/p/AuthKey_ABC.p8", "/p"))).includes("apple-auth-key"));
  const sa = classifyByName(buildContext("/p/my-serviceAccount.json", "/p"));
  assert.ok(ids(sa).includes("gcp-service-account"));
  assert.equal(sa.find((d) => d.ruleId === "gcp-service-account").severity, "critical");
});

test("name rules: aws credentials path", () => {
  assert.ok(ids(classifyByName(buildContext("/Users/x/.aws/credentials", "/Users/x"))).includes("aws-credentials"));
});

test("content rules: PEM private key header", () => {
  const det = classifyByContent("foo\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
  const pk = det.find((d) => d.ruleId === "private-key-header");
  assert.ok(pk);
  assert.equal(pk.severity, "critical");
  assert.equal(pk.line, 2);
  assert.ok(pk.fingerprint);
});

test("content rules: AWS / GitHub / JWT / generic", () => {
  const det = classifyByContent(
    [
      "AKIAIOSFODNN7EXAMPLE",
      "token = ghp_0123456789012345678901234567890123456",
      "jwt: eyJabcdef12.eyJpayload8.signature9",
      'api_key = "ABCDEF0123456789XYZ"',
    ].join("\n"),
  );
  const got = ids(det);
  assert.ok(got.includes("aws-access-key-id"));
  assert.ok(got.includes("github-token"));
  assert.ok(got.includes("jwt"));
  assert.ok(got.includes("generic-secret-assignment"));
});

test("looksBinary detects NUL bytes", () => {
  assert.equal(looksBinary(Buffer.from([1, 2, 0, 3])), true);
  assert.equal(looksBinary(Buffer.from("plain text")), false);
});

test("fingerprint is deterministic and non-empty", () => {
  assert.equal(fingerprint("abc"), fingerprint("abc"));
  assert.notEqual(fingerprint("abc"), fingerprint("abd"));
  assert.equal(fingerprint("abc").length, 12);
});
