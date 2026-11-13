---
name: Fixed-partner schema validation
description: Compatibility and diagnostics guidance for validating the declarative fixed-partner configuration
---

The fixed-partner document should be checked with a JSON Schema 2020-12 validator using all-errors output. The current schema’s conditional fragments intentionally omit repeated `type` declarations, so Ajv’s `strictTypes` warnings must be disabled while normal validation remains enabled.

**Why:** Strict mode reports noisy schema warnings for valid conditional fragments, obscuring the actionable document-validation result.

**How to apply:** Keep validation errors formatted with the document instance path, schema path, keyword, and parameters so a future config edit points directly to the failing rule.