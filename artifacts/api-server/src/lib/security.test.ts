import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins, createSessionToken, sessionCookieOptions } from "./security.js";

test("session tokens contain 256 bits of unpredictable, URL-safe entropy", () => {
  const tokens = new Set(Array.from({ length: 1000 }, createSessionToken));
  assert.equal(tokens.size, 1000);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test("production cookies are secure and origins are explicitly trusted", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const cookie = sessionCookieOptions();
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
    assert.equal(allowedOrigins().has("https://events.atlantadupr.com"), true);
    assert.equal(allowedOrigins().has("https://attacker.example"), false);
    assert.equal(allowedOrigins().has("http://localhost"), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
