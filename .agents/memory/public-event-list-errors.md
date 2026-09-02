---
name: Public event list error states
description: The visitor-facing distinction between an unavailable event format and a format with no upcoming events
---

An event format request that fails must render a format-specific unavailable state, not the same message used when that format returns no upcoming events.

**Why:** Treating a failed request as an empty list can make a temporary outage look like there are no events and gives visitors no useful explanation.

**How to apply:** Keep list loading, request failure, and successful-empty states distinct for each public event format; verify the failure state in every supported browser layout.