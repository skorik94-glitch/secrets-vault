#!/usr/bin/env node
// hush sync — E2EE cross-device vault. The remote (a file you sync via
// iCloud/Dropbox/git) only ever holds ciphertext. Private keys never leave the
// device; unlocking is gated by biometric approval.

import fs from "node:fs";
import path from "node:path";
import { getOrCreateDevice, loadDevice, unlockPrivateKey, vaultHome } from "./keystore.mjs";
import { initVault, unlock, authorizeDevice, updateSecrets, status } from "./sync.mjs";
import { requireApproval } from "./biometric.mjs";

const HELP = `hush sync — E2EE cross-device vault

Usage:
  hush sync <command> [options]

Commands:
  init --secrets <file.json>   Create the encrypted vault from a secrets JSON (this device)
  device                       Print THIS device's id + public key (share to enroll it elsewhere)
  authorize --pubkey <file>    Authorize another device (its 'device' JSON) to unlock the vault
  unlock [--out <file>]        Decrypt the vault (biometric-gated); write secrets JSON or list keys
  update --secrets <file.json> Replace the encrypted secrets (same vault key)
  status                       Show authorized devices + last update (no secret values)

Options:
  --remote <path>   Encrypted vault file (or SECRETS_VAULT_SYNC_PATH; default: ~/.hush/vault.enc.json)
  --label <name>    Device label (for init)

Env: SECRETS_VAULT_PASSPHRASE (protects this device's private key at rest).`;

const now = () => new Date().toISOString();

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--secrets") o.secrets = argv[++i];
    else if (a === "--remote") o.remote = argv[++i];
    else if (a === "--pubkey") o.pubkey = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--label") o.label = argv[++i];
    else if (a === "-h" || a === "--help") o.help = true;
    else o._.push(a);
  }
  return o;
}

const remotePath = (o) => o.remote || process.env.SECRETS_VAULT_SYNC_PATH || path.join(vaultHome(), "vault.enc.json");
const readRemote = (o) => {
  const p = remotePath(o);
  if (!fs.existsSync(p)) throw new Error(`no vault at ${p} — run 'sync init' first (or set --remote)`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
};
const writeRemote = (o, payload) => {
  const p = remotePath(o);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return p;
};
const passphrase = () => process.env.SECRETS_VAULT_PASSPHRASE;

async function openWithDevice(o, reason) {
  const rec = loadDevice();
  const approved = await requireApproval(reason, {});
  if (!approved) throw new Error("biometric approval failed/unavailable — aborting");
  const priv = unlockPrivateKey(rec, passphrase());
  const payload = readRemote(o);
  return { rec, priv, payload, ...unlock(payload, rec.id, priv) };
}

async function main() {
  const o = parse(process.argv.slice(2));
  const cmd = o._[0];
  if (!cmd || o.help) return void process.stdout.write(HELP + "\n");

  if (cmd === "device") {
    const rec = getOrCreateDevice({ label: o.label, passphrase: passphrase() });
    process.stdout.write(JSON.stringify({ id: rec.id, label: rec.label, publicKey: rec.publicKey }, null, 2) + "\n");
    return;
  }

  if (cmd === "init") {
    if (!o.secrets) throw new Error("init needs --secrets <file.json>");
    const rec = getOrCreateDevice({ label: o.label, passphrase: passphrase() });
    const secrets = JSON.parse(fs.readFileSync(o.secrets, "utf8"));
    const payload = initVault(secrets, { id: rec.id, label: rec.label, publicKey: rec.publicKey }, { now: now() });
    const p = writeRemote(o, payload);
    process.stdout.write(`Encrypted vault created at ${p}\nThis device: ${rec.id} (${rec.label})\n`);
    return;
  }

  if (cmd === "status") {
    process.stdout.write(JSON.stringify(status(readRemote(o)), null, 2) + "\n");
    return;
  }

  if (cmd === "unlock") {
    const { secrets } = await openWithDevice(o, "Unlock the E2EE vault on this device");
    if (o.out) {
      fs.writeFileSync(o.out, JSON.stringify(secrets, null, 2), { mode: 0o600 });
      process.stdout.write(`Decrypted ${Object.keys(secrets).length} secret(s) -> ${o.out} (0600)\n`);
    } else {
      process.stdout.write(`Unlocked. Keys: ${Object.keys(secrets).join(", ")}\n`);
    }
    return;
  }

  if (cmd === "update") {
    if (!o.secrets) throw new Error("update needs --secrets <file.json>");
    const { payload, vek } = await openWithDevice(o, "Update the E2EE vault");
    const secrets = JSON.parse(fs.readFileSync(o.secrets, "utf8"));
    updateSecrets(payload, secrets, vek, { now: now() });
    writeRemote(o, payload);
    process.stdout.write(`Vault updated (${Object.keys(secrets).length} secrets).\n`);
    return;
  }

  if (cmd === "authorize") {
    if (!o.pubkey) throw new Error("authorize needs --pubkey <file> (the other device's `sync device` output)");
    const { payload, vek } = await openWithDevice(o, "Authorize another device to access the vault");
    const newDev = JSON.parse(fs.readFileSync(o.pubkey, "utf8"));
    authorizeDevice(payload, { id: newDev.id, label: newDev.label, publicKey: newDev.publicKey }, vek, { now: now() });
    writeRemote(o, payload);
    process.stdout.write(`Authorized device ${newDev.id} (${newDev.label}).\n`);
    return;
  }

  throw new Error(`unknown sync command: ${cmd}`);
}

main().catch((err) => {
  process.stderr.write(err?.expected ? `\n${err.message}\n` : `fatal: ${err?.message || err}\n`);
  process.exit(1);
});
