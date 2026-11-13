---
name: Playwright system browser
description: Browser selection and host-runtime considerations for this workspace's end-to-end tests
---

Use the repository's `test:e2e` script for Playwright runs because it selects the Nix-provided Chromium binary. The bundled Playwright browser may be downloaded successfully yet fail to launch when its Linux runtime libraries are unavailable.

**Why:** The workspace already provides Chromium through Nix, while Playwright's own browser bundle has a separate host-library requirement.

**How to apply:** Prefer `pnpm run test:e2e <spec>` over calling `pnpm exec playwright test` directly when validating browser flows.

Pass Playwright options directly after the pnpm script name, without an intervening standalone `--`.

**Why:** pnpm forwards that separator to Playwright. In the installed versions, it prevents later options such as `--project` and `--list` from taking effect, potentially running uninstalled browser projects.

**How to apply:** Use `pnpm run test:e2e --project=desktop-chromium --project=mobile-chromium`; use `--list` with the same invocation to confirm project selection without launching browsers.