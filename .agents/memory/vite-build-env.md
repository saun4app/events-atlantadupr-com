---
name: Vite build environment variables
description: Workspace Vite builds require the same PORT and BASE_PATH environment variables used by their dev workflows.
---

Vite artifact builds fail before bundling when `PORT` is unset; the mockup sandbox also requires `BASE_PATH`.

**Why:** The workspace Vite configs intentionally fail fast when artifact routing values are missing, including during production builds.

**How to apply:** Run builds with the workflow-provided `PORT` and the artifact’s configured base path (the mockup sandbox uses `/__mockup`).