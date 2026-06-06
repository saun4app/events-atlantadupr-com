import { pgTable, serial, text, boolean, integer, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface DuprEventRatingConfig {
  min: number;
  max: number;
  nrAllowed: boolean;
}

export interface SelfNumericEventRatingConfig {
  min: number;
  max: number;
}

export interface SelfSkillEventRatingConfig {
  minLevel: number;
  maxLevel: number;
}

export type EventRatingConfig = DuprEventRatingConfig | SelfNumericEventRatingConfig | SelfSkillEventRatingConfig | null;

export type EventFormat = "rotating" | "fixed_partner";

// Rotating-partner events. Fully self-contained table (no shared base type, no
// cross-table foreign key). Format is implied by the table itself.
export const eventsRotatingTable = pgTable("atl_dupr_events_rotating", {
  id: serial("id").primaryKey(),
  seriesId: text("series_id"),
  name: text("name").notNull(),
  description: text("description"),
  eventDescription: text("event_description"),
  startDatetime: timestamp("start_datetime").notNull(),
  endDatetime: timestamp("end_datetime").notNull(),
  locationName: text("location_name").notNull(),
  locationAddress: text("location_address").notNull().default(""),
  ratingTypeRequired: text("rating_type_required").notNull().default("none"),
  ratingConfig: jsonb("rating_config").$type<EventRatingConfig>(),
  minParticipants: integer("min_participants").notNull().default(4),
  maxParticipants: integer("max_participants").notNull().default(16),
  waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
  requireApproval: text("require_approval", { enum: ["none", "all", "nr_only"] }).notNull().default("none"),
  signupStartDatetime: timestamp("signup_start_datetime").notNull(),
  signupEndDatetime: timestamp("signup_end_datetime").notNull(),
  status: text("status", { enum: ["upcoming", "closed", "ended", "cancelled"] }).notNull().default("upcoming"),
  courtFeeEnabled: boolean("court_fee_enabled").notNull().default(false),
  memberFee: real("member_fee").notNull().default(0),
  nonMemberFee: real("non_member_fee").notNull().default(0),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Fixed-partner events. Capacity is team-oriented (min/max teams). Fully
// self-contained table independent of the rotating-events table.
export const eventsFixedTable = pgTable("atl_dupr_events_fixed", {
  id: serial("id").primaryKey(),
  seriesId: text("series_id"),
  name: text("name").notNull(),
  description: text("description"),
  eventDescription: text("event_description"),
  startDatetime: timestamp("start_datetime").notNull(),
  endDatetime: timestamp("end_datetime").notNull(),
  locationName: text("location_name").notNull(),
  locationAddress: text("location_address").notNull().default(""),
  ratingTypeRequired: text("rating_type_required").notNull().default("none"),
  ratingConfig: jsonb("rating_config").$type<EventRatingConfig>(),
  minTeams: integer("min_teams").notNull().default(2),
  maxTeams: integer("max_teams").notNull().default(8),
  waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
  requireApproval: text("require_approval", { enum: ["none", "all", "nr_only"] }).notNull().default("none"),
  signupStartDatetime: timestamp("signup_start_datetime").notNull(),
  signupEndDatetime: timestamp("signup_end_datetime").notNull(),
  status: text("status", { enum: ["upcoming", "closed", "ended", "cancelled"] }).notNull().default("upcoming"),
  courtFeeEnabled: boolean("court_fee_enabled").notNull().default(false),
  memberFee: real("member_fee").notNull().default(0),
  nonMemberFee: real("non_member_fee").notNull().default(0),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEventRotatingSchema = createInsertSchema(eventsRotatingTable).omit({ id: true, createdAt: true });
export type InsertEventRotating = z.infer<typeof insertEventRotatingSchema>;
export type EventRotating = typeof eventsRotatingTable.$inferSelect;

export const insertEventFixedSchema = createInsertSchema(eventsFixedTable).omit({ id: true, createdAt: true });
export type InsertEventFixed = z.infer<typeof insertEventFixedSchema>;
export type EventFixed = typeof eventsFixedTable.$inferSelect;
