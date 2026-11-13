import {
  pgTable,
  integer,
  text,
  primaryKey,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { eventRoleIds } from "../user-roles";

// eventId is intentionally not a foreign key: it references the event table
// selected by eventType. The durable event identity is the pair
// (event_type, event_id), not event_id alone. Event deletion must remove
// assignments for that pair, and scripts/audit-event-assignments.ts checks for
// rows whose format-specific event no longer exists.
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
    eventRole: text("event_role", { enum: eventRoleIds }).notNull(),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId, t.eventType] })],
);

export type EventAssignment = typeof eventAssignmentsTable.$inferSelect;
