---
name: Orval integer Zod output
description: Orval's Zod generator preserves OpenAPI integer typing in TypeScript but emits zod.number() rather than zod.number().int()
---

OpenAPI `type: integer` fields generate TypeScript number declarations and `@minimum` comments, while the generated Zod schema uses
`zod.number()` for the integer type. Minimum and maximum constraints are emitted as Zod validators, but integer validation is not.

**Why:** This is an Orval generator behavior, so contract tests should assert the generated minimum/type behavior without expecting `.int()` unless the generator configuration or version changes.

**How to apply:** When adding numeric API constraints, update the OpenAPI source and regenerate both clients; do not hand-edit generated Zod output.