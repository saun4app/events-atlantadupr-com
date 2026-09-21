import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";

import {
  assertTestDatabase,
  db,
  emailVerificationCodesTable,
  pool,
} from "@workspace/db";
import { eq } from "drizzle-orm";

import {
  consumeCode,
  issueCode,
  peekCode,
  type VerificationPolicy,
} from "./verification.js";

const policy: VerificationPolicy = {
  codeTtlMs: 60_000,
  cooldownMs: 30_000,
  maxAttempts: 3,
  codeFormat: "six_digit",
};

const createdEmails = new Set<string>();

function testEmail(label: string): string {
  const email = `verification-${label}-${crypto.randomUUID()}@test.local`;
  createdEmails.add(email);
  return email;
}

async function findCode(email: string) {
  const [row] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.email, email));
  return row;
}

before(async () => {
  await assertTestDatabase();
});

afterEach(async () => {
  await assertTestDatabase();
  for (const email of createdEmails) {
    await db
      .delete(emailVerificationCodesTable)
      .where(eq(emailVerificationCodesTable.email, email));
  }
  createdEmails.clear();
});

after(async () => {
  await pool.end();
});

describe("verification codes", () => {
  it("issues a normalized code, blocks it during cooldown, and refreshes it after cooldown", async () => {
    const email = testEmail("cooldown");
    const firstCode = await issueCode(`  ${email.toUpperCase()}  `, policy);

    assert.match(firstCode ?? "", /^\d{6}$/);
    assert.equal(await issueCode(email, policy), null);

    const firstRow = await findCode(email);
    assert.ok(firstRow);

    await db
      .update(emailVerificationCodesTable)
      .set({
        attempts: 2,
        lastSentAt: new Date(Date.now() - policy.cooldownMs - 1_000),
      })
      .where(eq(emailVerificationCodesTable.email, email));

    const refreshedCode = await issueCode(email, policy);
    const refreshedRow = await findCode(email);

    assert.match(refreshedCode ?? "", /^\d{6}$/);
    assert.ok(refreshedRow);
    assert.equal(refreshedRow.attempts, 0);
    assert.ok(refreshedRow.lastSentAt > firstRow.lastSentAt);
  });

  it("peeks valid codes without consuming them", async () => {
    const email = testEmail("valid");
    const code = await issueCode(email, policy);

    assert.ok(code);
    assert.equal(await peekCode(email, code, policy), true);
    assert.equal(await peekCode(email, code, policy), true);
    assert.ok(await findCode(email));
  });

  it("rejects expired codes", async () => {
    const email = testEmail("expired");
    const code = await issueCode(email, policy);
    assert.ok(code);

    await db
      .update(emailVerificationCodesTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(emailVerificationCodesTable.email, email));

    assert.equal(await peekCode(email, code, policy), false);
  });

  it("counts wrong codes and enforces the attempt limit", async () => {
    const email = testEmail("attempts");
    const code = await issueCode(email, policy);
    assert.ok(code);

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      assert.equal(await peekCode(email, "000000", policy), false);
      assert.equal((await findCode(email))?.attempts, attempt);
    }

    assert.equal(await peekCode(email, code, policy), false);
    assert.equal((await findCode(email))?.attempts, policy.maxAttempts);
  });

  it("consumes a code by deleting its record", async () => {
    const email = testEmail("consume");
    assert.ok(await issueCode(email, policy));

    await consumeCode(` ${email.toUpperCase()} `);

    assert.equal(await findCode(email), undefined);
    assert.equal(await peekCode(email, "123456", policy), false);
  });

  it("sweeps already-expired rows when issuing a new code", async () => {
    const expiredEmail = testEmail("sweep-expired");
    const activeEmail = testEmail("sweep-active");
    const newEmail = testEmail("sweep-new");

    assert.ok(await issueCode(expiredEmail, policy));
    assert.ok(await issueCode(activeEmail, policy));
    await db
      .update(emailVerificationCodesTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(emailVerificationCodesTable.email, expiredEmail));

    assert.ok(await issueCode(newEmail, policy));

    assert.equal(await findCode(expiredEmail), undefined);
    assert.ok(await findCode(activeEmail));
    assert.ok(await findCode(newEmail));
  });
});
