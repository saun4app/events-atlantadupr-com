import { pgTable, text, integer } from "drizzle-orm/pg-core";

/**
 * Per-format event-creation defaults. Each event format (rotating /
 * fixed_partner) gets its OWN row — there are no shared setting rows between
 * formats, so editing one format's defaults can never affect the other.
 *
 * `minCapacity`/`maxCapacity` mean participants for the rotating format and
 * teams for the fixed_partner format.
 */
export const eventDefaultsTable = pgTable("atl_dupr_event_defaults", {
  eventType: text("event_type").primaryKey(),
  minCapacity: integer("min_capacity").notNull().default(8),
  maxCapacity: integer("max_capacity").notNull().default(24),
});

export type EventDefaults = typeof eventDefaultsTable.$inferSelect;
export type EventDefaultsInput = typeof eventDefaultsTable.$inferInsert;
