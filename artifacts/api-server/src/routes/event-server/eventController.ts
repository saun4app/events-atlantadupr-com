import { Request, Response } from "express";
import { db } from "@workspace/db";
import {
  eventsRotatingTable,
  eventsFixedTable,
  registrationsTable,
  eventAssignmentsTable,
  type EventFormat,
  type EventRatingConfig,
} from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { fixedPartnerConfig, getFixedPartnerRequirement } from "../../lib/fixed-partner-config.js";
import {
  getRotatingPartnerRequirement,
  rotatingPartnerConfig,
} from "../../lib/rotating-partner-config.js";

const TEAM_CAPACITY_ENFORCEMENT_REQUIREMENT = getFixedPartnerRequirement(
  "team_capacity_enforcement",
);
const EVENT_LIMIT_SAFETY_REQUIREMENT = getFixedPartnerRequirement(
  "event_limit_safety",
);
const CAPACITY_WRITE_SERIALIZATION_REQUIREMENT = getFixedPartnerRequirement(
  "capacity_write_serialization",
);
const FIXED_PARTNER_CAPACITY_OPERATIONS = new Set(
  CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.condition.operations,
);
const FIXED_PARTNER_CAPACITY_LOCK_NAMESPACE =
  CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.lockNamespace;
const ROTATING_PARTICIPANT_CAPACITY_REQUIREMENT =
  getRotatingPartnerRequirement("participant_capacity");
const ROTATING_EVENT_LIMIT_SAFETY_REQUIREMENT =
  getRotatingPartnerRequirement("event_limit_safety");
const ROTATING_CAPACITY_WRITE_SERIALIZATION_REQUIREMENT =
  getRotatingPartnerRequirement("capacity_write_serialization");
const ROTATING_CAPACITY_WRITE_OPERATIONS = new Set(
  ROTATING_CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.condition.operations,
);
const ROTATING_CAPACITY_LOCK_NAMESPACE =
  ROTATING_CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.lockNamespace;

function fixedPartnerEventLimitUpdateIsConfigured(): boolean {
  return (
    EVENT_LIMIT_SAFETY_REQUIREMENT.condition.operation ===
      "event_limit_update" &&
    EVENT_LIMIT_SAFETY_REQUIREMENT.limitField ===
      TEAM_CAPACITY_ENFORCEMENT_REQUIREMENT.capacityField &&
    EVENT_LIMIT_SAFETY_REQUIREMENT.minimumSource ===
      "confirmed_team_count" &&
    EVENT_LIMIT_SAFETY_REQUIREMENT.onConflict === "reject" &&
    CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.lockStrategy ===
      "postgres_advisory_xact" &&
    CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.lockScope === "event" &&
    FIXED_PARTNER_CAPACITY_OPERATIONS.has("event_limit_update")
  );
}

function rotatingPartnerEventLimitUpdateIsConfigured(): boolean {
  return (
    ROTATING_EVENT_LIMIT_SAFETY_REQUIREMENT.condition.operation ===
      "event_limit_update" &&
    ROTATING_EVENT_LIMIT_SAFETY_REQUIREMENT.limitField ===
      ROTATING_PARTICIPANT_CAPACITY_REQUIREMENT.capacityField &&
    ROTATING_EVENT_LIMIT_SAFETY_REQUIREMENT.minimumSource ===
      "confirmed_participant_count" &&
    ROTATING_EVENT_LIMIT_SAFETY_REQUIREMENT.onConflict === "reject" &&
    ROTATING_CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.lockStrategy ===
      "postgres_advisory_xact" &&
    ROTATING_CAPACITY_WRITE_SERIALIZATION_REQUIREMENT.lockScope === "event" &&
    ROTATING_CAPACITY_WRITE_OPERATIONS.has("event_limit_update")
  );
}

export function parseEventType(raw: string | undefined): EventFormat | null {
  if (raw === "rotating" || raw === fixedPartnerConfig.format) return raw;
  return null;
}

// A format-agnostic view of an event. The two storage tables are fully
// independent (rotating tracks participant capacity, fixed tracks team
// capacity); this shape lets read paths and registration logic stay uniform.
export interface NormalizedEvent {
  id: number;
  seriesId: string | null;
  name: string;
  description: string | null;
  eventDescription: string | null;
  startDatetime: Date;
  endDatetime: Date;
  locationName: string;
  locationAddress: string;
  teamFormat: EventFormat;
  ratingTypeRequired: string;
  ratingConfig: EventRatingConfig;
  minParticipants: number;
  maxParticipants: number;
  minTeams: number | null;
  maxTeams: number | null;
  waitlistEnabled: boolean;
  requireApproval: string;
  signupStartDatetime: Date;
  signupEndDatetime: Date;
  showSignupEnd: boolean;
  status: string;
  courtFeeEnabled: boolean;
  memberFee: number;
  nonMemberFee: number;
  contactEmail: string | null;
  createdAt: Date;
}

