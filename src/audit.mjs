// Append-only audit log for sensitive operations (reveal/materialize/provision).
// One JSON object per line, mode 0600. Lives outside the model's normal reach
// (it can read via the audit_log tool, but entries are append-only on disk).

import fs from "node:fs/promises";
import path from "node:path";

export function auditLogger(filePath) {
  return {
    async record(entry) {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, line, { mode: 0o600 });
    },
    async read(limit = 100) {
      try {
        const txt = await fs.readFile(filePath, "utf8");
        return txt
          .split("\n")
          .filter(Boolean)
          .slice(-limit)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return { raw: l };
            }
          });
      } catch {
        return [];
      }
    },
  };
}
