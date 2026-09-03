# Rotating Partner Event API Module Plan

## What & Why
Define the rotating-partner event domain as an independently deployable module registered by the modular DUPR Event API server. The module preserves rotating event behavior while relying on shared server platform services and remaining isolated from future modules such as fixed-partner events.

The shared server contract is defined in:
- `api-docs/dupr-event-api-proj-plan.md`
- `api-docs/dupr-event-api-config.json`
- `api-docs/dupr-event-api-data-model.json`
- `api-docs/dupr-event-api-openapi.yaml`

The module-specific persistence and policy sources are:
- `api-docs/rotating-partner-event-api-module-data-modle.json`
- `api-docs/rotating-partner-event-api-module-config.json`

## Done looks like
- The module registers through `ApiModule.register(platform)` and exposes only `/api/v1/rotating-partner-events`.
- The module owns rotating event, registration, participant, event-default, assignment, verification, audit, and rotating-specific persistence behavior.
- Rotating capacity, lifecycle, ratings, event-setting precedence, snapshots, and public verification behavior are read from the module configuration rather than duplicated in handlers.
- The module uses the shared authentication context, tenant checks, transport, error envelope, pagination, concurrency, logging, metrics, clock, database, and email/outbox interfaces.
- The module can be added or removed without changing platform internals or another domain module. Cross-module references are stable IDs only.
- Public responses exclude contact data and private registration snapshots; staff access uses the shared role and ownership checks.
- The module contract remains independently testable and validates its external references to shared API components.

## Out of scope
- Implementing the shared API server platform or changing its authentication provider.
- Implementing fixed-partner events or combining rotating and fixed-partner domain records.
- Building or migrating frontend clients.
- Adding relational columns for rotating business fields.
- Moving shared HTTP, authentication, tenancy, operational, or provider behavior back into the module.

## Deterministic build specification

### 1. Module registration and dependency direction
The server composition root calls `createRotatingPartnerModule(platform)` and mounts the returned router at `/api/v1/rotating-partner-events`. The module entrypoint is the only public registration surface.

The module may depend on shared platform interfaces and its own domain code. It may not import a future module, the React client, generated frontend code, raw environment variables, Express globals, PostgreSQL clients, Resend, or a concrete logging library directly. Controllers call application services; repositories remain free of HTTP authorization and presentation logic.

### 2. Configuration boundary
`rotating-partner-event-api-module-config.json` is the sole authoritative source for rotating policy. It defines the rotating format, participant capacity, capacity locks, rating validation, event-setting precedence, registration lifecycle, public verification, rate limits, and roster-summary rules.

The module loads and validates this configuration at its boundary. Missing, malformed, unknown-key, semantically invalid, or incompatible configuration fails closed. Shared server settings come only from the platform configuration and are not copied into this module document.

### 3. JSON document persistence
`rotating-partner-event-api-module-data-modle.json` owns the rotating event, registration, participant profile, event-default, event-assignment, email-verification, and rotating audit document types. Every document uses the shared envelope conventions while retaining the module owner and rotating document-type constraints.

Use stable IDs rather than cross-module foreign keys. Preserve snapshots at registration write time. Readers support current and explicitly supported older document versions; writers emit the current version. Capacity-changing operations lock by rotating event, reread current documents after locking, and commit mutation plus audit record atomically.

### 4. HTTP contract
`rotating-partner-event-api-module-openapi.yaml` contains only rotating paths, operations, tags, domain parameters, domain schemas, and module-specific authorization annotations. It references shared security schemes, common errors, pagination/concurrency parameters, and the shared document envelope through `dupr-event-api-openapi.yaml`.

The contract includes public event and roster reads, staff event management, registration creation/cancellation/approval/rejection/promotion/reactivation, participant and assignment management, defaults, ratings, roster summaries, broadcast, and email verification. Public registration and cancellation responses use redacted schemas.

### 5. Domain behavior
Implement or preserve:

- Event CRUD, clone, close, list, defaults, roster summaries, assignments, and timestamps
- Participant lookup and snapshot-at-write behavior
- Duplicate active-registration checks and newest-cancelled-row reactivation
- Approval, rejection, cancellation, waitlist promotion, and configured status transitions
- Participant-based capacity and event-level serialization for every capacity mutation
- DUPR, self-numeric, self-skill, NR, and assigned-rating validation from module configuration
- Public verification-code issuance, expiry, cooldown, attempts, consumption, delivery failure, and request/submission limits
- Idempotent retry handling and optimistic concurrency through shared HTTP conventions

### 6. Security and privacy
Use the shared platform authentication and organization context. Apply module role requirements and event assignment ownership to protected operations. Keep public responses free of email, phone, participant IDs, private snapshots, credentials, and verification codes. Staff mutations create redacted audit records through the platform or module-owned audit interface as specified by the data model.

### 7. Verification
Validate the module configuration, data model, OpenAPI paths and operation IDs, local and external references, document-type alignment, public response redaction, identifier exclusivity, capacity behavior, lifecycle transitions, verification policy, and module-boundary rules. Adding a future module must not require editing rotating domain rules.

## Relevant files
- `api-docs/dupr-event-api-proj-plan.md`
- `api-docs/dupr-event-api-config.json`
- `api-docs/dupr-event-api-data-model.json`
- `api-docs/dupr-event-api-openapi.yaml`
- `api-docs/rotating-partner-event-api-module-config.json`
- `api-docs/rotating-partner-event-api-module-data-modle.json`
- `api-docs/rotating-partner-event-api-module-openapi.yaml`
- `scripts/check-rotating-openapi.mjs`
- `scripts/check-rotating-openapi.test.mjs`