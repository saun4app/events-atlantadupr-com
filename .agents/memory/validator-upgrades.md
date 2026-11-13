---
name: Validator and code-generator upgrades
description: Avoiding stale composite declarations and incorrect React Query generation after dependency upgrades
---

After a major validator upgrade, force one full TypeScript project-reference rebuild before interpreting errors in downstream applications.

**Why:** Incremental compilation retained old validator declaration types after a catalog dependency changed major versions. This made role configuration types appear as `any` in consumers even though the source schema remained correct.

**How to apply:** Rebuild composite libraries with `tsc --build --force` after such dependency changes, then use the canonical workspace typecheck. Do not patch downstream callback types to hide stale declarations.

Code generators may not infer the installed React Query major when dependencies are declared through the workspace catalog.

**Why:** Upgrading the generator defaulted to an older Query API despite the application using a newer major.

**How to apply:** Keep the generator's Query version explicit and aligned with the application, and regenerate rather than hand-editing its outputs.
