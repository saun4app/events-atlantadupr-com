import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const emailVerificationCodesTable = pgTable("atl_dupr_email_verification_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type EmailVerificationCode = typeof emailVerificationCodesTable.$inferSelect;
