import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { registrationsTable, membersTable, appSettingsTable, emailSendFailuresTable } from "@workspace/db";
import type { EventFormat } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { canAccessEvent, getNormalizedEvent, parseEventType } from "./events.js";
import { issueCode, peekCode, consumeCode, VERIFICATION_COOLDOWN_SECONDS } from "../../lib/verification.js";
import { sendVerificationEmail, sendFailureAlertEmail } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";
import {
  getClientIp,
  recordAttempt,
  recordSuccess,
  rateLimitErrorResponse,
} from "../../lib/rate-limit.js";
import { fixedPartnerConfig, getFixedPartnerRequirement } from "../../lib/fixed-partner-config.js";

const router = Router({ mergeParams: true });

type EventParams = { eventType: string; id: string };
type RegParams = { eventType: string; id: string; regId: string };

const REQUEST_CODE_CONFIG = {
  maxAttempts: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
  blockMs: 60 * 60 * 1000,  // 1 hour
};

const REGISTRATION_SUBMIT_CONFIG = {
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000, // 10 minutes
  blockMs: 15 * 60 * 1000,  // 15 minutes
};

const STAFF_ROLES = ["admin", "event_organizer", "event_captain", "court_leader"];
const FIXED_PARTNER_FORMAT = fixedPartnerConfig.format;
const PARTNER_REGISTRATION_REQUIREMENT = getFixedPartnerRequirement("partner_registration");
const PARTNER_GAP_REQUIREMENT = getFixedPartnerRequirement("partner_rating_gap");
const NR_PARTNER_REQUIREMENT = getFixedPartnerRequirement("nr_partner_check");
const PARTNER_RANGE_REQUIREMENT = getFixedPartnerRequirement("partner_rating_range");
const PARTNER_GAP_DEFAULT = fixedPartnerConfig.defaults.rating.maxPartnerGap;
const PARTNER_GAP_FALLBACK = PARTNER_GAP_DEFAULT;
const ACCEPTED_PARTNER_IDENTIFIERS = new Set(PARTNER_REGISTRATION_REQUIREMENT.acceptedIdentifiers ?? []);
const PUBLIC_PARTNER_PREFLIGHT_REQUIREMENT = getFixedPartnerRequirement("public_partner_preflight");
const ROSTER_EDIT_REQUIREMENT = getFixedPartnerRequirement("roster_edit_validation");
const ACTIVE_TEAM_MEMBERSHIP_REQUIREMENT = getFixedPartnerRequirement("active_team_membership");
const MEMBERSHIP_WRITE_SERIALIZATION_REQUIREMENT = getFixedPartnerRequirement("membership_write_serialization");
const ACTIVE_REGISTRATION_STATUSES = new Set(["confirmed", "waitlisted", "pending_approval"]);
const FIXED_PARTNER_ACTIVE_REGISTRATION_STATUSES = new Set(
  ACTIVE_TEAM_MEMBERSHIP_REQUIREMENT.activeStatuses ?? [],
);
const FIXED_PARTNER_MEMBERSHIP_OPERATIONS = new Set(
  ACTIVE_TEAM_MEMBERSHIP_REQUIREMENT.condition.operations ?? [],
);
const FIXED_PARTNER_MEMBERSHIP_ROLES = new Set(
  ACTIVE_TEAM_MEMBERSHIP_REQUIREMENT.membershipRoles ?? [],
);
const ROSTER_EDIT_CHECKS = new Set(ROSTER_EDIT_REQUIREMENT.checks ?? []);
const FIXED_PARTNER_WRITE_OPERATIONS = new Set(
  MEMBERSHIP_WRITE_SERIALIZATION_REQUIREMENT.condition.operations ?? [],
);
const FIXED_PARTNER_LOCK_NAMESPACE = MEMBERSHIP_WRITE_SERIALIZATION_REQUIREMENT.lockNamespace;

function isActiveRegistration(
  registration: { status: string },
  eventType: EventFormat,
): boolean {
  return (eventType === FIXED_PARTNER_FORMAT
    ? FIXED_PARTNER_ACTIVE_REGISTRATION_STATUSES
    : ACTIVE_REGISTRATION_STATUSES
  ).has(registration.status);
}

function fixedPartnerWriteIsSerialized(operation: string): boolean {
  return (
    MEMBERSHIP_WRITE_SERIALIZATION_REQUIREMENT.lockStrategy === "postgres_advisory_xact" &&
    MEMBERSHIP_WRITE_SERIALIZATION_REQUIREMENT.lockScope === "event" &&
    typeof FIXED_PARTNER_LOCK_NAMESPACE === "string" &&
    FIXED_PARTNER_WRITE_OPERATIONS.has(operation)
  );
}

function fixedPartnerMembershipIsEnforced(operation: string): boolean {
  return (
    ACTIVE_TEAM_MEMBERSHIP_REQUIREMENT.scope === "event" &&
    FIXED_PARTNER_MEMBERSHIP_OPERATIONS.has(operation) &&
    FIXED_PARTNER_MEMBERSHIP_ROLES.has("primary") &&
    FIXED_PARTNER_MEMBERSHIP_ROLES.has("partner")
  );
}

function fixedPartnerMembershipMatches(
  registration: { memberDuprId: string; partnerDuprId: string | null },
  candidates: Set<string>,
): boolean {
  const primaryMatches =
    FIXED_PARTNER_MEMBERSHIP_ROLES.has("primary") &&
    candidates.has(registration.memberDuprId);
  const partnerMatches =
    FIXED_PARTNER_MEMBERSHIP_ROLES.has("partner") &&
    registration.partnerDuprId !== null &&
    candidates.has(registration.partnerDuprId);
  return primaryMatches || partnerMatches;
}

function excludesCurrentFixedPartnerRegistration(
  registrationId: number,
  currentRegistrationId?: number,
): boolean {
  return (
    ACTIVE_TEAM_MEMBERSHIP_REQUIREMENT.excludeCurrentRegistrationOnEdit === true &&
    currentRegistrationId !== undefined &&
    registrationId === currentRegistrationId
  );
}

function isStaffRequest(req: Request): boolean {
  const role = (req as any).session?.role;
  return typeof role === "string" && STAFF_ROLES.includes(role);
}

type RatingParticipant = {
  doubles: string | null | undefined;
  selfRating: string | null | undefined;
};

function isNR(rating: string | null | undefined): boolean {
  if (!rating || rating === "NR") return true;
  return isNaN(parseFloat(rating));
}

/**
 * Validate the final pair for a fixed-partner roster edit. Registration
 * creation has the same rules, but PATCH needs to validate after resolving
 * whichever participant was replaced.
 */
