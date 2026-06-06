# Security model

This tool inventories secrets and credentials across your machine. That makes
its own trustworthiness critical. Here is exactly what it does and does not do.

## What it reads
- Files under the roots you choose (default: your home directory), matching
  secret patterns (keys, `.env`, service-account JSON, etc.).
- Browser **history** databases (URLs, visit counts, timestamps), read-only,
  to discover which dev/SaaS services you use.

## What it NEVER reads (hard line)
- **No saved passwords** (e.g. Chrome `Login Data`), **no cookies**, no
  encrypted browser stores. Reading those would make this a credential stealer.
- It does not transmit anything over the network. There is no telemetry.

## Data handling
- **Secret values are never stored.** Reports record *where* a secret is and
  *what kind* it is — plus a non-reversible fingerprint (SHA-256, truncated)
  used only to detect the same credential reused across files.
- Output files are written with mode `0600` and are git-ignored.
- A generated report still maps where your secrets live — treat it as sensitive.

## Consent
- The tool refuses to read anything without explicit consent: it prompts when
  run interactively, and requires `--yes` (or `SECRETS_INVENTORY_YES=1`) when
  run non-interactively. Consent is per-run.

## Supply chain
- **Zero runtime dependencies** — only the Node.js standard library and the
  system `git` / `sqlite3` CLIs. There is no dependency tree to compromise.
- Releases should be published with provenance/signatures; verify before use.

## Threat model (why it is built this way)
An AI/automation agent is a "confused deputy": untrusted input (a malicious
README, package, or web page) can try to make it exfiltrate secrets. The
dangerous combination is *read-secret* + *network/exec* in one session. This
tool mitigates that by: never emitting secret values, keeping everything local,
and (in later stages) exposing only references with a biometric-gated reveal.

## Reporting a vulnerability
Please open a private security advisory on the GitHub repository, or contact the
maintainer directly. Do not file public issues for security reports.
