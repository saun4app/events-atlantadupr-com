---
name: Shared runtime configuration package
description: Boundary rule for configuration consumed by both the API and Vite frontend
---

Shared runtime configuration logic used by the API and browser belongs in a
workspace library with its own package boundary. Importing a TypeScript module
directly from app-config into the API package can pass Vite typechecking but
fail the API's Node/tsx loader and violate its rootDir.

**Why:** The API and frontend have different module-resolution boundaries, so
crossing from a package into a repository-level TypeScript file is not
reliably runtime-compatible.

**How to apply:** Keep JSON as the declarative data source, load it through
the shared library's typed validator/accessor, and expose package-local
adapters when the API or UI needs a preloaded singleton.