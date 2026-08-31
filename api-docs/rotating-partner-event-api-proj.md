# Rotating Partner Event API

## What & Why
Create an implementation-ready plan for a standalone API server that owns the rotating-partner event domain and is consumed over HTTP by independent frontend client applications. The server should preserve the current rotating-event business behavior while establishing a clean backend boundary that can later host additional API domains, such as fixed-partner events, without coupling those domains together.

The rotating-partner event API is a first-class module of the server, not the server's global event implementation. Its routes, services, policy configuration, persistence access, migrations, and tests must have a clear boundary from future modules such as fixed-partner events. Cross-module behavior should be limited to deliberately shared platform concerns such as transport, authentication primitives, observability, and database infrastructure.

The module should use JSON documents in its database as the domain persistence format rather than modeling rotating-partner business fields as relational columns. Adding a new optional business field should therefore require a document/schema-version update and validation rule, not a relational table migration. The storage layer may still use a database for durability, transactions, document-path indexes, and event-level locking.

This plan is intentionally contract-first. The implementation should use the two companion specifications below as the source material for persistence and backend behavior:
- `api-docs/rotating-partner-event-data-model.json`
- `api-docs/rotating-partner-event-config.json`

The backend configuration is to be derived from `app-config/rotating-partner-config.json`, but must contain only API/server business rules. Frontend presentation, browser validation, and React-specific concerns do not belong in that configuration.

The new API server must use `api-docs/rotating-partner-event-config.json` as its authoritative rotating-partner requirement source instead of hardcoding those requirements in route handlers or service logic.

## Done looks like
- A standalone API server project can be created from this plan without depending on the current React client or its component code.
- `api-docs/rotating-partner-event-data-model.json` defines the rotating-event persistence model, field types, requiredness, enums, relationships, snapshot rules, indexes, and integrity constraints.
- The data model explicitly describes JSON document envelopes, document versions, optional-field evolution, JSON-path indexes, validation rules, and ID-based references instead of cross-module relational foreign keys.
- `api-docs/rotating-partner-event-config.json` defines the backend-only rotating-partner requirements, defaults, lifecycle rules, capacity semantics, verification/rate-limit policy, rating validation, event-setting precedence, and roster-summary behavior derived from the existing rotating configuration.
- The API server loads and validates `api-docs/rotating-partner-event-config.json` through a centralized configuration boundary; invalid or missing configuration prevents startup or request processing rather than silently falling back to hardcoded rules.
- The future server has a versioned HTTP boundary for public clients and staff/admin clients, with documented authentication, authorization, validation, error, and pagination conventions.
- Rotating capacity is participant-based, serialized per event, and authoritative event settings override global or JSON defaults.
- Registration lifecycle behavior is complete: create, reactivation, cancellation, approval, rejection, waitlist promotion, roster editing, snapshots, assigned ratings, and status metadata.
- Public email verification is server-enforced, including code issuance, expiry, cooldown, attempt limits, consumption, delivery-failure handling, and request/submission rate limits.
- The server has automated contract, persistence, authorization, lifecycle, concurrency, and configuration-validation tests.
- The API contract can be consumed by multiple independent frontend clients, and adding a later fixed-partner domain does not require changing rotating-domain data or rules.
- The API has an explicit versioning and compatibility policy, including deprecation behavior, pagination/filtering conventions, idempotency for retryable writes, and a consistent error envelope.
- Independent clients can authenticate safely through documented token/session rules, allowed origins, CSRF protection where cookies are used, role checks, and tenant/organization ownership boundaries.
- Time zones, date serialization, email delivery, background work, rate limiting, observability, health/readiness checks, backups, and configuration packaging are documented as deployment concerns rather than implicit server behavior.
- Sensitive participant data is protected with least-privilege access, redacted logs, retention guidance, auditability for staff mutations, and a documented policy for immutable registration snapshots.
- The rotating-partner module owns its route namespace, application services, configuration access, persistence repositories, migrations, and test fixtures; future event modules have equivalent independent ownership.
- Module boundaries are enforced through explicit interfaces and dependency direction: platform code may support modules, but rotating-partner code does not import fixed-partner code and future modules do not reach into rotating internals.
- Adding or removing an optional rotating-partner business field does not require a relational schema migration; older documents remain readable through version-aware defaults or an explicit document upgrade path.

