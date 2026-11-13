import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../../lib/auth.js";
import { USER_ROLE_IDS } from "../../lib/user-roles.js";
import { parseCsvRecords } from "./csv.js";

const router = Router();

function parseCsvReliability(value: string, fieldName: string): number | null {
  if (!value) return null;

  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be a whole number from 0 to 100`);
  }

  const reliability = Number(value);
  if (reliability > 100) {
    throw new Error(`Invalid ${fieldName}: must be a whole number from 0 to 100`);
  }

  return reliability;
}

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

  const rows = records.slice(1).map((record, index) => {
    const cols = record.map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });

    return {
      rowNumber: index + 2,
      row,
      duprId: row["dupr_id"] || row["duprid"] || row["dupr id"],
      name: row["name"] || row["player_name"] || row["playername"],
    };
  });
  const rowsByDuprId = new Map<string, number[]>();
  for (const { duprId, rowNumber } of rows) {
    if (!duprId) continue;
    const matchingRows = rowsByDuprId.get(duprId) ?? [];
    matchingRows.push(rowNumber);
    rowsByDuprId.set(duprId, matchingRows);
  }

  try {
    await db.transaction(async (tx) => {
      for (const { rowNumber, row, duprId, name } of rows) {
        if (!duprId || !name) {
          errors.push(`Row ${rowNumber}: Missing dupr_id or name`);
          skipped++;
          continue;
        }

        const matchingRows = rowsByDuprId.get(duprId) ?? [];
        if (matchingRows.length > 1) {
          const otherRows = matchingRows.filter((number) => number !== rowNumber);
          errors.push(
            `Row ${rowNumber}: Duplicate dupr_id "${duprId}" also appears on row${otherRows.length === 1 ? "" : "s"} ${otherRows.join(", ")}`,
          );
          skipped++;
          continue;
        }

        const dRelRaw = row["doubles_reliability"] || row["double_reliability"] || row["doublesreliability"] || row["doublereliability"];
        const sRelRaw = row["singles_reliability"] || row["single_reliability"] || row["singlesreliability"] || row["singlereliability"];
        let doublesReliability: number | null;
        let singlesReliability: number | null;
        try {
          doublesReliability = parseCsvReliability(dRelRaw ?? "", "doubles_reliability");
          singlesReliability = parseCsvReliability(sRelRaw ?? "", "singles_reliability");
        } catch (error) {
          errors.push(`Row ${rowNumber}: ${error instanceof Error ? error.message : "Invalid reliability value"}`);
          skipped++;
          continue;
        }

        const doubles = row["doubles"] || row["double_rating"] || row["doublerating"] || null;
        const singles = row["singles"] || row["single_rating"] || row["singlerating"] || null;
        await tx
          .insert(membersTable)
          .values({
            duprId,
            name,
            doubles,
            doublesReliability,
            singles,
            singlesReliability,
            selfRating: row["self_rating"] || row["selfrating"] || null,
            email: row["email"] || null,
            phone: row["phone"] || null,
          })
          .onConflictDoUpdate({
            target: membersTable.duprId,
            set: {
              doubles,
              doublesReliability,
              singles,
              singlesReliability,
            },
          });
        imported++;
      }
    });
  } catch {
    return res.status(500).json({
      error: "CSV import failed; no member changes were saved",
    });
  }

  return res.json({ imported, skipped, removed: 0, regSkipped: [], errors });
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
