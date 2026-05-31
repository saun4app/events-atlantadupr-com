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
  if (b.minTeams !== undefined) {
    if (typeof b.minTeams !== "number" || !Number.isInteger(b.minTeams) || b.minTeams < 1) {
      return "minTeams must be an integer >= 1";
    }
  }
  if (b.maxTeams !== undefined) {
    if (typeof b.maxTeams !== "number" || !Number.isInteger(b.maxTeams) || b.maxTeams < 1) {
      return "maxTeams must be an integer >= 1";
    }
  }
  const minT = typeof b.minTeams === "number" ? b.minTeams : null;
  const maxT = typeof b.maxTeams === "number" ? b.maxTeams : null;
  if (minT !== null && maxT !== null && maxT < minT) {
    return "maxTeams must be >= minTeams";
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
  if (b.defaultLocations !== undefined) {
    if (!Array.isArray(b.defaultLocations)) return "defaultLocations must be an array";
    for (let i = 0; i < b.defaultLocations.length; i++) {
      const loc = b.defaultLocations[i];
      if (typeof loc !== "object" || loc === null) return `defaultLocations[${i}] must be an object`;
      if (typeof (loc as any).id !== "string" || !(loc as any).id.trim()) {
        return `defaultLocations[${i}].id is required`;
      }
      if (typeof (loc as any).name !== "string" || !(loc as any).name.trim()) {
        return `defaultLocations[${i}].name is required`;
      }
      if (typeof (loc as any).address !== "string") {
        return `defaultLocations[${i}].address must be a string`;
      }
    }
  }
  if (b.maintenanceMode !== undefined && typeof b.maintenanceMode !== "boolean") {
    return "maintenanceMode must be a boolean";
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
    minTeams,
    maxTeams,
    contactPersons,
    defaultLocations,
    maintenanceMode,
  } = req.body as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (defaultTimezone !== undefined) updates.defaultTimezone = defaultTimezone;
  if (rotatingPartnersDescription !== undefined) updates.rotatingPartnersDescription = rotatingPartnersDescription;
  if (fixedPartnerDescription !== undefined) updates.fixedPartnerDescription = fixedPartnerDescription;
  if (minParticipants !== undefined) updates.minParticipants = minParticipants;
  if (maxParticipants !== undefined) updates.maxParticipants = maxParticipants;
  if (minTeams !== undefined) updates.minTeams = minTeams;
  if (maxTeams !== undefined) updates.maxTeams = maxTeams;
  if (contactPersons !== undefined) updates.contactPersons = contactPersons;
  if (maintenanceMode !== undefined) updates.maintenanceMode = maintenanceMode;
  if (defaultLocations !== undefined) {
    updates.defaultLocations = (defaultLocations as any[]).map((loc: any) => ({
      id: String(loc.id).trim(),
      name: String(loc.name).trim(),
      address: String(loc.address ?? "").trim(),
    }));
  }

  const [updated] = await db
    .insert(appSettingsTable)
    .values({ id: 1, ...updates })
    .onConflictDoUpdate({ target: appSettingsTable.id, set: updates })
    .returning();

  return res.json(updated);
});

export default router;
