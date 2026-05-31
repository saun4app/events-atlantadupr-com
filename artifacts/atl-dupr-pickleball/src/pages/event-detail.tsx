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
import { MapPin, Calendar, Clock, Users, ChevronLeft, AlertCircle, WrenchIcon } from "lucide-react";

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

  const [duprId, setDuprId] = useState("");
  const [partnerDuprId, setPartnerDuprId] = useState("");

  if (settings?.maintenanceMode) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNav />
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
          <WrenchIcon className="w-14 h-14 text-muted-foreground/40 mb-5" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Site Under Maintenance</h1>
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
          <Link href="/"><a className="text-primary text-sm mt-2 block hover:underline">Back to events</a></Link>
        </div>
      </div>
    );
  }

  const now = new Date();
  const signupOpen =
    event.status === "upcoming" &&
    isFuture(new Date(event.signupEndDatetime)) &&
    isPast(new Date(event.signupStartDatetime));
  const signupNotYet = isFuture(new Date(event.signupStartDatetime));

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    createReg.mutate(
      {
        id: eventId,
        data: {
          memberDuprId: duprId.trim(),
          partnerDuprId: event?.formatType === "fixed_partner" ? partnerDuprId.trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Registration submitted!", description: "You are on the roster." });
          setDuprId("");
          setPartnerDuprId("");
          queryClient.invalidateQueries({ queryKey: getListRegistrationsQueryKey(eventId) });
          queryClient.invalidateQueries({ queryKey: getGetEventRosterSummaryQueryKey(eventId) });
        },
        onError: (err: any) => {
          const msg = err?.data?.error || "Registration failed. Check your DUPR ID and try again.";
          toast({ title: "Registration failed", description: msg, variant: "destructive" });
        },
      }
    );
  }

  const showSelfRating = (reg: any) => isNonNumeric(reg.doubleRating) && reg.selfRating;

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
              <MapPin className="w-4 h-4 text-primary" />
              <span>{event.locationName} — {event.locationAddress}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <Badge variant="outline" className="text-xs">{event.formatType === "fixed_partner" ? "Fixed-Partner" : "Rotating Partners"}</Badge>
            {event.ratingTypeRequired !== "none" && <Badge variant="outline" className="text-xs">DUPR Required</Badge>}
            {event.requireApproval && <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700">Approval Required</Badge>}
            {event.waitlistEnabled && <Badge variant="outline" className="text-xs">Waitlist Enabled</Badge>}
          </div>

          {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}

          <div className="mt-4 pt-4 border-t border-border flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Signup Window:</span>
            <span className={signupOpen ? "text-primary font-medium" : "text-muted-foreground"}>
              {format(new Date(event.signupStartDatetime), "MMM d, h:mm a")} – {format(new Date(event.signupEndDatetime), "MMM d, h:mm a")}
            </span>
            {signupOpen && <Badge className="text-xs">Open</Badge>}
            {!signupOpen && !signupNotYet && <Badge variant="secondary" className="text-xs">Closed</Badge>}
            {signupNotYet && <Badge variant="secondary" className="text-xs">Not yet open</Badge>}
          </div>

          {rosterSummary && (
            <div className="mt-3 flex gap-4 text-sm">
              <span data-testid="text-confirmed-count"><span className="font-semibold text-primary">{rosterSummary.confirmed}</span> confirmed</span>
              {rosterSummary.waitlisted > 0 && <span><span className="font-semibold text-yellow-600">{rosterSummary.waitlisted}</span> waitlisted</span>}
              {rosterSummary.pendingApproval > 0 && <span><span className="font-semibold text-blue-600">{rosterSummary.pendingApproval}</span> pending</span>}
              <span className="text-muted-foreground">/ {rosterSummary.maxParticipants} max</span>
            </div>
          )}
        </div>

        {event.requireApproval && (
          <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>This event requires organizer approval. Your registration will be <strong>Pending Approval</strong> until confirmed.</span>
          </div>
        )}

        {signupOpen && (
          <div className="bg-card border border-card-border rounded-lg p-5">
            <h2 className="font-semibold text-foreground mb-4">Register for This Event</h2>
            <form onSubmit={handleSignup} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="dupr-id">Your DUPR ID</Label>
                <Input
                  id="dupr-id"
                  data-testid="input-dupr-id"
                  value={duprId}
                  onChange={(e) => setDuprId(e.target.value)}
                  placeholder="e.g. ATL001"
                  required
                />
              </div>
              {event.formatType === "fixed_partner" && (
                <div className="space-y-1.5">
                  <Label htmlFor="partner-dupr-id">Partner's DUPR ID</Label>
                  <Input
                    id="partner-dupr-id"
                    data-testid="input-partner-dupr-id"
                    value={partnerDuprId}
                    onChange={(e) => setPartnerDuprId(e.target.value)}
                    placeholder="e.g. ATL002"
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

        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Participants</h2>
          </div>
          {regLoading ? (
            <div className="p-5 space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : registrations && registrations.filter(r => r.status !== "rejected").length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground">#</th>
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground">Name</th>
                    {event.formatType === "fixed_partner" && (
                      <th className="text-left px-5 py-3 font-medium text-muted-foreground">Partner</th>
                    )}
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground">DUPR Rating</th>
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations
                    .filter(r => r.status !== "rejected")
                    .map((reg, idx) => (
                      <tr key={reg.id} data-testid={`row-participant-${reg.id}`} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 text-muted-foreground font-mono">{idx + 1}</td>
                        <td className="px-5 py-3 font-medium">{reg.playerName}</td>
                        {event.formatType === "fixed_partner" && (
                          <td className="px-5 py-3 text-muted-foreground">{reg.partnerName || "—"}</td>
                        )}
                        <td className="px-5 py-3">
                          <span data-testid={`text-rating-${reg.id}`} className="font-mono">
                            {reg.doubleRating || "NR"}
                          </span>
                          {showSelfRating(reg) && (
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
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No participants yet. Be the first to register!</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
