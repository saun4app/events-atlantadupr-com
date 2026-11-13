---
name: Rotating verification boundaries
description: How rotating-partner verification policy stays separate from fixed-partner behavior
---

Verification helpers should accept an optional policy override rather than importing rotating configuration as their global default. Rotating routes pass their declared TTL, cooldown, attempt cap, and code format; fixed-partner routes omit the override and keep their own defaults.

**Why:** The two event formats intentionally remain independent, and a rotating configuration edit must not silently change fixed-partner signup or cancellation behavior.

**How to apply:** Keep format-specific policy selection at the route boundary. Shared verification primitives may support validated overrides, but their default behavior must remain format-neutral.