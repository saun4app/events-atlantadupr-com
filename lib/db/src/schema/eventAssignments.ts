import {
  pgTable,
  integer,
  text,
  primaryKey,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// eventId is intentionally not a foreign key: it references the event table
// selected by eventType. Run scripts/audit-event-assignments.ts to audit this
// polymorphic relationship after historical event cleanup.
export const eventAssignmentsTable = pgTable(
  "atl_dupr_event_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    eventId: integer("event_id").notNull(),
    eventType: text("event_type", { enum: ["rotating", "fixed_partner"] })
      .notNull()
      .default("rotating"),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId, t.eventType] })],
);

export type EventAssignment = typeof eventAssignmentsTable.$inferSelect;
