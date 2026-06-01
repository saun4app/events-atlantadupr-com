import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eventsTable } from "./events";
import { membersTable } from "./members";
import { usersTable } from "./users";

export const registrationsTable = pgTable("atl_dupr_signups", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => eventsTable.id, { onDelete: "cascade" }),
  memberDuprId: text("member_dupr_id")
    .notNull()
    .references(() => membersTable.duprId, { onDelete: "cascade" }),
  partnerDuprId: text("partner_dupr_id"),
  status: text("status", {
    enum: ["confirmed", "waitlisted", "pending_approval", "rejected"],
  })
    .notNull()
    .default("confirmed"),
  registeredAt: timestamp("registered_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
  approvedBy: integer("approved_by").references(() => usersTable.id),
});

export const insertRegistrationSchema = createInsertSchema(registrationsTable).omit({
  id: true,
  registeredAt: true,
});
export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type Registration = typeof registrationsTable.$inferSelect;
