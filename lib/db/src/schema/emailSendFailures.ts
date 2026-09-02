import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const emailSendFailuresTable = pgTable("atl_dupr_email_send_failures", {
  id: serial("id").primaryKey(),
  recipientAddress: text("recipient_address").notNull(),
  eventName: text("event_name"),
  errorMessage: text("error_message").notNull(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});

export type EmailSendFailure = typeof emailSendFailuresTable.$inferSelect;
