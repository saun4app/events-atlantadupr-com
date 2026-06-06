/**
 * create-nr-approval-event.ts
 *
 * Creates a dummy NR-approval event with a mix of confirmed, pending, and approved players.
 * Run: pnpm --filter @workspace/db seed (or node --import tsx/esm src/create-nr-approval-event.ts)
 */

import { db } from "./index.js";
import { eventsRotatingTable, registrationsTable, membersTable } from "./schema/index.js";
import { eq, and } from "drizzle-orm";

const EVENT_TYPE = "rotating" as const;

async function main() {
  const eventName = "NR Approval Test \u2014 Mixed Roster";

  const existing = await db
    .select()
    .from(eventsRotatingTable)
    .where(eq(eventsRotatingTable.name, eventName));

  let eventId: number;

  if (existing.length > 0) {
    eventId = existing[0].id;
    console.log(`Event already exists (id=${eventId}), skipping creation.`);
  } else {
    const [event] = await db
      .insert(eventsRotatingTable)
      .values({
        name: eventName,
        description:
          "Dummy event for testing NR-only approval. Mix of rated (confirmed), NR (pending), and some approved players.",
        startDatetime: new Date("2026-06-28T18:00:00Z"),
        endDatetime: new Date("2026-06-28T20:00:00Z"),
        locationName: "Freedom Park",
        locationAddress: "800 Freedom Pkwy NE, Atlanta, GA 30307",
        ratingTypeRequired: "none" as const,
        minParticipants: 4,
        maxParticipants: 16,
        waitlistEnabled: true,
        requireApproval: "nr_only",
        signupStartDatetime: new Date("2026-06-01T00:00:00Z"),
        signupEndDatetime: new Date("2026-06-27T23:59:00Z"),
        status: "upcoming" as const,
        courtFeeEnabled: false,
        memberFee: 0,
        nonMemberFee: 0,
      })
      .returning();

    eventId = event.id;
    console.log(`Created event id=${eventId}`);
  }

  const allMembers = await db.select().from(membersTable);

  const nrMembers = allMembers
    .filter(
      (m) =>
        m.doubleRating === null ||
        m.doubleRating === "NR" ||
        m.doubleRating === "NR (2.5)" ||
        isNaN(parseFloat(m.doubleRating || "")),
    )
    .slice(0, 3);

  const ratedMembers = allMembers
    .filter(
      (m) =>
        m.doubleRating !== null &&
        m.doubleRating !== "NR" &&
        m.doubleRating !== "NR (2.5)" &&
        !isNaN(parseFloat(m.doubleRating)),
    )
    .slice(0, 3);

  console.log(`NR members: ${nrMembers.map((m) => m.playerName).join(", ")}`);
  console.log(`Rated members: ${ratedMembers.map((m) => m.playerName).join(", ")}`);

  for (const member of nrMembers) {
    const existingReg = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, eventId),
          eq(registrationsTable.eventType, EVENT_TYPE),
          eq(registrationsTable.memberDuprId, member.duprId),
        ),
      );

    if (existingReg.length > 0) {
      console.log(`  ${member.duprId} already registered, skipping.`);
      continue;
    }

    await db.insert(registrationsTable).values({
      eventId,
      eventType: EVENT_TYPE,
      memberDuprId: member.duprId,
      status: "pending_approval",
    });
    console.log(`  Registered ${member.playerName} (${member.duprId}) as pending_approval`);
  }

  for (const member of ratedMembers) {
    const existingReg = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, eventId),
          eq(registrationsTable.eventType, EVENT_TYPE),
          eq(registrationsTable.memberDuprId, member.duprId),
        ),
      );

    if (existingReg.length > 0) {
      console.log(`  ${member.duprId} already registered, skipping.`);
      continue;
    }

    await db.insert(registrationsTable).values({
      eventId,
      eventType: EVENT_TYPE,
      memberDuprId: member.duprId,
      status: "confirmed",
    });
    console.log(`  Registered ${member.playerName} (${member.duprId}) as confirmed`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
