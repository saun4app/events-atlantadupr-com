import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useListEvents,
  getListEventsQueryKey,
  useEmailFailures,
  type EmailFailure,
} from "@workspace/api-client-react";
import { AdminNav } from "@/components/admin-nav";
import { EventsNav } from "@/components/events-nav";
import NotFound from "@/pages/not-found";
import AdminEventSetup from "@/pages/admin/event-setup";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { format } from "date-fns";
import { Search, Calendar, MapPin, Users, TriangleAlert, SlidersHorizontal } from "lucide-react";

function statusBadge(status: string) {
  if (status === "upcoming") return <Badge className="text-xs bg-primary/10 text-primary border-primary/20 border">Upcoming</Badge>;
  if (status === "closed") return <Badge variant="secondary" className="text-xs">Closed</Badge>;
  if (status === "cancelled") return <Badge variant="destructive" className="text-xs">Canceled</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Ended</Badge>;
}

function EmailFailureBadge() {
  const { data, isLoading } = useEmailFailures();
  const [open, setOpen] = useState(false);

  if (isLoading || !data || data.count === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          data-testid="email-failure-badge"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
        >
          <TriangleAlert className="w-3.5 h-3.5" />
          {data.count} email failure{data.count !== 1 ? "s" : ""} (24 h)
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="w-4 h-4" />
            Email Delivery Failures — Last 24 Hours
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <p className="text-sm text-muted-foreground mb-4">
            {data.count} verification email{data.count !== 1 ? "s" : ""} failed to send. Players affected may need to be assisted manually.
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-0 text-xs font-semibold text-muted-foreground bg-muted/50 px-4 py-2 border-b border-border">
              <span>Recipient</span>
              <span>Event</span>
              <span className="text-right">Time (UTC)</span>
            </div>
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {data.failures.map((f) => (
                <div
                  key={f.id}
                  className="grid grid-cols-[1fr_1fr_auto] gap-2 px-4 py-3 text-sm items-start hover:bg-muted/30 transition-colors"
                >
                  <span className="font-medium truncate text-foreground" title={f.recipientAddress}>
                    {f.recipientAddress}
                  </span>
                  <span className="text-muted-foreground truncate" title={f.eventName ?? "—"}>
                    {f.eventName ?? <span className="italic">—</span>}
                  </span>
                  <span className="text-muted-foreground text-xs text-right whitespace-nowrap">
                    {format(new Date(f.occurredAt), "MMM d, h:mm a")}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {data.failures.some((f: EmailFailure) => f.errorMessage) && (
            <details className="mt-3">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">
                Show error details
              </summary>
              <div className="mt-2 space-y-2">
                {data.failures.map((f: EmailFailure) => (
                  <div key={f.id} className="rounded bg-muted/50 px-3 py-2">
                    <p className="text-xs font-medium text-foreground mb-0.5">{f.recipientAddress}</p>
                    <p className="text-xs text-muted-foreground font-mono break-all">{f.errorMessage}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminEventsFixed() {
  const { isAuthenticated, isLoading, canAccessAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const eventType = "fixed_partner" as const;

  const [search, setSearch] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [eventView, setEventView] = useState<"upcoming" | "past">("upcoming");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !canAccessAdmin) setLocation("/");
  }, [isLoading, isAuthenticated, canAccessAdmin]);

  const { data: events, isLoading: evLoading } = useListEvents(
    eventType,
    { query: { queryKey: getListEventsQueryKey(eventType), refetchOnMount: "always" } }
  );

  const now = Date.now();
  const upcomingEvents = events?.filter(e => new Date(e.startDatetime).getTime() >= now) ?? [];
  const pastEvents = (events?.filter(e => new Date(e.startDatetime).getTime() < now) ?? [])
    .sort((a, b) => new Date(b.startDatetime).getTime() - new Date(a.startDatetime).getTime());
  const selectedEvents = (eventView === "upcoming" ? upcomingEvents : pastEvents).filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.locationName.toLowerCase().includes(search.toLowerCase())
  );

  const formatLabel = "Fixed-Partner";

  function renderEventList(list: typeof selectedEvents) {
    return (
      <div className="space-y-3">
        {list.map(ev => (
          <Link key={ev.id} href={`/admin/events/${eventType}/${ev.id}`} className="block">
            <div
              data-testid={`card-event-${ev.id}`}
              className="bg-card border border-card-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {statusBadge(ev.status)}
                  <span className="text-xs text-muted-foreground">
                    {ev.teamFormat === "fixed_partner" ? "Fixed-Partner" : "Rotating"}
                  </span>
                </div>
                <h3 className="font-semibold text-foreground truncate">{ev.name}</h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(ev.startDatetime), "EEE, MMM d, yyyy 'at' h:mm a")}</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{ev.locationName}</span>
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{ev.confirmedTeams ?? 0} / {ev.maxTeams ?? 0} teams</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <EventsNav eventType={eventType} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Manage Events — {formatLabel}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{events?.length ?? 0} total events</p>
          </div>
          <div className="flex items-center gap-2">
            <EmailFailureBadge />
            <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-event-setup">
                  <SlidersHorizontal className="w-4 h-4" />
                  Event Setup
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Event Setup</DialogTitle>
                </DialogHeader>
                <AdminEventSetup eventType={eventType} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search-events"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search events..."
            className="pl-9"
          />
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-lg border border-border bg-muted p-1"
            role="group"
            aria-label="Event time period"
          >
            <button
              type="button"
              data-testid="button-upcoming-events"
              aria-pressed={eventView === "upcoming"}
              onClick={() => setEventView("upcoming")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                eventView === "upcoming"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Upcoming ({upcomingEvents.length})
            </button>
            <button
              type="button"
              data-testid="button-past-events"
              aria-pressed={eventView === "past"}
              onClick={() => setEventView("past")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                eventView === "past"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Past ({pastEvents.length})
            </button>
          </div>
          <span className="text-xs text-muted-foreground">
            {selectedEvents.length} {eventView} event{selectedEvents.length === 1 ? "" : "s"}
          </span>
        </div>

        {evLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
          </div>
        ) : selectedEvents.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p>{search ? "No matching events found" : `No ${eventView} events`}</p>
          </div>
        ) : (
          renderEventList(selectedEvents)
        )}
      </main>
    </div>
  );
}
