import { pgTable, integer, text, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const eventAssignmentsTable = pgTable(
  "atl_dupr_event_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    eventId: integer("event_id").notNull(),
    eventType: text("event_type", { enum: ["rotating", "fixed_partner"] }).notNull().default("rotating"),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId, t.eventType] })],
);

export type EventAssignment = typeof eventAssignmentsTable.$inferSelect;
