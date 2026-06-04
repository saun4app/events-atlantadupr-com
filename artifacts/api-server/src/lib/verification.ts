import crypto from "crypto";
import { db } from "@workspace/db";
import { emailVerificationCodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const CODE_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const PEPPER =
  process.env.SESSION_SECRET ??
  (process.env.NODE_ENV === "production" ? "" : "atl_dupr_dev_session_secret");

export const VERIFICATION_COOLDOWN_SECONDS = Math.round(COOLDOWN_MS / 1000);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(`${code}:${PEPPER}`).digest("hex");
}

function generateCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Creates or refreshes a verification code for the given email.
 * Returns the plaintext code to send, or null when still within the cooldown window.
 */
export async function issueCode(rawEmail: string): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.email, email));

  if (existing && now.getTime() - existing.lastSentAt.getTime() < COOLDOWN_MS) {
    return null;
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

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
export async function peekCode(rawEmail: string, code: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!code || !/^\d{6}$/.test(code)) return false;

  const [row] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.email, email));

  if (!row) return false;
  if (new Date() > row.expiresAt) return false;
  if (row.attempts >= MAX_ATTEMPTS) return false;

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
