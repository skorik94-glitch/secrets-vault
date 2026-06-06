import { test } from "node:test";
import assert from "node:assert/strict";
import { infisicalVault } from "../src/vault.mjs";

function mockClient() {
  return {
    listFolders: async (p) => (p === "/shared" ? [{ name: "supabase" }, { name: "google" }] : []),
    listSecrets: async (p) => {
      assert.equal(p, "/shared/supabase");
      return [
        { secretKey: "SUPABASE_URL", secretValue: "https://x.supabase.co", type: "shared" },
        { secretKey: "SUPABASE_SERVICE_KEY", secretValue: "SUPER_SECRET", type: "shared" },
      ];
    },
    getSecret: async (name, p) => {
      assert.equal(name, "SUPABASE_SERVICE_KEY");
      assert.equal(p, "/shared/supabase");
      return "SUPER_SECRET";
    },
  };
}

test("infisicalVault.services lists shared folders", async () => {
  const v = infisicalVault({ client: mockClient(), scan: {} });
  assert.deepEqual(await v.services(), ["google", "supabase"]);
});

test("infisicalVault.credentials returns metadata WITHOUT values", async () => {
  const v = infisicalVault({ client: mockClient(), scan: {} });
  const creds = await v.credentials("supabase");
  const json = JSON.stringify(creds);
  assert.equal(json.includes("SUPER_SECRET"), false, "secret value leaked");
  assert.equal(/"secretValue"|"value"/.test(json), false);
  assert.deepEqual(creds.map((c) => c.name).sort(), ["SUPABASE_SERVICE_KEY", "SUPABASE_URL"]);
  assert.ok(creds.every((c) => c.path === "/shared/supabase"));
});

test("infisicalVault.reveal returns the value (needs key)", async () => {
  const v = infisicalVault({ client: mockClient(), scan: {} });
  assert.equal(await v.reveal({ path: "/shared/supabase", key: "SUPABASE_SERVICE_KEY" }), "SUPER_SECRET");
  await assert.rejects(() => v.reveal({ path: "/shared/supabase" }), /needs a key/);
});
