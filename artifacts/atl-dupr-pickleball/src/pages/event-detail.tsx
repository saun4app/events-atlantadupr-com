import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetEvent, useGetEventRosterSummary, useListRegistrations, useCreateRegistration, useGetSettings,
  getGetEventQueryKey, getGetEventRosterSummaryQueryKey, getListRegistrationsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicNav } from "@/components/public-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format, isPast, isFuture } from "date-fns";
import { MapPin, Calendar, Clock, Users, ChevronLeft, AlertCircle, WrenchIcon, DollarSign, Mail, ExternalLink, Star } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface SkillLevel { text: string; level: number; }

function isNonNumeric(rating: string | null | undefined): boolean {
  if (!rating) return false;
  return isNaN(parseFloat(rating)) || rating === "NR";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    confirmed: { label: "Confirmed", className: "bg-primary/10 text-primary border-primary/20" },
    waitlisted: { label: "Waitlisted", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    pending_approval: { label: "Pending Approval", className: "bg-blue-100 text-blue-700 border-blue-200" },
    rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive border-destructive/20" },
  };
  const s = map[status] ?? { label: status, className: "" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  );
}

function formatRatingInfo(event: any, skillLevels: SkillLevel[]): { label: string; detail?: string } | null {
  const type = event.ratingTypeRequired;
  const cfg = event.ratingConfig;
  if (type === "none" || !type) return null;
  if (type === "dupr") {
    if (cfg) return { label: "DUPR Rating Required", detail: `${cfg.min}–${cfg.max}${cfg.nrAllowed ? " (NR OK)" : ""}` };
    return { label: "DUPR Rating Required" };
  }
  if (type === "self_numeric") {
    if (cfg) return { label: "Self-Rating Required", detail: `${cfg.min}–${cfg.max}` };
    return { label: "Self-Rating Required" };
  }
  if (type === "self_skill") {
    if (cfg && skillLevels.length > 0) {
      const minLv = skillLevels.find(l => l.level === cfg.minLevel);
      const maxLv = skillLevels.find(l => l.level === cfg.maxLevel);
      if (minLv && maxLv) return { label: "Skill Level Required", detail: `${minLv.text} – ${maxLv.text}` };
      if (maxLv) return { label: "Skill Level Required", detail: `Up to: ${maxLv.text}` };
    }
    return { label: "Skill Level Required" };
  }
  return { label: "Rating Required" };
}

