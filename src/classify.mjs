// Per-file classification: apply filename rules and (optionally) content rules.
// No directory walking here — operates on a single file's metadata + bytes.

import { createHash } from "node:crypto";
import path from "node:path";
import { NAME_RULES, CONTENT_RULES, maxSeverity } from "./patterns.mjs";

const MAX_MATCHES_PER_RULE = 5;

/** Short, non-reversible fingerprint of a secret value for dedup across files. */
export function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Build the classification context for a path relative to a scan root. */
export function buildContext(fullPath, root) {
  const base = path.basename(fullPath);
  const ext = path.extname(base).slice(1).toLowerCase();
  return {
    base,
    lower: base.toLowerCase(),
    ext,
    dir: path.dirname(fullPath),
    full: fullPath,
    rel: root ? path.relative(root, fullPath) : fullPath,
  };
}

/** Apply filename/path rules. Returns an array of detection objects. */
export function classifyByName(ctx) {
  const out = [];
  for (const rule of NAME_RULES) {
    let hit = false;
    try {
      hit = rule.match(ctx);
    } catch {
      hit = false;
    }
    if (hit) {
      out.push({
        ruleId: rule.id,
        label: rule.label,
        type: rule.type,
        service: rule.service,
        severity: rule.severity,
        via: "name",
      });
    }
  }
  return out;
}

/** Heuristic: does this buffer look like binary (and so skip content rules)? */
export function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Apply content rules to text. Returns detection objects with line + fingerprint.
 * `text` should already be truncated to the read cap by the caller.
 */
export function classifyByContent(text) {
  const out = [];
  for (const rule of CONTENT_RULES) {
    let count = 0;
    for (const m of text.matchAll(rule.re)) {
      const value = m[1] ?? m[0];
      out.push({
        ruleId: rule.id,
        label: rule.label,
        type: rule.type,
        service: rule.service,
        severity: rule.severity,
        via: "content",
        line: lineNumberAt(text, m.index ?? 0),
        fingerprint: fingerprint(value),
      });
      if (++count >= MAX_MATCHES_PER_RULE) break;
    }
  }
  return out;
}

/** Reduce a detection list to the single highest severity present. */
export function topSeverity(detections) {
  return detections.reduce((acc, d) => maxSeverity(acc, d.severity), null);
}
