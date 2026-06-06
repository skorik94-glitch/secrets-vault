// This device's identity keypair. The private key is stored encrypted at rest
// (scrypt + AES-GCM under a passphrase). On macOS you'd ideally back this with
// the Keychain/Secure Enclave; the file backend here keeps it portable + testable.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { generateDevice, deriveKey, encrypt, decrypt } from "./crypto.mjs";

export function vaultHome() {
  return process.env.SECRETS_VAULT_HOME || path.join(os.homedir(), ".secrets-vault");
}
const devicePath = () => path.join(vaultHome(), "device.json");

export const deviceExists = () => fs.existsSync(devicePath());

export function getOrCreateDevice({ label, passphrase }) {
  const p = devicePath();
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  if (!passphrase) throw new Error("passphrase required to create a device key (set SECRETS_VAULT_PASSPHRASE)");
  const kp = generateDevice();
  const id = createHash("sha256").update(kp.publicKey).digest("hex").slice(0, 12);
  const { key, salt } = deriveKey(passphrase);
  const rec = {
    id,
    label: label || os.hostname(),
    publicKey: kp.publicKey,
    privateKeyEnc: { salt, ...encrypt(kp.privateKey, key) },
  };
  fs.mkdirSync(vaultHome(), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(rec, null, 2), { mode: 0o600 });
  return rec;
}

export function loadDevice() {
  const p = devicePath();
  if (!fs.existsSync(p)) throw new Error("no device on this machine — run `secrets-vault sync init` first");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Decrypt this device's private key (PEM). Throws on wrong passphrase. */
export function unlockPrivateKey(rec, passphrase) {
  if (!passphrase) throw new Error("passphrase required (set SECRETS_VAULT_PASSPHRASE)");
  const { key } = deriveKey(passphrase, rec.privateKeyEnc.salt);
  try {
    return decrypt(rec.privateKeyEnc, key).toString("utf8");
  } catch {
    throw new Error("wrong passphrase");
  }
}
