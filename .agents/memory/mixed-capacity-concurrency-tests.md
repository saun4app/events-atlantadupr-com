---
name: Mixed capacity concurrency tests
description: How to assert cross-operation event capacity races without depending on lock acquisition order
---

Concurrent requests competing for an event's final slot may complete in either order. Tests should assert the valid operation-specific response pairs and then verify the persisted confirmed count and the losing registration state.

**Why:** Promise scheduling and database lock acquisition are intentionally nondeterministic; assuming the first request always wins creates flaky tests or tests the scheduler instead of the capacity contract.

**How to apply:** For mixed sign-up and approval races, map each response to its operation, allow either sign-up-success/approval-failure or approval-success/sign-up-failure when waitlisting is disabled, and assert the event never exceeds `maxParticipants`.