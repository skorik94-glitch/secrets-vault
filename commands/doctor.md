---
description: Check secrets-vault prerequisites and report readiness
---

Run the secrets-vault preflight and report readiness.

Run `secrets-vault doctor` (or `node ${CLAUDE_PLUGIN_ROOT}/src/doctor.mjs`) and
summarize: which prerequisites are present (Node, git, sqlite3, swift/Touch ID,
Infisical creds) and concrete next steps for anything missing.
