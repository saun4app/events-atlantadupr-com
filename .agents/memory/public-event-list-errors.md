---
name: Public event list error states
description: The visitor-facing distinction between an unavailable event format and a format with no upcoming events
---

An event format request that fails must render a format-specific unavailable state, not the same message used when that format returns no upcoming events. Keep that state mounted during a no-data retry so the retry control can remain disabled until the request settles.

**Why:** Treating a failed request as an empty list can make a temporary outage look like there are no events and gives visitors no useful explanation. Query libraries can also clear their error flag and report loading during a refetch, which otherwise unmounts the retry control while the request is still in flight.

**How to apply:** Keep list loading, request failure, in-flight retry, and successful-empty states distinct for each public event format; verify the failure and recovery states in every supported browser layout.