import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../../lib/auth.js";
import { USER_ROLE_IDS } from "../../lib/user-roles.js";

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

  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const errors: string[] = [];
  const csvDuprIds: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
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

    csvDuprIds.push(duprId);

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
            name,
            doubles: row["doubles"] || row["double_rating"] || row["doublerating"] || null,
            doublesReliability: dRelRaw ? parseInt(dRelRaw) : null,
            singles: row["singles"] || row["single_rating"] || row["singlerating"] || null,
            singlesReliability: sRelRaw ? parseInt(sRelRaw) : null,
            selfRating: row["self_rating"] || row["selfrating"] || null,
            email: row["email"] || null,
            phone: row["phone"] || null,
          },
        });
      imported++;
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`);
      skipped++;
    }
  }

  // Remove existing members that are not in the CSV. Registrations keep their
  // own snapshots, so removing a member never affects existing registrations.
  let removed = 0;
  const regSkipped: string[] = [];
  if (csvDuprIds.length > 0) {
    const allMembers = await db.select().from(membersTable);
    const csvIdSet = new Set(csvDuprIds);
    for (const m of allMembers) {
      if (!csvIdSet.has(m.duprId)) {
        await db.delete(membersTable).where(eq(membersTable.duprId, m.duprId));
        removed++;
      }
    }
  }

  return res.json({ imported, skipped, removed, regSkipped, errors });
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
