import crypto from "crypto";
import { db } from "@workspace/db";
import { emailVerificationCodesTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";

export interface VerificationPolicy {
  codeTtlMs: number;
  cooldownMs: number;
  maxAttempts: number;
  codeFormat: "six_digit";
}

const DEFAULT_VERIFICATION_POLICY: VerificationPolicy = {
  codeTtlMs: 10 * 60 * 1000,
  cooldownMs: 30 * 1000,
  maxAttempts: 5,
  codeFormat: "six_digit",
};

const PEPPER =
  process.env.SESSION_SECRET ??
  (process.env.NODE_ENV === "production"
    ? (() => { throw new Error("SESSION_SECRET env var must be set in production"); })()
    : "atl_dupr_dev_session_secret");

export const VERIFICATION_COOLDOWN_SECONDS = Math.round(
  DEFAULT_VERIFICATION_POLICY.cooldownMs / 1000,
);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(`${code}:${PEPPER}`).digest("hex");
}

function generateCode(policy: VerificationPolicy): string {
  if (policy.codeFormat !== "six_digit") {
    throw new Error("Unsupported verification code format");
  }
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Creates or refreshes a verification code for the given email.
 * Returns the plaintext code to send, or null when still within the cooldown window.
 */
export async function issueCode(
  rawEmail: string,
  policy: VerificationPolicy = DEFAULT_VERIFICATION_POLICY,
): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  const now = new Date();

  await clearExpiredCodes(now);

  const [existing] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.email, email));

  if (
    existing &&
    now.getTime() - existing.lastSentAt.getTime() < policy.cooldownMs
  ) {
    return null;
  }

  const code = generateCode(policy);
  const codeHash = hashCode(code);
  const expiresAt = new Date(now.getTime() + policy.codeTtlMs);

  await db
    .insert(emailVerificationCodesTable)
    .values({ email, codeHash, expiresAt, attempts: 0, lastSentAt: now })
    .onConflictDoUpdate({
      target: emailVerificationCodesTable.email,
      set: { codeHash, expiresAt, attempts: 0, lastSentAt: now },
    });

  return code;
}

/**
 * Validates a code without consuming it. Increments the attempt counter on a
 * mismatch so codes cannot be brute-forced. A valid code remains usable so that
 * a failed downstream step (e.g. member-not-found) doesn't waste the code.
 */
export async function peekCode(
  rawEmail: string,
  code: string,
  policy: VerificationPolicy = DEFAULT_VERIFICATION_POLICY,
): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (
    !code ||
    (policy.codeFormat === "six_digit" && !/^\d{6}$/.test(code))
  ) {
    return false;
  }

  const [row] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.email, email));

  if (!row) return false;
  if (new Date() > row.expiresAt) return false;
  if (row.attempts >= policy.maxAttempts) return false;

  if (hashCode(code) === row.codeHash) return true;

  await db
    .update(emailVerificationCodesTable)
    .set({ attempts: row.attempts + 1 })
    .where(eq(emailVerificationCodesTable.email, email));

  return false;
}

/** Deletes the verification record once registration succeeds. */
export async function consumeCode(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  await db.delete(emailVerificationCodesTable).where(eq(emailVerificationCodesTable.email, email));
}

/**
 * Opportunistically removes verification codes that have already expired.
 * Called on code issuance to keep the table tidy without a separate scheduler.
 */
export async function clearExpiredCodes(now: Date = new Date()): Promise<void> {
  await db
    .delete(emailVerificationCodesTable)
    .where(lt(emailVerificationCodesTable.expiresAt, now));
}
