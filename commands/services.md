---
description: Overview of the services you use, where each credential lives, and any leaks
---

Give the user an overview of their secret/service surface using the secrets-vault
MCP tools. Do NOT reveal any secret values.

1. Call `list_services` for the services they have credentials for.
2. Call `list_credentials` (optionally per service) for where each lives (names/paths only).
3. Call `scan_for_leaks` and surface anything committed to git or world-readable.
4. Summarize concisely: services, notable gaps, and recommended fixes.

If there is no data yet, offer to run `scan` / `discover` first (with consent).
