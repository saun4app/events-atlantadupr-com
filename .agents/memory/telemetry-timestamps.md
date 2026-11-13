---
name: Production telemetry timestamps
description: Obtaining ISO timestamps when the tool runtime rejects JavaScript clock functions
---

Supply explicit ISO-8601 strings to production telemetry calls if the tool runtime rejects `new Date()` and `Date.now()`.

**Why:** This workspace's durable execution runtime rejected both clock methods despite the general tool documentation allowing them.

**How to apply:** Obtain the current UTC timestamp with shell `date -u`, then pass that timestamp and an explicit start timestamp to the telemetry callback. Do not repeatedly retry unavailable clock methods.
