import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("app_sessions", {
  token: text("token").primaryKey(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
