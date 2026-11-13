---
name: Stateful browser mutation fixtures
description: A testing convention for browser mocks that exercise save-and-refresh flows
---

Browser fixtures covering mutations should keep an in-memory representation of the mocked resource, apply the request payload, and return that representation on subsequent reads.

**Why:** Checking only the outgoing request can miss a client that closes the form while rendering stale data; a stateful response also proves the successful mutation is reflected after the client refetches.

**How to apply:** Use this pattern for deterministic Playwright save-flow fixtures, while keeping the state local to each fixture setup so parallel tests cannot affect one another.