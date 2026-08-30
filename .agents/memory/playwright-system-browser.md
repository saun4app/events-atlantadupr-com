---
name: Playwright system browser
description: Browser selection and host-runtime considerations for this workspace's end-to-end tests
---

Use the repository's `test:e2e` script for Playwright runs because it selects the Nix-provided Chromium binary. The bundled Playwright browser may be downloaded successfully yet fail to launch when its Linux runtime libraries are unavailable.

**Why:** The workspace already provides Chromium through Nix, while Playwright's own browser bundle has a separate host-library requirement.

**How to apply:** Prefer `pnpm test:e2e -- <spec>` over calling `pnpm exec playwright test` directly when validating browser flows.