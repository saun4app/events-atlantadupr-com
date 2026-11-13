---
name: Playwright Firefox in Nix
description: Local Playwright Firefox setup is limited by the Nix workspace's missing Ubuntu runtime libraries.
---

Firefox can be downloaded successfully in this Nix workspace, but Playwright cannot launch it because required Ubuntu runtime libraries are unavailable. Project discovery with `playwright test --list` works; browser execution should be verified in CI, where `playwright install --with-deps firefox` installs the required dependencies.

**Why:** The local browser-install command warned that libraries were missing, and a full Firefox test run failed at browser startup before any tests could execute.

**How to apply:** Avoid spending time retrying local Firefox runs unless the runtime dependencies have changed; use the isolated Firefox CI job as the executable browser check.