function ParticipantTable({ registrations, event }: { registrations: any[]; event: any }) {
  if (registrations.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left px-5 py-3 font-medium text-muted-foreground">#</th>
            <th className="text-left px-5 py-3 font-medium text-muted-foreground">Name</th>
            {event.teamFormat === "fixed_partner" && (
              <th className="text-left px-5 py-3 font-medium text-muted-foreground">Partner</th>
            )}
            <th className="text-left px-5 py-3 font-medium text-muted-foreground">DUPR Rating</th>
            <th className="text-left px-5 py-3 font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((reg, idx) => (
            <tr key={reg.id} data-testid={`row-participant-${reg.id}`} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-5 py-3 text-muted-foreground font-mono">{idx + 1}</td>
              <td className="px-5 py-3 font-medium">{reg.playerName}</td>
              {event.teamFormat === "fixed_partner" && (
                <td className="px-5 py-3 text-muted-foreground">{reg.partnerName || "—"}</td>
              )}
              <td className="px-5 py-3">
                <span data-testid={`text-rating-${reg.id}`} className="font-mono">
                  {reg.doubleRating || "NR"}
                </span>
                {isNonNumeric(reg.doubleRating) && reg.selfRating && (
                  <span className="ml-2 text-xs text-muted-foreground">(self: {reg.selfRating})</span>
                )}
              </td>
              <td className="px-5 py-3">
                <StatusBadge status={reg.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: event, isLoading: evLoading } = useGetEvent(eventId, {
    query: { enabled: !!eventId, queryKey: getGetEventQueryKey(eventId) }
  });
  const { data: rosterSummary } = useGetEventRosterSummary(eventId, {
    query: { enabled: !!eventId, queryKey: getGetEventRosterSummaryQueryKey(eventId) }
  });
  const { data: registrations, isLoading: regLoading } = useListRegistrations(eventId, {
    query: { enabled: !!eventId, queryKey: getListRegistrationsQueryKey(eventId) }
  });
  const { data: settings } = useGetSettings();
  const createReg = useCreateRegistration();

  const [email, setEmail] = useState("");
  const [partnerDuprId, setPartnerDuprId] = useState("");
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [notMemberDialogOpen, setNotMemberDialogOpen] = useState(false);

  const skillLevels: SkillLevel[] = (settings as any)?.ratingRequirementsConfig?.selfSkill?.levels ?? [];
  const joinInstructions: string = (settings as any)?.joinInstructions ?? "";

  if (settings?.maintenanceMode) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNav />
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
          <WrenchIcon className="w-14 h-14 text-muted-foreground/40 mb-5" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Site Under Maintenance</h1>
          <p className="text-muted-foreground max-w-md">This site is temporarily under maintenance. Please check back soon.</p>
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
          <Link href="/"><span className="text-primary text-sm mt-2 block hover:underline">Back to events</span></Link>
        </div>
      </div>
    );
  }

  const signupOpen =
    event.status === "upcoming" &&
    isFuture(new Date(event.signupEndDatetime)) &&
    isPast(new Date(event.signupStartDatetime));
  const signupNotYet = isFuture(new Date(event.signupStartDatetime));

  const ratingInfo = formatRatingInfo(event, skillLevels);

  const confirmedRegs = registrations?.filter(r => r.status === "confirmed") ?? [];

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    createReg.mutate(
      {
        id: eventId,
        data: {
          email: email.trim(),
          partnerDuprId: event?.teamFormat === "fixed_partner" ? partnerDuprId.trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Registration submitted!", description: "You are on the roster." });
          setEmail("");
          setPartnerDuprId("");
          queryClient.invalidateQueries({ queryKey: getListRegistrationsQueryKey(eventId) });
          queryClient.invalidateQueries({ queryKey: getGetEventRosterSummaryQueryKey(eventId) });
        },
        onError: (err: any) => {
          const msg: string = err?.data?.error || err?.message || "Registration failed. Please try again.";
          if (msg.toLowerCase().includes("no member found with that email") || msg.toLowerCase().includes("no member found with that dupr id")) {
            setNotMemberDialogOpen(true);
          } else {
            toast({ title: "Registration failed", description: msg, variant: "destructive" });
          }
        },
      }
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />

      <div className="bg-primary/5 border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ChevronLeft className="w-4 h-4" />
            All Events
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{event.name}</h1>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Event Info Card */}
        <div className="bg-card border border-card-border rounded-lg p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4 text-primary" />
              {format(new Date(event.startDatetime), "EEEE, MMMM d, yyyy")}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-4 h-4 text-primary" />
              {format(new Date(event.startDatetime), "h:mm a")} – {format(new Date(event.endDatetime), "h:mm a")}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Registration closes:</span>
              <span className={signupOpen ? "text-primary font-medium" : "text-muted-foreground"}>
                {format(new Date(event.signupEndDatetime), "EEE, MMM d, h:mm a")}
              </span>
              {signupOpen && <Badge className="text-xs">Open</Badge>}
              {!signupOpen && !signupNotYet && <Badge variant="secondary" className="text-xs">Closed</Badge>}
              {signupNotYet && <Badge variant="secondary" className="text-xs">Not yet open</Badge>}
            </div>
            {rosterSummary && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">Players:</span>
                <span data-testid="text-confirmed-count">
                  <span className="font-semibold text-primary">{rosterSummary.confirmed}</span> / {rosterSummary.maxParticipants}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span>{event.locationName}{event.locationAddress ? ` — ${event.locationAddress}` : ""}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <DollarSign className="w-4 h-4 text-primary" />
              {event.courtFeeEnabled
                ? <span>Court fee: Member ${(event as any).memberFee % 1 === 0 ? (event as any).memberFee : (event as any).memberFee.toFixed(2)} / Non-member ${(event as any).nonMemberFee % 1 === 0 ? (event as any).nonMemberFee : (event as any).nonMemberFee.toFixed(2)}</span>
                : <span>Free</span>
              }
            </div>
            {joinInstructions && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <ExternalLink className="w-4 h-4 text-primary" />
                <span>Requirement: <button type="button" onClick={() => setJoinDialogOpen(true)} className="text-primary hover:underline">Join Atlanta DUPR Pickleball</button> for free</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="w-4 h-4 text-primary" />
              Team Format: {event.teamFormat === "fixed_partner" ? "Fixed-Partner" : "Rotating Partners"}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Star className="w-4 h-4 text-primary" />
              {ratingInfo ? `${ratingInfo.label}${ratingInfo.detail ? ` — ${ratingInfo.detail}` : ""}` : "All Levels"}
            </div>
            {event.requireApproval !== "none" && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <AlertCircle className="w-4 h-4 text-primary" />
                {event.requireApproval === "all" ? "Approval Required" : "NR Players: Approval Required"}
              </div>
            )}
            {(event as any).contactEmail && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <Mail className="w-4 h-4 text-primary" />
                <span>Contact: <a href={`mailto:${(event as any).contactEmail}`} className="text-primary hover:underline">{(event as any).contactEmail}</a></span>
              </div>
            )}
          </div>

          {event.description && (
            <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: event.description }} />
          )}

        </div>

        {/* Rating notice */}
        {ratingInfo && (
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Rating Required:</strong> {ratingInfo.label}{ratingInfo.detail ? ` — ${ratingInfo.detail}` : ""}.
              {(event as any).ratingTypeRequired === "dupr" && " Your DUPR doubles rating will be verified."}
              {(event as any).ratingTypeRequired === "self_numeric" && " Please self-report your numeric rating."}
              {(event as any).ratingTypeRequired === "self_skill" && " Please indicate your skill level when registering."}
            </span>
          </div>
        )}

        {/* Registration form */}
        {signupOpen && (
          <div className="bg-card border border-card-border rounded-lg p-5">
            <h2 className="font-semibold text-foreground mb-4">Register for This Event</h2>
            <form onSubmit={handleSignup} className="space-y-3">
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
                  <strong>Use the email address linked to your DUPR account.</strong> This is how we verify your membership.{" "}
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
                  <Label htmlFor="partner-dupr-id">Partner's DUPR ID</Label>
                  <Input
                    id="partner-dupr-id"
                    data-testid="input-partner-dupr-id"
                    value={partnerDuprId}
                    onChange={(e) => setPartnerDuprId(e.target.value.toUpperCase())}
                    placeholder="e.g. ATL002"
                    className="uppercase"
                  />
                </div>
              )}
              <Button data-testid="button-register" type="submit" disabled={createReg.isPending}>
                {createReg.isPending ? "Submitting..." : "Submit Registration"}
              </Button>
            </form>
          </div>
        )}

        {!signupOpen && event.status !== "upcoming" && (
          <div className="bg-muted rounded-lg p-4 text-center text-sm text-muted-foreground">
            Registration is closed for this event.
          </div>
        )}

        {/* Approval notice */}
        {event.requireApproval !== "none" && (
          <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {event.requireApproval === "all"
                ? "This event requires organizer approval. Your registration will be Pending Approval until confirmed."
                : "This event requires organizer approval for NR (non-rated) players. Your registration will be Pending Approval until confirmed."}
            </span>
          </div>
        )}

        {/* Confirmed Participants */}
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-foreground">
              Confirmed{confirmedRegs.length > 0 ? ` (${confirmedRegs.length})` : ""}
            </h2>
          </div>
          {regLoading ? (
            <div className="p-5 space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : confirmedRegs.length > 0 ? (
            <ParticipantTable registrations={confirmedRegs} event={event} />
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No confirmed participants yet. Be the first to register!</p>
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
            <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: joinInstructions }} />
          ) : (
            <p className="text-sm text-muted-foreground">No join instructions have been configured yet.</p>
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
              Your email wasn't found in our member list. To register for events, you'll need to be a member of the Atlanta DUPR Pickleball club.
            </p>
            {joinInstructions ? (
              <div className="prose prose-sm max-w-none text-foreground border-t border-border pt-3" dangerouslySetInnerHTML={{ __html: joinInstructions }} />
            ) : (
              (event as any).contactEmail ? (
                <p className="text-sm text-muted-foreground">
                  Please contact an organizer to get added to the member list:
                </p>
              ) : null
            )}
            {(event as any).contactEmail && (
              <div className="pt-1">
                <a href={`mailto:${(event as any).contactEmail}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                  <Mail className="w-3.5 h-3.5" />{(event as any).contactEmail}
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
