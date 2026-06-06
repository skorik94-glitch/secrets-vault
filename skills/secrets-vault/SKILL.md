---
name: secrets-vault
description: Use whenever a task touches an external service's access — credentials/secrets/SSH keys (Supabase, Apple, Google, GitHub, Stripe, AWS, …), accessing or rotating them, wiring a new project's access, or making changes in a third-party service console. Surfaces credential references and per-service runbooks via the secrets-vault MCP tools; reveals actual values only through a biometric gate.
---

# Working with the user's secrets & services

This plugin exposes a local, reference-only vault over MCP. Use it to work
smoothly with the user's external services without mishandling secrets.

## Core rule: reference-only
- Default to **metadata and references**, never secret values. Use
  `list_services`, `list_credentials`, `get_service_playbook`, `list_app_services`,
  `find_projects`, `describe_project`.
- To actually RUN something that needs a secret, prefer **injection** (e.g.
  `infisical run -- <cmd>`) over reading the value.
- Only call `reveal` / `materialize_file` when a value genuinely must be produced.
  These pop a **Touch ID** prompt and are audited — never try to bypass them, and
  never echo a revealed value into chat or files beyond what the user asked for.

## When the user asks for something that needs access
1. Identify the service(s). If unsure, `list_app_services` for the current project
   or `list_services` overall.
2. Read the runbook: `get_service_playbook(<service>)` — dashboard URL, project
   refs, rotation steps, how-to notes, and the credential NAMES that exist.
3. If the credential is missing locally: offer to run discovery/onboarding
   (`scan`, `discover`, `onboard`) — with the user's consent — rather than asking
   them to paste secrets into chat.
4. Do the work. For a console/3rd-party change, follow the playbook steps; use the
   terminal/CLI or the browser. For anything needing a secret value, inject it or
   `reveal` it (gated).

## Keep the knowledge growing
Whenever you learn how a service works for this user (a project ref, a deploy
command, a rotation procedure, a gotcha), record it with `set_service_note`
(per service, or per app). This is what makes future requests "just work".
`set_service_note` stores instructions only — it never stores secret values.

## Hygiene
- Run `scan_for_leaks` when relevant; flag secrets committed to git or world-readable.
- Use `audit_log` to show the history of sensitive operations.
- Never write secret values into a project's repo; provision with references
  (`provision`) and `infisical run`.
