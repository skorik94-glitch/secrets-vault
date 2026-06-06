import { test } from "node:test";
import assert from "node:assert/strict";
import { consentDecision } from "../src/consent.mjs";

test("consentDecision: explicit --yes or env proceeds", () => {
  assert.equal(consentDecision({ yes: true, isTTY: false, envYes: false }), "proceed");
  assert.equal(consentDecision({ yes: false, isTTY: false, envYes: true }), "proceed");
});

test("consentDecision: interactive prompts, non-interactive refuses", () => {
  assert.equal(consentDecision({ yes: false, isTTY: true, envYes: false }), "prompt");
  assert.equal(consentDecision({ yes: false, isTTY: false, envYes: false }), "refuse");
});
