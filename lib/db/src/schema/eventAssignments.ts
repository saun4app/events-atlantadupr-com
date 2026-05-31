import { pgTable, integer, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { eventsTable } from "./events";

export const eventAssignmentsTable = pgTable(
  "event_assignments",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
);

export type EventAssignment = typeof eventAssignmentsTable.$inferSelect;
