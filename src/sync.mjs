// E2EE vault sync model (pure). Operates on a payload object whose `vault` is
// AES-GCM ciphertext and whose `devices[]` each hold the VEK wrapped to their
// public key. The sync channel only ever stores this payload — never plaintext.
//
// device object: { id, label, publicKey, privateKey? }

import { randomKey, encrypt, decrypt, wrapKey, unwrapKey } from "./crypto.mjs";

const enc = (secrets, vek) => encrypt(Buffer.from(JSON.stringify(secrets)), vek);

/** Create a new encrypted vault, authorized for one device. */
export function initVault(secrets, device, { now }) {
  const vek = randomKey(32);
  return {
    version: 1,
    updatedAt: now,
    vault: enc(secrets, vek),
    devices: [
      { id: device.id, label: device.label, publicKey: device.publicKey, wrapped: wrapKey(vek, device.publicKey) },
    ],
  };
}

/** Decrypt the vault on a device. Returns { vek, secrets }. */
export function unlock(payload, deviceId, devicePrivateKeyPem) {
  const entry = payload.devices.find((d) => d.id === deviceId);
  if (!entry) throw new Error("this device is not authorized for the vault");
  const vek = unwrapKey(entry.wrapped, devicePrivateKeyPem);
  const secrets = JSON.parse(decrypt(payload.vault, vek).toString("utf8"));
  return { vek, secrets };
}

/** Authorize a new device by wrapping the VEK to its public key (caller must hold VEK). */
export function authorizeDevice(payload, newDevice, vek, { now }) {
  if (payload.devices.some((d) => d.id === newDevice.id)) throw new Error("device already authorized");
  payload.devices.push({
    id: newDevice.id,
    label: newDevice.label,
    publicKey: newDevice.publicKey,
    wrapped: wrapKey(vek, newDevice.publicKey),
  });
  payload.updatedAt = now;
  return payload;
}

/** Replace the encrypted secrets (same VEK). */
export function updateSecrets(payload, secrets, vek, { now }) {
  payload.vault = enc(secrets, vek);
  payload.updatedAt = now;
  return payload;
}

/** Revoke a device: remove it AND rotate the VEK, re-wrapping to the rest. */
export function revokeDevice(payload, deviceId, secrets, { now }) {
  const remaining = payload.devices.filter((d) => d.id !== deviceId);
  if (remaining.length === payload.devices.length) throw new Error("device not found");
  if (remaining.length === 0) throw new Error("cannot revoke the last device");
  const vek = randomKey(32); // rotate so the revoked device's old wrapped key is useless
  return {
    version: 1,
    updatedAt: now,
    vault: enc(secrets, vek),
    devices: remaining.map((d) => ({
      id: d.id,
      label: d.label,
      publicKey: d.publicKey,
      wrapped: wrapKey(vek, d.publicKey),
    })),
  };
}

/** Public, value-free view of who can access the vault. */
export function status(payload) {
  return {
    updatedAt: payload.updatedAt,
    devices: payload.devices.map((d) => ({ id: d.id, label: d.label })),
  };
}