## Out of scope
- Building or migrating any frontend client application.
- Implementing fixed-partner endpoints, fixed-partner persistence, or fixed-partner business rules in this project; reserve an extension point for them instead.
- Combining rotating and fixed-partner records into a shared event model or shared capacity calculation.
- Modeling rotating-partner business fields as relational columns or requiring a database migration for every new optional field.
- Replacing the existing app in place before the standalone server contract and compatibility tests are accepted.
- Adding unrelated domains such as games, clubs, payments, messaging, or analytics.
- Moving browser-only display logic, form behavior, or client-side validation into backend configuration.

## Deterministic build specification
The following decisions are part of this plan and are not implementation choices to be revisited during the initial build. The new project must use these conventions unless a future version of this plan explicitly changes them.

### 1. Project layout and module registration
Create a new standalone repository with Node.js 22 LTS, TypeScript in strict mode, ESM modules, pnpm, Express 5, PostgreSQL, and JSON Schema validation through Ajv 2020-12. The new repository must not import the current React application, the current API server, or their generated clients.

Use this layout:

```text
rotating-partner-event-api/
  api-docs/
    rotating-partner-event-api-proj.md
    rotating-partner-event-config.json
    rotating-partner-event-data-model.json
    rotating-partner-event-openapi.yaml
  database/
    migrations/
  src/
    app.ts
    server.ts
    platform/
      auth/
      database/
      email/
      http/
      logging/
      time/
    modules/
      rotating-partner/
        index.ts
        config/
        domain/
        application/
        persistence/
        http/
        jobs/
        tests/
    contracts/
      config/
      documents/
  test/
    contract/
    integration/
    security/
    architecture/
  package.json
  tsconfig.json
  .env.example
```

`src/server.ts` creates the HTTP listener. `src/app.ts` creates the Express application without binding a port so tests can use it directly. The only composition root is `src/app.ts`; it creates platform services, calls `createRotatingPartnerModule(platform)`, and mounts the returned router at `/api/v1/rotating-partner-events`.

Every module must expose only this public registration boundary:

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

The rotating module owns all routes below its base path. The platform owns transport, authentication primitives, database transactions, email delivery, logging, metrics, and the clock. No module may receive the Express application, raw environment variables, or a database pool directly.

The project must provide these commands:

```text
pnpm dev
pnpm build
pnpm start
pnpm test
pnpm test:contract
pnpm test:architecture
pnpm db:migrate
pnpm check
```

`pnpm check` runs formatting, TypeScript compilation, JSON Schema validation, OpenAPI validation, contract tests, and architecture-boundary tests.

### 2. Executable configuration and document schemas
`api-docs/rotating-partner-event-config.json` is the only authoritative rotating-partner policy source. Do not load `app-config/rotating-partner-config.json` in the new project and do not duplicate policy values in route handlers, services, migrations, or tests.

Add executable schemas in the new project at:

```text
src/contracts/config/rotating-partner-event-config.schema.json
src/contracts/documents/rotating-partner-event-documents.schema.json
```

Use JSON Schema draft 2020-12 and Ajv with `allErrors: true`, `strict: true`, and `strictTypes: false` only where required by conditional schema fragments. Configuration schemas must reject unknown keys. The configuration schema must enforce:

- Metadata version `1`
- Module ID `rotating-partner-events`
- API version `v1`
- Base path `/api/v1/rotating-partner-events`
- Exactly 18 unique requirement keys
- Lowercase eight-character hexadecimal requirement IDs
- `eventFormat: rotating` on every requirement condition
- Every requirement-specific field, enum, and invariant described in the configuration document
- Participant capacity counted by confirmed participants
- Event lock namespace `atl-dupr:rotating`
- Six-digit, ten-minute verification codes with the documented cooldown and attempt limits

The document schema must define one schema for the required envelope and one payload schema for every document type in the data model. The generated/runtime schemas must preserve the data-model rules exactly:

- Required fields are required.
- Nullable fields accept `null`; optional version-added fields may be omitted.
- Unknown fields are preserved when safe and rejected when they affect identity, security, lifecycle, or capacity.
- `documentId` is an opaque UUID string generated by the server.
- `documentType`, `schemaVersion`, `module`, `createdAt`, `updatedAt`, and `data` are always present.
- `module` is always `rotating-partner-events`.
- Writers emit the current schema version; readers accept the current version and all supported older versions.

Startup must validate the configuration document before opening the HTTP listener. Every document entering or leaving a repository must pass the document schema and semantic invariant checks. Invalid configuration or an unsupported document version fails closed.

### 3. Database and repository contracts
Use PostgreSQL 16 or newer with one module-owned JSON document table:

