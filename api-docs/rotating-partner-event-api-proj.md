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