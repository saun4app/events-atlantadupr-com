import { pgTable, integer, text, jsonb, boolean } from "drizzle-orm/pg-core";

export interface ContactPerson {
  name: string;
  email: string;
}

export interface DefaultLocation {
  id: string;
  name: string;
  address: string;
  memberFee?: number;
  nonMemberFee?: number;
  courtFeeEnabled?: boolean;
}

export interface RatingRequirement {
  key: string;
  label: string;
}

export interface SkillLevel {
  text: string;
  level: number;
}

export interface DuprRatingConfig {
  enabled: boolean;
  minAllowed: number;
  maxAllowed: number;
  defaultMin: number;
  defaultMax: number;
  defaultNrAllowed: boolean;
}

export interface SelfNumericConfig {
  enabled: boolean;
  minAllowed: number;
  maxAllowed: number;
  defaultMin: number;
  defaultMax: number;
}

export interface SelfSkillConfig {
  enabled: boolean;
  levels: SkillLevel[];
}

export interface RatingRequirementsConfig {
  dupr: DuprRatingConfig;
  selfNumeric: SelfNumericConfig;
  selfSkill: SelfSkillConfig;
}

export const DEFAULT_RATING_REQUIREMENTS_CONFIG: RatingRequirementsConfig = {
  dupr: {
    enabled: true,
    minAllowed: 2.0,
    maxAllowed: 8.0,
    defaultMin: 2.0,
    defaultMax: 4.0,
    defaultNrAllowed: false,
  },
  selfNumeric: {
    enabled: true,
    minAllowed: 2.0,
    maxAllowed: 6.0,
    defaultMin: 2.0,
    defaultMax: 4.0,
  },
  selfSkill: {
    enabled: true,
    levels: [],
  },
};

export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  defaultTimezone: text("default_timezone").notNull().default("America/New_York"),
  rotatingPartnersDescription: text("rotating_partners_description").notNull().default(""),
  fixedPartnerDescription: text("fixed_partner_description").notNull().default(""),
  minParticipants: integer("min_participants").notNull().default(8),
  maxParticipants: integer("max_participants").notNull().default(24),
  minTeams: integer("min_teams").notNull().default(4),
  maxTeams: integer("max_teams").notNull().default(12),
  contactPersons: jsonb("contact_persons").$type<ContactPerson[]>().notNull().default([]),
  defaultLocations: jsonb("default_locations").$type<DefaultLocation[]>().notNull().default([]),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  defaultEventNames: jsonb("default_event_names").$type<string[]>().notNull().default([]),
  defaultEventDurationHours: integer("default_event_duration_hours").notNull().default(2),
  defaultRatingRequirements: jsonb("default_rating_requirements").$type<RatingRequirement[]>().notNull().default([]),
  ratingRequirementsConfig: jsonb("rating_requirements_config").$type<RatingRequirementsConfig>(),
});

export type AppSettings = typeof appSettingsTable.$inferSelect;
