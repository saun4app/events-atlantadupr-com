import { createHash } from "crypto";
import { db } from "./index.js";
import { usersTable, eventsTable, membersTable, registrationsTable } from "./schema/index.js";
import { sql } from "drizzle-orm";

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "atl_dupr_salt").digest("hex");
}

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`TRUNCATE registrations, events, event_assignments, atl_dupr_member_list, users RESTART IDENTITY CASCADE`);

  await db.insert(usersTable).values([
    { name: "Admin User", username: "admin", passwordHash: hashPassword("admin123"), role: "admin" },
    { name: "Organizer One", username: "organizer1", passwordHash: hashPassword("org123"), role: "event_organizer" },
    { name: "Participant User", username: "participant1", passwordHash: hashPassword("part123"), role: "event_participant" },
  ]);

  const [ev1, ev2, ev3] = await db.insert(eventsTable).values([
    {
      name: "Chastain Park Rotating Mixer",
      description: "Open rotating format — all skill levels welcome. Bring your own paddle.",
      startDatetime: new Date("2026-06-14T09:00:00Z"),
      endDatetime: new Date("2026-06-14T12:00:00Z"),
      locationName: "Chastain Park Tennis Center",
      locationAddress: "315 West Wieuca Rd NW, Atlanta, GA 30342",
      formatType: "rotating" as const,
      ratingTypeRequired: "dupr" as const,
      minParticipants: 8,
      maxParticipants: 24,
      waitlistEnabled: true,
      requireApproval: false,
      signupStartDatetime: new Date("2026-05-25T00:00:00Z"),
      signupEndDatetime: new Date("2026-06-13T23:59:00Z"),
      status: "upcoming" as const,
    },
    {
      name: "Blackburn Park Fixed-Partner Tournament",
      description: "Register with your partner. DUPR-rated. Singles bracket available.",
      startDatetime: new Date("2026-06-21T10:00:00Z"),
      endDatetime: new Date("2026-06-21T16:00:00Z"),
      locationName: "Blackburn Park",
      locationAddress: "3493 Ashford Dunwoody Rd NE, Atlanta, GA 30319",
      formatType: "fixed_partner" as const,
      ratingTypeRequired: "dupr" as const,
      minParticipants: 8,
      maxParticipants: 32,
      waitlistEnabled: true,
      requireApproval: true,
      signupStartDatetime: new Date("2026-06-01T00:00:00Z"),
      signupEndDatetime: new Date("2026-06-20T23:59:00Z"),
      status: "upcoming" as const,
    },
    {
      name: "Freedom Park Beginner Clinic",
      description: "Beginner-friendly rotating session. Instruction provided by certified coach.",
      startDatetime: new Date("2026-07-05T08:00:00Z"),
      endDatetime: new Date("2026-07-05T10:00:00Z"),
      locationName: "Freedom Park",
      locationAddress: "800 Freedom Pkwy NE, Atlanta, GA 30307",
      formatType: "rotating" as const,
      ratingTypeRequired: "none" as const,
      minParticipants: 4,
      maxParticipants: 16,
      waitlistEnabled: false,
      requireApproval: false,
      signupStartDatetime: new Date("2026-06-15T00:00:00Z"),
      signupEndDatetime: new Date("2026-07-04T23:59:00Z"),
      status: "upcoming" as const,
    },
  ]).returning();

  await db.insert(membersTable).values([
    { duprId: "DUPR-001", playerName: "Alice Chen", doubleRating: "4.25", singleRating: "4.10" },
    { duprId: "DUPR-002", playerName: "Bob Martinez", doubleRating: "3.80", singleRating: "3.70" },
    { duprId: "DUPR-003", playerName: "Carol Smith", doubleRating: "4.50", singleRating: "4.40" },
    { duprId: "DUPR-004", playerName: "David Park", doubleRating: "3.20", singleRating: "3.10" },
    { duprId: "DUPR-005", playerName: "Emma Wilson", doubleRating: "4.75", singleRating: "4.60" },
    { duprId: "DUPR-006", playerName: "Frank Lee", doubleRating: "3.60", singleRating: "3.50" },
    { duprId: "DUPR-007", playerName: "Grace Kim", doubleRating: "4.10", singleRating: "4.00" },
    { duprId: "DUPR-008", playerName: "Henry Brown", doubleRating: "3.90", singleRating: "3.80" },
    { duprId: "DUPR-009", playerName: "Isabel Torres", doubleRating: "4.30", singleRating: "4.20" },
    { duprId: "DUPR-010", playerName: "Jack Davis", doubleRating: "3.50", singleRating: "3.40" },
  ]);

  await db.insert(registrationsTable).values([
    { eventId: ev1.id, memberDuprId: "DUPR-001", status: "confirmed" },
    { eventId: ev1.id, memberDuprId: "DUPR-002", status: "confirmed" },
    { eventId: ev1.id, memberDuprId: "DUPR-003", status: "waitlisted" },
    { eventId: ev2.id, memberDuprId: "DUPR-004", status: "pending_approval" },
    { eventId: ev2.id, memberDuprId: "DUPR-005", status: "confirmed" },
    { eventId: ev3.id, memberDuprId: "DUPR-007", status: "confirmed" },
  ]);

  console.log("Seed complete: 3 users, 10 members, 3 events, 6 registrations.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
