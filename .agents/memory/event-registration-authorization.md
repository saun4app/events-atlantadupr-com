---
name: Event registration authorization
description: Preserve the boundary between public self-registration and authenticated event staff writes.
---

Authenticated users without write access to an event must be denied event registration writes. Do not treat them as anonymous callers merely because their role or assignment does not grant event access. Unauthenticated visitors may still use the public self-registration flow and its existing verification rules.

**Why:** Treating a logged-in but unassigned staff account as a public visitor lets it bypass event ownership checks through the public signup path.

**How to apply:** When changing registration authorization, distinguish an absent session from an authenticated session that lacks event access; keep public self-registration available only through the anonymous path.
