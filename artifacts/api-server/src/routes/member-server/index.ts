import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../../lib/auth.js";
import { USER_ROLE_IDS } from "../../lib/user-roles.js";
import { parseCsvRecords } from "./csv.js";

const router = Router();

router.get("/", async (req, res) => {
  const { search, sortBy, sortDir } = req.query as Record<string, string>;

  let rows = await db.select().from(membersTable);

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.duprId.toLowerCase().includes(q),
    );
  }

  if (sortBy) {
    const dir = sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const av = (a as any)[sortBy] ?? "";
      const bv = (b as any)[sortBy] ?? "";
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  return res.json(rows);
});

router.post("/", requireRole(USER_ROLE_IDS.app_admin), async (req, res) => {
  const { duprId, name, doubles, doublesReliability, singles, singlesReliability, selfRating, email, phone } = req.body;
  if (!duprId || !name) {
    return res.status(400).json({ error: "duprId and name are required" });
  }

  const [member] = await db
    .insert(membersTable)
    .values({ duprId, name, doubles, doublesReliability, singles, singlesReliability, selfRating, email: email || null, phone: phone || null })
    .onConflictDoUpdate({
      target: membersTable.duprId,
      set: {
        name,
        doubles,
        doublesReliability,
        singles,
        singlesReliability,
        selfRating,
        email: email || null,
        phone: phone || null,
      },
    })
    .returning();

  return res.status(201).json(member);
});

router.delete("/", requireRole(USER_ROLE_IDS.app_admin), async (_req, res) => {
  // Registrations carry their own self-contained snapshots, so clearing the
  // member list no longer affects existing registrations or events.
  await db.delete(membersTable);
  return res.status(204).send();
});

router.post("/csv", requireRole(USER_ROLE_IDS.app_admin), async (req, res) => {
  const csvText = req.body as string;
  if (!csvText || typeof csvText !== "string") {
    return res.status(400).json({ error: "CSV content required" });
  }

  let records: string[][];
  try {
    records = parseCsvRecords(csvText.replace(/^\uFEFF/, "")).filter((row) =>
      row.some((field) => field.trim() !== ""),
    );
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid CSV content",
    });
  }

  if (records.length < 2) {
    return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
  }

  const headers = records[0].map((h) => h.trim().toLowerCase());
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < records.length; i++) {
    const cols = records[i].map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });

    const duprId = row["dupr_id"] || row["duprid"] || row["dupr id"];
    const name = row["name"] || row["player_name"] || row["playername"];

    if (!duprId || !name) {
      errors.push(`Row ${i + 1}: Missing dupr_id or name`);
      skipped++;
      continue;
    }

    const dRelRaw = row["doubles_reliability"] || row["double_reliability"] || row["doublesreliability"] || row["doublereliability"];
    const sRelRaw = row["singles_reliability"] || row["single_reliability"] || row["singlesreliability"] || row["singlereliability"];

    try {
      await db
        .insert(membersTable)
        .values({
          duprId,
          name,
          doubles: row["doubles"] || row["double_rating"] || row["doublerating"] || null,
          doublesReliability: dRelRaw ? parseInt(dRelRaw) : null,
          singles: row["singles"] || row["single_rating"] || row["singlerating"] || null,
          singlesReliability: sRelRaw ? parseInt(sRelRaw) : null,
          selfRating: row["self_rating"] || row["selfrating"] || null,
          email: row["email"] || null,
          phone: row["phone"] || null,
        })
        .onConflictDoUpdate({
          target: membersTable.duprId,
          set: {
            doubles: row["doubles"] || row["double_rating"] || row["doublerating"] || null,
            doublesReliability: dRelRaw ? parseInt(dRelRaw) : null,
            singles: row["singles"] || row["single_rating"] || row["singlerating"] || null,
            singlesReliability: sRelRaw ? parseInt(sRelRaw) : null,
          },
        });
      imported++;
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`);
      skipped++;
    }
  }

  return res.json({ imported, skipped, removed: 0, regSkipped: [], errors });
});

router.get("/:duprId", async (req, res) => {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.duprId, req.params.duprId));
  if (!member) return res.status(404).json({ error: "Member not found" });
  return res.json(member);
});

router.patch("/:duprId", requireRole(USER_ROLE_IDS.app_admin), async (req, res) => {
  const duprId = String(req.params.duprId);
  const [existing] = await db.select().from(membersTable).where(eq(membersTable.duprId, duprId));
  if (!existing) return res.status(404).json({ error: "Member not found" });

  const { name, doubles, doublesReliability, singles, singlesReliability, selfRating, email, phone } = req.body;
  const updates: Partial<typeof existing> = {};
  if (name !== undefined) updates.name = name;
  if (doubles !== undefined) updates.doubles = doubles;
  if (doublesReliability !== undefined) updates.doublesReliability = doublesReliability;
  if (singles !== undefined) updates.singles = singles;
  if (singlesReliability !== undefined) updates.singlesReliability = singlesReliability;
  if (selfRating !== undefined) updates.selfRating = selfRating;
  if (email !== undefined) updates.email = email || null;
  if (phone !== undefined) updates.phone = phone || null;

  const [updated] = await db.update(membersTable).set(updates).where(eq(membersTable.duprId, duprId)).returning();
  return res.json(updated);
});

router.delete("/:duprId", requireRole(USER_ROLE_IDS.app_admin), async (req, res) => {
  const duprId = String(req.params.duprId);
  const [existing] = await db.select().from(membersTable).where(eq(membersTable.duprId, duprId));
  if (!existing) return res.status(404).json({ error: "Member not found" });
  // Registrations carry their own snapshots, so deleting a member never affects
  // existing registrations.
  await db.delete(membersTable).where(eq(membersTable.duprId, duprId));
  return res.status(204).send();
});

export default router;