function fixedPartnerRosterValidationError(
  event: NonNullable<Awaited<ReturnType<typeof getNormalizedEvent>>>,
  primary: RatingParticipant,
  partner: RatingParticipant,
  bypassRatings: boolean,
): string | null {
  const rc = event.ratingConfig as { min?: number; max?: number; nrAllowed?: boolean; maxPartnerGap?: number } | null;
  const rosterEditApplies =
    ROSTER_EDIT_REQUIREMENT.condition.operation === "roster_edit" &&
    ROSTER_EDIT_REQUIREMENT.condition.approvalMode === event.requireApproval &&
    ROSTER_EDIT_REQUIREMENT.condition.resolvedPartner === true &&
    ROSTER_EDIT_REQUIREMENT.condition.ratingTypes?.includes(event.ratingTypeRequired) === true;
  const staffBypass = bypassRatings && ROSTER_EDIT_REQUIREMENT.staffBypass === true;
  const nrNotAllowed =
    rosterEditApplies &&
    ROSTER_EDIT_CHECKS.has("nr") &&
    event.ratingTypeRequired === "dupr" &&
    !!rc &&
    typeof rc === "object" &&
    "nrAllowed" in rc &&
    rc.nrAllowed === false;

  if (!staffBypass && nrNotAllowed) {
    if (isNR(primary.doubles)) {
      return "This event does not allow non-rated (NR) players. A DUPR doubles rating is required to remain on the roster.";
    }
    if (isNR(partner.doubles)) {
      return "This event does not allow non-rated (NR) players. Your partner needs a DUPR doubles rating to remain on the roster.";
    }
  }

  if (!rosterEditApplies || staffBypass || event.requireApproval !== "enforce_rating") return null;

  const type = event.ratingTypeRequired;
  const hasRange = !!rc && typeof rc.min === "number" && typeof rc.max === "number";
  if (!hasRange || (type !== "dupr" && type !== "self_numeric")) return null;

  const min = rc!.min!;
  const max = rc!.max!;
  const range = `${min.toFixed(1)}–${max.toFixed(1)}`;
  const outOfRange = (raw: string | null | undefined): { ok: boolean; val?: number } => {
    const value = raw != null ? parseFloat(raw) : NaN;
    if (isNaN(value)) return { ok: false };
    return { ok: value >= min && value <= max, val: value };
  };

  if (type === "dupr") {
    let primaryEffectiveRating: number | undefined;
    let partnerEffectiveRating: number | undefined;

    if (isNR(primary.doubles)) {
      if (!rc!.nrAllowed) {
        return `This event enforces a DUPR rating between ${range}, and non-rated (NR) players are not allowed.`;
      }
      const result = outOfRange(primary.selfRating);
      if (result.val === undefined) {
        return `This event enforces a rating between ${range}. A valid self-rating is required for non-rated (NR) players.`;
      }
      if (!result.ok) {
        return `Your self-rating (${result.val}) is outside this event's enforced rating range of ${range}.`;
      }
      primaryEffectiveRating = result.val;
    } else {
      const result = outOfRange(primary.doubles);
      if (!result.ok) {
        return `Your DUPR rating (${result.val ?? "unknown"}) is outside this event's enforced rating range of ${range}.`;
      }
      primaryEffectiveRating = result.val;
    }

    if (rosterEditApplies && ROSTER_EDIT_CHECKS.has("rating_range")) {
      if (isNR(partner.doubles)) {
        if (!rc!.nrAllowed) {
          return `This event enforces a DUPR rating between ${range}, and non-rated (NR) players are not allowed. Your partner needs a DUPR doubles rating.`;
        }
        const result = outOfRange(partner.selfRating);
        if (result.val === undefined) {
          return `This event enforces a rating between ${range}. Your non-rated (NR) partner needs a valid self-rating on file.`;
        }
        if (!result.ok) {
          return `Your partner's self-rating (${result.val}) is outside this event's enforced rating range of ${range}.`;
        }
        partnerEffectiveRating = result.val;
      } else {
        const result = outOfRange(partner.doubles);
        if (!result.ok) {
          return `Your partner's DUPR rating (${result.val ?? "unknown"}) is outside this event's enforced rating range of ${range}.`;
        }
        partnerEffectiveRating = result.val;
      }
    }

    const maxPartnerGap =
      typeof rc?.maxPartnerGap === "number" ? rc.maxPartnerGap : PARTNER_GAP_FALLBACK;
    if (
      rosterEditApplies &&
      ROSTER_EDIT_CHECKS.has("partner_rating_gap") &&
      PARTNER_GAP_REQUIREMENT.condition.ratingType === type &&
      PARTNER_GAP_REQUIREMENT.condition.approvalMode === event.requireApproval &&
      PARTNER_GAP_REQUIREMENT.condition.resolvedPartner === true &&
      PARTNER_GAP_REQUIREMENT.condition.bothEffectiveRatings === true &&
      typeof maxPartnerGap === "number" &&
      maxPartnerGap >= 0 &&
      primaryEffectiveRating !== undefined &&
      partnerEffectiveRating !== undefined &&
      Math.abs(primaryEffectiveRating - partnerEffectiveRating) > maxPartnerGap
    ) {
      return `Partners' DUPR ratings may differ by at most ${maxPartnerGap.toFixed(2)}. This team's difference is ${Math.abs(primaryEffectiveRating - partnerEffectiveRating).toFixed(2)}.`;
    }
  } else {
    const primaryResult = outOfRange(primary.selfRating);
    if (primaryResult.val === undefined) {
      return `This event enforces a self-rating between ${range}. A valid self-rating is required to register.`;
    }
    if (!primaryResult.ok) {
      return `Your self-rating (${primaryResult.val}) is outside this event's enforced rating range of ${range}.`;
    }

    const partnerResult = outOfRange(partner.selfRating);
    if (partnerResult.val === undefined) {
      return `This event enforces a self-rating between ${range}. Your partner needs a valid self-rating on file.`;
    }
    if (!partnerResult.ok) {
      return `Your partner's self-rating (${partnerResult.val}) is outside this event's enforced rating range of ${range}.`;
    }
  }

  return null;
}

// Registrations are referenced by event id plus the format discriminator, since
// ids are independent across the two event tables.
function regScope(eventId: number, eventType: EventFormat) {
  return and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.eventType, eventType));
}

function eventCapacityLockKey(eventType: EventFormat, eventId: number): string | null {
  if (eventType === "rotating") {
    return `atl-dupr:rotating:${eventId}`;
  }
  if (
    eventType === FIXED_PARTNER_FORMAT &&
    fixedPartnerWriteIsSerialized("registration_create")
  ) {
    return `${FIXED_PARTNER_LOCK_NAMESPACE}:${eventId}`;
  }
  return null;
}

function eventCapacityLimit(
  eventType: EventFormat,
  event: NonNullable<Awaited<ReturnType<typeof getNormalizedEvent>>>,
): number {
  return eventType === FIXED_PARTNER_FORMAT
    ? event.maxTeams ?? Math.floor(event.maxParticipants / 2)
    : event.maxParticipants;
}

async function findActiveFixedPartnerMembership(
  eventId: number,
  memberDuprIds: string[],
  excludeRegistrationId?: number,
) {
  const registrations = await db
    .select()
    .from(registrationsTable)
    .where(regScope(eventId, FIXED_PARTNER_FORMAT));
  const candidates = new Set(memberDuprIds);
  return registrations.find(
    (registration) =>
      !excludesCurrentFixedPartnerRegistration(registration.id, excludeRegistrationId) &&
      FIXED_PARTNER_ACTIVE_REGISTRATION_STATUSES.has(registration.status) &&
      fixedPartnerMembershipMatches(registration, candidates),
  );
}

function buildRosterEntry(reg: typeof registrationsTable.$inferSelect, includeAdminFields = false, eventType?: EventFormat) {
  const snap = reg.playerSnapshot as any;
  const partnerSnap = reg.partnerSnapshot as any;
  // Backward compatibility: old DB snapshots use playerName/doubleRating/singleRating; new ones use name/doubles/singles
  const playerName = snap?.name ?? snap?.playerName ?? reg.memberDuprId;
  const doubleRating = snap?.doubles ?? snap?.doubleRating ?? null;
  const singleRating = snap?.singles ?? snap?.singleRating ?? null;
  const selfRating = snap?.selfRating ?? null;
  const email = snap?.email ?? null;
  const phone = snap?.phone ?? null;
  const partnerName = partnerSnap?.partnerName ?? null;
  const partnerDoubles = partnerSnap?.partnerDoubles ?? partnerSnap?.partnerDoubleRating ?? null;
  const partnerSelfRating = partnerSnap?.partnerSelfRating ?? null;
  const myRating = parseFloat(doubleRating ?? "NR");
  const partnerRating = parseFloat(partnerDoubles ?? "NR");
  const teamRating = !isNaN(myRating) && !isNaN(partnerRating) ? ((myRating + partnerRating) / 2).toFixed(2) : null;
  return {
    id: reg.id,
    eventId: reg.eventId,
    eventType: reg.eventType,
    memberDuprId: reg.memberDuprId,
    partnerDuprId: reg.partnerDuprId ?? null,
    status: reg.status,
    eventRole: reg.eventRole ?? null,
    ...(eventType !== FIXED_PARTNER_FORMAT ? { isNew: reg.isNew === "true" } : {}),
    ...(includeAdminFields ? { assignedRating: reg.assignedRating ?? null } : {}),
    registeredAt: reg.registeredAt,
    approvedAt: reg.approvedAt ?? null,
    approvedBy: reg.approvedBy ?? null,
    cancelledAt: reg.cancelledAt ?? null,
    cancelledBy: reg.cancelledBy ?? null,
    playerName,
    doubleRating,
    singleRating,
    selfRating,
    partnerName,
    partnerDoubleRating: partnerDoubles,
    partnerSelfRating,
    teamRating,
    ...(includeAdminFields ? { playerEmail: email, playerPhone: phone } : {}),
  };
}

