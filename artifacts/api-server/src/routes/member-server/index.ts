import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable, registrationsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireRole } from "../../lib/auth.js";

const router = Router();

router.get("/", async (req, res) => {
  const { search, sortBy, sortDir } = req.query as Record<string, string>;

  let rows = await db.select().from(membersTable);

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (m) =>
        m.playerName.toLowerCase().includes(q) || m.duprId.toLowerCase().includes(q),
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

router.post("/", requireRole("admin"), async (req, res) => {
  const { duprId, playerName, doubleRating, doubleReliability, singleRating, singleReliability, selfRating, email, phone } = req.body;
  if (!duprId || !playerName) {
    return res.status(400).json({ error: "duprId and playerName are required" });
  }

  const [member] = await db
    .insert(membersTable)
    .values({ duprId, playerName, doubleRating, doubleReliability, singleRating, singleReliability, selfRating, email: email || null, phone: phone || null })
    .onConflictDoUpdate({
      target: membersTable.duprId,
      set: {
        playerName,
        doubleRating,
        doubleReliability,
        singleRating,
        singleReliability,
        selfRating,
        email: email || null,
        phone: phone || null,
      },
    })
    .returning();

  return res.status(201).json(member);
});

router.delete("/", requireRole("admin"), async (req, res) => {
  const [result] = await db.select({ count: count() }).from(registrationsTable);
  if (result.count > 0) {
    return res.status(409).json({ error: "Cannot clear member list while event registrations exist. Registrations are linked to members and clearing the list would break these records." });
  }
  await db.delete(membersTable);
  return res.status(204).send();
});

router.post("/csv", requireRole("admin"), async (req, res) => {
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
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });

    const duprId = row["dupr_id"] || row["duprid"] || row["dupr id"];
    const playerName = row["player_name"] || row["playername"] || row["name"];

    if (!duprId || !playerName) {
      errors.push(`Row ${i + 1}: Missing dupr_id or player_name`);
      skipped++;
      continue;
    }

    try {
      await db
        .insert(membersTable)
        .values({
          duprId,
          playerName,
          doubleRating: row["double_rating"] || null,
          doubleReliability: row["double_reliability"] ? parseInt(row["double_reliability"]) : null,
          singleRating: row["single_rating"] || null,
          singleReliability: row["single_reliability"] ? parseInt(row["single_reliability"]) : null,
          selfRating: row["self_rating"] || null,
          email: row["email"] || null,
          phone: row["phone"] || null,
        })
        .onConflictDoUpdate({
          target: membersTable.duprId,
          set: {
            playerName,
            doubleRating: row["double_rating"] || null,
            doubleReliability: row["double_reliability"] ? parseInt(row["double_reliability"]) : null,
            singleRating: row["single_rating"] || null,
            singleReliability: row["single_reliability"] ? parseInt(row["single_reliability"]) : null,
            selfRating: row["self_rating"] || null,
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

  return res.json({ imported, skipped, errors });
});

router.get("/:duprId", async (req, res) => {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.duprId, req.params.duprId));
  if (!member) return res.status(404).json({ error: "Member not found" });
  return res.json(member);
});

router.patch("/:duprId", requireRole("admin"), async (req, res) => {
  const duprId = String(req.params.duprId);
  const [existing] = await db.select().from(membersTable).where(eq(membersTable.duprId, duprId));
  if (!existing) return res.status(404).json({ error: "Member not found" });

  const { playerName, doubleRating, doubleReliability, singleRating, singleReliability, selfRating, email, phone } = req.body;
  const updates: Partial<typeof existing> = {};
  if (playerName !== undefined) updates.playerName = playerName;
  if (doubleRating !== undefined) updates.doubleRating = doubleRating;
  if (doubleReliability !== undefined) updates.doubleReliability = doubleReliability;
  if (singleRating !== undefined) updates.singleRating = singleRating;
  if (singleReliability !== undefined) updates.singleReliability = singleReliability;
  if (selfRating !== undefined) updates.selfRating = selfRating;
  if (email !== undefined) updates.email = email || null;
  if (phone !== undefined) updates.phone = phone || null;

  const [updated] = await db.update(membersTable).set(updates).where(eq(membersTable.duprId, duprId)).returning();
  return res.json(updated);
});

router.delete("/:duprId", requireRole("admin"), async (req, res) => {
  const duprId = String(req.params.duprId);
  const [existing] = await db.select().from(membersTable).where(eq(membersTable.duprId, duprId));
  if (!existing) return res.status(404).json({ error: "Member not found" });
  const [regCount] = await db.select({ count: count() }).from(registrationsTable).where(eq(registrationsTable.memberDuprId, duprId));
  if (regCount.count > 0) {
    return res.status(409).json({ error: "Cannot delete this member because they have active event registrations. Cancel or remove their registrations first." });
  }
  await db.delete(membersTable).where(eq(membersTable.duprId, duprId));
  return res.status(204).send();
});

export default router;
