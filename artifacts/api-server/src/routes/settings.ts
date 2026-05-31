import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { requireRole } from "../lib/auth.js";
import { sql } from "drizzle-orm";

const router = Router();

async function getOrCreateSettings() {
  const [existing] = await db.select().from(appSettingsTable).where(sql`id = 1`);
  if (existing) return existing;
  const [created] = await db.insert(appSettingsTable).values({ id: 1 }).returning();
  return created;
}

router.get("/", async (_req, res) => {
  const settings = await getOrCreateSettings();
  return res.json(settings);
});

router.put("/", requireRole("admin"), async (req, res) => {
  const {
    defaultTimezone,
    rotatingPartnersDescription,
    fixedPartnerDescription,
    minParticipants,
    maxParticipants,
    contactPersons,
  } = req.body;

  await getOrCreateSettings();

  const updates: Record<string, unknown> = {};
  if (defaultTimezone !== undefined) updates.defaultTimezone = defaultTimezone;
  if (rotatingPartnersDescription !== undefined) updates.rotatingPartnersDescription = rotatingPartnersDescription;
  if (fixedPartnerDescription !== undefined) updates.fixedPartnerDescription = fixedPartnerDescription;
  if (minParticipants !== undefined) updates.minParticipants = minParticipants;
  if (maxParticipants !== undefined) updates.maxParticipants = maxParticipants;
  if (contactPersons !== undefined) updates.contactPersons = contactPersons;

  const [updated] = await db
    .update(appSettingsTable)
    .set(updates)
    .where(sql`id = 1`)
    .returning();

  return res.json(updated);
});

export default router;