async function canIncludeAdminFields(eventId: number, eventType: EventFormat, req: Request): Promise<boolean> {
  const role = (req as any).session?.role;
  if (!role) return false;
  if (role === "admin" || role === "event_organizer") return true;
  if (role === "event_captain" || role === "court_leader") {
    return canAccessEvent(eventId, eventType, req);
  }
  return false;
}

router.get("/", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const includeAdminFields = await canIncludeAdminFields(eventId, eventType, req);
  const regs = await db.select().from(registrationsTable).where(regScope(eventId, eventType));
  const entries = regs.map((r) => buildRosterEntry(r, includeAdminFields, eventType));
  return res.json(entries);
});

router.post("/request-code", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const partnerEmail = typeof req.body?.partnerEmail === "string" ? req.body.partnerEmail.trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  // Rate-limit by IP and by email (prevents email-bombing and abuse)
  const clientIp = getClientIp(req);
  const ipResult = recordAttempt(clientIp, "reg:code:ip", REQUEST_CODE_CONFIG);
  if (ipResult.blocked) {
    return rateLimitErrorResponse(res, ipResult.remainingBlockMs);
  }
  const emailResult = recordAttempt(email.toLowerCase(), "reg:code:email", REQUEST_CODE_CONFIG);
  if (emailResult.blocked) {
    return rateLimitErrorResponse(res, emailResult.remainingBlockMs);
  }

  const event = await getNormalizedEvent(eventType, eventId);
  if (!event) return res.status(404).json({ error: "Event not found" });

  const [settings] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const contactEmail = settings?.eventContactEmails?.[0];

  // Determine if member is NR (non-rated) and requires self-rating
  const [member] = await db
    .select()
    .from(membersTable)
    .where(sql`lower(${membersTable.email}) = lower(${email})`);
  function isNR(rating: string | null): boolean {
    if (!rating || rating === "NR") return true;
    return isNaN(parseFloat(rating));
  }
  const selfRatingRequired = member ? isNR(member.doubles) : false;

  // For fixed-partner events, preflight the partner's NR status so the client
  // can warn before submission instead of failing late at submit time. When the
  // partner email isn't supplied or isn't a known member, treat it as not NR
  // (the submit handler surfaces "partner not found" separately).
  let partnerSelfRatingRequired = false;
  if (
    eventType === FIXED_PARTNER_FORMAT &&
    PUBLIC_PARTNER_PREFLIGHT_REQUIREMENT.condition.publicSignup === true &&
    partnerEmail &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)
  ) {
    const [partner] = await db
      .select()
      .from(membersTable)
      .where(sql`lower(${membersTable.email}) = lower(${partnerEmail})`);
    partnerSelfRatingRequired = partner ? isNR(partner.doubles) : false;
  }

  // The "from" address must be on a domain verified in the project's Resend
  // account. The event contact email often lives on a domain the operator does
  // not control (e.g. a Zoho Desk subdomain), so prefer a dedicated verified
  // sender configured via VERIFICATION_EMAIL_FROM and fall back to the contact
  // email only if it is not set.
  const fromEmail = process.env.VERIFICATION_EMAIL_FROM || contactEmail;
  if (!fromEmail) {
    logger.error("Cannot send verification code: no VERIFICATION_EMAIL_FROM or eventContactEmails configured");
    return res.json({ sent: false, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
  }
  // Route replies back to the human contact address when the sender is a
  // dedicated no-reply style verified address.
  const replyTo = contactEmail && contactEmail !== fromEmail ? contactEmail : undefined;

  const code = await issueCode(email);
  if (code === null) {
    return res.json({ sent: true, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
  }

  try {
    await sendVerificationEmail({ to: email, code, from: fromEmail, replyTo, eventName: event.name });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, recipient: email, event: event.name }, "Failed to send verification email");

    db.insert(emailSendFailuresTable)
      .values({ recipientAddress: email, eventName: event.name, errorMessage })
      .catch((dbErr) => {
        logger.error({ dbErr }, "Failed to persist email send failure record");
      });

    const alertRecipients = settings?.eventContactEmails ?? [];
    if (alertRecipients.length > 0) {
      sendFailureAlertEmail({
        to: alertRecipients,
        from: fromEmail,
        recipientAddress: email,
        eventName: event.name,
        errorMessage,
      }).catch((alertErr) => {
        logger.error({ alertErr }, "Failed to send email failure alert to organizer");
      });
    }

    return res.json({ sent: false, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
  }

  return res.json({ sent: true, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
});

router.post("/", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const { email, memberDuprId, partnerDuprId, partnerEmail, code, selfRating, bypassRatingRequirements } = req.body;

  const event = await getNormalizedEvent(eventType, eventId);
  if (!event) return res.status(404).json({ error: "Event not found" });

  if (event.status === "cancelled") {
    return res.status(400).json({ error: "This event has been canceled" });
  }
  const staff = isStaffRequest(req);
  const bypassRatings = staff && bypassRatingRequirements === true;
  if (!staff && event.status !== "upcoming") {
    return res.status(400).json({ error: "Event is not open for registration" });
  }

  const now = new Date();
  if (!staff && (now < event.signupStartDatetime || now > event.signupEndDatetime)) {
    return res.status(400).json({ error: "Registration is outside the signup window" });
  }

  if (email && memberDuprId) {
    return res.status(400).json({ error: "Provide only email or memberDuprId, not both" });
  }
  if (!email && !memberDuprId) {
    return res.status(400).json({ error: "email or memberDuprId is required" });
  }

  // Public self-registration (email-based, unauthenticated) requires a verified
  // email. Staff adding participants from the admin console are exempt.
  if (!staff) {
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    // Rate-limit registration submission by IP and by email
    const clientIp = getClientIp(req);
    const ipResult = recordAttempt(clientIp, "reg:submit:ip", REGISTRATION_SUBMIT_CONFIG);
    if (ipResult.blocked) {
      return rateLimitErrorResponse(res, ipResult.remainingBlockMs);
    }
    const emailResult = recordAttempt(email.toLowerCase(), "reg:submit:email", REGISTRATION_SUBMIT_CONFIG);
    if (emailResult.blocked) {
      return rateLimitErrorResponse(res, emailResult.remainingBlockMs);
    }

    const verified = await peekCode(email, typeof code === "string" ? code.trim() : "");
    if (!verified) {
      return res.status(400).json({ error: "Invalid or expired verification code. Please request a new code." });
    }
  }

  let member: typeof membersTable.$inferSelect | undefined;
  let resolvedMemberDuprId: string | undefined;
  if (email) {
    [member] = await db
      .select()
      .from(membersTable)
      .where(sql`lower(${membersTable.email}) = lower(${email})`);
    if (!member) return res.status(404).json({ error: "No member found with that email address. Please use the email associated with your DUPR account." });
    resolvedMemberDuprId = member.duprId;
  } else {
    [member] = await db.select().from(membersTable).where(eq(membersTable.duprId, memberDuprId));
    if (!member) return res.status(404).json({ error: "No member found with that DUPR ID" });
    resolvedMemberDuprId = member.duprId;
  }

  const finalMemberDuprId = resolvedMemberDuprId;

  let resolvedPartnerDuprId: string | null = null;
  let partnerMember: typeof membersTable.$inferSelect | undefined;
  if (event.teamFormat === FIXED_PARTNER_FORMAT && PARTNER_REGISTRATION_REQUIREMENT.required === true) {
    if (partnerEmail && ACCEPTED_PARTNER_IDENTIFIERS.has("partnerEmail")) {
      const [partner] = await db
        .select()
        .from(membersTable)
        .where(sql`lower(${membersTable.email}) = lower(${partnerEmail})`);
      if (!partner) return res.status(404).json({ error: "Partner email not found in member list" });
      partnerMember = partner;
      resolvedPartnerDuprId = partner.duprId;
    } else if (partnerDuprId && ACCEPTED_PARTNER_IDENTIFIERS.has("partnerDuprId")) {
      const [partner] = await db.select().from(membersTable).where(eq(membersTable.duprId, partnerDuprId));
      if (!partner) return res.status(404).json({ error: "Partner member not found in member list" });
      partnerMember = partner;
      resolvedPartnerDuprId = partnerDuprId;
    } else {
      return res.status(400).json({ error: "partnerDuprId or partnerEmail is required for fixed-partner events" });
    }
  }

  // Only an ACTIVE registration blocks a duplicate signup. Non-active historical
  // rows (cancelled, rejected, no_show) do not block — a previously cancelled
  // registration is reactivated in place below; other non-active states fall
  // through to a fresh insert. Inspect ALL rows for this member because the table
  // has no uniqueness constraint and may contain multiple historical rows.
  const memberRegs = await db
    .select()
    .from(registrationsTable)
    .where(and(regScope(eventId, eventType), eq(registrationsTable.memberDuprId, finalMemberDuprId)));
  if (memberRegs.some((r) => isActiveRegistration(r, eventType))) {
    return res.status(409).json({ error: "Member already registered for this event" });
  }
  if (
    eventType === FIXED_PARTNER_FORMAT &&
    resolvedPartnerDuprId &&
    fixedPartnerMembershipIsEnforced("registration")
  ) {
    const duplicate = await findActiveFixedPartnerMembership(eventId, [
      finalMemberDuprId,
      resolvedPartnerDuprId,
    ]);
    if (duplicate) {
      return res.status(409).json({ error: "A player is already assigned to another team in this event" });
    }
  }

  function isNR(rating: string | null): boolean {
    if (!rating || rating === "NR") return true;
    return isNaN(parseFloat(rating));
  }

  // Rotating events that use a self-rating requirement must validate the
  // submitted value against the event's saved configuration. This is separate
  // from "enforce_rating": self-rating events require a value even when the
  // organizer routes registrations through approval or accepts them directly.
  if (
    !staff &&
    event.teamFormat === "rotating" &&
    (event.ratingTypeRequired === "self_numeric" ||
      event.ratingTypeRequired === "self_skill")
  ) {
    const config = event.ratingConfig as {
      min?: number;
      max?: number;
      minLevel?: number;
      maxLevel?: number;
    } | null;
    if (!selfRating || typeof selfRating !== "string") {
      return res.status(400).json({ error: "Self-rating is required for this event." });
    }

    if (event.ratingTypeRequired === "self_numeric") {
      const min = config?.min;
      const max = config?.max;
      const value = Number(selfRating);
      if (
        typeof min !== "number" ||
        typeof max !== "number" ||
        min > max
      ) {
        return res.status(400).json({ error: "This event's self-rating requirements are not configured correctly." });
      }
      if (!/^\d+(\.\d{1,2})?$/.test(selfRating) || !Number.isFinite(value)) {
        return res.status(400).json({ error: "Self-rating must be a number with at most 2 decimal places." });
      }
      if (value < min || value > max) {
        return res.status(400).json({ error: `Self-rating must be between ${min.toFixed(1)} and ${max.toFixed(1)}.` });
      }
    } else {
      const minLevel = config?.minLevel;
      const maxLevel = config?.maxLevel;
      const level = Number(selfRating);
      if (
        typeof minLevel !== "number" ||
        typeof maxLevel !== "number" ||
        minLevel > maxLevel
      ) {
        return res.status(400).json({ error: "This event's self-rating requirements are not configured correctly." });
      }
      if (
        !/^\d+$/.test(selfRating) ||
        !Number.isInteger(level) ||
        level < minLevel ||
        level > maxLevel
      ) {
        return res.status(400).json({ error: `Self-rating must be a skill level between ${minLevel} and ${maxLevel}.` });
      }
    }
  }

  // Enforce the "Allow NR players" toggle for fixed-partner DUPR events.
  // When NR is not allowed, reject non-rated players (primary or partner).
  // Staff adding participants from the admin console are exempt, consistent
  // with the self-rating exemption below.
  const rc = event.ratingConfig as { nrAllowed?: boolean } | null;
  const nrNotAllowed =
    event.teamFormat === FIXED_PARTNER_FORMAT &&
    NR_PARTNER_REQUIREMENT.condition.ratingType === event.ratingTypeRequired &&
    NR_PARTNER_REQUIREMENT.condition.publicRequest === true &&
    !!rc &&
    typeof rc === "object" &&
    "nrAllowed" in rc &&
    rc.nrAllowed === false;
  if (nrNotAllowed && !staff) {
    if (isNR(member?.doubles ?? null)) {
      return res.status(400).json({ error: "This event does not allow non-rated (NR) players. A DUPR doubles rating is required to register." });
    }
    if (isNR(partnerMember?.doubles ?? null)) {
      return res.status(400).json({ error: "This event does not allow non-rated (NR) players. Your partner needs a DUPR doubles rating to register." });
    }
  }

  // Validate and store self-rating for NR players
  // Staff adding participants from admin console are exempt from self-rating requirement
  if (isNR(member?.doubles ?? null) && !staff) {
    if (!selfRating || typeof selfRating !== "string") {
      return res.status(400).json({ error: "Self-rating is required for NR (non-rated) players. Please enter a rating between 2.0 and 5.0." });
    }
    const num = parseFloat(selfRating);
    if (isNaN(num) || num < 2.0 || num > 5.0) {
      return res.status(400).json({ error: "Self-rating must be a number between 2.0 and 5.0." });
    }
    if (!/^\d+(\.\d{1,2})?$/.test(selfRating)) {
      return res.status(400).json({ error: "Self-rating must have at most 2 decimal places (e.g. 3.50)." });
    }
  }

  // "Enforce Rating" mode: instead of routing players through approval, hard-
  // reject registrations whose rating falls outside the event's configured
  // rating requirement. Applies to public signups AND staff adds, and to the
  // partner on fixed-partner events.
  if (event.requireApproval === "enforce_rating" && !bypassRatings) {
    const cfg = event.ratingConfig as { min?: number; max?: number; nrAllowed?: boolean; maxPartnerGap?: number } | null;
    const type = event.ratingTypeRequired;
    const hasRange = !!cfg && typeof cfg.min === "number" && typeof cfg.max === "number";
    if (hasRange && (type === "dupr" || type === "self_numeric")) {
      const min = cfg!.min!;
      const max = cfg!.max!;
      const range = `${min.toFixed(1)}–${max.toFixed(1)}`;
      // Fail-closed range check: a missing or unparseable rating is rejected,
      // not silently accepted.
      const outOfRange = (raw: string | null | undefined): { ok: boolean; val?: number } => {
        const v = raw != null ? parseFloat(raw) : NaN;
        if (isNaN(v)) return { ok: false };
        return { ok: v >= min && v <= max, val: v };
      };
      const registrantSelf = selfRating && !isNaN(parseFloat(selfRating)) ? selfRating : member?.selfRating ?? null;

      if (type === "dupr") {
        let registrantEffectiveRating: number | undefined;
        let partnerEffectiveRating: number | undefined;
        // Registrant
        if (isNR(member?.doubles ?? null)) {
          if (!cfg!.nrAllowed) {
            return res.status(400).json({ error: `This event enforces a DUPR rating between ${range}, and non-rated (NR) players are not allowed.` });
          }
          const r = outOfRange(registrantSelf);
          if (r.val === undefined) {
            return res.status(400).json({ error: `This event enforces a rating between ${range}. A valid self-rating is required for non-rated (NR) players.` });
          }
          if (!r.ok) {
            return res.status(400).json({ error: `Your self-rating (${r.val}) is outside this event's enforced rating range of ${range}.` });
          }
          registrantEffectiveRating = r.val;
        } else {
          const r = outOfRange(member?.doubles);
          if (!r.ok) {
            return res.status(400).json({ error: `Your DUPR rating (${r.val ?? "unknown"}) is outside this event's enforced rating range of ${range}.` });
          }
          registrantEffectiveRating = r.val;
        }
        // Partner (fixed-partner events)
        if (
          resolvedPartnerDuprId &&
          PARTNER_RANGE_REQUIREMENT.condition.ratingType === type &&
          PARTNER_RANGE_REQUIREMENT.condition.approvalMode === event.requireApproval &&
          PARTNER_RANGE_REQUIREMENT.condition.resolvedPartner === true &&
          PARTNER_RANGE_REQUIREMENT.includePartner === true
        ) {
          if (isNR(partnerMember?.doubles ?? null)) {
            if (!cfg!.nrAllowed) {
              return res.status(400).json({ error: `This event enforces a DUPR rating between ${range}, and non-rated (NR) players are not allowed. Your partner needs a DUPR doubles rating.` });
            }
            const pr = outOfRange(partnerMember?.selfRating ?? null);
            if (pr.val === undefined) {
              return res.status(400).json({ error: `This event enforces a rating between ${range}. Your non-rated (NR) partner needs a valid self-rating on file.` });
            }
            if (!pr.ok) {
              return res.status(400).json({ error: `Your partner's self-rating (${pr.val}) is outside this event's enforced rating range of ${range}.` });
            }
            partnerEffectiveRating = pr.val;
          } else {
            const pr = outOfRange(partnerMember?.doubles);
            if (!pr.ok) {
              return res.status(400).json({ error: `Your partner's DUPR rating (${pr.val ?? "unknown"}) is outside this event's enforced rating range of ${range}.` });
            }
            partnerEffectiveRating = pr.val;
          }
        }
        const maxPartnerGap =
          typeof cfg?.maxPartnerGap === "number" ? cfg.maxPartnerGap : PARTNER_GAP_FALLBACK;
        if (
          event.teamFormat === FIXED_PARTNER_FORMAT &&
          PARTNER_GAP_REQUIREMENT.condition.ratingType === type &&
          PARTNER_GAP_REQUIREMENT.condition.approvalMode === event.requireApproval &&
          PARTNER_GAP_REQUIREMENT.condition.resolvedPartner === true &&
          PARTNER_GAP_REQUIREMENT.condition.bothEffectiveRatings === true &&
          resolvedPartnerDuprId &&
          typeof maxPartnerGap === "number" &&
          maxPartnerGap >= 0 &&
          registrantEffectiveRating !== undefined &&
          partnerEffectiveRating !== undefined &&
          Math.abs(registrantEffectiveRating - partnerEffectiveRating) > maxPartnerGap
        ) {
          return res.status(400).json({
            error: `Partners' DUPR ratings may differ by at most ${maxPartnerGap.toFixed(2)}. This team's difference is ${Math.abs(registrantEffectiveRating - partnerEffectiveRating).toFixed(2)}.`,
          });
        }
      } else {
        // self_numeric: the self-rating itself is the basis of eligibility.
        const r = outOfRange(registrantSelf);
        if (r.val === undefined) {
          return res.status(400).json({ error: `This event enforces a self-rating between ${range}. A valid self-rating is required to register.` });
        }
        if (!r.ok) {
          return res.status(400).json({ error: `Your self-rating (${r.val}) is outside this event's enforced rating range of ${range}.` });
        }
        if (resolvedPartnerDuprId) {
          const pr = outOfRange(partnerMember?.selfRating ?? null);
          if (pr.val === undefined) {
            return res.status(400).json({ error: `This event enforces a self-rating between ${range}. Your partner needs a valid self-rating on file.` });
          }
          if (!pr.ok) {
            return res.status(400).json({ error: `Your partner's self-rating (${pr.val}) is outside this event's enforced rating range of ${range}.` });
          }
        }
      }
    }
    // self_skill / none / missing range config: no numeric range to enforce.
  }

  const assignedRating = member?.doubles ? parseFloat(member.doubles) : null;

  // Capture a self-contained snapshot of the registrant (and partner) at signup
  // time so the registration no longer depends on the member list.
  const snapshotSelfRating =
    !staff &&
    selfRating &&
    (isNR(member?.doubles ?? null) ||
      (event.teamFormat === "rotating" &&
        (event.ratingTypeRequired === "self_numeric" ||
          event.ratingTypeRequired === "self_skill")))
      ? String(selfRating)
      : member?.selfRating ?? null;
  const playerSnapshot = {
    name: member?.name ?? finalMemberDuprId,
    doubles: member?.doubles ?? null,
    singles: member?.singles ?? null,
    selfRating: snapshotSelfRating,
    email: member?.email ?? null,
    phone: member?.phone ?? null,
  };
  const partnerSnapshot = resolvedPartnerDuprId
    ? {
        partnerName: partnerMember?.name ?? resolvedPartnerDuprId,
        partnerDoubles: partnerMember?.doubles ?? null,
        partnerSelfRating: partnerMember?.selfRating ?? null,
      }
    : null;

  let reg;
  const fixedPartnerRegistrationWritesSerialized =
    fixedPartnerWriteIsSerialized("registration_create") &&
    fixedPartnerWriteIsSerialized("registration_reactivate");
  if (
    eventType === FIXED_PARTNER_FORMAT &&
    fixedPartnerRegistrationWritesSerialized
  ) {
    // The membership check above is useful for the common case, but it is not
    // sufficient on its own: another request can insert a team between that
    // read and this write. Serialize fixed-partner membership changes for the
    // event and repeat the check on the same transaction/connection.
    const writeResult = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${FIXED_PARTNER_LOCK_NAMESPACE}:${eventId}`}, 0))`,
      );

      const currentMemberRegs = await tx
        .select()
        .from(registrationsTable)
        .where(and(regScope(eventId, eventType), eq(registrationsTable.memberDuprId, finalMemberDuprId)));
      if (currentMemberRegs.some((r) => FIXED_PARTNER_ACTIVE_REGISTRATION_STATUSES.has(r.status))) {
        return { kind: "conflict" as const, error: "Member already registered for this event" };
      }

      const currentRegs = await tx.select().from(registrationsTable).where(regScope(eventId, FIXED_PARTNER_FORMAT));
      const candidates = new Set(
        [finalMemberDuprId, resolvedPartnerDuprId].filter((id): id is string => Boolean(id)),
      );
      const duplicate = currentRegs.find(
        (registration) =>
          FIXED_PARTNER_ACTIVE_REGISTRATION_STATUSES.has(registration.status) &&
          fixedPartnerMembershipMatches(registration, candidates),
      );
      if (duplicate) {
        return {
          kind: "conflict" as const,
          error: "A player is already assigned to another team in this event",
        };
      }

      const currentExistingReg = currentMemberRegs
        .filter((r) => r.status === "cancelled")
        .sort((a, b) => b.id - a.id)[0];
      const currentConfirmedCount = currentRegs.filter((r) => r.status === "confirmed").length;
      let currentStatus: "confirmed" | "waitlisted" | "pending_approval" = "confirmed";
      if (event.requireApproval === "all" || (event.requireApproval === "nr_only" && isNR(member?.doubles ?? null))) {
        currentStatus = "pending_approval";
      } else if (currentConfirmedCount >= eventCapacityLimit(eventType, event)) {
        if (!event.waitlistEnabled) {
          return {
            kind: "conflict" as const,
            error: "Event is full and waitlist is disabled",
            status: 400,
          };
        }
        currentStatus = "waitlisted";
      }

      if (currentExistingReg) {
        const [updated] = await tx
          .update(registrationsTable)
          .set({
            partnerDuprId: resolvedPartnerDuprId,
            playerSnapshot,
            partnerSnapshot,
            status: currentStatus,
            assignedRating: isNaN(assignedRating as any) ? null : assignedRating,
            registeredAt: new Date(),
            cancelledAt: null,
            cancelledBy: null,
            approvedAt: null,
            approvedBy: null,
          })
          .where(eq(registrationsTable.id, currentExistingReg.id))
          .returning();
        return { kind: "created" as const, registration: updated };
      }

      const [inserted] = await tx
        .insert(registrationsTable)
        .values({
          eventId,
          eventType,
          memberDuprId: finalMemberDuprId,
          partnerDuprId: resolvedPartnerDuprId,
          playerSnapshot,
          partnerSnapshot,
          status: currentStatus,
          assignedRating: isNaN(assignedRating as any) ? null : assignedRating,
        })
        .returning();
      return { kind: "created" as const, registration: inserted };
    });

    if (writeResult.kind === "conflict") {
      return res.status(writeResult.status ?? 409).json({ error: writeResult.error });
    }
    reg = writeResult.registration;
  } else {
    // Capacity is derived from the current registrations, so the duplicate
    // check, capacity decision, and write must share one event-scoped lock.
    // Otherwise simultaneous signups can both observe the last open slot.
    const writeResult = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`atl-dupr:rotating:${eventId}`}, 0))`,
      );

      const currentMemberRegs = await tx
        .select()
        .from(registrationsTable)
        .where(and(regScope(eventId, eventType), eq(registrationsTable.memberDuprId, finalMemberDuprId)));
      if (currentMemberRegs.some((r) => ACTIVE_REGISTRATION_STATUSES.has(r.status))) {
        return { kind: "conflict" as const, error: "Member already registered for this event" };
      }

      const currentRegs = await tx.select().from(registrationsTable).where(regScope(eventId, eventType));
      const currentExistingReg = currentMemberRegs
        .filter((r) => r.status === "cancelled")
        .sort((a, b) => b.id - a.id)[0];
      const currentConfirmedCount = currentRegs.filter((r) => r.status === "confirmed").length;
      let currentStatus: "confirmed" | "waitlisted" | "pending_approval" = "confirmed";
      if (event.requireApproval === "all" || (event.requireApproval === "nr_only" && isNR(member?.doubles ?? null))) {
        currentStatus = "pending_approval";
      } else if (currentConfirmedCount >= eventCapacityLimit(eventType, event)) {
        if (!event.waitlistEnabled) {
          return {
            kind: "conflict" as const,
            error: "Event is full and waitlist is disabled",
            status: 400,
          };
        }
        currentStatus = "waitlisted";
      }

      if (currentExistingReg) {
        const [updated] = await tx
          .update(registrationsTable)
          .set({
            partnerDuprId: resolvedPartnerDuprId,
            playerSnapshot,
            partnerSnapshot,
            status: currentStatus,
            assignedRating: isNaN(assignedRating as any) ? null : assignedRating,
            registeredAt: new Date(),
            cancelledAt: null,
            cancelledBy: null,
            approvedAt: null,
            approvedBy: null,
          })
          .where(eq(registrationsTable.id, currentExistingReg.id))
          .returning();
        return { kind: "created" as const, registration: updated };
      }

      const [inserted] = await tx
        .insert(registrationsTable)
        .values({
          eventId,
          eventType,
          memberDuprId: finalMemberDuprId,
          partnerDuprId: resolvedPartnerDuprId,
          playerSnapshot,
          partnerSnapshot,
          status: currentStatus,
          assignedRating: isNaN(assignedRating as any) ? null : assignedRating,
        })
        .returning();
      return { kind: "created" as const, registration: inserted };
    });

    if (writeResult.kind === "conflict") {
      return res.status(writeResult.status ?? 409).json({ error: writeResult.error });
    }
    reg = writeResult.registration;
  }

  if (!staff && email) {
    await consumeCode(email);
  }

  // Clear rate-limit counters on successful registration
  if (!staff && email) {
    const clientIp = getClientIp(req);
    recordSuccess(clientIp, "reg:submit:ip");
    recordSuccess(email.toLowerCase(), "reg:submit:email");
  }

  const entry = buildRosterEntry(reg, false, eventType);
  return res.status(201).json(entry);
});

// Bulk-initialize assignedRating = DUPR for all registrations where assignedRating is null
router.post(
  "/bulk-set-assigned-ratings",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<EventParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);

    const regs = await db
      .select()
      .from(registrationsTable)
      .where(and(regScope(eventId, eventType), sql`${registrationsTable.assignedRating} IS NULL`));

    let updated = 0;
    for (const reg of regs) {
      const snap = reg.playerSnapshot as any;
      const dupr = snap?.doubles ?? snap?.doubleRating;
      if (dupr && dupr !== "NR") {
        const rating = parseFloat(dupr);
        if (!isNaN(rating)) {
          await db
            .update(registrationsTable)
            .set({ assignedRating: rating })
            .where(eq(registrationsTable.id, reg.id));
          updated++;
        }
      }
    }

    return res.json({ updated });
  },
);

router.get("/:regId", async (req: Request<RegParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
  if (!reg) return res.status(404).json({ error: "Registration not found" });
  return res.json(buildRosterEntry(reg, await canIncludeAdminFields(eventId, eventType, req), eventType));
});

router.patch(
  "/:regId",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [existing] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!existing) return res.status(404).json({ error: "Registration not found" });

    const event = await getNormalizedEvent(eventType, eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const updates: any = {};
    if (req.body.status !== undefined) updates.status = req.body.status;

    // Replace the primary player. Accept a new member by email or DUPR ID,
    // verify the member exists and is not already registered for this event,
    // then rebuild the player snapshot and reset the assigned rating to the
    // new member's DUPR.
    let newMember: typeof membersTable.$inferSelect | undefined;
    if (req.body.memberEmail !== undefined || req.body.memberDuprId !== undefined) {
      if (req.body.memberEmail) {
        [newMember] = await db
          .select()
          .from(membersTable)
          .where(sql`lower(${membersTable.email}) = lower(${req.body.memberEmail})`);
        if (!newMember) return res.status(404).json({ error: "No member found with that email address" });
      } else if (req.body.memberDuprId) {
        [newMember] = await db.select().from(membersTable).where(eq(membersTable.duprId, req.body.memberDuprId));
        if (!newMember) return res.status(404).json({ error: "No member found with that DUPR ID" });
      }
      if (newMember && newMember.duprId !== existing.memberDuprId) {
        if (eventType !== FIXED_PARTNER_FORMAT) {
          const [dup] = await db
            .select()
            .from(registrationsTable)
            .where(and(regScope(eventId, eventType), eq(registrationsTable.memberDuprId, newMember.duprId)));
          if (dup) return res.status(409).json({ error: "Member already registered for this event" });
        }
        updates.memberDuprId = newMember.duprId;
        updates.playerSnapshot = {
          name: newMember.name ?? newMember.duprId,
          doubles: newMember.doubles ?? null,
          singles: newMember.singles ?? null,
          selfRating: newMember.selfRating ?? null,
          email: newMember.email ?? null,
          phone: newMember.phone ?? null,
        };
        const ar = newMember.doubles ? parseFloat(newMember.doubles) : null;
        updates.assignedRating = ar !== null && !isNaN(ar) ? ar : null;
      }
    }

    // Replace the partner. Accept a partner by email or DUPR ID; email takes
    // precedence and is resolved to the member's DUPR ID.
    let partnerDuprIdToSet: string | null | undefined;
    let partnerMember: typeof membersTable.$inferSelect | undefined;
    if (eventType === FIXED_PARTNER_FORMAT) {
      const partnerWasProvided =
        req.body.partnerEmail !== undefined || req.body.partnerDuprId !== undefined;

      if (partnerWasProvided) {
        if (req.body.partnerEmail !== undefined) {
          const partnerEmail =
            typeof req.body.partnerEmail === "string" ? req.body.partnerEmail.trim() : "";
          if (!partnerEmail) {
            return res.status(400).json({ error: "A partner is required for fixed-partner events" });
          }
          [partnerMember] = await db
            .select()
            .from(membersTable)
            .where(sql`lower(${membersTable.email}) = lower(${partnerEmail})`);
          if (!partnerMember) return res.status(404).json({ error: "No partner found with that email address" });
        } else {
          const partnerDuprId =
            typeof req.body.partnerDuprId === "string" ? req.body.partnerDuprId.trim() : "";
          if (!partnerDuprId) {
            return res.status(400).json({ error: "A partner is required for fixed-partner events" });
          }
          [partnerMember] = await db
            .select()
            .from(membersTable)
            .where(eq(membersTable.duprId, partnerDuprId));
          if (!partnerMember) return res.status(404).json({ error: "No partner found with that DUPR ID" });
        }

        partnerDuprIdToSet = partnerMember.duprId;
        updates.partnerDuprId = partnerDuprIdToSet;
        updates.partnerSnapshot = {
          partnerName: partnerMember.name ?? partnerMember.duprId,
          partnerDoubles: partnerMember.doubles ?? null,
          partnerSelfRating: partnerMember.selfRating ?? null,
        };
      } else {
        if (!existing.partnerDuprId) {
          return res.status(400).json({ error: "A partner is required for fixed-partner events" });
        }
        [partnerMember] = await db
          .select()
          .from(membersTable)
          .where(eq(membersTable.duprId, existing.partnerDuprId));
        if (!partnerMember) {
          return res.status(404).json({ error: "No partner found with that DUPR ID" });
        }
      }
    } else {
      if (req.body.partnerEmail) {
        const [partner] = await db
          .select()
          .from(membersTable)
          .where(sql`lower(${membersTable.email}) = lower(${req.body.partnerEmail})`);
        if (!partner) return res.status(404).json({ error: "No partner found with that email address" });
        partnerDuprIdToSet = partner.duprId;
      } else if (req.body.partnerDuprId !== undefined) {
        partnerDuprIdToSet = req.body.partnerDuprId;
      }
      if (partnerDuprIdToSet !== undefined) {
        updates.partnerDuprId = partnerDuprIdToSet;
        if (partnerDuprIdToSet) {
          [partnerMember] = await db.select().from(membersTable).where(eq(membersTable.duprId, partnerDuprIdToSet));
          if (!partnerMember && req.body.partnerEmail === undefined) {
            return res.status(404).json({ error: "No partner found with that DUPR ID" });
          }
          updates.partnerSnapshot = {
            partnerName: partnerMember?.name ?? partnerDuprIdToSet,
            partnerDoubles: partnerMember?.doubles ?? null,
            partnerSelfRating: partnerMember?.selfRating ?? null,
          };
        } else {
          updates.partnerSnapshot = null;
        }
      }
    }
    if (req.body.eventRole !== undefined) updates.eventRole = req.body.eventRole ?? null;
    if (eventType !== "fixed_partner" && req.body.isNew !== undefined) updates.isNew = req.body.isNew ? "true" : "false";
    if (req.body.assignedRating !== undefined) {
      const ar = req.body.assignedRating;
      updates.assignedRating = ar !== null && isFinite(Number(ar)) ? Number(ar) : null;
    }
    if (req.body.selfRating !== undefined) {
      const sr = req.body.selfRating;
      const baseSnapshot = updates.playerSnapshot ?? existing.playerSnapshot ?? {
        name: existing.memberDuprId,
        doubles: null,
        singles: null,
        selfRating: null,
        email: null,
        phone: null,
      };
      if (sr !== null && sr !== "") {
        const num = parseFloat(sr);
        if (isNaN(num) || num < 2.0 || num > 5.0) {
          return res.status(400).json({ error: "Self-rating must be a number between 2.0 and 5.0." });
        }
        if (!/^\d+(\.\d{1,2})?$/.test(sr)) {
          return res.status(400).json({ error: "Self-rating must have at most 2 decimal places (e.g. 3.50)." });
        }
        // Self-rating lives on the registration snapshot (roster source of truth).
        updates.playerSnapshot = { ...baseSnapshot, selfRating: sr };
      } else {
        // Clear self-rating if null/empty
        updates.playerSnapshot = { ...baseSnapshot, selfRating: null };
      }
    }

    if (eventType === FIXED_PARTNER_FORMAT && event && partnerMember) {
      let currentMember: typeof membersTable.$inferSelect | undefined;
      if (!newMember) {
        [currentMember] = await db
          .select()
          .from(membersTable)
          .where(eq(membersTable.duprId, existing.memberDuprId));
      }

      const primarySnapshot = (updates.playerSnapshot ?? existing.playerSnapshot) as any;
      const primary = newMember ?? currentMember ?? {
        doubles: primarySnapshot?.doubles ?? primarySnapshot?.doubleRating ?? null,
        selfRating: primarySnapshot?.selfRating ?? null,
      };
      const duplicate = fixedPartnerMembershipIsEnforced("roster_edit")
        ? await findActiveFixedPartnerMembership(
            eventId,
            [newMember?.duprId ?? existing.memberDuprId, partnerMember.duprId],
            existing.id,
          )
        : undefined;
      if (duplicate) {
        return res.status(409).json({ error: "A player is already assigned to another team in this event" });
      }
      const partnerValidationError = fixedPartnerRosterValidationError(
        event,
        primary,
        partnerMember,
        isStaffRequest(req) && req.body.bypassRatingRequirements === true,
      );
      if (partnerValidationError) {
        return res.status(400).json({ error: partnerValidationError });
      }
    }

    // Server-managed cancellation metadata: when status transitions to cancelled,
    // record the timestamp and the acting staff member. When moving away from
    // cancelled, clear the metadata so the fields stay accurate.
    const newStatus = req.body.status;
    if (newStatus === "cancelled" && existing.status !== "cancelled") {
      updates.cancelledAt = new Date();
      const sessionUser = (req as any).session;
      updates.cancelledBy = sessionUser?.username || sessionUser?.role || "admin";
    } else if (newStatus !== undefined && newStatus !== "cancelled" && existing.status === "cancelled") {
      updates.cancelledAt = null;
      updates.cancelledBy = null;
    }

    let updatedReg = existing;
    if (Object.keys(updates).length > 0) {
      if (
        eventType === FIXED_PARTNER_FORMAT &&
        event &&
        partnerMember &&
        fixedPartnerWriteIsSerialized("roster_edit")
      ) {
        // Keep the duplicate-membership check and replacement in one
        // transaction. A concurrent signup or roster edit for the same event
        // must observe this update before it can claim either player.
        const updateResult = await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${FIXED_PARTNER_LOCK_NAMESPACE}:${eventId}`}, 0))`,
          );

          const currentRegs = await tx
            .select()
            .from(registrationsTable)
            .where(regScope(eventId, FIXED_PARTNER_FORMAT));
          const candidates = new Set(
            [newMember?.duprId ?? existing.memberDuprId, partnerMember.duprId].filter(
              (id): id is string => Boolean(id),
            ),
          );
          const duplicate = currentRegs.find(
            (registration) =>
              !excludesCurrentFixedPartnerRegistration(registration.id, existing.id) &&
              FIXED_PARTNER_ACTIVE_REGISTRATION_STATUSES.has(registration.status) &&
              fixedPartnerMembershipMatches(registration, candidates),
          );
          if (duplicate) {
            return { kind: "conflict" as const };
          }

          const transactionUpdates = { ...updates };
          if (req.body.status === "confirmed" && currentRegs.find(
            (registration) => registration.id === existing.id,
          )?.status !== "confirmed") {
            const confirmedCount = currentRegs.filter((registration) => registration.status === "confirmed").length;
            if (confirmedCount >= eventCapacityLimit(eventType, event)) {
              if (!event.waitlistEnabled) {
                return { kind: "full" as const };
              }
              transactionUpdates.status = "waitlisted";
            }
          }

          const [updated] = await tx
            .update(registrationsTable)
            .set(transactionUpdates)
            .where(
              and(
                eq(registrationsTable.id, Number(req.params.regId)),
                regScope(eventId, FIXED_PARTNER_FORMAT),
              ),
            )
            .returning();
          return { kind: "updated" as const, registration: updated };
        });
        if (updateResult.kind === "conflict") {
          return res.status(409).json({ error: "A player is already assigned to another team in this event" });
        }
        if (updateResult.kind === "full") {
          return res.status(400).json({ error: "Event is full and waitlist is disabled" });
        }
        updatedReg = updateResult.registration ?? existing;
      } else if (eventType === "rotating" && event) {
        // A roster edit can promote a pending or waitlisted registration
        // directly to confirmed. Serialize that decision with sign-ups and
        // approvals so it cannot claim the same final slot concurrently.
        const updateResult = await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`atl-dupr:rotating:${eventId}`}, 0))`,
          );

          const [currentExisting] = await tx
            .select()
            .from(registrationsTable)
            .where(
              and(
                eq(registrationsTable.id, Number(req.params.regId)),
                regScope(eventId, eventType),
              ),
            );
          if (!currentExisting) {
            return { kind: "missing" as const };
          }

          const transactionUpdates = { ...updates };
          if (req.body.status === "confirmed" && currentExisting.status !== "confirmed") {
            const currentRegs = await tx
              .select()
              .from(registrationsTable)
              .where(regScope(eventId, eventType));
            const confirmedCount = currentRegs.filter((r) => r.status === "confirmed").length;
            if (confirmedCount >= eventCapacityLimit(eventType, event)) {
              if (!event.waitlistEnabled) {
                return { kind: "full" as const };
              }
              transactionUpdates.status = "waitlisted";
            }
          }

          const [updated] = await tx
            .update(registrationsTable)
            .set(transactionUpdates)
            .where(
              and(
                eq(registrationsTable.id, Number(req.params.regId)),
                regScope(eventId, eventType),
              ),
            )
            .returning();
          return { kind: "updated" as const, registration: updated };
        });

        if (updateResult.kind === "missing") {
          return res.status(404).json({ error: "Registration not found" });
        }
        if (updateResult.kind === "full") {
          return res.status(400).json({ error: "Event is full and waitlist is disabled" });
        }
        updatedReg = updateResult.registration ?? existing;
      } else {
        const [updated] = await db
          .update(registrationsTable)
          .set(updates)
          .where(eq(registrationsTable.id, Number(req.params.regId)))
          .returning();
        updatedReg = updated;
      }
    }

    return res.json(buildRosterEntry(updatedReg, true, eventType));
  },
);

