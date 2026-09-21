---
name: Polymorphic event fixtures
description: Test-fixture rules for event assignments spanning independent event tables
---

When a test covers assignments across rotating and fixed-partner events, create a real event in the opposite format and use that event's ID for the cross-format row. Do not leave a dangling assignment whose ID may later be allocated by the other event table.

**Why:** The two event tables have independent numeric sequences, while the polymorphic assignment table uses `eventId` plus `eventType`. A dangling cross-format row can become attached to a later real event when the independent sequences produce the same number, causing order-dependent CI failures.

**How to apply:** Keep counterpart events in the fixture cleanup set and assert the opposite-format row against the counterpart event's ID. This preserves the format-filtering assertion without relying on globally unique IDs.