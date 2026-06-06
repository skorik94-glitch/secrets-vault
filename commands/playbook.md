---
description: Show (and offer to update) the runbook for a service — how to work with it
argument-hint: "<service> (e.g. supabase, apple, github)"
---

Show the runbook for the service: **$ARGUMENTS**.

1. Call `get_service_playbook` with that service (if none given, call `list_services`
   and ask which one).
2. Present its how-to notes, dashboard URL, project refs, and the credential NAMES
   it has (never values).
3. If the runbook is thin or you learn something new while helping, offer to record
   it with `set_service_note` (instructions only — never secret values).
