---
name: Rotating capacity lock discipline
description: Rules for keeping rotating event limit edits consistent with registration capacity decisions
---

Rotating event limit edits must use the same event-scoped PostgreSQL transaction advisory lock as signups, approvals, promotions, and roster capacity edits, and must reread the event limit after acquiring that lock.

**Why:** Event objects are commonly loaded before a transaction starts; validating against that snapshot allows a waiting capacity operation to make a decision using a limit changed by an earlier writer.

**How to apply:** Any new rotating capacity write must join the shared lock operation set and query the current rotating event row inside its locked transaction before evaluating capacity.