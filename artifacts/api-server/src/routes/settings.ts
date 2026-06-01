import { Router } from "express";
import { db, appSettingsTable, DEFAULT_RATING_REQUIREMENTS_CONFIG } from "@workspace/db";
import { requireRole } from "../lib/auth.js";

const router = Router();

const VALID_TIMEZONES = new Set([
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu",
]);

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateRatingRequirementsConfig(cfg: unknown): string | null {
  if (typeof cfg !== "object" || cfg === null) return "ratingRequirementsConfig must be an object";
  const c = cfg as Record<string, unknown>;

  if (c.dupr !== undefined) {
    const d = c.dupr as Record<string, unknown>;
    if (typeof d !== "object" || d === null) return "ratingRequirementsConfig.dupr must be an object";
    if (d.enabled !== undefined && typeof d.enabled !== "boolean") return "ratingRequirementsConfig.dupr.enabled must be boolean";
    if (d.minAllowed !== undefined && (typeof d.minAllowed !== "number" || d.minAllowed < 2.0 || d.minAllowed > 8.0)) return "ratingRequirementsConfig.dupr.minAllowed must be 2.0–8.0";
    if (d.maxAllowed !== undefined && (typeof d.maxAllowed !== "number" || d.maxAllowed < 2.0 || d.maxAllowed > 8.0)) return "ratingRequirementsConfig.dupr.maxAllowed must be 2.0–8.0";
    if (d.defaultMin !== undefined && typeof d.defaultMin !== "number") return "ratingRequirementsConfig.dupr.defaultMin must be a number";
    if (d.defaultMax !== undefined && typeof d.defaultMax !== "number") return "ratingRequirementsConfig.dupr.defaultMax must be a number";
    if (d.defaultNrAllowed !== undefined && typeof d.defaultNrAllowed !== "boolean") return "ratingRequirementsConfig.dupr.defaultNrAllowed must be boolean";
  }

  if (c.selfNumeric !== undefined) {
    const s = c.selfNumeric as Record<string, unknown>;
    if (typeof s !== "object" || s === null) return "ratingRequirementsConfig.selfNumeric must be an object";
    if (s.enabled !== undefined && typeof s.enabled !== "boolean") return "ratingRequirementsConfig.selfNumeric.enabled must be boolean";
    if (s.minAllowed !== undefined && (typeof s.minAllowed !== "number" || s.minAllowed < 2.0 || s.minAllowed > 6.0)) return "ratingRequirementsConfig.selfNumeric.minAllowed must be 2.0–6.0";
    if (s.maxAllowed !== undefined && (typeof s.maxAllowed !== "number" || s.maxAllowed < 2.0 || s.maxAllowed > 6.0)) return "ratingRequirementsConfig.selfNumeric.maxAllowed must be 2.0–6.0";
    if (s.defaultMin !== undefined && typeof s.defaultMin !== "number") return "ratingRequirementsConfig.selfNumeric.defaultMin must be a number";
    if (s.defaultMax !== undefined && typeof s.defaultMax !== "number") return "ratingRequirementsConfig.selfNumeric.defaultMax must be a number";
  }

  if (c.selfSkill !== undefined) {
    const ss = c.selfSkill as Record<string, unknown>;
    if (typeof ss !== "object" || ss === null) return "ratingRequirementsConfig.selfSkill must be an object";
    if (ss.enabled !== undefined && typeof ss.enabled !== "boolean") return "ratingRequirementsConfig.selfSkill.enabled must be boolean";
    if (ss.levels !== undefined) {
      if (!Array.isArray(ss.levels)) return "ratingRequirementsConfig.selfSkill.levels must be an array";
      for (let i = 0; i < ss.levels.length; i++) {
        const lv = ss.levels[i];
        if (typeof lv !== "object" || lv === null) return `selfSkill.levels[${i}] must be an object`;
        if (typeof (lv as any).text !== "string" || !(lv as any).text.trim()) return `selfSkill.levels[${i}].text is required`;
        if (typeof (lv as any).level !== "number" || !Number.isInteger((lv as any).level) || (lv as any).level < 1) return `selfSkill.levels[${i}].level must be a positive integer`;
      }
    }
    if (ss.defaultMinLevel !== undefined && (typeof ss.defaultMinLevel !== "number" || !Number.isInteger(ss.defaultMinLevel) || ss.defaultMinLevel < 1)) return "ratingRequirementsConfig.selfSkill.defaultMinLevel must be a positive integer";
    if (ss.defaultMaxLevel !== undefined && (typeof ss.defaultMaxLevel !== "number" || !Number.isInteger(ss.defaultMaxLevel) || ss.defaultMaxLevel < 1)) return "ratingRequirementsConfig.selfSkill.defaultMaxLevel must be a positive integer";
    const minLv = typeof ss.defaultMinLevel === "number" ? ss.defaultMinLevel : null;
    const maxLv = typeof ss.defaultMaxLevel === "number" ? ss.defaultMaxLevel : null;
    if (minLv !== null && maxLv !== null && minLv > maxLv) return "ratingRequirementsConfig.selfSkill.defaultMinLevel must be <= defaultMaxLevel";
  }

  return null;
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
      if ((loc as any).memberFee !== undefined && typeof (loc as any).memberFee !== "number") {
        return `defaultLocations[${i}].memberFee must be a number`;
      }
      if ((loc as any).nonMemberFee !== undefined && typeof (loc as any).nonMemberFee !== "number") {
        return `defaultLocations[${i}].nonMemberFee must be a number`;
      }
      if ((loc as any).courtFeeEnabled !== undefined && typeof (loc as any).courtFeeEnabled !== "boolean") {
        return `defaultLocations[${i}].courtFeeEnabled must be a boolean`;
      }
    }
  }
  if (b.maintenanceMode !== undefined && typeof b.maintenanceMode !== "boolean") {
    return "maintenanceMode must be a boolean";
  }
  if (b.defaultEventDurationHours !== undefined) {
    if (typeof b.defaultEventDurationHours !== "number" || !Number.isInteger(b.defaultEventDurationHours) || b.defaultEventDurationHours < 1) {
      return "defaultEventDurationHours must be an integer >= 1";
    }
  }
  if (b.defaultEventNames !== undefined) {
    if (!Array.isArray(b.defaultEventNames)) return "defaultEventNames must be an array";
    for (let i = 0; i < b.defaultEventNames.length; i++) {
      if (typeof b.defaultEventNames[i] !== "string" || !b.defaultEventNames[i].trim()) {
        return `defaultEventNames[${i}] must be a non-empty string`;
      }
    }
  }
  if (b.defaultRatingRequirements !== undefined) {
    if (!Array.isArray(b.defaultRatingRequirements)) return "defaultRatingRequirements must be an array";
    const keys = new Set<string>();
    for (let i = 0; i < b.defaultRatingRequirements.length; i++) {
      const r = b.defaultRatingRequirements[i];
      if (typeof r !== "object" || r === null) return `defaultRatingRequirements[${i}] must be an object`;
      if (typeof (r as any).key !== "string" || !(r as any).key.trim()) {
        return `defaultRatingRequirements[${i}].key is required`;
      }
      if (typeof (r as any).label !== "string" || !(r as any).label.trim()) {
        return `defaultRatingRequirements[${i}].label is required`;
      }
      const trimmedKey = String((r as any).key).trim();
      if (keys.has(trimmedKey)) {
        return `defaultRatingRequirements: duplicate key "${trimmedKey}"`;
      }
      keys.add(trimmedKey);
    }
  }
  if (b.ratingRequirementsConfig !== undefined) {
    const err = validateRatingRequirementsConfig(b.ratingRequirementsConfig);
    if (err) return err;
  }
  return null;
}

