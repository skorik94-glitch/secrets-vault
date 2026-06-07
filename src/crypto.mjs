// Zero-dependency crypto for the E2EE vault (node:crypto only).
// - AES-256-GCM authenticated encryption for the vault blob
// - scrypt passphrase KDF (for at-rest device-key protection)
// - X25519 ECDH + HKDF key-wrapping to share the vault key (VEK) per device
//
// The sync channel/server only ever sees ciphertext (zero-knowledge).

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  diffieHellman,
  hkdfSync,
} from "node:crypto";

const b64 = (b) => Buffer.from(b).toString("base64");
const ub64 = (s) => Buffer.from(s, "base64");

export function randomKey(bytes = 32) {
  return randomBytes(bytes);
}

/** AES-256-GCM encrypt. `data` is a Buffer or string; `key` is 32 bytes. */
export function encrypt(data, key) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(Buffer.isBuffer(data) ? data : Buffer.from(data)), c.final()]);
  return { v: 1, alg: "A256GCM", iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}

/** AES-256-GCM decrypt. Throws on wrong key or tampering. Returns a Buffer. */
export function decrypt(blob, key) {
  const d = createDecipheriv("aes-256-gcm", key, ub64(blob.iv));
  d.setAuthTag(ub64(blob.tag));
  return Buffer.concat([d.update(ub64(blob.ct)), d.final()]);
}

/** Derive a 32-byte key from a passphrase. Returns {key, salt(base64)}. */
export function deriveKey(passphrase, salt) {
  const s = salt ? ub64(salt) : randomBytes(16);
  const key = scryptSync(passphrase, s, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  return { key, salt: b64(s) };
}

/** Generate an X25519 device keypair (PEM strings). */
export function generateDevice() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function kekFromShared(shared, salt) {
  return Buffer.from(hkdfSync("sha256", shared, salt, Buffer.from("hush-kek/v1"), 32));
}

/** Wrap (encrypt) a VEK to a recipient's public key. */
export function wrapKey(vek, recipientPublicKeyPem) {
  const eph = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey(recipientPublicKeyPem) });
  const salt = randomBytes(16);
  const kek = kekFromShared(shared, salt);
  return {
    ephPublicKey: eph.publicKey.export({ type: "spki", format: "pem" }),
    salt: b64(salt),
    ...encrypt(vek, kek),
  };
}

/** Unwrap a VEK using the recipient's private key. Throws if not the intended recipient. */
export function unwrapKey(wrapped, recipientPrivateKeyPem) {
  const shared = diffieHellman({
    privateKey: createPrivateKey(recipientPrivateKeyPem),
    publicKey: createPublicKey(wrapped.ephPublicKey),
  });
  const kek = kekFromShared(shared, ub64(wrapped.salt));
  return decrypt(wrapped, kek);
}