```sql
CREATE TABLE rotating_partner_documents (
  document_id UUID PRIMARY KEY,
  document_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  module_id TEXT NOT NULL CHECK (module_id = 'rotating-partner-events'),
  data JSONB NOT NULL,
  document_version BIGINT NOT NULL DEFAULT 1 CHECK (document_version >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

Do not add rotating business fields as relational columns. Create only these indexes:

```sql
CREATE INDEX rotating_partner_documents_type_updated_idx
  ON rotating_partner_documents (document_type, updated_at DESC);

CREATE INDEX rotating_partner_documents_event_status_idx
  ON rotating_partner_documents ((data->>'eventId'), (data->>'status'))
  WHERE document_type = 'rotating_registration';

CREATE INDEX rotating_partner_documents_event_participant_idx
  ON rotating_partner_documents ((data->>'eventId'), (data->>'participantId'), (data->>'status'))
  WHERE document_type = 'rotating_registration';

CREATE INDEX rotating_partner_documents_email_idx
  ON rotating_partner_documents ((lower(data->'playerSnapshot'->>'email')))
  WHERE document_type = 'rotating_registration';
```

The repository interface is:

```ts
interface DocumentRepository<TDocument extends DocumentEnvelope> {
  create(document: TDocument, tx?: Transaction): Promise<TDocument>;
  get(documentId: string, tx?: Transaction): Promise<TDocument | null>;
  list(query: DocumentQuery, tx?: Transaction): Promise<DocumentPage<TDocument>>;
  replace(
    documentId: string,
    expectedDocumentVersion: number,
    document: TDocument,
    tx?: Transaction,
  ): Promise<TDocument>;
  delete(documentId: string, expectedDocumentVersion: number, tx?: Transaction): Promise<void>;
}
```

`replace` and `delete` use compare-and-set on `document_version` and return a typed conflict when the expected version is stale. All capacity-changing operations run in one PostgreSQL transaction, acquire an advisory transaction lock using `hashtextextended('atl-dupr:rotating:' || eventId, 0)`, reread the event and registrations after locking, validate the result, and commit the document mutation and audit record atomically.

The migration set must create the table and indexes above, must be repeatable, and must never create a relational column for a rotating business field. Document upgrades are idempotent application code identified by `(documentType, fromVersion, toVersion)`.

### 4. Authentication, authorization, tenant, CORS, and CSRF rules
The new server supports bearer JWTs for independent clients and signed session cookies for same-origin staff tools. Bearer JWTs use OIDC discovery with:

```text
OIDC_ISSUER_URL
OIDC_AUDIENCE
```

The required claims are:

```text
sub       stable actor ID
org_id    organization ID
roles     array containing zero or more documented roles
```

The deployment is single-organization by default. `TENANT_ID` is required, and every authenticated request must have `org_id === TENANT_ID`. A missing or mismatched organization claim returns `403` without revealing resource existence.

The only roles are `admin`, `event_organizer`, `event_captain`, and `court_leader`. Role requirements are exactly those documented in the OpenAPI `x-required-roles` extensions. Event captains and court leaders may access only events for which the rotating module has an assignment document. Admins and event organizers may access all rotating events within the configured organization.

Session cookies must be `HttpOnly`, `Secure` outside development, `SameSite=Lax`, and signed with `SESSION_SECRET`. Cookie-authenticated state-changing requests require both:

- An allowed `Origin` matching `ALLOWED_ORIGINS`
- A valid `X-CSRF-Token` matching the server-issued CSRF token

Bearer-authenticated requests do not use cookie CSRF protection. CORS must use an explicit allowlist from `ALLOWED_ORIGINS`; wildcard origins are forbidden when credentials are enabled. The body limit is 1 MB for JSON requests. Rate-limit responses include `Retry-After` and the documented rate-limit headers.

Public registration and cancellation use only the verification policy in `rotating-partner-event-config.json`. Public responses never include email, phone, participant IDs, or full registration snapshots. Full registration documents require staff authorization.

### 5. Platform service and email/outbox interfaces
Platform services are defined in `src/platform` and injected into modules through `PlatformServices`:

```ts
interface PlatformServices {
  auth: AuthService;
  database: DatabaseService;
  email: EmailService;
  clock: Clock;
  logger: RedactedLogger;
  metrics: Metrics;
  config: RuntimeConfig;
}
```

The rotating module may not import Resend, PostgreSQL, Express globals, `process.env`, or a concrete logging library directly.

Use the installed Resend integration through this platform adapter:

```ts
interface EmailService {
  enqueue(message: OutboundEmail, idempotencyKey: string, tx: Transaction): Promise<QueuedEmail>;
}
```

Verification-code issuance writes the hashed code, expiry, attempt count, and an outbox record in the same transaction. The outbox worker:

- Claims pending messages with `FOR UPDATE SKIP LOCKED`
- Sends through `EmailService`
- Retries transient failures with exponential backoff
- Stops after five attempts
- Records a redacted failure event and alerts configured event contacts
- Never stores or logs a clear-text verification code

Outbox delivery is at-least-once. Every message has an idempotency key, and the provider adapter must make retries safe. The HTTP request returns the documented accepted response after the outbox record is committed; it does not wait for external email delivery.

The module receives an injectable UTC clock. All timestamps use RFC3339 UTC. Background workers expose health checks and metrics for queue depth, retry count, and permanent failures.

### 6. Acceptance-test matrix
The new project is complete only when the following tests exist and pass:

| Area | Required acceptance tests |
| --- | --- |
| Configuration | Valid configuration loads; missing, malformed, unknown-key, duplicate-ID, duplicate-key, wrong-format, wrong-lock, and wrong-policy documents fail closed. |
| Document validation | Every document type validates; required/nullable fields behave as specified; unknown security/lifecycle/capacity fields are rejected; older supported versions read with documented defaults; upgrades are idempotent. |
| OpenAPI | OpenAPI 3.1 parses; all local references resolve; operation IDs are unique; every templated path has its parameter; public responses exclude contact snapshots; registration identifiers are exclusive and non-null. |
| Project boundaries | The rotating module imports no fixed-partner module; platform imports no domain module; only `app.ts` registers modules; routes are mounted only through module registration. |
| Authentication | Invalid bearer tokens, missing organization claims, wrong organizations, missing roles, and unassigned event staff are rejected with the documented status codes. |
| CORS/CSRF | Disallowed origins, wildcard credential configuration, missing CSRF tokens, and mismatched CSRF tokens are rejected; bearer requests remain usable without cookie CSRF. |
| Events | Event CRUD, clone, close, list, roster summary, assignments, defaults, timestamps, and optimistic concurrency match the OpenAPI contract. |
| Registration lifecycle | Create, duplicate-active rejection, cancellation, newest-cancelled-row reactivation, approval, rejection, promotion, roster edits, snapshots, status metadata, and rating initialization match the configuration. |
| Verification | Code format, expiry, cooldown, attempt limit, consumption, request limits, submission limits, delivery failure, retry, and non-enumerating responses match the configuration. |
| Capacity/concurrency | Every capacity-changing operation locks by event, rereads after locking, never exceeds `maxParticipants`, returns a typed conflict or configured waitlist result, and preserves the losing operation's state in mixed races. |
| Privacy/audit | Public endpoints never return email, phone, participant IDs, or private snapshots; staff mutations create redacted audit records; verification codes and credentials never appear in logs or stored details. |
| Operations | Liveness/readiness, database failure, configuration failure, outbox failure, graceful shutdown, metrics, structured request IDs, and redacted logging behave as documented. |
| API compatibility | Request and response examples validate against the OpenAPI schemas; deprecation headers and idempotency behavior are tested for retryable writes. |

### 7. Import and dependency-boundary rules
Enforce these rules with TypeScript project references, ESLint import restrictions, and an architecture test that scans the import graph:

1. `src/platform/**` may depend only on platform libraries and interfaces. It may not import `src/modules/**`.
2. `src/modules/rotating-partner/**` may depend on `src/platform/**` and its own files only.
3. A future `src/modules/fixed-partner/**` module must follow the same rule and may not import rotating-partner files.
4. `src/app.ts` is the only file allowed to import module entrypoints and compose modules.
5. Controllers may call application services, but may not call repositories, database clients, email providers, or environment variables directly.
6. Domain code may not depend on Express, PostgreSQL, Resend, or JSON parsing libraries.
7. Repositories may depend on database interfaces and document schemas, but may not contain HTTP authorization or presentation logic.
8. Module-specific migrations, jobs, fixtures, and configuration remain inside the owning module or its declared database migration package.
9. Cross-module references are stable IDs only; no module may query another module's tables or document collections directly.
10. Shared code is promoted into `platform` only when it is transport, authentication, persistence infrastructure, observability, time, or another explicitly approved platform concern.

The architecture test must fail if a module imports another module, if a platform file imports a module, if a route bypasses an application service, or if a rotating document references a fixed-partner document type.

## Steps
1. **Freeze the standalone contracts** — Review the companion data-model and backend-config JSON specifications against the current rotating routes, database schemas, generated API contract, and tests. Resolve naming, versioning, compatibility, and ownership decisions before implementing endpoints.
2. **Define the server and module boundaries** — Establish a headless API application with versioned routes, environment-based runtime configuration, CORS/origin policy for independent clients, structured errors, request validation, pagination, health checks, and authentication/role handling that does not import frontend code. Mount rotating-partner routes through a dedicated module boundary and define the platform interfaces future modules may use.
3. **Define the client and security contract** — Specify API versioning, authentication/session or token semantics, CORS and CSRF rules, role and ownership checks, pagination/filtering/sorting, structured errors, idempotency keys, retry behavior, request limits, and rate-limit response headers. Do not import frontend code or assume a single browser client.
4. **Implement the configuration boundary** — Load `api-docs/rotating-partner-event-config.json` from a single rotating-partner module, validate its schema and semantic invariants at startup, expose typed policy accessors only within the module's application interfaces, and reject missing/invalid configuration. Package and version the file with the server so deployment cannot silently omit or replace it; do not duplicate requirement values in handlers, services, migrations, or tests except as test fixtures.
5. **Implement JSON-document persistence and evolution** — Store rotating-event, registration, participant/member, event-default, assignment, verification-code, audit, and required supporting records as validated JSON documents with stable document IDs, module ownership, schema versions, timestamps, and explicit document envelopes. Keep repositories owned by the rotating module, use ID-based references across documents/modules rather than domain foreign keys, add JSON-path indexes only for query-critical fields, and define backward-compatible defaults or explicit document upgrades for new fields instead of relational migrations.
6. **Implement event operations** — Provide public and staff-authorized list, retrieve, create, update, delete, clone, close, roster-summary, broadcast, and assignment operations for rotating events, with the configured event-setting precedence and authorization rules. Normalize all timestamps to a documented wire format and make time-zone handling explicit.
7. **Implement registration operations** — Provide roster retrieval, public verification-code request, public registration, cancellation, registration retrieval/editing, approval, rejection, waitlist promotion, and reactivation. Apply duplicate-active-registration checks, newest cancelled-row selection, metadata clearing, snapshot-at-write behavior, configured status transitions, and idempotent/retry-safe mutation handling.
8. **Implement policy enforcement and background work** — Apply participant-based capacity and event-level serialization to every capacity-changing path. Enforce configured rating modes, numeric/skill/NR validation, assigned-rating rules, signup windows, allowed event statuses, verification timing, delivery failure handling, and both request and submission rate limits. Define whether email and other slow work is synchronous or handled through an observable, retryable outbox/job mechanism without leaking module internals.
9. **Publish the module API contract** — Produce or update a standalone OpenAPI document for the rotating API, including reusable schemas from the data model, security schemes, role requirements, request/response examples, error responses, pagination, idempotency, rate limits, and independent-client server URL guidance. Keep the contract versioned and separate from future fixed-partner paths.
10. **Harden operations and privacy** — Add structured logs with PII redaction, request correlation IDs, metrics/tracing, liveness/readiness checks, alertable failure modes, secret/config rotation guidance, backup/restore procedures, and staff mutation audit records. Document participant-data access, retention, deletion, and snapshot behavior.
11. **Verify compatibility and boundaries** — Add unit, integration, contract, authorization, lifecycle, email-verification, settings-precedence, snapshot/rating, retry/idempotency, document-version evolution, transaction/locking, and mixed-capacity concurrency tests. Add boundary checks that prevent accidental imports or route/data coupling with future modules. Validate the JSON specifications and OpenAPI document in CI, verify old documents remain readable after field additions, exercise failure/recovery paths, and document local/deployed configuration and rollout steps without requiring per-field relational migrations.

## Relevant files
- `app-config/rotating-partner-config.json`
- `app-config/rotating-partner-config.schema.json`
- `lib/rotating-partner-config/src/index.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/schema/registrations.ts`
- `lib/db/src/schema/members.ts`
- `lib/db/src/schema/eventDefaults.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/event-server/index.ts`
- `artifacts/api-server/src/routes/event-server/events.ts`
- `artifacts/api-server/src/routes/event-server/registrations.ts`
- `artifacts/api-server/src/lib/rotating-partner-config.ts`
- `lib/api-spec/openapi.yaml`