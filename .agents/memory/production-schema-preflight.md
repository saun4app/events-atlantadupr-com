---
name: Production schema preflight
description: Release-time users-table verification must be read-only and must surface legacy rename ambiguity
---

The users-table preflight is a read-only release gate: it compares the expected
`app_users` shape, reports the preserved row count, and treats a coexisting or
legacy-only `app_uses` table as a rename-versus-destructive-create warning.

**Why:** The users-table rename was a data-preservation risk; schema reconciliation
must expose ambiguity before a publish rather than silently creating a replacement
table.

**How to apply:** Keep production preflight checks inside a PostgreSQL
`READ ONLY` transaction and fail release-check mode on schema mismatches or
unreviewed rename-risk warnings. Never add repair writes to the audit.