function generateRecurringDates(
  startDatetime: Date,
  endDatetime: Date,
  frequency: "daily" | "weekly" | "monthly",
  occurrences: number,
): Array<{ start: Date; end: Date }> {
  const results: Array<{ start: Date; end: Date }> = [];
  const duration = endDatetime.getTime() - startDatetime.getTime();

  for (let i = 0; i < occurrences; i++) {
    const start = new Date(startDatetime);
    if (frequency === "daily") start.setDate(start.getDate() + i);
    else if (frequency === "weekly") start.setDate(start.getDate() + i * 7);
    else if (frequency === "monthly") start.setMonth(start.getMonth() + i);
    results.push({ start, end: new Date(start.getTime() + duration) });
  }
  return results;
}

export async function canAccessEvent(eventId: number, eventType: EventFormat, req: Request): Promise<boolean> {
  const session = (req as any).session;
  if (!session?.userId) return false;
  const role: string = session.role ?? "";
  if (role === "admin" || role === "event_organizer") return true;
  if (role === "event_captain" || role === "court_leader") {
    const [assignment] = await db
      .select()
      .from(eventAssignmentsTable)
      .where(
        and(
          eq(eventAssignmentsTable.userId, Number(session.userId)),
          eq(eventAssignmentsTable.eventId, eventId),
          eq(eventAssignmentsTable.eventType, eventType),
        ),
      );
    return !!assignment;
  }
  return false;
}

function buildCommonBase(body: any) {
  return {
    name: body.name,
    description: body.description ?? null,
    eventDescription: body.eventDescription ?? null,
    locationName: body.locationName,
    locationAddress: body.locationAddress ?? "",
    ratingTypeRequired: body.ratingTypeRequired ?? "none",
    ratingConfig: body.ratingConfig ?? null,
    waitlistEnabled: body.waitlistEnabled ?? true,
    requireApproval: body.requireApproval ?? "none",
    showSignupEnd: body.showSignupEnd ?? false,
    status: "upcoming" as const,
    courtFeeEnabled: body.courtFeeEnabled ?? false,
    memberFee: typeof body.memberFee === "number" ? body.memberFee : 0,
    nonMemberFee: typeof body.nonMemberFee === "number" ? body.nonMemberFee : 0,
    contactEmail: body.contactEmail ?? null,
  };
}

/**
 * Base controller holding the orchestration shared by both event formats.
 * Format-specific behavior (storage table, capacity model, roster team math,
 * normalization) is delegated to abstract members so that the two subclasses
 * can diverge independently as fixed-partner grows its own features.
 */
export abstract class BaseEventController {
  abstract readonly format: EventFormat;

  /** The Drizzle table this format persists to. Typed loosely because the two
   * tables have different column shapes; dynamic ops are cast to `any`. */
  protected abstract get table(): any;

  /** Convert a raw DB row into the format-agnostic NormalizedEvent shape. */
  protected abstract normalize(row: any): NormalizedEvent;

  /** Capacity columns to persist on create (rotating: participants, fixed: teams). */
  protected abstract capacityForCreate(body: any): Record<string, unknown>;

  /** Copy format-specific capacity fields from a PATCH body into the update set. */
  protected abstract applyCapacityUpdate(updates: any, body: any): void;

  /** Derive team count from a participant/registration count; null for rotating. */
  protected abstract computeTeams(n: number): number | null;

  async getNormalized(eventId: number): Promise<NormalizedEvent | null> {
    const [r] = await db.select().from(this.table).where(eq(this.table.id, eventId));
    return r ? this.normalize(r) : null;
  }

  async allNormalized(): Promise<NormalizedEvent[]> {
    const rows = await db.select().from(this.table);
    return rows.map((r: any) => this.normalize(r));
  }

