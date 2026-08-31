import { Router } from "express";
import { db, eventDefaultsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../../lib/auth.js";
import { fixedPartnerConfig } from "../../lib/fixed-partner-config.js";
import { USER_ROLE_IDS } from "../../lib/user-roles.js";

const router = Router();

const VALID_EVENT_TYPES = new Set(["rotating", fixedPartnerConfig.format]);

const DEFAULTS: Record<string, { minCapacity: number; maxCapacity: number }> = {
  rotating: { minCapacity: 8, maxCapacity: 24 },
  [fixedPartnerConfig.format]: {
    minCapacity: fixedPartnerConfig.defaults.capacity.minParticipants,
    maxCapacity: fixedPartnerConfig.defaults.capacity.maxParticipants,
  },
};

async function ensureRow(eventType: string) {
  const [row] = await db
    .insert(eventDefaultsTable)
    .values({ eventType, ...DEFAULTS[eventType] })
    .onConflictDoUpdate({ target: eventDefaultsTable.eventType, set: { eventType } })
    .returning();
  return row;
}

router.get("/:eventType", async (req, res) => {
  const eventType = String(req.params.eventType);
  if (!VALID_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "Invalid eventType" });
  }
  const row = await ensureRow(eventType);
  return res.json(row);
});

router.put("/:eventType", requireRole(USER_ROLE_IDS.admin), async (req, res) => {
  const eventType = String(req.params.eventType);
  if (!VALID_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "Invalid eventType" });
  }

  const b = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (b.minCapacity !== undefined) {
    if (typeof b.minCapacity !== "number" || !Number.isInteger(b.minCapacity) || b.minCapacity < 1) {
      return res.status(400).json({ error: "minCapacity must be an integer >= 1" });
    }
    updates.minCapacity = b.minCapacity;
  }
  if (b.maxCapacity !== undefined) {
    if (typeof b.maxCapacity !== "number" || !Number.isInteger(b.maxCapacity) || b.maxCapacity < 1) {
      return res.status(400).json({ error: "maxCapacity must be an integer >= 1" });
    }
    updates.maxCapacity = b.maxCapacity;
  }

  const min = typeof b.minCapacity === "number" ? b.minCapacity : null;
  const max = typeof b.maxCapacity === "number" ? b.maxCapacity : null;
  if (min !== null && max !== null && max < min) {
    return res.status(400).json({ error: "maxCapacity must be >= minCapacity" });
  }

  await ensureRow(eventType);
  const [updated] = await db
    .update(eventDefaultsTable)
    .set(updates)
    .where(eq(eventDefaultsTable.eventType, eventType))
    .returning();

  return res.json(updated);
});

export default router;
