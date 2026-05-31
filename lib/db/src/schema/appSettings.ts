import { pgTable, integer, text, jsonb } from "drizzle-orm/pg-core";

export interface ContactPerson {
  name: string;
  email: string;
}

export interface DefaultLocation {
  id: string;
  name: string;
  address: string;
}

export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  defaultTimezone: text("default_timezone").notNull().default("America/New_York"),
  rotatingPartnersDescription: text("rotating_partners_description").notNull().default(""),
  fixedPartnerDescription: text("fixed_partner_description").notNull().default(""),
  minParticipants: integer("min_participants").notNull().default(8),
  maxParticipants: integer("max_participants").notNull().default(24),
  contactPersons: jsonb("contact_persons").$type<ContactPerson[]>().notNull().default([]),
  defaultLocations: jsonb("default_locations").$type<DefaultLocation[]>().notNull().default([]),
});

export type AppSettings = typeof appSettingsTable.$inferSelect;
