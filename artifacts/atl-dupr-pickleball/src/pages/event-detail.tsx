import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import {
  useGetEvent,
  useGetEventRosterSummary,
  useListRegistrations,
  useCreateRegistration,
  useRequestRegistrationCode,
  useGetSettings,
  useCancelRegistration,
  getGetEventQueryKey,
  getGetEventRosterSummaryQueryKey,
  getListRegistrationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import NotFound from "@/pages/not-found";
import { PublicNav } from "@/components/public-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format, isPast, isFuture } from "date-fns";
import {
  MapPin,
  Calendar,
  Clock,
  Users,
  ChevronLeft,
  AlertCircle,
  WrenchIcon,
  DollarSign,
  Mail,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Activity,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";

interface SkillLevel {
  text: string;
  level: number;
}

function isNonNumeric(rating: string | null | undefined): boolean {
  if (!rating) return false;
  return isNaN(parseFloat(rating)) || rating === "NR";
}

function formatNameInitials(name: string | null): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts.pop()!;
  return parts.join(" ") + " " + last[0] + ".";
}

type SortKey =
  | "playerName"
  | "partnerName"
  | "doubleRating"
  | "partnerDoubleRating"
  | "teamRating";
type SortDir = "asc" | "desc";

function useSortedRegistrations(data: any[]) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>({
    key: "doubleRating",
    dir: "desc",
  });
  const sorted = useMemo(() => {
    if (!sort) return data;
    const arr = [...data];
    arr.sort((a, b) => {
      let va = a[sort.key];
      let vb = b[sort.key];
      if (
        sort.key === "doubleRating" ||
        sort.key === "partnerDoubleRating" ||
        sort.key === "teamRating"
      ) {
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        // NaN/undefined/NR values go to bottom regardless of sort direction
        if (isNaN(na) && isNaN(nb)) return 0;
        if (isNaN(na)) return 1;
        if (isNaN(nb)) return -1;
        return sort.dir === "asc" ? na - nb : nb - na;
      }
      return sort.dir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return arr;
  }, [data, sort]);
  return { sorted, sort, setSort };
}

function SortHeader({
  label,
  activeKey,
  sort,
  onSort,
}: {
  label: string;
  activeKey: SortKey;
  sort: { key: SortKey; dir: SortDir } | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === activeKey;
  return (
    <button
      onClick={() => onSort(activeKey)}
      className="flex items-center gap-1 text-left font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      {active ? (
        sort.dir === "asc" ? (
          <ArrowUp className="w-3.5 h-3.5" />
        ) : (
          <ArrowDown className="w-3.5 h-3.5" />
        )
      ) : (
        <ArrowUpDown className="w-3.5 h-3.5 opacity-30" />
      )}
    </button>
  );
}

function ParticipantTable({
  registrations,
  event,
}: {
  registrations: any[];
  event: any;
}) {
  const { canAccessAdmin } = useAuth();
  const { sorted, sort, setSort } = useSortedRegistrations(registrations);
  if (registrations.length === 0) return null;
  function toggleSort(key: SortKey) {
    setSort((s) => {
      if (s?.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "asc" };
    });
  }
  const isFixed = event.teamFormat === "fixed_partner";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left px-5 py-3 font-medium text-muted-foreground">
              #
            </th>
            <th className="text-left px-5 py-3">
              <SortHeader
                label="Name"
                activeKey="playerName"
                sort={sort}
                onSort={toggleSort}
              />
            </th>
            <th className="text-left px-5 py-3">
              <SortHeader
                label="DUPR Rating"
                activeKey="doubleRating"
                sort={sort}
                onSort={toggleSort}
              />
            </th>
            {isFixed && (
              <th className="text-left px-5 py-3">
                <SortHeader
                  label="Partner"
                  activeKey="partnerName"
                  sort={sort}
                  onSort={toggleSort}
                />
              </th>
            )}
            {isFixed && (
              <th className="text-left px-5 py-3">
                <SortHeader
                  label="Partner DUPR"
                  activeKey="partnerDoubleRating"
                  sort={sort}
                  onSort={toggleSort}
                />
              </th>
            )}
            {isFixed && (
              <th className="text-left px-5 py-3">
                <SortHeader
                  label="Team Rating"
                  activeKey="teamRating"
                  sort={sort}
                  onSort={toggleSort}
                />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((reg, idx) => (
            <tr
              key={reg.id}
              data-testid={`row-participant-${reg.id}`}
              className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-5 py-3 text-muted-foreground font-mono">
                {idx + 1}
              </td>
              <td className="px-5 py-3 font-medium">
                {canAccessAdmin
                  ? reg.playerName
                  : formatNameInitials(reg.playerName)}
              </td>
              <td className="px-5 py-3">
                <span
                  data-testid={`text-rating-${reg.id}`}
                  className="font-mono"
                >
                  {reg.doubleRating || "NR"}
                </span>
              </td>
              {isFixed && (
                <td className="px-5 py-3 text-muted-foreground">
                  {reg.partnerName || "—"}
                </td>
              )}
              {isFixed && (
                <td className="px-5 py-3 font-mono">
                  {reg.partnerDoubleRating || "NR"}
                </td>
              )}
              {isFixed && (
                <td className="px-5 py-3 font-mono">
                  {reg.teamRating || "NR"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EventDetail() {
  const { eventType: rawEventType, id } = useParams<{
    eventType: string;
    id: string;
  }>();
  const validEventType =
    rawEventType === "rotating" || rawEventType === "fixed_partner";
  const eventType = (validEventType ? rawEventType : "rotating") as
    | "rotating"
    | "fixed_partner";
  const eventId = Number(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: event, isLoading: evLoading } = useGetEvent(
    eventType,
    eventId,
    {
      query: {
        enabled: !!eventId && validEventType,
        queryKey: getGetEventQueryKey(eventType, eventId),
      },
    },
  );
  const { data: rosterSummary } = useGetEventRosterSummary(eventType, eventId, {
    query: {
      enabled: !!eventId && validEventType,
      queryKey: getGetEventRosterSummaryQueryKey(eventType, eventId),
    },
  });
  const { data: registrations, isLoading: regLoading } = useListRegistrations(
    eventType,
    eventId,
    {
      query: {
        enabled: !!eventId && validEventType,
        queryKey: getListRegistrationsQueryKey(eventType, eventId),
      },
    },
  );
  const { data: settings } = useGetSettings();
  const createReg = useCreateRegistration();
  const requestCode = useRequestRegistrationCode();
  const cancelReg = useCancelRegistration();

  const [email, setEmail] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [notMemberDialogOpen, setNotMemberDialogOpen] = useState(false);
  const [showApprovalNotice, setShowApprovalNotice] = useState(false);
  const [selfRating, setSelfRating] = useState("");
  const [selfRatingError, setSelfRatingError] = useState("");
  const [selfRatingRequired, setSelfRatingRequired] = useState(false);
  const [partnerSelfRatingRequired, setPartnerSelfRatingRequired] =
    useState(false);

  const [cancelEmail, setCancelEmail] = useState("");
  const [cancelCode, setCancelCode] = useState("");
  const [cancelCodeSent, setCancelCodeSent] = useState(false);
  const [cancelCooldown, setCancelCooldown] = useState(0);
  const [showCancelForm, setShowCancelForm] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (cancelCooldown <= 0) return;
    const t = setTimeout(() => setCancelCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cancelCooldown]);

  const skillLevels: SkillLevel[] =
    (settings as any)?.ratingRequirementsConfig?.selfSkill?.levels ?? [];
  const joinInstructions: string = (settings as any)?.joinInstructions ?? "";

  if (!validEventType) {
    return <NotFound />;
  }

  if (settings?.maintenanceMode) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNav />
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
          <WrenchIcon className="w-14 h-14 text-muted-foreground/40 mb-5" />
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Site Under Maintenance
          </h1>
          <p className="text-muted-foreground max-w-md">
            This site is temporarily under maintenance. Please check back soon.
          </p>
        </div>
      </div>
    );
  }

  if (evLoading) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNav />
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNav />
        <div className="max-w-3xl mx-auto px-4 py-16 text-center text-muted-foreground">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Event not found</p>
          <Link href="/">
            <span className="text-primary text-sm mt-2 block hover:underline">
              Back to events
            </span>
          </Link>
        </div>
      </div>
    );
  }

  const signupOpen =
    event.status === "upcoming" &&
    isFuture(new Date(event.signupEndDatetime)) &&
    isPast(new Date(event.signupStartDatetime));
  const signupNotYet = isFuture(new Date(event.signupStartDatetime));

  const confirmedRegs =
    registrations?.filter((r) => r.status === "confirmed") ?? [];

  // Fixed-partner DUPR events can disallow NR (non-rated) players. When that's
  // the case and the registrant is NR (selfRatingRequired), block registration
  // instead of prompting for a self-rating.
  const eventNrNotAllowed =
    event.teamFormat === "fixed_partner" &&
    !!(event as any).ratingConfig &&
    (event as any).ratingConfig.nrAllowed === false;
  const nrBlocked = eventNrNotAllowed && selfRatingRequired;
  const partnerNrBlocked = eventNrNotAllowed && partnerSelfRatingRequired;

  function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (event?.teamFormat === "fixed_partner" && !partnerEmail.trim()) {
      toast({
        title: "Partner email required",
        description: "Enter your partner's email before requesting a code.",
        variant: "destructive",
      });
      return;
    }
    requestCode.mutate(
      {
        eventType,
        id: eventId,
        data: {
          email: email.trim(),
          partnerEmail:
            event?.teamFormat === "fixed_partner"
              ? partnerEmail.trim().toLowerCase()
              : undefined,
        },
      },
      {
        onSuccess: (res) => {
          if (!res?.sent) {
            toast({
              title: "Couldn't send code",
              description:
                "We couldn't send a verification code right now. Please try again later.",
              variant: "destructive",
            });
            return;
          }
          setCodeSent(true);
          setCode("");
          setCooldown(res.cooldownSeconds ?? 30);
          setSelfRatingRequired(res.selfRatingRequired ?? false);
          setPartnerSelfRatingRequired(res.partnerSelfRatingRequired ?? false);
          setSelfRating("");
          setSelfRatingError("");
          toast({
            title: "Verification code sent",
            description: `We emailed a 6-digit code to ${email.trim()}. It expires in 10 minutes.`,
          });
        },
        onError: (err: any) => {
          const status = err?.status;
          const msg: string =
            err?.data?.error ||
            err?.message ||
            "Could not send verification code. Please try again.";
          if (status === 429) {
            const minutes = err?.data?.retryAfterMs
              ? Math.ceil(err.data.retryAfterMs / 60000)
              : 60;
            toast({
              title: "Too many attempts",
              description: `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Couldn't send code",
              description: msg,
              variant: "destructive",
            });
          }
        },
      },
    );
  }

  function handleResendCode() {
    if (cooldown > 0) return;
    requestCode.mutate(
      { eventType, id: eventId, data: { email: email.trim() } },
      {
        onSuccess: (res) => {
          if (!res?.sent) {
            toast({
              title: "Couldn't resend code",
              description: "Please try again later.",
              variant: "destructive",
            });
            return;
          }
          setCooldown(res.cooldownSeconds ?? 30);
          toast({
            title: "Code resent",
            description: `A new code was emailed to ${email.trim()}.`,
          });
        },
        onError: (err: any) => {
          const status = err?.status;
          const msg: string =
            err?.data?.error ||
            err?.message ||
            "Could not resend code. Please try again.";
          if (status === 429) {
            const minutes = err?.data?.retryAfterMs
              ? Math.ceil(err.data.retryAfterMs / 60000)
              : 60;
            toast({
              title: "Too many attempts",
              description: `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Couldn't resend code",
              description: msg,
              variant: "destructive",
            });
          }
        },
      },
    );
  }

  function resetRegistrationForm() {
    setEmail("");
    setPartnerEmail("");
    setCode("");
    setCodeSent(false);
    setCooldown(0);
    setSelfRating("");
    setSelfRatingError("");
    setSelfRatingRequired(false);
    setPartnerSelfRatingRequired(false);
  }

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    // Frontend validation for self-rating
    const ratingVal = selfRating.trim();
    if (selfRatingRequired) {
      if (!ratingVal) {
        setSelfRatingError("Self-rating is required.");
        return;
      }
      const num = parseFloat(ratingVal);
      if (isNaN(num) || num < 2.0 || num > 5.0) {
        setSelfRatingError("Self-rating must be between 2.0 and 5.0.");
        return;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(ratingVal)) {
        setSelfRatingError(
          "Self-rating must have at most 2 decimal places (e.g. 3.50).",
        );
        return;
      }
    }
    createReg.mutate(
      {
        eventType,
        id: eventId,
        data: {
          email: email.trim(),
          code: code.trim(),
          partnerEmail:
            event?.teamFormat === "fixed_partner"
              ? partnerEmail.trim().toLowerCase() || null
              : null,
          selfRating: ratingVal || null,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Registration submitted!",
            description: "You are on the roster.",
          });
          resetRegistrationForm();
          if (
            event?.requireApproval === "all" ||
            event?.requireApproval === "nr_only"
          )
            setShowApprovalNotice(true);
          queryClient.invalidateQueries({
            queryKey: getListRegistrationsQueryKey(eventType, eventId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetEventRosterSummaryQueryKey(eventType, eventId),
          });
        },
        onError: (err: any) => {
          const status = err?.status;
          const msg: string =
            err?.data?.error ||
            err?.message ||
            "Registration failed. Please try again.";
          if (status === 429) {
            const minutes = err?.data?.retryAfterMs
              ? Math.ceil(err.data.retryAfterMs / 60000)
              : 15;
            toast({
              title: "Too many attempts",
              description: `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
              variant: "destructive",
            });
          } else if (
            msg.toLowerCase().includes("no member found with that email") ||
            msg.toLowerCase().includes("no member found with that dupr id")
          ) {
            setNotMemberDialogOpen(true);
          } else {
            toast({
              title: "Registration failed",
              description: msg,
              variant: "destructive",
            });
          }
        },
      },
    );
  }

  function handleCancelSendCode(e: React.FormEvent) {
    e.preventDefault();
    requestCode.mutate(
      { eventType, id: eventId, data: { email: cancelEmail.trim() } },
      {
        onSuccess: (res) => {
          if (!res?.sent) {
            toast({
              title: "Couldn't send code",
              description:
                "We couldn't send a verification code right now. Please try again later.",
              variant: "destructive",
            });
            return;
          }
          setCancelCodeSent(true);
          setCancelCode("");
          setCancelCooldown(res.cooldownSeconds ?? 30);
          toast({
            title: "Verification code sent",
            description: `We emailed a 6-digit code to ${cancelEmail.trim()}. It expires in 10 minutes.`,
          });
        },
        onError: (err: any) => {
          const status = err?.status;
          const msg: string =
            err?.data?.error ||
            err?.message ||
            "Could not send verification code. Please try again.";
          if (status === 429) {
            const minutes = err?.data?.retryAfterMs
              ? Math.ceil(err.data.retryAfterMs / 60000)
              : 60;
            toast({
              title: "Too many attempts",
              description: `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Couldn't send code",
              description: msg,
              variant: "destructive",
            });
          }
        },
      },
    );
  }

  function handleCancelResendCode() {
    if (cancelCooldown > 0) return;
    requestCode.mutate(
      { eventType, id: eventId, data: { email: cancelEmail.trim() } },
      {
        onSuccess: (res) => {
          if (!res?.sent) {
            toast({
              title: "Couldn't resend code",
              description: "Please try again later.",
              variant: "destructive",
            });
            return;
          }
          setCancelCooldown(res.cooldownSeconds ?? 30);
          toast({
            title: "Code resent",
            description: `A new code was emailed to ${cancelEmail.trim()}.`,
          });
        },
        onError: (err: any) => {
          const status = err?.status;
          const msg: string =
            err?.data?.error ||
            err?.message ||
            "Could not resend code. Please try again.";
          if (status === 429) {
            const minutes = err?.data?.retryAfterMs
              ? Math.ceil(err.data.retryAfterMs / 60000)
              : 60;
            toast({
              title: "Too many attempts",
              description: `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Couldn't resend code",
              description: msg,
              variant: "destructive",
            });
          }
        },
      },
    );
  }

  function handleCancelSubmit(e: React.FormEvent) {
    e.preventDefault();
    cancelReg.mutate(
      {
        eventType,
        id: eventId,
        data: {
          email: cancelEmail.trim(),
          code: cancelCode.trim(),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Registration cancelled",
            description: "You have been removed from the event roster.",
          });
          setCancelEmail("");
          setCancelCode("");
          setCancelCodeSent(false);
          setCancelCooldown(0);
          setShowCancelForm(false);
          queryClient.invalidateQueries({
            queryKey: getListRegistrationsQueryKey(eventType, eventId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetEventRosterSummaryQueryKey(eventType, eventId),
          });
        },
        onError: (err: any) => {
          const msg: string =
            err?.data?.error ||
            err?.message ||
            "Cancellation failed. Please try again.";
          toast({
            title: "Cancellation failed",
            description: msg,
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />

      <div className="bg-primary/5 border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
          >
            <ChevronLeft className="w-4 h-4" />
            All Events
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{event.name}</h1>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
        {/* Event Info Card */}
        <div
          data-testid="card-event-info"
          className="order-1 bg-card border border-card-border rounded-lg p-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4 text-primary" />
              {format(new Date(event.startDatetime), "EEEE, MMMM d, yyyy")}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-4 h-4 text-primary" />
              {format(new Date(event.startDatetime), "h:mm a")} –{" "}
              {format(new Date(event.endDatetime), "h:mm a")}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Status:</span>
              <span
                className={
                  signupOpen ? "text-primary font-medium" : "text-foreground"
                }
              >
                {signupOpen ? "Open" : signupNotYet ? "Not yet open" : "Closed"}
              </span>
            </div>
            {(event as any).showSignupEnd && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <Calendar className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">
                  Registration closes:
                </span>
                <span
                  className={
                    signupOpen
                      ? "text-primary font-medium"
                      : "text-muted-foreground"
                  }
                >
                  {format(
                    new Date(event.signupEndDatetime),
                    "EEE, MMM d, h:mm a",
                  )}
                </span>
              </div>
            )}
            {rosterSummary && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">
                  {event.teamFormat === "fixed_partner" ? "Teams" : "Players"}:
                </span>
                <span data-testid="text-confirmed-count">
                  <span className="font-semibold text-primary">
                    {event.teamFormat === "fixed_partner"
                      ? (rosterSummary.confirmedTeams ??
                        rosterSummary.confirmed)
                      : rosterSummary.confirmed}
                  </span>{" "}
                  /{" "}
                  {event.teamFormat === "fixed_partner"
                    ? (rosterSummary.maxTeams ?? rosterSummary.maxParticipants)
                    : rosterSummary.maxParticipants}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span>
                {event.locationName}
                {event.locationAddress ? ` — ${event.locationAddress}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <DollarSign className="w-4 h-4 text-primary" />
              {event.courtFeeEnabled ? (
                <span>
                  Court fee: Member $
                  {(event as any).memberFee % 1 === 0
                    ? (event as any).memberFee
                    : (event as any).memberFee.toFixed(2)}{" "}
                  / Non-member $
                  {(event as any).nonMemberFee % 1 === 0
                    ? (event as any).nonMemberFee
                    : (event as any).nonMemberFee.toFixed(2)}
                </span>
              ) : (
                <span>Free</span>
              )}
            </div>
            {joinInstructions && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <ExternalLink className="w-4 h-4 text-primary" />
                <span>
                  Requirement:{" "}
                  <button
                    type="button"
                    onClick={() => setJoinDialogOpen(true)}
                    className="text-primary hover:underline"
                  >
                    Join Atlanta DUPR Pickleball
                  </button>{" "}
                  for free
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="w-4 h-4 text-primary" />
              Team Format:{" "}
              {event.teamFormat === "fixed_partner"
                ? "Fixed-Partner"
                : "Rotating Partners"}
            </div>
            {event.requireApproval !== "none" && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <AlertCircle className="w-4 h-4 text-primary" />
                {event.requireApproval === "all"
                  ? "Approval Required"
                  : event.requireApproval === "enforce_rating"
                    ? "Rating Enforced: only players within the rating range can register"
                    : "NR Players: Approval Required"}
              </div>
            )}
            {(event as any).contactEmail && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <Mail className="w-4 h-4 text-primary" />
                <span>
                  Contact:{" "}
                  <a
                    href={`mailto:${(event as any).contactEmail}`}
                    className="text-primary hover:underline"
                  >
                    {(event as any).contactEmail}
                  </a>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Event Description */}
        {event.eventDescription && (
          <div
            data-testid="card-event-description"
            className="order-3 bg-card border border-card-border rounded-lg p-5"
          >
            <div
              className="prose prose-sm max-w-none leading-snug [&_p]:my-0.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: event.eventDescription }}
            />
          </div>
        )}

        {/* Guidelines and Rules */}
        {event.description && (
          <div
            data-testid="card-event-guidelines"
            className="order-3 bg-card border border-card-border rounded-lg p-5"
          >
            <div
              className="prose prose-sm max-w-none leading-snug [&_p]:my-0.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: event.description }}
            />
          </div>
        )}

        {/* Canceled notice */}
        {event.status === "cancelled" && (
          <div
            data-testid="notice-event-cancelled"
            className="order-4 bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-center text-sm text-destructive font-medium"
          >
            This event has been canceled.
          </div>
        )}

        {/* Registration form */}
        {signupOpen && event.status === "upcoming" && (
          <div
            data-testid="card-registration"
            className="order-2 bg-card border border-card-border rounded-lg p-5"
          >
            <h2 className="font-semibold text-foreground mb-4">
              Register for This Event
            </h2>
            {!codeSent ? (
              <form onSubmit={handleSendCode} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">Email Address</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    data-testid="input-reg-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    <strong>
                      Use the email address linked to your DUPR account.
                    </strong>{" "}
                    {joinInstructions && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium"
                        onClick={() => setJoinDialogOpen(true)}
                      >
                        Not a member yet? <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </p>
                </div>
                {event.teamFormat === "fixed_partner" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="partner-email">Partner's Email</Label>
                    <Input
                      id="partner-email"
                      data-testid="input-partner-email"
                      value={partnerEmail}
                      onChange={(e) =>
                        setPartnerEmail(e.target.value.toLowerCase())
                      }
                      placeholder="partner@example.com"
                    />
                  </div>
                )}
                <Button
                  data-testid="button-send-code"
                  type="submit"
                  disabled={requestCode.isPending}
                >
                  {requestCode.isPending ? "Sending..." : "Register"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="space-y-3">
                <div className="flex items-center justify-between text-sm bg-muted/50 rounded-md px-3 py-2">
                  <span className="text-muted-foreground truncate">
                    Code sent to{" "}
                    <span className="font-medium text-foreground">
                      {email.trim()}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-testid="button-change-email"
                    className="text-primary hover:underline font-medium shrink-0 ml-3"
                    onClick={() => {
                      setCodeSent(false);
                      setCode("");
                    }}
                  >
                    Change
                  </button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-code">Verification Code</Label>
                  <Input
                    id="reg-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    data-testid="input-reg-code"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="123456"
                    maxLength={6}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the 6-digit code we emailed you. It expires in 10
                    minutes.{" "}
                    <button
                      type="button"
                      data-testid="button-resend-code"
                      className="text-primary hover:underline font-medium disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                      onClick={handleResendCode}
                      disabled={cooldown > 0 || requestCode.isPending}
                    >
                      {cooldown > 0
                        ? `Resend code (${cooldown}s)`
                        : "Resend code"}
                    </button>
                  </p>
                </div>
                {nrBlocked ? (
                  <div
                    className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-sm text-destructive"
                    data-testid="notice-nr-blocked"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      This event does not allow non-rated (NR) players. A DUPR
                      doubles rating is required to register.
                    </span>
                  </div>
                ) : partnerNrBlocked ? (
                  <div
                    className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-sm text-destructive"
                    data-testid="notice-partner-nr-blocked"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      This event does not allow non-rated (NR) players. Your
                      partner needs a DUPR doubles rating to register.
                    </span>
                  </div>
                ) : selfRatingRequired ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="self-rating">
                      Self-Rating <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="self-rating"
                      type="text"
                      inputMode="decimal"
                      data-testid="input-self-rating"
                      value={selfRating}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || /^\d+(\.\d{0,2})?$/.test(v)) {
                          setSelfRating(v);
                          setSelfRatingError("");
                        }
                      }}
                      placeholder="e.g. 3.50"
                      required={selfRatingRequired}
                      className={selfRatingError ? "border-destructive" : ""}
                    />
                    {selfRatingError && (
                      <p className="text-xs text-destructive">
                        {selfRatingError}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Your DUPR rating is NR (non-rated). Enter a self-assessed
                      rating between 2.0 and 5.0 (e.g. 3.50).
                    </p>
                  </div>
                ) : null}
                <Button
                  data-testid="button-register"
                  type="submit"
                  disabled={
                    createReg.isPending ||
                    code.trim().length !== 6 ||
                    nrBlocked ||
                    partnerNrBlocked
                  }
                >
                  {createReg.isPending
                    ? "Submitting..."
                    : "Submit Registration"}
                </Button>
              </form>
            )}
          </div>
        )}

        {!signupOpen && event.status === "closed" && (
          <div
            data-testid="notice-registration-closed"
            className="order-2 bg-muted rounded-lg p-4 text-center text-sm text-muted-foreground"
          >
            Registration is closed for this event.
          </div>
        )}

        {/* Cancel Registration trigger */}
        {!showCancelForm && (
          <div
            data-testid="control-cancel-registration"
            className="order-2 text-center"
          >
            <button
              type="button"
              data-testid="button-show-cancel"
              className="text-sm text-muted-foreground hover:text-destructive underline"
              onClick={() => setShowCancelForm(true)}
            >
              Cancel my registration
            </button>
          </div>
        )}

        {/* Cancel Registration form */}
        {showCancelForm && (
          <div
            data-testid="form-cancel-registration"
            className="order-2 bg-card border border-destructive/30 rounded-lg p-5"
          >
            <h2 className="font-semibold text-foreground mb-4">
              Cancel My Registration
            </h2>
            {!cancelCodeSent ? (
              <form onSubmit={handleCancelSendCode} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cancel-email">Email Address</Label>
                  <Input
                    id="cancel-email"
                    type="email"
                    data-testid="input-cancel-email"
                    value={cancelEmail}
                    onChange={(e) => setCancelEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    <strong>
                      Use the email address linked to your DUPR account.
                    </strong>{" "}
                    We will send a verification code to confirm cancellation.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={requestCode.isPending}
                  >
                    {requestCode.isPending ? "Sending..." : "Send Code"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCancelForm(false)}
                  >
                    Never mind
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCancelSubmit} className="space-y-3">
                <div className="flex items-center justify-between text-sm bg-muted/50 rounded-md px-3 py-2">
                  <span className="text-muted-foreground truncate">
                    Code sent to{" "}
                    <span className="font-medium text-foreground">
                      {cancelEmail.trim()}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-primary hover:underline font-medium shrink-0 ml-3"
                    onClick={() => {
                      setCancelCodeSent(false);
                      setCancelCode("");
                    }}
                  >
                    Change
                  </button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cancel-code">Verification Code</Label>
                  <Input
                    id="cancel-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    data-testid="input-cancel-code"
                    value={cancelCode}
                    onChange={(e) =>
                      setCancelCode(
                        e.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    placeholder="123456"
                    maxLength={6}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the 6-digit code we emailed you. It expires in 10
                    minutes.{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline font-medium disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                      onClick={handleCancelResendCode}
                      disabled={cancelCooldown > 0 || requestCode.isPending}
                    >
                      {cancelCooldown > 0
                        ? `Resend code (${cancelCooldown}s)`
                        : "Resend code"}
                    </button>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={
                      cancelReg.isPending || cancelCode.trim().length !== 6
                    }
                  >
                    {cancelReg.isPending
                      ? "Cancelling..."
                      : "Cancel My Registration"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCancelForm(false)}
                  >
                    Never mind
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Approval notice — shown only after registration submitted */}
        {showApprovalNotice &&
          (event.requireApproval === "all" ||
            event.requireApproval === "nr_only") && (
            <div
              data-testid="notice-registration-approval"
              className="order-2 flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {event.requireApproval === "all"
                  ? "This event requires organizer approval. Your registration will be Pending Approval until confirmed."
                  : "This event requires organizer approval for NR (non-rated) players. Your registration will be Pending Approval until confirmed."}
              </span>
            </div>
          )}

        {/* Confirmed Participants */}
        <div className="order-5 bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-foreground">
              Confirmed Participants
              {confirmedRegs.length > 0 ? ` (${confirmedRegs.length})` : ""}
            </h2>
          </div>
          {regLoading ? (
            <div className="p-5 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : confirmedRegs.length > 0 ? (
            <ParticipantTable registrations={confirmedRegs} event={event} />
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">
                No confirmed participants yet. Be the first to register!
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Join Instructions Dialog (triggered by "Not a member yet?" link) */}
      <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How to Join Atlanta DUPR Pickleball</DialogTitle>
          </DialogHeader>
          {joinInstructions ? (
            <div
              className="prose prose-sm max-w-none leading-snug [&_p]:my-0.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 text-foreground"
              dangerouslySetInnerHTML={{ __html: joinInstructions }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No join instructions have been configured yet.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Not a Member Dialog (triggered by failed registration) */}
      <Dialog open={notMemberDialogOpen} onOpenChange={setNotMemberDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Not Found — How to Join</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your email wasn't found in our member list. To register for
              events, you'll need to be a member of the Atlanta DUPR Pickleball
              club.
            </p>
            {joinInstructions ? (
              <div
                className="prose prose-sm max-w-none leading-snug [&_p]:my-0.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 text-foreground border-t border-border pt-3"
                dangerouslySetInnerHTML={{ __html: joinInstructions }}
              />
            ) : (event as any).contactEmail ? (
              <p className="text-sm text-muted-foreground">
                Please contact an organizer to get added to the member list:
              </p>
            ) : null}
            {(event as any).contactEmail && (
              <div className="pt-1">
                <a
                  href={`mailto:${(event as any).contactEmail}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {(event as any).contactEmail}
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
