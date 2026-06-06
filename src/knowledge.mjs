// Service knowledge / runbook store. Per-service and per-app instructions for
// "how to work with this service" — dashboard URLs, project refs, rotation steps,
// how-to notes. REFERENCE-ONLY: secret values are stripped on write; runbooks
// point at credentials by name, never hold the values.

import fs from "node:fs";
import path from "node:path";

const VALUE_KEYS = new Set([
  "value", "secretValue", "password", "passwd", "token", "apiKey", "api_key", "secret", "privateKey",
]);

function stripValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (VALUE_KEYS.has(k)) continue; // never persist secret values in a runbook
    out[k] = v;
  }
  return out;
}

export function knowledgeStore(filePath) {
  const read = () => {
    try {
      const d = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { services: d.services || {}, apps: d.apps || {} };
    } catch {
      return { services: {}, apps: {} };
    }
  };
  const write = (data) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  };

  return {
    getService(service) {
      return read().services[service] || null;
    },
    listServices() {
      return Object.keys(read().services);
    },
    setService(service, patch, now = new Date().toISOString()) {
      const d = read();
      d.services[service] = { ...(d.services[service] || { service }), ...stripValues(patch), service, updatedAt: now };
      write(d);
      return d.services[service];
    },
    getApp(app) {
      return read().apps[app] || null;
    },
    setApp(app, service, patch, now = new Date().toISOString()) {
      const d = read();
      d.apps[app] = d.apps[app] || {};
      d.apps[app][service] = { ...(d.apps[app][service] || {}), ...stripValues(patch), service, updatedAt: now };
      write(d);
      return d.apps[app][service];
    },
    all() {
      return read();
    },
  };
}