  list = async (req: Request, res: Response) => {
    const { upcoming, search } = req.query as Record<string, string>;
    let rows = (await db.select().from(this.table).orderBy(this.table.startDatetime)).map((r: any) =>
      this.normalize(r),
    );

    if (upcoming === "true") {
      const now = new Date();
      rows = rows.filter(
        (e) => new Date(e.startDatetime) >= now && e.status !== "ended" && e.status !== "cancelled",
      );
    }

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.locationName.toLowerCase().includes(q) ||
          e.locationAddress.toLowerCase().includes(q),
      );
    }

    const counts = await db
      .select({ eventId: registrationsTable.eventId, confirmedCount: count() })
      .from(registrationsTable)
      .where(and(eq(registrationsTable.status, "confirmed"), eq(registrationsTable.eventType, this.format)))
      .groupBy(registrationsTable.eventId);
    const countMap = Object.fromEntries(counts.map((c) => [c.eventId, c.confirmedCount]));

    return res.json(
      rows.map((r) => {
        const confirmedCount = countMap[r.id] ?? 0;
        return { ...r, confirmedCount, confirmedTeams: this.computeTeams(confirmedCount), maxTeams: r.maxTeams };
      }),
    );
  };

  getById = async (req: Request, res: Response) => {
    const event = await this.getNormalized(Number(req.params.id));
    if (!event) return res.status(404).json({ error: "Event not found" });
    return res.json(event);
  };

  create = async (req: Request, res: Response) => {
    const body = req.body;
    const { startDatetime, endDatetime, signupStartDatetime, signupEndDatetime, recurrence } = body;
    const baseEvent: any = { ...buildCommonBase(body), ...this.capacityForCreate(body) };

    const startList: Date[] = [new Date(startDatetime)];
    let seriesId: string | null = null;
    const duration = new Date(endDatetime).getTime() - new Date(startDatetime).getTime();
    const signupStartOffset = new Date(startDatetime).getTime() - new Date(signupStartDatetime).getTime();
    const signupEndOffset = new Date(startDatetime).getTime() - new Date(signupEndDatetime).getTime();

    if (recurrence) {
      seriesId = randomUUID();
      let additionalStarts: Date[] = [];
      if (Array.isArray(recurrence.dates) && recurrence.dates.length > 0) {
        additionalStarts = recurrence.dates.map((d: string) => new Date(d));
      } else if (recurrence.frequency && recurrence.occurrences > 1) {
        const allDates = generateRecurringDates(
          new Date(startDatetime),
          new Date(endDatetime),
          recurrence.frequency,
          recurrence.occurrences,
        );
        additionalStarts = allDates.slice(1).map(({ start }) => start);
      }
      startList.push(...additionalStarts);
    }

    const values = startList.map((start) => ({
      ...baseEvent,
      seriesId,
      startDatetime: start,
      endDatetime: new Date(start.getTime() + duration),
      signupStartDatetime: new Date(start.getTime() - signupStartOffset),
      signupEndDatetime: new Date(start.getTime() - signupEndOffset),
    }));

    const created = (await db.insert(this.table).values(values).returning()) as any[];
    return res.status(201).json(created.map((r: any) => this.normalize(r)));
  };

  update = async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, this.format, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }
    const existing = await this.getNormalized(eventId);
    if (!existing) return res.status(404).json({ error: "Event not found" });

    const b = req.body;
    const updates: any = {};
    if (b.name !== undefined) updates.name = b.name;
    if (b.description !== undefined) updates.description = b.description;
    if (b.eventDescription !== undefined) updates.eventDescription = b.eventDescription;
    if (b.locationName !== undefined) updates.locationName = b.locationName;
    if (b.locationAddress !== undefined) updates.locationAddress = b.locationAddress;
    if (b.ratingTypeRequired !== undefined) updates.ratingTypeRequired = b.ratingTypeRequired;
    if (b.ratingConfig !== undefined) updates.ratingConfig = b.ratingConfig;
    if (b.waitlistEnabled !== undefined) updates.waitlistEnabled = b.waitlistEnabled;
    if (b.requireApproval !== undefined) updates.requireApproval = b.requireApproval;
    if (b.status !== undefined) updates.status = b.status;
    if (b.courtFeeEnabled !== undefined) updates.courtFeeEnabled = b.courtFeeEnabled;
    if (b.memberFee !== undefined) updates.memberFee = b.memberFee;
    if (b.nonMemberFee !== undefined) updates.nonMemberFee = b.nonMemberFee;
    if (b.contactEmail !== undefined) updates.contactEmail = b.contactEmail;
    if (b.startDatetime !== undefined) updates.startDatetime = new Date(b.startDatetime);
    if (b.endDatetime !== undefined) updates.endDatetime = new Date(b.endDatetime);
    if (b.signupStartDatetime !== undefined) updates.signupStartDatetime = new Date(b.signupStartDatetime);
    if (b.signupEndDatetime !== undefined) updates.signupEndDatetime = new Date(b.signupEndDatetime);
    if (b.showSignupEnd !== undefined) updates.showSignupEnd = b.showSignupEnd;
    this.applyCapacityUpdate(updates, b);

    const fixedPartnerLimitField = EVENT_LIMIT_SAFETY_REQUIREMENT.limitField;
    const rotatingLimitField = ROTATING_EVENT_LIMIT_SAFETY_REQUIREMENT.limitField;
    if (
      this.format === rotatingPartnerConfig.format &&
      typeof updates[rotatingLimitField] === "number" &&
      rotatingPartnerEventLimitUpdateIsConfigured()
    ) {
      const capacityUpdate = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${ROTATING_CAPACITY_LOCK_NAMESPACE}:${eventId}`}, 0))`,
        );

        const [current] = await tx
          .select()
          .from(this.table)
          .where(eq(this.table.id, eventId));
        if (!current) return { kind: "missing" as const };

        const [{ confirmedCount }] = await tx
          .select({ confirmedCount: count() })
          .from(registrationsTable)
          .where(
            and(
              eq(registrationsTable.eventId, eventId),
              eq(registrationsTable.eventType, this.format),
              eq(
                registrationsTable.status,
                ROTATING_PARTICIPANT_CAPACITY_REQUIREMENT.countedStatus,
              ),
            ),
          );
        const confirmedParticipants = Number(confirmedCount);
        if (updates[rotatingLimitField] < confirmedParticipants) {
          return {
            kind: "capacity_conflict" as const,
            requestedMaxParticipants: updates[rotatingLimitField],
            confirmedParticipants,
          };
        }

        const [updated] = (await tx
          .update(this.table)
          .set(updates)
          .where(eq(this.table.id, eventId))
          .returning()) as any[];
        return { kind: "updated" as const, event: updated };
      });

      if (capacityUpdate.kind === "missing") {
        return res.status(404).json({ error: "Event not found" });
      }
      if (capacityUpdate.kind === "capacity_conflict") {
        return res.status(400).json({
          error:
            `Cannot lower the participant limit to ${capacityUpdate.requestedMaxParticipants}: ` +
            `this event already has ${capacityUpdate.confirmedParticipants} confirmed participants. ` +
            `Set the limit to at least ${capacityUpdate.confirmedParticipants} or remove participants first.`,
        });
      }
      return res.json(this.normalize(capacityUpdate.event));
    }

    if (
      this.format === fixedPartnerConfig.format &&
      typeof updates[fixedPartnerLimitField] === "number" &&
      fixedPartnerEventLimitUpdateIsConfigured()
    ) {
      const capacityUpdate = await db.transaction(async (tx) => {
        // Event limit changes must serialize with fixed-partner membership
        // writes. Otherwise a signup could read the old limit, wait for this
        // update, and then create a team beyond the newly accepted limit.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${FIXED_PARTNER_CAPACITY_LOCK_NAMESPACE}:${eventId}`}, 0))`,
        );

        const [current] = await tx
          .select()
          .from(this.table)
          .where(eq(this.table.id, eventId));
        if (!current) return { kind: "missing" as const };

        const [{ confirmedCount }] = await tx
          .select({ confirmedCount: count() })
          .from(registrationsTable)
          .where(
            and(
              eq(registrationsTable.eventId, eventId),
              eq(registrationsTable.eventType, this.format),
              eq(
                registrationsTable.status,
                TEAM_CAPACITY_ENFORCEMENT_REQUIREMENT.countedStatus,
              ),
            ),
          );
        const confirmedTeams = Number(confirmedCount);
        if (updates[fixedPartnerLimitField] < confirmedTeams) {
          return {
            kind: "capacity_conflict" as const,
            requestedMaxTeams: updates[fixedPartnerLimitField],
            confirmedTeams,
          };
        }

        const [updated] = (await tx
          .update(this.table)
          .set(updates)
          .where(eq(this.table.id, eventId))
          .returning()) as any[];
        return { kind: "updated" as const, event: updated };
      });

      if (capacityUpdate.kind === "missing") {
        return res.status(404).json({ error: "Event not found" });
      }
      if (capacityUpdate.kind === "capacity_conflict") {
        return res.status(400).json({
          error:
            `Cannot lower the team limit to ${capacityUpdate.requestedMaxTeams}: ` +
            `this event already has ${capacityUpdate.confirmedTeams} confirmed teams. ` +
            `Set the limit to at least ${capacityUpdate.confirmedTeams} or remove teams first.`,
        });
      }
      return res.json(this.normalize(capacityUpdate.event));
    }

    const [updated] = (await db
      .update(this.table)
      .set(updates)
      .where(eq(this.table.id, eventId))
      .returning()) as any[];
    return res.json(this.normalize(updated));
  };

  remove = async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, this.format, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [deleted] = (await db.delete(this.table).where(eq(this.table.id, eventId)).returning()) as any[];
    if (!deleted) return res.status(404).json({ error: "Event not found" });

    // No cross-table FK exists, so cascade dependent rows at the application
    // level scoped to this event's format.
    await db
      .delete(registrationsTable)
      .where(and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.eventType, this.format)));
    await db
      .delete(eventAssignmentsTable)
      .where(and(eq(eventAssignmentsTable.eventId, eventId), eq(eventAssignmentsTable.eventType, this.format)));
    return res.status(204).send();
  };

  clone = async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, this.format, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }
    const { name } = req.body ?? {};

    const [source] = (await db.select().from(this.table).where(eq(this.table.id, eventId))) as any[];
    if (!source) return res.status(404).json({ error: "Source event not found" });
    const { id: _id, createdAt: _c, seriesId: _s, ...rest } = source;
    const [cloned] = (await db
      .insert(this.table)
      .values({ ...rest, name: name ?? `${source.name} (Copy)`, status: "upcoming" })
      .returning()) as any[];
    return res.status(201).json(this.normalize(cloned));
  };

  close = async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, this.format, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }
    const [updated] = (await db
      .update(this.table)
      .set({ status: "closed" })
      .where(eq(this.table.id, eventId))
      .returning()) as any[];
    if (!updated) return res.status(404).json({ error: "Event not found" });
    return res.json(this.normalize(updated));
  };

  rosterSummary = async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    const event = await this.getNormalized(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const regs = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.eventType, this.format)));
    const confirmed = regs.filter((r) => r.status === "confirmed").length;
    const waitlisted = regs.filter((r) => r.status === "waitlisted").length;
    const pendingApproval = regs.filter((r) => r.status === "pending_approval").length;

    return res.json({
      confirmed,
      waitlisted,
      pendingApproval,
      total: confirmed + waitlisted + pendingApproval,
      maxParticipants: event.maxParticipants,
      maxTeams: event.maxTeams ?? this.computeTeams(event.maxParticipants),
      confirmedTeams: this.computeTeams(confirmed),
      waitlistedTeams: this.computeTeams(waitlisted),
      pendingTeams: this.computeTeams(pendingApproval),
    });
  };
}

