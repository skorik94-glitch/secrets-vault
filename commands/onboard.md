---
description: Plan importing discovered secrets into the vault (Infisical), dry-run first
---

Help the user move scattered secrets into the vault. Never print secret values.

1. If there's no recent scan report, offer to run `secrets-vault scan --yes` (with consent).
2. Run a DRY-RUN plan: `secrets-vault onboard --from <latest report>` and walk through
   the proposed layout (`/shared/*` vs `/apps/*`) and dedup decisions.
3. Only on explicit confirmation, apply with `--apply --yes` (requires the
   `INFISICAL_*` machine-identity env vars to be set).
