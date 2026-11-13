---
name: Intentional API generation diffs
description: How the generated-client validation behaves when an API contract is intentionally changed
---

The generated-client guard treats any working-tree diff under the generated API directories as drift, even when the diff was produced by the intended OpenAPI change and codegen completed successfully.

**Why:** The guard compares generated output with the current git baseline rather than with a clean regeneration of the edited contract, so feature work that changes the API schema is expected to report this until the generated files are merged.

**How to apply:** Still run codegen and typecheck; report this specific guard result as an expected validation limitation rather than hand-editing or reverting generated artifacts.