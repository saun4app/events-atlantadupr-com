---
name: Resend email sending
description: Resend rejects sends from unverified sender domains; how the app picks its "from".
---
# Resend sending constraints

Resend returns **403 validation_error "<domain> is not verified"** when the `from`
address uses a domain not verified in the project's Resend account. This is a
Resend platform requirement, not a code bug.

**How to apply:**
- The event-registration email-verification flow uses `eventContactEmails[0]` as the
  `from` address. For real delivery the owner must verify that domain (or its
  sending subdomain) at https://resend.com/domains.
- For local/dev testing without a verified domain, send `to` the Resend sandbox
  inbox `delivered@resend.dev`; the API still stores the code so the rest of the
  flow can be exercised even when the send 403s.
- Resend is reached via `@replit/connectors-sdk` `connectors.proxy("resend", ...)`,
  not a raw API key.