router.get("/", async (_req, res) => {
  const [settings] = await db
    .insert(appSettingsTable)
    .values({ id: 1 })
    .onConflictDoUpdate({ target: appSettingsTable.id, set: { id: 1 } })
    .returning();

  const result = {
    ...settings,
    ratingRequirementsConfig: settings.ratingRequirementsConfig ?? DEFAULT_RATING_REQUIREMENTS_CONFIG,
  };

  return res.json(result);
});

router.put("/", requireRole("admin"), async (req, res) => {
  const validationError = validateSettingsInput(req.body);
  if (validationError) {
    console.error("[settings] Validation failed:", validationError);
    console.error("[settings] Body:", JSON.stringify(req.body, null, 2));
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
    defaultEventNames,
    defaultEventDurationHours,
    defaultRatingRequirements,
    ratingRequirementsConfig,
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
  if (defaultEventDurationHours !== undefined) updates.defaultEventDurationHours = defaultEventDurationHours;
  if (defaultEventNames !== undefined) {
    updates.defaultEventNames = (defaultEventNames as string[]).map((n: string) => n.trim()).filter(Boolean);
  }
  if (defaultLocations !== undefined) {
    updates.defaultLocations = (defaultLocations as any[]).map((loc: any) => ({
      id: String(loc.id).trim(),
      name: String(loc.name).trim(),
      address: String(loc.address ?? "").trim(),
      memberFee: typeof loc.memberFee === "number" ? loc.memberFee : 0,
      nonMemberFee: typeof loc.nonMemberFee === "number" ? loc.nonMemberFee : 0,
      courtFeeEnabled: typeof loc.courtFeeEnabled === "boolean" ? loc.courtFeeEnabled : false,
    }));
  }
  if (defaultRatingRequirements !== undefined) {
    updates.defaultRatingRequirements = (defaultRatingRequirements as any[]).map((r: any) => ({
      key: String(r.key).trim(),
      label: String(r.label).trim(),
    }));
  }
  if (ratingRequirementsConfig !== undefined) {
    updates.ratingRequirementsConfig = ratingRequirementsConfig;
  }

  const [updated] = await db
    .insert(appSettingsTable)
    .values({ id: 1, ...updates })
    .onConflictDoUpdate({ target: appSettingsTable.id, set: updates })
    .returning();

  return res.json({
    ...updated,
    ratingRequirementsConfig: updated.ratingRequirementsConfig ?? DEFAULT_RATING_REQUIREMENTS_CONFIG,
  });
});

export default router;
