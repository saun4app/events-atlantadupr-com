import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("atl_dupr_member_list", {
  duprId: text("dupr_id").primaryKey(),
  name: text("name").notNull(),
  doubles: text("doubles"),
  doublesReliability: integer("doubles_reliability"),
  singles: text("singles"),
  singlesReliability: integer("singles_reliability"),
  selfRating: text("self_rating"),
  email: text("email"),
  phone: text("phone"),
});

export const insertMemberSchema = createInsertSchema(membersTable);
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
