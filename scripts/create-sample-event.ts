/**
 * create-sample-event.ts
 *
 * One-time script: creates a "Saturday Morning Round Robin" rotating event at
 * Chastain Park and registers six existing members (5 confirmed + 1 waitlisted).
 *
 * Run: pnpm --filter @workspace/db tsx scripts/create-sample-event.ts
 *
 * This script is idempotent — it skips insertion if an event with the same
 * name already exists.
 */

import { db } from "../lib/db/src/index.js";
import {
  eventsRotatingTable,
  registrationsTable,
  membersTable,
  type RegistrantSnapshot,
} from "../lib/db/src/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
  // Check if event already exists
  const existing = await db
    .select()
    .from(eventsRotatingTable)
    .where(eq(eventsRotatingTable.name, "Saturday Morning Round Robin"));

  let eventId: number;

  if (existing.length > 0) {
    eventId = existing[0].id;
    console.log(`Event already exists (id=${eventId}), skipping creation.`);
  } else {
    const [event] = await db
      .insert(eventsRotatingTable)
      .values({
        name: "Saturday Morning Round Robin",
        description:
          "Join us for a fun rotating-partner round robin at Chastain Park. All DUPR-rated players welcome. Bring your paddle and sunscreen!",
        startDatetime: new Date("2026-06-20T13:00:00Z"),
        endDatetime: new Date("2026-06-20T16:00:00Z"),
        locationName: "Chastain Park Tennis Center",
        locationAddress: "315 West Wieuca Rd NW, Atlanta, GA 30342",
        ratingTypeRequired: "dupr" as const,
        minParticipants: 8,
        maxParticipants: 20,
        waitlistEnabled: true,
        requireApproval: "none",
        signupStartDatetime: new Date("2026-06-02T00:00:00Z"),
        signupEndDatetime: new Date("2026-06-19T23:59:00Z"),
        status: "upcoming" as const,
        courtFeeEnabled: true,
        memberFee: 5,
        nonMemberFee: 10,
      })
      .returning();

    eventId = event.id;
    console.log(`Created event id=${eventId}`);
  }

  // Pick the first 6 real members in the DB
  const members = await db.select().from(membersTable).limit(6);
  if (members.length < 6) {
    console.warn("Fewer than 6 members found — skipping registration step.");
    return;
  }

  const statuses: Array<"confirmed" | "waitlisted"> = [
    "confirmed",
    "confirmed",
    "confirmed",
    "confirmed",
    "confirmed",
    "waitlisted",
  ];

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const duprId = member.duprId;
    const existing = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, eventId),
          eq(registrationsTable.eventType, "rotating"),
          eq(registrationsTable.memberDuprId, duprId),
        ),
      );

    if (existing.length > 0) {
      console.log(`  ${duprId} already registered, skipping.`);
      continue;
    }

    const playerSnapshot: RegistrantSnapshot = {
      name: member.name,
      doubles: member.doubles ?? null,
      singles: member.singles ?? null,
      selfRating: null,
      email: member.email ?? null,
      phone: member.phone ?? null,
    };

    await db.insert(registrationsTable).values({
      eventId,
      eventType: "rotating",
      memberDuprId: duprId,
      playerSnapshot,
      status: statuses[i],
    });
    console.log(`  Registered ${member.name} (${duprId}) as ${statuses[i]}`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