router.delete(
  "/:regId",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [deleted] = await db
      .delete(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Registration not found" });
    return res.status(204).send();
  },
);

router.post(
  "/:regId/approve",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!reg) return res.status(404).json({ error: "Registration not found" });

    const event = await getNormalizedEvent(eventType, eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const sessionUserId = (req as any).session?.userId;
    const approvalResult = await db.transaction(async (tx) => {
      // Approval must use the same event-scoped lock as sign-ups and
      // promotions so concurrent capacity decisions cannot claim one slot.
      const capacityLockKey = eventCapacityLockKey(eventType, eventId);
      if (capacityLockKey) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${capacityLockKey}, 0))`,
        );
      }

      const allRegs = await tx.select().from(registrationsTable).where(regScope(eventId, eventType));
      const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;

      let newStatus: "confirmed" | "waitlisted";
      if (confirmedCount >= eventCapacityLimit(eventType, event)) {
        if (!event.waitlistEnabled) {
          return { kind: "full" as const };
        }
        newStatus = "waitlisted";
      } else {
        newStatus = "confirmed";
      }

      const [updated] = await tx
        .update(registrationsTable)
        .set({ status: newStatus, approvedAt: new Date(), approvedBy: sessionUserId })
        .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)))
        .returning();

      return { kind: "approved" as const, registration: updated };
    });

    if (approvalResult.kind === "full") {
      return res.status(400).json({ error: "Event is full and waitlist is disabled; cannot approve" });
    }

    return res.json(buildRosterEntry(approvalResult.registration, true, eventType));
  },
);

router.post(
  "/:regId/reject",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!reg) return res.status(404).json({ error: "Registration not found" });

    const [updated] = await db
      .update(registrationsTable)
      .set({ status: "rejected" })
      .where(eq(registrationsTable.id, Number(req.params.regId)))
      .returning();

    return res.json(buildRosterEntry(updated, true, eventType));
  },
);

router.post(
  "/:regId/promote",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!reg) return res.status(404).json({ error: "Registration not found" });

    const sessionUserId = (req as any).session?.userId;
    const event = await getNormalizedEvent(eventType, eventId);
    const promotionResult = await db.transaction(async (tx) => {
      // Promotion must share the event-scoped lock used by capacity-changing
      // writes. Otherwise simultaneous organizers can all observe the same
      // open slot.
      const capacityLockKey = eventCapacityLockKey(eventType, eventId);
      if (capacityLockKey) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${capacityLockKey}, 0))`,
        );
      }

      const allRegs = await tx.select().from(registrationsTable).where(regScope(eventId, eventType));
      const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;
      const maxConfirmed = eventCapacityLimit(eventType, event!);

      if (confirmedCount >= maxConfirmed) {
        return { kind: "full" as const };
      }

      const [updated] = await tx
        .update(registrationsTable)
        .set({ status: "confirmed", approvedAt: new Date(), approvedBy: sessionUserId })
        .where(
          and(
            eq(registrationsTable.id, Number(req.params.regId)),
            regScope(eventId, eventType),
          ),
        )
        .returning();

      return { kind: "promoted" as const, registration: updated };
    });

    if (promotionResult.kind === "full") {
      return res.status(400).json({ error: "Event is still full" });
    }

    return res.json(buildRosterEntry(promotionResult.registration, true, eventType));
  },
);

router.post("/cancel", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const { email, code } = req.body;

  const event = await getNormalizedEvent(eventType, eventId);
  if (!event) return res.status(404).json({ error: "Event not found" });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  const verified = await peekCode(email, typeof code === "string" ? code.trim() : "");
  if (!verified) {
    return res.status(400).json({ error: "Invalid or expired verification code. Please request a new code." });
  }

  // Resolve the registration directly from its snapshot email so cancellation
  // stays decoupled from the members table (members may be cleared/deleted
  // independently without breaking existing registrations).
  const regs = await db
    .select()
    .from(registrationsTable)
    .where(
      and(
        regScope(eventId, eventType),
        sql`lower(${registrationsTable.playerSnapshot} ->> 'email') = lower(${email})`,
      ),
    );
  const reg = regs.find((r) => r.status !== "cancelled") ?? regs[0];
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  if (reg.status === "cancelled") {
    return res.status(400).json({ error: "Registration is already canceled." });
  }

  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "participant" })
    .where(eq(registrationsTable.id, reg.id))
    .returning();

  await consumeCode(email);

  return res.json(buildRosterEntry(updated, false, eventType));
});

export default router;
