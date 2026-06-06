import bcrypt from "bcryptjs";
import { db } from "./index.js";
import { usersTable, eventsRotatingTable, eventsFixedTable, membersTable, registrationsTable, appSettingsTable, eventDefaultsTable } from "./schema/index.js";
import { sql } from "drizzle-orm";

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`TRUNCATE atl_dupr_signups, atl_dupr_events_rotating, atl_dupr_events_fixed, atl_dupr_event_roles, atl_dupr_member_list, app_uses, app_settings, atl_dupr_event_defaults RESTART IDENTITY CASCADE`);

  await db.insert(eventDefaultsTable).values([
    { eventType: "rotating", minCapacity: 8, maxCapacity: 24 },
    { eventType: "fixed_partner", minCapacity: 4, maxCapacity: 12 },
  ]);

  await db.insert(appSettingsTable).values({
    id: 1,
    defaultTimezone: "America/New_York",
    rotatingPartnersDescription: "<p>Players rotate partners each round. A great way to meet new people and play with a variety of skill levels.</p>",
    fixedPartnerDescription: "<p>Register with your doubles partner. You will play all rounds together as a team.</p>",
    defaultEventDurationHours: 2,
    eventRoles: ["Captain", "Sub"],
    defaultEventNames: [
      "Saturday Morning Round Robin",
      "Sunday Doubles Social",
      "Wednesday Mixer",
      "Friday Night Round Robin",
      "Beginner Clinic",
      "Intermediate Tournament",
      "Advanced Competitive Play",
    ],
    defaultRatingRequirements: [
      { key: "dupr", label: "DUPR Required" },
      { key: "national", label: "National Rating Required" },
      { key: "none", label: "All Levels (No Rating Required)" },
    ],
    contactPersons: [{ name: "Admin User", email: "admin@atldupr.com" }],
    defaultLocations: [
      { id: "loc-1", name: "Chastain Park Tennis Center", address: "315 West Wieuca Rd NW, Atlanta, GA 30342", memberFee: 5, nonMemberFee: 10, courtFeeEnabled: true },
      { id: "loc-2", name: "Blackburn Park", address: "3493 Ashford Dunwoody Rd NE, Atlanta, GA 30319", memberFee: 0, nonMemberFee: 0, courtFeeEnabled: false },
      { id: "loc-3", name: "Freedom Park", address: "800 Freedom Pkwy NE, Atlanta, GA 30307", memberFee: 0, nonMemberFee: 0, courtFeeEnabled: false },
    ],
  });

  await db.insert(usersTable).values([
    { name: "Admin User", username: "admin", passwordHash: await hashPassword("admin123"), role: "admin" },
    { name: "Organizer One", username: "organizer1", passwordHash: await hashPassword("org123"), role: "event_organizer" },
    { name: "Participant User", username: "participant1", passwordHash: await hashPassword("part123"), role: "event_participant" },
  ]);

  const [ev1, ev3] = await db.insert(eventsRotatingTable).values([
    {
      name: "Chastain Park Rotating Mixer",
      description: "Open rotating format — all skill levels welcome. Bring your own paddle.",
      startDatetime: new Date("2026-06-14T09:00:00Z"),
      endDatetime: new Date("2026-06-14T12:00:00Z"),
      locationName: "Chastain Park Tennis Center",
      locationAddress: "315 West Wieuca Rd NW, Atlanta, GA 30342",
      ratingTypeRequired: "dupr" as const,
      minParticipants: 8,
      maxParticipants: 24,
      waitlistEnabled: true,
      requireApproval: "none" as const,
      signupStartDatetime: new Date("2026-05-25T00:00:00Z"),
      signupEndDatetime: new Date("2026-06-13T23:59:00Z"),
      status: "upcoming" as const,
      courtFeeEnabled: true,
      memberFee: 5,
      nonMemberFee: 10,
    },
    {
      name: "Freedom Park Beginner Clinic",
      description: "Beginner-friendly rotating session. Instruction provided by certified coach.",
      startDatetime: new Date("2026-07-05T08:00:00Z"),
      endDatetime: new Date("2026-07-05T10:00:00Z"),
      locationName: "Freedom Park",
      locationAddress: "800 Freedom Pkwy NE, Atlanta, GA 30307",
      ratingTypeRequired: "none" as const,
      minParticipants: 4,
      maxParticipants: 16,
      waitlistEnabled: false,
      requireApproval: "none" as const,
      signupStartDatetime: new Date("2026-06-15T00:00:00Z"),
      signupEndDatetime: new Date("2026-07-04T23:59:00Z"),
      status: "upcoming" as const,
    },
  ]).returning();

  const [ev2] = await db.insert(eventsFixedTable).values([
    {
      name: "Blackburn Park Fixed-Partner Tournament",
      description: "Register with your partner. DUPR-rated. Singles bracket available.",
      startDatetime: new Date("2026-06-21T10:00:00Z"),
      endDatetime: new Date("2026-06-21T16:00:00Z"),
      locationName: "Blackburn Park",
      locationAddress: "3493 Ashford Dunwoody Rd NE, Atlanta, GA 30319",
      ratingTypeRequired: "dupr" as const,
      minTeams: 4,
      maxTeams: 16,
      waitlistEnabled: true,
      requireApproval: "all" as const,
      signupStartDatetime: new Date("2026-06-01T00:00:00Z"),
      signupEndDatetime: new Date("2026-06-20T23:59:00Z"),
      status: "upcoming" as const,
    },
  ]).returning();

  await db.insert(membersTable).values([
    { duprId: "DUPR-001", playerName: "Alice Chen",    doubleRating: "4.25", singleRating: "4.10", email: "alice.chen@gmail.com",      phone: "404-555-0101" },
    { duprId: "DUPR-002", playerName: "Bob Martinez",  doubleRating: "3.80", singleRating: "3.70", email: "bob.martinez@gmail.com",    phone: "404-555-0102" },
    { duprId: "DUPR-003", playerName: "Carol Smith",   doubleRating: "4.50", singleRating: "4.40", email: "carol.smith@outlook.com",   phone: "770-555-0103" },
    { duprId: "DUPR-004", playerName: "David Park",    doubleRating: "3.20", singleRating: "3.10", email: "david.park@yahoo.com",      phone: "678-555-0104" },
    { duprId: "DUPR-005", playerName: "Emma Wilson",   doubleRating: "4.75", singleRating: "4.60", email: "emma.wilson@gmail.com",     phone: "404-555-0105" },
    { duprId: "DUPR-006", playerName: "Frank Lee",     doubleRating: "3.60", singleRating: "3.50", email: "frank.lee@outlook.com",     phone: "770-555-0106" },
    { duprId: "DUPR-007", playerName: "Grace Kim",     doubleRating: "4.10", singleRating: "4.00", email: "grace.kim@gmail.com",       phone: "678-555-0107" },
    { duprId: "DUPR-008", playerName: "Henry Brown",   doubleRating: "3.90", singleRating: "3.80", email: "henry.brown@yahoo.com",     phone: "404-555-0108" },
    { duprId: "DUPR-009", playerName: "Isabel Torres", doubleRating: "4.30", singleRating: "4.20", email: "isabel.torres@gmail.com",   phone: "770-555-0109" },
    { duprId: "DUPR-010", playerName: "Jack Davis",    doubleRating: "3.50", singleRating: "3.40", email: "jack.davis@outlook.com",    phone: "678-555-0110" },
  ]);

  await db.insert(registrationsTable).values([
    { eventId: ev1.id, eventType: "rotating", memberDuprId: "DUPR-001", status: "confirmed", playerSnapshot: { playerName: "Alice Chen", doubleRating: "4.25", singleRating: "4.10", selfRating: null, email: "alice.chen@gmail.com", phone: "404-555-0101" } },
    { eventId: ev1.id, eventType: "rotating", memberDuprId: "DUPR-002", status: "confirmed", playerSnapshot: { playerName: "Bob Martinez", doubleRating: "3.80", singleRating: "3.70", selfRating: null, email: "bob.martinez@gmail.com", phone: "404-555-0102" } },
    { eventId: ev1.id, eventType: "rotating", memberDuprId: "DUPR-003", status: "waitlisted", playerSnapshot: { playerName: "Carol Smith", doubleRating: "4.50", singleRating: "4.40", selfRating: null, email: "carol.smith@outlook.com", phone: "770-555-0103" } },
    { eventId: ev2.id, eventType: "fixed_partner", memberDuprId: "DUPR-004", status: "pending_approval", playerSnapshot: { playerName: "David Park", doubleRating: "3.20", singleRating: "3.10", selfRating: null, email: "david.park@yahoo.com", phone: "678-555-0104" } },
    { eventId: ev2.id, eventType: "fixed_partner", memberDuprId: "DUPR-005", status: "confirmed", playerSnapshot: { playerName: "Emma Wilson", doubleRating: "4.75", singleRating: "4.60", selfRating: null, email: "emma.wilson@gmail.com", phone: "404-555-0105" } },
    { eventId: ev3.id, eventType: "rotating", memberDuprId: "DUPR-007", status: "confirmed", playerSnapshot: { playerName: "Grace Kim", doubleRating: "4.10", singleRating: "4.00", selfRating: null, email: "grace.kim@gmail.com", phone: "678-555-0107" } },
  ]);

  console.log("Seed complete: 1 app_settings row, 3 users, 10 members, 3 events, 6 registrations.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
