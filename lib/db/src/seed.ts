import { createHash } from "crypto";
import { db } from "./index.js";
import { usersTable, eventsTable, membersTable, registrationsTable } from "./schema/index.js";
import { sql } from "drizzle-orm";

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "atl_dupr_salt").digest("hex");
}

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`TRUNCATE registrations, events, members, users RESTART IDENTITY CASCADE`);

  const [admin] = await db.insert(usersTable).values([
    { name: "Admin User", username: "admin", passwordHash: hashPassword("admin123"), role: "admin" },
    { name: "Organizer One", username: "organizer1", passwordHash: hashPassword("admin123"), role: "event_organizer" },
    { name: "Participant User", username: "participant1", passwordHash: hashPassword("part123"), role: "event_participant" },
  ]).returning();

  const now = new Date();
  const [ev1, ev2, ev3] = await db.insert(eventsTable).values([
    {
      name: "Chastain Park Rotating Mixer",
      description: "Open rotating format — all skill levels welcome. Bring your own paddle.",
      startDatetime: new Date("2026-06-14T09:00:00Z"),
      endDatetime: new Date("2026-06-14T12:00:00Z"),
      locationName: "Chastain Park Tennis Center",
      locationAddress: "315 West Wieuca Rd NW, Atlanta, GA 30342",
      formatType: "rotating",
      ratingTypeRequired: "dupr",
      minParticipants: 8,
      maxParticipants: 24,
      waitlistEnabled: true,
      requireApproval: false,
      signupStartDatetime: new Date("2026-05-25T00:00:00Z"),
      signupEndDatetime: new Date("2026-06-13T23:59:00Z"),
      status: "upcoming",
    },
    {
      name: "Blackburn Park Fixed-Partner Tournament",
      description: "Register with your partner. DUPR-rated. Singles bracket available.",
      startDatetime: new Date("2026-06-21T10:00:00Z"),
      endDatetime: new Date("2026-06-21T16:00:00Z"),
      locationName: "Blackburn Park",
      locationAddress: "3493 Ashford Dunwoody Rd NE, Atlanta, GA 30319",
      formatType: "fixed_partner",
      ratingTypeRequired: "dupr",
      minParticipants: 8,
      maxParticipants: 32,
      waitlistEnabled: true,
      requireApproval: true,
      signupStartDatetime: new Date("2026-06-01T00:00:00Z"),
      signupEndDatetime: new Date("2026-06-20T23:59:00Z"),
      status: "upcoming",
    },
    {
      name: "Freedom Park Beginner Clinic",
      description: "Beginner-friendly rotating session. Instruction provided by certified coach.",
      startDatetime: new Date("2026-07-05T08:00:00Z"),
      endDatetime: new Date("2026-07-05T10:00:00Z"),
      locationName: "Freedom Park",
      locationAddress: "800 Freedom Pkwy NE, Atlanta, GA 30307",
      formatType: "rotating",
      ratingTypeRequired: "none",
      minParticipants: 4,
      maxParticipants: 16,
      waitlistEnabled: false,
      requireApproval: false,
      signupStartDatetime: new Date("2026-06-15T00:00:00Z"),
      signupEndDatetime: new Date("2026-07-04T23:59:00Z"),
      status: "upcoming",
    },
  ]).returning();

  await db.insert(membersTable).values([
    { duprId: "DUPR-001", name: "Alice Chen", email: "alice@example.com", duprRating: "4.25", membershipStatus: "active" },
    { duprId: "DUPR-002", name: "Bob Martinez", email: "bob@example.com", duprRating: "3.80", membershipStatus: "active" },
    { duprId: "DUPR-003", name: "Carol Smith", email: "carol@example.com", duprRating: "4.50", membershipStatus: "active" },
    { duprId: "DUPR-004", name: "David Park", email: "david@example.com", duprRating: "3.20", membershipStatus: "active" },
    { duprId: "DUPR-005", name: "Emma Wilson", email: "emma@example.com", duprRating: "4.75", membershipStatus: "active" },
    { duprId: "DUPR-006", name: "Frank Lee", email: "frank@example.com", duprRating: "3.60", membershipStatus: "inactive" },
    { duprId: "DUPR-007", name: "Grace Kim", email: "grace@example.com", duprRating: "4.10", membershipStatus: "active" },
    { duprId: "DUPR-008", name: "Henry Brown", email: "henry@example.com", duprRating: "3.90", membershipStatus: "active" },
    { duprId: "DUPR-009", name: "Isabel Torres", email: "isabel@example.com", duprRating: "4.30", membershipStatus: "active" },
    { duprId: "DUPR-010", name: "Jack Davis", email: "jack@example.com", duprRating: "3.50", membershipStatus: "inactive" },
  ]);

  await db.insert(registrationsTable).values([
    { eventId: ev1.id, duprId: "DUPR-001", name: "Alice Chen", email: "alice@example.com", duprRating: "4.25", status: "confirmed" },
    { eventId: ev1.id, duprId: "DUPR-002", name: "Bob Martinez", email: "bob@example.com", duprRating: "3.80", status: "confirmed" },
    { eventId: ev1.id, duprId: "DUPR-003", name: "Carol Smith", email: "carol@example.com", duprRating: "4.50", status: "waitlisted" },
    { eventId: ev2.id, duprId: "DUPR-004", name: "David Park", email: "david@example.com", duprRating: "3.20", status: "pending_approval" },
    { eventId: ev2.id, duprId: "DUPR-005", name: "Emma Wilson", email: "emma@example.com", duprRating: "4.75", status: "confirmed" },
    { eventId: ev3.id, duprId: "DUPR-007", name: "Grace Kim", email: "grace@example.com", duprRating: "4.10", status: "confirmed" },
  ]);

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
