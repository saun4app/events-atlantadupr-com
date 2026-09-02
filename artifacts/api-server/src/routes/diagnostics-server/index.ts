import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { emailSendFailuresTable } from "@workspace/db";
import { gte, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { USER_ROLE_GROUPS } from "../../lib/user-roles.js";

const router = Router();

router.get(
  "/email-failures",
  requireAuth,
  requireRole(...USER_ROLE_GROUPS.eventManagers),
  async (_req: Request, res: Response) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failures = await db
      .select()
      .from(emailSendFailuresTable)
      .where(gte(emailSendFailuresTable.occurredAt, since))
      .orderBy(desc(emailSendFailuresTable.occurredAt));

    return res.json({
      count: failures.length,
      failures: failures.map((f) => ({
        id: f.id,
        recipientAddress: f.recipientAddress,
        eventName: f.eventName ?? null,
        errorMessage: f.errorMessage,
        occurredAt: f.occurredAt.toISOString(),
      })),
    });
  },
);

export default router;
