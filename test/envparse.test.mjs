import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../src/envparse.mjs";

test("parseEnv handles export, quotes, comments, blanks", () => {
  const out = parseEnv(
    [
      "# comment",
      "",
      "FOO=bar",
      'export QUOTED="hello world"',
      "SINGLE='abc'",
      "  SPACED = value ",
      "NOEQ line",
      "EMPTY=",
    ].join("\n"),
  );
  const map = Object.fromEntries(out.map((e) => [e.key, e.value]));
  assert.equal(map.FOO, "bar");
  assert.equal(map.QUOTED, "hello world");
  assert.equal(map.SINGLE, "abc");
  assert.equal(map.SPACED, "value");
  assert.equal(map.EMPTY, "");
  assert.equal("NOEQ" in map, false);
  assert.equal(out.length, 5);
});
