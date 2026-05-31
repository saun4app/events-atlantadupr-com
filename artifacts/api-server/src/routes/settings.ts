import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { requireRole } from "../lib/auth.js";

const router = Router();

const VALID_TIMEZONES = new Set([
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu",
]);

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateSettingsInput(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "Request body must be an object";
  const b = body as Record<string, unknown>;

  if (b.defaultTimezone !== undefined) {
    if (typeof b.defaultTimezone !== "string") return "defaultTimezone must be a string";
    if (!VALID_TIMEZONES.has(b.defaultTimezone)) return `defaultTimezone must be one of: ${[...VALID_TIMEZONES].join(", ")}`;
  }
  if (b.rotatingPartnersDescription !== undefined && typeof b.rotatingPartnersDescription !== "string") {
    return "rotatingPartnersDescription must be a string";
  }
  if (b.fixedPartnerDescription !== undefined && typeof b.fixedPartnerDescription !== "string") {
    return "fixedPartnerDescription must be a string";
  }
  if (b.minParticipants !== undefined) {
    if (typeof b.minParticipants !== "number" || !Number.isInteger(b.minParticipants) || b.minParticipants < 2) {
      return "minParticipants must be an integer >= 2";
    }
  }
  if (b.maxParticipants !== undefined) {
    if (typeof b.maxParticipants !== "number" || !Number.isInteger(b.maxParticipants) || b.maxParticipants < 2) {
      return "maxParticipants must be an integer >= 2";
    }
  }
  const min = typeof b.minParticipants === "number" ? b.minParticipants : null;
  const max = typeof b.maxParticipants === "number" ? b.maxParticipants : null;
  if (min !== null && max !== null && max < min) {
    return "maxParticipants must be >= minParticipants";
  }
  if (b.contactPersons !== undefined) {
    if (!Array.isArray(b.contactPersons)) return "contactPersons must be an array";
    for (let i = 0; i < b.contactPersons.length; i++) {
      const c = b.contactPersons[i];
      if (typeof c !== "object" || c === null) return `contactPersons[${i}] must be an object`;
      if (typeof (c as any).name !== "string" || !(c as any).name.trim()) {
        return `contactPersons[${i}].name is required`;
      }
      if (typeof (c as any).email !== "string" || !validateEmail((c as any).email)) {
        return `contactPersons[${i}].email must be a valid email address`;
      }
    }
  }
  return null;
}

router.get("/", async (_req, res) => {
  const [settings] = await db
    .insert(appSettingsTable)
    .values({ id: 1 })
    .onConflictDoUpdate({ target: appSettingsTable.id, set: { id: 1 } })
    .returning();
  return res.json(settings);
});

router.put("/", requireRole("admin"), async (req, res) => {
  const validationError = validateSettingsInput(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const {
    defaultTimezone,
    rotatingPartnersDescription,
    fixedPartnerDescription,
    minParticipants,
    maxParticipants,
    contactPersons,
  } = req.body as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (defaultTimezone !== undefined) updates.defaultTimezone = defaultTimezone;
  if (rotatingPartnersDescription !== undefined) updates.rotatingPartnersDescription = rotatingPartnersDescription;
  if (fixedPartnerDescription !== undefined) updates.fixedPartnerDescription = fixedPartnerDescription;
  if (minParticipants !== undefined) updates.minParticipants = minParticipants;
  if (maxParticipants !== undefined) updates.maxParticipants = maxParticipants;
  if (contactPersons !== undefined) updates.contactPersons = contactPersons;

  const [updated] = await db
    .insert(appSettingsTable)
    .values({ id: 1, ...updates })
    .onConflictDoUpdate({ target: appSettingsTable.id, set: updates })
    .returning();

  return res.json(updated);
});

export default router;
