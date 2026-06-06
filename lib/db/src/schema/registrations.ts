import { pgTable, serial, integer, text, timestamp, doublePrecision, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export interface RegistrantSnapshot {
  playerName: string;
  doubleRating: string | null;
  singleRating: string | null;
  selfRating: string | null;
  email: string | null;
  phone: string | null;
}

export interface PartnerSnapshot {
  partnerName: string | null;
  partnerDoubleRating: string | null;
}

export const registrationsTable = pgTable("atl_dupr_signups", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  eventType: text("event_type", { enum: ["rotating", "fixed_partner"] }).notNull().default("rotating"),
  memberDuprId: text("member_dupr_id").notNull(),
  partnerDuprId: text("partner_dupr_id"),
  playerSnapshot: jsonb("player_snapshot").$type<RegistrantSnapshot>(),
  partnerSnapshot: jsonb("partner_snapshot").$type<PartnerSnapshot>(),
  status: text("status", {
    enum: ["confirmed", "waitlisted", "pending_approval", "rejected", "cancelled"],
  })
    .notNull()
    .default("confirmed"),
  eventRole: text("event_role"),
  isNew: text("is_new", { enum: ["true", "false"] }).default("false"),
  assignedRating: doublePrecision("assigned_rating"),
  registeredAt: timestamp("registered_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: text("cancelled_by"),
});

export const insertRegistrationSchema = createInsertSchema(registrationsTable).omit({
  id: true,
  registeredAt: true,
});
export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type Registration = typeof registrationsTable.$inferSelect;