class RotatingEventController extends BaseEventController {
  readonly format = "rotating" as const;

  protected get table() {
    return eventsRotatingTable;
  }

  protected normalize(r: typeof eventsRotatingTable.$inferSelect): NormalizedEvent {
    return { ...r, teamFormat: "rotating", minTeams: null, maxTeams: null };
  }

  protected capacityForCreate(body: any) {
    return {
      minParticipants:
        body.minParticipants ??
        rotatingPartnerConfig.defaults.capacity.minParticipants,
      maxParticipants:
        body.maxParticipants ??
        rotatingPartnerConfig.defaults.capacity.maxParticipants,
    };
  }

  protected applyCapacityUpdate(updates: any, b: any) {
    if (b.minParticipants !== undefined) updates.minParticipants = b.minParticipants;
    if (b.maxParticipants !== undefined) updates.maxParticipants = b.maxParticipants;
  }

  protected computeTeams(): number | null {
    return null;
  }
}

class FixedEventController extends BaseEventController {
  readonly format = fixedPartnerConfig.format;

  protected get table() {
    return eventsFixedTable;
  }

  protected normalize(r: typeof eventsFixedTable.$inferSelect): NormalizedEvent {
    const { minTeams, maxTeams, ...rest } = r;
    return {
      ...rest,
      teamFormat: fixedPartnerConfig.format,
      minTeams,
      maxTeams,
      minParticipants: minTeams * 2,
      maxParticipants: maxTeams * 2,
    };
  }

  protected capacityForCreate(body: any) {
    return {
      minTeams: body.minTeams ?? fixedPartnerConfig.defaults.capacity.minTeams,
      maxTeams: body.maxTeams ?? fixedPartnerConfig.defaults.capacity.maxTeams,
    };
  }

  protected applyCapacityUpdate(updates: any, b: any) {
    if (b.minTeams !== undefined) updates.minTeams = b.minTeams;
    if (b.maxTeams !== undefined) updates.maxTeams = b.maxTeams;
  }

  protected computeTeams(n: number): number | null {
    return n; // each fixed-partner registration = 1 team (player + partner in one row)
  }
}

export const eventControllers: Record<EventFormat, BaseEventController> = {
  rotating: new RotatingEventController(),
  [fixedPartnerConfig.format]: new FixedEventController(),
};

export async function getNormalizedEvent(
  eventType: EventFormat,
  eventId: number,
): Promise<NormalizedEvent | null> {
  return eventControllers[eventType].getNormalized(eventId);
}
