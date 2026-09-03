# DUPR Event API Server Plan

## What & Why
Define the reusable, headless API server that hosts independent domain modules. The server owns transport, authentication, tenancy, HTTP conventions, platform services, and operational concerns; event modules own their domain rules and expose them through a narrow registration boundary.

## Done looks like
- The server can host rotating-partner and future event modules without importing one module into another.
- Platform services provide authentication, authorization primitives, database transactions, email delivery, time, logging, metrics, configuration, and health checks through explicit interfaces.
- Independent clients can use bearer tokens, while same-origin staff tools can use signed session cookies protected by origin and CSRF checks.
- Organization claims, allowed origins, request limits, structured errors, pagination, optimistic concurrency, idempotency, and rate-limit response headers are defined once for every module.
- Configuration fails closed when required server settings are absent or invalid; secrets are supplied by the deployment environment and never stored in API documents.
- Outbox delivery, retries, redacted logging, auditability, readiness, graceful shutdown, backups, and retention are documented as platform responsibilities.
- A module is registered by the composition root and receives platform interfaces rather than the Express app, raw environment variables, a database pool, or a concrete provider.

## Out of scope
- Rotating-partner event routes, lifecycle rules, capacity policy, rating rules, registration verification policy, or domain persistence; those belong to the rotating module contract.
- Fixed-partner endpoints or any other future domain implementation.
- Migrating the current monorepo API or frontend.
- Choosing a third-party identity provider, email provider, database schema, or UI framework for a module.

## Deterministic build specification

### 1. Server and module composition
Use a standalone Node.js 22 LTS, TypeScript strict-mode, ESM, pnpm, Express 5, PostgreSQL, and Ajv 2020-12 server. The server must not import the current React application, current API server, or generated clients.

The composition root creates platform services and registers modules through:

```ts
export interface ApiModule {
  id: string;
  basePath: string;
  register(platform: PlatformServices): RegisteredModule;
}

export interface RegisteredModule {
  router: import("express").Router;
  healthChecks: readonly HealthCheck[];
  migrations: readonly MigrationDescriptor[];
}
```

Only the composition root imports module entrypoints. Each module owns its route namespace, configuration, repositories, migrations, jobs, fixtures, and tests. Platform code never imports domain modules, and modules cannot import one another.

### 2. Platform services
Expose typed interfaces for:

- Authentication and authorization context
- Database transactions and document/repository infrastructure
- Email enqueueing and outbox delivery
- An injectable UTC clock
- Redacted structured logging and request IDs
- Metrics, health/readiness, and graceful shutdown
- Validated runtime configuration

The platform adapter may use Express, PostgreSQL, Resend, and environment variables. A domain module may use only the injected interfaces and its own code. Slow external work is queued through an idempotent outbox; clear-text verification codes, credentials, and unnecessary PII never enter logs or stored details.

### 3. Authentication, tenancy, and HTTP policy
Support bearer JWTs for independent clients and signed session cookies for same-origin staff tools. OIDC configuration uses `OIDC_ISSUER_URL` and `OIDC_AUDIENCE`; authenticated principals provide `sub`, `org_id`, and `roles`.

The default deployment is single-organization and requires `TENANT_ID`. Missing or mismatched organization claims are rejected without revealing resource existence. Cookies are `HttpOnly`, `Secure` outside development, and `SameSite=Lax`; cookie-authenticated mutations require an allowed `Origin` and matching CSRF token. CORS uses an explicit `ALLOWED_ORIGINS` list, never a wildcard with credentials.

The platform defines the common error envelope, request body limit, pagination defaults, `If-Match` concurrency convention, idempotency-key behavior, deprecation policy, and `Retry-After` rate-limit response headers. Module contracts add only their own authorization roles and domain validation.

### 4. Shared persistence conventions
Use JSON documents where platform persistence is needed. Documents have opaque IDs, types, schema versions, module ownership, UTC timestamps, and payload data. Readers support current and documented older versions; writers emit the current version. Cross-module references use stable IDs only, never another module’s tables or documents.

The shared document and platform persistence contract is defined in `dupr-event-api-data-model.json`. Module documents extend the conventions in their own data-model contract and remain independently validated.

### 5. Operations and security
Validate all runtime configuration before opening the listener. Provide liveness and readiness checks, dependency failure reporting, structured redacted logs, metrics for request/error/queue health, graceful shutdown, backup/restore guidance, retention rules, and audit records for staff mutations. The platform must fail closed rather than silently falling back to hardcoded security or deployment policy.

### 6. Verification
The server project must validate the shared JSON and OpenAPI documents, test authentication and tenant isolation, exercise CORS/CSRF and common errors, verify outbox retry/idempotency behavior, and run architecture checks proving that platform code does not depend on modules and module registration occurs only through the composition root.

## Relevant files
- `api-docs/rotating-partner-event-api-module-plan.md`
- `api-docs/rotating-partner-event-api-module-config.json`
- `api-docs/rotating-partner-event-api-module-data-modle.json`
- `api-docs/rotating-partner-event-api-module-openapi.yaml`
- `scripts/check-rotating-openapi.mjs`
- `scripts/check-rotating-openapi.test.mjs`